-- Job AK / K2: the AI allowance per plan, in two windows (the India day and a month), shown as percentages and enforced by the database.
--
--   public.plan_ai_allowances         one row per plan: a daily and a monthly AI allowance in PAISE. Operator-managed config (no client grant at all); the
--                                     values below are PLACEHOLDERS for the owner to set (an `update` of this table is the whole change).
--   tenants.plan                      the list of plans grows: free_trial, starter, growth, business.
--   tenants.billing_anchor_at         when a paid billing period started (operator-set; clients can read it and write nothing). The monthly window runs from
--                                     this date, or from trial_started_at while it is null, in whole months: [anchor + n months, anchor + n+1 months) as
--                                     Asia/Kolkata dates (a 31st anchor clamps to the month's last day, the way a calendar does).
--   app.ai_month_window / agent_month_spend / agent_base_daily_cap       the pieces
--   app.agent_daily_cap               REPLACED. Every place that enforces the daily cap already calls it (start of a run, start of an assistant message, the
--                                     authorisation of a model call, the settlement), so they enforce BOTH windows without being touched:
--                                         base = the workspace's own cap if set, else its plan's daily allowance, else the operator default (as before)
--                                         cap  = least(base, today's spend + what is left of the month)
--                                     When the month is used up the cap equals today's spend: room zero, the same refusal (SM207 at a start, `daily_cap` at a
--                                     model call). Only agent runs and the assistant call these functions: quotes, orders, follow-ups and customers do not.
--   public.ai_usage(tenant)           Owner or Admin: { today_percent, month_percent, resets_at_today, resets_at_month, state }. Percent = spent / allowance,
--                                     rounded DOWN, at most 100. state: ok, warn (either >= 80) or paused (either = 100). No paise, no tokens leave this function.
--   public.ai_paused_until(tenant)    Any member: when the AI features can be used again (the later reset of a used-up window), or null. A time, never an amount.
--
-- "Today" is app.agent_utc_today() (the Asia/Kolkata date, job AF), so a test can freeze the clock the way pgTAP 73 does.

alter table public.tenants drop constraint tenants_plan_check;
alter table public.tenants add constraint tenants_plan_check check (plan in ('free_trial', 'starter', 'growth', 'business'));
alter table public.tenants add column billing_anchor_at timestamptz;
comment on column public.tenants.billing_anchor_at is 'SAFE: when the current paid billing period started (null = the monthly AI window runs from trial_started_at); not personal data';

create table public.plan_ai_allowances (
  plan          text primary key check (plan in ('free_trial', 'starter', 'growth', 'business')),
  daily_paise   integer not null check (daily_paise between 1 and 1000000),
  monthly_paise integer not null check (monthly_paise between 1 and 100000000),
  updated_at    timestamptz not null default now(),
  check (monthly_paise >= daily_paise)
);
comment on table public.plan_ai_allowances is 'Operator config: the AI allowance per plan in paise (1 paisa = 10,000 micros). PLACEHOLDER values until the owner sets them. Not tenant-owned, no client access.';
alter table public.plan_ai_allowances enable row level security;
alter table public.plan_ai_allowances force row level security;
revoke all on public.plan_ai_allowances from public, anon, authenticated;

insert into public.plan_ai_allowances (plan, daily_paise, monthly_paise) values
  ('free_trial',   200,   6000),   -- ₹2 a day,  ₹60 a month  (the daily figure equals the old operator default, so a trial workspace behaves as before)
  ('starter',      500,  15000),   -- ₹5 a day,  ₹150 a month
  ('growth',      2000,  60000),   -- ₹20 a day, ₹600 a month
  ('business',    5000, 150000);   -- ₹50 a day, ₹1,500 a month

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the month window (Asia/Kolkata dates) and what was spent in it
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.ai_month_window(p_tenant uuid, out win_start date, out win_end date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_anchor date;
  v_today  date := app.agent_utc_today();
  n        integer;
begin
  select (coalesce(t.billing_anchor_at, t.trial_started_at) at time zone 'Asia/Kolkata')::date into v_anchor from public.tenants t where t.id = p_tenant;
  if v_anchor is null then
    v_anchor := v_today;
  end if;
  n := greatest(0, (extract(year from v_today)::integer - extract(year from v_anchor)::integer) * 12 + extract(month from v_today)::integer - extract(month from v_anchor)::integer);
  while n > 0 and (v_anchor + make_interval(months => n))::date > v_today loop
    n := n - 1;
  end loop;
  win_start := (v_anchor + make_interval(months => n))::date;
  win_end   := (v_anchor + make_interval(months => n + 1))::date;
end;
$$;
revoke all on function app.ai_month_window(uuid) from public, anon, authenticated, service_role;

create function app.agent_month_spend(p_tenant uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce(x.settled_micros, x.reserved_micros)), 0)
    from public.agent_cost_reservations x, app.ai_month_window(p_tenant) w
   where x.tenant_id = p_tenant and x.cost_day >= w.win_start and x.cost_day < w.win_end
$$;
revoke all on function app.agent_month_spend(uuid) from public, anon, authenticated, service_role;

-- the plan's monthly allowance in micros (null when the workspace has no plan row: no monthly limit, fail open only for a plan that does not exist)
create function app.ai_monthly_allowance(p_tenant uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select a.monthly_paise::bigint * 10000 from public.tenants t join public.plan_ai_allowances a on a.plan = t.plan where t.id = p_tenant
$$;
revoke all on function app.ai_monthly_allowance(uuid) from public, anon, authenticated, service_role;

-- the daily allowance before the month is looked at: the workspace's own cap, else its plan's, else the operator default (fail closed at 0)
create function app.agent_base_daily_cap(p_tenant uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.daily_cost_cap_micros from public.tenant_agent_settings s where s.tenant_id = p_tenant),
                  (select a.daily_paise::bigint * 10000 from public.tenants t join public.plan_ai_allowances a on a.plan = t.plan where t.id = p_tenant),
                  app.agent_limit('daily_cost_micros', 0))::bigint
$$;
revoke all on function app.agent_base_daily_cap(uuid) from public, anon, authenticated, service_role;

-- the cap every enforcement point uses: the daily allowance, squeezed so that today's spend can never carry the month past its allowance
create or replace function app.agent_daily_cap(p_tenant uuid) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base    bigint := app.agent_base_daily_cap(p_tenant);
  v_monthly bigint := app.ai_monthly_allowance(p_tenant);
begin
  if v_monthly is null then
    return v_base;
  end if;
  return least(v_base, (app.agent_day_spend(p_tenant, app.agent_utc_today()) + greatest(v_monthly - app.agent_month_spend(p_tenant), 0))::bigint);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the two reads
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.ai_usage(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today   date := app.agent_utc_today();
  v_day_cap numeric;
  v_month   numeric;
  v_day_pct integer;
  v_mon_pct integer;
  v_win     record;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  select * into v_win from app.ai_month_window(p_tenant_id);
  v_day_cap := app.agent_base_daily_cap(p_tenant_id);
  v_month   := app.ai_monthly_allowance(p_tenant_id);
  v_day_pct := case when v_day_cap <= 0 then 100 else least(100, floor(app.agent_day_spend(p_tenant_id, v_today) * 100 / v_day_cap))::integer end;
  v_mon_pct := case when v_month is null then 0 when v_month <= 0 then 100 else least(100, floor(app.agent_month_spend(p_tenant_id) * 100 / v_month))::integer end;
  return jsonb_build_object(
    'today_percent', v_day_pct,
    'month_percent', v_mon_pct,
    'resets_at_today', ((v_today + 1)::timestamp at time zone 'Asia/Kolkata'),
    'resets_at_month', (v_win.win_end::timestamp at time zone 'Asia/Kolkata'),
    'state', case when v_day_pct >= 100 or v_mon_pct >= 100 then 'paused' when v_day_pct >= 80 or v_mon_pct >= 80 then 'warn' else 'ok' end);
end;
$$;
revoke all on function public.ai_usage(uuid) from public, anon;
grant execute on function public.ai_usage(uuid) to authenticated;

create function public.ai_paused_until(p_tenant_id uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today   date := app.agent_utc_today();
  v_day_cap numeric;
  v_month   numeric;
  v_win     record;
  v_until   timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.agent_deny();
  end if;
  select * into v_win from app.ai_month_window(p_tenant_id);
  v_day_cap := app.agent_base_daily_cap(p_tenant_id);
  v_month   := app.ai_monthly_allowance(p_tenant_id);
  if v_month is not null and app.agent_month_spend(p_tenant_id) >= v_month then
    v_until := (v_win.win_end::timestamp at time zone 'Asia/Kolkata');
  end if;
  if app.agent_day_spend(p_tenant_id, v_today) >= v_day_cap then
    v_until := greatest(coalesce(v_until, '-infinity'::timestamptz), ((v_today + 1)::timestamp at time zone 'Asia/Kolkata'));
  end if;
  return v_until;
end;
$$;
revoke all on function public.ai_paused_until(uuid) from public, anon;
grant execute on function public.ai_paused_until(uuid) to authenticated;
