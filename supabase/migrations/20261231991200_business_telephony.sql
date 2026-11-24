-- Business KYC per client (Model B; 24 Nov 2026; reports/business-kyc-and-numbers.md). OFF in production (API flag KYC_PER_CLIENT). One row per workspace: the id of ITS VoiceLink client and where its KYC stands.
-- Only ids, closed words and times are kept: never a PAN, a GSTIN, a name or a document (they pass through the API to VoiceLink and are dropped).
-- Tenant table outside the public schema: no client role has any privilege; the public.business_client_* functions are the only door. Rollback = drop table telephony.business_clients and the two functions.

create schema if not exists telephony;
revoke all on schema telephony from public, anon, authenticated, service_role;

create table telephony.business_clients (
  tenant_id     uuid primary key references public.tenants (id) on delete restrict,
  client_id     integer not null check (client_id > 0),
  account_type  text check (account_type in ('individual', 'business')),
  state         text not null default 'created' check (state in ('created', 'in_progress', 'submitted', 'verified', 'stuck')),
  reason        text check (reason is null or reason ~ '^[a-z][a-z_]{1,40}$'),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id)
);
comment on table telephony.business_clients is 'The VoiceLink client made for a workspace (Model B) and where its KYC stands. Ids and closed words only; never a document or an identity number.';
comment on column telephony.business_clients.reason is 'SAFE: a closed word (why a KYC is stuck). CLEAN-EXEMPT: pattern CHECK';
alter table telephony.business_clients enable row level security;
alter table telephony.business_clients force row level security;
revoke all on telephony.business_clients from public, anon, authenticated, service_role;

create function public.business_client_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c telephony.business_clients;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into c from telephony.business_clients x where x.tenant_id = p_tenant_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object('client_id', c.client_id, 'account_type', c.account_type, 'state', c.state, 'reason', c.reason, 'updated_at', c.updated_at);
end $$;
revoke all on function public.business_client_get(uuid) from public, anon;
grant execute on function public.business_client_get(uuid) to authenticated;

-- the API writes after it has talked to VoiceLink; Owner only. The client id is set once (a second call with another id is refused); the state and reason move.
create function public.business_client_put(p_tenant_id uuid, p_client_id integer, p_account_type text, p_state text, p_reason text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c telephony.business_clients;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_client_id is null or p_client_id <= 0 or p_state not in ('created', 'in_progress', 'submitted', 'verified', 'stuck')
     or (p_account_type is not null and p_account_type not in ('individual', 'business')) or (p_reason is not null and p_reason !~ '^[a-z][a-z_]{1,40}$') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into c from telephony.business_clients x where x.tenant_id = p_tenant_id for update;
  if found and c.client_id <> p_client_id then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into telephony.business_clients (tenant_id, client_id, account_type, state, reason, created_by)
  values (p_tenant_id, p_client_id, p_account_type, p_state, p_reason, auth.uid())
  on conflict (tenant_id) do update
    set account_type = coalesce(excluded.account_type, telephony.business_clients.account_type), state = excluded.state, reason = excluded.reason, updated_at = now();
  perform app.write_audit_event(p_tenant_id, 'phone.business_kyc_' || p_state, 'workspace', p_tenant_id, null, jsonb_build_object('client_id', p_client_id));
  return public.business_client_get(p_tenant_id);
end $$;
revoke all on function public.business_client_put(uuid, integer, text, text, text) from public, anon;
grant execute on function public.business_client_put(uuid, integer, text, text, text) to authenticated;
