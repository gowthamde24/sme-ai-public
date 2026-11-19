-- Free early access counts as a plan WITHOUT the Lead Finder (planner decision, 19 Nov 2026; the owner can reverse it): one free search a month (India time), because in production every search costs
-- Google money. The operator can raise it per business (Customer Zero, say) with a row, like the minutes:
--   * the plan's own number: billing.plan_overrides.lead_finder_per_month (early_access = 1);
--   * one business's number: public.lead_finder_settings.monthly_searches_override, set only with app.operator_set_lead_finder_limit (the operator, never a client).
-- app.lf_limit(tenant) = the searches a month: a business override, else the plan override, else NULL (no limit) when the plan carries the Lead Finder, else 1.

alter table billing.plan_overrides add column lead_finder_per_month integer check (lead_finder_per_month between 0 and 1000);
update billing.plan_overrides set lead_finder_per_month = 1 where plan_id = 'early_access';
alter table public.lead_finder_settings add column monthly_searches_override integer check (monthly_searches_override between 0 and 1000);
comment on column public.lead_finder_settings.monthly_searches_override is 'SAFE: a number set by the operator for this business only (searches a month). CLEAN-EXEMPT: range CHECK';

-- the default row of lead_finder_settings_get is a positional row(): it needs the new (last) column
do $patch$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.lead_finder_settings_get(uuid)'::regprocedure);
  if position('20, null, now())::public.lead_finder_settings' in v_def) = 0 then
    raise exception 'lead_finder_settings_get has changed: the early access patch no longer fits';
  end if;
  execute replace(v_def, '20, null, now())::public.lead_finder_settings', '20, null, now(), null)::public.lead_finder_settings');
end;
$patch$;

create function app.lf_limit(p_tenant_id uuid) returns integer   -- null = no monthly limit
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.monthly_searches_override from public.lead_finder_settings s where s.tenant_id = p_tenant_id),
    (select o.lead_finder_per_month from billing.plan_overrides o join public.tenants t on t.plan = o.plan_id where t.id = p_tenant_id and o.lead_finder_per_month is not null),
    case when app.entitled(p_tenant_id, 'lead_finder') then null else 1 end)
$$;
revoke all on function app.lf_limit(uuid) from public, anon, authenticated, service_role;

create or replace function app.lf_free_search_left(p_tenant_id uuid) returns integer   -- null = no monthly limit
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.lf_limit(p_tenant_id) is null then null else greatest(0, app.lf_limit(p_tenant_id) - app.lf_searches_this_month(p_tenant_id)) end
$$;

create or replace function public.lead_finder_allowance(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  return jsonb_build_object(
    'entitled', app.lf_limit(p_tenant_id) is null,
    'per_month', app.lf_limit(p_tenant_id),
    'used', app.lf_searches_this_month(p_tenant_id),
    'left', app.lf_free_search_left(p_tenant_id));
end;
$$;

-- the operator raises (or lowers) one business's number; null takes the override away
create function app.operator_set_lead_finder_limit(p_tenant_id uuid, p_per_month integer) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'unknown business' using errcode = '23503';
  end if;
  insert into public.lead_finder_settings (tenant_id, monthly_searches_override) values (p_tenant_id, p_per_month)
  on conflict (tenant_id) do update set monthly_searches_override = excluded.monthly_searches_override;
end;
$$;
revoke all on function app.operator_set_lead_finder_limit(uuid, integer) from public, anon, authenticated, service_role;
