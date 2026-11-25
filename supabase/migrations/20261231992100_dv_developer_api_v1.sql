-- The developer API v1 (C1 item 3; docs/contracts/developer-api.md part D2): simulated TEST calls, campaigns, the API activity log, GET /me and a per-key limit on calls and campaigns.
--   integrations.developer_api_calls              a simulated call a TEST key placed to a sandbox lead. Nobody is dialled. Its state is worked out from the clock (queued, then 30 seconds in progress,
--                                                 then completed with the outcome of the number's last digit); the lead is updated when it completes. Kept 30 days.
--   integrations.developer_api_campaigns          a named list of sandbox leads and a job (what the calls are for). Never started by the API.
--   integrations.developer_api_campaign_contacts  the list.
--   integrations.developer_api_activity           one row per API request: route template, status, latency, key. NO bodies, no query string, no addresses. Kept 30 days.
-- All four sit outside the public schema (RLS forced, no client privileges, reached only through the functions below, as developer_api_usage); no personal data is in them (the contacts are the
-- sandbox leads, which keep their own erasure rules). Every program function finds the key by its hash and checks scope and revocation BEFORE it reads or writes, and touches only that key's workspace.
-- Two scopes are new: calls:write and campaigns:read (the keys that exist keep what they have).

do $$
declare
  c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.developer_api_keys'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%leads:write%' loop
    execute format('alter table public.developer_api_keys drop constraint %I', c);
  end loop;
end $$;
alter table public.developer_api_keys add constraint developer_api_keys_scopes_check
  check (cardinality(scopes) between 1 and 8 and scopes <@ array['leads:write', 'leads:read', 'calls:read', 'calls:write', 'campaigns:write', 'campaigns:read', 'webhooks', 'usage:read']);

-- ---------------------------------------------------------------------------------------------------------------- tables
create table integrations.developer_api_calls (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  key_id        uuid not null references public.developer_api_keys (id),
  lead_id       uuid not null references public.developer_sandbox_leads (id) on delete cascade,
  idem_key      text not null check (char_length(idem_key) between 1 and 100 and app.text_is_clean(idem_key)),
  body_sha      text not null check (body_sha ~ '^[0-9a-f]{64}$'),
  scheduled_for timestamptz not null,
  settled_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (key_id, idem_key)
);
alter table integrations.developer_api_calls enable row level security;
alter table integrations.developer_api_calls force row level security;
revoke all on integrations.developer_api_calls from public, anon, authenticated, service_role;
create index developer_api_calls_keyset on integrations.developer_api_calls (tenant_id, created_at, id);
create index developer_api_calls_lead on integrations.developer_api_calls (lead_id);
create index developer_api_calls_open on integrations.developer_api_calls (tenant_id, scheduled_for) where settled_at is null;
create index developer_api_calls_key_recent on integrations.developer_api_calls (key_id, created_at);

create table integrations.developer_api_campaigns (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id),
  key_id      uuid not null references public.developer_api_keys (id),
  idem_key    text not null check (char_length(idem_key) between 1 and 100 and app.text_is_clean(idem_key)),
  body_sha    text not null check (body_sha ~ '^[0-9a-f]{64}$'),
  name        text not null check (char_length(name) between 1 and 120 and app.text_is_clean(name)),
  language    text check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr')),
  job_name    text not null check (char_length(job_name) between 1 and 60 and app.text_is_clean(job_name)),
  job_goal    text check (char_length(job_goal) <= 300 and app.text_is_clean(job_goal)),
  status      text not null default 'draft' check (status = 'draft'),
  added       integer not null default 0 check (added >= 0),
  duplicates  integer not null default 0 check (duplicates >= 0),
  created_at  timestamptz not null default now(),
  unique (key_id, idem_key)
);
alter table integrations.developer_api_campaigns enable row level security;
alter table integrations.developer_api_campaigns force row level security;
revoke all on integrations.developer_api_campaigns from public, anon, authenticated, service_role;
create index developer_api_campaigns_keyset on integrations.developer_api_campaigns (tenant_id, created_at, id);
create index developer_api_campaigns_key_recent on integrations.developer_api_campaigns (key_id, created_at);

create table integrations.developer_api_campaign_contacts (
  campaign_id uuid not null references integrations.developer_api_campaigns (id) on delete cascade,
  lead_id     uuid not null references public.developer_sandbox_leads (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id),
  position    integer not null check (position >= 1),
  primary key (campaign_id, lead_id)
);
alter table integrations.developer_api_campaign_contacts enable row level security;
alter table integrations.developer_api_campaign_contacts force row level security;
revoke all on integrations.developer_api_campaign_contacts from public, anon, authenticated, service_role;
create index developer_api_campaign_contacts_lead on integrations.developer_api_campaign_contacts (lead_id);

create table integrations.developer_api_activity (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id),
  key_id     uuid not null references public.developer_api_keys (id),
  method     text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  route      text not null check (char_length(route) between 1 and 80 and route ~ '^/api/v1(/[a-z0-9_{}-]+)*$'),
  status     smallint not null check (status between 100 and 599),
  latency_ms integer not null check (latency_ms >= 0),
  created_at timestamptz not null default now()
);
alter table integrations.developer_api_activity enable row level security;
alter table integrations.developer_api_activity force row level security;
revoke all on integrations.developer_api_activity from public, anon, authenticated, service_role;
create index developer_api_activity_keyset on integrations.developer_api_activity (tenant_id, created_at desc, id desc);
create index developer_api_activity_key on integrations.developer_api_activity (key_id, created_at);

-- ---------------------------------------------------------------------------------------------------------------- the simulated call, worked out from the clock
create function app.developer_test_outcome(p_phone text) returns text
language sql
immutable
set search_path = ''
as $$
  select case right(coalesce(p_phone, ''), 1) when '1' then 'interested' when '2' then 'not_interested' when '3' then 'callback' when '4' then 'no_answer' when '5' then 'visit_booked' else 'interested' end
$$;
revoke all on function app.developer_test_outcome(text) from public;

create function app.developer_call_json(c integrations.developer_api_calls) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select case when now() < c.scheduled_for then 'queued' when now() < c.scheduled_for + interval '30 seconds' then 'in_progress' else 'completed' end as st,
           app.developer_test_outcome((select l.phone from public.developer_sandbox_leads l where l.id = c.lead_id)) as oc
  )
  select jsonb_build_object(
    'id', c.id, 'mode', 'test', 'lead_id', c.lead_id, 'status', s.st,
    'outcome', case when s.st = 'completed' then s.oc end,
    'scheduled_for', c.scheduled_for,
    'started_at', case when s.st <> 'queued' then c.scheduled_for end,
    'ended_at', case when s.st = 'completed' then c.scheduled_for + interval '30 seconds' end,
    'duration_seconds', case when s.st = 'completed' then case when s.oc = 'no_answer' then 0 else 30 end end,
    'summary', case when s.st = 'completed' then 'Simulated call: ' || case s.oc when 'interested' then 'the lead was interested.' when 'not_interested' then 'the lead was not interested.'
                                       when 'callback' then 'the lead asked for a call back.' when 'no_answer' then 'nobody answered.' else 'the lead booked a visit.' end end,
    'transcript', null,
    'cost', jsonb_build_object('minutes', case when s.st = 'completed' and s.oc <> 'no_answer' then 1 else 0 end, 'paise', 0),
    'created_at', c.created_at)
  from s
$$;
revoke all on function app.developer_call_json(integrations.developer_api_calls) from public;

-- finished simulated calls update their lead once (status, outcome, next step), so the lead and the call tell the same story
create function app.developer_settle(p_tenant_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.developer_sandbox_leads l
     set outcome = d.oc,
         status = case d.oc when 'interested' then 'interested' when 'not_interested' then 'not_interested' when 'visit_booked' then 'visit_booked' else 'contacted' end,
         next_step = case when d.oc = 'callback' then 'follow_up' else 'none' end, next_step_at = null, blocked = null, updated_at = now()
    from (select distinct on (c.lead_id) c.lead_id, app.developer_test_outcome(x.phone) as oc
            from integrations.developer_api_calls c join public.developer_sandbox_leads x on x.id = c.lead_id
           where c.tenant_id = p_tenant_id and c.settled_at is null and c.scheduled_for + interval '30 seconds' <= now()
           order by c.lead_id, c.scheduled_for desc) d
   where l.id = d.lead_id and l.tenant_id = p_tenant_id;
  update integrations.developer_api_calls c set settled_at = now()
   where c.tenant_id = p_tenant_id and c.settled_at is null and c.scheduled_for + interval '30 seconds' <= now();
end;
$$;
revoke all on function app.developer_settle(uuid) from public;

-- the lead as shown, now with its calls
create or replace function app.developer_lead_json(l public.developer_sandbox_leads) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', l.id, 'mode', 'test', 'name', l.name, 'phone', l.phone, 'email', l.email, 'source', l.source, 'language', l.language, 'notes', l.notes,
                            'custom_fields', coalesce(l.custom_fields, '{}'::jsonb), 'status', l.status, 'outcome', l.outcome, 'next_step', l.next_step, 'next_step_at', l.next_step_at, 'blocked', l.blocked,
                            'created_at', l.created_at, 'updated_at', l.updated_at,
                            'calls', coalesce((select jsonb_agg(c.id order by c.created_at, c.id) from integrations.developer_api_calls c where c.lead_id = l.id), '[]'::jsonb))
$$;

-- GET /api/v1/leads/{id} and the list, as before, but finished calls are settled first (so these two are no longer read-only)
create or replace function public.developer_sandbox_lead_get(p_key_hash text, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'leads:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  perform app.developer_settle(k.tenant_id);
  return (select app.developer_lead_json(l) from public.developer_sandbox_leads l where l.tenant_id = k.tenant_id and l.id = p_id);
end;
$$;

create or replace function public.developer_sandbox_leads_list(p_key_hash text, p_updated_since timestamptz, p_after_at timestamptz, p_after_id uuid, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'leads:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 101 or ((p_after_at is null) <> (p_after_id is null)) then
    perform app.scheduler_error('invalid');
  end if;
  perform app.developer_settle(k.tenant_id);
  return coalesce((
    select jsonb_agg(app.developer_lead_json(z) order by z.updated_at, z.id)
      from (select l.* from public.developer_sandbox_leads l
             where l.tenant_id = k.tenant_id and (p_updated_since is null or l.updated_at >= p_updated_since)
               and (p_after_at is null or (l.updated_at, l.id) > (p_after_at, p_after_id))
             order by l.updated_at, l.id
             limit p_limit) z
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- the key check: p_scope null = any live key (GET /me)
create or replace function public.developer_api_auth(p_key_hash text, p_scope text, p_ip text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
  v_ip inet;
  v_n integer;
  v_minute timestamptz := date_trunc('minute', now());
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  select * into k from public.developer_api_keys x where x.key_hash = p_key_hash and x.revoked_at is null;
  if k.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_key');
  end if;
  if p_scope is not null and not (p_scope = any (k.scopes)) then
    return jsonb_build_object('ok', false, 'code', 'missing_scope');
  end if;
  if cardinality(k.ip_allow) > 0 then
    begin
      v_ip := p_ip::inet;
    exception when others then
      v_ip := null;
    end;
    if v_ip is null or not exists (select 1 from unnest(k.ip_allow) c where v_ip <<= c) then
      return jsonb_build_object('ok', false, 'code', 'ip_not_allowed');
    end if;
  end if;
  insert into integrations.developer_api_usage as u (key_id, tenant_id, minute, n) values (k.id, k.tenant_id, v_minute, 1)
  on conflict (key_id, minute) do update set n = u.n + 1
  returning u.n into v_n;
  if v_n > 60 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'retry_after', greatest(1, 60 - extract(second from now())::integer));
  end if;
  return jsonb_build_object('ok', true, 'tenant_id', k.tenant_id, 'key_id', k.id, 'name', k.name, 'remaining', 60 - v_n);
end;
$$;

-- GET /api/v1/me: the key (never its hash or secret) and its workspace
create function public.developer_api_me(p_key_hash text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  select * into k from public.developer_api_keys x where x.key_hash = p_key_hash and x.revoked_at is null;
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  return jsonb_build_object('mode', 'test', 'key', app.developer_key_json(k),
                            'workspace', (select jsonb_build_object('id', t.id, 'name', t.name) from public.tenants t where t.id = k.tenant_id));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- calls
-- What the API needs to apply the gates: the lead's number, whether it has consent on file, how many calls are open in the workspace, how many this key placed in the last minute.
-- {lead: null | {id, phone, consent_given}, active_calls, calls_last_minute}. calls:write.
create function public.developer_sandbox_call_context(p_key_hash text, p_lead_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'calls:write');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  perform app.developer_settle(k.tenant_id);
  return jsonb_build_object(
    'lead', (select jsonb_build_object('id', l.id, 'phone', l.phone, 'consent_given', coalesce(l.consent -> 'given' = 'true'::jsonb, false))
               from public.developer_sandbox_leads l where l.tenant_id = k.tenant_id and l.id = p_lead_id),
    'active_calls', (select count(*) from integrations.developer_api_calls c where c.tenant_id = k.tenant_id and c.scheduled_for + interval '30 seconds' > now()),
    'calls_last_minute', (select count(*) from integrations.developer_api_calls c where c.key_id = k.id and c.created_at > now() - interval '1 minute'));
end;
$$;

-- POST /api/v1/calls (calls:write) once the API has applied the gates. {status: created | replayed | conflict | not_found | refused | too_many_calls | rate_limited, call?, retry_after?}.
-- The database re-checks what it can (the lead is in this workspace, has a number and consent, the 10 open calls and the 10 calls a minute per key); nothing is ever dialled.
create function public.developer_sandbox_call_create(p_key_hash text, p_idem_key text, p_body_sha text, p_lead_id uuid, p_scheduled_for timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
  v integrations.developer_api_calls;
  l public.developer_sandbox_leads;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'calls:write');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_idem_key is null or p_scheduled_for is null or p_scheduled_for < now() - interval '1 minute' or p_scheduled_for > now() + interval '9 days' then
    perform app.scheduler_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('developer_sandbox_call:' || k.tenant_id::text, 0));
  select * into v from integrations.developer_api_calls c where c.key_id = k.id and c.idem_key = p_idem_key;
  if v.id is not null then
    return jsonb_build_object('status', case when v.body_sha = p_body_sha then 'replayed' else 'conflict' end, 'call', case when v.body_sha = p_body_sha then app.developer_call_json(v) end);
  end if;
  select * into l from public.developer_sandbox_leads x where x.tenant_id = k.tenant_id and x.id = p_lead_id;
  if l.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if l.phone is null or l.consent -> 'given' is distinct from 'true'::jsonb then
    return jsonb_build_object('status', 'refused');
  end if;
  perform app.developer_settle(k.tenant_id);
  if (select count(*) from integrations.developer_api_calls c where c.tenant_id = k.tenant_id and c.scheduled_for + interval '30 seconds' > now()) >= 10 then
    return jsonb_build_object('status', 'too_many_calls', 'retry_after', 30);
  end if;
  if (select count(*) from integrations.developer_api_calls c where c.key_id = k.id and c.created_at > now() - interval '1 minute') >= 10 then
    return jsonb_build_object('status', 'rate_limited', 'retry_after', greatest(1, 60 - extract(second from now())::integer));
  end if;
  insert into integrations.developer_api_calls (tenant_id, key_id, lead_id, idem_key, body_sha, scheduled_for)
  values (k.tenant_id, k.id, l.id, p_idem_key, p_body_sha, p_scheduled_for)
  returning * into v;
  update public.developer_sandbox_leads x set status = case when x.status = 'new' then 'contacted' else x.status end, updated_at = now() where x.id = l.id;
  return jsonb_build_object('status', 'created', 'call', app.developer_call_json(v));
end;
$$;

-- GET /api/v1/calls/{id} (calls:read): this key's workspace only; null otherwise
create function public.developer_sandbox_call_get(p_key_hash text, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'calls:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  perform app.developer_settle(k.tenant_id);
  return (select app.developer_call_json(c) from integrations.developer_api_calls c where c.tenant_id = k.tenant_id and c.id = p_id);
end;
$$;

-- GET /api/v1/calls?lead_id=&after= (calls:read): oldest first, keyset (created_at, id), at most 100
create function public.developer_sandbox_calls_list(p_key_hash text, p_lead_id uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'calls:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 101 or ((p_after_at is null) <> (p_after_id is null)) then
    perform app.scheduler_error('invalid');
  end if;
  perform app.developer_settle(k.tenant_id);
  return coalesce((
    select jsonb_agg(app.developer_call_json(z) order by z.created_at, z.id)
      from (select c.* from integrations.developer_api_calls c
             where c.tenant_id = k.tenant_id and (p_lead_id is null or c.lead_id = p_lead_id)
               and (p_after_at is null or (c.created_at, c.id) > (p_after_at, p_after_id))
             order by c.created_at, c.id
             limit p_limit) z
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- campaigns
create function app.developer_campaign_json(c integrations.developer_api_campaigns, p_with_leads boolean) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'mode', 'test', 'name', c.name, 'language', c.language, 'job', jsonb_build_object('name', c.job_name, 'goal', c.job_goal), 'status', c.status,
                            'contacts', (select count(*) from integrations.developer_api_campaign_contacts x where x.campaign_id = c.id), 'added', c.added, 'duplicates', c.duplicates,
                            'created_at', c.created_at)
         || case when p_with_leads then jsonb_build_object('lead_ids', coalesce((select jsonb_agg(x.lead_id order by x.position) from integrations.developer_api_campaign_contacts x where x.campaign_id = c.id), '[]'::jsonb))
                 else '{}'::jsonb end
$$;
revoke all on function app.developer_campaign_json(integrations.developer_api_campaigns, boolean) from public;

-- POST /api/v1/campaigns (campaigns:write). p_campaign = {name, language, job_name, job_goal, contacts: [the lead bodies the API checked, each with next_step / next_step_at / blocked]}.
-- Each contact becomes a sandbox lead (or the existing one for the same number or, without a number, the same e-mail: counted in `duplicates`). Same Idempotency-Key + same body -> replayed.
-- {status: created | replayed | conflict | rate_limited, campaign, retry_after?}. 5 campaigns a minute per key.
create function public.developer_sandbox_campaign_create(p_key_hash text, p_idem_key text, p_body_sha text, p_campaign jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
  v integrations.developer_api_campaigns;
  e record;
  x public.developer_sandbox_leads;
  v_phone text;
  v_email text;
  v_added integer := 0;
  v_dups integer := 0;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'campaigns:write');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_idem_key is null or p_campaign is null or jsonb_typeof(p_campaign) <> 'object' or jsonb_typeof(p_campaign -> 'contacts') <> 'array'
     or jsonb_array_length(p_campaign -> 'contacts') not between 1 and 500 then
    perform app.scheduler_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('developer_sandbox_lead:' || k.tenant_id::text, 0));   -- the same lock as a lead create: the dedupe holds
  select * into v from integrations.developer_api_campaigns c where c.key_id = k.id and c.idem_key = p_idem_key;
  if v.id is not null then
    return jsonb_build_object('status', case when v.body_sha = p_body_sha then 'replayed' else 'conflict' end, 'campaign', case when v.body_sha = p_body_sha then app.developer_campaign_json(v, true) end);
  end if;
  if (select count(*) from integrations.developer_api_campaigns c where c.key_id = k.id and c.created_at > now() - interval '1 minute') >= 5 then
    return jsonb_build_object('status', 'rate_limited', 'retry_after', greatest(1, 60 - extract(second from now())::integer));
  end if;
  begin
    insert into integrations.developer_api_campaigns (tenant_id, key_id, idem_key, body_sha, name, language, job_name, job_goal)
    values (k.tenant_id, k.id, p_idem_key, p_body_sha, p_campaign ->> 'name', nullif(p_campaign ->> 'language', ''), p_campaign ->> 'job_name', nullif(p_campaign ->> 'job_goal', ''))
    returning * into v;
    for e in select t.value as c, t.ordinality as n from jsonb_array_elements(p_campaign -> 'contacts') with ordinality t loop
      if e.c -> 'consent' -> 'given' is distinct from 'true'::jsonb then
        perform app.scheduler_error('invalid');   -- a contact without consent never gets here (the API refuses it first)
      end if;
      v_phone := nullif(e.c ->> 'phone', '');
      v_email := nullif(e.c ->> 'email', '');
      if v_phone is null and v_email is null then
        perform app.scheduler_error('invalid');
      end if;
      select * into x from public.developer_sandbox_leads l
       where l.tenant_id = k.tenant_id and ((v_phone is not null and l.phone = v_phone) or (v_phone is null and lower(l.email) = lower(v_email)))
       order by l.created_at limit 1;
      if x.id is not null then
        v_dups := v_dups + 1;
      else
        insert into public.developer_sandbox_leads (tenant_id, key_id, idem_key, body_sha, name, phone, email, source, language, notes, custom_fields, consent, next_step, next_step_at, blocked)
        values (k.tenant_id, k.id, 'campaign:' || v.id::text || ':' || e.n::text, encode(sha256(convert_to(e.c::text, 'UTF8')), 'hex'), e.c ->> 'name', v_phone, v_email,
                nullif(e.c ->> 'source', ''), nullif(e.c ->> 'language', ''), nullif(e.c ->> 'notes', ''), coalesce(e.c -> 'custom_fields', '{}'::jsonb), e.c -> 'consent',
                e.c ->> 'next_step', (e.c ->> 'next_step_at')::timestamptz, nullif(e.c ->> 'blocked', ''))
        returning * into x;
        v_added := v_added + 1;
      end if;
      insert into integrations.developer_api_campaign_contacts (campaign_id, lead_id, tenant_id, position) values (v.id, x.id, k.tenant_id, e.n) on conflict do nothing;
    end loop;
  exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or unique_violation then
    perform app.scheduler_error('invalid');
  end;
  update integrations.developer_api_campaigns c set added = v_added, duplicates = v_dups where c.id = v.id returning * into v;
  return jsonb_build_object('status', 'created', 'campaign', app.developer_campaign_json(v, true));
end;
$$;

-- GET /api/v1/campaigns/{id} (campaigns:read): with the ids of its leads; null for another workspace's or an unknown id
create function public.developer_sandbox_campaign_get(p_key_hash text, p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'campaigns:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  return (select app.developer_campaign_json(c, true) from integrations.developer_api_campaigns c where c.tenant_id = k.tenant_id and c.id = p_id);
end;
$$;

-- GET /api/v1/campaigns?after= (campaigns:read): oldest first, keyset (created_at, id), at most 100, without the lead ids
create function public.developer_sandbox_campaigns_list(p_key_hash text, p_after_at timestamptz, p_after_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'campaigns:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 101 or ((p_after_at is null) <> (p_after_id is null)) then
    perform app.scheduler_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(app.developer_campaign_json(z, false) order by z.created_at, z.id)
      from (select c.* from integrations.developer_api_campaigns c
             where c.tenant_id = k.tenant_id and (p_after_at is null or (c.created_at, c.id) > (p_after_at, p_after_id))
             order by c.created_at, c.id
             limit p_limit) z
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- the API activity log
-- One row per request, written by the worker after the answer is known. The key is found by its hash; an unknown or revoked key leaves no row (there is no workspace to put it in). Returns true if logged.
create function public.developer_api_activity_log(p_key_hash text, p_method text, p_route text, p_status integer, p_latency_ms integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  select * into k from public.developer_api_keys x where x.key_hash = p_key_hash and x.revoked_at is null;
  if k.id is null then
    return false;
  end if;
  begin
    insert into integrations.developer_api_activity (tenant_id, key_id, method, route, status, latency_ms)
    values (k.tenant_id, k.id, upper(p_method), p_route, p_status, greatest(0, least(coalesce(p_latency_ms, 0), 3600000)));
  exception when check_violation or not_null_violation then
    perform app.scheduler_error('invalid');
  end;
  return true;
end;
$$;

-- one page, newest first, keyset (created_at, id) going back: [{id, key_id, key_name, method, route, status, latency_ms, at}]
create function app.developer_activity_page(p_tenant_id uuid, p_key_id uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 101 or ((p_before_at is null) <> (p_before_id is null)) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', z.id, 'key_id', z.key_id, 'key_name', z.key_name, 'method', z.method, 'route', z.route, 'status', z.status, 'latency_ms', z.latency_ms, 'at', z.created_at)
                     order by z.created_at desc, z.id desc)
      from (select a.*, (select kk.name from public.developer_api_keys kk where kk.id = a.key_id) as key_name
              from integrations.developer_api_activity a
             where a.tenant_id = p_tenant_id and a.created_at >= now() - interval '30 days' and (p_key_id is null or a.key_id = p_key_id)
               and (p_before_at is null or (a.created_at, a.id) < (p_before_at, p_before_id))
             order by a.created_at desc, a.id desc
             limit p_limit) z
  ), '[]'::jsonb);
end;
$$;
revoke all on function app.developer_activity_page(uuid, uuid, timestamptz, uuid, integer) from public;

-- GET /api/v1/activity (usage:read): this workspace's requests, every key
create function public.developer_api_activity_list(p_key_hash text, p_before_at timestamptz, p_before_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'usage:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  begin
    return app.developer_activity_page(k.tenant_id, null, p_before_at, p_before_id, p_limit);
  exception when invalid_parameter_value then
    perform app.scheduler_error('invalid');
  end;
end;
$$;

-- Settings -> Developers -> API activity (Owner, Admin): optionally one key
create function public.developer_activity_list(p_tenant_id uuid, p_key_id uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.developer_activity_page(p_tenant_id, p_key_id, p_before_at, p_before_id, p_limit);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- the numbers, and the clean-up
create or replace function app.developer_usage_json(p_tenant_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as day0, date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as month0)
  select jsonb_build_object(
    'mode', 'test',
    'today', jsonb_build_object('requests', coalesce((select sum(u.n) from integrations.developer_api_usage u, b where u.tenant_id = p_tenant_id and u.minute >= b.day0), 0),
                                'leads', (select count(*) from public.developer_sandbox_leads l, b where l.tenant_id = p_tenant_id and l.created_at >= b.day0),
                                'calls_simulated', (select count(*) from integrations.developer_api_calls c, b where c.tenant_id = p_tenant_id and c.created_at >= b.day0),
                                'campaigns', (select count(*) from integrations.developer_api_campaigns c, b where c.tenant_id = p_tenant_id and c.created_at >= b.day0),
                                'errors', (select count(*) from integrations.developer_api_activity a, b where a.tenant_id = p_tenant_id and a.created_at >= b.day0 and a.status >= 400)),
    'month', jsonb_build_object('requests', coalesce((select sum(u.n) from integrations.developer_api_usage u, b where u.tenant_id = p_tenant_id and u.minute >= b.month0), 0),
                                'leads', (select count(*) from public.developer_sandbox_leads l, b where l.tenant_id = p_tenant_id and l.created_at >= b.month0),
                                'calls_simulated', (select count(*) from integrations.developer_api_calls c, b where c.tenant_id = p_tenant_id and c.created_at >= b.month0),
                                'campaigns', (select count(*) from integrations.developer_api_campaigns c, b where c.tenant_id = p_tenant_id and c.created_at >= b.month0),
                                'errors', (select count(*) from integrations.developer_api_activity a, b where a.tenant_id = p_tenant_id and a.created_at >= b.month0 and a.status >= 400)),
    'limits', jsonb_build_object('requests_per_minute', 60, 'calls_per_minute', 10, 'campaigns_per_minute', 5, 'concurrent_calls', 10))
$$;

create or replace function public.scheduler_developer_purge() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leads integer;
  v_usage integer;
  v_activity integer;
  v_calls integer;
  v_campaigns integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  delete from integrations.developer_api_calls c where c.created_at < now() - interval '30 days';
  get diagnostics v_calls = row_count;
  delete from integrations.developer_api_campaigns c where c.created_at < now() - interval '30 days';
  get diagnostics v_campaigns = row_count;
  delete from public.developer_sandbox_leads l where l.created_at < now() - interval '30 days';
  get diagnostics v_leads = row_count;
  delete from integrations.developer_api_usage u where u.minute < now() - interval '40 days';
  get diagnostics v_usage = row_count;
  delete from integrations.developer_api_activity a where a.created_at < now() - interval '30 days';
  get diagnostics v_activity = row_count;
  return jsonb_build_object('leads', v_leads, 'usage_rows', v_usage, 'activity_rows', v_activity, 'calls', v_calls, 'campaigns', v_campaigns);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.developer_api_me(text)', 'public.developer_sandbox_call_context(text, uuid)', 'public.developer_sandbox_call_create(text, text, text, uuid, timestamptz)',
                           'public.developer_sandbox_call_get(text, uuid)', 'public.developer_sandbox_calls_list(text, uuid, timestamptz, uuid, integer)',
                           'public.developer_sandbox_campaign_create(text, text, text, jsonb)', 'public.developer_sandbox_campaign_get(text, uuid)',
                           'public.developer_sandbox_campaigns_list(text, timestamptz, uuid, integer)', 'public.developer_api_activity_log(text, text, text, integer, integer)',
                           'public.developer_api_activity_list(text, timestamptz, uuid, integer)', 'public.developer_activity_list(uuid, uuid, timestamptz, uuid, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
