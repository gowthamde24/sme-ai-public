-- Results into the business's own CRM or sheet (docs/contracts/crm-push.md; planner 25 Nov 2026, "connectors": HubSpot, LeadSquared, Sell.Do, Pipedrive, Freshsales, Kylas, Bitrix24, Airtable, Notion, Google Sheets by Apps Script, Zoho CRM and Salesforce).
--   public.crm_connections  a workspace's connection to ONE CRM or sheet (at most one per tool): which tool, its NON-secret settings (a host, a base id: never a key), the field mapping, the events it wants, on or off.
--                           The KEYS are never in the database: they live in Secret Manager (workspace-secrets store, `sme-ws-<workspace>-crm-<connection>`), written and removed only by the API. Written only by the crm_connection_*
--                           functions (Owner or Admin, second factor).
--   public.crm_deliveries   one row per event per connection: the event, WHAT it is about (a call, a lead, an outcome: ids only, no personal data is copied) and where it stands (pending, retrying, delivered, skipped, dead).
--                           The record that is sent is built when it is sent, from the live rows, so an erased person leaves nothing here. The same event for the same call or lead is ONE row (idempotency).
-- Events are queued from app.webhook_enqueue (the same five events, the same triggers as outbound webhooks), ONLY when the workspace has an active connection that asked for that event; a failure to queue never fails the lead,
-- the call or the outcome. The worker claims due rows (crm_deliveries_claim), pushes them with the API's guarded client, and tells the database the result (crm_delivery_record); the retry delays are the API's (1 min, 5 min, 30 min,
-- 2 h, 6 h). After the last one a delivery is dead and the connection is "failing" until one delivery works: Today's "Needs you" shows it to the Owner and Admin (crm_push_failing).
-- Nothing is queued or sent unless the API runs with CRM_PUSH=on (the kill switch: the routes answer 404 and the worker pushes nothing). Consent and do-not-call are untouched: only data already held about the business's own leads and calls leaves.

create table public.crm_connections (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id),
  type           text not null check (type in ('hubspot', 'leadsquared', 'selldo', 'google_sheets', 'pipedrive', 'freshsales', 'kylas', 'bitrix24', 'airtable', 'notion', 'zoho_crm', 'salesforce')),
  config         jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 2000),
  mapping        jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object' and octet_length(mapping::text) <= 4000),
  events         text[] not null check (cardinality(events) between 1 and 5 and events <@ array['call.completed', 'call.missed', 'lead.created', 'lead.updated', 'job.outcome']),
  active         boolean not null default true,
  secret_version integer not null default 1 check (secret_version >= 1),
  failing_since  timestamptz,
  last_test_at   timestamptz,
  last_test_ok   boolean,
  last_test_reason text check (last_test_reason in ('auth', 'rejected', 'not_found', 'rate_limited', 'server', 'timeout', 'refused', 'tls', 'redirect', 'blocked', 'dns', 'bad_answer', 'no_secret', 'config')),
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, type)
);
comment on table public.crm_connections is 'A workspace''s connection to one CRM or sheet. Written only by crm_connection_save / _update / _delete / _tested (Owner or Admin, second factor for changes). The keys are NOT stored here (Secret Manager, sme-ws-<workspace>-crm-<connection>).';
comment on column public.crm_connections.type is 'SAFE: the tool. CLEAN-EXEMPT: closed CHECK list';
comment on column public.crm_connections.config is 'SAFE: the tool''s non-secret settings (a host or domain, a base or database id), shown to the Owner and Admin; never a key. CLEAN-EXEMPT: not client-writable, written only by crm_connection_save which the API checks';
comment on column public.crm_connections.mapping is 'SAFE: which of our fields goes to which field of the tool (field names only). CLEAN-EXEMPT: not client-writable, written only by crm_connection_save and _update which the API checks';
comment on column public.crm_connections.events is 'SAFE: the events it wants. CLEAN-EXEMPT: closed CHECK list';
comment on column public.crm_connections.last_test_reason is 'SAFE: a closed word for why the last test failed (never the other side''s text). CLEAN-EXEMPT: closed CHECK list';
alter table public.crm_connections enable row level security;
alter table public.crm_connections force row level security;
revoke all on public.crm_connections from public, anon, authenticated, service_role;
create trigger crm_connections_forbid_tenant_id_change before update on public.crm_connections for each row execute function app.forbid_tenant_id_change();
create trigger audit_crm_connections after insert or update or delete on public.crm_connections for each row execute function app.audit_row_change('crm_connection', '');
grant select on public.crm_connections to authenticated;
create policy crm_connections_select on public.crm_connections for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index crm_connections_tenant on public.crm_connections (tenant_id, created_at desc, id desc);

create table public.crm_deliveries (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id),
  connection_id  uuid not null,
  event_id       uuid not null,
  event          text not null check (event in ('call.completed', 'call.missed', 'lead.created', 'lead.updated', 'job.outcome')),
  subject_kind   text not null check (subject_kind in ('phone_call', 'missed_call', 'lead', 'outcome')),
  subject_id     uuid not null,
  dedupe_key     text not null check (dedupe_key ~ '^[a-z]+\.[a-z]+:[0-9a-f-]{36}(:[0-9T]{13})?$'),
  status         text not null default 'pending' check (status in ('pending', 'retrying', 'delivered', 'skipped', 'dead')),
  attempts       integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default app.outbox_now(),
  claimed_until  timestamptz,
  last_status_code integer check (last_status_code between 100 and 599),
  last_error     text check (last_error in ('timeout', 'refused', 'tls', 'status', 'redirect', 'blocked', 'dns', 'too_large', 'no_secret', 'auth', 'rejected', 'not_found', 'rate_limited', 'server', 'bad_answer', 'config')),
  result         text check (result in ('created', 'updated', 'noted', 'appended', 'skipped')),
  created_at     timestamptz not null default now(),
  delivered_at   timestamptz,
  foreign key (tenant_id, connection_id) references public.crm_connections (tenant_id, id),
  unique (connection_id, dedupe_key),
  check ((status = 'delivered') = (delivered_at is not null))
);
comment on table public.crm_deliveries is 'One push to a CRM or sheet: which event, about which row (an id), and where it stands. No body and no personal data: the record is built when it is sent. Kept 30 days.';
comment on column public.crm_deliveries.event is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.crm_deliveries.subject_kind is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.crm_deliveries.dedupe_key is 'SAFE: the event and the id of what it is about (and the minute for events that can repeat); two pushes of the same thing are one row. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.crm_deliveries.status is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.crm_deliveries.last_error is 'SAFE: a closed word for what went wrong (never the other side''s text). CLEAN-EXEMPT: closed CHECK list';
comment on column public.crm_deliveries.result is 'SAFE: a closed word for what was done in the other tool. CLEAN-EXEMPT: closed CHECK list';
alter table public.crm_deliveries enable row level security;
alter table public.crm_deliveries force row level security;
revoke all on public.crm_deliveries from public, anon, authenticated, service_role;
create trigger crm_deliveries_forbid_tenant_id_change before update on public.crm_deliveries for each row execute function app.forbid_tenant_id_change();
create trigger audit_crm_deliveries after insert or update or delete on public.crm_deliveries for each row execute function app.audit_row_change('crm_delivery', '');
grant select on public.crm_deliveries to authenticated;
create policy crm_deliveries_select on public.crm_deliveries for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index crm_deliveries_log on public.crm_deliveries (tenant_id, connection_id, created_at desc, id desc);
create index crm_deliveries_due on public.crm_deliveries (tenant_id, next_attempt_at) where status in ('pending', 'retrying');

-- ---------------------------------------------------------------------------------------------------------------- queueing
-- One delivery per active connection that asked for the event. Cheap when the workspace has none; never fails the row that caused it. Called from app.webhook_enqueue (patched below), so the same five
-- events come from the same triggers.
create function app.crm_enqueue(p_tenant uuid, p_event text, p_kind text, p_subject uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_key text;
begin
  if p_subject is null or p_kind not in ('phone_call', 'missed_call', 'lead', 'outcome') then
    return;
  end if;
  if not exists (select 1 from public.crm_connections c where c.tenant_id = p_tenant and c.active and p_event = any (c.events)) then
    return;
  end if;
  -- a call or a new lead is pushed once; a lead's changes and an outcome's corrections can repeat, so they are one per minute (the tool's own record is updated, not doubled)
  v_key := p_event || ':' || p_subject::text || case when p_event in ('lead.updated', 'job.outcome') then ':' || to_char(date_trunc('minute', now() at time zone 'utc'), 'YYYYMMDD"T"HH24MI') else '' end;
  begin
    insert into public.crm_deliveries (tenant_id, connection_id, event_id, event, subject_kind, subject_id, dedupe_key, next_attempt_at)
    select c.tenant_id, c.id, v_event_id, p_event, p_kind, p_subject, v_key, app.outbox_now()
      from public.crm_connections c where c.tenant_id = p_tenant and c.active and p_event = any (c.events)
    on conflict (connection_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'crm enqueue skipped (%)', sqlstate;
  end;
end;
$$;
revoke all on function app.crm_enqueue(uuid, text, text, uuid) from public;

do $patch$
declare
  v_def    text := pg_get_functiondef('app.webhook_enqueue(uuid, text, text, uuid)'::regprocedure);
  v_marker constant text := E'begin\n  if not exists (select 1 from public.webhook_endpoints e where e.tenant_id = p_tenant and e.active and p_event = any (e.events)) then';
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'crm push: app.webhook_enqueue is not the function this migration expects';
  end if;
  if position('app.crm_enqueue' in v_def) > 0 then
    return;
  end if;
  execute replace(v_def, v_marker, E'begin\n  perform app.crm_enqueue(p_tenant, p_event, p_kind, p_subject);\n  if not exists (select 1 from public.webhook_endpoints e where e.tenant_id = p_tenant and e.active and p_event = any (e.events)) then');
end
$patch$;

-- ---------------------------------------------------------------------------------------------------------------- what a push says (built when it is sent)
-- The webhook body's data (a call, a lead or an outcome, and the lead's OWN contact) plus the lead's source and id. Never a transcript, never another person's number.
create function app.crm_data(p_event text, p_kind text, p_subject uuid, p_tenant uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_data jsonb := app.webhook_data(p_event, p_kind, p_subject, p_tenant, false);
  v_lead uuid;
begin
  if v_data ? 'gone' then
    return v_data;
  end if;
  v_lead := coalesce(nullif(v_data #>> '{lead,lead_id}', '')::uuid, nullif(v_data #>> '{lead,id}', '')::uuid);
  return v_data || jsonb_build_object('lead_id', v_lead, 'source', (select l.source from public.leads l where l.tenant_id = p_tenant and l.id = v_lead));
end;
$$;
revoke all on function app.crm_data(text, text, uuid, uuid) from public;

-- ---------------------------------------------------------------------------------------------------------------- the connection as shown (no key)
create function app.crm_connection_json(c public.crm_connections) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'type', c.type, 'config', c.config, 'mapping', c.mapping, 'events', to_jsonb(c.events), 'active', c.active, 'secret_version', c.secret_version,
                            'created_at', c.created_at, 'updated_at', c.updated_at,
                            'last_test', case when c.last_test_at is null then null else jsonb_build_object('at', c.last_test_at, 'ok', c.last_test_ok, 'reason', c.last_test_reason) end,
                            'health', jsonb_build_object('status', case when c.failing_since is not null then 'failing' else 'ok' end, 'failing_since', c.failing_since,
                                'dead_letters_7d', (select count(*) from public.crm_deliveries d where d.tenant_id = c.tenant_id and d.connection_id = c.id and d.status = 'dead' and d.created_at > now() - interval '7 days'),
                                'last_delivered_at', (select max(d.delivered_at) from public.crm_deliveries d where d.tenant_id = c.tenant_id and d.connection_id = c.id)))
$$;
revoke all on function app.crm_connection_json(public.crm_connections) from public;

-- ---------------------------------------------------------------------------------------------------------------- Connectors page (Owner, Admin)
create function public.crm_connections_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(app.crm_connection_json(c) order by c.created_at desc, c.id desc) from public.crm_connections c where c.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;

-- Makes the connection of this tool, or replaces its settings (its id stays: the key is stored under it, so a new key is a new version). The id is made by the API (the key is stored under it first).
-- null: 12 connections already is impossible (one per tool); an invalid input is 22023.
create function public.crm_connection_save(p_tenant_id uuid, p_id uuid, p_type text, p_config jsonb, p_mapping jsonb, p_events text[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.crm_connections;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  perform 1 from public.tenants t where t.id = p_tenant_id for update;
  begin
    insert into public.crm_connections (id, tenant_id, type, config, mapping, events, created_by)
    values (p_id, p_tenant_id, p_type, coalesce(p_config, '{}'::jsonb), coalesce(p_mapping, '{}'::jsonb), (select array_agg(distinct s order by s) from unnest(p_events) s), auth.uid())
    on conflict (tenant_id, type) do update set
      config = excluded.config, mapping = excluded.mapping, events = excluded.events, active = true, failing_since = null, secret_version = public.crm_connections.secret_version + 1,
      last_test_at = null, last_test_ok = null, last_test_reason = null, updated_at = now()
    returning * into v;
  exception when invalid_text_representation or check_violation or not_null_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return app.crm_connection_json(v);
end;
$$;

-- Changes the mapping, the events or on/off of the tool's connection. null: no such connection
create function public.crm_connection_update(p_tenant_id uuid, p_type text, p_mapping jsonb default null, p_events text[] default null, p_active boolean default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.crm_connections;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  begin
    update public.crm_connections c set
           mapping = coalesce(p_mapping, c.mapping),
           events = coalesce((select array_agg(distinct s order by s) from unnest(p_events) s), c.events),
           active = coalesce(p_active, c.active),
           failing_since = case when p_active is true and not c.active then null else c.failing_since end,
           updated_at = now()
     where c.tenant_id = p_tenant_id and c.type = p_type
    returning * into v;
  exception when invalid_text_representation or check_violation or not_null_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return case when v.id is null then null else app.crm_connection_json(v) end;
end;
$$;

-- The connection and its log go; answers the connection's id (the API then removes the key). null: no such connection
create function public.crm_connection_delete(p_tenant_id uuid, p_type text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  select c.id into v_id from public.crm_connections c where c.tenant_id = p_tenant_id and c.type = p_type;
  if v_id is null then
    return null;
  end if;
  delete from public.crm_deliveries d where d.tenant_id = p_tenant_id and d.connection_id = v_id;
  delete from public.crm_connections c where c.tenant_id = p_tenant_id and c.id = v_id;
  return v_id;
end;
$$;

-- What the "Test connection" button found (the API ran the test; this keeps the answer to show). null: no such connection
create function public.crm_connection_tested(p_tenant_id uuid, p_type text, p_ok boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.crm_connections;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_ok is null or (p_ok and p_reason is not null) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  begin
    update public.crm_connections c set last_test_at = now(), last_test_ok = p_ok, last_test_reason = p_reason where c.tenant_id = p_tenant_id and c.type = p_type returning * into v;
  exception when check_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return case when v.id is null then null else app.crm_connection_json(v) end;
end;
$$;

-- "Try again": the dead pushes of this connection are queued once more (the connection stops being "failing" when one works). Answers how many. null: no such connection
create function public.crm_deliveries_retry(p_tenant_id uuid, p_type text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select c.id into v_id from public.crm_connections c where c.tenant_id = p_tenant_id and c.type = p_type;
  if v_id is null then
    return null;
  end if;
  update public.crm_deliveries d set status = 'retrying', attempts = 0, next_attempt_at = app.outbox_now(), claimed_until = null
   where d.tenant_id = p_tenant_id and d.connection_id = v_id and d.status = 'dead' and d.created_at > now() - interval '7 days';
  get diagnostics v_n = row_count;
  return jsonb_build_object('requeued', v_n);
end;
$$;

-- the log, newest first, 30 days, keyset on (created_at, id)
create function public.crm_deliveries_list(p_tenant_id uuid, p_type text, p_before timestamptz, p_before_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.type, 'event', x.event, 'event_id', x.event_id, 'status', x.status, 'attempts', x.attempts, 'result', x.result,
                                        'last_status_code', x.last_status_code, 'last_error', x.last_error,
                                        'next_attempt_at', case when x.status in ('pending', 'retrying') then x.next_attempt_at end, 'created_at', x.created_at, 'delivered_at', x.delivered_at)
                     order by x.created_at desc, x.id desc)
      from (select d.*, c.type from public.crm_deliveries d join public.crm_connections c on c.tenant_id = d.tenant_id and c.id = d.connection_id
             where d.tenant_id = p_tenant_id and (p_type is null or c.type = p_type) and d.created_at > now() - interval '30 days'
               and (p_before is null or (d.created_at, d.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
             order by d.created_at desc, d.id desc limit p_limit) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- the worker (the registered scheduler account)
-- Due deliveries of ACTIVE connections, leased for 3 minutes (a crashed worker's rows come back), each with its record's `data` built from the live rows.
create function public.crm_deliveries_claim(p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_out jsonb;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    perform app.scheduler_error('invalid');
  end if;
  with due as (
    select d.id from public.crm_deliveries d
      join public.crm_connections c on c.tenant_id = d.tenant_id and c.id = d.connection_id and c.active
     where d.status in ('pending', 'retrying') and d.next_attempt_at <= v_now and (d.claimed_until is null or d.claimed_until < v_now)
     order by d.next_attempt_at, d.id
     limit p_limit
       for update of d skip locked),
  upd as (
    update public.crm_deliveries d set claimed_until = v_now + interval '3 minutes' from due where d.id = due.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'tenant_id', u.tenant_id, 'connection_id', u.connection_id, 'type', c.type, 'event', u.event, 'event_id', u.event_id, 'attempts', u.attempts,
                                               'created_at', u.created_at, 'config', c.config, 'mapping', c.mapping, 'secret_version', c.secret_version,
                                               'data', app.crm_data(u.event, u.subject_kind, u.subject_id, u.tenant_id)) order by u.created_at, u.id), '[]'::jsonb)
    into v_out
    from upd u join public.crm_connections c on c.tenant_id = u.tenant_id and c.id = u.connection_id;
  return v_out;
end;
$$;

-- The result of one attempt. p_ok with p_result: done (p_result 'skipped' is a record that was left out on purpose: a test lead, a sandbox call, an erased person). Not ok with p_retry_in_s: again then (1 s to 24 h).
-- Not ok without it: dead (the connection is "failing" until one push works). Answers {state}. A row that is not waiting any more answers gone.
create function public.crm_delivery_record(p_id uuid, p_ok boolean, p_status integer, p_error text, p_retry_in_s integer, p_result text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.crm_deliveries;
  v_now timestamptz := app.outbox_now();
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_ok is null or (p_retry_in_s is not null and p_retry_in_s not between 1 and 86400) or (p_status is not null and p_status not between 100 and 599)
     or (p_error is not null and p_error not in ('timeout', 'refused', 'tls', 'status', 'redirect', 'blocked', 'dns', 'too_large', 'no_secret', 'auth', 'rejected', 'not_found', 'rate_limited', 'server', 'bad_answer', 'config'))
     or (p_result is not null and p_result not in ('created', 'updated', 'noted', 'appended', 'skipped')) then
    perform app.scheduler_error('invalid');
  end if;
  select * into d from public.crm_deliveries x where x.id = p_id for update;
  if not found or d.status not in ('pending', 'retrying') then
    return jsonb_build_object('state', 'gone');
  end if;
  if p_ok and p_result = 'skipped' then
    update public.crm_deliveries set status = 'skipped', attempts = d.attempts + 1, claimed_until = null, last_status_code = p_status, last_error = null, result = 'skipped' where id = d.id;
    return jsonb_build_object('state', 'skipped');
  end if;
  if p_ok then
    update public.crm_deliveries set status = 'delivered', attempts = d.attempts + 1, delivered_at = v_now, claimed_until = null, last_status_code = p_status, last_error = null, result = p_result where id = d.id;
    update public.crm_connections set failing_since = null where tenant_id = d.tenant_id and id = d.connection_id and failing_since is not null;
    return jsonb_build_object('state', 'delivered');
  end if;
  if p_retry_in_s is not null then
    update public.crm_deliveries set status = 'retrying', attempts = d.attempts + 1, next_attempt_at = v_now + make_interval(secs => p_retry_in_s), claimed_until = null,
           last_status_code = p_status, last_error = coalesce(p_error, 'status') where id = d.id;
    return jsonb_build_object('state', 'retrying');
  end if;
  update public.crm_deliveries set status = 'dead', attempts = d.attempts + 1, claimed_until = null, last_status_code = p_status, last_error = coalesce(p_error, 'status') where id = d.id;
  update public.crm_connections set failing_since = coalesce(failing_since, v_now) where tenant_id = d.tenant_id and id = d.connection_id;
  return jsonb_build_object('state', 'dead');
end;
$$;

-- the log is kept 30 days
create function public.crm_purge() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  delete from public.crm_deliveries d where d.created_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return jsonb_build_object('deliveries', v_n);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.crm_connections_list(uuid)', 'public.crm_connection_save(uuid, uuid, text, jsonb, jsonb, text[])', 'public.crm_connection_update(uuid, text, jsonb, text[], boolean)',
                           'public.crm_connection_delete(uuid, text)', 'public.crm_connection_tested(uuid, text, boolean, text)', 'public.crm_deliveries_retry(uuid, text)',
                           'public.crm_deliveries_list(uuid, text, timestamptz, uuid, integer)', 'public.crm_deliveries_claim(integer)',
                           'public.crm_delivery_record(uuid, boolean, integer, text, integer, text)', 'public.crm_purge()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- Today: "Needs you" when a connection gave up
-- One item for the Owner and Admin while a connection is failing (it leaves when one push works, or the connection is paused or removed). The word `ref` is the tool's name (hubspot, ...): the API has the sentence.
create function app.today_crm_push_failing(p_tenant uuid) returns table (id uuid, at timestamptz, tool text)
language sql
stable
security definer
set search_path = ''
as $$
  select md5('crm_push_failing:' || p_tenant::text)::uuid, c.failing_since, c.type
    from public.crm_connections c
   where auth.uid() is not null and app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[])
     and c.tenant_id = p_tenant and c.active and c.failing_since is not null
   order by c.failing_since, c.id
   limit 1
$$;
revoke all on function app.today_crm_push_failing(uuid) from public;
grant execute on function app.today_crm_push_failing(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin

do $patch$
declare
  v_def    text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_marker constant text := E'      from app.today_credits_low(p_tenant_id) cl\n     where v_decider\n';
  v_new    text;
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'crm push: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, v_marker
    || E'    union all\n'
    || E'    select ''crm_push_failing'', cf.id, ''Connected tool''::text, null::text, ''followup_desk'', cf.tool, null::bigint, cf.at, ''connectors'', p_tenant_id\n'
    || E'      from app.today_crm_push_failing(p_tenant_id) cf\n'
    || E'     where v_decider\n');
  execute v_new;
end
$patch$;
