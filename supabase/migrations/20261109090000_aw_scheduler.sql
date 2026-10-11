-- Job AW (ADR 0068): the SCHEDULER. A small worker that, every minute, (a) releases outbox messages that were held (quiet hours until 09:00 India time, owner-approved messages waiting for the
-- morning), (b) queues visit reminders (the evening before, a few hours before) through the outbox, and (c) can mark a confirmed visit "no show" some minutes after its slot ended (off by default).
-- A new migration; the earlier files are not edited. Three outbox functions are replaced (section 2): their code moves into core functions, the old names keep their signature, checks and answers.
--
-- WHO THE WORKER IS. The API has no service-role key and acts only with a caller's token; a background worker has no caller. Instead of a standing key it gets a PRINCIPAL the database knows:
--   * an ordinary sign-in account (no workspace, no membership, so row-level security shows it NOTHING) that the OPERATOR registers (app.operator_register_scheduler, run in the database, never
--     through the API). Its password lives in the worker's environment only.
--   * its only power is EXECUTE on the public.scheduler_* functions below. Each one starts with app.is_scheduler() and otherwise answers 42501. Nothing else changes for it: it cannot read a table,
--     cannot call the people's functions (they check a workspace role), and cannot be given a membership (a trigger refuses it).
--   * every function re-checks the two switches itself: the GLOBAL outbox switch and the business's own "automatic sending" (default off). A business that has not switched automatic sending on is
--     invisible to the worker (scheduler_tenants lists it not, and the work functions answer "nothing" for it), whatever the worker's code says.
--
-- WHAT IT DOES NOT DO. It decides nothing about content: every message it queues passes the same policy as a person's (hard blocks, money / commitment / complaint, uncertain, the daily limit, quiet
-- hours), and a release re-checks the hard blocks (a STOP after the message was queued still stops it) exactly as the "dispatch now" button does. Only the local fake channel exists.
--
-- TIME. Every decision reads app.outbox_now() (the AT seam; now() in production), India time. Nothing here has its own clock.
--
-- SQLSTATEs: 42501 deny (also: not the scheduler principal), 22023 invalid, 23503 unknown reference, plus the outbox's own (SM501 state, ...).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the principal
-- ---------------------------------------------------------------------------------------------------------------------------------
-- a private schema for the worker's own bookkeeping: tables here are not part of the API and no client role can see them
create schema scheduler;
revoke all on schema scheduler from public, anon, authenticated, service_role;

create table scheduler.principals (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  registered_at timestamptz not null default now()
);
alter table scheduler.principals enable row level security;
alter table scheduler.principals force row level security;
revoke all on scheduler.principals from public, anon, authenticated, service_role;
comment on table scheduler.principals is 'The sign-in accounts that may call the scheduler functions. Written only by app.operator_register_scheduler (the operator, in the database).';

create function app.is_scheduler() returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select auth.uid() is not null and exists (select 1 from scheduler.principals p where p.user_id = auth.uid()) $$;
revoke all on function app.is_scheduler() from public, anon, authenticated, service_role;

create function app.scheduler_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.scheduler_error(text) from public;

-- Register (or remove) the worker's account. Operator only: refuses any session that carries a request identity, and no client role may execute it. The account must already exist (sign-up) and
-- belong to no workspace.
create function app.operator_register_scheduler(p_email text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_id is null then
    raise exception 'no such account' using errcode = '23503';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_id) then
    raise exception 'the scheduler account belongs to no workspace' using errcode = '42501';
  end if;
  insert into scheduler.principals (user_id) values (v_id) on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function app.operator_register_scheduler(text) from public, anon, authenticated, service_role;

create function app.operator_remove_scheduler(p_email text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  delete from scheduler.principals p using auth.users u where u.id = p.user_id and lower(u.email) = lower(btrim(coalesce(p_email, '')));
end;
$$;
revoke all on function app.operator_remove_scheduler(text) from public, anon, authenticated, service_role;

-- a worker account is never also a person of a workspace (the audit would not say who acted)
create function app.memberships_refuse_scheduler() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from scheduler.principals p where p.user_id = new.user_id) then
    raise exception 'the scheduler account cannot join a workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.memberships_refuse_scheduler() from public;
create trigger memberships_refuse_scheduler before insert or update of user_id on public.memberships for each row execute function app.memberships_refuse_scheduler();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the outbox's three steps move into core functions that take no role decision: the wrappers (the people's functions, same signature, same checks, same answers) and the scheduler's
--    functions (section 6) call the SAME code. Bodies are the AT clock migration's, line for line, minus the role check (a test pins that).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outbox_submit_core(
  p_actor uuid, p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false
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

  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_channel, p_category, p_language, p_source, p_model_flagged, p_uncertain, v_text), 'UTF8')), 'hex');

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
     disclosure_added, request_sha256, scheduled_for, created_by, created_at)
  values
    (p_message_id, p_tenant_id, p_lead_id, v_contact.id, v_lead.company_id, p_channel, v_body, p_language, p_category, p_source, v_status, v_reason, v_flags,
     p_model_flagged, p_uncertain, v_added, v_sha, v_sched, p_actor, v_now)
  returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function app.outbox_submit_core(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean, boolean) from public, anon, authenticated, service_role;

create function app.outbox_claim_due_core(p_tenant_id uuid, p_limit integer) returns jsonb
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
  if p_limit is null or p_limit not between 1 and 50 then
    perform app.outbox_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  for r in
    select * from public.outbox_messages x
     where x.tenant_id = p_tenant_id and x.status = 'queued' and (x.scheduled_for is null or x.scheduled_for <= v_now)
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
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language));
  end loop;
  return v_out;
end;
$$;
revoke all on function app.outbox_claim_due_core(uuid, integer) from public, anon, authenticated, service_role;

create function app.outbox_mark_core(
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
  else
    update public.outbox_messages set status = 'failed', reason = 'send_failed', failure_code = p_failure_code where id = m.id returning * into m;
  end if;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function app.outbox_mark_core(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- the people's functions: the same signature, the same role check, the same answers; the work is the core's
create or replace function public.outbox_submit(
  p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false
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
  return app.outbox_submit_core(v_uid, p_message_id, p_tenant_id, p_lead_id, p_channel, p_body, p_language, p_category, p_source, p_model_flagged, p_uncertain);
end;
$$;

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
  return app.outbox_claim_due_core(p_tenant_id, p_limit);
end;
$$;

create or replace function public.outbox_mark(
  p_tenant_id uuid, p_message_id uuid, p_outcome text, p_adapter text, p_adapter_message_id text default null, p_failure_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  return app.outbox_mark_core(p_tenant_id, p_message_id, p_outcome, p_adapter, p_adapter_message_id, p_failure_code);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the business's scheduler settings (Owner, with a second factor; Owner and Admin read)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.scheduler_forbid_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'scheduler rows are never deleted' using errcode = '42501';
end;
$$;
revoke all on function app.scheduler_forbid_delete() from public;

create table public.scheduler_settings (
  tenant_id                 uuid primary key references public.tenants (id) on delete restrict,
  -- the evening before the visit, from this hour (India time) until 21:00; one message per visit and time
  reminder_evening_enabled  boolean not null default true,
  reminder_evening_hour     smallint not null default 18 check (reminder_evening_hour between 9 and 20),
  -- some minutes before the visit (never in quiet hours, never closer than 30 minutes)
  reminder_heads_up_enabled boolean not null default true,
  reminder_heads_up_minutes smallint not null default 120 check (reminder_heads_up_minutes between 60 and 480),
  -- mark a CONFIRMED visit "no show" this many minutes after its slot ended. Off by default.
  no_show_enabled           boolean not null default false,
  no_show_after_minutes     smallint not null default 30 check (no_show_after_minutes between 5 and 720),
  updated_by                uuid,
  updated_at                timestamptz not null default now()
);
comment on column public.scheduler_settings.updated_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';
create trigger scheduler_settings_forbid_tenant_id_change before update on public.scheduler_settings for each row execute function app.forbid_tenant_id_change();
create trigger audit_scheduler_settings after insert or update or delete on public.scheduler_settings for each row execute function app.audit_row_change('scheduler_settings');
create trigger scheduler_settings_no_delete before delete on public.scheduler_settings for each row execute function app.scheduler_forbid_delete();
create trigger scheduler_settings_no_truncate before truncate on public.scheduler_settings for each statement execute function app.scheduler_forbid_delete();

-- one idempotency record per reminder: a visit gets at most one reminder of each kind for each start time (a visit that moves is a new appointment and may be reminded again)
create table public.visit_reminders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  visit_id      uuid not null,
  kind          text not null check (kind in ('evening_before', 'heads_up')),
  for_starts_at timestamptz not null,
  message_id    uuid not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, visit_id, kind, for_starts_at),
  foreign key (tenant_id, visit_id) references public.store_visits (tenant_id, id),
  foreign key (tenant_id, message_id) references public.outbox_messages (tenant_id, id)
);
create index visit_reminders_message_idx on public.visit_reminders (tenant_id, message_id);
comment on column public.visit_reminders.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create function app.visit_reminders_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a reminder record is never changed' using errcode = '42501';
end;
$$;
revoke all on function app.visit_reminders_guard_update() from public;
create trigger visit_reminders_forbid_tenant_id_change before update on public.visit_reminders for each row execute function app.forbid_tenant_id_change();
create trigger visit_reminders_guard_update before update on public.visit_reminders for each row execute function app.visit_reminders_guard_update();
create trigger audit_visit_reminders after insert or update or delete on public.visit_reminders for each row execute function app.audit_row_change('visit_reminder');
create trigger visit_reminders_no_delete before delete on public.visit_reminders for each row execute function app.scheduler_forbid_delete();
create trigger visit_reminders_no_truncate before truncate on public.visit_reminders for each statement execute function app.scheduler_forbid_delete();

-- the log of what the worker did for a business: one row per eventful tick (counts only: no text, no phone, no name). An idle tick writes none; the heartbeat below says the worker is alive.
create table public.scheduler_runs (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  run_at    timestamptz not null,
  sent      integer not null default 0 check (sent between 0 and 100000),
  failed    integer not null default 0 check (failed between 0 and 100000),
  reminders integer not null default 0 check (reminders between 0 and 100000),
  no_shows  integer not null default 0 check (no_shows between 0 and 100000),
  errors    integer not null default 0 check (errors between 0 and 100000)
);
create index scheduler_runs_tenant_idx on public.scheduler_runs (tenant_id, run_at);
create function app.scheduler_runs_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a run record is never changed' using errcode = '42501';
end;
$$;
revoke all on function app.scheduler_runs_guard_update() from public;
create trigger scheduler_runs_forbid_tenant_id_change before update on public.scheduler_runs for each row execute function app.forbid_tenant_id_change();
create trigger scheduler_runs_guard_update before update on public.scheduler_runs for each row execute function app.scheduler_runs_guard_update();
create trigger audit_scheduler_runs after insert or update or delete on public.scheduler_runs for each row execute function app.audit_row_change('scheduler_run');
create trigger scheduler_runs_no_delete before delete on public.scheduler_runs for each row execute function app.scheduler_forbid_delete();
create trigger scheduler_runs_no_truncate before truncate on public.scheduler_runs for each statement execute function app.scheduler_forbid_delete();

-- liveness of the worker, one row for the whole installation (not a workspace's data)
create table scheduler.heartbeat (
  id               smallint primary key check (id = 1),
  last_tick_at     timestamptz not null,
  interval_seconds integer not null check (interval_seconds between 5 and 3600),
  ticks            bigint not null default 0,
  last_errors      integer not null default 0
);
alter table scheduler.heartbeat enable row level security;
alter table scheduler.heartbeat force row level security;
revoke all on scheduler.heartbeat from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['scheduler_settings', 'visit_reminders', 'scheduler_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy scheduler_settings_select on public.scheduler_settings for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create policy visit_reminders_select on public.visit_reminders for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create policy scheduler_runs_select on public.scheduler_runs for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));

create function app.scheduler_settings_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'reminder_evening_enabled', coalesce(s.reminder_evening_enabled, true),
    'reminder_evening_hour', coalesce(s.reminder_evening_hour, 18),
    'reminder_heads_up_enabled', coalesce(s.reminder_heads_up_enabled, true),
    'reminder_heads_up_minutes', coalesce(s.reminder_heads_up_minutes, 120),
    'no_show_enabled', coalesce(s.no_show_enabled, false),
    'no_show_after_minutes', coalesce(s.no_show_after_minutes, 30),
    'is_default', s.tenant_id is null)
  from (select 1) one left join public.scheduler_settings s on s.tenant_id = p_tenant
$$;
revoke all on function app.scheduler_settings_json(uuid) from public;

create function public.scheduler_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.scheduler_error('deny');
  end if;
  return app.scheduler_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.scheduler_settings_get(uuid) from public, anon;
grant execute on function public.scheduler_settings_get(uuid) to authenticated;

create function public.scheduler_settings_set(
  p_tenant_id uuid, p_evening_enabled boolean, p_evening_hour integer, p_heads_up_enabled boolean, p_heads_up_minutes integer, p_no_show_enabled boolean, p_no_show_after_minutes integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.scheduler_error('deny');
  end if;
  perform app.require_aal2();
  if p_evening_enabled is null or p_heads_up_enabled is null or p_no_show_enabled is null
     or p_evening_hour is null or p_evening_hour not between 9 and 20
     or p_heads_up_minutes is null or p_heads_up_minutes not between 60 and 480
     or p_no_show_after_minutes is null or p_no_show_after_minutes not between 5 and 720 then
    perform app.scheduler_error('invalid');
  end if;
  insert into public.scheduler_settings (tenant_id, reminder_evening_enabled, reminder_evening_hour, reminder_heads_up_enabled, reminder_heads_up_minutes, no_show_enabled, no_show_after_minutes, updated_by, updated_at)
  values (p_tenant_id, p_evening_enabled, p_evening_hour, p_heads_up_enabled, p_heads_up_minutes, p_no_show_enabled, p_no_show_after_minutes, v_uid, app.outbox_now())
  on conflict (tenant_id) do update
     set reminder_evening_enabled = excluded.reminder_evening_enabled, reminder_evening_hour = excluded.reminder_evening_hour,
         reminder_heads_up_enabled = excluded.reminder_heads_up_enabled, reminder_heads_up_minutes = excluded.reminder_heads_up_minutes,
         no_show_enabled = excluded.no_show_enabled, no_show_after_minutes = excluded.no_show_after_minutes, updated_by = v_uid, updated_at = app.outbox_now();
  return app.scheduler_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.scheduler_settings_set(uuid, boolean, integer, boolean, integer, boolean, integer) from public, anon;
grant execute on function public.scheduler_settings_set(uuid, boolean, integer, boolean, integer, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the rules (pure helpers, India time)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- may the worker act for this business now? Both switches: the global outbox switch AND the business's automatic sending.
create function app.scheduler_tenant_on(p_tenant uuid) returns boolean
language sql
stable
set search_path = ''
as $$ select app.outbox_switch_on() and coalesce((select s.auto_send_enabled from public.outbox_settings s where s.tenant_id = p_tenant), false) $$;
revoke all on function app.scheduler_tenant_on(uuid) from public;

-- Is a reminder of this kind due for this visit at this instant? Only for a CONFIRMED visit that has not started, never in quiet hours (21:00 to 09:00: it would only wait for the morning),
-- never twice for the same kind and start time, and not when a confirmation or reminder of the visit was made after the window opened (the customer was just told).
--   evening_before: the visit is TOMORROW (India date), the hour is the setting's (9 to 20) or later, and it is before 21:00.
--   heads_up: the visit is more than 30 minutes away and no more than the setting's minutes away.
create function app.scheduler_reminder_due(m public.store_visits, p_kind text, p_now timestamptz, p_set jsonb) returns boolean
language sql
stable
set search_path = ''
as $$
  select m.status = 'confirmed' and m.starts_at > p_now
     and not app.outbox_in_quiet_hours(p_now)
     and not exists (select 1 from public.visit_reminders r where r.tenant_id = m.tenant_id and r.visit_id = m.id and r.kind = p_kind and r.for_starts_at = m.starts_at)
     and case p_kind
       when 'evening_before' then
         (p_set ->> 'reminder_evening_enabled')::boolean
         and m.visit_date = (p_now at time zone 'Asia/Kolkata')::date + 1
         and extract(hour from p_now at time zone 'Asia/Kolkata') >= (p_set ->> 'reminder_evening_hour')::integer
         and not exists (select 1 from public.outbox_messages x
                          where x.tenant_id = m.tenant_id and x.id in (m.confirmation_message_id, m.reminder_message_id)
                            and x.created_at >= ((m.visit_date - 1) + make_interval(hours => (p_set ->> 'reminder_evening_hour')::integer)) at time zone 'Asia/Kolkata')
       when 'heads_up' then
         (p_set ->> 'reminder_heads_up_enabled')::boolean
         and m.starts_at > p_now + interval '30 minutes'
         and m.starts_at - make_interval(mins => (p_set ->> 'reminder_heads_up_minutes')::integer) <= p_now
         and not exists (select 1 from public.outbox_messages x
                          where x.tenant_id = m.tenant_id and x.id in (m.confirmation_message_id, m.reminder_message_id)
                            and x.created_at >= m.starts_at - make_interval(mins => (p_set ->> 'reminder_heads_up_minutes')::integer))
       else false
     end
$$;
revoke all on function app.scheduler_reminder_due(public.store_visits, text, timestamptz, jsonb) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. the scheduler's functions. Each starts with the principal check; the work functions then check both switches and answer "nothing" when either is off.
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the businesses the worker may act for now: [] while the global switch is off
create function public.scheduler_tenants() returns jsonb
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
  return coalesce((select jsonb_agg(s.tenant_id order by s.tenant_id) from public.outbox_settings s where s.auto_send_enabled), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_tenants() from public, anon;
grant execute on function public.scheduler_tenants() to authenticated;

-- "the worker is alive": called once per tick, whatever else happened
create function public.scheduler_heartbeat(p_interval_seconds integer, p_errors integer default 0) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_interval_seconds is null or p_interval_seconds not between 5 and 3600 or p_errors is null or p_errors < 0 then
    perform app.scheduler_error('invalid');
  end if;
  insert into scheduler.heartbeat (id, last_tick_at, interval_seconds, ticks, last_errors) values (1, app.outbox_now(), p_interval_seconds, 1, p_errors)
  on conflict (id) do update set last_tick_at = app.outbox_now(), interval_seconds = excluded.interval_seconds, ticks = scheduler.heartbeat.ticks + 1, last_errors = excluded.last_errors;
end;
$$;
revoke all on function public.scheduler_heartbeat(integer, integer) from public, anon;
grant execute on function public.scheduler_heartbeat(integer, integer) to authenticated;

-- (a) release: the messages that are due, claimed for two minutes (the outbox's own claim: row locks with SKIP LOCKED, so two workers never get the same message; the hard blocks are checked again;
-- quiet hours push a due message to 09:00). [] unless both switches are on.
create function public.scheduler_claim_due(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() or p_tenant_id is null then
    perform app.scheduler_error('deny');
  end if;
  if not app.scheduler_tenant_on(p_tenant_id) then
    return '[]'::jsonb;
  end if;
  return app.outbox_claim_due_core(p_tenant_id, p_limit);
end;
$$;
revoke all on function public.scheduler_claim_due(uuid, integer) from public, anon;
grant execute on function public.scheduler_claim_due(uuid, integer) to authenticated;

-- what the channel said. No switch check: the worker must always be able to say what happened to a message it was given.
create function public.scheduler_mark(
  p_tenant_id uuid, p_message_id uuid, p_outcome text, p_adapter text, p_adapter_message_id text default null, p_failure_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() or p_tenant_id is null or p_message_id is null then
    perform app.scheduler_error('deny');
  end if;
  return app.outbox_mark_core(p_tenant_id, p_message_id, p_outcome, p_adapter, p_adapter_message_id, p_failure_code);
end;
$$;
revoke all on function public.scheduler_mark(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.scheduler_mark(uuid, uuid, text, text, text, text) to authenticated;

-- (b) reminders that are due: [{visit_id, kind, starts_at, language}]. The language is the one the visit's confirmation went out in (English when there is none).
create function public.scheduler_due_reminders(p_tenant_id uuid, p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_set jsonb;
begin
  if not app.is_scheduler() or p_tenant_id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.scheduler_error('invalid');
  end if;
  if not app.scheduler_tenant_on(p_tenant_id) or app.outbox_in_quiet_hours(v_now) then
    return '[]'::jsonb;
  end if;
  v_set := app.scheduler_settings_json(p_tenant_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('visit_id', z.id, 'kind', z.kind, 'starts_at', z.starts_at, 'language', z.language) order by z.starts_at, z.id, z.kind)
      from (
        select v.id, k.kind, v.starts_at,
               coalesce((select x.language from public.outbox_messages x where x.tenant_id = v.tenant_id and x.id = v.confirmation_message_id), 'en') as language
          from public.store_visits v
         cross join (values ('evening_before'), ('heads_up')) k (kind)
         where v.tenant_id = p_tenant_id and v.status = 'confirmed' and v.starts_at > v_now and v.visit_date between (v_now at time zone 'Asia/Kolkata')::date and (v_now at time zone 'Asia/Kolkata')::date + 1
           and app.scheduler_reminder_due(v, k.kind, v_now, v_set)
         order by v.starts_at, v.id, k.kind
         limit p_limit
      ) z
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_due_reminders(uuid, integer) from public, anon;
grant execute on function public.scheduler_due_reminders(uuid, integer) to authenticated;

-- Queue one reminder through the outbox, once. Everything is checked again here (both switches, the visit still confirmed, the window, no earlier record): the list above may be seconds old, and
-- a second worker may have been first. The answer says what happened: queued (with the outbox's own answer), replayed (the record exists), or skipped (no longer due, switch off).
create function public.scheduler_queue_reminder(
  p_tenant_id uuid, p_visit_id uuid, p_kind text, p_message_id uuid, p_body text, p_language text, p_uncertain boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := app.outbox_now();
  m      public.store_visits;
  v_old  public.visit_reminders;
  v_r    jsonb;
begin
  if not app.is_scheduler() or p_tenant_id is null or p_visit_id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_kind is null or p_kind not in ('evening_before', 'heads_up') or p_message_id is null then
    perform app.scheduler_error('invalid');
  end if;
  if not app.scheduler_tenant_on(p_tenant_id) then
    return jsonb_build_object('status', 'skipped', 'reason', 'off', 'replayed', false);
  end if;
  -- one reminder of a visit at a time, whichever worker asks
  perform pg_advisory_xact_lock(hashtextextended('visit-reminder:' || p_visit_id::text, 0));
  select * into m from public.store_visits x where x.id = p_visit_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.scheduler_error('reference');
  end if;
  select * into v_old from public.visit_reminders r where r.tenant_id = p_tenant_id and r.visit_id = m.id and r.kind = p_kind and r.for_starts_at = m.starts_at;
  if found then
    return jsonb_build_object('status', 'replayed', 'reason', null, 'replayed', true, 'message_id', v_old.message_id);
  end if;
  if not app.scheduler_reminder_due(m, p_kind, v_now, app.scheduler_settings_json(p_tenant_id)) then
    return jsonb_build_object('status', 'skipped', 'reason', 'not_due', 'replayed', false);
  end if;
  v_r := app.outbox_submit_core(v_uid, p_message_id, p_tenant_id, m.lead_id, 'whatsapp', p_body, p_language, 'visit', 'system', false, coalesce(p_uncertain, false));
  insert into public.visit_reminders (tenant_id, visit_id, kind, for_starts_at, message_id, created_at) values (p_tenant_id, m.id, p_kind, m.starts_at, p_message_id, v_now);
  update public.store_visits set reminder_message_id = p_message_id, updated_by = v_uid where id = m.id;
  return jsonb_build_object('status', 'queued', 'reason', null, 'replayed', false, 'message_id', p_message_id, 'message', v_r);
end;
$$;
revoke all on function public.scheduler_queue_reminder(uuid, uuid, text, uuid, text, text, boolean) from public, anon;
grant execute on function public.scheduler_queue_reminder(uuid, uuid, text, uuid, text, text, boolean) to authenticated;

-- (c) no-show: a CONFIRMED visit whose slot ended at least the business's minutes ago becomes "no show". Off unless the business turned it on. Row locks with SKIP LOCKED.
create function public.scheduler_mark_no_shows(p_tenant_id uuid, p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := app.outbox_now();
  v_set   jsonb;
  v_count integer := 0;
  r       public.store_visits;
begin
  if not app.is_scheduler() or p_tenant_id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.scheduler_error('invalid');
  end if;
  v_set := app.scheduler_settings_json(p_tenant_id);
  if not app.scheduler_tenant_on(p_tenant_id) or not (v_set ->> 'no_show_enabled')::boolean then
    return jsonb_build_object('marked', 0);
  end if;
  for r in
    select * from public.store_visits x
     where x.tenant_id = p_tenant_id and x.status = 'confirmed'
       and x.ends_at + make_interval(mins => (v_set ->> 'no_show_after_minutes')::integer) <= v_now
     order by x.ends_at, x.id
     limit p_limit
     for update skip locked
  loop
    update public.store_visits set status = 'no_show', closed_at = v_now, updated_by = v_uid where id = r.id;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('marked', v_count);
end;
$$;
revoke all on function public.scheduler_mark_no_shows(uuid, integer) from public, anon;
grant execute on function public.scheduler_mark_no_shows(uuid, integer) to authenticated;

-- the tick's tally for one business. Counts only. An all-zero tick writes nothing.
create function public.scheduler_record(p_tenant_id uuid, p_sent integer, p_failed integer, p_reminders integer, p_no_shows integer, p_errors integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() or p_tenant_id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_sent is null or p_failed is null or p_reminders is null or p_no_shows is null or p_errors is null
     or least(p_sent, p_failed, p_reminders, p_no_shows, p_errors) < 0 or greatest(p_sent, p_failed, p_reminders, p_no_shows, p_errors) > 100000 then
    perform app.scheduler_error('invalid');
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    perform app.scheduler_error('reference');
  end if;
  if p_sent + p_failed + p_reminders + p_no_shows + p_errors > 0 then
    insert into public.scheduler_runs (tenant_id, run_at, sent, failed, reminders, no_shows, errors) values (p_tenant_id, app.outbox_now(), p_sent, p_failed, p_reminders, p_no_shows, p_errors);
  end if;
end;
$$;
revoke all on function public.scheduler_record(uuid, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.scheduler_record(uuid, integer, integer, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. the Owner's read: is the worker running, when did it last look, when will it next, what did it do today (India day). Owner and Admin.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.scheduler_status(p_tenant_id uuid) returns jsonb
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
revoke all on function public.scheduler_status(uuid) from public, anon;
grant execute on function public.scheduler_status(uuid) to authenticated;
