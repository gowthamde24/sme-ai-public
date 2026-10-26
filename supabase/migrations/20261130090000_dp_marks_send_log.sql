-- Job DP part 2 (night run 26 Oct 2026), migration 1: THE SEND LOG OF MARKS MESSAGES, and nothing else.
--
--   Owner decision: the platform NEVER stores children's marks. A school uploads a marks file for ONE send; the API reads it in memory for the request, fills the fixed, approved templates, the Owner approves, the
--   message goes out (fake sending for now) and the file is gone with the request. What stays is a SEND LOG: which guardian (a contact of the school), when, which template, what happened. No marks, no child's name,
--   no subject, no term, no message text: the table has no column that could hold one (a test lists the columns).
--
--   public.marks_send_log            one row per message: batch, line number in the file, guardian (contact), template id (`marks.te`, `report_ready.hi` ...), status, closed reason, who approved, times
--   public.marks_send_resolve        phone numbers -> the school's guardian contacts (ok / unknown / blocked). Owner or Admin. Used by the preview and the send; stores nothing
--   public.marks_send_begin          the Owner (second factor) approves a batch: writes the log rows, `pending` or `blocked`; a retry of the same batch writes nothing twice
--   public.marks_send_finish         the API tells what the channel said: pending -> sent | failed. Nothing else about a row ever changes
--   public.marks_send_batches        the school's send log, one line per batch with counts (Owner, Admin)
--   public.marks_send_batch          one batch's rows with the guardian's name (an adult)
--
--   School only: the table is guarded by the module `programmes` (SM701 when it is off) and every function says SM701 for a business that does not have it.
--   Blocked (never sent): a guardian who opted out or was suppressed, whose WhatsApp consent was withdrawn, or who was erased.
--   SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM306 second factor needed, SM701 module off.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the table
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.marks_send_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  batch_id    uuid not null,
  -- the 1-based line of the uploaded file this message came from (so a retry of the same file never sends a line twice)
  seq         integer not null check (seq between 1 and 5000),
  contact_id  uuid not null,
  template_id text not null check (template_id ~ '^(marks|report_ready)\.(en|te|hi|kn)$'),
  status      text not null check (status in ('pending', 'sent', 'blocked', 'failed')),
  reason      text check (reason in ('suppressed', 'consent_withdrawn', 'erased', 'provider_refused', 'provider_unreachable')),
  approved_by uuid not null,
  created_at  timestamptz not null default app.outbox_now(),
  sent_at     timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, batch_id, seq),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  check (coalesce((status = 'sent') = (sent_at is not null), false)),
  check (coalesce((status in ('blocked', 'failed')) = (reason is not null), false)),
  check (coalesce(status <> 'blocked' or reason in ('suppressed', 'consent_withdrawn', 'erased'), false)),
  check (coalesce(status <> 'failed' or reason in ('provider_refused', 'provider_unreachable'), false))
);
create index marks_send_log_batch_idx on public.marks_send_log (tenant_id, batch_id, seq);
create index marks_send_log_keyset_idx on public.marks_send_log (tenant_id, created_at desc, id desc);
create index marks_send_log_contact_idx on public.marks_send_log (tenant_id, contact_id);
comment on table public.marks_send_log is 'Job DP: the log of marks and report messages to guardians. NO marks, NO child, NO subject, NO message text are stored: only who (a guardian contact), when, which template, what happened.';
comment on column public.marks_send_log.batch_id is 'SAFE: a random id the client makes for one send. CLEAN-EXEMPT: uuid';
comment on column public.marks_send_log.template_id is 'SAFE: a closed word (kind.language). CLEAN-EXEMPT: closed CHECK pattern';
comment on column public.marks_send_log.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.marks_send_log.reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

alter table public.marks_send_log enable row level security;
alter table public.marks_send_log force row level security;
revoke all on public.marks_send_log from public, anon, authenticated, service_role;
grant select on public.marks_send_log to authenticated;
create policy marks_send_log_select on public.marks_send_log for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger marks_send_log_forbid_tenant_id_change before update on public.marks_send_log for each row execute function app.forbid_tenant_id_change();
create trigger module_guard before insert on public.marks_send_log for each row execute function app.module_guard('programmes');
create trigger audit_marks_send_log after insert or update on public.marks_send_log for each row execute function app.audit_row_change('marks_send', '');

-- a row says what happened once and never changes, except that a `pending` row becomes `sent` or `failed` (and only that); never deleted
create function app.marks_send_log_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'the send log is never deleted' using errcode = '42501';
  end if;
  if old.status <> 'pending' or new.status not in ('sent', 'failed')
     or new.id is distinct from old.id or new.batch_id is distinct from old.batch_id or new.seq is distinct from old.seq or new.contact_id is distinct from old.contact_id
     or new.template_id is distinct from old.template_id or new.approved_by is distinct from old.approved_by or new.created_at is distinct from old.created_at then
    raise exception 'a send log row changes only from pending to sent or failed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.marks_send_log_guard() from public;
create trigger marks_send_log_guard before update or delete on public.marks_send_log for each row execute function app.marks_send_log_guard();
create trigger marks_send_log_no_truncate before truncate on public.marks_send_log for each statement execute function app.marks_send_log_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.marks_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'    then raise exception 'invalid input' using errcode = '22023';
    when 'reference'  then raise exception 'not found' using errcode = '23503';
    when 'module_off' then raise exception 'this module is not on for this business' using errcode = 'SM701';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.marks_error(text) from public;

-- why a guardian cannot be written to: null = may be written to
create function app.marks_blocked_reason(c public.contacts) returns text
language sql
stable
set search_path = ''
as $$
  select case when c.erased_at is not null then 'erased'
              when c.suppressed_at is not null then 'suppressed'
              when c.whatsapp_consent = 'withdrawn' then 'consent_withdrawn' end
$$;
revoke all on function app.marks_blocked_reason(public.contacts) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. phone numbers -> guardians (stores nothing)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- p_phones: up to 5000 numbers as written in the file. The answer has one entry per number, in the same order:
--   {"state": "ok", "contact_id": ...} | {"state": "blocked", "contact_id": ..., "reason": ...} | {"state": "unknown"}
-- A number held by two contacts (two parents, one family number) is the OLDEST contact's, the same rule every time.
create function public.marks_send_resolve(p_tenant_id uuid, p_phones text[]) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.marks_error('deny');
  end if;
  if not app.module_enabled(p_tenant_id, 'programmes') then
    perform app.marks_error('module_off');
  end if;
  if p_phones is null or cardinality(p_phones) not between 1 and 5000 then
    perform app.marks_error('invalid');
  end if;
  select coalesce(jsonb_agg(
           case when m.id is null then jsonb_build_object('state', 'unknown')
                when app.marks_blocked_reason(m) is not null then jsonb_build_object('state', 'blocked', 'contact_id', m.id, 'reason', app.marks_blocked_reason(m))
                else jsonb_build_object('state', 'ok', 'contact_id', m.id) end
           order by t.ord), '[]'::jsonb)
    into v_out
    from unnest(p_phones) with ordinality as t(phone, ord)
    left join lateral (
      select c.* from public.contacts c
       where c.tenant_id = p_tenant_id and c.phone is not null and app.phone_norm(c.phone) is not null and app.phone_norm(c.phone) = app.phone_norm(t.phone)
       order by (c.erased_at is null) desc, c.created_at, c.id
       limit 1) m on true;
  return v_out;
end;
$$;
revoke all on function public.marks_send_resolve(uuid, text[]) from public, anon;
grant execute on function public.marks_send_resolve(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the Owner approves a batch
-- ---------------------------------------------------------------------------------------------------------------------------------
-- p_items: up to 500 of {"seq": line, "contact_id": ..., "template_id": "marks.te"}. Returns {"to_send": [seq, ...], "blocked": n, "already": n}:
-- `to_send` are the lines whose rows were just written as pending (the API sends exactly those); a line that was already logged in this batch is counted in `already` and not sent again.
create function public.marks_send_begin(p_tenant_id uuid, p_batch_id uuid, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_item    jsonb;
  v_contact public.contacts;
  v_reason  text;
  v_new     integer;
  v_seqs    integer[] := '{}';
  v_blocked integer := 0;
  v_already integer := 0;
  v_status  text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.marks_error('deny');
  end if;
  perform app.require_aal2();
  if not app.module_enabled(p_tenant_id, 'programmes') then
    perform app.marks_error('module_off');
  end if;
  if p_batch_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 500 then
    perform app.marks_error('invalid');
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'seq') is distinct from 'number' or jsonb_typeof(v_item -> 'contact_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'template_id') is distinct from 'string' or (v_item ->> 'seq') !~ '^[0-9]{1,4}$' or (v_item ->> 'contact_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app.marks_error('invalid');
    end if;
    select c.* into v_contact from public.contacts c where c.tenant_id = p_tenant_id and c.id = (v_item ->> 'contact_id')::uuid;
    if not found then
      perform app.marks_error('reference');
    end if;
    v_reason := app.marks_blocked_reason(v_contact);
    v_status := case when v_reason is null then 'pending' else 'blocked' end;
    begin
      insert into public.marks_send_log (tenant_id, batch_id, seq, contact_id, template_id, status, reason, approved_by)
      values (p_tenant_id, p_batch_id, (v_item ->> 'seq')::integer, v_contact.id, v_item ->> 'template_id', v_status, v_reason, v_uid)
      on conflict (tenant_id, batch_id, seq) do nothing;
    exception when check_violation then
      perform app.marks_error('invalid');
    end;
    get diagnostics v_new = row_count;
    if v_new = 0 then
      v_already := v_already + 1;
    elsif v_status = 'pending' then
      v_seqs := v_seqs || (v_item ->> 'seq')::integer;
    else
      v_blocked := v_blocked + 1;
    end if;
  end loop;
  return jsonb_build_object('to_send', to_jsonb(v_seqs), 'blocked', v_blocked, 'already', v_already);
end;
$$;
revoke all on function public.marks_send_begin(uuid, uuid, jsonb) from public, anon;
grant execute on function public.marks_send_begin(uuid, uuid, jsonb) to authenticated;

-- p_results: [{"seq": line, "status": "sent" | "failed", "reason": "provider_refused" | "provider_unreachable" (failed only)}]. Only pending rows of this batch change.
create function public.marks_send_finish(p_tenant_id uuid, p_batch_id uuid, p_results jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_n    integer;
  v_done integer := 0;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.marks_error('deny');
  end if;
  perform app.require_aal2();
  if not app.module_enabled(p_tenant_id, 'programmes') then
    perform app.marks_error('module_off');
  end if;
  if p_batch_id is null or p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) not between 1 and 500 then
    perform app.marks_error('invalid');
  end if;
  for v_item in select * from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'seq') is distinct from 'number' or (v_item ->> 'seq') !~ '^[0-9]{1,4}$'
       or (v_item ->> 'status') is null or (v_item ->> 'status') not in ('sent', 'failed')
       or ((v_item ->> 'status') = 'sent' and (v_item ->> 'reason') is not null)
       or ((v_item ->> 'status') = 'failed' and ((v_item ->> 'reason') is null or (v_item ->> 'reason') not in ('provider_refused', 'provider_unreachable'))) then
      perform app.marks_error('invalid');
    end if;
    update public.marks_send_log l
       set status = v_item ->> 'status',
           reason = case when v_item ->> 'status' = 'failed' then v_item ->> 'reason' end,
           sent_at = case when v_item ->> 'status' = 'sent' then app.outbox_now() end
     where l.tenant_id = p_tenant_id and l.batch_id = p_batch_id and l.seq = (v_item ->> 'seq')::integer and l.status = 'pending';
    get diagnostics v_n = row_count;
    v_done := v_done + v_n;
  end loop;
  return jsonb_build_object('updated', v_done);
end;
$$;
revoke all on function public.marks_send_finish(uuid, uuid, jsonb) from public, anon;
grant execute on function public.marks_send_finish(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. reading the log
-- ---------------------------------------------------------------------------------------------------------------------------------
-- one line per batch, newest first: {items: [{batch_id, started_at, approved_by, total, sent, blocked, failed, pending, templates: [...]}], has_more}
create function public.marks_send_batches(p_tenant_id uuid, p_limit integer, p_before_at timestamptz) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.marks_error('deny');
  end if;
  if not app.module_enabled(p_tenant_id, 'programmes') then
    perform app.marks_error('module_off');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.marks_error('invalid');
  end if;
  select coalesce(jsonb_agg(b.j order by b.started_at desc, b.batch_id desc), '[]'::jsonb) into v_rows from (
    select g.started_at, g.batch_id,
           jsonb_build_object('batch_id', g.batch_id, 'started_at', g.started_at, 'approved_by', g.approved_by, 'total', g.total, 'sent', g.sent, 'blocked', g.blocked,
                              'failed', g.failed, 'pending', g.pending, 'templates', g.templates) as j
      from (select l.batch_id, min(l.created_at) as started_at, (array_agg(l.approved_by order by l.created_at))[1] as approved_by, count(*) as total,
                   count(*) filter (where l.status = 'sent') as sent, count(*) filter (where l.status = 'blocked') as blocked,
                   count(*) filter (where l.status = 'failed') as failed, count(*) filter (where l.status = 'pending') as pending,
                   to_jsonb(array_agg(distinct l.template_id)) as templates
              from public.marks_send_log l where l.tenant_id = p_tenant_id group by l.batch_id) g
     where p_before_at is null or g.started_at < p_before_at
     order by g.started_at desc, g.batch_id desc
     limit p_limit + 1) b;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality as e(value, ord) where e.ord <= p_limit),
    'has_more', jsonb_array_length(v_rows) > p_limit);
end;
$$;
revoke all on function public.marks_send_batches(uuid, integer, timestamptz) from public, anon;
grant execute on function public.marks_send_batches(uuid, integer, timestamptz) to authenticated;

-- one batch: {batch_id, started_at, total, sent, blocked, failed, pending, rows: [{seq, contact_id, guardian_name, template_id, status, reason, sent_at}]} (at most 5000 rows, by line)
create function public.marks_send_batch(p_tenant_id uuid, p_batch_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_head jsonb;
  v_rows jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.marks_error('deny');
  end if;
  if not app.module_enabled(p_tenant_id, 'programmes') then
    perform app.marks_error('module_off');
  end if;
  if p_batch_id is null then
    perform app.marks_error('invalid');
  end if;
  select jsonb_build_object('batch_id', p_batch_id, 'started_at', min(l.created_at), 'approved_by', (array_agg(l.approved_by order by l.created_at))[1], 'total', count(*),
                            'sent', count(*) filter (where l.status = 'sent'), 'blocked', count(*) filter (where l.status = 'blocked'),
                            'failed', count(*) filter (where l.status = 'failed'), 'pending', count(*) filter (where l.status = 'pending'))
    into v_head from public.marks_send_log l where l.tenant_id = p_tenant_id and l.batch_id = p_batch_id;
  if v_head is null or (v_head ->> 'total')::integer = 0 then
    perform app.marks_error('reference');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('seq', l.seq, 'contact_id', l.contact_id, 'guardian_name', case when c.erased_at is null then c.full_name end, 'template_id', l.template_id,
                                               'status', l.status, 'reason', l.reason, 'sent_at', l.sent_at) order by l.seq), '[]'::jsonb)
    into v_rows
    from public.marks_send_log l join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
   where l.tenant_id = p_tenant_id and l.batch_id = p_batch_id;
  return v_head || jsonb_build_object('rows', v_rows);
end;
$$;
revoke all on function public.marks_send_batch(uuid, uuid) from public, anon;
grant execute on function public.marks_send_batch(uuid, uuid) to authenticated;
