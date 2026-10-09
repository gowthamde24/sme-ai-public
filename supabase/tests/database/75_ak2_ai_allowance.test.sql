-- Job AK / K2: the AI allowance per plan (migration 20261103090000): a daily and a monthly window, shown as percentages, enforced by the database at both resets.
-- The clock is frozen the way pgTAP 73 does it (app.agent_utc_today is replaced through the REAL day rule app.agent_cost_day). One token costs one micro (fake-selftest).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_limits set limit_value = 1000 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');
-- the two tests' plan: ₹10 a day, ₹30 a month (1,000 and 3,000 paise = 10,000,000 and 30,000,000 micros), on the free trial
update public.plan_ai_allowances set daily_paise = 1000, monthly_paise = 3000 where plan = 'free_trial';

create function pg_temp.sc(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(p_uid, p_sql);
exception when others then
  return jsonb_build_object('error', sqlstate)::text;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(case when p_user is null then null else tests.uid(p_user) end, p_sql) $$;
create function pg_temp.at(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select app.agent_cost_day(timestamptz %L) $b$', p_instant::text);
end $fn$;
create function pg_temp.usage(p_user text default 'a_owner') returns text language sql as $$ select pg_temp.sc(tests.uid(p_user), format('select public.ai_usage(%L)', tests.tid('a'))) $$;
-- a settled call of p_micros on cost day p_day (written straight into the ledger as the trusted role: this file tests the windows, not the runtime)
create function pg_temp.spend(p_key text, p_day date, p_micros bigint) returns void language sql as $$
  insert into public.agent_cost_reservations (id, tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, settled_micros, args_sha256, settled_at, outcome)
  values (gen_random_uuid(), tests.tid('a'), tests.rid('a_run_sales'), p_key, p_day, 1, 1, p_micros, p_micros, repeat('c', 64), now(), 'used') $$;
create function pg_temp.start_sql(p_run uuid) returns text language sql as $$
  select format('select public.start_agent_run(%L, %L, ''selftest'', ''v1'', ''company'', %L, %L, ''{}''::jsonb)', p_run, tests.tid('a'), tests.rid('a_company'), repeat('a', 64)) $$;
create function pg_temp.rsv(p_key text, p_in bigint) returns text language sql as $$
  select format('select public.agent_reserve_cost(%L, %L, ''fake-selftest'', %s, 0)', tests.rid('a_run_sales'), p_key, p_in) $$;

-- ============================================================================ the config and who may touch it
select is((select count(*) from public.plan_ai_allowances where plan in ('free_trial','starter','growth','business')), 4::bigint, 'four plans have an allowance row');
select is(tests.sqlstate_as(tests.uid('a_owner'), 'select * from public.plan_ai_allowances'), '42501', 'DENY: no client reads the allowance table');
select is(tests.sqlstate_as(tests.uid('a_owner'), $$update public.plan_ai_allowances set daily_paise = 1$$), '42501', 'DENY: no client writes it');
select throws_ok($$update public.plan_ai_allowances set daily_paise = 0 where plan = 'starter'$$, '23514', null, 'a zero allowance is refused');
select throws_ok($$update public.plan_ai_allowances set monthly_paise = 1 where plan = 'starter'$$, '23514', null, 'a month smaller than a day is refused');
select lives_ok(format($$update public.tenants set plan = 'business' where id = %L$$, tests.tid('b')), 'the plan list now has starter, growth and business');
select throws_ok(format($$update public.tenants set plan = 'enterprise' where id = %L$$, tests.tid('b')), '23514', null, 'a plan outside the list is still refused');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$update public.tenants set billing_anchor_at = now() where id = %L$$, tests.tid('a'))), '42501', 'DENY: even the Owner cannot move the billing date');

-- ============================================================================ the month window: whole months from the trial start or the billing date
update public.tenants set trial_started_at = timestamptz '2031-01-15 10:00:00+05:30' where id = tests.tid('a');
select pg_temp.at(timestamptz '2031-02-14 23:59:00+05:30');
select is((select win_start || '..' || win_end from app.ai_month_window(tests.tid('a'))), '2031-01-15..2031-02-15', 'a minute before the month turns: the window is 15 Jan to 15 Feb');
select pg_temp.at(timestamptz '2031-02-15 00:01:00+05:30');
select is((select win_start || '..' || win_end from app.ai_month_window(tests.tid('a'))), '2031-02-15..2031-03-15', 'a minute after: the next window');
select pg_temp.at(timestamptz '2031-01-20 12:00:00+05:30');
select is((select win_start || '..' || win_end from app.ai_month_window(tests.tid('a'))), '2031-01-15..2031-02-15', 'inside the first month');
update public.tenants set trial_started_at = timestamptz '2031-01-31 10:00:00+05:30' where id = tests.tid('a');
select pg_temp.at(timestamptz '2031-02-28 00:01:00+05:30');
select is((select win_start || '..' || win_end from app.ai_month_window(tests.tid('a'))), '2031-02-28..2031-03-31', 'a 31st anchor clamps to the last day of a short month, and comes back to the 31st');
update public.tenants set billing_anchor_at = timestamptz '2031-02-10 09:00:00+05:30' where id = tests.tid('a');
select pg_temp.at(timestamptz '2031-03-05 12:00:00+05:30');
select is((select win_start || '..' || win_end from app.ai_month_window(tests.tid('a'))), '2031-02-10..2031-03-10', 'the billing date wins over the trial start once it is set');
update public.tenants set billing_anchor_at = null, trial_started_at = timestamptz '2031-01-15 10:00:00+05:30' where id = tests.tid('a');

-- ============================================================================ percentages: spent / allowance, rounded DOWN, at most 100
select pg_temp.at(timestamptz '2031-01-20 12:00:00+05:30');
select is(pg_temp.j(pg_temp.usage(), 'today_percent') || '/' || pg_temp.j(pg_temp.usage(), 'month_percent') || '/' || pg_temp.j(pg_temp.usage(), 'state'), '0/0/ok', 'nothing spent: 0 %, 0 %, ok');
select pg_temp.spend('p1', date '2031-01-20', 999999);
select is(pg_temp.j(pg_temp.usage(), 'today_percent'), '9', '9.99999 % is shown as 9 (rounded down, never up)');
select is(pg_temp.j(pg_temp.usage(), 'month_percent'), '3', '...and the month: 3.33 % is 3');
select pg_temp.spend('p2', date '2031-01-20', 6999999);  -- today 7,999,998 of 10,000,000 = 79.99998 %
select is(pg_temp.j(pg_temp.usage(), 'today_percent') || ':' || pg_temp.j(pg_temp.usage(), 'state'), '79:ok', '79.99 % is 79 and still ok');
select pg_temp.spend('p3', date '2031-01-20', 2);  -- exactly 8,000,000
select is(pg_temp.j(pg_temp.usage(), 'today_percent') || ':' || pg_temp.j(pg_temp.usage(), 'state'), '80:warn', 'exactly 80 % is a warning');
select pg_temp.spend('p4', date '2031-01-20', 5000000);  -- 13,000,000 of 10,000,000
select is(pg_temp.j(pg_temp.usage(), 'today_percent') || ':' || pg_temp.j(pg_temp.usage(), 'state'), '100:paused', 'over the allowance is capped at 100 and the state is paused');
select is(pg_temp.j(pg_temp.usage(), 'month_percent'), '43', 'the month alone: 13,000,000 of 30,000,000 = 43 %');

-- ============================================================================ no paise, no tokens leave the read; who may read it
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.usage()::jsonb) k), 'month_percent,resets_at_month,resets_at_today,state,today_percent', 'exactly the five fields: no paise, no micros, no tokens');
select is(pg_temp.j(pg_temp.usage('a_admin'), 'state'), 'paused', 'an Admin reads it');
select is(pg_temp.j(pg_temp.usage('a_sales'), 'error'), '42501', 'Sales cannot');
select is(pg_temp.j(pg_temp.usage('a_viewer'), 'error'), '42501', 'a Viewer cannot');
select is(pg_temp.j(pg_temp.usage('outsider'), 'error'), '42501', 'an outsider cannot');
select is(pg_temp.j(pg_temp.usage('b_owner'), 'error'), '42501', 'the Owner of ANOTHER workspace cannot');
select is(tests.sqlstate_as(null, format('select public.ai_usage(%L)', tests.tid('a'))), '42501', 'anon cannot');

-- ============================================================================ the DAILY reset at Indian midnight
select pg_temp.at(timestamptz '2031-01-20 23:59:00+05:30');
select is(pg_temp.j(pg_temp.usage(), 'today_percent') || ':' || pg_temp.j(pg_temp.usage(), 'state'), '100:paused', 'a minute before Indian midnight: the day is used up, paused');
select is(pg_temp.j(pg_temp.usage(), 'resets_at_today'), '2031-01-20T18:30:00+00:00', '...and it resets at Indian midnight (18:30 UTC)');
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('k2s1'))), 'SM207|agent daily cost cap reached||||', 'a new run is refused while the day is used up');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv('k2-1', 1)), 'granted'), 'false', 'a model call is refused too');
select is(tests.scalar_as(tests.uid('a_sales'), format('select public.ai_paused_until(%L)', tests.tid('a')))::timestamptz, timestamptz '2031-01-20 18:30:00+00', 'ANY member can ask when AI is back: the next Indian midnight');
select pg_temp.at(timestamptz '2031-01-21 00:01:00+05:30');
select is(pg_temp.j(pg_temp.usage(), 'today_percent') || ':' || pg_temp.j(pg_temp.usage(), 'state'), '0:ok', 'a minute after Indian midnight: yesterday does not count, the day is empty, ok');
select is(pg_temp.j(pg_temp.usage(), 'month_percent'), '43', '...but the month still remembers it');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('k2s1'))), 'rows:1', 'and a run can start again');
select is(tests.scalar_as(tests.uid('a_sales'), format('select public.ai_paused_until(%L)', tests.tid('a'))), null, 'nothing is paused: no time to wait for');

-- ============================================================================ the MONTHLY reset at the month boundary (the trial started 15 Jan)
select pg_temp.spend('m1', date '2031-02-10', 17000000);   -- the month now holds 13,000,000 + 17,000,000 = 30,000,000
select pg_temp.at(timestamptz '2031-02-14 23:59:00+05:30');
select is(pg_temp.j(pg_temp.usage(), 'month_percent') || ':' || pg_temp.j(pg_temp.usage(), 'state'), '100:paused', 'the last minute of the month: the month is used up, paused (although today is empty)');
select is(pg_temp.j(pg_temp.usage(), 'today_percent'), '0', '...with the day itself at 0 %');
select is(pg_temp.j(pg_temp.usage(), 'resets_at_month'), '2031-02-14T18:30:00+00:00', '...and the month resets at midnight of the 15th, Indian time');
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('k2s2'))), 'SM207|agent daily cost cap reached||||', 'a new run is refused (the month squeezes today to zero room)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv('k2-2', 1)), 'granted'), 'false', 'a model call is refused');
select is(tests.scalar_as(tests.uid('a_sales'), format('select public.ai_paused_until(%L)', tests.tid('a')))::timestamptz, timestamptz '2031-02-14 18:30:00+00', 'AI is back at the month boundary');
-- everything that is not AI keeps working while the AI is paused
select lives_ok(format($$update public.companies set name = 'Renamed while paused' where id = %L$$, tests.rid('a_company')), 'customers keep working while AI is paused');
select pg_temp.at(timestamptz '2031-02-15 00:01:00+05:30');
select is(pg_temp.j(pg_temp.usage(), 'month_percent') || ':' || pg_temp.j(pg_temp.usage(), 'state'), '0:ok', 'a minute after the month turns: the new month is empty, ok');
select is(pg_temp.j(pg_temp.usage(), 'resets_at_month'), '2031-03-14T18:30:00+00:00', '...and the next reset is 15 March');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('k2s2'))), 'rows:1', 'a run can start again');

-- ============================================================================ the month squeezes the day: room is the smaller of the two
select pg_temp.spend('q1', date '2031-02-16', 29999000);   -- 29,999,000 of the month's 30,000,000, spent on another day: 1,000 micros of room are left
select pg_temp.at(timestamptz '2031-02-20 12:00:00+05:30');
select is(pg_temp.j(pg_temp.usage(), 'month_percent') || ':' || pg_temp.j(pg_temp.usage(), 'today_percent'), '99:0', 'the month is at 99 %, today at 0 %');
select is(app.agent_daily_cap(tests.tid('a')), 1000::bigint, 'today may spend only what the month has left (1,000 micros), not the full daily 10,000,000');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv('k2-3', 1001)), 'granted'), 'false', 'a call that would carry the month past its allowance is refused');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv('k2-4', 1000)), 'granted'), 'true', 'one that fits exactly is granted');
select is(app.agent_daily_cap(tests.tid('a')), 1000::bigint, 'and the cap does not drift as the open reservation counts (today spend + month room stay constant)');

-- ============================================================================ a workspace's own cap still wins over its plan; another workspace is unaffected
select is(app.agent_base_daily_cap(tests.tid('b')), 50000000::bigint, 'workspace B is on the business plan: 5,000 paise = 50,000,000 micros a day');
insert into public.tenant_agent_settings (tenant_id, daily_cost_cap_micros) values (tests.tid('b'), 1234567) on conflict (tenant_id) do update set daily_cost_cap_micros = 1234567;
select is(app.agent_base_daily_cap(tests.tid('b')), 1234567::bigint, 'an operator override on the workspace wins over the plan');
select is(app.agent_month_spend(tests.tid('b')), 0::numeric, 'B has spent nothing: A''s ledger does not count for B');

select * from finish();
rollback;
