-- Appointment booking slice 4 (owner decision 14 Nov 2026, docs/plans/appointment-booking.md): an OPTIONAL Google Calendar link per business, made by its Owner (OAuth, offline access).
--   * WRITE: every appointment (public.store_visits) is copied as an event to the Owner's PRIMARY calendar (v1 has no calendar picker: docs/plans/google-oauth-verification.md); a cancelled one is deleted
--     there, a completed or no-show one is left as it is. Only events WE made are ever touched (deterministic event id + extendedProperties.private.stack19_visit_id).
--   * READ: the busy times of that calendar for the next 60 days are kept here as busy BLOCKS (public.calendar_busy), only when the Owner switched "block busy" on; our own events are subtracted.
--     The slot function (another slice) asks app.calendar_busy_overlaps once per slot.
--   * The refresh token is a SECRET: it is only in Secret Manager (the workspace-secrets mechanism, kind google_calendar, secret sme-ws-<workspace>-google_calendar). This database holds WHERE it is
--     (public.workspace_secrets), never the token, the channel token or an access token.
-- Every table: RLS forced, no client privileges (calendar_busy: ids only, for the generic tenant test); every read and write goes through the SECURITY DEFINER functions below.
-- Who: the Owner connects (second factor), changes the settings and disconnects; the Owner and an Admin ask for a sync now; any member reads the status; the registered SCHEDULER account
-- (app.is_scheduler()) does the sync work (the worker) and serves the two public doors of the API (the OAuth callback and Google's push notification).
-- SQLSTATEs: 22023 invalid, 42501 not allowed, SM306 second factor, SM881 not connected, SM882 not in a state that allows this (a used or expired authorization, too many open ones).

create function app.gcal_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'       then raise exception 'invalid input' using errcode = '22023';
    when 'not_connected' then raise exception 'google calendar is not connected' using errcode = 'SM881';
    when 'state'         then raise exception 'not in a state that allows this' using errcode = 'SM882';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.gcal_error(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the secret's kind: one secret per workspace and kind (the refresh token and the push channel's token, as one JSON value)
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.workspace_secrets drop constraint workspace_secrets_kind_check;
alter table public.workspace_secrets add constraint workspace_secrets_kind_check check (kind in ('indiamart_key', 'google_calendar'));
comment on column public.workspace_secrets.kind is 'SAFE: a closed word (indiamart_key, google_calendar). CLEAN-EXEMPT: check constraint';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.google_calendar_links (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null unique references public.tenants (id),
  member_id           uuid not null,
  status              text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  google_email        text check (google_email ~ '^[^[:space:][:cntrl:]@]{1,64}@[^[:space:][:cntrl:]@]{1,255}$'),
  calendar_id         text not null default 'primary' check (calendar_id = 'primary'),
  calendar_name       text check (char_length(calendar_name) between 1 and 200 and app.text_is_clean(calendar_name)),
  write_events        boolean not null default true,
  block_busy          boolean not null default false,
  channel_id          uuid,
  channel_resource_id text check (channel_resource_id ~ '^[A-Za-z0-9_.-]{1,200}$'),
  channel_expires_at  timestamptz,
  channel_next_at     timestamptz,
  busy_requested_at   timestamptz,
  busy_refreshed_at   timestamptz,
  busy_next_at        timestamptz,
  link_attempts       smallint not null default 0 check (link_attempts between 0 and 1000),
  last_synced_at      timestamptz,
  last_error_code     text check (last_error_code ~ '^[a-z][a-z_]{1,39}$'),
  connected_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((channel_id is null) = (channel_resource_id is null)),
  check ((channel_id is null) = (channel_expires_at is null))
);
create unique index google_calendar_links_channel_idx on integrations.google_calendar_links (channel_id) where channel_id is not null;
comment on table integrations.google_calendar_links is 'A business''s Google Calendar link (one per business). Never a token: the refresh token and the channel token are in Secret Manager (public.workspace_secrets says where).';
comment on column integrations.google_calendar_links.member_id is 'SAFE: the user id of the Owner who connected it. CLEAN-EXEMPT: uuid';
comment on column integrations.google_calendar_links.status is 'SAFE: a closed word (connected, needs_reconnect). CLEAN-EXEMPT: closed CHECK list';
comment on column integrations.google_calendar_links.google_email is 'PII: the Google account''s address (the organizer Google names on the first event we wrote; null until then). Deleted with the link (disconnect, workspace erasure).';
comment on column integrations.google_calendar_links.calendar_id is 'SAFE: always ''primary'' in v1 (no calendar picker). CLEAN-EXEMPT: check constraint';
comment on column integrations.google_calendar_links.calendar_name is 'SAFE: a display name of the calendar (unused in v1).';
comment on column integrations.google_calendar_links.channel_resource_id is 'SAFE: Google''s opaque id of the watched resource. CLEAN-EXEMPT: strict pattern';
comment on column integrations.google_calendar_links.last_error_code is 'SAFE: a closed code word of the last failure (never Google''s text). CLEAN-EXEMPT: strict pattern';

create table integrations.google_event_links (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id),
  visit_id          uuid not null,
  calendar_id       text not null check (calendar_id = 'primary'),
  event_id          text not null check (event_id ~ '^[a-v0-9]{5,255}$'),
  state             text not null default 'pending' check (state in ('pending', 'written', 'deleted')),
  last_pushed_hash  text check (last_pushed_hash ~ '^[0-9a-f]{64}$'),
  visit_updated_at  timestamptz,
  pushed_at         timestamptz,
  attempts          smallint not null default 0 check (attempts between 0 and 1000),
  next_attempt_at   timestamptz not null default now(),
  last_error_code   text check (last_error_code ~ '^[a-z][a-z_]{1,39}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, visit_id),
  foreign key (tenant_id, visit_id) references public.store_visits (tenant_id, id)
);
create index google_event_links_due_idx on integrations.google_event_links (tenant_id, next_attempt_at);
comment on table integrations.google_event_links is 'Which Google event we made for which appointment, and the state of its last push (the hash of what was sent, never the event''s text). Volume: no audit trigger.';
comment on column integrations.google_event_links.event_id is 'SAFE: the event id WE chose (s19 + the visit id in hex). CLEAN-EXEMPT: strict pattern';
comment on column integrations.google_event_links.state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column integrations.google_event_links.last_pushed_hash is 'SAFE: a SHA-256 of the event body last sent. CLEAN-EXEMPT: strict pattern';
comment on column integrations.google_event_links.last_error_code is 'SAFE: a closed code word. CLEAN-EXEMPT: strict pattern';

-- the OAuth authorization in flight: the API signs {tenant, member, nonce, expiry} (HMAC); the nonce is used up here ONCE, within 10 minutes
create table integrations.google_calendar_states (
  nonce      uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id),
  member_id  uuid not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index google_calendar_states_tenant_idx on integrations.google_calendar_states (tenant_id, created_at);
comment on table integrations.google_calendar_states is 'The one-time nonce of an OAuth authorization in flight (10 minutes, once). No token, no code.';

create table public.calendar_busy (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id),
  source     text not null default 'google' check (source in ('google')),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  fetched_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, source, starts_at, ends_at)
);
-- the slot function asks once per slot: an indexed range lookup
create index calendar_busy_range_idx on public.calendar_busy (tenant_id, starts_at, ends_at);
comment on table public.calendar_busy is 'Busy blocks of the business''s own Google Calendar for the next 60 days (times only: no title, no person, no event id). Only while "block busy" is on; our own appointments are not in it.';
comment on column public.calendar_busy.source is 'SAFE: a closed word (google). CLEAN-EXEMPT: closed CHECK list';

do $$
declare
  t text;
begin
  foreach t in array array['integrations.google_calendar_links', 'integrations.google_event_links', 'integrations.google_calendar_states', 'public.calendar_busy'] loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format('revoke all on %s from public, anon, authenticated, service_role', t);
    execute format('create trigger %I before update on %s for each row execute function app.forbid_tenant_id_change()', replace(t, '.', '_') || '_forbid_tenant_id_change', t);
  end loop;
end $$;
create trigger google_calendar_links_set_updated_at before update on integrations.google_calendar_links for each row execute function app.set_updated_at();
create trigger google_event_links_set_updated_at before update on integrations.google_event_links for each row execute function app.set_updated_at();
-- the link is not audited row by row (the worker touches it every few minutes): connect, settings, needs_reconnect and disconnect write their own audit event (closed words, never the address)
create trigger audit_calendar_busy after insert or update or delete on public.calendar_busy for each row execute function app.audit_row_change('calendar_busy', '');
-- calendar_busy: a client sees at most that rows exist (the two id columns, Owner and Admin); the times are read only by the definer functions (the slots)
grant select (id, tenant_id) on public.calendar_busy to authenticated;
create policy calendar_busy_select on public.calendar_busy for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the slots' question (CREATE OR REPLACE of the engine slice's stub): is any busy block inside [p_from, p_to)?
-- ---------------------------------------------------------------------------------------------------------------------------------
drop function if exists app.calendar_busy_overlaps(uuid, timestamptz, timestamptz);
create function app.calendar_busy_overlaps(p_tenant uuid, p_from timestamptz, p_to timestamptz) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_to > p_from and exists (select 1 from public.calendar_busy b
                                              where b.tenant_id = p_tenant and b.starts_at < p_to and b.ends_at > p_from), false)
$$;
revoke all on function app.calendar_busy_overlaps(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.gcal_secret_name(p_tenant uuid) returns text
language sql
immutable
set search_path = ''
as $$ select 'sme-ws-' || p_tenant::text || '-google_calendar' $$;
revoke all on function app.gcal_secret_name(uuid) from public, anon, authenticated, service_role;

create function app.gcal_status_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('connected', true, 'status', l.status, 'google_email', l.google_email, 'calendar_id', l.calendar_id, 'calendar_name', l.calendar_name,
                               'write_events', l.write_events, 'block_busy', l.block_busy, 'last_synced_at', l.last_synced_at, 'last_error_code', l.last_error_code)
       from integrations.google_calendar_links l where l.tenant_id = p_tenant),
    jsonb_build_object('connected', false, 'status', 'not_connected', 'google_email', null, 'calendar_id', null, 'calendar_name', null,
                       'write_events', false, 'block_busy', false, 'last_synced_at', null, 'last_error_code', null))
$$;
revoke all on function app.gcal_status_json(uuid) from public, anon, authenticated, service_role;

-- everything OUR copy holds for a business: the link, the event links, the busy blocks, the authorizations in flight, where the secret is. Events already in Google stay (owner decision).
create function app.gcal_forget(p_tenant uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_events integer;
  n_busy integer;
  n_link integer;
begin
  delete from integrations.google_event_links where tenant_id = p_tenant;
  get diagnostics n_events = row_count;
  delete from public.calendar_busy where tenant_id = p_tenant;
  get diagnostics n_busy = row_count;
  delete from integrations.google_calendar_states where tenant_id = p_tenant;
  delete from public.workspace_secrets where tenant_id = p_tenant and kind = 'google_calendar';
  delete from integrations.google_calendar_links where tenant_id = p_tenant;
  get diagnostics n_link = row_count;
  if n_link > 0 then
    perform app.write_audit_event(p_tenant, 'google_calendar.disconnect', 'google_calendar_link', null, null, null, jsonb_build_object('event_links', n_events, 'busy_blocks', n_busy));
  end if;
  return jsonb_build_object('disconnected', n_link > 0, 'event_links', n_events, 'busy_blocks', n_busy);
end;
$$;
revoke all on function app.gcal_forget(uuid) from public, anon, authenticated, service_role;

create function app.gcal_scheduler_gate() returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.gcal_error('deny');
  end if;
end;
$$;
revoke all on function app.gcal_scheduler_gate() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. the people's functions
-- ---------------------------------------------------------------------------------------------------------------------------------
-- any member: the status (never a token, never where it is)
create function public.google_calendar_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.gcal_error('deny');
  end if;
  return app.gcal_status_json(p_tenant_id);
end;
$$;

-- the Owner, second factor: a new authorization in flight (at most 5 open ones in 10 minutes). The API signs the nonce into the `state` it sends to Google.
create function public.google_calendar_connect_start(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s integrations.google_calendar_states;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.gcal_error('deny');
  end if;
  perform app.require_aal2();
  delete from integrations.google_calendar_states x where x.tenant_id = p_tenant_id and x.expires_at < now() - interval '1 day';
  if (select count(*) from integrations.google_calendar_states x where x.tenant_id = p_tenant_id and x.used_at is null and x.expires_at > now()) >= 5 then
    perform app.gcal_error('state');
  end if;
  insert into integrations.google_calendar_states (tenant_id, member_id, expires_at) values (p_tenant_id, auth.uid(), now() + interval '10 minutes') returning * into s;
  return jsonb_build_object('nonce', s.nonce, 'member_id', s.member_id, 'expires_at', s.expires_at);
end;
$$;

-- the Owner and an Admin: what the API needs to act for them at Google (WHERE the secret is, and the channel to stop); never the token
create function public.google_calendar_ref(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l integrations.google_calendar_links;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.gcal_error('deny');
  end if;
  select * into l from integrations.google_calendar_links x where x.tenant_id = p_tenant_id;
  if not found then
    perform app.gcal_error('not_connected');
  end if;
  return jsonb_build_object('status', l.status, 'calendar_id', l.calendar_id, 'secret_name', app.gcal_secret_name(p_tenant_id),
                            'channel_id', l.channel_id, 'channel_resource_id', l.channel_resource_id);
end;
$$;

-- the Owner: write our appointments to Google (write_events) and/or block busy times (block_busy). Turning block_busy off drops the busy blocks at once and hands back the push channel to stop.
create function public.google_calendar_settings_set(p_tenant_id uuid, p_write_events boolean, p_block_busy boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.google_calendar_links;
  v_stop jsonb := null;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.gcal_error('deny');
  end if;
  if p_write_events is null or p_block_busy is null then
    perform app.gcal_error('invalid');
  end if;
  select * into l from integrations.google_calendar_links x where x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.gcal_error('not_connected');
  end if;
  if not p_block_busy then
    delete from public.calendar_busy where tenant_id = p_tenant_id;
    if l.channel_id is not null then
      v_stop := jsonb_build_object('channel_id', l.channel_id, 'channel_resource_id', l.channel_resource_id);
    end if;
  end if;
  update integrations.google_calendar_links
     set write_events = p_write_events, block_busy = p_block_busy,
         channel_id = case when p_block_busy then channel_id end,
         channel_resource_id = case when p_block_busy then channel_resource_id end,
         channel_expires_at = case when p_block_busy then channel_expires_at end,
         busy_requested_at = case when p_block_busy and not l.block_busy then now() else busy_requested_at end,
         channel_next_at = null, busy_next_at = null
   where tenant_id = p_tenant_id;
  if p_write_events and not l.write_events then
    update integrations.google_event_links set next_attempt_at = now(), attempts = 0 where tenant_id = p_tenant_id;
  end if;
  perform app.write_audit_event(p_tenant_id, 'google_calendar.settings', 'google_calendar_link', l.id, jsonb_build_object('write_events', l.write_events, 'block_busy', l.block_busy),
                                jsonb_build_object('write_events', p_write_events, 'block_busy', p_block_busy), '{}'::jsonb);
  return app.gcal_status_json(p_tenant_id) || jsonb_build_object('stop_channel', v_stop);
end;
$$;

-- the Owner and an Admin: sync now (the worker does it on its next tick: busy times again, failed pushes again)
create function public.google_calendar_sync_now(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.gcal_error('deny');
  end if;
  update integrations.google_calendar_links set busy_requested_at = now(), busy_next_at = null, channel_next_at = null where tenant_id = p_tenant_id and status = 'connected';
  if not found then
    perform app.gcal_error('not_connected');
  end if;
  update integrations.google_event_links set next_attempt_at = now(), attempts = 0 where tenant_id = p_tenant_id and next_attempt_at > now();
  return app.gcal_status_json(p_tenant_id) || jsonb_build_object('requested', true);
end;
$$;

-- the Owner: forget everything OUR copy holds (the API revoked the token at Google, stopped the channel and deleted the secret first). Events already in their calendar stay.
create function public.google_calendar_disconnect(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.gcal_error('deny');
  end if;
  return app.gcal_forget(p_tenant_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. the scheduler account's functions (the worker, and the API's two public doors acting as that account)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the OAuth callback: use the nonce up (once, unexpired, the member still the Owner)
create function public.scheduler_gcal_state_use(p_nonce uuid, p_tenant_id uuid, p_member_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s integrations.google_calendar_states;
begin
  perform app.gcal_scheduler_gate();
  select * into s from integrations.google_calendar_states x where x.nonce = p_nonce for update;
  if not found or s.tenant_id is distinct from p_tenant_id or s.member_id is distinct from p_member_id then
    perform app.gcal_error('state');
  end if;
  if s.used_at is not null or s.expires_at <= now() then
    perform app.gcal_error('state');
  end if;
  update integrations.google_calendar_states set used_at = now() where nonce = s.nonce;
  if not exists (select 1 from public.memberships m where m.tenant_id = s.tenant_id and m.user_id = s.member_id and m.role = 'owner') then
    perform app.gcal_error('deny');
  end if;
  return jsonb_build_object('tenant_id', s.tenant_id, 'member_id', s.member_id, 'secret_name', app.gcal_secret_name(s.tenant_id),
                            'reconnect', exists (select 1 from integrations.google_calendar_links l where l.tenant_id = s.tenant_id));
end;
$$;

-- the OAuth callback, after Secret Manager holds the new token: the link (a reconnect keeps the Owner's settings) and WHERE the secret is
create function public.scheduler_gcal_connected(p_tenant_id uuid, p_member_id uuid, p_fingerprint text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old integrations.google_calendar_links;
  v_stop jsonb := null;
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null or p_member_id is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{16}$' then
    perform app.gcal_error('invalid');
  end if;
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant_id and m.user_id = p_member_id and m.role = 'owner') then
    perform app.gcal_error('deny');
  end if;
  select * into old from integrations.google_calendar_links x where x.tenant_id = p_tenant_id for update;
  if found and old.channel_id is not null then
    v_stop := jsonb_build_object('channel_id', old.channel_id, 'channel_resource_id', old.channel_resource_id);
  end if;
  insert into integrations.google_calendar_links (tenant_id, member_id, status, busy_requested_at)
  values (p_tenant_id, p_member_id, 'connected', now())
  on conflict (tenant_id) do update
     set member_id = excluded.member_id, status = 'connected', connected_at = now(), last_error_code = null, link_attempts = 0,
         channel_id = null, channel_resource_id = null, channel_expires_at = null, channel_next_at = null, busy_next_at = null, busy_requested_at = now();
  -- the new token may belong to another Google account: every event link is pushed again (an event we cannot find is written anew)
  update integrations.google_event_links set next_attempt_at = now(), attempts = 0 where tenant_id = p_tenant_id;
  insert into public.workspace_secrets (tenant_id, kind, secret_name, last4, fingerprint, set_by)
  values (p_tenant_id, 'google_calendar', app.gcal_secret_name(p_tenant_id), null, p_fingerprint, p_member_id)
  on conflict (tenant_id, kind) do update set secret_name = excluded.secret_name, last4 = null, fingerprint = excluded.fingerprint, set_by = excluded.set_by, set_at = now();
  perform app.write_audit_event(p_tenant_id, 'google_calendar.connect', 'google_calendar_link', (select x.id from integrations.google_calendar_links x where x.tenant_id = p_tenant_id), null, null,
                                jsonb_build_object('reconnect', old.id is not null));
  return app.gcal_status_json(p_tenant_id) || jsonb_build_object('stop_channel', v_stop);
end;
$$;

-- the worker's list: every link with what is due now. `erase` = the workspace was erased after the link was made: disconnect it.
create function public.scheduler_gcal_links(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.gcal_scheduler_gate();
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.gcal_error('invalid');
  end if;
  delete from integrations.google_calendar_states where expires_at < now() - interval '1 day';
  return coalesce((select jsonb_agg(x order by x.tenant_id) from (
    select l.tenant_id, l.status, l.calendar_id, l.write_events, l.block_busy, app.gcal_secret_name(l.tenant_id) as secret_name,
           l.channel_id, l.channel_resource_id, l.channel_expires_at, (l.google_email is null) as email_unknown,
           exists (select 1 from public.erasure_requests e where e.tenant_id = l.tenant_id and e.scope = 'tenant' and e.status = 'executed' and e.executed_at >= l.connected_at) as erase,
           (l.status = 'connected' and l.block_busy and coalesce(l.busy_next_at, '-infinity') <= now()
              and (l.busy_refreshed_at is null or l.busy_refreshed_at < now() - interval '30 minutes'
                   or (l.busy_requested_at > l.busy_refreshed_at and l.busy_refreshed_at < now() - interval '60 seconds'))) as busy_due,
           (l.status = 'connected' and l.block_busy and coalesce(l.channel_next_at, '-infinity') <= now()
              and (l.channel_id is null or l.channel_expires_at < now() + interval '1 day')) as channel_due,
           (l.status = 'connected' and l.write_events) as events_due
      from integrations.google_calendar_links l
     order by l.tenant_id
     limit p_limit) x), '[]'::jsonb);
end;
$$;

-- the appointments of one business whose event must be written, changed or deleted now (at most p_limit). The person is "first name + last initial" in the API; an erased person has no name here.
create function public.scheduler_gcal_visits_due(p_tenant_id uuid, p_limit integer default 25) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null or p_limit is null or p_limit not between 1 and 100 then
    perform app.gcal_error('invalid');
  end if;
  if not exists (select 1 from integrations.google_calendar_links l where l.tenant_id = p_tenant_id and l.status = 'connected' and l.write_events) then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(x order by x.starts_at, x.visit_id) from (
    select v.id as visit_id, v.starts_at, v.ends_at, v.status, v.party_size,
           case when v.purpose is null or v.purpose like 'erased:%' then null else v.purpose end as purpose,
           case when c.id is null or c.erased_at is not null or c.full_name like 'erased:%' then null else c.full_name end as person_name,
           v.updated_at as visit_updated_at,
           g.event_id, g.calendar_id as event_calendar_id, g.state as event_state, g.last_pushed_hash, coalesce(g.attempts, 0) as attempts
      from public.store_visits v
      left join integrations.google_event_links g on g.tenant_id = v.tenant_id and g.visit_id = v.id
      left join public.contacts c on c.tenant_id = v.tenant_id and c.id = v.contact_id
     where v.tenant_id = p_tenant_id
       and ((g.id is null and v.status in ('booked', 'confirmed', 'arrived') and v.ends_at > now())
            or (g.id is not null and g.state <> 'deleted' and g.next_attempt_at <= now()
                and (g.state = 'pending' or g.last_error_code is not null or v.updated_at > coalesce(g.visit_updated_at, '-infinity')
                     or (c.erased_at is not null and c.erased_at > coalesce(g.pushed_at, '-infinity')) or c.updated_at > coalesce(g.pushed_at, '-infinity'))))
     order by v.starts_at, v.id
     limit p_limit) x), '[]'::jsonb);
end;
$$;

-- a push went through: written (inserted or changed) or deleted (a cancelled appointment). Idempotent.
create function public.scheduler_gcal_event_done(p_tenant_id uuid, p_visit_id uuid, p_event_id text, p_state text, p_hash text, p_visit_updated_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null or p_visit_id is null or p_event_id is null or p_event_id !~ '^[a-v0-9]{5,255}$' or p_state not in ('written', 'deleted')
     or (p_hash is not null and p_hash !~ '^[0-9a-f]{64}$') or p_visit_updated_at is null then
    perform app.gcal_error('invalid');
  end if;
  insert into integrations.google_event_links (tenant_id, visit_id, calendar_id, event_id, state, last_pushed_hash, visit_updated_at, pushed_at, attempts, next_attempt_at, last_error_code)
  values (p_tenant_id, p_visit_id, 'primary', p_event_id, p_state, p_hash, p_visit_updated_at, now(), 0, now(), null)
  on conflict (tenant_id, visit_id) do update
     set event_id = excluded.event_id, state = excluded.state, last_pushed_hash = excluded.last_pushed_hash, visit_updated_at = excluded.visit_updated_at,
         pushed_at = now(), attempts = 0, next_attempt_at = now(), last_error_code = null;
  update integrations.google_calendar_links set last_synced_at = now(), last_error_code = null where tenant_id = p_tenant_id;
  return jsonb_build_object('visit_id', p_visit_id, 'state', p_state);
end;
$$;

-- a push failed: tried again later, 2^attempts minutes (at most 6 hours)
create function public.scheduler_gcal_event_failed(p_tenant_id uuid, p_visit_id uuid, p_event_id text, p_error_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g integrations.google_event_links;
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null or p_visit_id is null or p_event_id is null or p_event_id !~ '^[a-v0-9]{5,255}$' or p_error_code is null or p_error_code !~ '^[a-z][a-z_]{1,39}$' then
    perform app.gcal_error('invalid');
  end if;
  insert into integrations.google_event_links (tenant_id, visit_id, calendar_id, event_id, state, attempts, next_attempt_at, last_error_code)
  values (p_tenant_id, p_visit_id, 'primary', p_event_id, 'pending', 1, now() + interval '1 minute', p_error_code)
  on conflict (tenant_id, visit_id) do update
     set attempts = least(google_event_links.attempts + 1, 1000),
         next_attempt_at = now() + least(power(2, least(google_event_links.attempts + 1, 9)), 360) * interval '1 minute',
         last_error_code = excluded.last_error_code
  returning * into g;
  update integrations.google_calendar_links set last_error_code = p_error_code where tenant_id = p_tenant_id;
  return jsonb_build_object('visit_id', p_visit_id, 'attempts', g.attempts, 'next_attempt_at', g.next_attempt_at);
end;
$$;

-- a link-level failure (`busy` or `channel` work, or the token itself). A revoked token marks the link needs_reconnect: the worker leaves it alone until the Owner connects again (never a loop).
create function public.scheduler_gcal_link_failed(p_tenant_id uuid, p_work text, p_error_code text, p_needs_reconnect boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.google_calendar_links;
  v_wait interval;
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null or p_work not in ('token', 'busy', 'channel') or p_error_code is null or p_error_code !~ '^[a-z][a-z_]{1,39}$' or p_needs_reconnect is null then
    perform app.gcal_error('invalid');
  end if;
  select * into l from integrations.google_calendar_links x where x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.gcal_error('not_connected');
  end if;
  v_wait := least(power(2, least(l.link_attempts + 1, 9)), 360) * interval '1 minute';
  update integrations.google_calendar_links
     set last_error_code = p_error_code, link_attempts = least(link_attempts + 1, 1000),
         status = case when p_needs_reconnect then 'needs_reconnect' else status end,
         busy_next_at = case when p_work in ('busy', 'token') then now() + v_wait else busy_next_at end,
         channel_next_at = case when p_work in ('channel', 'token') then now() + v_wait else channel_next_at end
   where tenant_id = p_tenant_id
  returning * into l;
  if p_needs_reconnect then
    perform app.write_audit_event(p_tenant_id, 'google_calendar.needs_reconnect', 'google_calendar_link', l.id, null, null, jsonb_build_object('code', p_error_code));
  end if;
  return jsonb_build_object('status', l.status, 'last_error_code', l.last_error_code);
end;
$$;

-- the busy times, fetched: the WHOLE set of the business is replaced (written as a difference: an unchanged block is not rewritten). Nothing is kept when block_busy is off.
create function public.scheduler_gcal_busy_replace(p_tenant_id uuid, p_blocks jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.google_calendar_links;
  v_s timestamptz[] := '{}';
  v_e timestamptz[] := '{}';
  n_in integer;
  n_out integer;
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null or p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 2000 then
    perform app.gcal_error('invalid');
  end if;
  select * into l from integrations.google_calendar_links x where x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.gcal_error('not_connected');
  end if;
  if l.block_busy and l.status = 'connected' then
    begin
      select coalesce(array_agg(z.s order by z.s, z.e), '{}'), coalesce(array_agg(z.e order by z.s, z.e), '{}') into v_s, v_e
        from (select distinct (b ->> 'start')::timestamptz as s, (b ->> 'end')::timestamptz as e from jsonb_array_elements(p_blocks) b) z;
    exception when others then
      perform app.gcal_error('invalid');
    end;
    if exists (select 1 from unnest(v_s, v_e) u(s, e) where u.s is null or u.e is null or u.e <= u.s or u.e - u.s > interval '62 days') then
      perform app.gcal_error('invalid');
    end if;
  end if;
  delete from public.calendar_busy b where b.tenant_id = p_tenant_id and b.source = 'google'
     and not exists (select 1 from unnest(v_s, v_e) u(s, e) where u.s = b.starts_at and u.e = b.ends_at);
  get diagnostics n_out = row_count;
  insert into public.calendar_busy (tenant_id, source, starts_at, ends_at)
  select p_tenant_id, 'google', u.s, u.e from unnest(v_s, v_e) u(s, e)
   where not exists (select 1 from public.calendar_busy b where b.tenant_id = p_tenant_id and b.source = 'google' and b.starts_at = u.s and b.ends_at = u.e);
  get diagnostics n_in = row_count;
  update integrations.google_calendar_links
     set busy_refreshed_at = now(), last_synced_at = now(), busy_next_at = null, link_attempts = 0, last_error_code = null
   where tenant_id = p_tenant_id;
  return jsonb_build_object('added', n_in, 'removed', n_out, 'blocks', (select count(*) from public.calendar_busy b where b.tenant_id = p_tenant_id));
end;
$$;

-- the events WE wrote that are still in the calendar, with the times we wrote: they are subtracted from Google's busy times (freebusy cannot tell whose an event is). `current` = the last push
-- carried the appointment as it is now; for the others the worker asks Google for that one event (events.get of OUR event id only, never a list of the calendar).
create function public.scheduler_gcal_own_events(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.gcal_scheduler_gate();
  return coalesce((select jsonb_agg(jsonb_build_object('visit_id', v.id, 'event_id', g.event_id, 'starts_at', v.starts_at, 'ends_at', v.ends_at,
                                                       'current', g.last_error_code is null and g.visit_updated_at >= v.updated_at and v.status <> 'cancelled') order by v.starts_at, v.id)
                     from integrations.google_event_links g
                     join public.store_visits v on v.tenant_id = g.tenant_id and v.id = g.visit_id
                    where g.tenant_id = p_tenant_id and g.state = 'written' and v.ends_at > now() - interval '1 day'), '[]'::jsonb);
end;
$$;

-- a new push channel (events.watch) is open: kept, and the one it replaces is handed back to be stopped
create function public.scheduler_gcal_channel_set(p_tenant_id uuid, p_channel_id uuid, p_resource_id text, p_expires_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.google_calendar_links;
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null or p_channel_id is null or p_resource_id is null or p_resource_id !~ '^[A-Za-z0-9_.-]{1,200}$' or p_expires_at is null or p_expires_at <= now() then
    perform app.gcal_error('invalid');
  end if;
  select * into l from integrations.google_calendar_links x where x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.gcal_error('not_connected');
  end if;
  update integrations.google_calendar_links
     set channel_id = p_channel_id, channel_resource_id = p_resource_id, channel_expires_at = p_expires_at, channel_next_at = null, link_attempts = 0
   where tenant_id = p_tenant_id;
  return jsonb_build_object('stop_channel', case when l.channel_id is not null and l.channel_id <> p_channel_id
                                                 then jsonb_build_object('channel_id', l.channel_id, 'channel_resource_id', l.channel_resource_id) end);
end;
$$;

-- Google's push notification: which business is that channel (the API then compares the channel token from Secret Manager in constant time)
create function public.scheduler_gcal_channel_lookup(p_channel_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.gcal_scheduler_gate();
  return (select jsonb_build_object('tenant_id', l.tenant_id, 'secret_name', app.gcal_secret_name(l.tenant_id), 'channel_resource_id', l.channel_resource_id)
            from integrations.google_calendar_links l where l.channel_id = p_channel_id and l.status = 'connected' and l.block_busy);
end;
$$;

-- a verified notification: refresh the busy times (the worker debounces: at most once a minute)
create function public.scheduler_gcal_busy_request(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.gcal_scheduler_gate();
  update integrations.google_calendar_links set busy_requested_at = now() where tenant_id = p_tenant_id and status = 'connected' and block_busy;
  return jsonb_build_object('requested', found);
end;
$$;

-- the Google address the link belongs to, once Google named it (the organizer of the first event we wrote)
create function public.scheduler_gcal_email(p_tenant_id uuid, p_google_email text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null or p_google_email is null or p_google_email !~ '^[^[:space:][:cntrl:]@]{1,64}@[^[:space:][:cntrl:]@]{1,255}$' then
    perform app.gcal_error('invalid');
  end if;
  update integrations.google_calendar_links set google_email = lower(p_google_email) where tenant_id = p_tenant_id and google_email is distinct from lower(p_google_email);
  return jsonb_build_object('ok', true);
end;
$$;

-- the worker's disconnect (the workspace was erased; the token was revoked and the secret deleted first)
create function public.scheduler_gcal_disconnect(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.gcal_scheduler_gate();
  if p_tenant_id is null then
    perform app.gcal_error('invalid');
  end if;
  return app.gcal_forget(p_tenant_id);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.google_calendar_status(uuid)', 'public.google_calendar_connect_start(uuid)', 'public.google_calendar_ref(uuid)', 'public.google_calendar_settings_set(uuid, boolean, boolean)',
    'public.google_calendar_sync_now(uuid)', 'public.google_calendar_disconnect(uuid)',
    'public.scheduler_gcal_state_use(uuid, uuid, uuid)', 'public.scheduler_gcal_connected(uuid, uuid, text)', 'public.scheduler_gcal_links(integer)', 'public.scheduler_gcal_visits_due(uuid, integer)',
    'public.scheduler_gcal_event_done(uuid, uuid, text, text, text, timestamptz)', 'public.scheduler_gcal_event_failed(uuid, uuid, text, text)',
    'public.scheduler_gcal_link_failed(uuid, text, text, boolean)', 'public.scheduler_gcal_busy_replace(uuid, jsonb)', 'public.scheduler_gcal_own_events(uuid)', 'public.scheduler_gcal_channel_set(uuid, uuid, text, timestamptz)',
    'public.scheduler_gcal_channel_lookup(uuid)', 'public.scheduler_gcal_busy_request(uuid)', 'public.scheduler_gcal_email(uuid, text)', 'public.scheduler_gcal_disconnect(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
