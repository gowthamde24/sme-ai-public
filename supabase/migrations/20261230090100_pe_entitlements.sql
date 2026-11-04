-- Plans as feature switches (owner decision, 4 Nov 2026): two subscriptions.
--   AI Workforce = every feature.   Lead Desk = every feature EXCEPT the Lead Finder.
-- Nothing is charged or enforced beyond these switches until Customer Zero. The catalogue (packages/plans/plans.json, version 4, synced by 20261230090000) names each plan's `product` and each
-- product's `features`; a feature no product names is on for every plan. These functions read the manifest of the latest catalogue version, so a later catalogue changes the switches without code.
--   app.workspace_product(tenant)        'ai_workforce' | 'lead_desk' (a plan the catalogue does not know: ai_workforce, so nobody loses a feature by a typo)
--   app.entitled(tenant, feature)        the switch
--   public.workspace_entitlements(t)     what the screens show (any member): the plan, its product, each feature on or off, and what to move to for one that is off
-- The Lead Finder's gate (app.lf_gate) asks the switch after the module: a Lead Desk workspace gets SQLSTATE SM974 (the API: 403 `not_in_plan`, the chat: the "part of AI Workforce" card).

create function app.workspace_product(p_tenant uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p ->> 'product'
      from public.tenants t, billing.catalogue_versions v, jsonb_array_elements(v.manifest -> 'plans') p
     where t.id = p_tenant and p ->> 'id' = t.plan and p ->> 'product' in ('ai_workforce', 'lead_desk')
     order by v.version desc
     limit 1), 'ai_workforce')
$$;
revoke all on function app.workspace_product(uuid) from public, anon, authenticated, service_role;

create function app.entitled(p_tenant uuid, p_feature text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select v.manifest -> 'products' as products from billing.catalogue_versions v order by v.version desc limit 1)
  select case
    when p_feature is null then false
    -- a feature no product names is not switched by the plan: on for everybody
    when not exists (select 1 from m, jsonb_each(coalesce(m.products, '{}'::jsonb)) e where e.value -> 'features' ? p_feature) then true
    else coalesce((select (m.products -> app.workspace_product(p_tenant) -> 'features') ? p_feature from m), false)
  end
$$;
revoke all on function app.entitled(uuid, text) from public, anon, authenticated, service_role;

create function public.workspace_entitlements(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product  text;
  v_products jsonb;
  v_plan     text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select t.plan into v_plan from public.tenants t where t.id = p_tenant_id;
  v_product := app.workspace_product(p_tenant_id);
  select v.manifest -> 'products' into v_products from billing.catalogue_versions v order by v.version desc limit 1;
  return jsonb_build_object(
    'plan', v_plan,
    'product', v_product,
    'product_name', coalesce(v_products -> v_product -> 'name', jsonb_build_object('en', v_product)),
    'features', jsonb_build_object('lead_desk', app.entitled(p_tenant_id, 'lead_desk'), 'lead_finder', app.entitled(p_tenant_id, 'lead_finder')),
    -- for a feature that is off: the product that has it (no price, no charge: the screen shows an upgrade link)
    'upgrade', case when app.entitled(p_tenant_id, 'lead_finder') then null else jsonb_build_object('product', 'ai_workforce', 'product_name', coalesce(v_products -> 'ai_workforce' -> 'name', '{"en": "AI Workforce"}'::jsonb), 'features', jsonb_build_array('lead_finder')) end
  );
end;
$$;
revoke all on function public.workspace_entitlements(uuid) from public, anon;
grant execute on function public.workspace_entitlements(uuid) to authenticated;
comment on function public.workspace_entitlements(uuid) is 'Owner decision 4 Nov 2026: the workspace''s plan, its product (AI Workforce or Lead Desk) and each feature switch. Any member. No price.';

-- the Lead Finder: a closed word for "not in your plan", then the gate asks the switch after the module
create or replace function app.lf_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'module'    then raise exception 'not available for this business type' using errcode = 'SM971';
    when 'cap'       then raise exception 'the search limit for today is reached' using errcode = 'SM972';
    when 'state'     then raise exception 'not possible in the state it is in now' using errcode = 'SM973';
    when 'plan'      then raise exception 'not in this workspace''s plan' using errcode = 'SM974';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.lf_error(text) from public, anon, authenticated, service_role;

create or replace function app.lf_gate(p_tenant_id uuid, p_roles public.app_role[]) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, p_roles) then
    perform app.lf_error('deny');
  end if;
  if not app.module_enabled(p_tenant_id, 'lead_finder') then
    perform app.lf_error('module');
  end if;
  if not app.entitled(p_tenant_id, 'lead_finder') then
    perform app.lf_error('plan');   -- a Lead Desk workspace: the Lead Finder is part of AI Workforce
  end if;
end;
$$;
revoke all on function app.lf_gate(uuid, public.app_role[]) from public, anon, authenticated, service_role;
