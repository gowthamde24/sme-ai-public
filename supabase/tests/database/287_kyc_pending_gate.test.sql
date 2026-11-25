-- Buy first, verify after (migration 20261231991900): a workspace with its own VoiceLink client is pending until verified; one without is never; the worker lists and marks.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(app.kyc_pending(tests.tid('a')), false, 'A1: a workspace without its own client is never pending');
insert into telephony.business_clients (tenant_id, client_id, account_type, state, created_by) values (tests.tid('a'), 501, 'business', 'in_progress', tests.uid('a_owner')), (tests.tid('b'), 502, 'individual', 'verified', tests.uid('b_owner'));
select is(app.kyc_pending(tests.tid('a')), true, 'A2: with its own client and no approval it is pending');
select is(app.kyc_pending(tests.tid('b')), false, 'A3: a verified one is not');
select is(pg_temp.sc('a_owner', 'select public.business_client_pending(10)::text'), 'ERR:42501', 'B1: a member cannot read the worker list');
select is((select jsonb_array_length(pg_temp.sc('outsider', 'select public.business_client_pending(10)::text')::jsonb)), 1, 'B2: the worker sees the one waiting');
select is(pg_temp.sc('a_owner', format($q$select public.business_client_mark_verified(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B3: a member cannot mark a business verified');
select pg_temp.sc('outsider', format($q$select public.business_client_mark_verified(%L)::text$q$, tests.tid('a')));
select is(app.kyc_pending(tests.tid('a')), false, 'B4: once marked, the number may take calls');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'phone.business_kyc_verified'), 1::bigint, 'B5: and it is in the audit log');
select is((select jsonb_array_length(pg_temp.sc('outsider', 'select public.business_client_pending(10)::text')::jsonb)), 0, 'B6: nothing waits any more');
select * from finish();
rollback;
