-- T007 M2 / 3: the per-tenant DAILY COST CAP (ADR 0013, "Daily cost cap").
--   A structure and privileges    B reserve: boundary (> not >=), replay, conflict, audit of a cap hit
--   C settle: real cost, rounding UP, overshoot on record, settled keys    D prices: unknown model, zero price, bad arguments
--   E start_agent_run: the early refusal, fail closed (zero / missing cap)  F UTC day: attribution and rollover (the clock helper is replaced)
--   G tenant isolation            H set_tenant_daily_cost_cap: Owner only, aal2, ceiling, audited    I the legacy (unreserved) usage path
--   J source audit
-- The fake model's price is 1,000,000 per Mtok both ways, so ONE TOKEN COSTS ONE MICRO: a reservation of (600 in, 300 out) is 900.
-- The two-connection race (the advisory lock) is tests/integration/test_daily_cost_cap.py: pgTAP runs in one transaction.
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

-- ============================================================================ A. structure and privileges
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('agent_reserve_cost', 'set_tenant_daily_cost_cap')
             and p.prosecdef and 'search_path=""' = any (p.proconfig) and p.proowner::regrole::text = 'postgres'), 2::bigint,
  'the two new public functions are SECURITY DEFINER, empty search_path, owned by the migration role');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('agent_utc_today', 'agent_cost_micros', 'agent_daily_cap', 'agent_day_spend', 'agent_cost_lock')
             and p.prosecdef and 'search_path=""' = any (p.proconfig)), 5::bigint,
  'the five new helpers are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('agent_utc_today', 'agent_cost_micros', 'agent_daily_cap', 'agent_day_spend', 'agent_cost_lock')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0::bigint,
  'no client role (and not public, not service_role) can execute any helper, the clock included');
select is(pg_temp.err('a_owner', 'select app.agent_utc_today()'), '42501|permission denied for function agent_utc_today||||', 'a signed-in Owner cannot call the clock helper (no EXECUTE)');
select ok(not has_function_privilege('anon', 'public.agent_reserve_cost(uuid, text, text, bigint, bigint)', 'execute')
          and not has_function_privilege('anon', 'public.set_tenant_daily_cost_cap(uuid, bigint)', 'execute'), 'anon cannot execute either public function');
select ok(has_function_privilege('authenticated', 'public.agent_reserve_cost(uuid, text, text, bigint, bigint)', 'execute')
          and has_function_privilege('authenticated', 'public.set_tenant_daily_cost_cap(uuid, bigint)', 'execute'), 'authenticated can (each proves ownership / the Owner role itself)');
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'agent_record_usage'), 1::bigint, 'exactly one agent_record_usage overload exists');
select ok(not has_table_privilege('authenticated', 'public.agent_model_prices', 'select') and not has_table_privilege('anon', 'public.agent_model_prices', 'select'),
  'the price table has no client privilege');
select ok(not has_table_privilege('authenticated', 'public.agent_cost_reservations', 'insert') and not has_table_privilege('authenticated', 'public.agent_cost_reservations', 'update')
          and not has_table_privilege('authenticated', 'public.agent_cost_reservations', 'delete') and not has_table_privilege('anon', 'public.agent_cost_reservations', 'select'),
  'nobody writes the ledger directly (no client privilege to insert, update or delete; anon cannot read)');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.agent_model_prices'::regclass)
          and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.agent_cost_reservations'::regclass), 'RLS is enabled and forced on both new tables');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'agent_cost_reservations' and indexdef like '%(tenant_id, cost_day)%'),
  'the daily sum has an index on (tenant_id, cost_day)');
select throws_ok($$insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('zero-in', 0, 5)$$, '23514', null, 'a zero input price cannot be stored');
select throws_ok($$insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('zero-out', 5, 0)$$, '23514', null, '...nor a zero output price');
select throws_ok($$insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('neg', -1, 5)$$, '23514', null, '...nor a negative one');
select throws_ok($$insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('bad model name!', 1, 1)$$, '23514', null, 'a model id must match the strict pattern');
select throws_ok($$update public.agent_limits set limit_value = 500000001 where limit_key = 'daily_cost_micros'$$, '23514', null, 'the operator default cannot exceed the ceiling of 500.00 (500,000,000)');
select lives_ok($$update public.agent_limits set limit_value = 500000000 where limit_key = 'daily_cost_micros'$$, 'exactly 500.00 is allowed');
select lives_ok($$update public.agent_limits set limit_value = 2000000 where limit_key = 'daily_cost_micros'$$, '(restored to 2.00)');
select throws_ok($$update public.tenant_agent_settings set daily_cost_cap_micros = 500000001 where tenant_id = tests.tid('a')$$, '23514', null, 'a tenant override cannot exceed the ceiling either');
select throws_ok($$update public.tenant_agent_settings set daily_cost_cap_micros = -1 where tenant_id = tests.tid('a')$$, '23514', null, '...nor be negative');
select results_eq($$select model, input_micros_per_mtok, output_micros_per_mtok from public.agent_model_prices order by model$$, $$values ('fake-selftest'::text, 1000000::bigint, 1000000::bigint)$$,
  'the only seeded price is the scripted development model (no real model has a price until the operator adds one)');
select is(app.agent_utc_today(), (now() at time zone 'Asia/Kolkata')::date, 'the clock helper is the Indian date (since job AF; tested at the boundary in 73)');

-- ============================================================================ B. reserve: the boundary, replay, conflict, the audit of a cap hit
select pg_temp.set_cap('a', 1000);
select is(app.agent_daily_cap(tests.tid('a')), 1000::bigint, 'tenant A''s cap is its override (1000)');
select is(app.agent_daily_cap(tests.tid('b')), 60000000::bigint, 'tenant B has no override: three times its plan''s daily allowance (job AK K2b: free trial 20.00 x 3)');
create temp table r1 as select pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'usage-1', 600, 300)) as r;
select is(pg_temp.j((select r from r1), 'granted'), 'true', 'a reservation inside the cap is granted');
select is(pg_temp.j((select r from r1), 'reserved_micros'), '900', '...at the worst case: 600 in + 300 out = 900');
select is(pg_temp.j((select r from r1), 'cost_day'), app.agent_utc_today()::text, '...on today''s UTC day');
select is(pg_temp.spent('a'), 900::numeric, 'the day''s spend counts the reservation');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'usage-1', 600, 300)), 'replayed'), 'true', 'the same reservation again is a replay');
select is((select count(*) from public.agent_cost_reservations where run_id = tests.rid('a_run_sales')), 1::bigint, '...and reserves nothing twice');
select is(pg_temp.spent('a'), 900::numeric, '...spend unchanged');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'usage-1', 601, 300)), 'SM205|agent step key reused with different arguments||||', 'the same key with other arguments is SM205');
-- the boundary: 900 spent, 100 left. Exactly 100 FITS (the check is "> cap", not ">= cap")
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-1', 60, 40)), 'granted'), 'true', 'a reservation that fills the cap EXACTLY (900 + 100 = 1000) is granted');
select is(pg_temp.spent('a'), 1000::numeric, 'the day is now exactly full');
create temp table r_over as select pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-2', 1, 0)) as r;
select is(pg_temp.j((select r from r_over), 'granted'), 'false', 'one more micro does not fit: refused');
select is(pg_temp.j((select r from r_over), 'reason'), 'daily_cap', '...for the daily cap');
select is((select count(*) from public.agent_cost_reservations where run_id = tests.rid('a_run_admin') and step_key = 'usage-2'), 0::bigint, '...and nothing was reserved');
select is(pg_temp.spent('a'), 1000::numeric, '...spend unchanged');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'agent_cost.refused' and entity_id = tests.rid('a_run_admin')
             and actor_user_id = tests.uid('a_admin') and new_values ->> 'reason' = 'daily_cap'), 1::bigint,
  'the cap hit is audited (the refusal is RETURNED, so the audit row is kept), with who and why');
select is((select (new_values ->> 'cap_micros') || '/' || (new_values ->> 'spent_micros') || '/' || (new_values ->> 'requested_micros')
             from public.audit_events where tenant_id = tests.tid('a') and action = 'agent_cost.refused' and entity_id = tests.rid('a_run_admin')),
  '1000/1000/1', '...with the cap, the spend and the request');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-3', 0, 0)), 'granted'), 'true', 'a reservation worth nothing (0 + 0) still fits a full day');
-- a retry of a refused reservation is simply refused again (nothing was stored)
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-2', 1, 0)), 'granted'), 'false', 'a retry of the refused reservation is refused again');
-- who may reserve: only the run's starter, with the usual generic refusal
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('a_run_admin'), 'usage-9', 1, 1)), '42501|agent action not permitted||||', 'another member of the tenant cannot reserve on a run they did not start');
select is(pg_temp.err('b_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'usage-9', 1, 1)), '42501|agent action not permitted||||', 'a user of another tenant: identical');
select is(pg_temp.err('a_sales', pg_temp.rsv(gen_random_uuid(), 'usage-9', 1, 1)), '42501|agent action not permitted||||', 'an unknown run: identical');
select is(pg_temp.err(null, pg_temp.rsv(tests.rid('a_run_sales'), 'usage-9', 1, 1)), '42501|permission denied for function agent_reserve_cost||||', 'anon: no EXECUTE');
select is(pg_temp.err('a_viewer', pg_temp.rsv(tests.rid('a_run_sales'), 'usage-9', 1, 1)), '42501|agent action not permitted||||', 'a Viewer: identical');

-- ============================================================================ C. settle: the real cost, rounding up, overshoot on record, settled keys
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.use(tests.rid('a_run_sales'), 'usage-1', 500, 200, 0)), 'replayed'), 'false', 'settling usage-1 (500 in, 200 out, the runtime reported cost 0)');
select is((select settled_micros from public.agent_cost_reservations where run_id = tests.rid('a_run_sales') and step_key = 'usage-1'), 700::bigint,
  '...charges what the database computes from the tokens at the reserved price (700), not the reported 0');
select is(pg_temp.spent('a'), 800::numeric, '...so the day now holds 700 + 100 (the unused 200 of the reservation is released)');
select is((select cost_day from public.agent_cost_reservations where run_id = tests.rid('a_run_sales') and step_key = 'usage-1'), app.agent_utc_today(), '...on the same day');
select is((select cost_micros_used from public.agent_runs where id = tests.rid('a_run_sales')), 700::bigint, 'the run counts the CHARGE (700, computed from the tokens), not the 0 the runtime reported (T007 M3b)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.use(tests.rid('a_run_sales'), 'usage-1', 500, 200, 0)), 'replayed'), 'true', 'a replay of the usage record changes nothing');
select is(pg_temp.spent('a'), 800::numeric, '...spend unchanged');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'usage-1', 600, 300)), 'replayed'), 'true', 'reserving a SETTLED key again with the same arguments is a replay (a resumed run replays its turns)');
select is(pg_temp.spent('a'), 800::numeric, '...and charges nothing');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'usage-1', 600, 301)), 'SM205|agent step key reused with different arguments||||', '...while other arguments on a settled key are still SM205');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'usage-2', 200, 0)), 'granted'), 'true', 'the released 200 can be reserved by the next call (800 + 200 = 1000 exactly)');
-- the larger of the two costs wins: the runtime reported 190, the tokens cost 150
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.use(tests.rid('a_run_sales'), 'usage-2', 100, 50, 190)), 'replayed'), 'false', 'settling usage-2 (100 in, 50 out, reported 190)');
select is((select settled_micros from public.agent_cost_reservations where run_id = tests.rid('a_run_sales') and step_key = 'usage-2'), 190::bigint, '...the larger of the reported cost (190) and the computed one (150) is charged');
select is(pg_temp.spent('a'), 990::numeric, '...so the day holds 700 (usage-1) + 100 (the admin run''s reservation) + 190 = 990');

-- the provider billed MORE than the call's worst case (outside the declared bounds): the ledger holds the TRUE cost, and it is on record
select pg_temp.set_cap('a', 5000);
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-4', 10, 10)), 'reserved_micros'), '20', 'reserve a small call (10 in, 10 out = 20)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.use(tests.rid('a_run_admin'), 'usage-4', 100, 100, 0)), 'replayed'), 'false', '...but the call is reported at 100 in, 100 out (beyond its bounds): still recorded');
select is((select settled_micros from public.agent_cost_reservations where run_id = tests.rid('a_run_admin') and step_key = 'usage-4'), 200::bigint, 'the ledger holds the true cost (200), not the reservation (20)');
select is(pg_temp.spent('a'), 1190::numeric, '...so the day holds 990 + 200');
select is((select (new_values ->> 'reserved_micros') || '/' || (new_values ->> 'settled_micros') || '/' || (new_values ->> 'excess_micros')
             from public.audit_events where tenant_id = tests.tid('a') and action = 'agent_cost.overshoot' and entity_id = tests.rid('a_run_admin')), '20/200/180',
  'the overshoot is audited: reserved / settled / excess');
-- costs are rounded UP, never down: a model priced 1 and 3 per million tokens
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('round-test', 1, 3);
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-5', 1, 0, 'round-test')), 'reserved_micros'), '1', 'a reservation of one token at price 1 is 1 micro (0.000001 rounded UP), not 0');
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('round-half', 1500000, 1);
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-6', 1, 0, 'round-half')), 'reserved_micros'), '2', '1.5 rounds up to 2');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'usage-7', 333, 0, 'round-test')), 'reserved_micros'), '1', '0.000333 rounds up to 1');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.use(tests.rid('a_run_admin'), 'usage-5', 1, 1, 0)), 'replayed'), 'false', 'settling that call with (1 in, 1 out)...');
select is((select settled_micros from public.agent_cost_reservations where run_id = tests.rid('a_run_admin') and step_key = 'usage-5'), 1::bigint, '...(1 x 1 + 1 x 3) / 1,000,000 = 0.000004 is charged as 1 micro (rounded UP)');
select is(app.agent_cost_micros(1, 0, 1, 1), 1::bigint, 'the helper rounds up: 1 token at price 1');
select is(app.agent_cost_micros(1000000, 0, 1, 1), 1::bigint, '...exactly 1.0 stays 1');
select is(app.agent_cost_micros(1000001, 0, 1, 1), 2::bigint, '...and 1.000001 is 2');
select is(app.agent_cost_micros(0, 0, 1, 1), 0::bigint, '...and nothing is nothing');
-- the run's own budgets keep refusing, and a refused settlement leaves the reservation counted
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'bud-1', 10, 10)), 'granted'), 'true', 'reserve a small call on the sales run');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('a_run_sales'), 'bud-1', 30000, 1, 0)), 'SM203|agent run budget exhausted||||', 'a usage report beyond the run''s token budget is still SM203');
select is((select settled_micros is null from public.agent_cost_reservations where run_id = tests.rid('a_run_sales') and step_key = 'bud-1'), true, '...and the reservation stays OPEN (it keeps counting at its reserved 20)');

-- ============================================================================ D. prices: unknown model, zero price, bad arguments
create temp table r_nomodel as select pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'np-1', 1, 1, 'no-such-model')) as r;
select is(pg_temp.j((select r from r_nomodel), 'granted') || '/' || pg_temp.j((select r from r_nomodel), 'reason'), 'false/no_price', 'a model with no price is refused (fail closed)');
select is((select count(*) from public.agent_cost_reservations where step_key = 'np-1'), 0::bigint, '...nothing reserved');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'agent_cost.refused' and new_values ->> 'reason' = 'no_price'), 1::bigint, '...and audited');
-- the table forbids a zero price; the function does not rely on that: drop the CHECKs (this transaction only) and plant zero prices
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.agent_model_prices'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%micros%' loop
    execute format('alter table public.agent_model_prices drop constraint %I', c.conname);
  end loop;
end $$;
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('zero-in', 0, 5), ('zero-out', 5, 0), ('neg-in', -1, 5);
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'np-2', 1, 1, 'zero-in')), 'reason'), 'no_price', 'a zero INPUT price is refused by the function too');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'np-3', 1, 1, 'zero-out')), 'reason'), 'no_price', '...and a zero OUTPUT price');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'np-4', 1, 1, 'neg-in')), 'reason'), 'no_price', '...and a negative one');
select is((select count(*) from public.agent_cost_reservations where step_key in ('np-2', 'np-3', 'np-4')), 0::bigint, '...none of them reserved anything');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'np-5', -1, 1)), '22023|invalid argument||||', 'negative tokens: 22023');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'np-5', 1, -1)), '22023|invalid argument||||', '...also output tokens');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'np-5', 100000001, 1)), '22023|invalid argument||||', 'an absurd token count: 22023 (never a numeric overflow)');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'np-5', 1, 1, 'bad model!')), '22023|invalid argument||||', 'a model id outside the pattern: 22023');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'NP 5', 1, 1)), '22023|invalid argument||||', 'a step key outside the pattern: 22023');
select is(pg_temp.err('a_sales', format('select public.agent_reserve_cost(%L, null, ''fake-selftest'', 1, 1)', tests.rid('a_run_sales'))), '22023|invalid argument||||', 'a null step key: 22023');
select is(pg_temp.err('a_sales', format('select public.agent_reserve_cost(%L, ''np-6'', null, 1, 1)', tests.rid('a_run_sales'))), '22023|invalid argument||||', 'a null model: 22023');
select is(pg_temp.err('a_sales', format('select public.agent_reserve_cost(%L, ''np-6'', ''fake-selftest'', null, 1)', tests.rid('a_run_sales'))), '22023|invalid argument||||', 'null tokens: 22023');

-- ============================================================================ E. start_agent_run: the early refusal, fail closed
-- (spend today is now far above 1000)
select pg_temp.set_cap('a', 1000);
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s1'), tests.tid('a'), tests.rid('a_company'))), 'SM207|agent daily cost cap reached||||', 'with the day over the cap nothing starts: SM207');
select is((select count(*) from public.agent_runs where id = tests.rid('s1')), 0::bigint, '...and no run was created');
select pg_temp.set_cap('a', pg_temp.spent('a')::bigint);
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s1'), tests.tid('a'), tests.rid('a_company'))), 'SM207|agent daily cost cap reached||||', 'spend EXACTLY at the cap (no headroom at all): SM207 (">=" at start)');
select pg_temp.set_cap('a', pg_temp.spent('a')::bigint + 1);
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s1'), tests.tid('a'), tests.rid('a_company'))), 'rows:1', 'one micro of headroom: the run starts');
select pg_temp.set_cap('a', 1000);
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s1'), tests.tid('a'), tests.rid('a_company'))), 'replayed'), 'true', 'an exact retry of that start, after the cap filled, is still a replay (it returns the run as it was)');
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s2'), tests.tid('a'), tests.rid('a_company'))), 'SM207|agent daily cost cap reached||||', '...but a NEW run is refused');
select pg_temp.set_cap('a', 0);
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s2'), tests.tid('a'), tests.rid('a_company'))), 'SM207|agent daily cost cap reached||||', 'a cap of ZERO refuses every start');
select pg_temp.set_cap('a', null);
select is(app.agent_daily_cap(tests.tid('a')), 60000000::bigint, 'clearing the override falls back to the plan (three times the daily allowance)');
delete from public.agent_limits where limit_key = 'daily_cost_micros';
-- job AK / K2: the plan's allowance is the default now, so the fail-closed case is: no override, no plan allowance AND no operator default
delete from public.plan_ai_allowances where plan = 'free_trial';
select is(app.agent_daily_cap(tests.tid('a')), 0::bigint, 'no override, no plan allowance and no operator default: the cap is 0 (fail closed)');
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s2'), tests.tid('a'), tests.rid('a_company'))), 'SM207|agent daily cost cap reached||||', '...and nothing starts');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'fc-1', 1, 0)), 'reason'), 'daily_cap', '...nor is a model call authorised');
insert into public.agent_limits (limit_key, limit_value) values ('daily_cost_micros', 2000000);
insert into public.plan_ai_allowances (plan, daily_paise, monthly_paise) values ('free_trial', 2000, 30000);
update public.platform_flags set enabled = false where key = 'agents_enabled';
select pg_temp.set_cap('a', 0);
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s2'), tests.tid('a'), tests.rid('a_company'))), 'SM204|agents are disabled||||', 'a disabled platform is reported as disabled, before the cap');
update public.platform_flags set enabled = true where key = 'agents_enabled';
select pg_temp.set_cap('a', 1000);
select is(pg_temp.err('a_viewer', pg_temp.start_sql(tests.rid('s2'), tests.tid('a'), tests.rid('a_company'))), '42501|agent action not permitted||||', 'a Viewer is refused generically (the cap state is not an oracle)');
select is(pg_temp.err('outsider', pg_temp.start_sql(tests.rid('s2'), tests.tid('a'), tests.rid('a_company'))), '42501|agent action not permitted||||', '...and an outsider');
select is(tests.outcome_as(tests.uid('b_sales'), pg_temp.start_sql(tests.rid('bs1'), tests.tid('b'), tests.rid('b_company'))), 'rows:1', 'tenant B (under its own cap) starts a run while A is at its cap');

-- ============================================================================ F. the UTC day: attribution and rollover
-- the clock helper is replaced for the rest of this transaction (rolled back at the end): there is no override hook in production code
create function pg_temp.set_day(p date) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select date %L $b$', p::text);
end $fn$;
select pg_temp.set_cap('a', 1000);
select pg_temp.set_day(date '2031-03-01');
select is(app.agent_utc_today(), date '2031-03-01', 'the clock now says 2031-03-01');
select is(pg_temp.spent('a'), 0::numeric, 'a new day starts empty (yesterday''s spend does not count)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'day-1', 600, 300)), 'cost_day'), '2031-03-01', 'a reservation is charged to the day it is made, not to the run''s start day');
select ok((select r.created_at::date from public.agent_runs r where r.id = tests.rid('a_run_sales')) <> date '2031-03-01', '(the run itself was started on another day)');
-- crossing midnight: reserved on day D, settled on D+1
select pg_temp.set_day(date '2031-03-02');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.use(tests.rid('a_run_sales'), 'day-1', 600, 300, 0)), 'replayed'), 'false', 'the call is settled after midnight');
select is((select cost_day::text from public.agent_cost_reservations where run_id = tests.rid('a_run_sales') and step_key = 'day-1'), '2031-03-01', '...and its cost STAYS on the day it was authorised');
select is(app.agent_day_spend(tests.tid('a'), date '2031-03-01'), 900::numeric, 'that day holds the 900');
select is(app.agent_day_spend(tests.tid('a'), date '2031-03-02'), 0::numeric, 'the next day holds nothing of it');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'day-2', 1000, 0)), 'granted'), 'true', 'after midnight the same run may spend a whole new day''s cap');
select is((select cost_day::text from public.agent_cost_reservations where run_id = tests.rid('a_run_sales') and step_key = 'day-2'), '2031-03-02', '...charged to the new day');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'day-3', 1, 0)), 'granted'), 'false', '...and that day is now full');
select pg_temp.set_day(date '2031-03-01');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'day-4', 101, 0)), 'granted'), 'false', 'back on the first day: 900 spent, 101 more does not fit');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'day-5', 100, 0)), 'granted'), 'true', '...but 100 does (each day is counted on its own)');
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s3'), tests.tid('a'), tests.rid('a_company'))), 'SM207|agent daily cost cap reached||||', 'and on that full day no run starts');
select pg_temp.set_day(date '2031-03-03');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s3'), tests.tid('a'), tests.rid('a_company'))), 'rows:1', 'on an empty day a run starts again');

-- ============================================================================ G. tenant isolation
select pg_temp.set_day(date '2031-04-01');
select pg_temp.set_cap('a', 1000);
select is(pg_temp.j(pg_temp.sc(tests.uid('b_sales'), pg_temp.rsv(tests.rid('b_run'), 'iso-b1', 1000, 500)), 'granted'), 'true', 'tenant B spends 1500 today (its cap is the 2.00 default)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'iso-a1', 600, 300)), 'granted'), 'true', 'tenant A (cap 1000) still fits 900: B''s spend does not count toward A''s cap');
select is(pg_temp.spent('a') || '/' || pg_temp.spent('b'), '900/1500', 'each tenant''s day holds only its own spend');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'iso-a2', 100, 0)), 'granted'), 'true', 'A fills its cap exactly');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_admin'), pg_temp.rsv(tests.rid('a_run_admin'), 'iso-a3', 1, 0)), 'granted'), 'false', '...and is refused beyond it');
select is(pg_temp.j(pg_temp.sc(tests.uid('b_sales'), pg_temp.rsv(tests.rid('b_run'), 'iso-b2', 1000, 0)), 'granted'), 'true', 'while B, with a full-looking A beside it, still spends (A''s spend does not count toward B''s cap)');
select is(app.agent_daily_cap(tests.tid('b')), 60000000::bigint, 'and A''s override does not apply to B');
select is(pg_temp.err('b_sales', pg_temp.rsv(tests.rid('a_run_sales'), 'iso-x', 1, 1)), '42501|agent action not permitted||||', 'a user of tenant B cannot reserve on tenant A''s run');
select throws_ok(format($q$insert into public.agent_cost_reservations (tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, args_sha256)
                            values (%L, %L, 'x-1', current_date, 0, 0, 0, repeat('0', 64))$q$, tests.tid('b'), tests.rid('a_run_sales')), '23503', null,
  'a ledger row cannot name tenant B with tenant A''s run (composite foreign key)');
select is(tests.rows_as(tests.uid('a_owner'), 'select * from public.agent_cost_reservations'), (select count(*) from public.agent_cost_reservations where tenant_id = tests.tid('a')), 'an Owner of A reads exactly the ledger of A...');
select is(tests.rows_as(tests.uid('a_owner'), format('select * from public.agent_cost_reservations where tenant_id = %L', tests.tid('b'))), 0::bigint, '...none of B''s');
select is(tests.rows_as(tests.uid('b_admin'), 'select * from public.agent_cost_reservations'), (select count(*) from public.agent_cost_reservations where tenant_id = tests.tid('b')), 'an Admin of B reads exactly B''s');
select is(tests.rows_as(tests.uid('a_sales'), 'select * from public.agent_cost_reservations'), 0::bigint, 'Sales sees none');
select is(tests.rows_as(tests.uid('a_viewer'), 'select * from public.agent_cost_reservations'), 0::bigint, 'a Viewer sees none');
select is(tests.rows_as(tests.uid('outsider'), 'select * from public.agent_cost_reservations'), 0::bigint, 'an outsider sees none');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.agent_cost_reservations (tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, args_sha256)
                            values (%L, %L, 'x-2', current_date, 0, 0, 0, repeat('0', 64))$q$, tests.tid('a'), tests.rid('a_run_sales'))), '42501', 'not even an Owner can write the ledger directly');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.agent_cost_reservations set reserved_micros = 0 where tenant_id = %L$q$, tests.tid('a'))), '42501', '...or edit it');
select is(tests.outcome_as(tests.uid('a_owner'), 'select * from public.agent_model_prices'), '42501', 'nor read the operator''s price table');

-- ============================================================================ H. set_tenant_daily_cost_cap: Owner only, a second factor, a ceiling, audited
select pg_temp.set_day(date '2031-05-01');
create function pg_temp.cap_sql(p_tenant text, p_cap text) returns text language sql as $$ select format('select public.set_tenant_daily_cost_cap(%L, %s)', tests.tid(p_tenant), p_cap) $$;
select is(pg_temp.j(pg_temp.sc(tests.uid('a_owner'), pg_temp.cap_sql('a', '5000')), 'daily_cost_cap_micros'), '5000', 'an Owner (at aal2) sets the tenant''s cap; the answer is the effective cap');
select is(app.agent_daily_cap(tests.tid('a')), 5000::bigint, '...and it applies');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'tenant_agent_settings' and actor_user_id = tests.uid('a_owner')
             and (new_values ->> 'daily_cost_cap_micros') = '5000'), 1::bigint, 'the change is audited: who, and the new value');
select is((select (old_values ->> 'daily_cost_cap_micros') from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'tenant_agent_settings' and actor_user_id = tests.uid('a_owner')
             and (new_values ->> 'daily_cost_cap_micros') = '5000'), '1000', '...and the old value');
select is(pg_temp.err('a_admin', pg_temp.cap_sql('a', '5000')), '42501|agent action not permitted||||', 'an ADMIN cannot (Owner only)');
select is(pg_temp.err('a_sales', pg_temp.cap_sql('a', '5000')), '42501|agent action not permitted||||', 'Sales cannot');
select is(pg_temp.err('a_viewer', pg_temp.cap_sql('a', '5000')), '42501|agent action not permitted||||', 'a Viewer cannot');
select is(pg_temp.err('outsider', pg_temp.cap_sql('a', '5000')), '42501|agent action not permitted||||', 'an outsider cannot');
select is(pg_temp.err('b_owner', pg_temp.cap_sql('a', '5000')), '42501|agent action not permitted||||', 'the Owner of ANOTHER tenant cannot');
select is(pg_temp.err('a_owner', format('select public.set_tenant_daily_cost_cap(%L, 5000)', gen_random_uuid())), '42501|agent action not permitted||||', 'an unknown tenant: identical');
select is(pg_temp.err(null, pg_temp.cap_sql('a', '5000')), '42501|permission denied for function set_tenant_daily_cost_cap||||', 'anon: no EXECUTE');
select tests.as_aal('aal1');
select is(pg_temp.err('a_owner', pg_temp.cap_sql('a', '9000')), 'SM306|a second factor is required for this action||||', 'a password-only Owner is refused (a second factor, ADR 0016)');
select tests.as_aal('absent');
select is(pg_temp.err('a_owner', pg_temp.cap_sql('a', '9000')), 'SM306|a second factor is required for this action||||', '...and a token with no aal claim');
select is(pg_temp.err('a_admin', pg_temp.cap_sql('a', '9000')), '42501|agent action not permitted||||', 'an Admin at that level still gets the generic refusal (the role is proven first)');
select tests.as_aal('aal2');
select is(app.agent_daily_cap(tests.tid('a')), 5000::bigint, 'none of the refusals moved the cap');
select pg_temp.sc(tests.uid('a_owner'), pg_temp.cap_sql('a', '500000000'));
select is((select daily_cost_cap_micros from public.tenant_agent_settings where tenant_id = tests.tid('a')), 500000000::bigint, 'exactly the ceiling (500.00) is accepted and stored (the cap IN FORCE may be lower: the plan''s month, job AK K2)');
select is(pg_temp.err('a_owner', pg_temp.cap_sql('a', '500000001')), '23514|value not allowed||||', 'one micro above the ceiling: 23514');
select is(pg_temp.err('a_owner', pg_temp.cap_sql('a', '-1')), '23514|value not allowed||||', 'a negative cap: 23514');
select is((select daily_cost_cap_micros from public.tenant_agent_settings where tenant_id = tests.tid('a')), 500000000::bigint, '...and the stored cap is unchanged by the refusals');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_owner'), pg_temp.cap_sql('a', '0')), 'daily_cost_cap_micros'), '0', 'zero is allowed (it switches agent spending off for the tenant)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_owner'), pg_temp.cap_sql('a', 'null')), 'daily_cost_cap_micros'), '60000000', 'null clears the override: back to the plan');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.tenant_agent_settings set daily_cost_cap_micros = 1 where tenant_id = %L$q$, tests.tid('a'))), '42501', 'a direct client UPDATE of the column is refused (no privilege)');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.agent_limits (limit_key, limit_value) values ('daily_cost_micros', 1) on conflict (limit_key) do update set limit_value = 1$q$)), '42501', 'nor can anyone change the operator default through the API');
select pg_temp.j(pg_temp.sc(tests.uid('a_owner'), pg_temp.cap_sql('a', '7000')), 'daily_cost_cap_micros');
select pg_temp.sc(tests.uid('a_admin'), format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('a')));
select is(app.agent_daily_cap(tests.tid('a')), 7000::bigint, 'the agents switch (Admin) does not touch the cap');
delete from public.tenant_agent_settings where tenant_id = tests.tid('b');
select is(pg_temp.j(pg_temp.sc(tests.uid('b_owner'), pg_temp.cap_sql('b', '3000')), 'daily_cost_cap_micros'), '3000', 'a tenant with no settings row yet gets one (agents stay OFF)');
select is((select enabled from public.tenant_agent_settings where tenant_id = tests.tid('b')), false, '...with the agents switch off');

-- ============================================================================ I. a usage record REQUIRES a reservation, and a reported cost is bounded
select pg_temp.set_day(date '2031-06-01');
select pg_temp.set_cap('a', 100000);
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('a_run_sales'), 'legacy-1', 10, 10, 600)), '23503|invalid reference||||', 'a usage record for a step key nobody reserved is refused (no legacy path)');
select is((select count(*) from public.agent_run_steps where run_id = tests.rid('a_run_sales') and step_key = 'legacy-1') + (select count(*) from public.agent_cost_reservations where step_key = 'legacy-1'), 0::bigint, '...it leaves no step and no ledger row');
select is(pg_temp.spent('a'), 0::numeric, '...and charges nothing to the day');
-- a reported cost is at most TWICE the reserved worst case
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'cb-1', 100, 100)), 'reserved_micros'), '200', 'reserve 200');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('a_run_sales'), 'cb-1', 100, 100, 401)), '23514|value not allowed||||', 'a reported cost of 401 (more than twice 200) is refused: 23514');
select is(pg_temp.spent('a'), 200::numeric, '...the reservation stays open and keeps counting at 200');
select is((select settled_micros is null from public.agent_cost_reservations where run_id = tests.rid('a_run_sales') and step_key = 'cb-1'), true, '...unsettled');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.use(tests.rid('a_run_sales'), 'cb-1', 100, 100, 400)), 'replayed'), 'false', 'exactly twice the reservation (400) is accepted');
select is((select settled_micros from public.agent_cost_reservations where run_id = tests.rid('a_run_sales') and step_key = 'cb-1'), 400::bigint, '...and charged as reported (the larger of 400 and the 200 computed)');
-- the lock-out attempt: a huge cost on a tiny reservation, directly, by a member
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'cb-2', 10, 10)), 'reserved_micros'), '20', 'reserve 20');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('a_run_sales'), 'cb-2', 10, 10, 200000)), '23514|value not allowed||||', 'a member reporting 200,000 (within the run''s budget) against a reservation of 20: refused');
select is(pg_temp.spent('a'), 420::numeric, '...the day moved by nothing (400 settled + 20 open)');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('a_run_sales'), 'cb-2', 10, 10, 41)), '23514|value not allowed||||', 'twice-plus-one on a small reservation: refused too');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('a_run_sales'), 'cb-3', 0, 0)), 'reserved_micros'), '0', 'a reservation worth nothing...');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('a_run_sales'), 'cb-3', 0, 0, 1)), '23514|value not allowed||||', '...admits no cost at all');
-- what is charged never exceeds the RUN's cost budget
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs, max_cost_micros)
values (tests.rid('cost_run'), tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'), now() + interval '15 minutes', repeat('4', 64), '{}'::jsonb, 100);
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('cost_run'), 'rc-1', 300, 0)), 'reserved_micros'), '300', 'a run with a cost budget of 100 reserves a call worth 300');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('cost_run'), 'rc-1', 300, 0, 0)), 'SM203|agent run budget exhausted||||', 'settling it at the computed 300 would exceed the run''s cost budget: SM203');
select is((select settled_micros is null from public.agent_cost_reservations where run_id = tests.rid('cost_run')), true, '...the reservation stays open');
-- a reservation must fit what is left of the RUN's token budgets (one call cannot reserve a day's cap)
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs, max_input_tokens, max_output_tokens)
values (tests.rid('tok_run'), tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'), now() + interval '15 minutes', repeat('5', 64), '{}'::jsonb, 1000, 100);
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('tok_run'), 'tk-0', 1001, 0)), 'SM203|agent run budget exhausted||||', 'one more input token than the run has left: SM203, before any model call');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('tok_run'), 'tk-0', 0, 101)), 'SM203|agent run budget exhausted||||', '...and one more output token');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('tok_run'), 'tk-1', 600, 50)), 'granted'), 'true', 'a call within the budget is granted');
select is(pg_temp.err('a_sales', pg_temp.rsv(tests.rid('tok_run'), 'tk-2', 401, 0)), 'SM203|agent run budget exhausted||||', 'a second one is measured against what the OPEN reservation leaves (600 + 401 > 1000)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('tok_run'), 'tk-3', 400, 50)), 'granted'), 'true', '...400 fits exactly');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_id = tests.rid('tok_run') and action = 'agent_cost.refused'), 0::bigint, 'a budget refusal is a raise (nothing was stored); it is not a cap hit');

-- ============================================================================ J. source audit: the lock
create temp table src as select proname, prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname in ('agent_reserve_cost', 'agent_record_usage');
select is((select count(*) from src where prosrc ~ 'app\.agent_cost_lock\(r\.tenant_id\)'), 2::bigint, 'reserving and settling both take the tenant''s cost lock');
select is((select count(*) from pg_proc where pronamespace = 'app'::regnamespace and proname = 'agent_cost_lock' and prosrc ~ 'pg_advisory_xact_lock'), 1::bigint, '...which is a transaction-level advisory lock');
select is((select count(*) from src where prosrc ~* 'p_tenant\M|tenant_id\s*:=\s*p_'), 0::bigint, 'neither takes or assigns a tenant from an argument');

select * from finish();
rollback;
