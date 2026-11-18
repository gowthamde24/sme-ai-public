-- The Lead Finder is visible to every business on every plan, with ONE free search a month (owner decision, 18 Nov 2026: pricing gives every plan one free search a month).
--   * app.lf_gate no longer refuses a workspace for its plan: the module (business type) and the role still decide who may use it.
--   * A workspace WITHOUT the Lead Finder in its plan (Lead Desk) has one search a calendar month (India time): approving a second one is refused with SM974, now meaning "the free search of
--     this month is used". A workspace WITH the feature (AI Workforce) has no monthly limit (the daily cap of its settings still applies).
--   * public.lead_finder_allowance(tenant) tells the API: {entitled, per_month, used, left}. A search counts when it is approved (a plan nobody approved, a cancelled one, costs nothing).
create function app.lf_searches_this_month(p_tenant_id uuid) returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.prospect_searches s
   where s.tenant_id = p_tenant_id and s.approved_at is not null and s.state <> 'cancelled'
     and date_trunc('month', s.approved_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata')
$$;
revoke all on function app.lf_searches_this_month(uuid) from public, anon, authenticated, service_role;

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
  -- no refusal for the plan any more: every plan has the Lead Finder (one free search a month where the plan does not carry it)
end;
$$;
revoke all on function app.lf_gate(uuid, public.app_role[]) from public, anon, authenticated, service_role;

create function app.lf_free_search_left(p_tenant_id uuid) returns integer   -- null = no monthly limit (the plan carries the Lead Finder)
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.entitled(p_tenant_id, 'lead_finder') then null else greatest(0, 1 - app.lf_searches_this_month(p_tenant_id)) end
$$;
revoke all on function app.lf_free_search_left(uuid) from public, anon, authenticated, service_role;

create function public.lead_finder_allowance(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  return jsonb_build_object(
    'entitled', app.entitled(p_tenant_id, 'lead_finder'),
    'per_month', case when app.entitled(p_tenant_id, 'lead_finder') then null else 1 end,
    'used', app.lf_searches_this_month(p_tenant_id),
    'left', app.lf_free_search_left(p_tenant_id));
end;
$$;
revoke all on function public.lead_finder_allowance(uuid) from public, anon;
grant execute on function public.lead_finder_allowance(uuid) to authenticated;
comment on function public.lead_finder_allowance(uuid) is 'The free search of this calendar month (India time): {entitled, per_month (1, or null when the plan carries the Lead Finder), used, left}. Owner, Admin, Sales.';

-- approving a search spends the free one: refused when it is used (SM974)
do $patch$
declare
  v_def text := pg_get_functiondef('public.prospect_search_approve(uuid, uuid)'::regprocedure);
  v_old text := E'  select * into s from public.lead_finder_settings z where z.tenant_id = p_tenant_id;\n  if found then\n    v_cap := s.searches_per_day;';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'prospect_search_approve has changed: the free-search patch no longer fits';
  end if;
  execute replace(v_def, v_old, E'  if app.lf_free_search_left(p_tenant_id) = 0 then\n    perform app.lf_error(''plan'');   -- the free search of this month is used\n  end if;\n' || v_old);
end;
$patch$;
