-- T006 / M1 (ADR 0013): agent_write_evidence, agent_write_claim, agent_record_step, agent_record_usage.
-- The write path of a delegated run. Every check here is a test of a boundary that row level security does NOT provide
-- (these are SECURITY DEFINER functions).
--   A properties and signatures      B the run is resolved from the run id: one generic refusal, no oracle
--   C state of the run (SM201-SM204) D the starter's role is checked LIVE
--   E payload rules                  F provenance is forced (GUC or not)
--   G idempotency                    H budgets and the daily cap       I tool calls and usage
--   J scope (target, tenant)         K source audit
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

create function pg_temp.ev_sql(p_run uuid, p_step text, p_snippet text default 'DEMO agent note', p_kind text default 'note',
                               p_url text default null, p_reference text default null) returns text
language sql as $$
  select format('select public.agent_write_evidence(%L, %L, %L::public.evidence_kind, %L, %L, %L)', p_run, p_step, p_kind, p_url, p_reference, p_snippet)
$$;
create function pg_temp.cl_sql(p_run uuid, p_step text, p_evidence uuid[], p_predicate text default 'selftest.observation',
                               p_value text default 'DEMO observation', p_stance text default 'supports') returns text
language sql as $$
  select format('select public.agent_write_claim(%L, %L, %L, %L, %L::uuid[], %L::public.evidence_stance)', p_run, p_step, p_predicate, p_value, p_evidence, p_stance)
$$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
-- a fresh running run owned by p_user against the base company (or lead) of tenant A; budgets: 10 writes
create function pg_temp.newrun(p_name text, p_user text default 'a_sales', p_kind text default 'company') returns uuid
language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, lead_id, expires_at, input_sha256)
  values (tests.rid(p_name), tests.tid('a'), tests.uid(p_user), 'selftest', 'v1',
          case when p_kind = 'company' then tests.rid('a_company') end, case when p_kind = 'lead' then tests.rid('a_lead') end,
          now() + interval '15 minutes', repeat('1', 64));
  return tests.rid(p_name);
end $$;
-- the tuple of a sales user's call
create function pg_temp.as_sales(p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid('a_sales'), p_sql) $$;
create function pg_temp.out_sales(p_sql text) returns text language sql as $$ select tests.outcome_as(tests.uid('a_sales'), p_sql) $$;
-- everything the run has written, as one comparable string
create function pg_temp.snapshot(p_tenant text default 'a') returns text language sql as $$
  select concat_ws('/', (select count(*) from public.evidence where tenant_id = tests.tid(p_tenant)),
                        (select count(*) from public.evidence_links where tenant_id = tests.tid(p_tenant)),
                        (select count(*) from public.claims where tenant_id = tests.tid(p_tenant)),
                        (select count(*) from public.agent_run_steps where tenant_id = tests.tid(p_tenant)))
$$;

-- ============================================================================ A. properties and signatures
create temp table fns as select p.oid, p.proname, p.proargnames, p.prosrc, p.prosecdef, p.proconfig, p.proowner::regrole::text as owner
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('agent_write_evidence', 'agent_write_claim', 'agent_record_step', 'agent_record_usage');
select is((select count(*) from fns), 4::bigint, 'one overload each of the four functions');
select is((select count(*) from fns where prosecdef and 'search_path=""' = any (proconfig) and owner = 'postgres'), 4::bigint, 'all SECURITY DEFINER, empty search_path, owned by the migration role');
select is((select count(*) from fns where has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')), 4::bigint, 'authenticated may execute, anon may not');
-- THE SIGNATURE SCAN: nothing the caller passes can name provenance, identity, confidence or a tenant
select is(
  (select coalesce(string_agg(f.proname || '.' || a, ', '), '') from fns f, unnest(f.proargnames) a
    where a ~* '(created_via|created_by|agent_run_id|confidence|tenant|actor|origin|provider|user)'),
  '', 'no parameter of any write function can carry created_via, created_by, agent_run_id, confidence, a tenant, an actor, an origin or a provider');
select is(
  (select coalesce(string_agg(f.proname, ', '), '') from fns f where f.proargnames[1] <> 'p_run_id'), '', 'the first parameter of each is the run id (the tenant is derived from the run)');
select is((select count(*) from fns where prosrc ~* '\mexecute\M'), 0::bigint, 'no dynamic SQL in any of them');

-- ============================================================================ B. the run is resolved from the run id; refusals are identical
create temp table first_ev as select tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('a_run_sales'), 'b-ok')) as r;
select is(pg_temp.j((select r from first_ev), 'replayed'), 'false', 'sanity: the starter can write to their own running run');

create function pg_temp.refusals(p_sqlfn text) returns text[]
language plpgsql as $$
declare
  v_unknown text; v_foreign text; v_other_user text; v_outsider text; v_viewer text;
begin
  -- p_sqlfn is 'ev' or 'cl'; each variant is built for a given run id
  v_unknown    := tests.error_full_as(tests.uid('a_sales'),  case p_sqlfn when 'ev' then pg_temp.ev_sql(gen_random_uuid(), 'x') else pg_temp.cl_sql(gen_random_uuid(), 'x', array[gen_random_uuid()]) end);
  v_foreign    := tests.error_full_as(tests.uid('a_sales'),  case p_sqlfn when 'ev' then pg_temp.ev_sql(tests.rid('b_run'), 'x') else pg_temp.cl_sql(tests.rid('b_run'), 'x', array[gen_random_uuid()]) end);
  v_other_user := tests.error_full_as(tests.uid('a_sales'),  case p_sqlfn when 'ev' then pg_temp.ev_sql(tests.rid('a_run_admin'), 'x') else pg_temp.cl_sql(tests.rid('a_run_admin'), 'x', array[gen_random_uuid()]) end);
  v_outsider   := tests.error_full_as(tests.uid('outsider'), case p_sqlfn when 'ev' then pg_temp.ev_sql(tests.rid('a_run_sales'), 'x') else pg_temp.cl_sql(tests.rid('a_run_sales'), 'x', array[gen_random_uuid()]) end);
  v_viewer     := tests.error_full_as(tests.uid('a_viewer'), case p_sqlfn when 'ev' then pg_temp.ev_sql(tests.rid('a_run_sales'), 'x') else pg_temp.cl_sql(tests.rid('a_run_sales'), 'x', array[gen_random_uuid()]) end);
  return array[v_unknown, v_foreign, v_other_user, v_outsider, v_viewer];
end $$;
create temp table ref_ev as select pg_temp.refusals('ev') as r;
create temp table ref_cl as select pg_temp.refusals('cl') as r;
select is((select r[1] from ref_ev), '42501|agent action not permitted||||', 'agent_write_evidence, unknown run: 42501 with a fixed message');
select is((select r[2] from ref_ev), (select r[1] from ref_ev), '...a run of ANOTHER tenant: identical');
select is((select r[3] from ref_ev), (select r[1] from ref_ev), '...a run started by ANOTHER user of the same tenant: identical');
select is((select r[4] from ref_ev), (select r[1] from ref_ev), '...an outsider holding a real run id: identical');
select is((select r[5] from ref_ev), (select r[1] from ref_ev), '...a Viewer holding a real run id: identical');
select is((select r[1] from ref_cl), '42501|agent action not permitted||||', 'agent_write_claim, unknown run: 42501 with a fixed message');
select is((select r[2] from ref_cl), (select r[1] from ref_cl), '...a run of ANOTHER tenant: identical');
select is((select r[3] from ref_cl), (select r[1] from ref_cl), '...a run started by ANOTHER user: identical');
select is((select r[4] from ref_cl), (select r[1] from ref_cl), '...an outsider: identical');
select is((select r[5] from ref_cl), (select r[1] from ref_cl), '...a Viewer: identical');
select is(tests.error_full_as(null, pg_temp.ev_sql(tests.rid('a_run_sales'), 'x')), '42501|permission denied for function agent_write_evidence||||', 'anon: no EXECUTE');
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.ev_sql(null, 'x')), '42501|agent action not permitted||||', 'a NULL run id looks like an unknown run');
select is(pg_temp.snapshot(), '1/1/0/1', 'none of the refusals wrote anything (only the sanity write exists)');
-- the same for the two bookkeeping functions
select is(tests.error_full_as(tests.uid('a_sales'), format($q$select public.agent_record_step(%L, 'x', 'read_target', null)$q$, tests.rid('a_run_admin'))), '42501|agent action not permitted||||', 'agent_record_step: another user''s run: identical');
select is(tests.error_full_as(tests.uid('a_sales'), format($q$select public.agent_record_usage(%L, 'x', 1, 1, 1)$q$, tests.rid('b_run'))), '42501|agent action not permitted||||', 'agent_record_usage: another tenant''s run: identical');

-- ============================================================================ C. the state of the run (SM201 .. SM204), only for its own starter
select pg_temp.newrun('c_cancelled');
update public.agent_runs set status = 'cancelled', cancel_requested_at = now(), cancelled_by = tests.uid('a_sales'), finished_at = now(), error_code = 'cancelled' where id = tests.rid('c_cancelled');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_cancelled'), 'x')), 'SM201|agent run is not running||||', 'a cancelled run: SM201');
select pg_temp.newrun('c_done');
update public.agent_runs set status = 'succeeded', finished_at = now() where id = tests.rid('c_done');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_done'), 'x')), 'SM201|agent run is not running||||', 'a finished run: SM201');
select pg_temp.newrun('c_cancelreq');
update public.agent_runs set cancel_requested_at = now(), cancelled_by = tests.uid('a_owner') where id = tests.rid('c_cancelreq');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_cancelreq'), 'x')), 'SM201|agent run is not running||||', 'a run with a pending cancel request: SM201');
select pg_temp.newrun('c_expired');
update public.agent_runs set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = tests.rid('c_expired');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_expired'), 'x')), 'SM202|agent run has expired||||', 'a run past its expiry (status still running): SM202');
select pg_temp.newrun('c_budget');
update public.agent_runs set writes_used = max_writes where id = tests.rid('c_budget');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_budget'), 'x')), 'SM203|agent run budget exhausted||||', 'writes used = max: SM203');
select pg_temp.newrun('c_switch');
update public.tenant_agent_settings set enabled = false where tenant_id = tests.tid('a');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_switch'), 'x')), 'SM204|agents are disabled||||', 'tenant switch turned OFF mid-run: SM204');
update public.tenant_agent_settings set enabled = true where tenant_id = tests.tid('a');
update public.platform_flags set enabled = false where key = 'agents_enabled';
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_switch'), 'x')), 'SM204|agents are disabled||||', 'platform switch OFF: SM204');
update public.platform_flags set enabled = true where key = 'agents_enabled';
update public.platform_flags set enabled = false where key = 'selftest_enabled';
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_switch'), 'x')), 'SM204|agents are disabled||||', 'the selftest flag OFF: SM204');
update public.platform_flags set enabled = true where key = 'selftest_enabled';
update public.agent_definitions set allowed_tenants = '{}' where agent_name = 'selftest';
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('c_switch'), 'x')), 'SM204|agents are disabled||||', 'the tenant removed from the agent''s allow-list: SM204');
update public.agent_definitions set allowed_tenants = array[tests.tid('a')] where agent_name = 'selftest';
select is(pg_temp.snapshot(), '1/1/0/1', 'no state error wrote anything');
-- the same state errors apply to the bookkeeping functions
select is(tests.error_full_as(tests.uid('a_sales'), format($q$select public.agent_record_step(%L, 'x', 'read_target', null)$q$, tests.rid('c_cancelled'))), 'SM201|agent run is not running||||', 'agent_record_step on a cancelled run: SM201');
select is(tests.error_full_as(tests.uid('a_sales'), format($q$select public.agent_record_usage(%L, 'x', 1, 1, 1)$q$, tests.rid('c_expired'))), 'SM202|agent run has expired||||', 'agent_record_usage on an expired run: SM202');

-- ============================================================================ D. the starter's role is checked LIVE
select pg_temp.newrun('d_demoted');
delete from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('a_sales');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('d_demoted'), 'x')), (select r[1] from ref_ev), 'the starter was REMOVED from the tenant: the identical generic refusal');
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('a'), tests.uid('a_sales'), 'viewer');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('d_demoted'), 'x')), (select r[1] from ref_ev), 'the starter was DEMOTED to Viewer: the identical generic refusal');
select is(pg_temp.as_sales(format($q$select public.agent_record_step(%L, 'x', 'read_target', null)$q$, tests.rid('d_demoted'))), (select r[1] from ref_ev), '...also for agent_record_step');
update public.memberships set role = 'sales' where tenant_id = tests.tid('a') and user_id = tests.uid('a_sales');
select is(pg_temp.out_sales(pg_temp.ev_sql(tests.rid('d_demoted'), 'x')), 'rows:1', 'and with the role back, the run writes again');
-- a different run, of a user who is an Owner, keeps working while Sales roles change
select pg_temp.newrun('d_owner', 'a_owner');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.ev_sql(tests.rid('d_owner'), 'x')), 'rows:1', 'an Owner-started run works');
select is(pg_temp.snapshot(), '3/3/0/3', 'sanity: three evidence rows exist now');

-- ============================================================================ E. payload rules
select pg_temp.newrun('e_run');
create function pg_temp.ev_e(p_step text, p_snippet text default 'DEMO agent note', p_kind text default 'note', p_url text default null, p_ref text default null) returns text
language sql as $$ select pg_temp.as_sales(pg_temp.ev_sql(tests.rid('e_run'), p_step, p_snippet, p_kind, p_url, p_ref)) $$;
select is(substr(pg_temp.ev_e('e-zw', 'a' || chr(8203) || 'b'), 1, 5), '23514', 'a zero-width space in the snippet: 23514');
select is(substr(pg_temp.ev_e('e-bidi', 'a' || chr(8238) || 'b'), 1, 5), '23514', 'a bidi override: 23514');
select is(substr(pg_temp.ev_e('e-tag', 'a' || chr(917536) || 'b'), 1, 5), '23514', 'a tag character: 23514');
select is(substr(pg_temp.ev_e('e-big', repeat('x', 1001)), 1, 5), '23514', 'a snippet over 1000 characters: 23514');
select is(substr(pg_temp.ev_e('e-js', 'x', 'note', 'javascript:alert(1)'), 1, 5), '23514', 'a javascript: URL: 23514');
select is(substr(pg_temp.ev_e('e-ref', 'x', 'note', null, 'Not A Reference'), 1, 5), '23514', 'a malformed reference: 23514');
select is(substr(pg_temp.ev_e('e-import', 'x', 'import_batch'), 1, 5), '23514', 'the import_batch kind cannot be written by an agent: 23514 (it is not on the definition''s list)');
select is(pg_temp.snapshot(), '3/3/0/3', 'none of those wrote anything (the whole call rolled back, the step ledger included)');
select is(pg_temp.j(tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('e_run'), 'e-default-ref', 'x', 'note')), 'replayed'), 'false', 'with neither URL nor reference the call succeeds');
select is((select reference from public.evidence where agent_run_id = tests.rid('e_run')), 'run:' || tests.rid('e_run'), '...and the evidence gets reference run:<run id>');
select count(pg_temp.ev_e('e-url', 'x', 'note', 'https://example.test/agent-found'));
select is((select url from public.evidence where agent_run_id = tests.rid('e_run') and url is not null), 'https://example.test/agent-found', 'a valid https URL is kept (never fetched)');

-- claims: predicates, stances, evidence ids
insert into public.evidence (id, tenant_id, kind, provider, url) values
  (tests.rid('a_evidence'), tests.tid('a'), 'web_page', 'manual', 'https://example.test/a-manual'),
  (tests.rid('b_evidence'), tests.tid('b'), 'web_page', 'manual', 'https://example.test/b-manual');
create temp table e_ev as select (pg_temp.j(tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('e_run'), 'e-ev1')), 'evidence_id'))::uuid as id;
create function pg_temp.cl_e(p_step text, p_ev uuid[], p_predicate text default 'selftest.observation', p_value text default 'DEMO observation', p_stance text default 'supports') returns text
language sql as $$ select pg_temp.as_sales(pg_temp.cl_sql(tests.rid('e_run'), p_step, p_ev, p_predicate, p_value, p_stance)) $$;
select is(pg_temp.cl_e('e-pred', array[(select id from e_ev)], 'exports_to'), '23514|value not allowed||||', 'a predicate outside the agent''s allow-list: 23514 with a fixed message');
select is(pg_temp.cl_e('e-pred2', array[(select id from e_ev)], 'selftest.other'), '23514|value not allowed||||', 'a predicate that merely looks similar: 23514');
update public.agent_definitions set allowed_stances = array['supports']::public.evidence_stance[] where agent_name = 'selftest';
select is(pg_temp.cl_e('e-stance', array[(select id from e_ev)], p_stance => 'contradicts'), '23514|value not allowed||||', 'a stance the agent may not use: 23514');
update public.agent_definitions set allowed_stances = array['supports', 'context', 'contradicts']::public.evidence_stance[] where agent_name = 'selftest';
select is(substr(pg_temp.cl_e('e-zwv', array[(select id from e_ev)], p_value => 'a' || chr(8203) || 'b'), 1, 5), '23514', 'a zero-width space in the value: 23514');
select is(substr(pg_temp.cl_e('e-bigv', array[(select id from e_ev)], p_value => repeat('v', 501)), 1, 5), '23514', 'a value over 500 characters: 23514');
select is(pg_temp.cl_e('e-noev', array[]::uuid[]), '22023|invalid argument||||', 'a claim with no evidence: 22023');
select is(pg_temp.cl_e('e-nullev', null), '22023|invalid argument||||', 'NULL evidence ids: 22023');
select is(pg_temp.cl_e('e-many', (select array_agg(gen_random_uuid()) from generate_series(1, 6))), '22023|invalid argument||||', 'more than 5 evidence ids: 22023');
select is(pg_temp.cl_e('e-missing', array[gen_random_uuid()]), '23503|invalid reference||||', 'an evidence id that does not exist: 23503');
-- evidence from a DIFFERENT run (same tenant, same user) and from another tenant fail exactly like a missing id
select pg_temp.newrun('e_other');
create temp table other_ev as select (pg_temp.j(tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('e_other'), 'o1')), 'evidence_id'))::uuid as id;
select is(pg_temp.cl_e('e-otherrun', array[(select id from other_ev)]), '23503|invalid reference||||', 'evidence written by ANOTHER run of the same user: identical 23503');
select is(pg_temp.cl_e('e-manual', array[tests.rid('a_evidence')]), '23503|invalid reference||||', 'a manual evidence row of the tenant: identical 23503');
select is(pg_temp.cl_e('e-foreign', array[tests.rid('b_evidence')]), '23503|invalid reference||||', 'tenant B''s evidence row: identical 23503');
select is(pg_temp.cl_e('e-mixed', array[(select id from e_ev), tests.rid('b_evidence')]), '23503|invalid reference||||', 'one bad id among good ones refuses the whole claim');
select is((select count(*) from public.claims where agent_run_id = tests.rid('e_run')), 0::bigint, 'none of those created a claim');

-- ============================================================================ F. provenance is forced
select pg_temp.newrun('f_run');
create function pg_temp.with_guc(p_via text, p_run text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('app.created_via', p_via, true);
  perform set_config('app.agent_run_id', p_run, true);
  v := tests.scalar_as(tests.uid('a_sales'), p_sql);
  return v;
end $$;
create temp table f1 as select pg_temp.with_guc('manual', tests.rid('a_run_admin')::text, pg_temp.ev_sql(tests.rid('f_run'), 'f1')) as r;
create temp table f2 as select pg_temp.with_guc('import', '', pg_temp.ev_sql(tests.rid('f_run'), 'f2')) as r;
create temp table f3 as select pg_temp.with_guc('', '', pg_temp.ev_sql(tests.rid('f_run'), 'f3')) as r;
select is((select count(*) from public.evidence where agent_run_id = tests.rid('f_run') and created_via = 'agent' and created_by = tests.uid('a_sales') and provider = 'agent.selftest'), 3::bigint,
  'whatever the GUCs held beforehand (manual + another user''s run, import, empty): created_via = agent, created_by = the starter, provider = agent.selftest, THIS run');
select is((select count(*) from public.evidence where id in (select (r::jsonb ->> 'evidence_id')::uuid from (select r from f1 union all select r from f2 union all select r from f3) x) and agent_run_id <> tests.rid('f_run')), 0::bigint,
  'a pre-set app.agent_run_id naming another run had no effect');
select is(current_setting('app.created_via', true) || '|' || current_setting('app.agent_run_id', true), '|', 'the function leaves both GUCs cleared');
select is((select count(*) from public.evidence_links l join public.evidence e on e.tenant_id = l.tenant_id and e.id = l.evidence_id
            where e.agent_run_id = tests.rid('f_run') and l.created_via = 'agent' and l.agent_run_id = tests.rid('f_run') and l.company_id = tests.rid('a_company') and l.lead_id is null and l.claim_id is null and l.stance is null), 3::bigint,
  'each evidence row is linked to the RUN''S target (the company), as an agent link of this run');
create temp table f_claim as select tests.scalar_as(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('f_run'), 'fc', array[(select (r::jsonb ->> 'evidence_id')::uuid from f1)], 'selftest.observation', 'DEMO value', 'context')) as r;
select results_eq(format($$select predicate, value, confidence::text, created_via::text, created_by, agent_run_id, company_id, lead_id is null, archived_at is null from public.claims where id = %L$$, (select (r::jsonb ->> 'claim_id')::uuid from f_claim)),
  format($$values ('selftest.observation'::text, 'DEMO value'::text, 'unverified'::text, 'agent'::text, %L::uuid, %L::uuid, %L::uuid, true, true)$$, tests.uid('a_sales'), tests.rid('f_run'), tests.rid('a_company')),
  'the claim: confidence UNVERIFIED (no parameter can change it), origin agent, created_by the starter, this run, about the run''s target');
select results_eq(format($$select l.stance::text, l.created_via::text, l.agent_run_id, l.company_id is null, l.lead_id is null from public.evidence_links l where l.claim_id = %L$$, (select (r::jsonb ->> 'claim_id')::uuid from f_claim)),
  format($$values ('context'::text, 'agent'::text, %L::uuid, true, true)$$, tests.rid('f_run')), 'and its link: the stance given, agent origin, this run');
-- a lead target
select pg_temp.newrun('f_lead', 'a_sales', 'lead');
create temp table fl as select tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('f_lead'), 'l1')) as r;
select is((select count(*) from public.evidence_links where evidence_id = (select (r::jsonb ->> 'evidence_id')::uuid from fl) and lead_id = tests.rid('a_lead') and company_id is null), 1::bigint, 'a run on a LEAD links its evidence to that lead');
create temp table flc as select tests.scalar_as(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('f_lead'), 'lc', array[(select (r::jsonb ->> 'evidence_id')::uuid from fl)])) as r;
select is((select count(*) from public.claims where id = (select (r::jsonb ->> 'claim_id')::uuid from flc) and lead_id is null and source_lead_id = tests.rid('a_lead') and company_id = tests.rid('a_company')), 1::bigint, '...and its claim is stored on the lead''s COMPANY (T007: the claim home), the lead kept as source_lead_id');

-- ============================================================================ G. idempotency
select pg_temp.newrun('g_run');
create temp table g1 as select tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('g_run'), 'g1')) as r;
create temp table before_g as select pg_temp.snapshot() as s, (select writes_used from public.agent_runs where id = tests.rid('g_run')) as w;
create temp table g1b as select tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('g_run'), 'g1')) as r;
select is(pg_temp.j((select r from g1b), 'replayed'), 'true', 'the same step key with the same arguments is a replay');
select is(pg_temp.j((select r from g1b), 'evidence_id'), pg_temp.j((select r from g1), 'evidence_id'), '...returning the SAME ids');
select is(pg_temp.snapshot(), (select s from before_g), 'a replay writes nothing');
select is((select writes_used from public.agent_runs where id = tests.rid('g_run')), (select w from before_g), 'and costs no budget');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('g_run'), 'g1', 'a different snippet')), 'SM205|agent step key reused with different arguments||||', 'the same key with DIFFERENT arguments: SM205');
select is(pg_temp.as_sales(pg_temp.cl_sql(tests.rid('g_run'), 'g1', array[(pg_temp.j((select r from g1), 'evidence_id'))::uuid])), 'SM205|agent step key reused with different arguments||||', 'the same key used by a DIFFERENT tool: SM205');
select is(pg_temp.snapshot(), (select s from before_g), 'a conflict writes nothing');
select is((select count(*) from public.agent_run_steps where run_id = tests.rid('g_run') and step_key = 'g1'), 1::bigint, 'one ledger row per key');
select results_eq(format($$select kind::text, tool_name, status::text, args_sha256 ~ '^[0-9a-f]{64}$', result_ref ?& array['evidence_id', 'link_id'], started_by from public.agent_run_steps where run_id = %L and step_key = 'g1'$$, tests.rid('g_run')),
  format($$values ('write'::text, 'agent_write_evidence'::text, 'ok'::text, true, true, %L::uuid)$$, tests.uid('a_sales')), 'the ledger row: a write by agent_write_evidence, ok, a hash, the ids, the starter');
select pg_temp.newrun('g_other');
select is(pg_temp.out_sales(pg_temp.ev_sql(tests.rid('g_other'), 'g1')), 'rows:1', 'the same step key in ANOTHER run is a different step');
select isnt(pg_temp.j(tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('g_other'), 'g1')), 'evidence_id'), pg_temp.j((select r from g1), 'evidence_id'), '...with different ids');
create temp table g_cl as select tests.scalar_as(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('g_run'), 'gc', array[(pg_temp.j((select r from g1), 'evidence_id'))::uuid])) as r;
create temp table before_gc as select pg_temp.snapshot() as s;
create temp table g_cl2 as select tests.scalar_as(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('g_run'), 'gc', array[(pg_temp.j((select r from g1), 'evidence_id'))::uuid])) as r;
select is(pg_temp.j((select r from g_cl2), 'claim_id') || pg_temp.j((select r from g_cl2), 'replayed'), pg_temp.j((select r from g_cl), 'claim_id') || 'true', 'a claim replays too: same id, replayed');
select is(pg_temp.snapshot(), (select s from before_gc), '...writing nothing');
select is(pg_temp.as_sales(pg_temp.cl_sql(tests.rid('g_run'), 'gc', array[(pg_temp.j((select r from g1), 'evidence_id'))::uuid], p_value => 'DEMO other')), 'SM205|agent step key reused with different arguments||||', 'a claim with the same key and another value: SM205');

-- ============================================================================ H. budgets and the daily cap
select pg_temp.newrun('h_run');
update public.agent_runs set max_writes = 2 where id = tests.rid('h_run');
create temp table h1 as select tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('h_run'), 'h1')) as r;
select tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('h_run'), 'h2'));
select is((select writes_used from public.agent_runs where id = tests.rid('h_run')), 2, 'two writes used');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('h_run'), 'h3')), 'SM203|agent run budget exhausted||||', 'the third: SM203');
select is((select count(*) from public.evidence where agent_run_id = tests.rid('h_run')), 2::bigint, '...and it wrote no row');
select is(pg_temp.j(tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('h_run'), 'h1')), 'replayed'), 'true', 'a REPLAY of an earlier step still works with the budget spent');
select is(pg_temp.as_sales(pg_temp.cl_sql(tests.rid('h_run'), 'hc', array[(pg_temp.j((select r from h1), 'evidence_id'))::uuid])), 'SM203|agent run budget exhausted||||', 'a claim is a write too: SM203');
select is((select count(*) from public.agent_run_steps where run_id = tests.rid('h_run')), 2::bigint, 'refusals leave no ledger row');
-- the per-tenant daily cap comes from agent_limits
select pg_temp.newrun('h_day1'); select pg_temp.newrun('h_day2');
update public.agent_limits set limit_value = (select count(*) + 1 from public.agent_run_steps where tenant_id = tests.tid('a') and kind = 'write' and created_at > now() - interval '1 day')::int where limit_key = 'max_writes_per_day';
select is(pg_temp.out_sales(pg_temp.ev_sql(tests.rid('h_day1'), 'd1')), 'rows:1', 'one write fits under the daily cap');
select is(pg_temp.as_sales(pg_temp.ev_sql(tests.rid('h_day2'), 'd2')), 'SM206|agent limit reached||||', 'the next, in ANOTHER run of the same tenant: SM206 (the cap is per tenant)');
update public.agent_limits set limit_value = 500 where limit_key = 'max_writes_per_day';
select is(pg_temp.out_sales(pg_temp.ev_sql(tests.rid('h_day2'), 'd2')), 'rows:1', 'with the cap back at 500 it writes');

-- ============================================================================ I. tool calls and usage
select pg_temp.newrun('i_run');
update public.agent_runs set max_tool_calls = 2, max_input_tokens = 100, max_output_tokens = 50, max_cost_micros = 1000 where id = tests.rid('i_run');
create function pg_temp.step_sql(p_run uuid, p_key text, p_tool text default 'read_target', p_hash text default null, p_status text default 'ok', p_ref text default null) returns text language sql as $$
  select format('select public.agent_record_step(%L, %L, %L, %L, %L::public.agent_step_status, %L::jsonb)', p_run, p_key, p_tool, p_hash, p_status, p_ref) $$;
select is(pg_temp.out_sales(pg_temp.step_sql(tests.rid('i_run'), 'i1', p_hash => repeat('a', 64))), 'rows:1', 'a tool call is recorded');
select is((select tool_calls_used from public.agent_runs where id = tests.rid('i_run')), 1, '...and counted');
select is(pg_temp.j(tests.scalar_as(tests.uid('a_sales'), pg_temp.step_sql(tests.rid('i_run'), 'i1', p_hash => repeat('a', 64))), 'replayed'), 'true', 'a replay of the same call');
select is((select tool_calls_used from public.agent_runs where id = tests.rid('i_run')), 1, '...is not counted again');
select is(pg_temp.as_sales(pg_temp.step_sql(tests.rid('i_run'), 'i1', p_hash => repeat('b', 64))), 'SM205|agent step key reused with different arguments||||', 'the same key with another argument hash: SM205');
select is(pg_temp.out_sales(pg_temp.step_sql(tests.rid('i_run'), 'i2', 'search_notes', p_status => 'refused')), 'rows:1', 'a refused tool call is recorded (status refused)');
select is(pg_temp.as_sales(pg_temp.step_sql(tests.rid('i_run'), 'i3')), 'SM203|agent run budget exhausted||||', 'the third tool call: SM203');
select pg_temp.newrun('i_bad');
select is(substr(pg_temp.as_sales(pg_temp.step_sql(tests.rid('i_bad'), 'i4', 'Bad Tool')), 1, 5), '23514', 'a tool name must be a slug: 23514');
select is(substr(pg_temp.as_sales(pg_temp.step_sql(tests.rid('i_bad'), 'i5', p_ref => '{"snippet": "free text"}')), 1, 5), '23514', 'a result_ref with free text: 23514');
select pg_temp.newrun('i_use');
update public.agent_runs set max_input_tokens = 100, max_output_tokens = 50, max_cost_micros = 1000 where id = tests.rid('i_use');
create function pg_temp.use_sql(p_run uuid, p_key text, p_in integer, p_out integer, p_cost bigint) returns text language sql as $$
  select format('select public.agent_record_usage(%L, %L, %s, %s, %s)', p_run, p_key, p_in, p_out, p_cost) $$;
create function pg_temp.resv(p_run uuid, p_key text, p_micros bigint) returns void language sql as $$
  insert into public.agent_cost_reservations (tenant_id, run_id, step_key, cost_day, model, input_micros_per_mtok, output_micros_per_mtok, max_input_tokens, max_output_tokens, reserved_micros, args_sha256)
  select tenant_id, id, p_key, app.agent_utc_today(), 'fake-selftest', 1000000, 1000000, 0, 0, p_micros, repeat('0', 64) from public.agent_runs where id = p_run $$;
-- (T007: a usage record settles a RESERVATION; the daily-cost-cap tests are 49)
select pg_temp.resv(tests.rid('i_use'), 'u1', 800);
select pg_temp.resv(tests.rid('i_use'), 'u6', 800);
select is(pg_temp.out_sales(pg_temp.use_sql(tests.rid('i_use'), 'u1', 60, 20, 400)), 'rows:1', 'usage is recorded');
select results_eq(format($$select input_tokens_used, output_tokens_used, cost_micros_used from public.agent_runs where id = %L$$, tests.rid('i_use')), $$values (60, 20, 400::bigint)$$, '...and added to the run');
select is(pg_temp.j(tests.scalar_as(tests.uid('a_sales'), pg_temp.use_sql(tests.rid('i_use'), 'u1', 60, 20, 400)), 'replayed'), 'true', 'a replay');
select results_eq(format($$select input_tokens_used, output_tokens_used, cost_micros_used from public.agent_runs where id = %L$$, tests.rid('i_use')), $$values (60, 20, 400::bigint)$$, '...adds nothing');
select is(pg_temp.as_sales(pg_temp.use_sql(tests.rid('i_use'), 'u2', 50, 0, 0)), 'SM203|agent run budget exhausted||||', 'usage that would exceed the input-token budget: SM203');
select is(pg_temp.as_sales(pg_temp.use_sql(tests.rid('i_use'), 'u3', 0, 40, 0)), 'SM203|agent run budget exhausted||||', '...the output-token budget: SM203');
select is(pg_temp.as_sales(pg_temp.use_sql(tests.rid('i_use'), 'u4', 0, 0, 700)), 'SM203|agent run budget exhausted||||', '...the cost budget: SM203');
select results_eq(format($$select input_tokens_used, output_tokens_used, cost_micros_used from public.agent_runs where id = %L$$, tests.rid('i_use')), $$values (60, 20, 400::bigint)$$, 'a refused usage report changes nothing');
select is(pg_temp.as_sales(pg_temp.use_sql(tests.rid('i_use'), 'u5', -1, 0, 0)), '22023|invalid argument||||', 'negative usage: 22023');
select is(pg_temp.out_sales(pg_temp.use_sql(tests.rid('i_use'), 'u6', 40, 30, 600)), 'rows:1', 'usage exactly up to the budget is accepted');

-- ============================================================================ J. scope: a run writes about its target and its tenant only
-- tenant B has agents enabled too, with its own run: the functions never cross over
update public.tenant_agent_settings set enabled = true where tenant_id = tests.tid('a');
insert into public.tenant_agent_settings (tenant_id, enabled) values (tests.tid('b'), true);
update public.agent_definitions set allowed_tenants = array[tests.tid('a'), tests.tid('b')] where agent_name = 'selftest';
create temp table b_write as select tests.scalar_as(tests.uid('b_sales'), pg_temp.ev_sql(tests.rid('b_run'), 'b1')) as r;
select is((select count(*) from public.evidence where tenant_id = tests.tid('b') and agent_run_id = tests.rid('b_run') and created_by = tests.uid('b_sales')), 1::bigint, 'tenant B''s own run writes into tenant B');
select is((select count(*) from public.evidence_links where tenant_id = tests.tid('b') and company_id = tests.rid('b_company')), 1::bigint, '...linked to B''s company');
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('b_run'), 'b2')), (select r[1] from ref_ev), 'tenant A''s user cannot write to B''s run (identical refusal)');
select is(tests.error_full_as(tests.uid('b_sales'), pg_temp.ev_sql(tests.rid('a_run_sales'), 'b3')), (select r[1] from ref_ev), 'nor B''s user to A''s run');
select is((select count(*) from public.evidence where tenant_id = tests.tid('a') and agent_run_id = tests.rid('b_run')), 0::bigint, 'nothing of tenant B''s run exists in tenant A');
select is((select count(*) from public.evidence e where e.agent_run_id is not null and not exists (select 1 from public.agent_runs r where r.tenant_id = e.tenant_id and r.id = e.agent_run_id)), 0::bigint, 'every agent evidence row has a run in its OWN tenant');

-- ============================================================================ K. source audit of the four functions
create temp table src as select proname, prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname in ('agent_write_evidence', 'agent_write_claim', 'agent_record_step', 'agent_record_usage');
select is((select coalesce(string_agg(distinct m[1], ',' order by m[1]), '') from src, regexp_matches(prosrc, 'insert\s+into\s+public\.(\w+)', 'gi') m), 'agent_run_steps,claims,evidence,evidence_links',
  'between them they insert only into evidence, evidence_links, claims and agent_run_steps (a usage record settles a reservation; it never creates one)');
select is((select count(*) from src where prosrc ~* '\mdelete\s+from\M'), 0::bigint, 'none deletes anything');
select is((select coalesce(string_agg(distinct m[1], ',' order by m[1]), '') from src, regexp_matches(prosrc, '\mupdate\s+public\.(\w+)', 'gi') m), 'agent_cost_reservations,agent_runs', 'the only tables they update are agent_runs (the counters) and agent_cost_reservations (settling a reservation)');
select is((select count(*) from src where prosrc ~* 'set_config\(''role''|\mset\s+role\M'), 0::bigint, 'none switches role');
select is((select count(*) from src where prosrc ~* 'p_tenant|tenant_id\s*:=\s*p_'), 0::bigint, 'none takes or assigns a tenant from an argument');
select is((select count(*) from src where prosrc ~* 'created_via\s*:=|created_by\s*:=|confidence\s*:=\s*p_'), 0::bigint, 'none assigns provenance or confidence from an argument (only the GUC route)');
select is((select count(*) from src where proname in ('agent_write_evidence', 'agent_write_claim') and prosrc !~ 'agent_open_run'), 0::bigint, 'both write functions open the run through the one shared checker');
select is((select count(*) from src where prosrc ~* 'create_via|import_batch'), 0::bigint, 'and neither mentions the import origin');

select * from finish();
rollback;
