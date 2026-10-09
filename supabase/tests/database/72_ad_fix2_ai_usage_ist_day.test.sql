-- Job AD / review fix 2: public.ai_usage_today(tenant): the Asia/Kolkata day, Owner and Admin only, tenants never mix.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

-- two runs (one per business) to hang the reservations on
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, lead_id, status, expires_at, input_sha256) values
  (tests.rid('a_run'), tests.tid('a'), tests.uid('a_owner'), 'research', '1', tests.rid('a_lead'), 'running', now() + interval '1 hour', repeat('a', 64)),
  (tests.rid('b_run'), tests.tid('b'), tests.uid('b_owner'), 'research', '1', tests.rid('b_lead'), 'running', now() + interval '1 hour', repeat('b', 64));

create function pg_temp.res(p_tenant uuid, p_run uuid, p_key text, p_created timestamptz, p_reserved bigint, p_settled bigint) returns void language sql as $$
  insert into public.agent_cost_reservations (id, tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, settled_micros, args_sha256, created_at, settled_at, outcome)
  values (gen_random_uuid(), p_tenant, p_run, p_key, (p_created at time zone 'UTC')::date, 1000, 1000, p_reserved, p_settled, repeat('c', 64), p_created,
          case when p_settled is not null then p_created end, case when p_settled is not null then 'used' end)
$$;

-- "today in India" starts at IST midnight
create temp table t as select (app.quote_today()::timestamp at time zone 'Asia/Kolkata') as ist_start;

select pg_temp.res(tests.tid('a'), tests.rid('a_run'), 'usage-1', (select ist_start + interval '1 minute' from t), 300000, 120000);   -- today, settled: 120,000
select pg_temp.res(tests.tid('a'), tests.rid('a_run'), 'usage-2', (select ist_start + interval '2 minutes' from t), 50000, null);      -- today, still open: counts at its reservation, 50,000
select pg_temp.res(tests.tid('a'), tests.rid('a_run'), 'usage-3', (select ist_start - interval '1 minute' from t), 900000, 900000);    -- yesterday in India (one minute before midnight): not today
select pg_temp.res(tests.tid('a'), tests.rid('a_run'), 'usage-4', (select ist_start - interval '1 day' from t), 900000, 900000);       -- the day before
select pg_temp.res(tests.tid('b'), tests.rid('b_run'), 'usage-1', (select ist_start + interval '3 minutes' from t), 777000, 777000);   -- the other business

select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.ai_usage_today(%L) ->> 'spent_micros')$$, tests.tid('a'))), '170000', 'owner: today in India = settled 120,000 + open 50,000; yesterday''s is not counted');
select is(tests.scalar_as(tests.uid('a_admin'), format($$select (public.ai_usage_today(%L) ->> 'spent_micros')$$, tests.tid('a'))), '170000', 'admin: the same');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.ai_usage_today(%L) ->> 'day')$$, tests.tid('a'))), app.quote_today()::text, 'the day is the Indian date');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.ai_usage_today(%L) ->> 'cap_micros')$$, tests.tid('a'))), app.agent_daily_cap(tests.tid('a'))::text, 'the cap is the tenant''s daily cap');
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.ai_usage_today(%L) ->> 'spent_micros')$$, tests.tid('b'))), '777000', 'the other business sees only its own spend');

-- a call just after IST midnight that is still the previous UTC day counts as today in India; one just before IST midnight (UTC evening) does not
select pg_temp.res(tests.tid('a'), tests.rid('a_run'), 'usage-5', (select ist_start + interval '30 seconds' from t), 10000, 10000);
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.ai_usage_today(%L) ->> 'spent_micros')$$, tests.tid('a'))), '180000', 'just after Indian midnight counts as today (that is still the UTC evening of the day before)');

-- who may not
select is(tests.sqlstate_as(tests.uid('a_sales'), format($$select public.ai_usage_today(%L)$$, tests.tid('a'))), '42501', 'DENY: Sales');
select is(tests.sqlstate_as(tests.uid('a_viewer'), format($$select public.ai_usage_today(%L)$$, tests.tid('a'))), '42501', 'DENY: a Viewer');
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$select public.ai_usage_today(%L)$$, tests.tid('a'))), '42501', 'DENY: another business''s owner');
select is(tests.sqlstate_as(tests.uid('outsider'), format($$select public.ai_usage_today(%L)$$, tests.tid('a'))), '42501', 'DENY: a stranger');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$select public.ai_usage_today(%L)$$, gen_random_uuid())), '42501', 'DENY: an unknown business answers the same');
select is(tests.sqlstate_as(tests.uid('a_owner'), $$select public.ai_usage_today(null)$$), '42501', 'DENY: no business');
select is(tests.sqlstate_as(null, format($$select public.ai_usage_today(%L)$$, tests.tid('a'))), '42501', 'DENY: no identity');
select is(has_function_privilege('anon', 'public.ai_usage_today(uuid)', 'execute'), false, 'anon cannot execute it');
select is((select prosecdef and provolatile = 's' and 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.ai_usage_today(uuid)'::regprocedure), true, 'SECURITY DEFINER, STABLE, search_path pinned');

-- nothing was written by reading
select is((select count(*) from public.agent_cost_reservations where tenant_id = tests.tid('a')), 5::bigint, 'reading wrote nothing');

select * from finish();
rollback;
