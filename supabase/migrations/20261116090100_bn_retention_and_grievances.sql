-- Job BN (ADR 0075), part 2 of 2: HOW LONG WE KEEP THINGS and WHO TO COMPLAIN TO.
--
--   privacy.retention_settings            per workspace, in days (null = keep): chats, voice transcripts, enquiries, scheduler rows, audit rows. No row = nothing is purged.
--   public.retention_get / retention_set / retention_preview     Owner/Admin read; Owner (second factor) sets; the preview counts what the next clean-up would touch
--   public.privacy_worker_run_retention()      the AW worker's clean-up (at most once an hour per workspace): text is replaced by the erasure tombstone (erased:1) through the existing erasure column function,
--                                         scheduler and audit rows older than the age are deleted (the only door that may delete them). Writes privacy.retention_runs and one audit event with counts.
--   privacy.grievances (+ _events)        a request or complaint about personal data (access, correction, erasure, withdraw consent, complaint): received -> acknowledged -> in_progress -> resolved | rejected, due in 30 days
--   public.grievance_submit / list / get / update
--
-- SQLSTATEs as part 1 (SM611..SM615), plus 42501 deny, 22023 invalid, 23503 not found, SM306 second factor.

-- The erasure door (app.erasure_running) now also opens for the retention clean-up of THAT workspace, inside its own transaction: the clean-up function sets app.retention_tenant itself and unsets it. Callers
-- still test "current_user = 'postgres'" first, so nothing that is not a definer function owned by the database owner can use it.
create or replace function app.erasure_running(p_tenant_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.erasure_requests r
     where r.id::text = nullif(current_setting('app.erasure_request', true), '')
       and r.tenant_id = p_tenant_id
       and r.status = 'executing'
  ) or coalesce(nullif(current_setting('app.retention_tenant', true), '') = p_tenant_id::text, false)
$$;
revoke all on function app.erasure_running(uuid) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. retention
-- ---------------------------------------------------------------------------------------------------------------------------------
create table privacy.retention_settings (
  tenant_id       uuid primary key references public.tenants (id) on delete restrict,
  chats_days      integer check (chats_days between 30 and 3650),
  voice_days      integer check (voice_days between 7 and 3650),
  enquiries_days  integer check (enquiries_days between 90 and 3650),
  scheduler_days  integer check (scheduler_days between 30 and 3650),
  audit_days      integer check (audit_days between 365 and 3650),
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  last_run_at     timestamptz,
  check (voice_days is null or chats_days is null or voice_days <= chats_days)
);
alter table privacy.retention_settings enable row level security;
alter table privacy.retention_settings force row level security;
revoke all on privacy.retention_settings from public, anon, authenticated, service_role;

create table privacy.retention_runs (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  ran_at    timestamptz not null default now(),
  counts    jsonb not null
);
create index retention_runs_tenant_idx on privacy.retention_runs (tenant_id, ran_at desc);
alter table privacy.retention_runs enable row level security;
alter table privacy.retention_runs force row level security;
revoke all on privacy.retention_runs from public, anon, authenticated, service_role;

create function app.retention_json(s privacy.retention_settings) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('chats_days', s.chats_days, 'voice_days', s.voice_days, 'enquiries_days', s.enquiries_days, 'scheduler_days', s.scheduler_days, 'audit_days', s.audit_days,
                            'updated_at', s.updated_at, 'last_run_at', s.last_run_at)
$$;
revoke all on function app.retention_json(privacy.retention_settings) from public;

create function public.retention_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s privacy.retention_settings;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  select * into s from privacy.retention_settings x where x.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('chats_days', null, 'voice_days', null, 'enquiries_days', null, 'scheduler_days', null, 'audit_days', null, 'updated_at', null, 'last_run_at', null);
  end if;
  return app.retention_json(s);
end;
$$;
revoke all on function public.retention_get(uuid) from public, anon;
grant execute on function public.retention_get(uuid) to authenticated;

-- p_settings: the five keys (any missing key means "keep"); null or a number in range. The whole setting is replaced.
create function public.retention_set(p_tenant_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s privacy.retention_settings;
  k text;
  v_chats integer; v_voice integer; v_enq integer; v_sched integer; v_audit integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  perform app.require_aal2();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform app.privacy_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_settings) loop
    if k not in ('chats_days', 'voice_days', 'enquiries_days', 'scheduler_days', 'audit_days')
       or jsonb_typeof(p_settings -> k) not in ('number', 'null')
       or (jsonb_typeof(p_settings -> k) = 'number' and (p_settings ->> k) !~ '^[0-9]{1,5}$') then
      perform app.privacy_error('invalid');
    end if;
  end loop;
  v_chats := (p_settings ->> 'chats_days')::integer;
  v_voice := (p_settings ->> 'voice_days')::integer;
  v_enq   := (p_settings ->> 'enquiries_days')::integer;
  v_sched := (p_settings ->> 'scheduler_days')::integer;
  v_audit := (p_settings ->> 'audit_days')::integer;
  begin
    insert into privacy.retention_settings as r (tenant_id, chats_days, voice_days, enquiries_days, scheduler_days, audit_days, updated_by, updated_at)
    values (p_tenant_id, v_chats, v_voice, v_enq, v_sched, v_audit, auth.uid(), app.outbox_now())
    on conflict (tenant_id) do update
      set chats_days = excluded.chats_days, voice_days = excluded.voice_days, enquiries_days = excluded.enquiries_days, scheduler_days = excluded.scheduler_days,
          audit_days = excluded.audit_days, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    returning r.* into s;
  exception when check_violation then
    perform app.privacy_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'retention.set', 'retention_settings', p_tenant_id, null,
    jsonb_build_object('chats_days', v_chats, 'voice_days', v_voice, 'enquiries_days', v_enq, 'scheduler_days', v_sched, 'audit_days', v_audit));
  return app.retention_json(s);
end;
$$;
revoke all on function public.retention_set(uuid, jsonb) from public, anon;
grant execute on function public.retention_set(uuid, jsonb) to authenticated;

-- what is old enough NOW and not yet cleaned (counts; the same rules as the clean-up)
create function app.retention_counts(p_tenant_id uuid, s privacy.retention_settings, p_now timestamptz) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_chat_msgs bigint := 0; v_chat_drafts bigint := 0; v_voice bigint := 0; v_enq bigint := 0; v_runs bigint := 0; v_rem bigint := 0; v_audit bigint := 0;
begin
  if s.chats_days is not null then
    select count(*) into v_chat_msgs from public.assistant_messages m
     where m.tenant_id = p_tenant_id and m.created_at < p_now - make_interval(days => s.chats_days) and m.body <> 'erased:1'
       and not exists (select 1 from public.agent_cost_reservations r where r.tenant_id = m.tenant_id and r.run_id = m.run_id and r.model = 'voice-stt' and m.role = 'user');
    select count(*) into v_chat_drafts from public.assistant_reply_drafts d
     where d.tenant_id = p_tenant_id and d.created_at < p_now - make_interval(days => s.chats_days) and (d.body <> 'erased:1' or coalesce(d.gloss_en, '') not in ('', 'erased:1'));
  end if;
  if s.voice_days is not null then
    select count(*) into v_voice from public.assistant_messages m
     where m.tenant_id = p_tenant_id and m.role = 'user' and m.created_at < p_now - make_interval(days => s.voice_days) and m.body <> 'erased:1'
       and exists (select 1 from public.agent_cost_reservations r where r.tenant_id = m.tenant_id and r.run_id = m.run_id and r.model = 'voice-stt');
  end if;
  if s.enquiries_days is not null then
    select count(*) into v_enq from public.enquiries e
     where e.tenant_id = p_tenant_id and e.received_at < p_now - make_interval(days => s.enquiries_days) and (e.body <> 'erased:1' or coalesce(e.subject, '') not in ('', 'erased:1'));
  end if;
  if s.scheduler_days is not null then
    select count(*) into v_runs from public.scheduler_runs r where r.tenant_id = p_tenant_id and r.run_at < p_now - make_interval(days => s.scheduler_days);
    select count(*) into v_rem from public.visit_reminders r where r.tenant_id = p_tenant_id and r.created_at < p_now - make_interval(days => s.scheduler_days) and r.for_starts_at < p_now - make_interval(days => s.scheduler_days);
  end if;
  if s.audit_days is not null then
    select count(*) into v_audit from public.audit_events a where a.tenant_id = p_tenant_id and a.created_at < p_now - make_interval(days => s.audit_days);
  end if;
  return jsonb_build_object('chat_messages', v_chat_msgs, 'reply_drafts', v_chat_drafts, 'voice_transcripts', v_voice, 'enquiries', v_enq,
                            'scheduler_runs', v_runs, 'visit_reminders', v_rem, 'audit_events', v_audit);
end;
$$;
revoke all on function app.retention_counts(uuid, privacy.retention_settings, timestamptz) from public;

create function public.retention_preview(p_tenant_id uuid, p_settings jsonb default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s privacy.retention_settings;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  if p_settings is null then
    select * into s from privacy.retention_settings x where x.tenant_id = p_tenant_id;
    if not found then
      s.tenant_id := p_tenant_id;
    end if;
  else
    if jsonb_typeof(p_settings) <> 'object' then
      perform app.privacy_error('invalid');
    end if;
    s.tenant_id := p_tenant_id;
    begin
      s.chats_days := (p_settings ->> 'chats_days')::integer;
      s.voice_days := (p_settings ->> 'voice_days')::integer;
      s.enquiries_days := (p_settings ->> 'enquiries_days')::integer;
      s.scheduler_days := (p_settings ->> 'scheduler_days')::integer;
      s.audit_days := (p_settings ->> 'audit_days')::integer;
    exception when others then
      perform app.privacy_error('invalid');
    end;
    if coalesce(s.chats_days, 30) < 30 or coalesce(s.voice_days, 7) < 7 or coalesce(s.enquiries_days, 90) < 90 or coalesce(s.scheduler_days, 30) < 30 or coalesce(s.audit_days, 365) < 365
       or s.chats_days > 3650 or s.voice_days > 3650 or s.enquiries_days > 3650 or s.scheduler_days > 3650 or s.audit_days > 3650 then
      perform app.privacy_error('invalid');
    end if;
  end if;
  return app.retention_counts(p_tenant_id, s, app.outbox_now());
end;
$$;
revoke all on function public.retention_preview(uuid, jsonb) from public, anon;
grant execute on function public.retention_preview(uuid, jsonb) to authenticated;

-- the clean-up of ONE workspace (called by the worker function below)
create function app.retention_run_tenant(p_tenant_id uuid, s privacy.retention_settings) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_cut timestamptz;
  n bigint;
  v_counts jsonb := '{}'::jsonb;
  v_voice_sql text := 'exists (select 1 from public.agent_cost_reservations r where r.tenant_id = t.tenant_id and r.run_id = t.run_id and r.model = ''voice-stt'')';
begin
  perform set_config('app.retention_tenant', p_tenant_id::text, true);
  if s.voice_days is not null then
    v_cut := v_now - make_interval(days => s.voice_days);
    n := app.erase_column(p_tenant_id, 'tenant', 'assistant_messages', 'body', format('t.role = ''user'' and t.created_at < %L and %s', v_cut, v_voice_sql));
    v_counts := v_counts || jsonb_build_object('voice_transcripts', n);
  end if;
  if s.chats_days is not null then
    v_cut := v_now - make_interval(days => s.chats_days);
    n := app.erase_column(p_tenant_id, 'tenant', 'assistant_messages', 'body', format('t.created_at < %L', v_cut));
    v_counts := v_counts || jsonb_build_object('chat_messages', n);
    n := app.erase_column(p_tenant_id, 'tenant', 'assistant_reply_drafts', 'body', format('t.created_at < %L', v_cut))
       + app.erase_column(p_tenant_id, 'tenant', 'assistant_reply_drafts', 'gloss_en', format('t.created_at < %L', v_cut));
    v_counts := v_counts || jsonb_build_object('reply_drafts', n);
  end if;
  if s.enquiries_days is not null then
    v_cut := v_now - make_interval(days => s.enquiries_days);
    n := app.erase_column(p_tenant_id, 'tenant', 'enquiries', 'body', format('t.received_at < %L', v_cut))
       + app.erase_column(p_tenant_id, 'tenant', 'enquiries', 'subject', format('t.received_at < %L', v_cut));
    v_counts := v_counts || jsonb_build_object('enquiries', n);
  end if;
  perform set_config('app.retention_tenant', '', true);

  -- rows that are append-only for everybody else: the retention door (app.retention_purging) is open for these deletes only
  perform set_config('app.retention_purge', 'on', true);
  if s.scheduler_days is not null then
    v_cut := v_now - make_interval(days => s.scheduler_days);
    delete from public.scheduler_runs r where r.tenant_id = p_tenant_id and r.run_at < v_cut;
    get diagnostics n = row_count;
    v_counts := v_counts || jsonb_build_object('scheduler_runs', n);
    delete from public.visit_reminders r where r.tenant_id = p_tenant_id and r.created_at < v_cut and r.for_starts_at < v_cut;
    get diagnostics n = row_count;
    v_counts := v_counts || jsonb_build_object('visit_reminders', n);
  end if;
  if s.audit_days is not null then
    v_cut := v_now - make_interval(days => s.audit_days);
    delete from public.audit_events a where a.tenant_id = p_tenant_id and a.created_at < v_cut;
    get diagnostics n = row_count;
    v_counts := v_counts || jsonb_build_object('audit_events', n);
  end if;
  perform set_config('app.retention_purge', '', true);
  return v_counts;
end;
$$;
revoke all on function app.retention_run_tenant(uuid, privacy.retention_settings) from public;

create function public.privacy_worker_run_retention(p_limit integer default 20) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s privacy.retention_settings;
  v_counts jsonb;
  v_done integer := 0;
  v_now timestamptz := app.outbox_now();
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.privacy_error('invalid');
  end if;
  for s in select * from privacy.retention_settings x
            where (x.chats_days is not null or x.voice_days is not null or x.enquiries_days is not null or x.scheduler_days is not null or x.audit_days is not null)
              and (x.last_run_at is null or x.last_run_at <= v_now - interval '1 hour')
            order by x.last_run_at nulls first, x.tenant_id limit p_limit for update skip locked loop
    begin
      v_counts := app.retention_run_tenant(s.tenant_id, s);
      insert into privacy.retention_runs (tenant_id, ran_at, counts) values (s.tenant_id, v_now, v_counts);
      update privacy.retention_settings set last_run_at = v_now where tenant_id = s.tenant_id;
      perform app.write_audit_event(s.tenant_id, 'retention.run', 'retention_settings', s.tenant_id, null, v_counts);
      v_done := v_done + 1;
    exception when others then
      -- one workspace's trouble does not stop the others; it is tried again in an hour
      perform set_config('app.retention_tenant', '', true);
      perform set_config('app.retention_purge', '', true);
      update privacy.retention_settings set last_run_at = v_now where tenant_id = s.tenant_id;
    end;
  end loop;
  return jsonb_build_object('workspaces', v_done);
end;
$$;
revoke all on function public.privacy_worker_run_retention(integer) from public, anon;
grant execute on function public.privacy_worker_run_retention(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. grievances
-- ---------------------------------------------------------------------------------------------------------------------------------
create table privacy.grievances (
  id                uuid primary key,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  submitted_by      uuid,
  kind              text not null check (kind in ('access', 'correction', 'erasure', 'withdraw_consent', 'complaint', 'other')),
  subject           text not null check (char_length(subject) between 1 and 200),
  details           text not null default '' check (char_length(details) <= 4000),
  on_behalf         boolean not null default false,
  requester_name    text check (char_length(requester_name) <= 120),
  requester_contact text check (char_length(requester_contact) <= 200),
  status            text not null default 'received' check (status in ('received', 'acknowledged', 'in_progress', 'resolved', 'rejected')),
  received_at       timestamptz not null default now(),
  due_at            timestamptz not null,
  acknowledged_at   timestamptz,
  closed_at         timestamptz,
  resolution_note   text check (char_length(resolution_note) <= 2000),
  check (due_at > received_at),
  check ((status in ('resolved', 'rejected')) = (closed_at is not null))
);
create index grievances_tenant_idx on privacy.grievances (tenant_id, received_at desc);
create index grievances_user_idx on privacy.grievances (submitted_by, received_at desc);
alter table privacy.grievances enable row level security;
alter table privacy.grievances force row level security;
revoke all on privacy.grievances from public, anon, authenticated, service_role;

create table privacy.grievance_events (
  id            uuid primary key default gen_random_uuid(),
  grievance_id  uuid not null references privacy.grievances (id) on delete cascade,
  at            timestamptz not null default now(),
  actor_user_id uuid,
  status        text not null,
  note          text check (char_length(note) <= 1000)
);
create index grievance_events_idx on privacy.grievance_events (grievance_id, at);
alter table privacy.grievance_events enable row level security;
alter table privacy.grievance_events force row level security;
revoke all on privacy.grievance_events from public, anon, authenticated, service_role;

create function app.grievance_json(g privacy.grievances, p_with_events boolean) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', g.id, 'tenant_id', g.tenant_id, 'kind', g.kind, 'subject', g.subject, 'details', g.details, 'on_behalf', g.on_behalf,
                            'requester_name', g.requester_name, 'requester_contact', g.requester_contact, 'status', g.status, 'received_at', g.received_at, 'due_at', g.due_at,
                            'acknowledged_at', g.acknowledged_at, 'closed_at', g.closed_at, 'resolution_note', g.resolution_note,
                            'overdue', (g.status not in ('resolved', 'rejected') and g.due_at < app.outbox_now()))
         || case when p_with_events then jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'status', e.status, 'note', e.note) order by e.at, e.id)
                                                                                  from privacy.grievance_events e where e.grievance_id = g.id), '[]'::jsonb)) else '{}'::jsonb end
$$;
revoke all on function app.grievance_json(privacy.grievances, boolean) from public;

create function public.grievance_submit(p_id uuid, p_tenant_id uuid, p_kind text, p_subject text, p_details text default '', p_on_behalf boolean default false,
                                        p_requester_name text default null, p_requester_contact text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  g privacy.grievances;
  v_now timestamptz := app.outbox_now();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  if p_id is null or p_kind is null or p_kind not in ('access', 'correction', 'erasure', 'withdraw_consent', 'complaint', 'other')
     or btrim(coalesce(p_subject, '')) = '' or char_length(p_subject) > 200 or char_length(coalesce(p_details, '')) > 4000
     or char_length(coalesce(p_requester_name, '')) > 120 or char_length(coalesce(p_requester_contact, '')) > 200 or p_on_behalf is null then
    perform app.privacy_error('invalid');
  end if;
  select * into g from privacy.grievances x where x.id = p_id;
  if found then
    if g.submitted_by is distinct from v_uid or g.tenant_id <> p_tenant_id then
      perform app.privacy_error('invalid');
    end if;
    return app.grievance_json(g, true);
  end if;
  if (select count(*) from privacy.grievances x where x.submitted_by = v_uid and x.received_at > v_now - interval '24 hours') >= 10 then
    perform app.privacy_error('rate');
  end if;
  insert into privacy.grievances (id, tenant_id, submitted_by, kind, subject, details, on_behalf, requester_name, requester_contact, received_at, due_at)
  values (p_id, p_tenant_id, v_uid, p_kind, btrim(p_subject), coalesce(p_details, ''), p_on_behalf, nullif(btrim(coalesce(p_requester_name, '')), ''), nullif(btrim(coalesce(p_requester_contact, '')), ''),
          v_now, v_now + interval '30 days')
  returning * into g;
  insert into privacy.grievance_events (grievance_id, at, actor_user_id, status, note) values (g.id, v_now, v_uid, 'received', null);
  perform app.write_audit_event(p_tenant_id, 'grievance.submitted', 'grievance', g.id, null, jsonb_build_object('kind', g.kind, 'on_behalf', g.on_behalf));
  return app.grievance_json(g, true);
end;
$$;
revoke all on function public.grievance_submit(uuid, uuid, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.grievance_submit(uuid, uuid, text, text, text, boolean, text, text) to authenticated;

-- Owner/Admin see every grievance of the workspace; a Sales member sees only their own
create function public.grievance_list(p_tenant_id uuid, p_status text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manage boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  if p_status is not null and p_status not in ('received', 'acknowledged', 'in_progress', 'resolved', 'rejected', 'open') then
    perform app.privacy_error('invalid');
  end if;
  v_manage := app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  return coalesce((select jsonb_agg(app.grievance_json(x, false) order by x.received_at desc, x.id)
                     from (select * from privacy.grievances g
                            where g.tenant_id = p_tenant_id and (v_manage or g.submitted_by = auth.uid())
                              and (p_status is null or g.status = p_status or (p_status = 'open' and g.status not in ('resolved', 'rejected')))
                            order by g.received_at desc, g.id limit 200) x), '[]'::jsonb);
end;
$$;
revoke all on function public.grievance_list(uuid, text) from public, anon;
grant execute on function public.grievance_list(uuid, text) to authenticated;

create function public.grievance_get(p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g privacy.grievances;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select * into g from privacy.grievances x where x.id = p_id;
  if not found or not app.has_tenant_role(g.tenant_id, array['owner', 'admin', 'sales']::public.app_role[])
     or (g.submitted_by is distinct from auth.uid() and not app.has_tenant_role(g.tenant_id, array['owner', 'admin']::public.app_role[])) then
    perform app.privacy_error('reference');
  end if;
  return app.grievance_json(g, true);
end;
$$;
revoke all on function public.grievance_get(uuid) from public, anon;
grant execute on function public.grievance_get(uuid) to authenticated;

create function public.grievance_update(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g privacy.grievances;
  v_now timestamptz := app.outbox_now();
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select * into g from privacy.grievances x where x.id = p_id for update;
  if not found or not app.has_tenant_role(g.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  if p_status is null or p_status not in ('acknowledged', 'in_progress', 'resolved', 'rejected') or char_length(coalesce(p_note, '')) > 1000
     or (p_status in ('resolved', 'rejected') and btrim(coalesce(p_note, '')) = '') then
    perform app.privacy_error('invalid');
  end if;
  if g.status = p_status and p_status not in ('resolved', 'rejected') then
    return app.grievance_json(g, true);   -- same step again: nothing to do
  end if;
  if g.status in ('resolved', 'rejected')
     or (g.status = 'acknowledged' and p_status = 'acknowledged')
     or (g.status = 'in_progress' and p_status = 'acknowledged') then
    perform app.privacy_error('state');
  end if;
  update privacy.grievances
     set status = p_status,
         acknowledged_at = case when acknowledged_at is null then v_now else acknowledged_at end,
         closed_at = case when p_status in ('resolved', 'rejected') then v_now else null end,
         resolution_note = case when p_status in ('resolved', 'rejected') then btrim(p_note) else resolution_note end
   where id = g.id returning * into g;
  insert into privacy.grievance_events (grievance_id, at, actor_user_id, status, note) values (g.id, v_now, auth.uid(), p_status, nullif(btrim(coalesce(p_note, '')), ''));
  perform app.write_audit_event(g.tenant_id, 'grievance.updated', 'grievance', g.id, null, jsonb_build_object('status', p_status));
  return app.grievance_json(g, true);
end;
$$;
revoke all on function public.grievance_update(uuid, text, text) from public, anon;
grant execute on function public.grievance_update(uuid, text, text) to authenticated;

-- when a WORKSPACE is erased, what people wrote in its grievances goes too (the rows, the dates and the statuses stay)
create function app.grievances_erase_on_tenant_erasure() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope = 'tenant' and new.status = 'executed' and old.status is distinct from 'executed' then
    update privacy.grievances set subject = 'erased:1', details = '', requester_name = null, requester_contact = null, resolution_note = case when resolution_note is null then null else 'erased:1' end
     where tenant_id = new.tenant_id;
    update privacy.grievance_events e set note = null from privacy.grievances g where g.id = e.grievance_id and g.tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;
revoke all on function app.grievances_erase_on_tenant_erasure() from public;
create trigger erasure_requests_erase_grievances after update on public.erasure_requests
  for each row execute function app.grievances_erase_on_tenant_erasure();
