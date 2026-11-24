-- Daily allowance per workspace and feature (migration 20261231991300).
begin;
select no_plan();
select tests.seed_two_tenants();
create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
select is(pg_temp.at('a_sales', format($q$select public.daily_cap_take(%L, 'describe_job', 2)::text$q$, tests.tid('a'))), 'ERR:42501', 'A1: Sales cannot');
select is(pg_temp.at('b_owner', format($q$select public.daily_cap_take(%L, 'describe_job', 2)::text$q$, tests.tid('a'))), 'ERR:42501', 'A2: nor another workspace');
select is(pg_temp.at('a_owner', format($q$select public.daily_cap_take(%L, 'other', 2)::text$q$, tests.tid('a'))), 'ERR:22023', 'A3: an unknown feature');
select is(pg_temp.at('a_owner', format($q$select public.daily_cap_take(%L, 'describe_job', 0)::text$q$, tests.tid('a'))), 'ERR:22023', 'A4: a limit must be positive');
select is(pg_temp.at('a_owner', format($q$select (public.daily_cap_take(%L, 'describe_job', 2)) ->> 'used'$q$, tests.tid('a'))), '1', 'B1: first use');
select is(pg_temp.at('a_admin', format($q$select (public.daily_cap_take(%L, 'describe_job', 2)) ->> 'used'$q$, tests.tid('a'))), '2', 'B2: an Admin counts in the same workspace total');
select is(pg_temp.at('a_owner', format($q$select (public.daily_cap_take(%L, 'describe_job', 2)) ->> 'ok'$q$, tests.tid('a'))), 'false', 'B3: the third is refused');
select is(pg_temp.at('a_owner', format($q$select (public.daily_cap_take(%L, 'describe_job', 2)) ->> 'ok'$q$, tests.tid('a'))), 'false', 'B4: and stays refused');
select is((select n from daily_caps.use where tenant_id = tests.tid('a')), 2, 'B5: the refusals are not counted');
select is(pg_temp.at('b_owner', format($q$select (public.daily_cap_take(%L, 'describe_job', 2)) ->> 'used'$q$, tests.tid('b'))), '1', 'C1: another workspace has its own count');
select is(has_table_privilege('authenticated', 'daily_caps.use', 'select'), false, 'C2: the table is closed to members');
select * from finish();
rollback;
