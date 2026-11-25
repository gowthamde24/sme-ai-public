-- Results into the business's own CRM or sheet (migration 20261231992330): both tables are RLS-forced and read-only for members (Owner and Admin of that workspace only, nobody else's), written only by the functions; the
-- functions refuse strangers, other workspaces and a missing second factor; and no credential has a column to live in (the keys are in Secret Manager).
begin;
select no_plan();
select tests.seed_two_tenants();
create function pg_temp.sc(p_user text, p_aal text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A. the table rules
select is((select count(*) from pg_class where oid in ('public.crm_connections'::regclass, 'public.crm_deliveries'::regclass) and relrowsecurity and relforcerowsecurity), 2::bigint, 'A1: both tables have row security on and forced');
select is(has_table_privilege('authenticated', 'public.crm_connections', 'insert') or has_table_privilege('authenticated', 'public.crm_connections', 'update') or has_table_privilege('authenticated', 'public.crm_connections', 'delete')
          or has_table_privilege('authenticated', 'public.crm_deliveries', 'insert') or has_table_privilege('authenticated', 'public.crm_deliveries', 'update') or has_table_privilege('authenticated', 'public.crm_deliveries', 'delete'), false, 'A2: a member has no direct write on either table');
select is(has_table_privilege('anon', 'public.crm_connections', 'select') or has_table_privilege('anon', 'public.crm_deliveries', 'select'), false, 'A3: a stranger cannot read either');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('crm_connections', 'crm_deliveries') and column_name <> 'secret_version' and column_name ~* '(secret|token|password|api_?key|credential|bearer)'), 0::bigint, 'A4: no column is named like a credential (secret_version is a counter: the key itself is in Secret Manager)');
select is(has_function_privilege('anon', 'public.crm_connection_save(uuid, uuid, text, jsonb, jsonb, text[])', 'execute'), false, 'A5: a stranger cannot save a connection');
select is(has_function_privilege('anon', 'public.crm_deliveries_claim(integer)', 'execute'), false, 'A6: nor claim deliveries');

-- B. an Owner saves a connection (second factor), members read per role, other workspaces read nothing
create temp table made as select gen_random_uuid() as id;
select is(pg_temp.sc('a_owner', 'aal1', format($q$select public.crm_connection_save(%L, %L, 'hubspot', '{"portal":"123"}', '{}', array['lead.created'])::text$q$, tests.tid('a'), (select id from made))) like 'ERR:%', true, 'B1: without a fresh second factor a save is refused');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.crm_connection_save(%L, %L, 'hubspot', '{"portal":"123"}', '{}', array['lead.created', 'call.completed']) ->> 'type')$q$, tests.tid('a'), (select id from made))), 'hubspot', 'B2: an Owner with a second factor saves one');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.crm_connection_save(%L, gen_random_uuid(), 'not_a_tool', '{}', '{}', array['lead.created'])::text$q$, tests.tid('a'))), 'ERR:22023', 'B3: an unknown tool is invalid input');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.crm_connection_save(%L, gen_random_uuid(), 'pipedrive', '{}', '{}', array['bogus.event'])::text$q$, tests.tid('a'))), 'ERR:22023', 'B4: an unknown event is invalid input');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select count(*)::text from public.crm_connections where tenant_id = %L$q$, tests.tid('a'))), '1', 'B5: the Owner reads it');
select is(pg_temp.sc('a_admin', 'aal2', format($q$select count(*)::text from public.crm_connections where tenant_id = %L$q$, tests.tid('a'))), '1', 'B6: so does an Admin');
select is(pg_temp.sc('a_sales', 'aal2', format($q$select count(*)::text from public.crm_connections where tenant_id = %L$q$, tests.tid('a'))), '0', 'B7: a member who is neither reads none');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select count(*)::text from public.crm_connections where tenant_id = %L$q$, tests.tid('a'))), '0', 'B8: another workspace''s Owner reads none');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select public.crm_connections_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B9: nor lists it');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select public.crm_connection_save(%L, gen_random_uuid(), 'notion', '{}', '{}', array['lead.created'])::text$q$, tests.tid('a'))), 'ERR:42501', 'B10: nor saves into it');
select is(pg_temp.sc('a_sales', 'aal2', format($q$select public.crm_connection_save(%L, gen_random_uuid(), 'notion', '{}', '{}', array['lead.created'])::text$q$, tests.tid('a'))), 'ERR:42501', 'B11: a plain member cannot save either');

-- C. no direct writes, even for the Owner
select is(pg_temp.sc('a_owner', 'aal2', format($q$insert into public.crm_connections (tenant_id, type, events, created_by) values (%L, 'kylas', array['lead.created'], %L)$q$, tests.tid('a'), tests.uid('a_owner'))) like 'ERR:%', true, 'C1: a direct insert is refused');
select is(pg_temp.sc('a_owner', 'aal2', format($q$update public.crm_connections set active = false where tenant_id = %L$q$, tests.tid('a'))) like 'ERR:%', true, 'C2: a direct update is refused');
select is(pg_temp.sc('a_owner', 'aal2', format($q$delete from public.crm_connections where tenant_id = %L$q$, tests.tid('a'))) like 'ERR:%', true, 'C3: a direct delete is refused');

-- D. the log of deliveries: the Owner and Admin of that workspace only; the worker's functions refuse members
insert into public.crm_deliveries (tenant_id, connection_id, event_id, event, subject_kind, subject_id, dedupe_key)
select tests.tid('a'), (select id from made), gen_random_uuid(), 'lead.created', 'lead', tests.rid('a_company'), 'lead.created:' || tests.rid('a_company')::text;
select is(pg_temp.sc('a_owner', 'aal2', format($q$select count(*)::text from public.crm_deliveries where tenant_id = %L$q$, tests.tid('a'))), '1', 'D1: the Owner reads the log');
select is(pg_temp.sc('a_sales', 'aal2', format($q$select count(*)::text from public.crm_deliveries where tenant_id = %L$q$, tests.tid('a'))), '0', 'D2: a plain member does not');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select count(*)::text from public.crm_deliveries where tenant_id = %L$q$, tests.tid('a'))), '0', 'D3: another workspace does not');
select is(pg_temp.sc('a_owner', 'aal2', 'select public.crm_deliveries_claim(10)::text') like 'ERR:%', true, 'D4: only the worker may claim due deliveries');
select is(pg_temp.sc('a_owner', 'aal2', 'select public.crm_purge()::text') like 'ERR:%', true, 'D5: only the worker may purge');
select * from finish();
rollback;
