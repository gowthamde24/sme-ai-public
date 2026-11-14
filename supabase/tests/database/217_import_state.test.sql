-- Migration 20261231830000: the import state is replaced by its owner only, and the preview finds the people already in the leads.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select tests.open_gate('b');

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

create temp table t_file as select (pg_temp.val('a_owner', format($q$select (public.assistant_file_put(%L, 'import-state.json', 'application/json', 'text', %L))->>'file_id'$q$, tests.tid('a'), encode('{"v":2}'::bytea, 'base64')))) as id;
select ok((select id from t_file) ~ '^[0-9a-f-]{36}$', 'A0: the state file is stored');
select is(pg_temp.val('a_owner', format($q$select (public.assistant_file_replace(%L, %L, %L))->>'size_bytes'$q$, tests.tid('a'), (select id from t_file), encode('{"v":2,"rows":[]}'::bytea, 'base64'))), '17', 'A1: its owner replaces the bytes');
select is(pg_temp.val('a_owner', format($q$select convert_from(decode((public.assistant_file_get(%L, %L))->>'data_base64', 'base64'), 'utf8')$q$, tests.tid('a'), (select id from t_file))), '{"v":2,"rows":[]}', 'A2: and reads the new content back');
select is(pg_temp.val('a_admin', format($q$select public.assistant_file_replace(%L, %L, %L)::text$q$, tests.tid('a'), (select id from t_file), encode('x'::bytea, 'base64'))), 'ERR:23503', 'A3: nobody else replaces it (not found)');
select is(pg_temp.val('b_owner', format($q$select public.assistant_file_replace(%L, %L, %L)::text$q$, tests.tid('a'), (select id from t_file), encode('x'::bytea, 'base64'))), 'ERR:42501', 'A4: nor another workspace');
select is(pg_temp.val('a_viewer', format($q$select public.assistant_file_replace(%L, %L, %L)::text$q$, tests.tid('a'), (select id from t_file), encode('x'::bytea, 'base64'))), 'ERR:42501', 'A5: nor a Viewer');
select is(pg_temp.val('a_owner', format($q$select public.assistant_file_replace(%L, %L, '')::text$q$, tests.tid('a'), (select id from t_file))), 'ERR:22023', 'A6: empty bytes are refused');


-- lead_phones_known
insert into public.contacts (id, tenant_id, full_name, phone) values (tests.rid('known'), tests.tid('a'), 'Anita S', '+919123456789');
insert into public.contacts (id, tenant_id, full_name, phone) values (tests.rid('known_b'), tests.tid('b'), 'Other Tenant', '+919555500001');
select app.contact_lead(tests.tid('a'), tests.rid('known'), 'test');
select is((pg_temp.val('a_owner', format($q$select public.lead_phones_known(%L, array['+919123456789', '+919999999999'])::text$q$, tests.tid('a')))::jsonb -> 0 ->> 'name'), 'Anita S', 'B1: a number already in the contacts is found, with the name');
select is(jsonb_array_length(pg_temp.val('a_owner', format($q$select public.lead_phones_known(%L, array['+919123456789', '+919999999999'])::text$q$, tests.tid('a')))::jsonb), 1, 'B2: and the unknown one is not');
select is(jsonb_array_length(pg_temp.val('a_owner', format($q$select public.lead_phones_known(%L, array['+919555500001'])::text$q$, tests.tid('a')))::jsonb), 0, 'B3: another workspace''s contact is never seen');
select is(pg_temp.val('b_owner', format($q$select public.lead_phones_known(%L, array['+919123456789'])::text$q$, tests.tid('a'))), 'ERR:42501', 'B4: nor by another workspace');
select * from finish();
rollback;
