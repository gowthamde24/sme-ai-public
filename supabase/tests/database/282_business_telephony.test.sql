-- Business KYC per client (migration 20261231991200): who may read and write, the client id is set once, closed words only.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(pg_temp.at('a_owner', format($q$select coalesce(public.business_client_get(%L)::text, 'none')$q$, tests.tid('a'))), 'none', 'A1: no client yet reads null');
select is(pg_temp.at('a_admin', format($q$select public.business_client_put(%L, 101, 'business', 'created')::text$q$, tests.tid('a'))), 'ERR:42501', 'A2: an Admin cannot write');
select is(pg_temp.at('b_owner', format($q$select public.business_client_put(%L, 101, 'business', 'created')::text$q$, tests.tid('a'))), 'ERR:42501', 'A3: nor another workspace');
select is(pg_temp.at('a_owner', format($q$select (public.business_client_put(%L, 101, 'business', 'created')) ->> 'state'$q$, tests.tid('a'))), 'created', 'A4: the Owner records the client');
select is(pg_temp.at('a_owner', format($q$select (public.business_client_put(%L, 101, null, 'in_progress')) ->> 'account_type'$q$, tests.tid('a'))), 'business', 'A5: a null type keeps the first');
select is(pg_temp.at('a_owner', format($q$select public.business_client_put(%L, 202, 'business', 'in_progress')::text$q$, tests.tid('a'))), 'ERR:22023', 'A6: the client id is set once');
select is(pg_temp.at('a_owner', format($q$select public.business_client_put(%L, 101, 'business', 'bogus')::text$q$, tests.tid('a'))), 'ERR:22023', 'A7: an unknown state');
select is(pg_temp.at('a_owner', format($q$select public.business_client_put(%L, 101, 'business', 'stuck', 'Has Spaces')::text$q$, tests.tid('a'))), 'ERR:22023', 'A8: a reason is a closed word');
select is(pg_temp.at('b_owner', format($q$select public.business_client_put(%L, 101, 'business', 'created')::text$q$, tests.tid('b'))), 'ERR:23505', 'A9: one client belongs to one workspace');
select is(pg_temp.at('a_owner', format($q$select (public.business_client_put(%L, 101, null, 'stuck', 'pan_mismatch')) ->> 'reason'$q$, tests.tid('a'))), 'pan_mismatch', 'A10: a stuck KYC says why');
select is(pg_temp.at('a_admin', format($q$select (public.business_client_get(%L)) ->> 'state'$q$, tests.tid('a'))), 'stuck', 'B1: an Admin reads');
select is(pg_temp.at('a_sales', format($q$select public.business_client_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B2: Sales cannot');
select is(pg_temp.at('b_owner', format($q$select public.business_client_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B3: nor another workspace');
select is(has_table_privilege('authenticated', 'telephony.business_clients', 'select'), false, 'C1: the table is closed to members');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action like 'phone.business_kyc_%'), 3::bigint, 'C2: every move is audited');

select * from finish();
rollback;
