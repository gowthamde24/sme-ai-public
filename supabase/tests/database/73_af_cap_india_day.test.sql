-- Job AF: the AI daily cost cap is enforced per ASIA/KOLKATA day (migration 20261101090000), at the midnight boundary, for reserve and settle.
-- A call a minute after Indian midnight is in the new day; a minute before is not. Same helpers and the same fake model price as pgTAP 49
-- (one token costs one micro).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
-- tenant B may run agents too (isolation tests)
update public.agent_definitions set allowed_tenants = array[tests.tid('a'), tests.tid('b')] where agent_name = 'selftest';
insert into public.tenant_agent_settings (tenant_id, enabled) values (tests.tid('b'), true);
-- room for as many runs as the tests start
update public.agent_limits set limit_value = 100 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');

create function pg_temp.sc(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(p_uid, p_sql);
exception when others then
  return jsonb_build_object('error', sqlstate)::text;  -- a crash is an ASSERTION failure (the keys read below are missing), not an aborted file
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(case when p_user is null then null else tests.uid(p_user) end, p_sql) $$;
create function pg_temp.rsv(p_run uuid, p_key text, p_in bigint, p_out bigint, p_model text default 'fake-selftest') returns text language sql as $$
  select format('select public.agent_reserve_cost(%L, %L, %L, %s, %s)', p_run, p_key, p_model, p_in, p_out) $$;
create function pg_temp.use(p_run uuid, p_key text, p_in bigint, p_out bigint, p_cost bigint) returns text language sql as $$
  select format('select public.agent_record_usage(%L, %L, %s, %s, %s)', p_run, p_key, p_in, p_out, p_cost) $$;
create function pg_temp.start_sql(p_run uuid, p_tenant uuid, p_target uuid) returns text language sql as $$
  select format('select public.start_agent_run(%L, %L, ''selftest'', ''v1'', ''company'', %L, %L, ''{}''::jsonb)', p_run, p_tenant, p_target, repeat('a', 64)) $$;
create function pg_temp.spent(p_tenant text) returns numeric language sql as $$ select app.agent_day_spend(tests.tid(p_tenant), app.agent_utc_today()) $$;
create function pg_temp.set_cap(p_tenant text, p_cap bigint) returns void language sql as $$
  insert into public.tenant_agent_settings (tenant_id, daily_cost_cap_micros) values (tests.tid(p_tenant), p_cap)
  on conflict (tenant_id) do update set daily_cost_cap_micros = excluded.daily_cost_cap_micros $$;

-- ============================================================================ the day of the cap is the Asia/Kolkata day
-- the clock helper is replaced for the rest of this transaction (rolled back at the end), exactly as pgTAP 49 does; but through the REAL day function
-- app.agent_cost_day(instant), so the boundary being tested is the production rule
create function pg_temp.at(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select app.agent_cost_day(timestamptz %L) $b$', p_instant::text);
end $fn$;
create function pg_temp.res_day(p_run uuid, p_key text) returns text language sql as $$ select cost_day::text from public.agent_cost_reservations where run_id = p_run and step_key = p_key $$;

-- ---- the pure rule, at fixed instants
select is(app.agent_cost_day(timestamptz '2031-03-01 23:59:00+05:30'), date '2031-03-01', 'a minute before Indian midnight is the old day');
select is(app.agent_cost_day(timestamptz '2031-03-02 00:01:00+05:30'), date '2031-03-02', 'a minute after Indian midnight is the new day');
select is(app.agent_cost_day(timestamptz '2031-03-01 18:29:59+00'), date '2031-03-01', 'the last second of the Indian day (18:29:59 UTC)');
select is(app.agent_cost_day(timestamptz '2031-03-01 18:30:00+00'), date '2031-03-02', 'Indian midnight itself (18:30:00 UTC) starts the new day');
select is(app.agent_cost_day(timestamptz '2031-03-01 00:00:00+00'), date '2031-03-01', 'UTC midnight is 05:30 in India: the same Indian day as the hours before it');
select is(app.agent_cost_day(timestamptz '2031-03-01 23:59:00+00'), date '2031-03-02', 'the UTC evening already belongs to the next Indian day (05:29 there)');

-- ---- RESERVE: a minute before Indian midnight, then a minute after
select pg_temp.set_cap('a', 1000);
select pg_temp.at(timestamptz '2031-03-01 23:59:00+05:30');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'usage-1', 600, 300)), 'cost_day'), '2031-03-01', 'reserved a minute BEFORE Indian midnight: charged to that day');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-1', 60, 40)), 'granted'), 'true', '...and the day can be filled exactly (900 + 100 = 1000)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-2', 1, 0)), 'granted'), 'false', '...one more micro that minute is refused (the cap of the old day)');
select pg_temp.at(timestamptz '2031-03-02 00:01:00+05:30');
select is(pg_temp.spent('a'), 0::numeric, 'two minutes later, a minute AFTER Indian midnight, the new day starts empty');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-2', 1000, 0)), 'cost_day'), '2031-03-02', 'reserved a minute AFTER Indian midnight: charged to the new day');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-3', 1, 0)), 'granted'), 'false', '...and the new day is full on its own');
select is(app.agent_day_spend(tests.tid('a'), date '2031-03-01'), 1000::numeric, 'the old day still holds its 1000');
select is(app.agent_day_spend(tests.tid('a'), date '2031-03-02'), 1000::numeric, 'the new day holds its own 1000: they are counted separately');

-- ---- SETTLE: a call authorised a minute before midnight and settled after it STAYS on the old day
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.use(tests.rid('a_run_sales'), 'usage-1', 500, 200, 0)), 'replayed'), 'false', 'settled a minute after Indian midnight');
select is(pg_temp.res_day(tests.rid('a_run_sales'), 'usage-1'), '2031-03-01', '...the cost stays on the day it was authorised');
select is(app.agent_day_spend(tests.tid('a'), date '2031-03-01'), 800::numeric, '...the old day now holds the real cost 700 + 100 (the unused 200 released there)');
select is(app.agent_day_spend(tests.tid('a'), date '2031-03-02'), 1000::numeric, '...and the new day is untouched');
-- reserved AND settled inside the new day: it is on the new day, at its real cost (a usage record nobody reserved is refused outright: pgTAP 49, section I)
select pg_temp.at(timestamptz '2031-03-03 00:01:00+05:30');
select pg_temp.set_cap('a', 100000);
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'late-1', 50, 0)), 'cost_day'), '2031-03-03', 'a call reserved a minute after Indian midnight');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.use(tests.rid('a_run_sales'), 'late-1', 30, 0, 0)), 'replayed'), 'false', '...and settled at once');
select is(pg_temp.res_day(tests.rid('a_run_sales'), 'late-1'), '2031-03-03', '...is on the new day');
select is(app.agent_day_spend(tests.tid('a'), date '2031-03-03'), 30::numeric, '...at its real cost (30; the unused 20 released)');
select is(app.agent_day_spend(tests.tid('a'), date '2031-03-02'), 1000::numeric, '...and the day before is not touched');
-- the UTC evening (00:30 in India) is already the new Indian day: this is what moved
select pg_temp.at(timestamptz '2031-03-04 19:00:00+00');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'usage-4', 5, 0)), 'cost_day'), '2031-03-05', 'a call at 19:00 UTC (00:30 the next day in India) is charged to the next Indian day, not the UTC day');

-- ---- the data already recorded is re-dated by the same rule (the statement of the migration, run on a row that carries the old UTC date)
insert into public.agent_cost_reservations (tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, args_sha256, created_at)
values (tests.tid('a'), tests.rid('a_run_admin'), 'old-utc', date '2031-03-01', 10, 0, 10, repeat('d', 64), timestamptz '2031-03-01 20:00:00+00');
update public.agent_cost_reservations set cost_day = app.agent_cost_day(created_at) where cost_day is distinct from app.agent_cost_day(created_at);
select is(pg_temp.res_day(tests.rid('a_run_admin'), 'old-utc'), '2031-03-02', 'a reservation made at 20:00 UTC (01:30 India) with the old UTC date is re-dated to the Indian day');
select is((select count(*) from public.agent_cost_reservations where cost_day is distinct from app.agent_cost_day(created_at)), 0::bigint, '...and no reservation is left on a day that disagrees with its own instant');

-- ---- the card and the limit agree (real clock): what the Owner's usage card adds up is exactly what the cap counts
create function pg_temp.real_clock() returns void language plpgsql as $fn$
begin
  execute 'create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select app.agent_cost_day(now()) $b$';
end $fn$;
select pg_temp.real_clock();
select pg_temp.set_cap('b', 5000);
select is(pg_temp.j(pg_temp.sc(tests.uid('b_sales'), pg_temp.rsv(tests.rid('b_run'), 'card-1', 700, 100)), 'granted'), 'true', 'tenant B reserves 800 now');
select pg_temp.sc(tests.uid('b_sales'), pg_temp.use(tests.rid('b_run'), 'card-1', 600, 100, 0));
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.ai_usage_today(%L) ->> 'spent_micros')$$, tests.tid('b'))), app.agent_day_spend(tests.tid('b'), app.agent_utc_today())::bigint::text,
  'the usage card''s spend (Asia/Kolkata day by instant) equals the spend the cap counts (cost day)');
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.ai_usage_today(%L) ->> 'day')$$, tests.tid('b'))), app.agent_utc_today()::text, '...for the same day');
select is(pg_temp.j(pg_temp.sc(tests.uid('b_owner'), format('select public.agent_cost_summary(%L)', tests.tid('b'))), 'day'), app.agent_utc_today()::text, 'and the Owner''s cost summary is for that day too');

-- ---- the new helper is internal, like its siblings
select is((select prosecdef and 'search_path=""' = any (proconfig) and provolatile = 'i' from pg_proc where oid = 'app.agent_cost_day(timestamptz)'::regprocedure), true, 'agent_cost_day is SECURITY DEFINER, immutable, search_path pinned');
select is(has_function_privilege('authenticated', 'app.agent_cost_day(timestamptz)', 'execute') or has_function_privilege('anon', 'app.agent_cost_day(timestamptz)', 'execute')
          or has_function_privilege('service_role', 'app.agent_cost_day(timestamptz)', 'execute') or has_function_privilege('public', 'app.agent_cost_day(timestamptz)', 'execute'), false, 'no client role can execute it');
select is(pg_temp.err('a_owner', 'select app.agent_cost_day(now())'), '42501|permission denied for function agent_cost_day||||', 'a signed-in Owner cannot call it');

select * from finish();
rollback;
