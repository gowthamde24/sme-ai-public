-- Job BB (ADR 0070), the outbox part. A new migration; earlier files are not edited. Gaps the Outbox page (job AX) could not draw, and the worker's way to hand a real channel its photos:
--
--   1. GLOSS. `outbox_messages.gloss_en`: the English gloss of a message written in another language (set when the message is made, e.g. from a suggested draft; cleared or replaced when the words are
--      edited). It is a translation of the words, so it is personal data like the words are: erased with them (registry rows and the two erasure functions below), never audited by value.
--   2. EVENTS. `outbox_events`: one row for every step of a message (made, queued, held for the morning, waiting for approval, approved, rejected, edited, blocked, sent, failed) with who (a person, Agent OWL,
--      the worker, the system) and when. Written by ONE trigger on the message row, so every path (a person, the assistant, the worker, STOP) is covered and none can forget. NO message text, phone number or
--      name is in an event; the reason is a closed word.
--   3. THE LOG. `outbox_list` (the page of message ids for a tab, a customer, a date range, with a keyset cursor) and `outbox_summary` (the count per tab and how many are due now), both Owner / Admin / Sales.
--   4. THE WORKER'S PHOTOS. The worker's principal (job AW) may READ, and therefore ask storage to sign, only the files of photos attached to a message that is CLAIMED right now (a live lease, last ten
--      minutes): `app.worker_may_read_object`. It cannot read any other file of any business. So a real WhatsApp adapter can be given short-lived signed URLs; no service key exists anywhere.
--   5. The submit core / wrapper, outbox_edit, the guard of the message rows and the two erasure functions are replaced as FULL COPIES plus the lines for the gloss (pinned by test_migration_copies_bb.py).
--
-- SQLSTATEs: 42501 deny, 22023 invalid, 23503 unknown / foreign reference, 23505 id reused for other content, SM501 not in the state this needs.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the gloss
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.outbox_messages add column gloss_en text check (char_length(gloss_en) between 2 and 3000 and app.text_is_clean(gloss_en));
comment on column public.outbox_messages.gloss_en is 'PII: the English gloss of the words of a message to a customer; it can name them. Erased by the tenant, contact and company scopes and swept (ADR 0014).';
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('outbox_messages', 'gloss_en', 'tenant',  'tombstone', 'erased:1'),
  ('outbox_messages', 'gloss_en', 'sweep',   'substring', 'erased:1'),
  ('outbox_messages', 'gloss_en', 'contact', 'tombstone', 'erased:1'),
  ('outbox_messages', 'gloss_en', 'company', 'tombstone', 'erased:1');
-- the audit trigger must not record the gloss by value either: it is on the PII list of the message table
drop trigger audit_outbox_messages on public.outbox_messages;
create trigger audit_outbox_messages after insert or update or delete on public.outbox_messages for each row execute function app.audit_row_change('outbox_message', 'body,gloss_en');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the events of a message
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.outbox_events (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  message_id    uuid not null,
  kind          text not null check (kind in ('made', 'queued', 'held', 'needs_approval', 'approved', 'rejected', 'edited', 'blocked', 'sent', 'failed')),
  -- the closed word that goes with the step (a policy reason, or a failure code); never text
  reason        text check (reason ~ '^[a-z_]{2,30}$'),
  at            timestamptz not null,
  -- who: a person (their user id), Agent OWL acting for a person (that person's id), the worker or the system (no id)
  actor_kind    text not null check (actor_kind in ('person', 'assistant', 'worker', 'system')),
  actor_user_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, message_id) references public.outbox_messages (tenant_id, id),
  check (actor_user_id is null or actor_kind in ('person', 'assistant'))
);
create index outbox_events_message_idx on public.outbox_events (tenant_id, message_id, seq);
comment on column public.outbox_events.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_events.reason is 'SAFE: a closed word. CLEAN-EXEMPT: strict pattern CHECK of lowercase letters and underscores';
comment on column public.outbox_events.actor_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create function app.outbox_events_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the events of a message are never changed' using errcode = '42501';
end;
$$;
revoke all on function app.outbox_events_guard() from public;
create trigger outbox_events_forbid_tenant_id_change before update on public.outbox_events for each row execute function app.forbid_tenant_id_change();
create trigger outbox_events_no_update before update on public.outbox_events for each row execute function app.outbox_events_guard();
create trigger outbox_events_no_delete before delete on public.outbox_events for each row execute function app.outbox_events_guard();
create trigger outbox_events_no_truncate before truncate on public.outbox_events for each statement execute function app.outbox_events_guard();
create trigger audit_outbox_events after insert or update or delete on public.outbox_events for each row execute function app.audit_row_change('outbox_event');
alter table public.outbox_events enable row level security;
alter table public.outbox_events force row level security;
revoke all on public.outbox_events from public, anon, authenticated;
grant select on public.outbox_events to authenticated;
create policy outbox_events_select on public.outbox_events for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));

-- who is acting now: a person (a signed-in member), the worker (the registered scheduler account: nobody's name), or the system (no request identity)
create function app.outbox_actor(out o_uid uuid, out o_kind text) returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  o_uid := auth.uid();
  o_kind := case when o_uid is null then 'system' when exists (select 1 from scheduler.principals p where p.user_id = o_uid) then 'worker' else 'person' end;
  if o_kind <> 'person' then
    o_uid := null;
  end if;
end;
$$;
revoke all on function app.outbox_actor() from public, anon, authenticated, service_role;

create function app.outbox_event(p_row public.outbox_messages, p_kind text, p_reason text, p_at timestamptz, p_actor_kind text, p_uid uuid) returns void
language sql
set search_path = ''
as $$
  insert into public.outbox_events (tenant_id, message_id, kind, reason, at, actor_kind, actor_user_id) values (p_row.tenant_id, p_row.id, p_kind, p_reason, p_at, p_actor_kind, p_uid)
$$;
revoke all on function app.outbox_event(public.outbox_messages, text, text, timestamptz, text, uuid) from public, anon, authenticated, service_role;

create function app.outbox_messages_events() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  a     record;
begin
  -- an erasure tombstones words, it does not "edit" a message
  if tg_op = 'UPDATE' and current_user = 'postgres' and app.erasure_running(new.tenant_id) then
    return new;
  end if;
  select * into a from app.outbox_actor();
  if tg_op = 'INSERT' then
    perform app.outbox_event(new, 'made', null, new.created_at,
                             case new.source when 'assistant' then 'assistant' when 'owner' then 'person' else 'system' end,
                             case when new.source in ('assistant', 'owner') then new.created_by else null end);
    perform app.outbox_event(new,
                             case new.status when 'needs_approval' then 'needs_approval' when 'blocked' then 'blocked' when 'queued' then (case when new.reason = 'quiet_hours' then 'held' else 'queued' end) else 'queued' end,
                             new.reason, new.created_at, 'system', null);
    return new;
  end if;
  if old.status = 'needs_approval' and new.status = 'queued' then
    perform app.outbox_event(new, 'approved', null, coalesce(new.decided_at, v_now), 'person', new.decided_by);
    if new.scheduled_for is not null and new.scheduled_for > v_now then
      perform app.outbox_event(new, 'held', 'quiet_hours', v_now, 'system', null);
    end if;
  elsif old.status in ('needs_approval', 'queued') and new.status = 'blocked' then
    if new.reason = 'owner_rejected' then
      perform app.outbox_event(new, 'rejected', null, coalesce(new.decided_at, v_now), 'person', new.decided_by);
    else
      perform app.outbox_event(new, 'blocked', new.reason, v_now, a.o_kind, a.o_uid);
    end if;
  elsif old.status = 'queued' and new.status = 'sent' then
    perform app.outbox_event(new, 'sent', null, coalesce(new.sent_at, v_now), a.o_kind, a.o_uid);
  elsif old.status = 'queued' and new.status = 'failed' then
    perform app.outbox_event(new, 'failed', new.failure_code, v_now, a.o_kind, a.o_uid);
  elsif new.status = old.status then
    if new.body is distinct from old.body then
      perform app.outbox_event(new, 'edited', null, v_now, a.o_kind, a.o_uid);
    elsif old.status = 'queued' and new.scheduled_for is distinct from old.scheduled_for and new.scheduled_for > coalesce(old.scheduled_for, v_now) then
      perform app.outbox_event(new, 'held', 'quiet_hours', v_now, 'system', null);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.outbox_messages_events() from public;
create trigger outbox_messages_events after insert or update on public.outbox_messages for each row execute function app.outbox_messages_events();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the log: a page of ids for a tab / customer / date range, and the counts per tab
--    SECURITY DEFINER with the role proven first (Owner, Admin, Sales); a Viewer reads no message. The customer filter matches the company's name and the contact's name, never the words.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.outbox_list(
  p_tenant_id uuid, p_tab text default null, p_q text default null, p_from date default null, p_to date default null, p_limit integer default 30,
  p_after_created_at timestamptz default null, p_after_id uuid default null
) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_q    text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text;
  v_out  jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if (p_tab is not null and p_tab not in ('waiting', 'scheduled', 'sent', 'blocked'))
     or (v_q is not null and (char_length(v_q) not between 2 and 60 or not app.text_is_clean(v_q)))
     or (p_from is not null and p_to is not null and (p_from > p_to or p_to - p_from > 366))
     or p_limit is null or p_limit not between 1 and 100
     or ((p_after_created_at is null) <> (p_after_id is null)) then
    perform app.outbox_error('invalid');
  end if;
  v_like := case when v_q is null then null else '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'created_at', z.created_at) order by z.created_at desc, z.id desc), '[]'::jsonb) into v_out
    from (
      select m.id, m.created_at
        from public.outbox_messages m
        left join public.leads l on l.tenant_id = m.tenant_id and l.id = m.lead_id
        left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
        left join public.contacts k on k.tenant_id = m.tenant_id and k.id = m.contact_id
       where m.tenant_id = p_tenant_id
         and (case p_tab when 'waiting' then m.status = 'needs_approval' when 'scheduled' then m.status = 'queued' when 'sent' then m.status = 'sent'
                         when 'blocked' then m.status in ('blocked', 'failed') else true end)
         and (v_like is null or c.name ilike v_like escape '\' or k.full_name ilike v_like escape '\')
         and (p_from is null or (m.created_at at time zone 'Asia/Kolkata')::date >= p_from)
         and (p_to is null or (m.created_at at time zone 'Asia/Kolkata')::date <= p_to)
         and (p_after_created_at is null or (m.created_at, m.id) < (p_after_created_at, p_after_id))
       order by m.created_at desc, m.id desc
       limit p_limit
    ) z;
  return v_out;
end;
$$;
revoke all on function public.outbox_list(uuid, text, text, date, date, integer, timestamptz, uuid) from public, anon;
grant execute on function public.outbox_list(uuid, text, text, date, date, integer, timestamptz, uuid) to authenticated;

-- counts per tab (the same customer and date filters), and what is due right now (queued, not scheduled for later): what "send what is due now" would hand to the channel
create function public.outbox_summary(p_tenant_id uuid, p_q text default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_q    text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text;
  v_now  timestamptz := app.outbox_now();
  r      record;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if (v_q is not null and (char_length(v_q) not between 2 and 60 or not app.text_is_clean(v_q))) or (p_from is not null and p_to is not null and (p_from > p_to or p_to - p_from > 366)) then
    perform app.outbox_error('invalid');
  end if;
  v_like := case when v_q is null then null else '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  select count(*) filter (where m.status = 'needs_approval') as waiting,
         count(*) filter (where m.status = 'queued') as scheduled,
         count(*) filter (where m.status = 'sent') as sent,
         count(*) filter (where m.status in ('blocked', 'failed')) as blocked
    into r
    from public.outbox_messages m
    left join public.leads l on l.tenant_id = m.tenant_id and l.id = m.lead_id
    left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
    left join public.contacts k on k.tenant_id = m.tenant_id and k.id = m.contact_id
   where m.tenant_id = p_tenant_id
     and (v_like is null or c.name ilike v_like escape '\' or k.full_name ilike v_like escape '\')
     and (p_from is null or (m.created_at at time zone 'Asia/Kolkata')::date >= p_from)
     and (p_to is null or (m.created_at at time zone 'Asia/Kolkata')::date <= p_to);
  return jsonb_build_object(
    'waiting', r.waiting, 'scheduled', r.scheduled, 'sent', r.sent, 'blocked', r.blocked,
    -- not filtered: what the dispatch button would act on
    'due_now', (select count(*) from public.outbox_messages m where m.tenant_id = p_tenant_id and m.status = 'queued' and (m.scheduled_for is null or m.scheduled_for <= v_now)),
    'held_for_later', (select count(*) from public.outbox_messages m where m.tenant_id = p_tenant_id and m.status = 'queued' and m.scheduled_for > v_now));
end;
$$;
revoke all on function public.outbox_summary(uuid, text, date, date) from public, anon;
grant execute on function public.outbox_summary(uuid, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the worker may read exactly the files of the messages it has claimed
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.worker_may_read_object(p_bucket text, p_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_scheduler()
     and exists (
       select 1
         from public.outbox_messages om
         join public.outbox_message_media md on md.tenant_id = om.tenant_id and md.message_id = om.id
         join public.catalogue_photos ph on ph.tenant_id = md.tenant_id and ph.id = md.photo_id
        where om.status = 'queued' and om.claimed_at is not null and om.claimed_at > app.outbox_now() - interval '10 minutes'
          and ph.bucket = p_bucket and p_name in (ph.path, ph.thumb_path))
$$;
revoke all on function app.worker_may_read_object(text, text) from public, anon, service_role;
grant execute on function app.worker_may_read_object(text, text) to authenticated;
create policy catalogue_objects_select_worker on storage.objects for select to authenticated
  using (app.catalogue_bucket_tenant(bucket_id) is not null and app.worker_may_read_object(bucket_id, name));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. full copies plus the gloss
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.outbox_messages_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fixed text[] := array['id', 'tenant_id', 'lead_id', 'contact_id', 'company_id', 'channel', 'language', 'category', 'source', 'request_sha256', 'created_by', 'created_at', 'policy_version', 'model_flagged', 'uncertain', 'keep_record'];
  k text;
begin
  if current_user = 'postgres' and app.erasure_running(new.tenant_id)
     and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ app.erasure_columns(tg_table_name) then
    return new;
  end if;
  foreach k in array v_fixed loop
    if to_jsonb(new) -> k is distinct from to_jsonb(old) -> k then
      raise exception 'outbox messages are immutable except for their state' using errcode = '42501';
    end if;
  end loop;
  if (new.body is distinct from old.body or new.gloss_en is distinct from old.gloss_en) and old.status <> 'needs_approval' then
    raise exception 'only a message waiting for approval can be edited' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'needs_approval' and new.status in ('queued', 'blocked'))
         or (old.status = 'queued' and new.status in ('sent', 'failed', 'blocked'))) then
      raise exception 'an outbox message cannot move from % to %', old.status, new.status using errcode = '42501';
    end if;
  elsif old.status in ('sent', 'failed', 'blocked') and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'a closed outbox message stays closed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop function app.outbox_submit_core(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean);
create function app.outbox_submit_core(
  p_actor uuid, p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false,
  p_media uuid[] default '{}', p_keep_record boolean default false, p_gloss_en text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now     timestamptz := app.outbox_now();
  v_text    text := btrim(coalesce(p_body, ''));
  v_lead    public.leads;
  v_contact public.contacts;
  v_sha     text;
  v_old     public.outbox_messages;
  v_hard    text;
  v_dec     jsonb;
  v_body    text;
  v_disc    text;
  v_added   boolean := false;
  v_status  text;
  v_reason  text;
  v_flags   text[];
  v_sched   timestamptz;
  m         public.outbox_messages;
  v_media   uuid[] := coalesce(p_media, '{}');
  v_n       integer;
  v_gloss   text := nullif(btrim(coalesce(p_gloss_en, '')), '');
begin
  if p_actor is null or p_tenant_id is null then
    perform app.outbox_error('deny');
  end if;
  if p_message_id is null or p_lead_id is null or p_channel is distinct from 'whatsapp' or char_length(v_text) not between 2 and 3000
     or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta')
     or p_category is null or p_category not in ('reply_to_inbound', 'info', 'visit', 'followup', 'order_status', 'other')
     or p_source is null or p_source not in ('assistant', 'owner', 'system')
     or p_model_flagged is null or p_uncertain is null or not app.text_is_clean(v_text) then
    perform app.outbox_error('invalid');
  end if;
  if v_gloss is not null and (char_length(v_gloss) not between 2 and 3000 or not app.text_is_clean(v_gloss)) then
    perform app.outbox_error('invalid');
  end if;
  if p_keep_record is null or cardinality(v_media) > 4 or (select count(distinct x) from unnest(v_media) x) <> cardinality(v_media) or exists (select 1 from unnest(v_media) x where x is null) then
    perform app.outbox_error('invalid');
  end if;

  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_channel, p_category, p_language, p_source, p_model_flagged, p_uncertain, v_text)
                                    || case when cardinality(v_media) > 0 then '|media:' || array_to_string(v_media, ',') else '' end
                                    || case when p_keep_record then '|keep' else '' end
                                    || case when v_gloss is not null then '|gloss:' || v_gloss else '' end, 'UTF8')), 'hex');

  -- a retry: the same words under the same id replay; other words conflict
  select * into v_old from public.outbox_messages x where x.id = p_message_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.request_sha256 <> v_sha then
      perform app.outbox_error('conflict');
    end if;
    return app.outbox_row_json(v_old, true);
  end if;

  select * into v_lead from public.leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if v_lead.archived_at is not null then
    perform app.outbox_error('invalid');
  end if;
  if cardinality(v_media) > 0 then
    select count(*) into v_n from public.catalogue_photos ph join public.catalogue_items it on it.tenant_id = ph.tenant_id and it.id = ph.item_id
     where ph.tenant_id = p_tenant_id and ph.id = any (v_media) and ph.removed_at is null and it.active;
    if v_n <> cardinality(v_media) then
      perform app.outbox_error('reference');
    end if;
  end if;
  if v_lead.contact_id is not null then
    -- serialise the messages of one customer: the daily count and "the first message" must not race
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || v_lead.contact_id::text, 0));
    select * into v_contact from public.contacts c where c.id = v_lead.contact_id and c.tenant_id = p_tenant_id;
  end if;

  v_body := v_text;
  if v_contact.id is not null then
    v_disc := app.outbox_disclosure(p_language);
    if not exists (select 1 from public.outbox_messages x where x.tenant_id = p_tenant_id and x.contact_id = v_contact.id and x.disclosure_added and x.status in ('queued', 'needs_approval', 'sent'))
       and position(v_disc in v_body) = 0 then
      v_body := v_body || E'\n\n' || v_disc;
      v_added := true;
    end if;
  end if;

  v_hard := case when v_contact.id is null then (case when app.outbox_switch_on() then 'no_contact' else 'switch_off' end)
                 else app.outbox_hard_block(p_tenant_id, v_contact, null, v_now) end;
  v_flags := app.outbox_content_flags(v_text);
  if v_hard is not null then
    v_status := 'blocked'; v_reason := v_hard; v_sched := null;
  else
    v_dec := app.outbox_decide_content(p_tenant_id, p_lead_id, v_text, p_category, p_model_flagged, p_uncertain, v_now);
    v_status := v_dec ->> 'status';
    v_reason := v_dec ->> 'reason';
    v_flags := array(select jsonb_array_elements_text(v_dec -> 'flags'));
    v_sched := nullif(v_dec ->> 'scheduled_for', '')::timestamptz;
  end if;

  insert into public.outbox_messages
    (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, flags, model_flagged, uncertain,
     disclosure_added, request_sha256, scheduled_for, created_by, created_at, keep_record, gloss_en)
  values
    (p_message_id, p_tenant_id, p_lead_id, v_contact.id, v_lead.company_id, p_channel, v_body, p_language, p_category, p_source, v_status, v_reason, v_flags,
     p_model_flagged, p_uncertain, v_added, v_sha, v_sched, p_actor, v_now, p_keep_record, v_gloss)
  returning * into m;
  insert into public.outbox_message_media (tenant_id, message_id, photo_id, position)
  select p_tenant_id, p_message_id, x.photo_id, x.n::smallint from unnest(v_media) with ordinality as x(photo_id, n);
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function app.outbox_submit_core(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean, text) from public, anon, authenticated, service_role;

drop function public.outbox_submit(uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean);
create function public.outbox_submit(
  p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false,
  p_media uuid[] default '{}', p_keep_record boolean default false, p_gloss_en text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  return app.outbox_submit_core(v_uid, p_message_id, p_tenant_id, p_lead_id, p_channel, p_body, p_language, p_category, p_source, p_model_flagged, p_uncertain, p_media, p_keep_record, p_gloss_en);
end;
$$;
revoke all on function public.outbox_submit(uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean, text) from public, anon;
grant execute on function public.outbox_submit(uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean, text) to authenticated;

drop function public.outbox_edit(uuid, uuid, text);
create function public.outbox_edit(p_tenant_id uuid, p_message_id uuid, p_body text, p_gloss_en text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_text text := btrim(coalesce(p_body, ''));
  v_gloss text := nullif(btrim(coalesce(p_gloss_en, '')), '');
  m      public.outbox_messages;
  v_disc text;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if char_length(v_text) not between 2 and 3000 or not app.text_is_clean(v_text)
     or (v_gloss is not null and (char_length(v_gloss) not between 2 and 3000 or not app.text_is_clean(v_gloss))) then
    perform app.outbox_error('invalid');
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status <> 'needs_approval' then
    perform app.outbox_error('state');
  end if;
  v_disc := app.outbox_disclosure(m.language);
  if m.disclosure_added and position(v_disc in v_text) = 0 then
    v_text := v_text || E'\n\n' || v_disc;
  end if;
  update public.outbox_messages
     set body = v_text, gloss_en = v_gloss, flags = app.outbox_content_flags(v_text), edited_by = v_uid, edited_at = now()
   where id = m.id
   returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.outbox_edit(uuid, uuid, text, text) from public, anon;
grant execute on function public.outbox_edit(uuid, uuid, text, text) to authenticated;

create or replace function app.erase_contact(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.contacts;
  v_counts jsonb := '{}'::jsonb;
  v_review jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_patterns text[];
  v_name text;
  v_phone_digits text;
  v_enq text;
  k suppression.contact_keys;
  v_keys_n bigint := 0;
  v_markers bigint := 0;
  v_unkeyed boolean;
  v_fields text;
  sw record;
  d record;
  n bigint;
begin
  select * into c from public.contacts where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if c.erased_at is not null then
    -- nothing identifying is left to search for
    return jsonb_build_object('counts', v_counts, 'review', v_review, 'review_truncated', false);
  end if;

  -- The last Owner cannot erase their own record: ownership is transferred first. An exception goes through the operator, after the
  -- person's identity was verified out of band, with a recorded reason (app.operator_add_owner_exception; docs/runbooks/sole-owner-erasure.md).
  -- The Owner's identity is their sign-in address; the comparison ignores case.
  if c.email is not null
     and (select count(*) from public.memberships m where m.tenant_id = r.tenant_id and m.role = 'owner') = 1
     and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                  where m.tenant_id = r.tenant_id and m.role = 'owner' and lower(u.email) = lower(c.email)) then
    perform app.erasure_state_error('SM305');
  end if;

  -- T010 / ADR 0020: the suppression keys are written BEFORE any identifier is removed, so a later import of the same address is recognised.
  -- A contact that holds an e-mail or a phone number with no recorded key is refused (SM221), UNLESS an Owner with aal2 marked this request
  -- "without a key" (allow_erasure_without_key): erasure itself is never blocked for good, and that step is audited and counted.
  select * into k from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id for update;
  v_unkeyed := (c.email is not null and k.email_hmac is null) or (c.phone is not null and k.phone_hmac is null);
  if v_unkeyed then
    if r.without_key_at is null then
      perform app.suppression_error('SM221');
    end if;
    v_counts := app.erasure_add(v_counts, 'suppression.erased_without_key', 1);
  end if;
  if c.email is not null and k.email_hmac is not null then
    -- the ERASED marker is appended even when the key is already suppressed by someone else (an opt-out): the erasure must survive that contact being lifted
    v_markers := v_markers + 1;
    if app.suppression_key_mark_erased(r.tenant_id, 'email', k.email_hmac, k.key_version, c.id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end if;
  if c.phone is not null and k.phone_hmac is not null then
    -- the ERASED marker is appended even when the key is already suppressed by someone else (an opt-out): the erasure must survive that contact being lifted
    v_markers := v_markers + 1;
    if app.suppression_key_mark_erased(r.tenant_id, 'phone', k.phone_hmac, k.key_version, c.id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end if;
  delete from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'suppression.keys_written', v_keys_n);
  v_counts := app.erasure_add(v_counts, 'suppression.erased_markers', v_markers);
  v_counts := app.erasure_add(v_counts, 'suppression.contact_keys', n);

  -- what identifies the person, taken BEFORE the row is anonymised
  v_patterns := array_remove(array[app.erasure_email_pattern(c.email), app.erasure_phone_pattern(c.phone)], null);
  v_name := app.erasure_name(c.full_name);
  v_phone_digits := nullif(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), '');

  v_counts := app.erasure_add(v_counts, 'contacts.full_name', app.erase_column(r.tenant_id, 'contact', 'contacts', 'full_name', format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.email',     app.erase_column(r.tenant_id, 'contact', 'contacts', 'email',     format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.phone',     app.erase_column(r.tenant_id, 'contact', 'contacts', 'phone',     format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.job_title', app.erase_column(r.tenant_id, 'contact', 'contacts', 'job_title', format('t.id = %L', c.id)));
  update public.contacts set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = c.id;

  -- the consent ledger is KEPT (event, channel, basis, type, time); only its reference is anonymised
  v_counts := app.erasure_add(v_counts, 'consent_events.evidence_ref', app.erase_column(r.tenant_id, 'contact', 'consent_events', 'evidence_ref', format('t.contact_id = %L', c.id)));
  -- what was written about this person in the leads and opportunities linked to them
  v_counts := app.erasure_add(v_counts, 'leads.source',               app.erase_column(r.tenant_id, 'contact', 'leads', 'source',               format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason',  app.erase_column(r.tenant_id, 'contact', 'leads', 'disqualified_reason',  format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',        app.erase_column(r.tenant_id, 'contact', 'opportunities', 'title',        format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason',  app.erase_column(r.tenant_id, 'contact', 'opportunities', 'lost_reason',  format('t.contact_id = %L', c.id)));

  -- T008: the enquiries captured on this person's leads (or from them), and what was extracted from them
  v_enq := format('(%1$s.contact_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.contact_id = %2$L))', 't', c.id);
  v_fields := format('t.requirement_id in (select q.id from public.requirements q join public.enquiries e on e.tenant_id = q.tenant_id and e.id = q.enquiry_id where q.tenant_id = t.tenant_id and %s)',
                     format('(%1$s.contact_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.contact_id = %2$L))', 'e', c.id));
  v_counts := app.erasure_add(v_counts, 'enquiries.subject',          app.erase_column(r.tenant_id, 'contact', 'enquiries', 'subject', v_enq));
  v_counts := app.erasure_add(v_counts, 'enquiries.body',             app.erase_column(r.tenant_id, 'contact', 'enquiries', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.quote',      app.erase_column(r.tenant_id, 'contact', 'requirement_fields', 'quote', v_fields));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.value_text', app.erase_column(r.tenant_id, 'contact', 'requirement_fields', 'value_text', v_fields));

  -- job AT: the messages written to this person (and the call requests about them) are tombstoned outright, not left to the name review
  v_counts := app.erasure_add(v_counts, 'outbox_messages.body',      app.erase_column(r.tenant_id, 'contact', 'outbox_messages', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'outbox_messages.gloss_en',  app.erase_column(r.tenant_id, 'contact', 'outbox_messages', 'gloss_en', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.reason',        app.erase_column(r.tenant_id, 'contact', 'call_requests', 'reason', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.script_draft',  app.erase_column(r.tenant_id, 'contact', 'call_requests', 'script_draft', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.decision_note', app.erase_column(r.tenant_id, 'contact', 'call_requests', 'decision_note', v_enq));

  -- job AS: the store visits of this person's leads (what the visit was for, the note, why it was cancelled)
  v_counts := app.erasure_add(v_counts, 'store_visits.purpose', app.erase_column(r.tenant_id, 'contact', 'store_visits', 'purpose', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.note', app.erase_column(r.tenant_id, 'contact', 'store_visits', 'note', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.cancel_reason', app.erase_column(r.tenant_id, 'contact', 'store_visits', 'cancel_reason', v_enq));

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  v_review := sw.o_review;
  v_truncated := sw.o_truncated;

  -- another contact that carries the same e-mail or number is the same person in a structured column: listed for the Owner
  for d in
    select o.id, (lower(o.email) = lower(c.email)) as same_email
      from public.contacts o
     where o.tenant_id = r.tenant_id and o.id <> c.id and o.erased_at is null
       and ((c.email is not null and lower(o.email) = lower(c.email))
         or (v_phone_digits is not null and regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') = v_phone_digits))
     order by o.id
  loop
    v_review := v_review || jsonb_build_array(jsonb_build_object('table', 'contacts', 'column', case when d.same_email then 'email' else 'phone' end, 'id', d.id));
  end loop;

  return jsonb_build_object('counts', v_counts, 'review', v_review, 'review_truncated', v_truncated);
end;
$$;

create or replace function app.erase_company(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  co public.companies;
  v_counts jsonb := '{}'::jsonb;
  v_patterns text[];
  v_name text;
  v_leads text;
  v_claims text;
  v_evidence text;
  v_enq text;
  v_fields text;
  v_keys constant text[] := array['name', 'website', 'city', 'region'];
  sw record;
  d record;
  n bigint;
begin
  select * into co from public.companies where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if co.erased_at is not null then
    return jsonb_build_object('counts', v_counts, 'review', '[]'::jsonb, 'review_truncated', false);
  end if;

  v_patterns := array_remove(array[app.erasure_host_pattern(co.website)], null);
  v_name := app.erasure_name(co.name);

  -- row selectors, over the alias t of the table being changed
  v_leads := format('t.company_id = %L', co.id);
  v_claims := format('(t.company_id = %1$L or t.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L))', co.id);
  v_evidence := format($f$t.id in (select k.evidence_id from public.evidence_links k where k.tenant_id = t.tenant_id and (
      k.company_id = %1$L
      or k.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)
      or k.claim_id in (select c.id from public.claims c where c.tenant_id = t.tenant_id and (
           c.company_id = %1$L or c.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)))))$f$, co.id);

  v_counts := app.erasure_add(v_counts, 'evidence.url',       app.erase_column(r.tenant_id, 'company', 'evidence', 'url',       v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.reference', app.erase_column(r.tenant_id, 'company', 'evidence', 'reference', v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.snippet',   app.erase_column(r.tenant_id, 'company', 'evidence', 'snippet',   v_evidence));
  v_counts := app.erasure_add(v_counts, 'claims.value',       app.erase_column(r.tenant_id, 'company', 'claims', 'value',       v_claims));
  v_counts := app.erasure_add(v_counts, 'leads.source',              app.erase_column(r.tenant_id, 'company', 'leads', 'source',              v_leads));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason', app.erase_column(r.tenant_id, 'company', 'leads', 'disqualified_reason', v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',       app.erase_column(r.tenant_id, 'company', 'opportunities', 'title',       v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason', app.erase_column(r.tenant_id, 'company', 'opportunities', 'lost_reason', v_leads));

  -- T008: the enquiries of this company's leads, and what was extracted from them
  v_enq := format('(%1$s.company_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.company_id = %2$L))', 't', co.id);
  v_fields := format('t.requirement_id in (select q.id from public.requirements q join public.enquiries e on e.tenant_id = q.tenant_id and e.id = q.enquiry_id where q.tenant_id = t.tenant_id and %s)',
                     format('(%1$s.company_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.company_id = %2$L))', 'e', co.id));
  v_counts := app.erasure_add(v_counts, 'enquiries.subject',          app.erase_column(r.tenant_id, 'company', 'enquiries', 'subject', v_enq));
  v_counts := app.erasure_add(v_counts, 'enquiries.body',             app.erase_column(r.tenant_id, 'company', 'enquiries', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.quote',      app.erase_column(r.tenant_id, 'company', 'requirement_fields', 'quote', v_fields));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.value_text', app.erase_column(r.tenant_id, 'company', 'requirement_fields', 'value_text', v_fields));

  -- job AT: the messages written to this company's leads, and the call requests about them
  v_counts := app.erasure_add(v_counts, 'outbox_messages.body',      app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'outbox_messages.gloss_en',  app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'gloss_en', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.reason',        app.erase_column(r.tenant_id, 'company', 'call_requests', 'reason', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.script_draft',  app.erase_column(r.tenant_id, 'company', 'call_requests', 'script_draft', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.decision_note', app.erase_column(r.tenant_id, 'company', 'call_requests', 'decision_note', v_enq));

  -- job AS: the store visits of this person's leads (what the visit was for, the note, why it was cancelled)
  v_counts := app.erasure_add(v_counts, 'store_visits.purpose', app.erase_column(r.tenant_id, 'company', 'store_visits', 'purpose', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.note', app.erase_column(r.tenant_id, 'company', 'store_visits', 'note', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.cancel_reason', app.erase_column(r.tenant_id, 'company', 'store_visits', 'cancel_reason', v_enq));

  v_counts := app.erasure_add(v_counts, 'companies.name',    app.erase_column(r.tenant_id, 'company', 'companies', 'name',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.website', app.erase_column(r.tenant_id, 'company', 'companies', 'website', format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.city',    app.erase_column(r.tenant_id, 'company', 'companies', 'city',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.region',  app.erase_column(r.tenant_id, 'company', 'companies', 'region',  format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.tags',    app.erase_column(r.tenant_id, 'company', 'companies', 'tags',    format('t.id = %L', co.id)));
  update public.companies set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = co.id;

  -- audit rows written before the four identity columns were classified PII carry their values: remove those KEYS (nothing else)
  update public.audit_events a
     set old_values = a.old_values - v_keys, new_values = a.new_values - v_keys
   where a.tenant_id = r.tenant_id and a.entity_type = 'company' and a.entity_id = co.id
     and (a.old_values ?| v_keys or a.new_values ?| v_keys);
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'audit_events.values', n);

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  return jsonb_build_object('counts', v_counts, 'review', sw.o_review, 'review_truncated', sw.o_truncated);
end;
$$;
