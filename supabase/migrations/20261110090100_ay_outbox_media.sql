-- Job AY (ADR 0069), the outbox part. A new migration; earlier files are not edited. Four changes to the outbox and the scheduler, all behind functions that already exist:
--
--   1. MEDIA. A message may carry 1 to 4 catalogue photos: `outbox_message_media` holds REFERENCES to `catalogue_photos` (never bytes). The policy is unchanged: the caption decides (a price band or an amount is
--      money, so the message waits for a person; photos without a price go by themselves only when automatic sending is on). A claim hands the channel the photos' bucket / path / type; the local fake adapter
--      records them.
--   2. KEEP A RECORD. `keep_record` on a message makes the database log the lead touch at the moment the message is really SENT (by outbox_mark), never when it is queued and never for a message that is blocked
--      or fails. If the touch cannot be written (the cap, a concurrent change) the send still stands: a touch is bookkeeping and must never make a delivered message look undelivered.
--   3. APPROVED = SEND (owner decision on job AW). A message the Owner approved is released by the scheduler even when the business's automatic sending is OFF, as long as the global switch is on. Quiet hours, STOP,
--      opt-in, erasure, the suppression key and the daily limit are still checked at send time (the claim is the same code). Automatic sending off still means nothing goes WITHOUT an approval: the worker
--      claims only `owner_approved` messages for such a business.
--   4. The cores are replaced as full copies of the job AW ones plus the lines above (test_migration_copies.py pins that).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. columns and the media table
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.outbox_messages add column keep_record boolean not null default false;
comment on column public.outbox_messages.keep_record is 'SAFE: a flag. CLEAN-EXEMPT: boolean';

create table public.outbox_message_media (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  message_id uuid not null,
  photo_id   uuid not null,
  position   smallint not null check (position between 1 and 4),
  created_at timestamptz not null default now(),
  unique (tenant_id, message_id, position),
  unique (tenant_id, message_id, photo_id),
  foreign key (tenant_id, message_id) references public.outbox_messages (tenant_id, id),
  foreign key (tenant_id, photo_id) references public.catalogue_photos (tenant_id, id)
);
create index outbox_message_media_photo_idx on public.outbox_message_media (tenant_id, photo_id);
create function app.outbox_message_media_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the photos of a message are never changed' using errcode = '42501';
end;
$$;
revoke all on function app.outbox_message_media_guard() from public;
create trigger outbox_message_media_forbid_tenant_id_change before update on public.outbox_message_media for each row execute function app.forbid_tenant_id_change();
create trigger outbox_message_media_no_update before update on public.outbox_message_media for each row execute function app.outbox_message_media_guard();
create trigger outbox_message_media_no_delete before delete on public.outbox_message_media for each row execute function app.outbox_message_media_guard();
create trigger outbox_message_media_no_truncate before truncate on public.outbox_message_media for each statement execute function app.outbox_message_media_guard();
create trigger audit_outbox_message_media after insert or update or delete on public.outbox_message_media for each row execute function app.audit_row_change('outbox_message_media');
alter table public.outbox_message_media enable row level security;
alter table public.outbox_message_media force row level security;
revoke all on public.outbox_message_media from public, anon, authenticated;
grant select on public.outbox_message_media to authenticated;
create policy outbox_message_media_select on public.outbox_message_media for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the lead touch of a sent message (called by outbox_mark_core only)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outbox_record_touch(m public.outbox_messages) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id    uuid := md5('outbox-touch:' || m.id::text)::uuid;
  v_out   integer;
begin
  -- idempotent: the same message never makes two touches; a message with no lead contact still makes the touch (the contact may be null on the lead)
  if exists (select 1 from public.lead_touches t where t.id = v_id) then
    return;
  end if;
  begin
    insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_by)
    values (v_id, m.tenant_id, m.lead_id, m.contact_id, 'out', 'whatsapp', m.sent_at, m.created_by);
    select count(*) into v_out from public.lead_touches t where t.tenant_id = m.tenant_id and t.lead_id = m.lead_id and t.direction = 'out';
    update public.followup_drafts d set status = 'discarded', discarded_at = now(), discarded_by = m.created_by, discard_code = 'superseded'
     where d.tenant_id = m.tenant_id and d.lead_id = m.lead_id and d.status in ('draft', 'approved') and d.touch_number <= v_out;
  exception when others then
    -- bookkeeping must never undo a delivery
    null;
  end;
end;
$$;
revoke all on function app.outbox_record_touch(public.outbox_messages) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the guard learns that keep_record is fixed (a full copy of the job AT definition plus one word)
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
  if new.body is distinct from old.body and old.status <> 'needs_approval' then
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

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the cores and the people's functions
-- ---------------------------------------------------------------------------------------------------------------------------------
drop function app.outbox_submit_core(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean, boolean);
create function app.outbox_submit_core(
  p_actor uuid, p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false,
  p_media uuid[] default '{}', p_keep_record boolean default false
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
  if p_keep_record is null or cardinality(v_media) > 4 or (select count(distinct x) from unnest(v_media) x) <> cardinality(v_media) or exists (select 1 from unnest(v_media) x where x is null) then
    perform app.outbox_error('invalid');
  end if;

  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_channel, p_category, p_language, p_source, p_model_flagged, p_uncertain, v_text)
                                    || case when cardinality(v_media) > 0 then '|media:' || array_to_string(v_media, ',') else '' end
                                    || case when p_keep_record then '|keep' else '' end, 'UTF8')), 'hex');

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
     disclosure_added, request_sha256, scheduled_for, created_by, created_at, keep_record)
  values
    (p_message_id, p_tenant_id, p_lead_id, v_contact.id, v_lead.company_id, p_channel, v_body, p_language, p_category, p_source, v_status, v_reason, v_flags,
     p_model_flagged, p_uncertain, v_added, v_sha, v_sched, p_actor, v_now, p_keep_record)
  returning * into m;
  insert into public.outbox_message_media (tenant_id, message_id, photo_id, position)
  select p_tenant_id, p_message_id, x.photo_id, x.n::smallint from unnest(v_media) with ordinality as x(photo_id, n);
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function app.outbox_submit_core(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean) from public, anon, authenticated, service_role;

drop function public.outbox_submit(uuid, uuid, uuid, text, text, text, text, text, boolean, boolean);
create function public.outbox_submit(
  p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false,
  p_media uuid[] default '{}', p_keep_record boolean default false
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
  return app.outbox_submit_core(v_uid, p_message_id, p_tenant_id, p_lead_id, p_channel, p_body, p_language, p_category, p_source, p_model_flagged, p_uncertain, p_media, p_keep_record);
end;
$$;
revoke all on function public.outbox_submit(uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean) from public, anon;
grant execute on function public.outbox_submit(uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean) to authenticated;

drop function app.outbox_claim_due_core(uuid, integer);
create function app.outbox_claim_due_core(p_tenant_id uuid, p_limit integer, p_approved_only boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now  timestamptz := app.outbox_now();
  v_out  jsonb := '[]'::jsonb;
  r      public.outbox_messages;
  c      public.contacts;
  v_hard text;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_approved_only is null then
    perform app.outbox_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  for r in
    select * from public.outbox_messages x
     where x.tenant_id = p_tenant_id and x.status = 'queued' and (x.scheduled_for is null or x.scheduled_for <= v_now)
       and (not p_approved_only or x.reason = 'owner_approved')
       and (x.claimed_at is null or x.claimed_at < v_now - interval '2 minutes')
     order by x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    if app.outbox_in_quiet_hours(v_now) then
      update public.outbox_messages set scheduled_for = app.outbox_next_open(v_now) where id = r.id;
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || coalesce(r.contact_id::text, r.id::text), 0));
    select * into c from public.contacts x where x.id = r.contact_id and x.tenant_id = p_tenant_id;
    v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, r.id, v_now) end;
    if v_hard is not null then
      update public.outbox_messages set status = 'blocked', reason = v_hard, scheduled_for = null where id = r.id;
      continue;
    end if;
    update public.outbox_messages set claimed_at = v_now, attempts = attempts + 1 where id = r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language,
      'media', coalesce((select jsonb_agg(jsonb_build_object('photo_id', ph.id, 'bucket', ph.bucket, 'path', ph.path, 'content_type', ph.content_type) order by md.position)
                           from public.outbox_message_media md join public.catalogue_photos ph on ph.tenant_id = md.tenant_id and ph.id = md.photo_id and ph.removed_at is null
                          where md.tenant_id = r.tenant_id and md.message_id = r.id), '[]'::jsonb)));
  end loop;
  return v_out;
end;
$$;
revoke all on function app.outbox_claim_due_core(uuid, integer, boolean) from public, anon, authenticated, service_role;

create or replace function public.outbox_claim_due(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  return app.outbox_claim_due_core(p_tenant_id, p_limit, false);
end;
$$;

create or replace function app.outbox_mark_core(
  p_tenant_id uuid, p_message_id uuid, p_outcome text, p_adapter text, p_adapter_message_id text default null, p_failure_code text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m     public.outbox_messages;
begin
  if p_tenant_id is null or p_message_id is null then
    perform app.outbox_error('deny');
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'failed') or p_adapter is distinct from 'fake'
     or (p_outcome = 'sent' and (p_adapter_message_id is null or char_length(p_adapter_message_id) not between 1 and 100))
     or (p_outcome = 'failed' and (p_failure_code is null or p_failure_code not in ('adapter_error', 'timeout', 'rejected'))) then
    perform app.outbox_error('invalid');
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status = p_outcome then
    return app.outbox_row_json(m, true);
  end if;
  if m.status <> 'queued' or m.claimed_at is null then
    perform app.outbox_error('state');
  end if;
  if p_outcome = 'sent' then
    update public.outbox_messages set status = 'sent', sent_at = app.outbox_now(), adapter = p_adapter, adapter_message_id = p_adapter_message_id where id = m.id returning * into m;
    if m.keep_record then
      perform app.outbox_record_touch(m);
    end if;
  else
    update public.outbox_messages set status = 'failed', reason = 'send_failed', failure_code = p_failure_code where id = m.id returning * into m;
  end if;
  return app.outbox_row_json(m, false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. the scheduler: approved messages are released whatever the business's automatic sending says
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.scheduler_tenants() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if not app.outbox_switch_on() then
    return '[]'::jsonb;
  end if;
  -- a business that switched automatic sending on, and a business with a message its Owner APPROVED that waits to be released (approval is the Owner's consent to send)
  return coalesce((select jsonb_agg(z.tenant_id order by z.tenant_id)
                     from (select s.tenant_id from public.outbox_settings s where s.auto_send_enabled
                           union
                           select m.tenant_id from public.outbox_messages m where m.status = 'queued' and m.reason = 'owner_approved') z), '[]'::jsonb);
end;
$$;

create or replace function public.scheduler_claim_due(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() or p_tenant_id is null then
    perform app.scheduler_error('deny');
  end if;
  if not app.outbox_switch_on() then
    return '[]'::jsonb;
  end if;
  -- automatic sending ON: everything that is due. OFF: only what the Owner approved (nothing goes without approval, and an approval is consent to send).
  return app.outbox_claim_due_core(p_tenant_id, p_limit, not app.scheduler_tenant_on(p_tenant_id));
end;
$$;

create or replace function public.scheduler_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := app.outbox_now();
  v_today  date := (v_now at time zone 'Asia/Kolkata')::date;
  h        scheduler.heartbeat;
  v_seen   boolean;
  v_auto   boolean;
  v_last   timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.scheduler_error('deny');
  end if;
  select * into h from scheduler.heartbeat x where x.id = 1;
  v_seen := found and h.last_tick_at > v_now - make_interval(secs => h.interval_seconds * 3);
  v_auto := coalesce((select s.auto_send_enabled from public.outbox_settings s where s.tenant_id = p_tenant_id), false);
  select max(r.run_at) into v_last from public.scheduler_runs r where r.tenant_id = p_tenant_id;
  return jsonb_build_object(
    'platform_switch_on', app.outbox_switch_on(),
    'auto_send_enabled', v_auto,
    -- the worker acts for this business now: both switches are on
    'active', app.outbox_switch_on() and v_auto,
    -- messages the Owner approved are released while the global switch is on, whatever the business's automatic sending says
    'releases_approved', app.outbox_switch_on(),
    'worker_running', coalesce(v_seen, false),
    'last_run_at', h.last_tick_at,
    'interval_seconds', h.interval_seconds,
    'next_run_at', case when v_seen then h.last_tick_at + make_interval(secs => h.interval_seconds) else null end,
    'last_activity_at', v_last,
    'today', (select jsonb_build_object('sent', coalesce(sum(r.sent), 0), 'failed', coalesce(sum(r.failed), 0), 'reminders', coalesce(sum(r.reminders), 0),
                                        'no_shows', coalesce(sum(r.no_shows), 0), 'errors', coalesce(sum(r.errors), 0))
                from public.scheduler_runs r where r.tenant_id = p_tenant_id and (r.run_at at time zone 'Asia/Kolkata')::date = v_today));
end;
$$;
