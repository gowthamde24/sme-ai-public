-- T006 / M1 (ADR 0013): the kill switches at the three levels, cancel / finish, the per-tenant switch function, and the
-- operator-only function that the LOCAL dev seed uses to enable the selftest agent for the DEMO tenant.
--   A platform switch   B cancel (run level)   C finish    D the tenant switch function    E the operator function (c)
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(case when p_user is null then null else tests.uid(p_user) end, p_sql) $$;
create function pg_temp.start_sql(p_run uuid, p_tenant uuid, p_target uuid default null) returns text language sql as $$
  select format('select public.start_agent_run(%L, %L, ''selftest'', ''v1'', ''company'', %L, %L, ''{}''::jsonb)', p_run, p_tenant, coalesce(p_target, tests.rid('a_company')), repeat('a', 64)) $$;
create function pg_temp.ev_sql(p_run uuid, p_step text) returns text language sql as $$
  select format('select public.agent_write_evidence(%L, %L, ''note'', null, null, ''DEMO note'')', p_run, p_step) $$;
create function pg_temp.cl_sql(p_run uuid, p_step text) returns text language sql as $$
  select format('select public.agent_write_claim(%L, %L, ''selftest.observation'', ''DEMO'', %L::uuid[])', p_run, p_step, array[tests.rid('a_evidence')]) $$;
create function pg_temp.step_sql(p_run uuid, p_step text) returns text language sql as $$
  select format('select public.agent_record_step(%L, %L, ''read_target'', null)', p_run, p_step) $$;
create function pg_temp.use_sql(p_run uuid, p_step text) returns text language sql as $$
  select format('select public.agent_record_usage(%L, %L, 1, 1, 1)', p_run, p_step) $$;
create function pg_temp.cancel_sql(p_run uuid) returns text language sql as $$ select format('select public.cancel_agent_run(%L)', p_run) $$;
create function pg_temp.finish_sql(p_run uuid, p_status text, p_code text default null) returns text language sql as $$
  select format('select public.finish_agent_run(%L, %L::public.agent_run_status, %L::public.agent_error_code)', p_run, p_status, p_code) $$;
insert into public.evidence (id, tenant_id, kind, provider, url) values (tests.rid('a_evidence'), tests.tid('a'), 'web_page', 'manual', 'https://example.test/a');

-- ============================================================================ A. the platform switch (level 3) stops EVERY function that writes
update public.platform_flags set enabled = false where key = 'agents_enabled';
select is(pg_temp.err('a_sales', pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))), 'SM204|agents are disabled||||', 'start_agent_run: SM204');
select is(pg_temp.err('a_sales', pg_temp.ev_sql(tests.rid('a_run_sales'), 'k1')), 'SM204|agents are disabled||||', 'agent_write_evidence: SM204');
select is(pg_temp.err('a_sales', pg_temp.cl_sql(tests.rid('a_run_sales'), 'k2')), 'SM204|agents are disabled||||', 'agent_write_claim: SM204');
select is(pg_temp.err('a_sales', pg_temp.step_sql(tests.rid('a_run_sales'), 'k3')), 'SM204|agents are disabled||||', 'agent_record_step: SM204');
select is(pg_temp.err('a_sales', pg_temp.use_sql(tests.rid('a_run_sales'), 'k4')), 'SM204|agents are disabled||||', 'agent_record_usage: SM204');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.finish_sql(tests.rid('a_run_sales'), 'killed', 'killed')), 'rows:1', 'but a run can ALWAYS be finished (as killed): the switch never traps a run');
select is((select status::text || '/' || error_code::text from public.agent_runs where id = tests.rid('a_run_sales')), 'killed/killed', '...recorded as killed');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.cancel_sql(tests.rid('a_run_admin'))), 'rows:1', 'and cancelling stays possible (an Owner cancels a run started by an Admin)');
select is((select status::text from public.agent_runs where id = tests.rid('a_run_admin')), 'cancelled', '...and it is cancelled');
update public.platform_flags set enabled = true where key = 'agents_enabled';
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select public.set_tenant_agents_enabled(%L, false)$q$, tests.tid('a'))), 'rows:1', 'the tenant switch (level 2) can be turned off by an Owner at any time');
select is(pg_temp.err('a_sales', pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))), 'SM204|agents are disabled||||', '...and then nothing starts');
select is(tests.outcome_as(tests.uid('a_admin'), format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('a'))), 'rows:1', 'an Admin turns it on again');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s1'), tests.tid('a'))), 'rows:1', '...and runs start');

-- ============================================================================ B. cancel (level 1)
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('s1'), 'w1')), 'rows:1', 'sanity: the new run can write');
select is(pg_temp.err('a_viewer', pg_temp.cancel_sql(tests.rid('s1'))), '42501|agent action not permitted||||', 'a Viewer cannot cancel');
select is(pg_temp.err('outsider', pg_temp.cancel_sql(tests.rid('s1'))), '42501|agent action not permitted||||', 'an outsider: identical');
select is(pg_temp.err('b_owner', pg_temp.cancel_sql(tests.rid('s1'))), '42501|agent action not permitted||||', 'an Owner of ANOTHER tenant: identical');
select is(pg_temp.err('a_owner', pg_temp.cancel_sql(gen_random_uuid())), '42501|agent action not permitted||||', 'an unknown run: identical');
select is(pg_temp.err(null, pg_temp.cancel_sql(tests.rid('s1'))), '42501|permission denied for function cancel_agent_run||||', 'anon: no EXECUTE');
select count(pg_temp.err('a_owner', pg_temp.start_sql(tests.rid('s2'), tests.tid('a'))));
-- another Sales user of the tenant who did not start the run
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('a'), tests.uid('x1'), 'sales');
select is(pg_temp.err('x1', pg_temp.cancel_sql(tests.rid('s2'))), '42501|agent action not permitted||||', 'a Sales user who did NOT start the run cannot cancel it');
select is(tests.outcome_as(tests.uid('a_admin'), pg_temp.cancel_sql(tests.rid('s1'))), 'rows:1', 'an Admin can cancel a run someone else started');
select results_eq(format($$select status::text, error_code::text, cancel_requested_at is not null, cancelled_by, finished_at is not null from public.agent_runs where id = %L$$, tests.rid('s1')),
  format($$values ('cancelled'::text, 'cancelled'::text, true, %L::uuid, true)$$, tests.uid('a_admin')), 'the run is cancelled, with who and when');
select is(pg_temp.err('a_sales', pg_temp.ev_sql(tests.rid('s1'), 'w2')), 'SM201|agent run is not running||||', 'the starter''s next write: SM201');
select is(pg_temp.err('a_sales', pg_temp.step_sql(tests.rid('s1'), 'w3')), 'SM201|agent run is not running||||', '...and every other call: SM201');
select is(pg_temp.j(tests.scalar_as(tests.uid('a_admin'), pg_temp.cancel_sql(tests.rid('s1'))), 'replayed'), 'true', 'cancelling again is a no-op replay');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.cancel_sql(tests.rid('s2'))), 'rows:1', 'the starter can cancel their own run');
select is((select count(*) from public.audit_events where entity_type = 'agent_run' and entity_id = tests.rid('s1') and action = 'agent_run.update' and actor_user_id = tests.uid('a_admin')), 1::bigint, 'the cancellation is audited (actor = the canceller)');
-- a Sales user can cancel THEIR OWN run, a Viewer-started run cannot exist; a demoted starter loses the ability (they are no longer allowed to start)
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s3'), tests.tid('a')));
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.cancel_sql(tests.rid('s3'))), 'rows:1', 'a Sales starter cancels their own run');

-- ============================================================================ C. finish
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('f1'), tests.tid('a')));
select is(substr(pg_temp.err('a_sales', pg_temp.finish_sql(tests.rid('f1'), 'running')), 1, 5), '22023', 'finishing "as running" is meaningless: 22023');
select is(substr(pg_temp.err('a_sales', pg_temp.finish_sql(tests.rid('f1'), 'succeeded', 'budget')), 1, 5), '22023', 'a successful run carries no error code: 22023');
select is(substr(pg_temp.err('a_sales', pg_temp.finish_sql(tests.rid('f1'), 'cancelled')), 1, 5), '23514', '"cancelled" only follows a cancel request: 23514');
select is(substr(pg_temp.err('a_sales', pg_temp.finish_sql(tests.rid('f1'), 'expired')), 1, 5), '23514', '"expired" only once the run really expired: 23514');
select is(substr(pg_temp.err('a_sales', pg_temp.finish_sql(tests.rid('f1'), 'killed')), 1, 5), '23514', '"killed" only while a switch is actually off: 23514');
select is(pg_temp.err('a_owner', pg_temp.finish_sql(tests.rid('f1'), 'succeeded')), '42501|agent action not permitted||||', 'only the starter finishes a run (an Owner who did not start it is refused)');
select is(pg_temp.err('b_sales', pg_temp.finish_sql(tests.rid('f1'), 'succeeded')), '42501|agent action not permitted||||', 'a foreign user: identical');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.finish_sql(tests.rid('f1'), 'failed', 'model_failed')), 'rows:1', 'the starter finishes it as failed / model_failed');
select results_eq(format($$select status::text, error_code::text, finished_at is not null from public.agent_runs where id = %L$$, tests.rid('f1')), $$values ('failed'::text, 'model_failed'::text, true)$$, '...recorded');
select is(pg_temp.j(tests.scalar_as(tests.uid('a_sales'), pg_temp.finish_sql(tests.rid('f1'), 'failed', 'model_failed')), 'replayed'), 'true', 'finishing again with the same status is a replay');
select is(pg_temp.err('a_sales', pg_temp.finish_sql(tests.rid('f1'), 'succeeded')), 'SM201|agent run is not running||||', '...with a different status: SM201');
select is(pg_temp.err('a_sales', pg_temp.ev_sql(tests.rid('f1'), 'w1')), 'SM201|agent run is not running||||', 'a finished run does not write');
-- expiry can be recorded once it has happened
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('f2'), tests.tid('a')));
update public.agent_runs set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = tests.rid('f2');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.finish_sql(tests.rid('f2'), 'expired', 'expired')), 'rows:1', 'an expired run can be recorded as expired');
-- finishing never needs the starter to still hold a role or the switches to be on
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('f3'), tests.tid('a')));
update public.platform_flags set enabled = false where key = 'agents_enabled';
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.finish_sql(tests.rid('f3'), 'succeeded')), 'rows:1', 'with the platform switch OFF the starter can still finish');
update public.platform_flags set enabled = true where key = 'agents_enabled';

-- ============================================================================ D. public.set_tenant_agents_enabled
select ok((select prosecdef and 'search_path=""' = any (proconfig) and proowner::regrole::text = 'postgres' from pg_proc where proname = 'set_tenant_agents_enabled'), 'SECURITY DEFINER, empty search_path, owned by the migration role');
select is(pg_temp.err('a_sales', format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('a'))), '42501|agent action not permitted||||', 'Sales cannot flip the tenant switch');
select is(pg_temp.err('a_viewer', format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('a'))), '42501|agent action not permitted||||', 'Viewer: identical');
select is(pg_temp.err('outsider', format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('a'))), '42501|agent action not permitted||||', 'outsider: identical');
select is(pg_temp.err('b_owner', format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('a'))), '42501|agent action not permitted||||', 'an Owner of another tenant: identical');
select is(pg_temp.err('a_owner', format($q$select public.set_tenant_agents_enabled(%L, true)$q$, gen_random_uuid())), '42501|agent action not permitted||||', 'an unknown tenant: identical');
select is(pg_temp.err(null, format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('a'))), '42501|permission denied for function set_tenant_agents_enabled||||', 'anon: no EXECUTE');
select is(tests.outcome_as(tests.uid('b_owner'), format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('b'))), 'rows:1', 'tenant B''s Owner creates B''s row (first use)');
select results_eq(format($$select enabled, updated_by from public.tenant_agent_settings where tenant_id = %L$$, tests.tid('b')), format($$values (true, %L::uuid)$$, tests.uid('b_owner')), '...with who changed it');
select is((select count(*) from public.audit_events where entity_type = 'tenant_agent_settings' and tenant_id = tests.tid('b') and actor_user_id = tests.uid('b_owner')), 1::bigint, 'and it is audited');
select is(tests.outcome_as(tests.uid('b_owner'), format($q$select public.set_tenant_agents_enabled(%L, false)$q$, tests.tid('b'))), 'rows:1', 'and can be turned off again');
select is((select count(*) from public.tenant_agent_settings where tenant_id = tests.tid('b')), 1::bigint, 'one row per tenant');
select is(pg_temp.err('b_sales', pg_temp.start_sql(gen_random_uuid(), tests.tid('b'), tests.rid('b_company'))), 'SM204|agents are disabled||||', 'tenant B with agents off (and not on the selftest allow-list): SM204');
select is(tests.outcome_as(tests.uid('b_owner'), format($q$select public.set_tenant_agents_enabled(%L, true)$q$, tests.tid('b'))), 'rows:1', 'turned on again');
select is(pg_temp.err('b_sales', pg_temp.start_sql(gen_random_uuid(), tests.tid('b'), tests.rid('b_company'))), 'SM204|agents are disabled||||', '...but tenant B is still not on the selftest allow-list: the tenant switch alone is not enough (SM204)');

-- ============================================================================ E. the operator function (decision c): selftest is enabled for ONE named tenant, by the operator
update public.platform_flags set enabled = false;
update public.agent_definitions set allowed_tenants = '{}' where agent_name = 'selftest';
delete from public.tenant_agent_settings;
select ok(not has_function_privilege('authenticated', 'app.operator_enable_selftest(text)', 'execute'), 'authenticated cannot execute app.operator_enable_selftest');
select ok(not has_function_privilege('anon', 'app.operator_enable_selftest(text)', 'execute'), 'anon cannot');
select ok(not has_function_privilege('service_role', 'app.operator_enable_selftest(text)', 'execute'), 'neither can service_role');
select is(tests.outcome_as(tests.uid('a_owner'), $q$select app.operator_enable_selftest('tenant-a')$q$), '42501', 'an Owner calling it: permission denied (and app is not even a schema they can use)');
select is(pg_temp.err('a_sales', pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))), 'SM204|agents are disabled||||', 'before the operator acts: tenant A''s Sales cannot start a selftest run');
select lives_ok($q$select app.operator_enable_selftest('tenant-a')$q$, 'the operator enables selftest for the tenant with slug tenant-a');
select results_eq($$select key, enabled from public.platform_flags order by key$$, $$values ('agents_enabled'::text, true), ('research_enabled', false), ('selftest_enabled', true)$$, 'agents and selftest are now ON; research was not touched');
select results_eq($$select allowed_tenants from public.agent_definitions where agent_name = 'selftest'$$, format($$values (array[%L]::uuid[])$$, tests.tid('a')), 'the selftest allow-list holds exactly tenant A');
select results_eq($$select tenant_id, enabled from public.tenant_agent_settings$$, format($$values (%L::uuid, true)$$, tests.tid('a')), 'only tenant A has agents enabled');
select lives_ok($q$select app.operator_enable_selftest('tenant-a')$q$, 'it is idempotent');
select results_eq($$select cardinality(allowed_tenants) from public.agent_definitions where agent_name = 'selftest'$$, $$values (1)$$, '...the allow-list does not grow');
select throws_ok($q$select app.operator_enable_selftest('no-such-tenant')$q$, 'P0002', null, 'an unknown slug is an error (it never enables "everything")');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('op1'), tests.tid('a'))), 'rows:1', 'now tenant A''s Sales user can start a selftest run');
select is(pg_temp.err('b_sales', pg_temp.start_sql(gen_random_uuid(), tests.tid('b'), tests.rid('b_company'))), 'SM204|agents are disabled||||', 'and tenant B still cannot: the DEMO tenant ONLY');
select is((select count(*) from public.agent_definitions where allowed_tenants is null), 0::bigint, 'no agent definition was left open to every tenant');

select * from finish();
rollback;
