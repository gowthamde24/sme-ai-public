-- The per-day call limit (migration 20261231760000): default 100, the Owner (second factor) changes it, any planner reads it, the count of today's calls, the runner's pause.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;

select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.task_call_limit(%L)::text$q$, tests.tid('a'))), 'limit'), '100', 'A1: the default is 100 calls a day (any planner reads it)');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.task_call_limit(%L)::text$q$, tests.tid('a'))), 'remaining'), '100', 'A2: nothing called yet today');
select is(pg_temp.sc('a_viewer', format($q$select public.task_call_limit(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A3: a viewer does not plan, so does not read it');
select is(pg_temp.sc('b_owner', format($q$select public.task_call_limit(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A4: another business sees nothing');

select is(pg_temp.sc('a_admin', format($q$select public.task_call_limit_set(%L, 50)::text$q$, tests.tid('a'))), 'ERR:42501', 'B1: only the Owner changes it');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.task_call_limit_set(%L, 60)::text$q$, tests.tid('a')), 'aal1'), 'limit'), '60', 'B2: no authenticator code is needed (a clear confirmation in the app)');
select is(pg_temp.sc('a_owner', format($q$select public.task_call_limit_set(%L, 0)::text$q$, tests.tid('a'))), 'ERR:22023', 'B3: at least 1');
select is(pg_temp.sc('a_owner', format($q$select public.task_call_limit_set(%L, 5001)::text$q$, tests.tid('a'))), 'ERR:22023', 'B4: at most 5000');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.task_call_limit_set(%L, 50)::text$q$, tests.tid('a'))), 'limit'), '50', 'B5: the Owner sets 50');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.task_call_limit(%L)::text$q$, tests.tid('a'))), 'limit'), '50', 'B6: and everyone reads 50');
select is(pg_temp.j(pg_temp.sc('b_owner', format($q$select public.task_call_limit(%L)::text$q$, tests.tid('b'))), 'limit'), '100', 'B7: the other business keeps its own (100)');
select cmp_ok((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action = 'calls.day_limit' and actor_user_id = tests.uid('a_owner')), '>=', 2, 'B8: every change is in the audit log with who made it');

-- C. today's calls are counted (people a plan called today, and outbound calls that were placed)
select is(app.calls_used_today(tests.tid('a')), 0, 'C1: none today');
select is(pg_temp.sc('a_owner', format($q$select public.task_pause_daily_limit(%L, %L)::text$q$, tests.tid('a'), gen_random_uuid())), 'ERR:23503', 'C2: a plan that is not there is not found');
select is(pg_temp.sc('a_sales', format($q$select public.task_pause_daily_limit(%L, %L)::text$q$, tests.tid('a'), gen_random_uuid())), 'ERR:42501', 'C3: Sales cannot pause a run');

select * from finish();
rollback;
