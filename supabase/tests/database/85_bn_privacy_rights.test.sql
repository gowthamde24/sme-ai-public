-- Job BN (ADR 0075): privacy rights. Download my data, delete my account / my workspace (cooling-off), retention, grievances (migrations 20261116090000 and 20261116090100).
--   A catalog          B data exports (roles, second factor, replay, one at a time, rate, link, audit, privacy)   C the worker's export clean-up
--   D deletion of an account   E deletion of a workspace (the existing erasure behind a cooling-off)   F retention   G grievances
-- THE CLOCK: app.outbox_now() is replaced for this transaction (default Monday 2026-10-05 14:00 IST); to run at another instant:
--   PGOPTIONS='-c tests.bn_pin=2026-10-05T23:30:00+05:30' psql ... < this file     (the cooling-off, the 24-hour link and the retention ages must hold at 14:00 and at 23:30)
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_assistant();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.base() returns timestamptz language sql as $$ select coalesce(nullif(current_setting('tests.bn_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz $$;
select pg_temp.pin(pg_temp.base());
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
-- the worker (registered below): every call as the principal
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('x6', p_sql) $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'privacy' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity), 6::bigint,
          'A: the six privacy tables have row-level security on and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'privacy' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint,
          'A: no client role holds any privilege on a privacy table');
select is((select count(*) from information_schema.schemata where schema_name = 'privacy' and (has_schema_privilege('anon', schema_name, 'usage') or has_schema_privilege('authenticated', schema_name, 'usage'))), 0::bigint,
          'A: no client role can even use the privacy schema');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('data_export_ensure_bucket', 'data_export_request', 'data_export_get', 'data_export_list', 'data_export_begin', 'data_export_finish', 'data_export_link', 'data_export_person_data',
                              'deletion_request', 'deletion_cancel', 'deletion_list', 'deletion_execute_workspace', 'retention_get', 'retention_set', 'retention_preview',
                              'grievance_submit', 'grievance_list', 'grievance_get', 'grievance_update', 'privacy_worker_execute_account_deletions', 'privacy_worker_expired_exports', 'privacy_worker_export_cleaned', 'privacy_worker_run_retention')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 23::bigint, 'A: all twenty-three are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~ '^(data_export|deletion|retention|grievance|privacy_worker)_'
            and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'A: anon can execute none of them');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'exports_objects_%'), 3::bigint, 'A: the export bucket has its three storage rules (read, add, remove)');
select is(app.retention_purging(), false, 'A: the retention door is shut by default');
select is(pg_temp.priv($$delete from public.audit_events$$), '42501', 'A: audit rows still cannot be deleted by anybody');
select is((select count(*) from pg_trigger where tgrelid in ('public.scheduler_runs'::regclass, 'public.visit_reminders'::regclass, 'public.audit_events'::regclass) and tgname like '%no_delete'), 3::bigint, 'A: the delete guards on scheduler and audit rows are still in place');
select is(app.export_bucket_owner('exp-' || tests.uid('a_owner')::text), tests.uid('a_owner'), 'A: the bucket name carries its owner');
select is(app.export_bucket_owner('cat-' || tests.tid('a')::text), null, 'A: a catalogue bucket is nobody''s export bucket');
select is(app.export_bucket_owner('exp-not-a-uuid'), null, 'A: a malformed name is nobody''s');

-- register the worker (x6 is unaffiliated in the fixture)
select is((select app.operator_register_scheduler('x6@test.local')), tests.uid('x6'), 'the worker account is registered');

-- ---------------------------------------------------------------------------------------------
-- B. data exports
-- ---------------------------------------------------------------------------------------------
create function pg_temp.xr(p_user text, p_id text, p_scope text, p_tenant text default null, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.data_export_request(%L, %L, %L)$q$, tests.rid(p_id), p_scope, case when p_tenant is null then null else tests.tid(p_tenant)::text end) , p_aal) $$;
-- a request with a null tenant needs a different spelling (the text above would send the string 'NULL')
create function pg_temp.xp(p_user text, p_id text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.data_export_request(%L, 'person', null)$q$, tests.rid(p_id)), p_aal) $$;
create function pg_temp.xw(p_user text, p_id text, p_tenant text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.data_export_request(%L, 'workspace', %L)$q$, tests.rid(p_id), tests.tid(p_tenant)), p_aal) $$;
create function pg_temp.xfin(p_user text, p_id text, p_ok boolean default true, p_sha text default null) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.data_export_finish(%L, %L, 1234, %L, %L)$q$, tests.rid(p_id), p_ok, coalesce(p_sha, pg_temp.h(p_id)), case when p_ok then null else 'storage' end)) $$;

select is(pg_temp.j(pg_temp.xp('a_sales', 'e1'), 'status'), 'queued', 'B: any member may ask for their own data (Sales): queued');
select is(pg_temp.j(pg_temp.xp('a_sales', 'e1'), 'id'), tests.rid('e1')::text, 'B: asking again with the same id is a replay (nothing new)');
select is((select count(*) from privacy.data_exports where user_id = tests.uid('a_sales')), 1::bigint, 'B: ...one row');
select is(pg_temp.xp('a_sales', 'e2'), 'ERR:SM613', 'B: a second export while one is open is refused (SM613)');
select is(pg_temp.xp('anon', 'e3'), 'ERR:42501', 'B: anon may not');
select is(pg_temp.sc('a_sales', format($q$select public.data_export_request(%L, 'workspace', %L)$q$, tests.rid('e4'), tests.tid('a'))), 'ERR:42501', 'B: Sales may not export the WORKSPACE (42501)');
select is(pg_temp.xw('a_admin', 'e4', 'a'), 'ERR:42501', 'B: an Admin may not either: the workspace export is the Owner''s');
select is(pg_temp.xw('a_owner', 'e4', 'a', 'aal1'), 'ERR:SM306', 'B: the Owner without a second factor is refused (SM306)');
select is(pg_temp.xw('b_owner', 'e4', 'a'), 'ERR:42501', 'B: another business''s Owner may not');
select is(pg_temp.sc('a_owner', format($q$select public.data_export_request(%L, 'person', %L)$q$, tests.rid('e4'), tests.tid('a'))), 'ERR:22023', 'B: a person export with a workspace is invalid');
select is(pg_temp.sc('a_owner', format($q$select public.data_export_request(%L, 'workspace', null)$q$, tests.rid('e4'))), 'ERR:22023', 'B: a workspace export without a workspace is invalid');
select is(pg_temp.sc('a_owner', format($q$select public.data_export_request(%L, 'galaxy', null)$q$, tests.rid('e4'))), 'ERR:22023', 'B: an unknown scope is invalid');
select is(pg_temp.j(pg_temp.xw('a_owner', 'e4', 'a'), 'scope'), 'workspace', 'B: the Owner with a second factor gets a workspace export');
select is(pg_temp.xp('a_owner', 'e4'), 'ERR:22023', 'B: the same id with another meaning is invalid (not a replay)');
-- begin / finish
select is(pg_temp.sc('a_owner', format($q$select public.data_export_begin(%L)$q$, tests.rid('e1'))), 'ERR:23503', 'B: nobody else can begin someone''s export (23503)');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.data_export_begin(%L)$q$, tests.rid('e1'))), 'status'), 'running', 'B: begin: running');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.data_export_begin(%L)$q$, tests.rid('e1'))), 'status'), 'running', 'B: ...beginning twice is harmless');
select is(pg_temp.sc('a_sales', format($q$select public.data_export_link(%L)$q$, tests.rid('e1'))), 'ERR:SM613', 'B: no link before it is ready (SM613)');
select is(pg_temp.xfin('a_sales', 'e1', true, 'xyz'), 'ERR:22023', 'B: a bad hash is invalid (22023)');
select is(pg_temp.j(pg_temp.xfin('a_sales', 'e1'), 'status'), 'ready', 'B: finish: ready');
select is((select expires_at from privacy.data_exports where id = tests.rid('e1')), pg_temp.base() + interval '24 hours', 'B: the file lasts 24 hours from now');
select is((select object_bucket || '/' || object_path from privacy.data_exports where id = tests.rid('e1')), 'exp-' || tests.uid('a_sales')::text || '/' || tests.rid('e1')::text || '.zip', 'B: the file sits in the person''s own bucket');
select is(pg_temp.xfin('a_sales', 'e1'), 'ERR:SM613', 'B: finishing twice is refused (SM613)');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.data_export_link(%L)$q$, tests.rid('e1'))), 'path'), tests.rid('e1')::text || '.zip', 'B: the link call gives the path to sign');
select is((select downloads from privacy.data_exports where id = tests.rid('e1')), 1, 'B: ...and counts the download');
select is(pg_temp.sc('a_admin', format($q$select public.data_export_get(%L)$q$, tests.rid('e1'))), 'ERR:23503', 'B: no one else can read the export row (23503)');
select is(pg_temp.sc('a_admin', format($q$select public.data_export_link(%L)$q$, tests.rid('e1'))), 'ERR:23503', 'B: ...or ask for its link');
select is(jsonb_array_length(pg_temp.sc('a_sales', 'select public.data_export_list()')::jsonb), 1, 'B: the list holds only my own');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'data_export.requested' and entity_id = tests.rid('e1')), 1::bigint, 'B: the request was audited in the person''s workspace');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('b') and entity_type = 'data_export'), 0::bigint, 'B: ...and in no other workspace');
select is((select count(*) from public.audit_events where action = 'data_export.downloaded' and entity_id = tests.rid('e1')), 1::bigint, 'B: the download was audited');
select is((select bool_and(new_values::text !~* '(@|\+91|phone|email|sha|zip)') from public.audit_events where entity_type = 'data_export'), true, 'B: the export audit events hold no personal data and no file name');
-- the workspace export is in the workspace's trail only
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'data_export.requested' and entity_id = tests.rid('e4')), 1::bigint, 'B: the workspace export is audited in that workspace');
-- failure and the rate
select is(pg_temp.j(pg_temp.xfin('a_owner', 'e4', false), 'status'), 'failed', 'B: a failed export says failed');
select is((select error_code from privacy.data_exports where id = tests.rid('e4')), 'storage', 'B: ...with its reason word');
select is(pg_temp.j(pg_temp.xp('a_owner', 'e5'), 'status'), 'queued', 'B: after a failure the Owner may ask again');
select is(pg_temp.j(pg_temp.xfin('a_owner', 'e5'), 'status'), 'ready', 'B: ...ready');
select is(pg_temp.j(pg_temp.xp('a_owner', 'e6'), 'status'), 'queued', 'B: another (3 in the day for the Owner)');
select is(pg_temp.j(pg_temp.xfin('a_owner', 'e6', false), 'status'), 'failed', '...failed');
select is(pg_temp.j(pg_temp.xp('a_owner', 'e7'), 'status'), 'queued', 'B: 4th');
select is(pg_temp.j(pg_temp.xfin('a_owner', 'e7', false), 'status'), 'failed', '...failed');
select is(pg_temp.j(pg_temp.xp('a_owner', 'e8'), 'status'), 'queued', 'B: 5th');
select is(pg_temp.j(pg_temp.xfin('a_owner', 'e8', false), 'status'), 'failed', '...failed');
select is(pg_temp.xp('a_owner', 'e9'), 'ERR:SM614', 'B: a sixth in 24 hours is refused (SM614)');
-- what the account itself holds about a person
select is(pg_temp.j(pg_temp.sc('a_owner', 'select public.data_export_person_data()'), 'account')::jsonb ->> 'email', 'a_owner@test.local', 'B: the person data holds the person''s own account');
select is(jsonb_array_length((pg_temp.sc('a_owner', 'select public.data_export_person_data()')::jsonb) -> 'my_assistant_chat') >= 2, true, 'B: ...their own chat');
select is((select count(*) from jsonb_array_elements((pg_temp.sc('a_owner', 'select public.data_export_person_data()')::jsonb) -> 'my_assistant_chat') e where e ->> 'workspace_id' <> tests.tid('a')::text), 0::bigint,
          'B: ...only from their own workspace');
select is(pg_temp.sc('a_sales', 'select public.data_export_person_data()')::text !~ 'a_owner', true, 'B: another member''s data does not appear in mine');
select is(pg_temp.sc('anon', 'select public.data_export_person_data()'), 'ERR:42501', 'B: anon gets nothing');

-- ---------------------------------------------------------------------------------------------
-- C. the worker's clean-up of expired files
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.sch('select public.privacy_worker_expired_exports()'), '[]', 'C: nothing is expired yet');
select is(pg_temp.sc('a_owner', 'select public.privacy_worker_expired_exports()'), 'ERR:42501', 'C: an Owner is not the worker (42501)');
select is(app.worker_may_delete_export('exp-' || tests.uid('a_sales')::text, tests.rid('e1')::text || '.zip'), false, 'C: before it expires the worker may not delete the file (storage rule)');
-- the file itself, in Storage: the person sees their own, the worker sees it only once it has expired, nobody else ever
insert into storage.buckets (id, name, public) values ('exp-' || tests.uid('a_sales')::text, 'exp-' || tests.uid('a_sales')::text, false);
insert into storage.objects (bucket_id, name, owner_id) values ('exp-' || tests.uid('a_sales')::text, tests.rid('e1')::text || '.zip', tests.uid('a_sales')::text);
create function pg_temp.seen(p_user text) returns text language sql as $$ select tests.scalar_as(tests.uid(p_user), 'select count(*) from storage.objects where bucket_id like ''exp-%''') $$;
select is(pg_temp.seen('a_sales'), '1', 'C: the person sees their own export file in Storage');
select is(pg_temp.seen('a_owner'), '0', 'C: another member sees none of it');
select is(pg_temp.seen('x6'), '0', 'C: the worker does not see an export that has not expired');
select pg_temp.pin(pg_temp.base() + interval '24 hours 1 minute');
select is(pg_temp.seen('x6'), '1', 'C: once it has expired the worker sees it (Storage looks an object up before deleting it)');
select is(pg_temp.seen('a_owner'), '0', 'C: ...and still no other member does');
select is(jsonb_array_length(pg_temp.sch('select public.privacy_worker_expired_exports()')::jsonb), 2, 'C: 24 hours later the two ready files are listed (e1 and e5)');
select is((pg_temp.sch('select public.privacy_worker_expired_exports()')::jsonb -> 0 ->> 'bucket') like 'exp-%', true, 'C: ...with their bucket and path');
select is(tests.scalar_as(tests.uid('x6'), format($q$select app.worker_may_delete_export(%L, %L)$q$, 'exp-' || tests.uid('a_sales')::text, tests.rid('e1')::text || '.zip')), 'true', 'C: now the worker may delete the file (storage rule)');
select is(tests.scalar_as(tests.uid('a_owner'), format($q$select app.worker_may_delete_export(%L, %L)$q$, 'exp-' || tests.uid('a_sales')::text, tests.rid('e1')::text || '.zip')), 'false', 'C: ...nobody else may');
select is(pg_temp.sc('a_sales', format($q$select public.data_export_link(%L)$q$, tests.rid('e1'))), 'ERR:SM613', 'C: an expired export gives no link (SM613)');
select is(pg_temp.sc('a_owner', format($q$select public.privacy_worker_export_cleaned(%L)$q$, tests.rid('e1'))), 'ERR:42501', 'C: an Owner cannot mark a file as removed (42501)');
select is((select cleaned_at is null from privacy.data_exports where id = tests.rid('e1')), true, 'C: ...and nothing was marked');
select is(pg_temp.sch(format($q$select public.privacy_worker_export_cleaned(%L)$q$, tests.rid('e1'))), '', 'C: the worker marks the file as removed');
select is((select status from privacy.data_exports where id = tests.rid('e1')), 'expired', 'C: ...the export says expired');
select is(jsonb_array_length(pg_temp.sch('select public.privacy_worker_expired_exports()')::jsonb), 1, 'C: one left (e5)');
select pg_temp.pin(pg_temp.base());

-- ---------------------------------------------------------------------------------------------
-- D. deleting an ACCOUNT
-- ---------------------------------------------------------------------------------------------
create function pg_temp.da(p_user text, p_id text, p_confirm text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.deletion_request(%L, 'account', null, %L)$q$, tests.rid(p_id), p_confirm), p_aal) $$;
select is(pg_temp.da('a_sales', 'd1', 'wrong@test.local'), 'ERR:SM615', 'D: the e-mail typed must be the account''s own (SM615)');
select is(pg_temp.da('b_owner', 'd1', 'b_owner@test.local'), 'ERR:SM611', 'D: the only Owner of a workspace cannot delete the account (SM611)');
select is(pg_temp.da('b_owner', 'd1', 'b_owner@test.local', 'aal1'), 'ERR:SM306', 'D: an Owner needs the second factor first (SM306)');
select is(pg_temp.da('anon', 'd1', 'x@test.local'), 'ERR:42501', 'D: anon may not');
select is(pg_temp.j(pg_temp.da('a_sales', 'd1', 'A_Sales@Test.Local ', 'aal1'), 'status'), 'scheduled', 'D: a Sales member (no second factor needed) schedules it; the e-mail is matched without case');
select is((select execute_after from privacy.deletion_requests where id = tests.rid('d1')), pg_temp.base() + interval '14 days', 'D: ...for 14 days from now');
select is(pg_temp.j(pg_temp.da('a_sales', 'd1', 'a_sales@test.local', 'aal1'), 'id'), tests.rid('d1')::text, 'D: asking again with the same id is a replay');
select is(pg_temp.da('a_sales', 'd2', 'a_sales@test.local', 'aal1'), 'ERR:SM613', 'D: a second open request is refused (SM613)');
select is(jsonb_array_length(pg_temp.sc('a_sales', 'select public.deletion_list()')::jsonb), 1, 'D: the person lists their own requests');
select is(jsonb_array_length(pg_temp.sc('a_admin', 'select public.deletion_list()')::jsonb), 0, 'D: ...and nobody else''s');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'deletion.requested' and entity_id = tests.rid('d1')), 1::bigint, 'D: audited in the workspace');
select is(pg_temp.sc('a_admin', format($q$select public.deletion_cancel(%L)$q$, tests.rid('d1'))), 'ERR:23503', 'D: nobody else can cancel it (23503)');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.deletion_cancel(%L)$q$, tests.rid('d1')), 'aal1'), 'status'), 'cancelled', 'D: the person cancels during the cooling-off');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.deletion_cancel(%L)$q$, tests.rid('d1')), 'aal1'), 'status'), 'cancelled', 'D: ...cancelling twice is harmless');
select is(pg_temp.j(pg_temp.da('a_sales', 'd3', 'a_sales@test.local', 'aal1'), 'status'), 'scheduled', 'D: after a cancellation a new request may be made');
-- the worker: nothing is due, then 14 days later it is
select is(pg_temp.sch('select public.privacy_worker_execute_account_deletions()'), '{"blocked": 0, "executed": 0}', 'D: the worker finds nothing due in the cooling-off');
select is(pg_temp.sc('a_owner', 'select public.privacy_worker_execute_account_deletions()'), 'ERR:42501', 'D: an Owner is not the worker (42501)');
-- a second person asks, then becomes the only Owner of a new workspace before the day comes
select is(pg_temp.j(pg_temp.da('a_viewer', 'd4', 'a_viewer@test.local', 'aal1'), 'status'), 'scheduled', 'D: a Viewer schedules');
insert into public.tenants (id, name, slug) values (tests.tid('z2'), 'Z Two', 'z-two');
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('z2'), tests.uid('a_viewer'), 'owner');
-- a grievance of the person who will go
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.grievance_submit(%L, %L, 'complaint', 'Wrong number on file', 'details')$q$, tests.rid('g0'), tests.tid('a')), 'aal1'), 'status'), 'received', 'D: (a grievance by the person who will delete their account)');
select pg_temp.pin(pg_temp.base() + interval '14 days 1 minute');
select is(pg_temp.sch('select public.privacy_worker_execute_account_deletions()'), '{"blocked": 1, "executed": 1}', 'D: after 14 days: one account deleted, one blocked (it became the only Owner of a workspace)');
select is((select count(*) from auth.users where id = tests.uid('a_sales')), 0::bigint, 'D: the account is gone');
select is((select count(*) from public.users where id = tests.uid('a_sales')), 0::bigint, 'D: ...and the profile');
select is((select count(*) from public.memberships where user_id = tests.uid('a_sales')), 0::bigint, 'D: ...and the memberships');
select is((select count(*) from auth.users where id = tests.uid('a_viewer')), 1::bigint, 'D: the blocked one is untouched');
select is((select status || '/' || blocked_reason from privacy.deletion_requests where id = tests.rid('d4')), 'blocked/sole_owner', 'D: ...and says why');
select is((select status from privacy.deletion_requests where id = tests.rid('d3')), 'executed', 'D: the deleted one says executed');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'account.deleted' and entity_id = tests.uid('a_sales')), 1::bigint, 'D: the deletion is in the workspace trail');
select is((select count(*) from privacy.grievances where id = tests.rid('g0') and submitted_by is null), 1::bigint, 'D: what the person wrote stays with the workspace, without their id');
select is(pg_temp.sch('select public.privacy_worker_execute_account_deletions()'), '{"blocked": 0, "executed": 0}', 'D: running again changes nothing');
select pg_temp.pin(pg_temp.base());

-- ---------------------------------------------------------------------------------------------
-- E. deleting a WORKSPACE
-- ---------------------------------------------------------------------------------------------
insert into public.tenants (id, name, slug) values (tests.tid('z'), 'Zed Silks', 'zed-silks');
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('z'), tests.uid('x3'), 'owner'), (tests.tid('z'), tests.uid('x4'), 'admin'), (tests.tid('z'), tests.uid('x5'), 'sales');
create function pg_temp.dw(p_user text, p_id text, p_confirm text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.deletion_request(%L, 'workspace', %L, %L)$q$, tests.rid(p_id), tests.tid('z'), p_confirm), p_aal) $$;
select is(pg_temp.dw('x4', 'w1', 'Zed Silks'), 'ERR:42501', 'E: an Admin may not delete the workspace');
select is(pg_temp.dw('x5', 'w1', 'Zed Silks'), 'ERR:42501', 'E: Sales may not');
select is(pg_temp.dw('b_owner', 'w1', 'Zed Silks'), 'ERR:42501', 'E: another business''s Owner may not');
select is(pg_temp.dw('x3', 'w1', 'Zed Silks', 'aal1'), 'ERR:SM306', 'E: the Owner needs the second factor (SM306)');
select is(pg_temp.dw('x3', 'w1', 'zed'), 'ERR:SM615', 'E: the Owner must type the workspace name (SM615)');
select is(pg_temp.j(pg_temp.dw('x3', 'w1', ' Zed Silks '), 'status'), 'scheduled', 'E: the Owner schedules it');
select is((select execute_after from privacy.deletion_requests where id = tests.rid('w1')), pg_temp.base() + interval '14 days', 'E: ...in 14 days');
select is((select status from public.erasure_requests where id = tests.rid('w1')), 'pending', 'E: the existing erasure request (tenant scope) was made with the same id');
select is(pg_temp.dw('x3', 'w2', 'Zed Silks'), 'ERR:SM613', 'E: one open deletion per workspace (SM613)');
select is(jsonb_array_length(pg_temp.sc('x4', format($q$select public.deletion_list(%L)$q$, tests.tid('z')))::jsonb), 1, 'E: an Admin can see that a deletion is scheduled');
select is(pg_temp.sc('x5', format($q$select public.deletion_list(%L)$q$, tests.tid('z'))), 'ERR:42501', 'E: Sales cannot');
select is(pg_temp.sc('x3', format($q$select public.deletion_execute_workspace(%L)$q$, tests.rid('w1'))), 'ERR:SM612', 'E: before the cooling-off ends: refused (SM612)');
select is(pg_temp.sc('x4', format($q$select public.deletion_execute_workspace(%L)$q$, tests.rid('w1'))), 'ERR:42501', 'E: an Admin cannot run it');
-- a grievance in the workspace, to see it erased
select is(pg_temp.j(pg_temp.sc('x5', format($q$select public.grievance_submit(%L, %L, 'access', 'Please send my data', 'Name: Priya, phone 9876543210', true, 'Priya', '9876543210')$q$, tests.rid('g1'), tests.tid('z')), 'aal1'), 'status'), 'received', 'E: (a grievance in the workspace)');
select is(pg_temp.j(pg_temp.sc('x3', format($q$select public.deletion_cancel(%L)$q$, tests.rid('w1'))), 'status'), 'cancelled', 'E: cancelling stops the whole thing');
select is((select status from public.erasure_requests where id = tests.rid('w1')), 'cancelled', 'E: ...including the erasure request');
select is(pg_temp.sc('x3', format($q$select public.deletion_execute_workspace(%L)$q$, tests.rid('w1'))), 'ERR:SM613', 'E: a cancelled deletion cannot be run (SM613)');
select is(pg_temp.j(pg_temp.dw('x3', 'w3', 'Zed Silks'), 'status'), 'scheduled', 'E: a new one after a cancellation');
select pg_temp.pin(pg_temp.base() + interval '14 days 1 minute');
-- the existing erasure keeps its own 24-hour wait on the real clock: the test backdates it (a privileged fixture write)
update public.erasure_requests set execute_after = now() - interval '1 minute' where id = tests.rid('w3');
select is(jsonb_typeof(pg_temp.sc('x3', format($q$select public.deletion_execute_workspace(%L)$q$, tests.rid('w3'))) :: jsonb -> 'erasure'), 'object', 'E: after 14 days the Owner (second factor) runs it: the existing erasure answers');
select is((select status from public.erasure_requests where id = tests.rid('w3')), 'executed', 'E: the erasure request is executed');
select is((select status from privacy.deletion_requests where id = tests.rid('w3')), 'executed', 'E: the deletion says executed');
select is((select subject || '|' || details || '|' || coalesce(requester_name, 'null') || '|' || coalesce(requester_contact, 'null') from privacy.grievances where id = tests.rid('g1')), 'erased:1||null|null', 'E: what people wrote in the workspace''s grievances is erased with it');
select is((select status from privacy.grievances where id = tests.rid('g1')), 'received', 'E: ...the rows, dates and statuses stay');
select is(pg_temp.sc('x3', format($q$select public.deletion_execute_workspace(%L)$q$, tests.rid('w3'))), 'ERR:SM613', 'E: running it again is refused (SM613)');
select pg_temp.pin(pg_temp.base());

-- ---------------------------------------------------------------------------------------------
-- F. retention
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.j(pg_temp.sc('a_admin', format($q$select public.retention_get(%L)$q$, tests.tid('a'))), 'chats_days'), null, 'F: with nothing set, everything is kept');
select is(pg_temp.sc('a_sales', format($q$select public.retention_get(%L)$q$, tests.tid('a'))), 'ERR:42501', 'F: Sales cannot read the setting');
select is(pg_temp.sc('a_admin', format($q$select public.retention_set(%L, '{"chats_days": 90}')$q$, tests.tid('a'))), 'ERR:42501', 'F: an Admin cannot change it');
select is(pg_temp.sc('a_owner', format($q$select public.retention_set(%L, '{"chats_days": 90}')$q$, tests.tid('a')), 'aal1'), 'ERR:SM306', 'F: the Owner needs the second factor (SM306)');
select is(pg_temp.sc('b_owner', format($q$select public.retention_set(%L, '{"chats_days": 90}')$q$, tests.tid('a'))), 'ERR:42501', 'F: another business''s Owner cannot');
select is(pg_temp.sc('a_owner', format($q$select public.retention_set(%L, '{"chats_days": 5}')$q$, tests.tid('a'))), 'ERR:22023', 'F: chats under 30 days are refused (22023)');
select is(pg_temp.sc('a_owner', format($q$select public.retention_set(%L, '{"audit_days": 100}')$q$, tests.tid('a'))), 'ERR:22023', 'F: audit under a year is refused');
select is(pg_temp.sc('a_owner', format($q$select public.retention_set(%L, '{"chats_days": 60, "voice_days": 90}')$q$, tests.tid('a'))), 'ERR:22023', 'F: voice may not be kept longer than chats');
select is(pg_temp.sc('a_owner', format($q$select public.retention_set(%L, '{"nope": 90}')$q$, tests.tid('a'))), 'ERR:22023', 'F: an unknown key is refused');
select is(pg_temp.sc('a_owner', format($q$select public.retention_set(%L, '{"chats_days": "90"}')$q$, tests.tid('a'))), 'ERR:22023', 'F: a text is not a number');
select is(pg_temp.sc('a_owner', format($q$select public.retention_set(%L, '{"chats_days": 90.5}')$q$, tests.tid('a'))), 'ERR:22023', 'F: nor a fraction');
-- old rows (dated from the pinned clock)
insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, created_by, run_id, created_at) values
  (tests.rid('f_old_chat'), tests.tid('a'), tests.rid('a_conv'), 10, 'user', 'old typed question', tests.uid('a_owner'), tests.rid('a_arun'), pg_temp.base() - interval '120 days'),
  (tests.rid('f_old_reply'), tests.tid('a'), tests.rid('a_conv'), 11, 'assistant', 'old answer', tests.uid('a_owner'), tests.rid('a_arun'), pg_temp.base() - interval '120 days'),
  (tests.rid('f_new_chat'), tests.tid('a'), tests.rid('a_conv'), 12, 'user', 'recent question', tests.uid('a_owner'), tests.rid('a_arun'), pg_temp.base() - interval '10 days'),
  (tests.rid('f_b_chat'), tests.tid('b'), tests.rid('b_conv'), 10, 'user', 'other business old question', tests.uid('b_owner'), tests.rid('b_arun'), pg_temp.base() - interval '120 days');
-- a voice transcript: a user message whose run carries a voice-stt reservation (50 days old: older than the voice age, younger than the chat age)
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, conversation_id, expires_at, input_sha256)
values (tests.rid('f_vrun'), tests.tid('a'), tests.uid('a_owner'), 'assistant', 'assistant-1', tests.rid('a_conv'), now() + interval '15 minutes', repeat('7', 64));
insert into public.agent_cost_reservations (id, tenant_id, run_id, step_key, cost_day, model, input_micros_per_mtok, output_micros_per_mtok, max_input_tokens, max_output_tokens, reserved_micros, args_sha256)
values (tests.rid('f_vres'), tests.tid('a'), tests.rid('f_vrun'), 'stt', current_date, 'voice-stt', 1000000000, 1000000000, 100, 0, 10, repeat('6', 64));
insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, created_by, run_id, created_at) values
  (tests.rid('f_voice'), tests.tid('a'), tests.rid('a_conv'), 13, 'user', 'spoken words', tests.uid('a_owner'), tests.rid('f_vrun'), pg_temp.base() - interval '50 days');
update public.assistant_reply_drafts set created_at = pg_temp.base() - interval '120 days' where id = tests.rid('a_reply_draft');
-- an old enquiry, scheduler rows and audit rows
alter table public.enquiries disable trigger user;
update public.enquiries set received_at = pg_temp.base() - interval '200 days', created_at = pg_temp.base() - interval '200 days' where id = tests.rid('a_enquiry');
alter table public.enquiries enable trigger user;
insert into public.scheduler_runs (id, tenant_id, run_at) values (tests.rid('f_run_old'), tests.tid('a'), pg_temp.base() - interval '100 days'), (tests.rid('f_run_new'), tests.tid('a'), pg_temp.base() - interval '5 days');
alter table public.audit_events disable trigger user;
insert into public.audit_events (tenant_id, actor_type, action, entity_type, entity_id, created_at) values
  (tests.tid('a'), 'system', 'test.old', 'thing', tests.rid('f_aud_old'), pg_temp.base() - interval '800 days'),
  (tests.tid('a'), 'system', 'test.new', 'thing', tests.rid('f_aud_new'), pg_temp.base() - interval '100 days'),
  (tests.tid('b'), 'system', 'test.old', 'thing', tests.rid('f_aud_b'), pg_temp.base() - interval '800 days');
alter table public.audit_events enable trigger user;
-- no setting yet: the clean-up purges nothing
select is(pg_temp.sch('select public.privacy_worker_run_retention()'), '{"workspaces": 0}', 'F: no setting, no clean-up');
select is((select count(*) from public.assistant_messages where body = 'erased:1'), 0::bigint, 'F: ...nothing was touched');
-- the preview shows what a setting WOULD do, without changing anything
select is(pg_temp.sc('a_admin', format($q$select public.retention_preview(%L, '{"chats_days": 90, "voice_days": 30, "enquiries_days": 180, "scheduler_days": 60, "audit_days": 730}')$q$, tests.tid('a')))::jsonb,
          '{"enquiries": 1, "reply_drafts": 1, "audit_events": 1, "chat_messages": 2, "scheduler_runs": 1, "visit_reminders": 0, "voice_transcripts": 1}'::jsonb, 'F: the preview counts what is old enough (and does not count the other business)');
select is(pg_temp.sc('a_sales', format($q$select public.retention_preview(%L)$q$, tests.tid('a'))), 'ERR:42501', 'F: Sales cannot preview');
select is(pg_temp.sc('a_admin', format($q$select public.retention_preview(%L, '{"chats_days": 3}')$q$, tests.tid('a'))), 'ERR:22023', 'F: a preview of an invalid setting is invalid');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.retention_set(%L, '{"chats_days": 90, "voice_days": 30, "enquiries_days": 180, "scheduler_days": 60, "audit_days": 730}')$q$, tests.tid('a'))), 'voice_days'), '30', 'F: the Owner (second factor) sets it');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'retention.set'), 1::bigint, 'F: ...audited');
select is(pg_temp.sch('select public.privacy_worker_run_retention()'), '{"workspaces": 1}', 'F: the worker cleans one workspace');
select is((select body from public.assistant_messages where id = tests.rid('f_old_chat')), 'erased:1', 'F: an old question is replaced by the erasure tombstone');
select is((select body from public.assistant_messages where id = tests.rid('f_old_reply')), 'erased:1', 'F: ...and an old answer');
select is((select body from public.assistant_messages where id = tests.rid('f_new_chat')), 'recent question', 'F: a recent one is kept');
select is((select body from public.assistant_messages where id = tests.rid('f_voice')), 'erased:1', 'F: the 50-day-old voice transcript is gone (voice age 30)');
select is((select body from public.assistant_messages where id = tests.rid('f_b_chat')), 'other business old question', 'F: the other business is untouched');
select is((select body || '|' || gloss_en from public.assistant_reply_drafts where id = tests.rid('a_reply_draft')), 'erased:1|erased:1', 'F: old reply drafts are erased too');
select is((select body || '|' || coalesce(subject, '-') from public.enquiries where id = tests.rid('a_enquiry')), 'erased:1|-', 'F: the old enquiry text is erased (its hash and dates stay)');
select is((select count(*) from public.scheduler_runs where id in (tests.rid('f_run_old'), tests.rid('f_run_new'))), 1::bigint, 'F: the old scheduler row is deleted, the new one kept');
select is((select count(*) from public.audit_events where entity_id in (tests.rid('f_aud_old'), tests.rid('f_aud_new'), tests.rid('f_aud_b'))), 2::bigint, 'F: the 800-day-old audit row of this business is deleted; the newer one and the other business''s stay');
select is((select count(*) from public.audit_events where entity_id = tests.rid('f_aud_b')), 1::bigint, 'F: ...the other business''s audit row is untouched');
select is((select counts ->> 'audit_events' from privacy.retention_runs where tenant_id = tests.tid('a')), '1', 'F: the run is recorded, with counts');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'retention.run'), 1::bigint, 'F: ...and in the audit trail');
select is(app.retention_purging(), false, 'F: the door is shut again after the clean-up');
select is(coalesce(current_setting('app.retention_tenant', true), ''), '', 'F: ...both settings are cleared');
select is(pg_temp.priv($$delete from public.audit_events$$), '42501', 'F: audit rows still cannot be deleted by anybody');
select is(pg_temp.priv($$delete from public.scheduler_runs$$), '42501', 'F: scheduler rows still cannot be deleted by anybody');
select is(pg_temp.sch('select public.privacy_worker_run_retention()'), '{"workspaces": 0}', 'F: an hour has not passed: not run again');
select pg_temp.pin(pg_temp.base() + interval '61 minutes');
select is(pg_temp.sch('select public.privacy_worker_run_retention()'), '{"workspaces": 1}', 'F: an hour later it runs again (and finds nothing new)');
select is((select counts ->> 'audit_events' from privacy.retention_runs where tenant_id = tests.tid('a') order by ran_at desc limit 1), '0', 'F: ...counts of zero');
select is(pg_temp.sc('a_owner', 'select public.privacy_worker_run_retention()'), 'ERR:42501', 'F: an Owner is not the worker (42501)');
select pg_temp.pin(pg_temp.base());

-- ---------------------------------------------------------------------------------------------
-- G. grievances
-- ---------------------------------------------------------------------------------------------
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('a'), tests.uid('x2'), 'sales');
create function pg_temp.gs(p_user text, p_id text, p_kind text default 'access', p_subject text default 'Please send my data', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.grievance_submit(%L, %L, %L, %L, 'details here')$q$, tests.rid(p_id), tests.tid(p_tenant), p_kind, p_subject), 'aal1') $$;
create function pg_temp.gu(p_user text, p_id text, p_status text, p_note text default null) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.grievance_update(%L, %L, %L)$q$, tests.rid(p_id), p_status, p_note), 'aal1') $$;
select is(pg_temp.j(pg_temp.gs('a_owner2', 'g2'), 'status'), 'received', 'G: any member may submit (Owner): received');
select is((select due_at - received_at from privacy.grievances where id = tests.rid('g2')), interval '30 days', 'G: due in 30 days');
select is(pg_temp.j(pg_temp.gs('a_owner2', 'g2'), 'id'), tests.rid('g2')::text, 'G: submitting with the same id is a replay');
select is((select count(*) from privacy.grievances where submitted_by = tests.uid('a_owner2')), 1::bigint, 'G: ...one row');
select is(pg_temp.gs('a_viewer', 'g3'), 'ERR:42501', 'G: a Viewer cannot submit');
select is(pg_temp.gs('anon', 'g3'), 'ERR:42501', 'G: anon cannot');
select is(pg_temp.gs('b_owner', 'g3', 'access', 'x', 'a'), 'ERR:42501', 'G: another business''s Owner cannot submit to this one');
select is(pg_temp.gs('a_owner2', 'g3', 'rumour'), 'ERR:22023', 'G: an unknown kind is invalid');
select is(pg_temp.gs('a_owner2', 'g3', 'access', '   '), 'ERR:22023', 'G: an empty subject is invalid');
select is(pg_temp.j(pg_temp.gs('x2', 'g4', 'erasure', 'Delete my details'), 'kind'), 'erasure', 'G: Sales submits too');
select is(jsonb_array_length(pg_temp.sc('x2', format($q$select public.grievance_list(%L)$q$, tests.tid('a')), 'aal1')::jsonb), 1, 'G: Sales sees only their own');
select is(jsonb_array_length(pg_temp.sc('a_admin', format($q$select public.grievance_list(%L)$q$, tests.tid('a')), 'aal1')::jsonb), 3, 'G: an Admin sees all of the workspace (g0, g2, g4)');
select is(jsonb_array_length(pg_temp.sc('b_owner', format($q$select public.grievance_list(%L)$q$, tests.tid('b')), 'aal1')::jsonb), 0, 'G: the other business sees none of them');
select is(pg_temp.sc('b_owner', format($q$select public.grievance_list(%L)$q$, tests.tid('a')), 'aal1'), 'ERR:42501', 'G: ...and cannot list ours');
select is(pg_temp.sc('x2', format($q$select public.grievance_get(%L)$q$, tests.rid('g2')), 'aal1'), 'ERR:23503', 'G: Sales cannot read another member''s grievance');
select is(pg_temp.j(pg_temp.sc('a_admin', format($q$select public.grievance_get(%L)$q$, tests.rid('g2')), 'aal1'), 'id'), tests.rid('g2')::text, 'G: an Admin can');
select is(pg_temp.sc('b_owner', format($q$select public.grievance_get(%L)$q$, tests.rid('g2')), 'aal1'), 'ERR:23503', 'G: another business cannot');
select is(pg_temp.gu('x2', 'g4', 'acknowledged'), 'ERR:42501', 'G: Sales cannot work a grievance');
select is(pg_temp.gu('b_owner', 'g4', 'acknowledged'), 'ERR:42501', 'G: another business cannot');
select is(pg_temp.j(pg_temp.gu('a_admin', 'g4', 'acknowledged'), 'status'), 'acknowledged', 'G: an Admin acknowledges');
select is((select acknowledged_at is not null from privacy.grievances where id = tests.rid('g4')), true, 'G: ...and the time is kept');
select is(pg_temp.gu('a_admin', 'g4', 'resolved'), 'ERR:22023', 'G: closing needs a note (22023)');
select is(pg_temp.gu('a_admin', 'g4', 'banana'), 'ERR:22023', 'G: an unknown status is invalid');
select is(pg_temp.j(pg_temp.gu('a_admin', 'g4', 'in_progress', 'working on it'), 'status'), 'in_progress', 'G: in progress');
select is(pg_temp.gu('a_admin', 'g4', 'acknowledged'), 'ERR:SM613', 'G: going back is refused (SM613)');
select is(pg_temp.j(pg_temp.gu('a_admin', 'g4', 'resolved', 'Deleted on request'), 'status'), 'resolved', 'G: resolved with a note');
select is((select closed_at is not null from privacy.grievances where id = tests.rid('g4')), true, 'G: ...closed time kept');
select is(pg_temp.gu('a_admin', 'g4', 'rejected', 'no'), 'ERR:SM613', 'G: a closed grievance stays closed (SM613)');
select is(jsonb_array_length(pg_temp.sc('a_admin', format($q$select public.grievance_get(%L)$q$, tests.rid('g4')), 'aal1')::jsonb -> 'events'), 4, 'G: the trail holds each step (received, acknowledged, in progress, resolved)');
select is(jsonb_array_length(pg_temp.sc('a_admin', format($q$select public.grievance_list(%L, 'open')$q$, tests.tid('a')), 'aal1')::jsonb), 2, 'G: "open" leaves out the closed one');
select is(pg_temp.sc('a_admin', format($q$select public.grievance_list(%L, 'nonsense')$q$, tests.tid('a')), 'aal1'), 'ERR:22023', 'G: an unknown filter is invalid');
select pg_temp.pin(pg_temp.base() + interval '31 days');
select is((pg_temp.sc('a_admin', format($q$select public.grievance_get(%L)$q$, tests.rid('g2')), 'aal1')::jsonb ->> 'overdue')::boolean, true, 'G: after 30 days an open grievance says overdue');
select is((pg_temp.sc('a_admin', format($q$select public.grievance_get(%L)$q$, tests.rid('g4')), 'aal1')::jsonb ->> 'overdue')::boolean, false, 'G: a closed one never does');
select pg_temp.pin(pg_temp.base());
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'grievance.submitted'), 3::bigint, 'G: every submission was audited');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'grievance.updated'), 3::bigint, 'G: every change was audited');
select is((select bool_and(new_values::text !~* '(details|@|phone|Delete my)') from public.audit_events where action like 'grievance.%'), true, 'G: the audit events carry words about the kind only, not what people wrote');
-- the rate: ten a day
insert into privacy.grievances (id, tenant_id, submitted_by, kind, subject, received_at, due_at)
select tests.rid('g_rate_' || i), tests.tid('a'), tests.uid('a_owner'), 'other', 'x', pg_temp.base(), pg_temp.base() + interval '30 days' from generate_series(1, 10) i;
select is(pg_temp.gs('a_owner', 'g_rate_x'), 'ERR:SM614', 'G: the eleventh in a day is refused (SM614)');

select * from finish();
rollback;
