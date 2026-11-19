-- Customer Zero's free minutes (owner and planner decision, 19 Nov 2026): the owner's own first real business gets 500 free call minutes a month instead of the plan's 60, by ONE NUMBER on that business (the operator sets it;
-- nothing in a migration names a business). Like the Lead Finder's per-business number (migration 20261231984800) it is an override on the existing plan mechanism, not a second one:
--   * tenants.call_minutes_override: the business's call minutes a month, set only by app.operator_set_call_minutes (null = the plan's number). app.billing_plan_row, which every meter, the alerts, the Billing page and the
--     call path already read, answers with this number in place of the plan's, so the existing ledger (billing_usage_events, 30-second pulses) and the existing meter count against it;
--   * the month of such a business is the INDIA CALENDAR MONTH (app.billing_period, which the meter reads): from the 1st to the last day, Asia/Kolkata. Other businesses keep the window anchored on their own start day;
--   * the line lookups (phone_line_find, phone_line_for_tenant) carry `free_minutes` ({minutes, restarts_on}) and, once the minutes are used up, `forward_to` (the business phone on its profile, digits with the country
--     code): the call path then rings the shop's own phone for an incoming call (instead of the assistant answering) and an outgoing assistant call stops with one plain sentence. Both stay null for every other business.
-- Like the early access plan's 60 minutes, the meter stops a call only while the platform switch `billing_enforced` is on (app.operator_set_billing_enforced).

alter table public.tenants add column call_minutes_override integer check (call_minutes_override between 0 and 100000);
comment on column public.tenants.call_minutes_override is 'SAFE: a number set by the operator for this business only (call minutes a month; null = the plan''s number). CLEAN-EXEMPT: range CHECK';

-- 1. the allowance: the business's own number replaces the plan's
alter function app.billing_plan_row(uuid) rename to billing_plan_row_plan;
create function app.billing_plan_row(p_tenant uuid) returns billing.plan_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r     billing.plan_versions;
  v_min integer;
begin
  r := app.billing_plan_row_plan(p_tenant);
  select t.call_minutes_override into v_min from public.tenants t where t.id = p_tenant;
  if v_min is not null and r.plan_id is not null then
    r.call_minutes := v_min;
  end if;
  return r;
end;
$$;
revoke all on function app.billing_plan_row(uuid) from public, anon, authenticated, service_role;
revoke all on function app.billing_plan_row_plan(uuid) from public, anon, authenticated, service_role;

-- 2. the month: the India calendar month for a business with its own number; the workspace's own window for every other
create or replace function app.billing_period(p_tenant uuid, out o_start date, out o_end date) returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.agent_utc_today();
begin
  if exists (select 1 from public.tenants t where t.id = p_tenant and t.call_minutes_override is not null) then
    o_start := v_today - (extract(day from v_today)::integer - 1);
    o_end := (o_start + interval '1 month')::date;
  else
    select w.win_start, w.win_end into o_start, o_end from app.ai_month_window(p_tenant) w;
  end if;
end;
$$;
revoke all on function app.billing_period(uuid) from public, anon, authenticated, service_role;

-- 3. what the call path is told: the number and the day the minutes start again (null for a business without its own number)
create function app.free_minutes_json(p_tenant uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer;
  w     record;
begin
  select t.call_minutes_override into v_min from public.tenants t where t.id = p_tenant;
  if v_min is null then
    return null;
  end if;
  select * into w from app.billing_period(p_tenant);
  return jsonb_build_object('minutes', v_min, 'restarts_on', w.o_end);
end;
$$;
revoke all on function app.free_minutes_json(uuid) from public, anon, authenticated, service_role;

-- where an incoming call goes once the minutes are used up: the business phone on the profile (digits with the country code), only for a business with its own number; null when the minutes are not used up,
-- when there is no usable phone (a landline without a country code is not guessed), or for any other business
create function app.free_minutes_forward(p_tenant uuid) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.call_minutes_override is not null) or not app.billing_stopped(p_tenant, 'call_minutes') then
    return null;
  end if;
  select app.profile_phone_clean(p.phone) into v_phone from workspace.profiles p where p.tenant_id = p_tenant;
  return nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
end;
$$;
revoke all on function app.free_minutes_forward(uuid) from public, anon, authenticated, service_role;

-- 4. the line lookups tell the call path (the same two patches as the early access plan's, one more pair of keys)
do $patch$
declare
  v_def text := pg_get_functiondef('public.phone_line_find(text)'::regprocedure);
  v_old text := $q$'billing_blocked', app.billing_stopped(n.tenant_id, 'call_minutes'));$q$;
  v_new text := $q$'billing_blocked', app.billing_stopped(n.tenant_id, 'call_minutes'), 'free_minutes', app.free_minutes_json(n.tenant_id), 'forward_to', app.free_minutes_forward(n.tenant_id));$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'phone_line_find has changed: the free minutes patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
do $patch$
declare
  v_def text := pg_get_functiondef('public.phone_line_for_tenant(uuid,text)'::regprocedure);
  v_old text := $q$'billing_blocked', app.billing_stopped(n.tenant_id, 'call_minutes'));$q$;
  v_new text := $q$'billing_blocked', app.billing_stopped(n.tenant_id, 'call_minutes'), 'free_minutes', app.free_minutes_json(n.tenant_id), 'forward_to', app.free_minutes_forward(n.tenant_id));$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'phone_line_for_tenant has changed: the free minutes patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- 5. the operator sets (or takes away, with null) one business's number; never a signed-in person, never a client
create function app.operator_set_call_minutes(p_tenant_id uuid, p_minutes integer) returns void
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
  update public.tenants set call_minutes_override = p_minutes where id = p_tenant_id;
end;
$$;
revoke all on function app.operator_set_call_minutes(uuid, integer) from public, anon, authenticated, service_role;
