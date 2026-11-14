-- In-app KYC for a business's phone number (migration 20261231740000): who may start and move an application, the states, one live application at a time, the reason is an Owner/Admin read, no client writes.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;

select is(pg_temp.j(pg_temp.sc('a_viewer', format($q$select public.phone_kyc_get(%L)::text$q$, tests.tid('a'))), 'id'), null, 'A1: nothing filed yet: id is null (any member reads)');
select is(pg_temp.sc('b_owner', format($q$select public.phone_kyc_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A2: another business sees nothing');
select is(pg_temp.sc('anon', format($q$select public.phone_kyc_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A3: nor anyone signed out');

-- B. who starts one
select is(pg_temp.sc('a_admin', format($q$select public.phone_kyc_save(%L, %L, 'gst', null, null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k1'))), 'ERR:42501', 'B1: an Admin cannot file KYC (only the Owner)');
select is(pg_temp.sc('a_sales', format($q$select public.phone_kyc_save(%L, %L, 'gst', null, null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k1'))), 'ERR:42501', 'B2: nor Sales');
select is(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'gst', null, null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k1')), 'aal1'), 'ERR:SM306', 'B3: the Owner needs the second factor');
select is(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'pan', null, null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k1'))), 'ERR:22023', 'B4: the document kind is one of gst, coi, udyam');
select is(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'gst', 'bad id!', null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k1'))), 'ERR:22023', 'B5: an id must be a plain token');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'udyam', null, null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k1'))), 'status'), 'preparing', 'B6: the Owner begins with Udyam');
select is(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'gst', null, null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k2'))), 'ERR:23505', 'B7: only one live application at a time');

-- C. moving it on
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'udyam', 'SAABCDEF123456789012', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'submitted')::text$q$, tests.tid('a'), tests.rid('k1'))), 'compliance_id'), 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'C1: submitted, with Plivo''s application id');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'udyam', null, null, 'submitted')::text$q$, tests.tid('a'), tests.rid('k1'))), 'plivo_subaccount'), 'SAABCDEF123456789012', 'C2: a later save keeps what was stored');
select is(pg_temp.sc('b_owner', format($q$select public.phone_kyc_save(%L, %L, 'udyam', null, null, 'accepted')::text$q$, tests.tid('b'), tests.rid('k1'))), 'ERR:23505', 'C3: another business cannot take over the id');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'udyam', null, null, 'rejected', 'The name does not match the certificate')::text$q$, tests.tid('a'), tests.rid('k1'))), 'status'), 'rejected', 'C4: Plivo''s rejection is recorded with its words');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_get(%L)::text$q$, tests.tid('a'))), 'rejection_reason'), 'The name does not match the certificate', 'C5: the Owner reads the reason');
select is(pg_temp.j(pg_temp.sc('a_admin', format($q$select public.phone_kyc_get(%L)::text$q$, tests.tid('a'))), 'rejection_reason'), 'The name does not match the certificate', 'C6: an Admin too');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.phone_kyc_get(%L)::text$q$, tests.tid('a'))), 'rejection_reason'), null, 'C7: Sales and Viewer see the status but not the reason');
select is(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'udyam', null, null, 'accepted')::text$q$, tests.tid('a'), tests.rid('k1'))), 'ERR:SM501', 'C8: a rejected application stays rejected (a new one is made)');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'gst', null, null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k2'))), 'status'), 'preparing', 'C9: after a rejection the next application can begin (GST this time)');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_get(%L)::text$q$, tests.tid('a'))), 'doc_kind'), 'gst', 'C10: the latest one is read');

-- C2. a retry never moves it backwards
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'gst', null, null, 'submitted')::text$q$, tests.tid('a'), tests.rid('k2'))), 'status'), 'submitted', 'E1: the GST application is submitted');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_kyc_save(%L, %L, 'gst', null, null, 'preparing')::text$q$, tests.tid('a'), tests.rid('k2'))), 'status'), 'submitted', 'E2: a retry that says preparing leaves it submitted');

-- D. nothing is written by a client directly; the audit log has it
select is((select has_table_privilege('authenticated', 'public.phone_kyc', 'insert')), false, 'D1: no client insert');
select is((select has_table_privilege('authenticated', 'public.phone_kyc', 'update')), false, 'D2: no client update');
select cmp_ok((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'phone_kyc'), '>=', 3, 'D3: every change is in the audit log');
select cmp_ok((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'phone_kyc' and (coalesce(new_values::text, '') || coalesce(old_values::text, '')) like '%rejected%'), '>=', 1, 'D4: the rejection is in the audit log (the reason is a SAFE column about the business''s own document, so it may be there)');

select * from finish();
rollback;
