-- The hourly cap counts only runs that spend model money; a backstop of 120 counts any run (migration 20261231982500; planner, 18 Nov 2026).
begin;
select no_plan();
select tests.seed_two_tenants();
insert into public.assistant_conversations (id, tenant_id, created_by) values (tests.rid('conv'), tests.tid('a'), tests.uid('a_owner'));
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.reopen() returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select coalesce(extract(epoch from public.agent_runs_reopen_at(%L) - now())::integer::text, 'null')$q$, tests.tid('a'))) $$;
-- p_n runs started p_ago ago; micros = what each spent (0 = a fixed answer)
create function pg_temp.runs(p_n integer, p_ago interval, p_micros bigint, p_light boolean default false) returns void language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, conversation_id, expires_at, input_sha256, created_at, cost_micros_used, light)
  select gen_random_uuid(), tests.tid('a'), tests.uid('a_owner'), 'assistant', 'assistant-1', tests.rid('conv'), now() + interval '15 minutes', repeat('3', 64), now() - p_ago - (g * interval '1 second'), p_micros, p_light
    from generate_series(1, p_n) g;
end $$;

-- the start function counts spending runs against 30 and any run against 120
select is((select pg_get_functiondef('public.start_agent_run(uuid,uuid,text,text,text,uuid,text,jsonb,integer,jsonb)'::regprocedure) like '%cost_micros_used > 0)%>= app.agent_limit(''max_runs_per_hour'', 0)%app.agent_limit(''max_runs_per_hour_any'', 120)%'), true,
  'L1 start_agent_run: the 30 counts runs that used the model, the 120 backstop counts any run');

-- a limit of 3 for this test (the 30 is the real one)
alter table public.agent_limits disable trigger all;
update public.agent_limits set limit_value = 3 where limit_key = 'max_runs_per_hour';

select pg_temp.runs(2, interval '10 minutes', 50000);
select is(pg_temp.reopen(), 'null', 'L2 two spending runs: under the limit of 3');
select pg_temp.runs(100, interval '5 minutes', 0);
select is(pg_temp.reopen(), 'null', 'L3 a hundred fixed answers (cost 0) do not use the cap up');
select pg_temp.runs(1, interval '2 minutes', 40000);
select is((pg_temp.reopen())::integer between 49 * 60 and 51 * 60, true, 'L4 the third SPENDING run closes the door; it opens when the oldest spending run is an hour old (about 50 minutes)');
select pg_temp.runs(1, interval '1 minute', 40000, true);
select is((pg_temp.reopen())::integer between 49 * 60 and 51 * 60, true, 'L5 a light-mode run counts for neither door (the answer is the same)');

-- the backstop: 120 runs of any kind
update public.agent_runs set created_at = now() - interval '2 hours' where tenant_id = tests.tid('a') and cost_micros_used > 0;
select is(pg_temp.reopen(), 'null', 'L6 (setup) the spending runs left the hour: open again');
select pg_temp.runs(20, interval '3 minutes', 0);
select is((pg_temp.reopen())::integer between 52 * 60 and 54 * 60, true, 'L7 120 runs of any kind (100 + 20) close the backstop door, even with no spending: it opens when the oldest is an hour old');

select * from finish();
rollback;
