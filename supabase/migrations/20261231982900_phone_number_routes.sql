-- A business gets, and gives back, its own phone number (the RPCs trust only what the database can check: the vault key is the workspace's own, the sub-account is the one its accepted KYC made; that the provider really rented the number is the API's duty: a signed-in Owner who calls the RPC directly can record a number for their OWN workspace only, which costs nobody else anything) (planner, 18 Nov 2026; blocker 3). The provider side is one adapter in the API (search, assign, release); the database keeps the line:
--   * phone_number_attach: the Owner (second factor) records the line the provider rented: one Plivo line per business, inbound OFF until the first test call has passed;
--   * phone_number_detach: the Owner (second factor) gives it back: returns the line so the API can release it at the provider FIRST, then removes the row;
--   * the phone server lists the lines of CLOSED workspaces (archived) and removes a row once the provider has released it, so a closed account never keeps a rented number.
create function public.phone_number_attach(p_tenant_id uuid, p_number text, p_account_ref text, p_external_ref text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.phone_numbers;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  perform app.require_aal2();
  if p_number is null or p_number !~ '^\+[0-9]{8,15}$' or p_account_ref is distinct from 'sme-ws-' || p_tenant_id::text || '-plivo-token' then
    perform app.phone_error('invalid');   -- the vault key is THIS workspace's own: another workspace's token can never be named
  end if;
  if not exists (select 1 from public.phone_kyc k where k.tenant_id = p_tenant_id and k.status = 'accepted' and k.plivo_subaccount is not distinct from p_external_ref and p_external_ref is not null) then
    perform app.phone_error('state');   -- only a business whose own registration is accepted, and only into its own sub-account
  end if;
  if exists (select 1 from public.phone_numbers x where x.tenant_id = p_tenant_id and x.provider = 'plivo') then
    perform app.phone_error('state');   -- one business line per workspace
  end if;
  insert into public.phone_numbers (tenant_id, number, label, inbound_on, provider, account_ref, external_ref)
  values (p_tenant_id, p_number, 'Business line', false, 'plivo', p_account_ref, p_external_ref)
  returning * into n;
  return jsonb_build_object('line_id', n.id, 'number', n.number, 'inbound_on', n.inbound_on);
end;
$$;
revoke all on function public.phone_number_attach(uuid, text, text, text) from public, anon;
grant execute on function public.phone_number_attach(uuid, text, text, text) to authenticated;

create function public.phone_number_detach(p_tenant_id uuid, p_number text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.phone_numbers;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  perform app.require_aal2();
  delete from public.phone_numbers x where x.tenant_id = p_tenant_id and x.number = p_number and x.provider = 'plivo' returning * into n;
  if not found then
    perform app.phone_error('reference');
  end if;
  return jsonb_build_object('number', n.number);
end;
$$;
revoke all on function public.phone_number_detach(uuid, text) from public, anon;
grant execute on function public.phone_number_detach(uuid, text) to authenticated;

create function public.scheduler_phone_lines_closed(p_limit integer default 5) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tenant_id', n.tenant_id, 'number', n.number, 'account_ref', n.account_ref, 'external_ref', n.external_ref))
                     from (select x.* from public.phone_numbers x join public.tenants t on t.id = x.tenant_id
                            where t.archived_at is not null and x.provider = 'plivo' order by random() limit greatest(1, least(coalesce(p_limit, 5), 100))) n), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_phone_lines_closed(integer) from public, anon;
grant execute on function public.scheduler_phone_lines_closed(integer) to authenticated;

create function public.scheduler_phone_line_removed(p_number text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  delete from public.phone_numbers x using public.tenants t where x.number = p_number and t.id = x.tenant_id and t.archived_at is not null and x.provider = 'plivo';
  return found;
end;
$$;
revoke all on function public.scheduler_phone_line_removed(text) from public, anon;
grant execute on function public.scheduler_phone_line_removed(text) to authenticated;
