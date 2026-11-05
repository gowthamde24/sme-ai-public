-- The developer API, part D1 (owner decision 5 Nov 2026; ADR 0121; docs/contracts/developer-api.md): API keys and the TEST-MODE lead sandbox.
--   public.developer_api_keys          a workspace's API keys. Only an Owner or an Admin makes, rotates and revokes them, signed in, through the functions below. The database keeps the SHA-256
--                                      of the secret, its prefix and its last four, never the secret.
--   public.developer_sandbox_leads     the leads a TEST key posts. They never go into the workspace's leads, follow-ups, Lead Desk or calls. They are kept 30 days.
--   integrations.developer_api_usage   one counter per key and minute: the rate limit (60 a minute), the last use and the usage numbers. Outside the public schema, no client can reach it, and
--                                      it has no audit trigger (one row a minute per key; no personal data).
-- A program has no person's sign-in: the API calls the developer_api_* functions as the worker account (app.is_scheduler), passing the key's hash. EVERY such function finds the key by its hash
-- and checks that it is not revoked and has the scope, BEFORE it reads or writes, and only ever touches that key's workspace. There is no generic access.

create table public.developer_api_keys (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id),
  name        text not null check (char_length(name) between 1 and 60 and app.text_is_clean(name)),
  mode        text not null default 'test' check (mode = 'test'),
  key_hash    text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  prefix      text not null check (prefix ~ '^sk_test_[A-Za-z0-9]{4}$'),
  last4       text not null check (last4 ~ '^[A-Za-z0-9]{4}$'),
  scopes      text[] not null check (cardinality(scopes) between 1 and 6 and scopes <@ array['leads:write', 'leads:read', 'calls:read', 'campaigns:write', 'webhooks', 'usage:read']),
  ip_allow    cidr[] not null default '{}' check (cardinality(ip_allow) <= 10),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz,
  revoked_at  timestamptz,
  unique (tenant_id, id)
);
comment on table public.developer_api_keys is 'A workspace''s developer API keys (test mode only for now). Written only by developer_key_create / _rotate / _revoke (Owner or Admin); the secret itself is never stored.';
comment on column public.developer_api_keys.name is 'SAFE: the Owner''s label for the key (e.g. "Website"); not personal data.';
comment on column public.developer_api_keys.mode is 'SAFE: test (live keys do not exist yet). CLEAN-EXEMPT: closed CHECK list';
comment on column public.developer_api_keys.key_hash is 'SAFE: the SHA-256 of a random 40-character secret; the secret cannot be found from it; never readable by a client (no column grant). CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.developer_api_keys.prefix is 'SAFE: sk_test_ and the first four characters of the secret, to tell keys apart. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.developer_api_keys.last4 is 'SAFE: the last four characters of the secret. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.developer_api_keys.scopes is 'SAFE: what the key may do. CLEAN-EXEMPT: closed CHECK list';
comment on column public.developer_api_keys.created_by is 'SAFE: the id of the Owner or Admin who made it. CLEAN-EXEMPT: uuid';

alter table public.developer_api_keys enable row level security;
alter table public.developer_api_keys force row level security;
revoke all on public.developer_api_keys from public, anon, authenticated, service_role;
create trigger developer_api_keys_forbid_tenant_id_change before update on public.developer_api_keys for each row execute function app.forbid_tenant_id_change();
create trigger audit_developer_api_keys after insert or update or delete on public.developer_api_keys for each row execute function app.audit_row_change('developer_api_key', '');
-- the Owner and an Admin may read the keys (never the hash: no column grant); writes only through the functions below
grant select (id, tenant_id, name, mode, prefix, last4, scopes, ip_allow, created_by, created_at, rotated_at, revoked_at) on public.developer_api_keys to authenticated;
create policy developer_api_keys_select on public.developer_api_keys for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index developer_api_keys_tenant on public.developer_api_keys (tenant_id, created_at desc, id desc);

create table public.developer_sandbox_leads (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id),
  key_id         uuid not null,
  idem_key       text not null check (char_length(idem_key) between 1 and 100 and app.text_is_clean(idem_key)),
  body_sha       text not null check (body_sha ~ '^[0-9a-f]{64}$'),
  name           text not null check (char_length(name) between 1 and 120 and app.text_is_clean(name)),
  phone          text check (phone ~ '^\+91[6-9][0-9]{9}$'),
  email          text check (char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$'),
  source         text check (char_length(source) between 1 and 40 and app.text_is_clean(source)),
  language       text check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr')),
  notes          text check (char_length(notes) <= 2000 and app.text_is_clean(notes)),
  custom_fields  jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object' and octet_length(custom_fields::text) <= 12000 and app.text_is_clean(custom_fields)),
  consent        jsonb not null check (jsonb_typeof(consent) = 'object' and consent -> 'given' = 'true'::jsonb and octet_length(consent::text) <= 2000 and app.text_is_clean(consent)),
  status         text not null default 'new' check (status in ('new', 'contacted', 'interested', 'not_interested', 'visit_booked', 'won', 'lost')),
  outcome        text check (outcome in ('interested', 'not_interested', 'callback', 'no_answer', 'visit_booked')),
  next_step      text not null check (next_step in ('call', 'call_at', 'follow_up', 'none')),
  next_step_at   timestamptz,
  blocked        text check (blocked in ('dnd', 'calling_hours')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (phone is not null or email is not null),
  foreign key (tenant_id, key_id) references public.developer_api_keys (tenant_id, id),
  unique (key_id, idem_key)
);
comment on table public.developer_sandbox_leads is 'TEST MODE: the leads a developer posted with a test key. Never the workspace''s real leads; nothing is ever called or sent; kept 30 days.';
comment on column public.developer_sandbox_leads.idem_key is 'SAFE: the developer''s Idempotency-Key header (an opaque string).';
comment on column public.developer_sandbox_leads.body_sha is 'SAFE: the SHA-256 of the request body, to tell a retry from a different request. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.developer_sandbox_leads.name is 'PII: the lead''s name as the developer posted it.';
comment on column public.developer_sandbox_leads.phone is 'PII: the lead''s phone number. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.developer_sandbox_leads.email is 'PII: the lead''s e-mail address. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.developer_sandbox_leads.source is 'SAFE: the developer''s source label (e.g. website).';
comment on column public.developer_sandbox_leads.language is 'SAFE: a language code. CLEAN-EXEMPT: closed CHECK list';
comment on column public.developer_sandbox_leads.notes is 'PII: free text about the lead.';
comment on column public.developer_sandbox_leads.custom_fields is 'PII: free fields about the lead.';
comment on column public.developer_sandbox_leads.consent is 'PII: the consent as posted (the text and the time).';
comment on column public.developer_sandbox_leads.status is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.developer_sandbox_leads.outcome is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.developer_sandbox_leads.next_step is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.developer_sandbox_leads.blocked is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';

alter table public.developer_sandbox_leads enable row level security;
alter table public.developer_sandbox_leads force row level security;
revoke all on public.developer_sandbox_leads from public, anon, authenticated, service_role;
create trigger developer_sandbox_leads_forbid_tenant_id_change before update on public.developer_sandbox_leads for each row execute function app.forbid_tenant_id_change();
create trigger audit_developer_sandbox_leads after insert or update or delete on public.developer_sandbox_leads for each row
  execute function app.audit_row_change('developer_sandbox_lead', 'name,phone,email,notes,custom_fields,consent');
-- the Owner and an Admin may read the test leads (Settings -> Developers); writes only through developer_sandbox_lead_create (the worker) and the clean-up
grant select on public.developer_sandbox_leads to authenticated;
create policy developer_sandbox_leads_select on public.developer_sandbox_leads for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index developer_sandbox_leads_changed on public.developer_sandbox_leads (tenant_id, updated_at, id);
create index developer_sandbox_leads_phone on public.developer_sandbox_leads (tenant_id, phone) where phone is not null;
create index developer_sandbox_leads_email on public.developer_sandbox_leads (tenant_id, lower(email)) where email is not null;
create index developer_sandbox_leads_key on public.developer_sandbox_leads (tenant_id, key_id);
create index developer_sandbox_leads_keyset on public.developer_sandbox_leads (tenant_id, created_at, id);

create table integrations.developer_api_usage (
  key_id    uuid not null references public.developer_api_keys (id),
  tenant_id uuid not null references public.tenants (id),
  minute    timestamptz not null,
  n         integer not null default 0 check (n >= 0),
  primary key (key_id, minute)
);
alter table integrations.developer_api_usage enable row level security;
alter table integrations.developer_api_usage force row level security;
revoke all on integrations.developer_api_usage from public, anon, authenticated, service_role;
create index developer_api_usage_tenant on integrations.developer_api_usage (tenant_id, minute);

-- ---------------------------------------------------------------------------------------------------------------- the key as shown (never the hash)
create function app.developer_key_json(k public.developer_api_keys) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', k.id, 'name', k.name, 'mode', k.mode, 'prefix', k.prefix, 'last4', k.last4, 'scopes', to_jsonb(k.scopes),
                            'ip_allow', coalesce((select jsonb_agg(host(c) || case when masklen(c) in (32, 128) then '' else '/' || masklen(c) end order by c) from unnest(k.ip_allow) c), '[]'::jsonb),
                            'created_at', k.created_at, 'created_by', k.created_by, 'rotated_at', k.rotated_at, 'revoked_at', k.revoked_at,
                            'last_used_at', (select max(u.minute) from integrations.developer_api_usage u where u.key_id = k.id))
$$;
revoke all on function app.developer_key_json(public.developer_api_keys) from public;

create function app.developer_lead_json(l public.developer_sandbox_leads) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', l.id, 'mode', 'test', 'name', l.name, 'phone', l.phone, 'email', l.email, 'source', l.source, 'language', l.language, 'notes', l.notes,
                            'custom_fields', l.custom_fields, 'status', l.status, 'outcome', l.outcome, 'next_step', l.next_step, 'next_step_at', l.next_step_at, 'blocked', l.blocked,
                            'created_at', l.created_at, 'updated_at', l.updated_at, 'calls', '[]'::jsonb)
$$;
revoke all on function app.developer_lead_json(public.developer_sandbox_leads) from public;

-- the key a program presented, live and with the scope (or null). Worker only.
create function app.developer_key_for(p_key_hash text, p_scope text) returns public.developer_api_keys
language sql
stable
security definer
set search_path = ''
as $$
  select k.* from public.developer_api_keys k where k.key_hash = p_key_hash and k.revoked_at is null and p_scope = any (k.scopes)
$$;
revoke all on function app.developer_key_for(text, text) from public;

-- ---------------------------------------------------------------------------------------------------------------- Settings -> Developers (Owner, Admin)
create function public.developer_keys_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(app.developer_key_json(k) order by k.revoked_at is not null, k.created_at desc, k.id desc) from public.developer_api_keys k where k.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;

-- null: 10 live keys already (the API says 409 too_many_keys)
create function public.developer_key_create(p_tenant_id uuid, p_name text, p_scopes text[], p_ip_allow text[], p_key_hash text, p_prefix text, p_last4 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.developer_api_keys;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  perform 1 from public.tenants t where t.id = p_tenant_id for update;   -- one create at a time per workspace, so the count holds
  if (select count(*) from public.developer_api_keys k where k.tenant_id = p_tenant_id and k.revoked_at is null) >= 10 then
    return null;
  end if;
  begin
    insert into public.developer_api_keys (tenant_id, name, scopes, ip_allow, key_hash, prefix, last4, created_by)
    values (p_tenant_id, p_name, (select array_agg(distinct s order by s) from unnest(p_scopes) s), coalesce(p_ip_allow::cidr[], '{}'), p_key_hash, p_prefix, p_last4, auth.uid())
    returning * into v;
  exception when invalid_text_representation or check_violation or not_null_violation or unique_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return app.developer_key_json(v);
end;
$$;

-- a new secret for the key; the old one stops working at once. null: no such live key in this workspace
create function public.developer_key_rotate(p_tenant_id uuid, p_key_id uuid, p_key_hash text, p_prefix text, p_last4 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.developer_api_keys;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  begin
    update public.developer_api_keys k set key_hash = p_key_hash, prefix = p_prefix, last4 = p_last4, rotated_at = now()
     where k.tenant_id = p_tenant_id and k.id = p_key_id and k.revoked_at is null
    returning * into v;
  exception when check_violation or not_null_violation or unique_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return case when v.id is null then null else app.developer_key_json(v) end;
end;
$$;

-- revoked for good (a revoked key is kept, so the list and the audit show it). null: no such key in this workspace
create function public.developer_key_revoke(p_tenant_id uuid, p_key_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.developer_api_keys;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  update public.developer_api_keys k set revoked_at = coalesce(k.revoked_at, now()) where k.tenant_id = p_tenant_id and k.id = p_key_id returning * into v;
  return case when v.id is null then null else app.developer_key_json(v) end;
end;
$$;

-- the numbers for Settings -> Developers and GET /api/v1/usage (the Indian day and month)
create function app.developer_usage_json(p_tenant_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as day0, date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as month0)
  select jsonb_build_object(
    'mode', 'test',
    'today', jsonb_build_object('requests', coalesce((select sum(u.n) from integrations.developer_api_usage u, b where u.tenant_id = p_tenant_id and u.minute >= b.day0), 0),
                                'leads', (select count(*) from public.developer_sandbox_leads l, b where l.tenant_id = p_tenant_id and l.created_at >= b.day0), 'calls_simulated', 0),
    'month', jsonb_build_object('requests', coalesce((select sum(u.n) from integrations.developer_api_usage u, b where u.tenant_id = p_tenant_id and u.minute >= b.month0), 0),
                                'leads', (select count(*) from public.developer_sandbox_leads l, b where l.tenant_id = p_tenant_id and l.created_at >= b.month0), 'calls_simulated', 0),
    'limits', jsonb_build_object('requests_per_minute', 60, 'concurrent_calls', 10))
$$;
revoke all on function app.developer_usage_json(uuid) from public;

create function public.developer_usage(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.developer_usage_json(p_tenant_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- the program's requests (the worker account, a key's hash)
-- Every request: the key, its scope, its IP allow-list and the rate limit (60 a minute; the request counts even when refused for the rate). Answers, never raises for the key's own faults:
-- {ok: true, tenant_id, key_id, name, remaining} | {ok: false, code: invalid_key | missing_scope | ip_not_allowed | rate_limited, retry_after?}
create function public.developer_api_auth(p_key_hash text, p_scope text, p_ip text) returns jsonb
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
  if p_scope is null or not (p_scope = any (k.scopes)) then
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

-- POST /api/v1/leads (leads:write). p_lead is the body the API checked, plus next_step / next_step_at / blocked that the API worked out (test mode).
-- {status: created | replayed | duplicate | conflict, lead}. Same Idempotency-Key + same body -> the first lead (replayed); + another body -> conflict. The same phone (or, without a phone, the
-- same e-mail) in this workspace's sandbox -> the existing lead (duplicate).
create function public.developer_sandbox_lead_create(p_key_hash text, p_idem_key text, p_body_sha text, p_lead jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.developer_api_keys;
  v public.developer_sandbox_leads;
  v_phone text := nullif(p_lead ->> 'phone', '');
  v_email text := nullif(p_lead ->> 'email', '');
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  k := app.developer_key_for(p_key_hash, 'leads:write');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_lead is null or jsonb_typeof(p_lead) <> 'object' then
    perform app.scheduler_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('developer_sandbox_lead:' || k.tenant_id::text, 0));   -- one create at a time per workspace: the dedupe holds
  select * into v from public.developer_sandbox_leads l where l.key_id = k.id and l.idem_key = p_idem_key;
  if v.id is not null then
    return jsonb_build_object('status', case when v.body_sha = p_body_sha then 'replayed' else 'conflict' end, 'lead', case when v.body_sha = p_body_sha then app.developer_lead_json(v) end);
  end if;
  select * into v from public.developer_sandbox_leads l
   where l.tenant_id = k.tenant_id and ((v_phone is not null and l.phone = v_phone) or (v_phone is null and v_email is not null and lower(l.email) = lower(v_email)))
   order by l.created_at limit 1;
  if v.id is not null then
    return jsonb_build_object('status', 'duplicate', 'lead', app.developer_lead_json(v));
  end if;
  begin
    insert into public.developer_sandbox_leads (tenant_id, key_id, idem_key, body_sha, name, phone, email, source, language, notes, custom_fields, consent, next_step, next_step_at, blocked)
    values (k.tenant_id, k.id, p_idem_key, p_body_sha, p_lead ->> 'name', v_phone, v_email, nullif(p_lead ->> 'source', ''), nullif(p_lead ->> 'language', ''), nullif(p_lead ->> 'notes', ''),
            coalesce(p_lead -> 'custom_fields', '{}'::jsonb), p_lead -> 'consent', p_lead ->> 'next_step', (p_lead ->> 'next_step_at')::timestamptz, nullif(p_lead ->> 'blocked', ''))
    returning * into v;
  exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    perform app.scheduler_error('invalid');
  end;
  return jsonb_build_object('status', 'created', 'lead', app.developer_lead_json(v));
end;
$$;

-- GET /api/v1/leads/{id} (leads:read): this key's workspace only; null otherwise
create function public.developer_sandbox_lead_get(p_key_hash text, p_id uuid) returns jsonb
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
  k := app.developer_key_for(p_key_hash, 'leads:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  return (select app.developer_lead_json(l) from public.developer_sandbox_leads l where l.tenant_id = k.tenant_id and l.id = p_id);
end;
$$;

-- GET /api/v1/leads?updated_since=&after= (leads:read): oldest change first, keyset (updated_at, id), at most 100
create function public.developer_sandbox_leads_list(p_key_hash text, p_updated_since timestamptz, p_after_at timestamptz, p_after_id uuid, p_limit integer) returns jsonb
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
  k := app.developer_key_for(p_key_hash, 'leads:read');
  if k.id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 101 or ((p_after_at is null) <> (p_after_id is null)) then
    perform app.scheduler_error('invalid');
  end if;
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

-- GET /api/v1/usage (usage:read)
create function public.developer_api_usage(p_key_hash text) returns jsonb
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
  return app.developer_usage_json(k.tenant_id);
end;
$$;

-- the worker's daily clean-up: sandbox leads after 30 days, usage counters after 40
create function public.scheduler_developer_purge() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leads integer;
  v_usage integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  delete from public.developer_sandbox_leads l where l.created_at < now() - interval '30 days';
  get diagnostics v_leads = row_count;
  delete from integrations.developer_api_usage u where u.minute < now() - interval '40 days';
  get diagnostics v_usage = row_count;
  return jsonb_build_object('leads', v_leads, 'usage_rows', v_usage);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.developer_keys_list(uuid)', 'public.developer_key_create(uuid, text, text[], text[], text, text, text)', 'public.developer_key_rotate(uuid, uuid, text, text, text)',
                           'public.developer_key_revoke(uuid, uuid)', 'public.developer_usage(uuid)', 'public.developer_api_auth(text, text, text)',
                           'public.developer_sandbox_lead_create(text, text, text, jsonb)', 'public.developer_sandbox_lead_get(text, uuid)',
                           'public.developer_sandbox_leads_list(text, timestamptz, timestamptz, uuid, integer)', 'public.developer_api_usage(text)', 'public.scheduler_developer_purge()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
