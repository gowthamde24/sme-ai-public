-- Calendars in (docs/contracts/commerce-notify.md section D; switch CALENDAR_IN): a booking made on the owner's own Calendly or Cal.com page becomes a visit, and an Outlook / Microsoft 365 calendar
-- can be linked the way Google Calendar is (appointments out as events, busy times back as busy blocks).
--   integrations.calendar_connections   one row per workspace and connector (calendly, calcom, outlook): state, a label, the last four characters of the key, the owner's booking-page address, the
--                                       "share my booking link" switch, the webhook door's hash (calendly, calcom) and the Outlook settings. NEVER a key, a token or a signing secret: those live in
--                                       Secret Manager (the workspace-secrets store, `sme-ws-<workspace>-conn-<connector>`).
--   integrations.calendar_bookings      one row per booking the vendor told us about (idempotency): the vendor's own booking id, what we did with it (booked: a visit; cancelled; needs_person:
--                                       it did not fit a free slot, so a person must place it) and the time. No name, number or e-mail address.
--   integrations.calendar_event_links   Outlook only: which Outlook event we made for which visit (our transactionId, the event id Outlook gave, the hash of what was sent), as google_event_links.
--   integrations.calendar_states        the one-time nonce of an Outlook authorization in flight (10 minutes, once).
--   public.calendar_busy                (existing) its source check now also allows 'outlook'; the slot function already asks "is any block busy" whatever the source.
-- A booking from a vendor is placed through the SAME slot engine as every other visit (app.visit_claim_slot: hours, closed days, slot grid, capacity, staff, busy blocks); a booking that does not fit is
-- never forced in: it is recorded as needs_person and the lead is kept. Who: the Owner and Admin connect, change and disconnect (the Owner connects Outlook); every member reads; the registered
-- SCHEDULER account (app.is_scheduler()) serves the vendors' webhook door and the worker.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, SM306 second factor, SM891 not connected, SM892 not in a state that allows this (a used or expired authorization, too many open ones).

create function app.cal_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'       then raise exception 'invalid input' using errcode = '22023';
    when 'not_connected' then raise exception 'this calendar is not connected' using errcode = 'SM891';
    when 'state'         then raise exception 'not in a state that allows this' using errcode = 'SM892';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.cal_error(text) from public, anon, authenticated, service_role;

create function app.cal_scheduler_gate() returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.cal_error('deny');
  end if;
end;
$$;
revoke all on function app.cal_scheduler_gate() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.calendar_connections (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id),
  kind               text not null check (kind in ('calendly', 'calcom', 'outlook')),
  status             text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  label              text check (char_length(label) between 1 and 80 and app.text_is_clean(label)),
  secret_last4       text check (secret_last4 ~ '^[A-Za-z0-9]{4}$'),
  booking_link       text check (char_length(booking_link) <= 255 and booking_link ~ '^https://[A-Za-z0-9.-]{1,253}(/[!-~]*)?$'),
  share_link         boolean not null default false,
  consent_question   text check (char_length(consent_question) between 10 and 200 and app.text_is_clean(consent_question)),
  hook_hash          text unique check (hook_hash ~ '^[0-9a-f]{64}$'),
  hook_ref           text check (hook_ref ~ '^https://api\.calendly\.com/webhook_subscriptions/[A-Za-z0-9_-]{4,100}$'),
  member_id          uuid,
  write_events       boolean not null default true,
  block_busy         boolean not null default false,
  busy_requested_at  timestamptz,
  busy_refreshed_at  timestamptz,
  busy_next_at       timestamptz,
  link_attempts      smallint not null default 0 check (link_attempts between 0 and 1000),
  last_synced_at     timestamptz,
  last_event_at      timestamptz,
  last_error_code    text check (last_error_code ~ '^[a-z][a-z_]{1,39}$'),
  connected_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, kind),
  check (kind = 'outlook' or hook_hash is not null),
  check (kind = 'outlook' or member_id is null),
  check (kind = 'calendly' or hook_ref is null)
);
comment on table integrations.calendar_connections is 'A workspace''s Calendly, Cal.com or Outlook link (one per connector). Never a key: the keys are in Secret Manager. Written only by the calendar_* and scheduler_cal_* functions.';
comment on column integrations.calendar_connections.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column integrations.calendar_connections.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column integrations.calendar_connections.label is 'SAFE: the owner''s own words for the link (for example the name of the booking page); shown to members.';
comment on column integrations.calendar_connections.secret_last4 is 'SAFE: the last four characters of the key, to tell keys apart. CLEAN-EXEMPT: strict pattern';
comment on column integrations.calendar_connections.booking_link is 'SAFE: the https address of the owner''s public booking page (said to customers only when share_link is on). CLEAN-EXEMPT: strict anchored pattern';
comment on column integrations.calendar_connections.consent_question is 'SAFE: the owner''s own words: the one question of their booking form that is the customer''s permission to be called or messaged (a non-empty answer that is not a no counts as consent). Their text, not the customer''s.';
comment on column integrations.calendar_connections.hook_hash is 'SAFE: SHA-256 of the long random address the vendor posts to (the address itself is shown once and never stored). CLEAN-EXEMPT: strict pattern';
comment on column integrations.calendar_connections.hook_ref is 'SAFE: Calendly''s own id of the webhook subscription we made, to remove it on disconnect. CLEAN-EXEMPT: strict anchored pattern';
comment on column integrations.calendar_connections.member_id is 'SAFE: the user id of the Owner who connected Outlook. CLEAN-EXEMPT: uuid';
comment on column integrations.calendar_connections.last_error_code is 'SAFE: a closed code word of the last failure (never the vendor''s text). CLEAN-EXEMPT: strict pattern';

create table integrations.calendar_bookings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id),
  kind        text not null check (kind in ('calendly', 'calcom')),
  external_id text not null check (char_length(external_id) between 1 and 255 and external_id ~ '^[!-~]+$'),
  state       text not null check (state in ('booked', 'cancelled', 'needs_person')),
  reason      text check (reason ~ '^[a-z][a-z_]{1,29}$'),
  visit_id    uuid,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, kind, external_id),
  foreign key (tenant_id, visit_id) references public.store_visits (tenant_id, id),
  check (ends_at > starts_at)
);
create index calendar_bookings_recent_idx on integrations.calendar_bookings (tenant_id, created_at desc);
create index calendar_bookings_visit_idx on integrations.calendar_bookings (tenant_id, visit_id) where visit_id is not null;
comment on table integrations.calendar_bookings is 'A booking the vendor told us about: its own booking id and what we did with it. No name, number or e-mail address. Volume: no audit trigger.';
comment on column integrations.calendar_bookings.external_id is 'SAFE: the vendor''s own booking id (a Calendly invitee address or a Cal.com booking uid). CLEAN-EXEMPT: strict pattern';
comment on column integrations.calendar_bookings.state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column integrations.calendar_bookings.reason is 'SAFE: a closed word (no_lead, closed, slot, full, past, already). CLEAN-EXEMPT: strict pattern';

create table integrations.calendar_event_links (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id),
  visit_id         uuid not null,
  txn_id           text not null check (txn_id ~ '^s19[0-9a-f]{32}$'),
  event_id         text check (char_length(event_id) between 5 and 400 and event_id ~ '^[A-Za-z0-9_=+/-]+$'),
  state            text not null default 'pending' check (state in ('pending', 'written', 'deleted')),
  last_pushed_hash text check (last_pushed_hash ~ '^[0-9a-f]{64}$'),
  visit_updated_at timestamptz,
  pushed_at        timestamptz,
  attempts         smallint not null default 0 check (attempts between 0 and 1000),
  next_attempt_at  timestamptz not null default now(),
  last_error_code  text check (last_error_code ~ '^[a-z][a-z_]{1,39}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, visit_id),
  foreign key (tenant_id, visit_id) references public.store_visits (tenant_id, id)
);
create index calendar_event_links_due_idx on integrations.calendar_event_links (tenant_id, next_attempt_at);
comment on table integrations.calendar_event_links is 'Which Outlook event we made for which appointment and the state of its last push (the hash of what was sent, never the event''s text). Volume: no audit trigger.';
comment on column integrations.calendar_event_links.txn_id is 'SAFE: the transactionId WE chose (s19 + the visit id in hex). CLEAN-EXEMPT: strict pattern';
comment on column integrations.calendar_event_links.event_id is 'SAFE: the id Outlook gave the event we made. CLEAN-EXEMPT: strict pattern';
comment on column integrations.calendar_event_links.state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column integrations.calendar_event_links.last_pushed_hash is 'SAFE: a SHA-256 of the event body last sent. CLEAN-EXEMPT: strict pattern';
comment on column integrations.calendar_event_links.last_error_code is 'SAFE: a closed code word. CLEAN-EXEMPT: strict pattern';

create table integrations.calendar_states (
  nonce      uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id),
  member_id  uuid not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index calendar_states_tenant_idx on integrations.calendar_states (tenant_id, created_at);
comment on table integrations.calendar_states is 'The one-time nonce of an Outlook authorization in flight (10 minutes, once). No token, no code.';

do $$
declare
  t text;
begin
  foreach t in array array['integrations.calendar_connections', 'integrations.calendar_bookings', 'integrations.calendar_event_links', 'integrations.calendar_states'] loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format('revoke all on %s from public, anon, authenticated, service_role', t);
    execute format('create trigger %I before update on %s for each row execute function app.forbid_tenant_id_change()', replace(t, '.', '_') || '_forbid_tenant_id_change', t);
  end loop;
end $$;
create trigger calendar_connections_set_updated_at before update on integrations.calendar_connections for each row execute function app.set_updated_at();
create trigger calendar_bookings_set_updated_at before update on integrations.calendar_bookings for each row execute function app.set_updated_at();
create trigger calendar_event_links_set_updated_at before update on integrations.calendar_event_links for each row execute function app.set_updated_at();
-- connections are audited by the functions below (connect, settings, disconnect: closed words, never the address); the worker touches them every few minutes

-- the busy blocks: a second source
do $$
declare
  c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.calendar_busy'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source%';
  if c is not null then
    execute format('alter table public.calendar_busy drop constraint %I', c);
  end if;
end $$;
alter table public.calendar_busy add constraint calendar_busy_source_check check (source in ('google', 'outlook'));
comment on column public.calendar_busy.source is 'SAFE: a closed word (google, outlook). CLEAN-EXEMPT: closed CHECK list';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.cal_connection_json(c integrations.calendar_connections) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', c.kind, 'status', c.status, 'label', c.label, 'last4', c.secret_last4, 'booking_link', c.booking_link, 'share_link', c.share_link, 'consent_question', c.consent_question,
    'write_events', case when c.kind = 'outlook' then c.write_events else null end, 'block_busy', case when c.kind = 'outlook' then c.block_busy else null end,
    'last_event_at', c.last_event_at, 'last_synced_at', c.last_synced_at, 'last_error_code', c.last_error_code, 'connected_at', c.connected_at,
    'counts_30d', jsonb_build_object(
      'booked', (select count(*) from integrations.calendar_bookings b where b.tenant_id = c.tenant_id and b.kind = c.kind and b.state = 'booked' and b.created_at > now() - interval '30 days'),
      'cancelled', (select count(*) from integrations.calendar_bookings b where b.tenant_id = c.tenant_id and b.kind = c.kind and b.state = 'cancelled' and b.updated_at > now() - interval '30 days'),
      'needs_person', (select count(*) from integrations.calendar_bookings b where b.tenant_id = c.tenant_id and b.kind = c.kind and b.state = 'needs_person' and b.created_at > now() - interval '30 days')))
$$;
revoke all on function app.cal_connection_json(integrations.calendar_connections) from public, anon, authenticated, service_role;

-- everything OUR copy holds of one connector. Events already in the owner's calendar stay (they are the owner's).
create function app.cal_forget(p_tenant uuid, p_kind text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_link integer;
  n_busy integer := 0;
  n_events integer := 0;
begin
  if p_kind = 'outlook' then
    delete from integrations.calendar_event_links where tenant_id = p_tenant;
    get diagnostics n_events = row_count;
    delete from public.calendar_busy where tenant_id = p_tenant and source = 'outlook';
    get diagnostics n_busy = row_count;
    delete from integrations.calendar_states where tenant_id = p_tenant;
  end if;
  delete from integrations.calendar_connections where tenant_id = p_tenant and kind = p_kind;
  get diagnostics n_link = row_count;
  if n_link > 0 then
    perform app.write_audit_event(p_tenant, 'calendar.disconnect', 'calendar_connection', null, null, null, jsonb_build_object('kind', p_kind, 'event_links', n_events, 'busy_blocks', n_busy));
  end if;
  return jsonb_build_object('disconnected', n_link > 0, 'event_links', n_events, 'busy_blocks', n_busy);
end;
$$;
revoke all on function app.cal_forget(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the people's functions
-- ---------------------------------------------------------------------------------------------------------------------------------
-- any member: the connectors and their state (never a key, an address of the door, or where a secret is)
create function public.calendar_connections_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.cal_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.cal_connection_json(c) order by c.kind) from integrations.calendar_connections c where c.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;

-- Owner or Admin: Calendly or Cal.com connected (the API made the door's address and keeps the key in Secret Manager; here only its hash and the last four characters)
create function public.calendar_connection_save(p_tenant_id uuid, p_kind text, p_label text, p_last4 text, p_booking_link text, p_hook_hash text, p_hook_ref text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c integrations.calendar_connections;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.cal_error('deny');
  end if;
  perform app.require_aal2();
  if p_kind is null or p_kind not in ('calendly', 'calcom') then
    perform app.cal_error('invalid');
  end if;
  begin
    insert into integrations.calendar_connections (tenant_id, kind, label, secret_last4, booking_link, hook_hash, hook_ref)
    values (p_tenant_id, p_kind, nullif(btrim(p_label), ''), nullif(p_last4, ''), nullif(btrim(p_booking_link), ''), p_hook_hash, p_hook_ref)
    on conflict (tenant_id, kind) do update
       set label = excluded.label, secret_last4 = excluded.secret_last4, booking_link = coalesce(excluded.booking_link, integrations.calendar_connections.booking_link),
           hook_hash = excluded.hook_hash, hook_ref = excluded.hook_ref, status = 'connected', last_error_code = null, connected_at = now()
    returning * into c;
  exception when invalid_text_representation or check_violation or not_null_violation or unique_violation then
    perform app.cal_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'calendar.connect', 'calendar_connection', c.id, null, null, jsonb_build_object('kind', p_kind));
  return app.cal_connection_json(c);
end;
$$;

-- Owner or Admin: the booking page address, "share my booking link", and (Outlook) write events / block busy times. A null leaves it as it is; an empty address removes it.
create function public.calendar_connection_settings(p_tenant_id uuid, p_kind text, p_booking_link text default null, p_share_link boolean default null, p_write_events boolean default null, p_block_busy boolean default null, p_consent_question text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c integrations.calendar_connections;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.cal_error('deny');
  end if;
  select * into c from integrations.calendar_connections x where x.tenant_id = p_tenant_id and x.kind = p_kind for update;
  if not found then
    perform app.cal_error('not_connected');
  end if;
  if (p_write_events is not null or p_block_busy is not null) and c.kind <> 'outlook' then
    perform app.cal_error('invalid');
  end if;
  if p_share_link is true and coalesce(case when p_booking_link is null then c.booking_link else nullif(btrim(p_booking_link), '') end, '') = '' then
    perform app.cal_error('invalid');   -- there is no address to share
  end if;
  begin
    update integrations.calendar_connections
       set booking_link = case when p_booking_link is null then booking_link else nullif(btrim(p_booking_link), '') end,
           share_link = case when case when p_booking_link is null then booking_link else nullif(btrim(p_booking_link), '') end is null then false else coalesce(p_share_link, share_link) end,
           consent_question = case when p_consent_question is null then consent_question else nullif(btrim(p_consent_question), '') end,
           write_events = coalesce(p_write_events, write_events),
           block_busy = coalesce(p_block_busy, block_busy),
           busy_requested_at = case when p_block_busy is true and not block_busy then now() else busy_requested_at end,
           busy_next_at = case when p_block_busy is true and not block_busy then null else busy_next_at end
     where id = c.id returning * into c;
  exception when check_violation then
    perform app.cal_error('invalid');
  end;
  if p_block_busy is false then
    delete from public.calendar_busy where tenant_id = p_tenant_id and source = 'outlook';
  end if;
  perform app.write_audit_event(p_tenant_id, 'calendar.settings', 'calendar_connection', c.id,
                                jsonb_build_object('share_link', c.share_link, 'write_events', c.write_events, 'block_busy', c.block_busy), null, jsonb_build_object('kind', c.kind));
  return app.cal_connection_json(c);
end;
$$;

-- Owner or Admin: what the API needs to take a connector down at the vendor (Calendly's subscription id); never a key
create function public.calendar_connection_ref(p_tenant_id uuid, p_kind text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c integrations.calendar_connections;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.cal_error('deny');
  end if;
  select * into c from integrations.calendar_connections x where x.tenant_id = p_tenant_id and x.kind = p_kind;
  if not found then
    perform app.cal_error('not_connected');
  end if;
  return jsonb_build_object('kind', c.kind, 'hook_ref', c.hook_ref, 'consent_question', c.consent_question);
end;
$$;

create function public.calendar_connection_disconnect(p_tenant_id uuid, p_kind text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.cal_error('deny');
  end if;
  perform app.require_aal2();
  if p_kind is null or p_kind not in ('calendly', 'calcom', 'outlook') then
    perform app.cal_error('invalid');
  end if;
  return app.cal_forget(p_tenant_id, p_kind);
end;
$$;

-- the Owner starts an Outlook authorization: a one-time nonce (the API signs it into the OAuth state)
create function public.calendar_outlook_start(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s integrations.calendar_states;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.cal_error('deny');
  end if;
  perform app.require_aal2();
  delete from integrations.calendar_states x where x.tenant_id = p_tenant_id and x.expires_at < now() - interval '1 day';
  if (select count(*) from integrations.calendar_states x where x.tenant_id = p_tenant_id and x.used_at is null and x.expires_at > now()) >= 5 then
    perform app.cal_error('state');
  end if;
  insert into integrations.calendar_states (tenant_id, member_id, expires_at) values (p_tenant_id, auth.uid(), now() + interval '10 minutes') returning * into s;
  return jsonb_build_object('nonce', s.nonce, 'member_id', s.member_id, 'expires_at', s.expires_at);
end;
$$;

-- any member: the latest bookings that need a person (they did not fit a free slot), and the counts; ids and times only
create function public.calendar_bookings_list(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.cal_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.cal_error('invalid');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'state', x.state, 'reason', x.reason, 'visit_id', x.visit_id, 'starts_at', x.starts_at, 'ends_at', x.ends_at, 'created_at', x.created_at)
                                   order by x.created_at desc)
                     from (select * from integrations.calendar_bookings b where b.tenant_id = p_tenant_id and b.state = 'needs_person' order by b.created_at desc limit p_limit) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the scheduler account: the vendors' webhook door
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the door's address -> which workspace and connector (null when unknown)
create function public.scheduler_calendar_hook(p_hook_hash text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c integrations.calendar_connections;
begin
  perform app.cal_scheduler_gate();
  if p_hook_hash is null or p_hook_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into c from integrations.calendar_connections x where x.hook_hash = p_hook_hash;
  if not found then
    return null;
  end if;
  return jsonb_build_object('tenant_id', c.tenant_id, 'kind', c.kind, 'consent_question', c.consent_question);
end;
$$;

-- a booking arrived (or moved): the lead is found by the number or the e-mail address (the API already stored it through the lead intake), the slot is claimed through the visits engine, the visit made.
-- Idempotent on (workspace, connector, the vendor's booking id). A booking that does not fit is recorded as needs_person with a closed reason; nothing is forced in.
create function public.scheduler_calendar_booking_apply(p_tenant_id uuid, p_kind text, p_external_id text, p_phone text, p_email text, p_starts_at timestamptz, p_ends_at timestamptz, p_purpose text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b       integrations.calendar_bookings;
  v_lead  public.leads;
  v_contact public.contacts;
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
  v_local timestamp;
  v_slot  record;
  v_visit uuid;
  v_state text := 'booked';
  v_reason text := null;
  v_old   public.store_visits;
begin
  perform app.cal_scheduler_gate();
  if p_tenant_id is null or p_kind is null or p_kind not in ('calendly', 'calcom') or p_external_id is null or p_external_id !~ '^[!-~]{1,255}$'
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '12 hours' then
    perform app.cal_error('invalid');
  end if;
  if v_purpose is not null and (char_length(v_purpose) > 200 or not app.text_is_clean(v_purpose)) then
    v_purpose := null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar_booking:' || p_tenant_id::text || ':' || p_kind || ':' || p_external_id, 0));
  select * into b from integrations.calendar_bookings x where x.tenant_id = p_tenant_id and x.kind = p_kind and x.external_id = p_external_id for update;
  if found then
    if b.state = 'cancelled' then
      return jsonb_build_object('state', 'cancelled', 'replayed', true, 'visit_id', b.visit_id);   -- a late "created" after its own cancellation: ignored
    end if;
    if b.starts_at = p_starts_at and b.ends_at = p_ends_at and b.state in ('booked', 'needs_person') then
      return jsonb_build_object('state', b.state, 'reason', b.reason, 'replayed', true, 'visit_id', b.visit_id);
    end if;
    -- moved to another time: the old visit is cancelled, the new time is placed below
    if b.visit_id is not null then
      select * into v_old from public.store_visits where tenant_id = p_tenant_id and id = b.visit_id for update;
      if found and v_old.status in ('booked', 'confirmed') then
        update public.store_visits set status = 'cancelled', closed_at = app.visit_now(), cancel_reason = 'Moved on the booking page', updated_by = auth.uid() where id = v_old.id;
      end if;
    end if;
  end if;

  select l.* into v_lead from public.leads l join public.contacts c on c.id = l.contact_id and c.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant_id and l.archived_at is null and c.erased_at is null
     and ((p_phone is not null and c.phone = p_phone) or (p_email is not null and lower(c.email) = lower(p_email)))
   order by l.created_at desc limit 1;
  if not found then
    v_state := 'needs_person';
    v_reason := 'no_lead';
  else
    select * into v_contact from public.contacts c where c.id = v_lead.contact_id and c.tenant_id = p_tenant_id;
    v_local := p_starts_at at time zone 'Asia/Kolkata';
    begin
      select * into v_slot from app.visit_claim_slot(p_tenant_id, v_local::date, to_char(v_local, 'HH24:MI'), null, null);
      if exists (select 1 from public.store_visits x where x.tenant_id = p_tenant_id and x.lead_id = v_lead.id and x.starts_at = v_slot.o_starts and x.status in ('booked', 'confirmed', 'arrived')) then
        select x.id into v_visit from public.store_visits x where x.tenant_id = p_tenant_id and x.lead_id = v_lead.id and x.starts_at = v_slot.o_starts and x.status in ('booked', 'confirmed', 'arrived') limit 1;
        v_reason := 'already';
      else
        v_visit := gen_random_uuid();
        insert into public.store_visits
          (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, party_size, purpose, source, request_sha256, created_by, created_at, updated_by, staff_id, buffer_minutes)
        values
          (v_visit, p_tenant_id, v_lead.id, v_contact.id, v_lead.company_id, v_local::date, v_slot.o_starts, v_slot.o_ends, 1, v_purpose, 'staff',
           encode(sha256(convert_to('calendar|' || p_kind || '|' || p_external_id, 'UTF8')), 'hex'), auth.uid(), app.visit_now(), auth.uid(),
           v_slot.o_staff, coalesce((v_slot.o_set ->> 'buffer_minutes')::smallint, 0));
      end if;
    exception
      when sqlstate 'SM511' then v_state := 'needs_person'; v_reason := 'closed'; v_visit := null;
      when sqlstate 'SM512' then v_state := 'needs_person'; v_reason := 'slot'; v_visit := null;
      when sqlstate 'SM513' then v_state := 'needs_person'; v_reason := 'full'; v_visit := null;
      when sqlstate 'SM514' then v_state := 'needs_person'; v_reason := 'past'; v_visit := null;
      when exclusion_violation then v_state := 'needs_person'; v_reason := 'full'; v_visit := null;
      when sqlstate '22023' then v_state := 'needs_person'; v_reason := 'slot'; v_visit := null;
    end;
  end if;

  insert into integrations.calendar_bookings (tenant_id, kind, external_id, state, reason, visit_id, starts_at, ends_at)
  values (p_tenant_id, p_kind, p_external_id, v_state, v_reason, v_visit, p_starts_at, p_ends_at)
  on conflict (tenant_id, kind, external_id) do update
     set state = excluded.state, reason = excluded.reason, visit_id = excluded.visit_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at;
  update integrations.calendar_connections set last_event_at = now(), last_error_code = null where tenant_id = p_tenant_id and kind = p_kind;
  return jsonb_build_object('state', v_state, 'reason', v_reason, 'replayed', false, 'visit_id', v_visit);
end;
$$;

-- a booking was cancelled: the visit that came from it is cancelled (once); an unknown booking is recorded as cancelled so a late "created" cannot book it
create function public.scheduler_calendar_booking_cancel(p_tenant_id uuid, p_kind text, p_external_id text, p_starts_at timestamptz default null, p_ends_at timestamptz default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b integrations.calendar_bookings;
  v public.store_visits;
begin
  perform app.cal_scheduler_gate();
  if p_tenant_id is null or p_kind is null or p_kind not in ('calendly', 'calcom') or p_external_id is null or p_external_id !~ '^[!-~]{1,255}$' then
    perform app.cal_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar_booking:' || p_tenant_id::text || ':' || p_kind || ':' || p_external_id, 0));
  select * into b from integrations.calendar_bookings x where x.tenant_id = p_tenant_id and x.kind = p_kind and x.external_id = p_external_id for update;
  if not found then
    if p_starts_at is not null and p_ends_at is not null and p_ends_at > p_starts_at then
      insert into integrations.calendar_bookings (tenant_id, kind, external_id, state, reason, starts_at, ends_at) values (p_tenant_id, p_kind, p_external_id, 'cancelled', null, p_starts_at, p_ends_at);
    end if;
    update integrations.calendar_connections set last_event_at = now() where tenant_id = p_tenant_id and kind = p_kind;
    return jsonb_build_object('state', 'cancelled', 'replayed', false, 'visit_id', null);
  end if;
  if b.state = 'cancelled' then
    return jsonb_build_object('state', 'cancelled', 'replayed', true, 'visit_id', b.visit_id);
  end if;
  if b.visit_id is not null then
    select * into v from public.store_visits x where x.tenant_id = p_tenant_id and x.id = b.visit_id for update;
    if found and v.status in ('booked', 'confirmed') then
      update public.store_visits set status = 'cancelled', closed_at = app.visit_now(), cancel_reason = 'Cancelled on the booking page', updated_by = auth.uid() where id = v.id;
    end if;
  end if;
  update integrations.calendar_bookings set state = 'cancelled' where id = b.id;
  update integrations.calendar_connections set last_event_at = now() where tenant_id = p_tenant_id and kind = p_kind;
  return jsonb_build_object('state', 'cancelled', 'replayed', false, 'visit_id', b.visit_id);
end;
$$;

-- the owner's booking page address, only when they switched "share my booking link" on (the phone assistant and the WhatsApp reply read it); null otherwise
create function public.scheduler_calendar_booking_link(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c integrations.calendar_connections;
begin
  perform app.cal_scheduler_gate();
  select * into c from integrations.calendar_connections x
   where x.tenant_id = p_tenant_id and x.kind in ('calendly', 'calcom') and x.share_link and x.booking_link is not null and x.status = 'connected'
   order by x.connected_at desc limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object('kind', c.kind, 'url', c.booking_link);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. the scheduler account: Outlook (the OAuth callback and the worker), as Google's
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.scheduler_cal_state_use(p_nonce uuid, p_tenant_id uuid, p_member_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s integrations.calendar_states;
begin
  perform app.cal_scheduler_gate();
  select * into s from integrations.calendar_states x where x.nonce = p_nonce for update;
  if not found or s.tenant_id is distinct from p_tenant_id or s.member_id is distinct from p_member_id then
    perform app.cal_error('state');
  end if;
  if s.used_at is not null or s.expires_at <= now() then
    perform app.cal_error('state');
  end if;
  update integrations.calendar_states set used_at = now() where nonce = s.nonce;
  if not exists (select 1 from public.memberships m where m.tenant_id = s.tenant_id and m.user_id = s.member_id and m.role = 'owner') then
    perform app.cal_error('deny');
  end if;
  return jsonb_build_object('tenant_id', s.tenant_id, 'member_id', s.member_id, 'reconnect', exists (select 1 from integrations.calendar_connections c where c.tenant_id = s.tenant_id and c.kind = 'outlook'));
end;
$$;

create function public.scheduler_cal_outlook_connected(p_tenant_id uuid, p_member_id uuid, p_last4 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c integrations.calendar_connections;
  v_re boolean;
begin
  perform app.cal_scheduler_gate();
  if p_tenant_id is null or p_member_id is null or (p_last4 is not null and p_last4 !~ '^[A-Za-z0-9]{4}$') then
    perform app.cal_error('invalid');
  end if;
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant_id and m.user_id = p_member_id and m.role = 'owner') then
    perform app.cal_error('deny');
  end if;
  v_re := exists (select 1 from integrations.calendar_connections x where x.tenant_id = p_tenant_id and x.kind = 'outlook');
  insert into integrations.calendar_connections (tenant_id, kind, status, member_id, secret_last4, busy_requested_at)
  values (p_tenant_id, 'outlook', 'connected', p_member_id, p_last4, now())
  on conflict (tenant_id, kind) do update
     set member_id = excluded.member_id, status = 'connected', connected_at = now(), last_error_code = null, link_attempts = 0, busy_next_at = null, busy_requested_at = now(), secret_last4 = excluded.secret_last4
  returning * into c;
  -- a new grant may belong to another account: every event is pushed again (an event we cannot find is written anew)
  update integrations.calendar_event_links set next_attempt_at = now(), attempts = 0 where tenant_id = p_tenant_id;
  perform app.write_audit_event(p_tenant_id, 'calendar.connect', 'calendar_connection', c.id, null, null, jsonb_build_object('kind', 'outlook', 'reconnect', v_re));
  return app.cal_connection_json(c);
end;
$$;

-- the worker's list: every Outlook link with what is due now
create function public.scheduler_cal_outlook_links(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.cal_scheduler_gate();
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.cal_error('invalid');
  end if;
  delete from integrations.calendar_states where expires_at < now() - interval '1 day';
  return coalesce((select jsonb_agg(x order by x.tenant_id) from (
    select l.tenant_id, l.status, l.write_events, l.block_busy,
           (l.status = 'connected' and l.block_busy and coalesce(l.busy_next_at, '-infinity') <= now()
              and (l.busy_refreshed_at is null or l.busy_refreshed_at < now() - interval '30 minutes')) as busy_due,
           (l.status = 'connected' and l.write_events and jsonb_array_length(public.scheduler_cal_visits_due(l.tenant_id, 1)) > 0) as events_due
      from integrations.calendar_connections l
     where l.kind = 'outlook'
     order by l.tenant_id
     limit p_limit) x), '[]'::jsonb);
end;
$$;

create function public.scheduler_cal_visits_due(p_tenant_id uuid, p_limit integer default 25) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.cal_scheduler_gate();
  if p_tenant_id is null or p_limit is null or p_limit not between 1 and 100 then
    perform app.cal_error('invalid');
  end if;
  if not exists (select 1 from integrations.calendar_connections l where l.tenant_id = p_tenant_id and l.kind = 'outlook' and l.status = 'connected' and l.write_events) then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(x order by x.starts_at, x.visit_id) from (
    select v.id as visit_id, v.starts_at, v.ends_at, v.status, v.party_size,
           case when v.purpose is null or v.purpose like 'erased:%' then null else v.purpose end as purpose,
           case when c.id is null or c.erased_at is not null or c.full_name like 'erased:%' then null else c.full_name end as person_name,
           v.updated_at as visit_updated_at,
           g.event_id, g.state as event_state, g.last_pushed_hash, coalesce(g.attempts, 0) as attempts
      from public.store_visits v
      left join integrations.calendar_event_links g on g.tenant_id = v.tenant_id and g.visit_id = v.id
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

create function public.scheduler_cal_event_done(p_tenant_id uuid, p_visit_id uuid, p_event_id text, p_state text, p_hash text, p_visit_updated_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.cal_scheduler_gate();
  if p_tenant_id is null or p_visit_id is null or p_state not in ('written', 'deleted') or (p_event_id is not null and not (char_length(p_event_id) between 5 and 400 and p_event_id ~ '^[A-Za-z0-9_=+/-]+$'))
     or (p_hash is not null and p_hash !~ '^[0-9a-f]{64}$') or p_visit_updated_at is null then
    perform app.cal_error('invalid');
  end if;
  insert into integrations.calendar_event_links (tenant_id, visit_id, txn_id, event_id, state, last_pushed_hash, visit_updated_at, pushed_at, attempts, next_attempt_at, last_error_code)
  values (p_tenant_id, p_visit_id, 's19' || replace(p_visit_id::text, '-', ''), p_event_id, p_state, p_hash, p_visit_updated_at, now(), 0, now(), null)
  on conflict (tenant_id, visit_id) do update
     set event_id = coalesce(excluded.event_id, integrations.calendar_event_links.event_id), state = excluded.state, last_pushed_hash = excluded.last_pushed_hash,
         visit_updated_at = excluded.visit_updated_at, pushed_at = now(), attempts = 0, next_attempt_at = now(), last_error_code = null;
  update integrations.calendar_connections set last_synced_at = now(), last_error_code = null where tenant_id = p_tenant_id and kind = 'outlook';
  return jsonb_build_object('visit_id', p_visit_id, 'state', p_state);
end;
$$;

create function public.scheduler_cal_event_failed(p_tenant_id uuid, p_visit_id uuid, p_error_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g integrations.calendar_event_links;
begin
  perform app.cal_scheduler_gate();
  if p_tenant_id is null or p_visit_id is null or p_error_code is null or p_error_code !~ '^[a-z][a-z_]{1,39}$' then
    perform app.cal_error('invalid');
  end if;
  insert into integrations.calendar_event_links (tenant_id, visit_id, txn_id, state, attempts, next_attempt_at, last_error_code)
  values (p_tenant_id, p_visit_id, 's19' || replace(p_visit_id::text, '-', ''), 'pending', 1, now() + interval '1 minute', p_error_code)
  on conflict (tenant_id, visit_id) do update
     set attempts = least(calendar_event_links.attempts + 1, 1000),
         next_attempt_at = now() + least(power(2, least(calendar_event_links.attempts + 1, 9)), 360) * interval '1 minute',
         last_error_code = excluded.last_error_code
  returning * into g;
  update integrations.calendar_connections set last_error_code = p_error_code where tenant_id = p_tenant_id and kind = 'outlook';
  return jsonb_build_object('visit_id', p_visit_id, 'attempts', g.attempts, 'next_attempt_at', g.next_attempt_at);
end;
$$;

create function public.scheduler_cal_link_failed(p_tenant_id uuid, p_work text, p_error_code text, p_needs_reconnect boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.calendar_connections;
  v_wait interval;
begin
  perform app.cal_scheduler_gate();
  if p_tenant_id is null or p_work not in ('token', 'busy') or p_error_code is null or p_error_code !~ '^[a-z][a-z_]{1,39}$' or p_needs_reconnect is null then
    perform app.cal_error('invalid');
  end if;
  select * into l from integrations.calendar_connections x where x.tenant_id = p_tenant_id and x.kind = 'outlook' for update;
  if not found then
    perform app.cal_error('not_connected');
  end if;
  v_wait := least(power(2, least(l.link_attempts + 1, 9)), 360) * interval '1 minute';
  update integrations.calendar_connections
     set last_error_code = p_error_code, link_attempts = least(link_attempts + 1, 1000), status = case when p_needs_reconnect then 'needs_reconnect' else status end, busy_next_at = now() + v_wait
   where id = l.id returning * into l;
  if p_needs_reconnect then
    perform app.write_audit_event(p_tenant_id, 'calendar.needs_reconnect', 'calendar_connection', l.id, null, null, jsonb_build_object('kind', 'outlook', 'code', p_error_code));
  end if;
  return jsonb_build_object('status', l.status, 'last_error_code', l.last_error_code);
end;
$$;

create function public.scheduler_cal_busy_replace(p_tenant_id uuid, p_blocks jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.calendar_connections;
  v_s timestamptz[] := '{}';
  v_e timestamptz[] := '{}';
  n_in integer;
  n_out integer;
begin
  perform app.cal_scheduler_gate();
  if p_tenant_id is null or p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 2000 then
    perform app.cal_error('invalid');
  end if;
  select * into l from integrations.calendar_connections x where x.tenant_id = p_tenant_id and x.kind = 'outlook' for update;
  if not found then
    perform app.cal_error('not_connected');
  end if;
  if l.block_busy and l.status = 'connected' then
    begin
      select coalesce(array_agg(z.s order by z.s, z.e), '{}'), coalesce(array_agg(z.e order by z.s, z.e), '{}') into v_s, v_e
        from (select distinct (b ->> 'start')::timestamptz as s, (b ->> 'end')::timestamptz as e from jsonb_array_elements(p_blocks) b) z;
    exception when others then
      perform app.cal_error('invalid');
    end;
    if exists (select 1 from unnest(v_s, v_e) u(s, e) where u.s is null or u.e is null or u.e <= u.s or u.e - u.s > interval '62 days') then
      perform app.cal_error('invalid');
    end if;
  end if;
  delete from public.calendar_busy b where b.tenant_id = p_tenant_id and b.source = 'outlook'
     and not exists (select 1 from unnest(v_s, v_e) u(s, e) where u.s = b.starts_at and u.e = b.ends_at);
  get diagnostics n_out = row_count;
  insert into public.calendar_busy (tenant_id, source, starts_at, ends_at)
  select p_tenant_id, 'outlook', u.s, u.e from unnest(v_s, v_e) u(s, e)
   where not exists (select 1 from public.calendar_busy b where b.tenant_id = p_tenant_id and b.source = 'outlook' and b.starts_at = u.s and b.ends_at = u.e);
  get diagnostics n_in = row_count;
  update integrations.calendar_connections set busy_refreshed_at = now(), last_synced_at = now(), busy_next_at = null, link_attempts = 0, last_error_code = null where id = l.id;
  return jsonb_build_object('added', n_in, 'removed', n_out);
end;
$$;

-- the Outlook events WE wrote (their ids), so the worker leaves them out of the busy times it reads
create function public.scheduler_cal_own_events(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.cal_scheduler_gate();
  return coalesce((select jsonb_agg(jsonb_build_object('visit_id', g.visit_id, 'event_id', g.event_id))
                     from integrations.calendar_event_links g where g.tenant_id = p_tenant_id and g.state = 'written' and g.event_id is not null), '[]'::jsonb);
end;
$$;

create function public.scheduler_cal_disconnect(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.cal_scheduler_gate();
  return app.cal_forget(p_tenant_id, 'outlook');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. who may call what
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.calendar_connections_list(uuid)', 'public.calendar_connection_save(uuid, text, text, text, text, text, text)',
    'public.calendar_connection_settings(uuid, text, text, boolean, boolean, boolean, text)', 'public.calendar_connection_ref(uuid, text)', 'public.calendar_connection_disconnect(uuid, text)',
    'public.calendar_outlook_start(uuid)', 'public.calendar_bookings_list(uuid, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.scheduler_calendar_hook(text)', 'public.scheduler_calendar_booking_apply(uuid, text, text, text, text, timestamptz, timestamptz, text)',
    'public.scheduler_calendar_booking_cancel(uuid, text, text, timestamptz, timestamptz)', 'public.scheduler_calendar_booking_link(uuid)',
    'public.scheduler_cal_state_use(uuid, uuid, uuid)', 'public.scheduler_cal_outlook_connected(uuid, uuid, text)', 'public.scheduler_cal_outlook_links(integer)',
    'public.scheduler_cal_visits_due(uuid, integer)', 'public.scheduler_cal_event_done(uuid, uuid, text, text, text, timestamptz)', 'public.scheduler_cal_event_failed(uuid, uuid, text)',
    'public.scheduler_cal_link_failed(uuid, text, text, boolean)', 'public.scheduler_cal_busy_replace(uuid, jsonb)', 'public.scheduler_cal_own_events(uuid)', 'public.scheduler_cal_disconnect(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);   -- every one starts with app.cal_scheduler_gate(): only the registered scheduler account gets past it
  end loop;
end $$;
