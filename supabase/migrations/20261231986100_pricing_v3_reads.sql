-- PRICING V3, part 2 (the rules that read): the usage window, the owner's plan terms, the spending limit, the gate (may this feature run now?), the upgrade hint, the 80 % / 100 % warnings, the read-only
-- state after an unpaid end of plan, and the three reads of the API: the catalogue, THE wallet (one rupee wallet, a usage line per feature) and the ledger. Billing v2 is untouched.
--   window       the period the usage lines, the included minutes, the free searches and the limits count in: the paid period of the subscription (a yearly plan counts month by month), else the India calendar month
--   gate         allowed / reason (read_only, limit_reached, wallet_empty) for calls, lead_finder, numbers, whatsapp; a workspace on early_access is never stopped here and is charged nothing
--   hint         for the last 30 days of usage: the plan that would have been cheaper, and what it saves a month (Pay as you go = Pro at 300 minutes)
--   warnings     the wallet and each limited feature at 80 % and at 100 %
--   access       full, or read_only after the end of a paid period that was not renewed (a grace of 3 days); the data is kept 90 days from then

-- ---------------------------------------------------------------------------------------------------------------------------------
-- pure helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pricing.v3_exempt(p_tenant uuid) returns boolean language sql stable set search_path = '' as
$$ select exists (select 1 from public.tenants t where t.id = p_tenant and t.plan = 'early_access') $$;

create function pricing.v3_terms(p_tenant uuid) returns pricing.plan_terms language sql stable set search_path = '' as
$$ select t.* from pricing.plan_terms t where t.plan_id = (select (pricing.plan_of(p_tenant)).id) $$;

create function pricing.v3_feature_kind(p_feature text) returns text language sql immutable set search_path = '' as
$$ select case p_feature when 'calls' then 'call' when 'lead_finder' then 'search' when 'numbers' then 'number' when 'whatsapp' then 'whatsapp' end $$;

-- the period everything is counted in
create function pricing.v3_window(p_tenant uuid, out w_start timestamptz, out w_end timestamptz) language plpgsql stable set search_path = '' as
$$
declare
  s       pricing.subscriptions;
  v_month timestamp := date_trunc('month', now() at time zone 'Asia/Kolkata');
  v_n     integer;
begin
  select * into s from pricing.subscriptions x where x.tenant_id = p_tenant and x.status <> 'cancelled';
  if found and s.period_start <= now() and s.period_end > now() then
    if s.interval = 'yearly' then
      v_n := (extract(year from age(now(), s.period_start)) * 12 + extract(month from age(now(), s.period_start)))::integer;
      w_start := s.period_start + make_interval(months => v_n);
      w_end := w_start + interval '1 month';
    else
      w_start := s.period_start;
      w_end := s.period_end;
    end if;
  else
    w_start := v_month at time zone 'Asia/Kolkata';
    w_end := (v_month + interval '1 month') at time zone 'Asia/Kolkata';
  end if;
end $$;

create function pricing.v3_spent(p_tenant uuid, p_kind text) returns bigint language sql stable set search_path = '' as
$$ select coalesce(sum(u.charged_paise), 0)::bigint from pricing.usage u where u.tenant_id = p_tenant and u.kind = p_kind and u.at >= (select w.w_start from pricing.v3_window(p_tenant) w) $$;

create function pricing.v3_limit_of(p_tenant uuid, p_feature text) returns bigint language sql stable set search_path = '' as
$$ select f.limit_paise from pricing.feature_limits f where f.tenant_id = p_tenant and f.feature = p_feature $$;

-- what a month would cost on a plan for this usage (the fee, the minutes beyond the included ones, the searches beyond the free ones)
create function pricing.v3_cost(p_terms pricing.plan_terms, p_monthly bigint, p_half_minutes bigint, p_searches bigint) returns bigint language sql immutable set search_path = '' as
$$ select p_monthly + greatest(p_half_minutes - p_terms.included_minutes::bigint * 2, 0) * (p_terms.minute_paise / 2) + greatest(p_searches - p_terms.free_searches_month, 0) * p_terms.search_paise::bigint $$;

revoke all on function pricing.v3_exempt(uuid), pricing.v3_terms(uuid), pricing.v3_feature_kind(text), pricing.v3_window(uuid), pricing.v3_spent(uuid, text), pricing.v3_limit_of(uuid, text),
  pricing.v3_cost(pricing.plan_terms, bigint, bigint, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- read-only after an unpaid end of plan; data kept 90 days
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pricing.v3_access(p_tenant uuid) returns jsonb language plpgsql stable set search_path = '' as
$$
declare
  s       pricing.subscriptions;
  st      pricing.settings_v3;
  v_until timestamptz;
  v_del   timestamptz;
begin
  select * into st from pricing.settings_v3;
  select * into s from pricing.subscriptions x where x.tenant_id = p_tenant;
  if pricing.v3_exempt(p_tenant) or not found then   -- early access never lapses; a business that has not chosen a plan yet runs on its free start
    return jsonb_build_object('access', 'full', 'read_only_since', null, 'delete_on', null, 'data_days_left', null);
  end if;
  v_until := case when s.status = 'cancelled' or s.cancel_at_period_end then s.period_end else s.period_end + make_interval(days => st.grace_days) end;
  if v_until > now() then
    return jsonb_build_object('access', 'full', 'read_only_since', null, 'delete_on', null, 'data_days_left', null);
  end if;
  v_del := v_until + make_interval(days => st.data_days);
  return jsonb_build_object('access', 'read_only', 'read_only_since', v_until, 'delete_on', v_del, 'data_days_left', greatest(ceil(extract(epoch from v_del - now()) / 86400)::integer, 0));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- may this feature run now?
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pricing.v3_gate(p_tenant uuid, p_feature text) returns jsonb language plpgsql stable set search_path = '' as
$$
declare
  t       pricing.plan_terms := pricing.v3_terms(p_tenant);
  st      pricing.settings_v3;
  v_bal   bigint := pricing.balance_of(p_tenant);
  v_kind  text := pricing.v3_feature_kind(p_feature);
  v_lim   bigint := pricing.v3_limit_of(p_tenant, p_feature);
  v_spent bigint := pricing.v3_spent(p_tenant, pricing.v3_feature_kind(p_feature));
  v_free  boolean;
  v_price bigint;
  v_n     integer;
begin
  select * into st from pricing.settings_v3;
  if v_kind is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if pricing.v3_exempt(p_tenant) then
    return jsonb_build_object('allowed', true, 'reason', null, 'balance_paise', v_bal);
  end if;
  if pricing.v3_access(p_tenant) ->> 'access' = 'read_only' then
    return jsonb_build_object('allowed', false, 'reason', 'read_only', 'balance_paise', v_bal);
  end if;
  -- what the next use would cost, and whether it is covered for nothing
  if p_feature = 'calls' then
    v_price := t.minute_paise;
    v_free := (select greatest(t.included_minutes * 2 - coalesce(sum(u.included_half), 0), 0) > 0 from pricing.usage u
                where u.tenant_id = p_tenant and u.kind = 'call' and u.at >= (select w.w_start from pricing.v3_window(p_tenant) w));
  elsif p_feature = 'lead_finder' then
    v_price := t.search_paise;
    select count(*) into v_n from pricing.usage u where u.tenant_id = p_tenant and u.kind = 'search' and u.at >= (select w.w_start from pricing.v3_window(p_tenant) w);
    v_free := v_n < t.free_searches_month;
  elsif p_feature = 'numbers' then
    v_price := st.extra_number_paise;
    v_free := (select count(*) from pricing.number_rentals r where r.tenant_id = p_tenant and r.status = 'active') < (select (pricing.plan_of(p_tenant)).numbers_included);
  else
    v_price := 1;   -- WhatsApp is charged at Meta's own cost after the message: it needs some balance
    v_free := false;
  end if;
  if v_free then
    return jsonb_build_object('allowed', true, 'reason', null, 'balance_paise', v_bal);
  end if;
  if v_lim is not null and (v_spent >= v_lim or (p_feature in ('lead_finder', 'numbers') and v_spent + v_price > v_lim)) then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached', 'balance_paise', v_bal);
  end if;
  if v_bal < v_price then
    return jsonb_build_object('allowed', false, 'reason', 'wallet_empty', 'balance_paise', v_bal);
  end if;
  return jsonb_build_object('allowed', true, 'reason', null, 'balance_paise', v_bal);
end $$;
revoke all on function pricing.v3_access(uuid), pricing.v3_gate(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the upgrade hint
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pricing.v3_hint(p_tenant uuid) returns jsonb language plpgsql stable set search_path = '' as
$$
declare
  st     pricing.settings_v3;
  cur    pricing.plan_terms := pricing.v3_terms(p_tenant);
  best   record;
  v_half bigint;
  v_srch bigint;
  v_cur  bigint;
  v_from timestamptz;
begin
  select * into st from pricing.settings_v3;
  v_from := now() - make_interval(days => st.hint_days);
  select coalesce(sum(u.half_minutes), 0), count(*) filter (where u.kind = 'search') into v_half, v_srch from pricing.usage u where u.tenant_id = p_tenant and u.kind in ('call', 'search') and u.at >= v_from;
  v_cur := pricing.v3_cost(cur, (select p.monthly_paise from pricing.plans p where p.id = cur.plan_id), v_half, v_srch);
  select t.api_id, t.plan_id, pricing.v3_cost(t, p.monthly_paise, v_half, v_srch) as cost into best
    from pricing.plan_terms t join pricing.plans p on p.id = t.plan_id order by pricing.v3_cost(t, p.monthly_paise, v_half, v_srch), t.sort limit 1;
  if pricing.v3_exempt(p_tenant) or best.plan_id = cur.plan_id or v_cur - best.cost < st.hint_min_saving then
    return jsonb_build_object('has_hint', false, 'current_plan', cur.api_id, 'suggested_plan', null, 'current_cost_paise', v_cur, 'suggested_cost_paise', null, 'saving_paise', 0,
                              'billed_half_minutes', v_half, 'searches', v_srch, 'days', st.hint_days);
  end if;
  return jsonb_build_object('has_hint', true, 'current_plan', cur.api_id, 'suggested_plan', best.api_id, 'current_cost_paise', v_cur, 'suggested_cost_paise', best.cost, 'saving_paise', v_cur - best.cost,
                            'billed_half_minutes', v_half, 'searches', v_srch, 'days', st.hint_days);
end $$;
revoke all on function pricing.v3_hint(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- warnings at 80 % and 100 %: the wallet, and every feature that has a limit
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pricing.v3_warnings(p_tenant uuid) returns jsonb language plpgsql stable set search_path = '' as
$$
declare
  st      pricing.settings_v3;
  v_base  bigint;
  v_bal   bigint := pricing.balance_of(p_tenant);
  v_lot   timestamptz;
  v_start timestamptz := (select w.w_start from pricing.v3_window(p_tenant) w);
  v_out   jsonb := '[]'::jsonb;
  v_level integer;
  r       record;
  v_spent bigint;
begin
  select * into st from pricing.settings_v3;
  select coalesce(sum(l.amount_paise), 0), max(l.created_at) into v_base, v_lot from pricing.wallet_lots l where l.tenant_id = p_tenant and l.expires_at > now();
  if v_base > 0 then
    v_level := case when v_bal <= 0 then 100 when (v_base - v_bal) * 100 >= v_base * st.warn_pct then st.warn_pct end;
    if v_level is not null then
      v_out := v_out || jsonb_build_object('scope', 'wallet', 'level', v_level, 'used_paise', v_base - v_bal, 'of_paise', v_base, 'period_key', to_char(v_lot at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'));
    end if;
  end if;
  for r in select f.feature, f.limit_paise from pricing.feature_limits f where f.tenant_id = p_tenant order by f.feature loop
    v_spent := pricing.v3_spent(p_tenant, pricing.v3_feature_kind(r.feature));
    v_level := case when v_spent >= r.limit_paise then 100 when v_spent * 100 >= r.limit_paise * st.warn_pct then st.warn_pct end;
    if v_level is not null then
      v_out := v_out || jsonb_build_object('scope', r.feature, 'level', v_level, 'used_paise', v_spent, 'of_paise', r.limit_paise, 'period_key', to_char(v_start at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'));
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function pricing.v3_warnings(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- a usage line per feature
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pricing.v3_lines(p_tenant uuid) returns jsonb language plpgsql stable set search_path = '' as
$$
declare
  t        pricing.plan_terms := pricing.v3_terms(p_tenant);
  p        pricing.plans := pricing.plan_of(p_tenant);
  st       pricing.settings_v3;
  v_start  timestamptz := (select w.w_start from pricing.v3_window(p_tenant) w);
  c_half   bigint; c_incl bigint; c_paid bigint; c_short bigint;
  s_n      integer; s_paid bigint;
  w_n      integer; w_paid bigint;
  n_paid   bigint;
  v_active integer; v_extra integer;
begin
  select * into st from pricing.settings_v3;
  select coalesce(sum(half_minutes), 0), coalesce(sum(included_half), 0), coalesce(sum(charged_paise), 0), coalesce(sum(shortfall_paise), 0) into c_half, c_incl, c_paid, c_short
    from pricing.usage where tenant_id = p_tenant and kind = 'call' and at >= v_start;
  select count(*), coalesce(sum(charged_paise), 0) into s_n, s_paid from pricing.usage where tenant_id = p_tenant and kind = 'search' and at >= v_start;
  select count(*), coalesce(sum(charged_paise), 0) into w_n, w_paid from pricing.usage where tenant_id = p_tenant and kind = 'whatsapp' and at >= v_start;
  select coalesce(sum(charged_paise), 0) into n_paid from pricing.usage where tenant_id = p_tenant and kind = 'number' and at >= v_start;
  select count(*) filter (where r.status = 'active'), count(*) filter (where r.status = 'active' and r.extra) into v_active, v_extra from pricing.number_rentals r where r.tenant_id = p_tenant;
  return jsonb_build_object(
    'calls', jsonb_build_object('billed_half_minutes', c_half, 'included_minutes', t.included_minutes, 'included_half_used', c_incl, 'included_half_left', greatest(t.included_minutes::bigint * 2 - c_incl, 0),
                                'rate_paise_per_minute', t.minute_paise, 'charged_paise', c_paid, 'unpaid_paise', c_short, 'limit_paise', pricing.v3_limit_of(p_tenant, 'calls')),
    'lead_finder', jsonb_build_object('searches', s_n, 'free_searches', t.free_searches_month, 'free_left', greatest(t.free_searches_month - s_n, 0), 'search_paise', t.search_paise,
                                      'charged_paise', s_paid, 'limit_paise', pricing.v3_limit_of(p_tenant, 'lead_finder')),
    'numbers', jsonb_build_object('active', v_active, 'included', p.numbers_included, 'extra', v_extra, 'extra_number_paise', st.extra_number_paise, 'charged_paise', n_paid,
                                  'held', coalesce((select jsonb_agg(jsonb_build_object('number', r.number, 'hold_until', r.hold_until) order by r.hold_until) from pricing.number_rentals r where r.tenant_id = p_tenant and r.status = 'held'), '[]'::jsonb),
                                  'limit_paise', pricing.v3_limit_of(p_tenant, 'numbers')),
    'whatsapp', jsonb_build_object('messages', w_n, 'charged_paise', w_paid, 'limit_paise', pricing.v3_limit_of(p_tenant, 'whatsapp')),
    'ai_actions', jsonb_build_object('charged_paise', 0));
end $$;
revoke all on function pricing.v3_lines(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the reads of the API
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.pricing_v3_catalogue() returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  st pricing.settings_v3;
begin
  if auth.uid() is null then
    perform pricing.deny();
  end if;
  select * into st from pricing.settings_v3;
  return jsonb_build_object(
    'gst_percent', (select round(s.gst_bps / 100.0, 2) from pricing.settings s),
    'free_start_paise', (select s.free_start_paise from pricing.settings s),
    'lot_days', (select s.lot_days from pricing.settings s),
    'launch_lock_months', (select s.launch_lock_months from pricing.settings s),
    'extra_number_paise', st.extra_number_paise,
    'number_hold_days', st.number_hold_days,
    'warn_pct', st.warn_pct,
    'data_days', st.data_days,
    'payg_to_pro_minutes', (select ceil((pro.monthly_paise - payg.monthly_paise)::numeric / pt.minute_paise)::integer
                              from pricing.plans pro, pricing.plans payg, pricing.plan_terms pt where pro.id = 'sales_assistant' and payg.id = 'payg' and pt.plan_id = 'payg'),
    'plans', (select jsonb_agg(jsonb_build_object('id', t.api_id, 'name', t.name, 'popular', t.popular, 'monthly_paise', p.monthly_paise, 'yearly_paise', p.yearly_paise, 'included_minutes', t.included_minutes,
                  'minute_paise', t.minute_paise, 'numbers_included', p.numbers_included, 'free_searches_month', t.free_searches_month, 'search_paise', t.search_paise, 'onboarding', t.onboarding) order by t.sort)
                from pricing.plan_terms t join pricing.plans p on p.id = t.plan_id));
end $$;
revoke all on function public.pricing_v3_catalogue() from public, anon;
grant execute on function public.pricing_v3_catalogue() to authenticated;

create function public.pricing_v3_wallet(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  t       pricing.plan_terms;
  p       pricing.plans;
  s       pricing.subscriptions;
  a       pricing.auto_topups;
  v_bal   bigint;
  w       record;
  v_free  bigint;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform pricing.deny();
  end if;
  t := pricing.v3_terms(p_tenant_id);
  p := pricing.plan_of(p_tenant_id);
  select * into s from pricing.subscriptions x where x.tenant_id = p_tenant_id;
  select * into a from pricing.auto_topups x where x.tenant_id = p_tenant_id;
  select * into w from pricing.v3_window(p_tenant_id);
  v_bal := pricing.balance_of(p_tenant_id);
  v_free := coalesce((select sum(l.remaining_paise) from pricing.wallet_lots l where l.tenant_id = p_tenant_id and l.source = 'free_start' and l.expires_at > now()), 0);
  return jsonb_build_object(
    'balance_paise', v_bal,
    'plan_id', t.api_id, 'plan_name', t.name, 'monthly_paise', p.monthly_paise, 'yearly_paise', p.yearly_paise,
    'early_access', pricing.v3_exempt(p_tenant_id),
    'window_start', w.w_start, 'window_end', w.w_end,
    'free_start_granted', exists (select 1 from pricing.free_starts f where f.tenant_id = p_tenant_id), 'free_start_left_paise', v_free,
    'subscription', case when s.tenant_id is null then null else jsonb_build_object('interval', s.interval, 'status', s.status, 'period_end', s.period_end, 'cancel_at_period_end', s.cancel_at_period_end,
                                                                                    'price_locked_until', s.price_locked_until) end,
    'lines', pricing.v3_lines(p_tenant_id),
    'warnings', (select coalesce(jsonb_agg(x - 'period_key'), '[]'::jsonb) from jsonb_array_elements(pricing.v3_warnings(p_tenant_id)) x),
    'queued_calls', (select count(*) from pricing.queued_calls q where q.tenant_id = p_tenant_id and q.status = 'queued'),
    'auto_topup', case when a.tenant_id is null then null else jsonb_build_object('enabled', a.enabled, 'amount_paise', a.amount_paise, 'below_paise', a.below_paise, 'monthly_limit_paise', a.monthly_limit_paise,
                   'used_this_month_paise', coalesce((select sum(r.amount_paise) from pricing.auto_topup_runs r where r.tenant_id = p_tenant_id
                                                       and r.at >= (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')), 0)) end,
    'access', pricing.v3_access(p_tenant_id),
    'hint', pricing.v3_hint(p_tenant_id));
end $$;
revoke all on function public.pricing_v3_wallet(uuid) from public, anon;
grant execute on function public.pricing_v3_wallet(uuid) to authenticated;

-- what was charged, newest first (Owner, Admin)
create function public.pricing_v3_ledger(p_tenant_id uuid, p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform pricing.deny();
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('feature', case u.kind when 'call' then 'calls' when 'search' then 'lead_finder' when 'number' then 'numbers' else 'whatsapp' end,
                      'at', u.at, 'billed_half_minutes', u.half_minutes, 'included_half', u.included_half, 'charged_paise', u.charged_paise, 'unpaid_paise', u.shortfall_paise) order by u.at desc, u.ref)
                     from (select * from pricing.usage x where x.tenant_id = p_tenant_id order by x.at desc, x.ref limit p_limit) u), '[]'::jsonb);
end $$;
revoke all on function public.pricing_v3_ledger(uuid, integer) from public, anon;
grant execute on function public.pricing_v3_ledger(uuid, integer) to authenticated;

-- the access state alone (any member): the API's read-only gate asks it for every change or spend
create function public.pricing_v3_access(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform pricing.deny();
  end if;
  return pricing.v3_access(p_tenant_id);
end $$;
revoke all on function public.pricing_v3_access(uuid) from public, anon;
grant execute on function public.pricing_v3_access(uuid) to authenticated;
