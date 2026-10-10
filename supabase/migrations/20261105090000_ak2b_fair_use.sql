-- Job AK / K2b: "AI included, fair use" (owner decision 2026-10-10). The AI never just stops.
--
--   plan_ai_allowances      new numbers (paise): free_trial 2,000/30,000 (Rs 20 a day, Rs 300 a month), starter 1,500/30,000, growth 4,000/90,000,
--                           business 10,000/250,000. All under the Rs 500 wall.
--   100 % of either window  NOT a pause. The workspace's AI calls switch to the "light" model until the window resets (state "light"). Which model is the
--                           API's cost-routing choice (it is told the mode here); the DATABASE decides the mode and still prices and caps every call.
--   300 % of either window  the hard pause: the existing enforcement points (a run start, a message start, the authorisation of a model call) refuse, because
--                           app.agent_daily_cap now returns the HARD cap. Only AI features: quotes, orders, follow-ups and customers do not call it.
--
--   hard day cap      = the workspace's own cap if the operator/Owner set one (unchanged: an explicit cap is a hard cap), else least(3 x the plan's daily
--                       allowance, Rs 500 wall), else (no plan row) 3 x the operator default. An own cap BELOW the allowance pauses earlier, by choice.
--   hard month cap    = 3 x the plan's monthly allowance (none when the workspace has no plan row).
--   app.agent_daily_cap  = least(hard day cap, today's spend + what is left under the hard month cap): unchanged shape, so nothing that enforces it changes.
--   app.ai_is_light      spend today >= the daily allowance, or spend this month >= the monthly allowance.
--   public.agent_ai_mode(run, light_model)   the runtime asks before each model call: 'light' only if the workspace is light AND the named light model has a
--                                            price row (an unpriced light model could never be reserved: the AI must not stop for that), else 'normal'.
--   public.ai_usage / ai_paused_until        REPLACED: percentages (still 0..100 each: the state carries light and paused), state ok / warn / light / paused.

update public.plan_ai_allowances set daily_paise = v.d, monthly_paise = v.m, updated_at = now()
  from (values ('free_trial', 2000, 30000), ('starter', 1500, 30000), ('growth', 4000, 90000), ('business', 10000, 250000)) as v(p, d, m)
 where plan_ai_allowances.plan = v.p;

-- the multiple of the allowance at which the AI pauses, in one place (a constant, 3 = 300 %)
create function app.ai_pause_multiple() returns integer language sql immutable set search_path = '' as $$ select 3 $$;
revoke all on function app.ai_pause_multiple() from public, anon, authenticated, service_role;

-- the daily ALLOWANCE (100 %): the plan's, else the operator default (fail closed at 0 when neither exists)
create function app.ai_day_allowance(p_tenant uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.daily_paise::bigint * 10000 from public.tenants t join public.plan_ai_allowances a on a.plan = t.plan where t.id = p_tenant),
                  app.agent_limit('daily_cost_micros', 0))::bigint
$$;
revoke all on function app.ai_day_allowance(uuid) from public, anon, authenticated, service_role;

-- the HARD daily cap before the month is looked at (was: the allowance itself)
create or replace function app.agent_base_daily_cap(p_tenant uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.daily_cost_cap_micros from public.tenant_agent_settings s where s.tenant_id = p_tenant),
                  least(app.ai_day_allowance(p_tenant) * app.ai_pause_multiple(), 500000000))::bigint
$$;

-- the hard month cap (null = no monthly limit, only for a workspace without a plan row)
create function app.ai_month_hard_cap(p_tenant uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select app.ai_monthly_allowance(p_tenant) * app.ai_pause_multiple()
$$;
revoke all on function app.ai_month_hard_cap(uuid) from public, anon, authenticated, service_role;

create or replace function app.agent_daily_cap(p_tenant uuid) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base  bigint := app.agent_base_daily_cap(p_tenant);
  v_month bigint := app.ai_month_hard_cap(p_tenant);
begin
  if v_month is null then
    return v_base;
  end if;
  return least(v_base, (app.agent_day_spend(p_tenant, app.agent_utc_today()) + greatest(v_month - app.agent_month_spend(p_tenant), 0))::bigint);
end;
$$;

-- light: either window has reached 100 % of its allowance
create function app.ai_is_light(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.agent_day_spend(p_tenant, app.agent_utc_today()) >= app.ai_day_allowance(p_tenant)
      or coalesce(app.agent_month_spend(p_tenant) >= app.ai_monthly_allowance(p_tenant), false)
$$;
revoke all on function app.ai_is_light(uuid) from public, anon, authenticated, service_role;

-- paused: the AI would be refused right now (no room under the hard caps)
create function app.ai_is_paused(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.agent_day_spend(p_tenant, app.agent_utc_today()) >= app.agent_daily_cap(p_tenant)
$$;
revoke all on function app.ai_is_paused(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the runtime's question before each model call
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.agent_ai_mode(p_run_id uuid, p_light_model text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_runs;
begin
  r := app.agent_open_run(p_run_id);
  if p_light_model is not null and exists (select 1 from public.agent_model_prices p where p.model = p_light_model) and app.ai_is_light(r.tenant_id) then
    return jsonb_build_object('mode', 'light');
  end if;
  return jsonb_build_object('mode', 'normal');
end;
$$;
revoke all on function public.agent_ai_mode(uuid, text) from public, anon;
grant execute on function public.agent_ai_mode(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the two reads
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.ai_usage(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today   date := app.agent_utc_today();
  v_day_all numeric;
  v_month   numeric;
  v_day_raw integer;
  v_mon_raw integer;
  v_win     record;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  select * into v_win from app.ai_month_window(p_tenant_id);
  v_day_all := app.ai_day_allowance(p_tenant_id);
  v_month   := app.ai_monthly_allowance(p_tenant_id);
  -- the true percentages (not capped), only to pick the state; what leaves is capped at 100
  v_day_raw := case when v_day_all <= 0 then 100 else least(1000, floor(app.agent_day_spend(p_tenant_id, v_today) * 100 / v_day_all))::integer end;
  v_mon_raw := case when v_month is null then 0 when v_month <= 0 then 100 else least(1000, floor(app.agent_month_spend(p_tenant_id) * 100 / v_month))::integer end;
  return jsonb_build_object(
    'today_percent', least(100, v_day_raw),
    'month_percent', least(100, v_mon_raw),
    'resets_at_today', ((v_today + 1)::timestamp at time zone 'Asia/Kolkata'),
    'resets_at_month', (v_win.win_end::timestamp at time zone 'Asia/Kolkata'),
    'state', case when app.ai_is_paused(p_tenant_id) then 'paused'
                  when v_day_raw >= 100 or v_mon_raw >= 100 then 'light'
                  when v_day_raw >= 80 or v_mon_raw >= 80 then 'warn'
                  else 'ok' end);
end;
$$;

create or replace function public.ai_paused_until(p_tenant_id uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.agent_utc_today();
  v_month bigint;
  v_win   record;
  v_until timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.agent_deny();
  end if;
  select * into v_win from app.ai_month_window(p_tenant_id);
  v_month := app.ai_month_hard_cap(p_tenant_id);
  if v_month is not null and app.agent_month_spend(p_tenant_id) >= v_month then
    v_until := (v_win.win_end::timestamp at time zone 'Asia/Kolkata');
  end if;
  if app.agent_day_spend(p_tenant_id, v_today) >= app.agent_base_daily_cap(p_tenant_id) then
    v_until := greatest(coalesce(v_until, '-infinity'::timestamptz), ((v_today + 1)::timestamp at time zone 'Asia/Kolkata'));
  end if;
  return v_until;
end;
$$;
