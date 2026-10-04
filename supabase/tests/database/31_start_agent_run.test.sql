-- T006 / M1 (ADR 0013): public.start_agent_run, the only way a run comes into being.
--   A properties        B refusals BEFORE the role is proven: one generic 42501, identical, no oracle
--   C who may start     D switches (SM204 only AFTER the role is proven)       E target / agent validation
--   F idempotency       G budgets are clamped     H TTL and the token's exp    I limits (SM206)      J run content, audit
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
-- start from an empty slate: the two fixture runs of tenant A (and B's) are finished
update public.agent_runs set status = 'succeeded', finished_at = now();

create function pg_temp.start_sql(p_run uuid, p_tenant uuid, p_agent text default 'selftest', p_kind text default 'company',
                                  p_target uuid default null, p_ttl integer default null, p_budgets jsonb default null,
                                  p_hash text default null, p_version text default 'v1') returns text
language sql as $$
  select format('select public.start_agent_run(%L, %L, %L, %L, %L, %L, %L, %L::jsonb, %L, %L::jsonb)',
                p_run, p_tenant, p_agent, p_version, p_kind, coalesce(p_target, tests.rid('a_company')),
                coalesce(p_hash, repeat('a', 64)), '{}', p_ttl, p_budgets)
$$;
create function pg_temp.start_a(p_user text, p_run text, variadic p_extra text[] default '{}') returns text
language sql as $$ select tests.outcome_as(tests.uid(p_user), pg_temp.start_sql(tests.rid(p_run), tests.tid('a'))) $$;
create function pg_temp.field(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;

-- ============================================================================ A. properties
select is((select count(*) from pg_proc where proname = 'start_agent_run' and pronamespace = 'public'::regnamespace), 1::bigint, 'exactly one overload');
select ok((select prosecdef from pg_proc where proname = 'start_agent_run'), 'SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where proname = 'start_agent_run'), 'search_path pinned to empty');
select ok((select proowner::regrole::text = 'postgres' from pg_proc where proname = 'start_agent_run'), 'owned by the migration role');
select ok(has_function_privilege('authenticated', (select oid from pg_proc where proname = 'start_agent_run'), 'execute'), 'authenticated may execute it');
select ok(not has_function_privilege('anon', (select oid from pg_proc where proname = 'start_agent_run'), 'execute'), 'anon may not');
select is((select prosrc ~* '\mexecute\M' from pg_proc where proname = 'start_agent_run'), false, 'no dynamic SQL');
select is(
  (select coalesce(string_agg(distinct m[1], ',' order by m[1]), '') from pg_proc, regexp_matches(prosrc, 'insert\s+into\s+public\.(\w+)', 'gi') m where proname = 'start_agent_run'),
  'agent_runs', 'it inserts into agent_runs and nothing else');

-- ============================================================================ B. generic refusal before the role is proven
create function pg_temp.refusal(p_user text, p_tenant uuid) returns text
language sql as $$ select tests.error_full_as(case when p_user is null then null else tests.uid(p_user) end, pg_temp.start_sql(gen_random_uuid(), p_tenant)) $$;
select is(substr(pg_temp.refusal('a_viewer', tests.tid('a')), 1, 5), '42501', 'a Viewer is refused with 42501');
select is(pg_temp.refusal('outsider', tests.tid('a')), pg_temp.refusal('a_viewer', tests.tid('a')), 'an outsider gets the IDENTICAL error (sqlstate, message, detail, hint, constraint, table)');
select is(pg_temp.refusal('b_sales', tests.tid('a')), pg_temp.refusal('a_viewer', tests.tid('a')), 'a member of another tenant: identical');
select is(pg_temp.refusal('a_owner', tests.tid('b')), pg_temp.refusal('a_viewer', tests.tid('a')), 'an Owner of A aiming at B: identical');
select is(pg_temp.refusal('a_owner', gen_random_uuid()), pg_temp.refusal('a_viewer', tests.tid('a')), 'a tenant that does not exist: identical');
select is(pg_temp.refusal('dual', tests.tid('b')), pg_temp.refusal('a_viewer', tests.tid('a')), 'dual is only a Viewer of B: identical');
select is(pg_temp.refusal(null, tests.tid('a')), '42501|permission denied for function start_agent_run||||', 'anon: no EXECUTE at all');
select ok(pg_temp.refusal('a_viewer', tests.tid('a')) !~ '[0-9a-f]{8}-[0-9a-f]{4}', 'and the message carries no id');
-- the refusal does not depend on the state of agents: a stranger learns nothing about whether tenant A has agents on
update public.tenant_agent_settings set enabled = false where tenant_id = tests.tid('a');
select is(pg_temp.refusal('outsider', tests.tid('a')), pg_temp.refusal('a_viewer', tests.tid('a')), 'with agents OFF in A an outsider still gets the same generic refusal (no state leak)');
update public.tenant_agent_settings set enabled = true where tenant_id = tests.tid('a');

-- ============================================================================ C. who may start (and the concurrency cap, 3)
select is(pg_temp.start_a('a_owner', 'c1'), 'rows:1', 'Owner may start');
select is(pg_temp.start_a('a_admin', 'c2'), 'rows:1', 'Admin may start');
select is(pg_temp.start_a('a_sales', 'c3'), 'rows:1', 'Sales may start');
select is((select count(*) from public.agent_runs where status = 'running' and tenant_id = tests.tid('a')), 3::bigint, 'three runs are running');
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('c4'), tests.tid('a'))), 'SM206|agent limit reached||||', 'a 4th concurrent run: SM206, a fixed message');
update public.agent_runs set status = 'succeeded', finished_at = now() where id = tests.rid('c1');
select is(pg_temp.start_a('a_sales', 'c4'), 'rows:1', 'after one finishes the 4th may start');
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
-- an expired-but-still-"running" row does not count against the cap
update public.agent_runs set status = 'running', finished_at = null, created_at = now() - interval '3 hours', expires_at = now() - interval '2 hours' where id in (tests.rid('c2'), tests.rid('c3'));
select is(pg_temp.start_a('a_owner', 'c5'), 'rows:1', 'runs past their expiry do not count as concurrent');
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');

-- ============================================================================ D. switches: SM204 only for someone allowed to start
create function pg_temp.sm(p_user text, p_tag text) returns text
language sql as $$ select tests.error_full_as(tests.uid(p_user), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))) $$;

update public.platform_flags set enabled = false where key = 'agents_enabled';
select is(pg_temp.sm('a_sales', 'platform'), 'SM204|agents are disabled||||', 'platform switch OFF: SM204');
update public.platform_flags set enabled = true where key = 'agents_enabled';
update public.tenant_agent_settings set enabled = false where tenant_id = tests.tid('a');
select is(pg_temp.sm('a_sales', 'tenant'), 'SM204|agents are disabled||||', 'tenant switch OFF: SM204');
select is(pg_temp.sm('a_viewer', 'tenant'), pg_temp.refusal('a_viewer', tests.tid('a')), '...but a Viewer still only sees the generic refusal');
update public.tenant_agent_settings set enabled = true where tenant_id = tests.tid('a');
update public.platform_flags set enabled = false where key = 'selftest_enabled';
select is(pg_temp.sm('a_sales', 'selftest'), 'SM204|agents are disabled||||', 'the selftest flag OFF: SM204');
update public.platform_flags set enabled = true where key = 'selftest_enabled';
update public.agent_definitions set allowed_tenants = array[tests.tid('b')] where agent_name = 'selftest';
select is(pg_temp.sm('a_sales', 'allowlist'), 'SM204|agents are disabled||||', 'a tenant that is not on the selftest allow-list: SM204');
update public.agent_definitions set allowed_tenants = '{}' where agent_name = 'selftest';
select is(pg_temp.sm('a_sales', 'empty'), 'SM204|agents are disabled||||', 'an EMPTY allow-list allows nobody');
update public.agent_definitions set allowed_tenants = null where agent_name = 'selftest';
update public.agent_definitions set allowed_tenants = array[tests.tid('a')] where agent_name = 'selftest';
-- tenant B: enabled nowhere by default
select is(tests.error_full_as(tests.uid('b_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('b'), 'selftest', 'company', tests.rid('b_company'))),
  'SM204|agents are disabled||||', 'tenant B (no settings row, not on the allow-list): SM204 for its Sales user');

-- ============================================================================ E. target and agent validation
select is(substr(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), 'nosuchagent')), 1, 5), '23503', 'an unknown agent: 23503');
select is(
  tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), 'selftest', 'company', tests.rid('b_company'))),
  tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), 'selftest', 'company', gen_random_uuid())),
  'a company of tenant B fails EXACTLY like a company that does not exist');
select is(substr(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), 'selftest', 'company', gen_random_uuid())), 1, 5), '23503', '...with 23503');
select is(
  tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), 'selftest', 'lead', tests.rid('b_lead'))),
  tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), 'selftest', 'lead', gen_random_uuid())),
  'same for a lead');
select is(substr(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), 'selftest', 'contact', tests.rid('a_contact'))), 1, 5), '22023', 'a contact is not a valid target kind (22023)');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('e_lead'), tests.tid('a'), 'selftest', 'lead', tests.rid('a_lead'))), 'rows:1', 'a lead of the tenant is a valid target');
select results_eq(format($$select company_id is null, lead_id is not null from public.agent_runs where id = %L$$, tests.rid('e_lead')), $$values (true, true)$$, '...and only the lead is set');
select is(substr(tests.error_full_as(tests.uid('a_sales'), format('select public.start_agent_run(null, %L, ''selftest'', ''v1'', ''company'', %L, %L, ''{}''::jsonb)', tests.tid('a'), tests.rid('a_company'), repeat('a', 64))), 1, 5), '22023', 'a NULL run id: 22023');
select is(substr(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), p_hash => 'nothex')), 1, 5), '23514', 'a bad input hash: 23514');
select is(substr(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), p_version => 'bad version!')), 1, 5), '23514', 'a bad agent version: 23514');
select is(substr(tests.error_full_as(tests.uid('a_sales'), format('select public.start_agent_run(%L, %L, ''selftest'', ''v1'', ''company'', %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), tests.rid('a_company'), repeat('a', 64), '{"note": "free text"}')), 1, 5), '23514', 'input_refs with free text: 23514');
select is(tests.outcome_as(tests.uid('a_sales'), format('select public.start_agent_run(%L, %L, ''selftest'', ''v1'', ''company'', %L, %L, %L::jsonb)', tests.rid('e_refs'), tests.tid('a'), tests.rid('a_company'), repeat('a', 64), format('{"company_id": "%s"}', tests.rid('a_company')))), 'rows:1', 'input_refs with a typed id is accepted');

-- ============================================================================ F. idempotency
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
create temp table first_start as select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('f1'), tests.tid('a'))) as r;
select is(pg_temp.field((select r from first_start), 'replayed'), 'false', 'a first start is not a replay');
select is(pg_temp.field((select r from first_start), 'status'), 'running', 'and is running');
create temp table second_start as select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('f1'), tests.tid('a'))) as r;
select is(pg_temp.field((select r from second_start), 'replayed'), 'true', 'the same id with the same payload is a replay');
select is(pg_temp.field((select r from second_start), 'expires_at'), pg_temp.field((select r from first_start), 'expires_at'), '...returning the original run');
select is((select count(*) from public.agent_runs where id = tests.rid('f1')), 1::bigint, 'one row');
select is(tests.error_shape_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('f1'), tests.tid('a'), p_hash => repeat('b', 64))), '23505:agent_runs_pkey:agent_runs', 'the same id with another payload: 23505 on the primary key');
select is(tests.error_shape_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('b_run'), tests.tid('a'))), '23505:agent_runs_pkey:agent_runs', 'an id that belongs to ANOTHER tenant: the same 23505 (no way to tell the two apart)');
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('b_run'), tests.tid('a'))), tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('f1'), tests.tid('a'), p_hash => repeat('b', 64))),
  '...down to the message, detail and hint');
select is(tests.error_shape_as(tests.uid('a_admin'), pg_temp.start_sql(tests.rid('f1'), tests.tid('a'))), '23505:agent_runs_pkey:agent_runs', 'a replay by ANOTHER user of the tenant is not a replay: 23505');

-- ============================================================================ G. budgets are clamped to the agent's ceilings
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
create temp table big as select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('g1'), tests.tid('a'), p_budgets =>
  '{"max_writes": 1000000000, "max_tool_calls": 1000000000, "max_input_tokens": 1000000000, "max_output_tokens": 1000000000, "max_cost_micros": 1000000000}')) as r;
select results_eq($$select max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros from public.agent_runs where id = $$ || quote_literal(tests.rid('g1')),
  $$values (6, 20, 20000, 4000, 250000::bigint)$$, 'asking for 10^9 of everything gets the agent''s ceilings (6 / 20 / 20000 / 4000 / 250000)');
create temp table small as select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('g2'), tests.tid('a'), p_budgets => '{"max_writes": 2, "max_cost_micros": 0}')) as r;
select results_eq($$select max_writes, max_tool_calls, max_cost_micros from public.agent_runs where id = $$ || quote_literal(tests.rid('g2')),
  $$values (2, 20, 0::bigint)$$, 'a smaller request is honoured, the rest default to the ceilings');
select is(substr(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), p_budgets => '{"max_writes": -1}')), 1, 5), '22023', 'a negative budget: 22023');
select is(substr(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), p_budgets => '{"max_tokens": 5}')), 1, 5), '22023', 'an unknown budget key: 22023');
select is(substr(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'), p_budgets => '{"max_writes": "many"}')), 1, 5), '22023', 'a non-numeric budget: 22023');

-- ============================================================================ H. TTL and the token's exp
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
create function pg_temp.ttl(p_run text) returns integer language sql as $$ select round(extract(epoch from expires_at - created_at))::int from public.agent_runs where id = tests.rid(p_run) $$;
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('h1'), tests.tid('a')));
select is(pg_temp.ttl('h1'), 900, 'the default TTL is 15 minutes (agent_limits)');
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('h2'), tests.tid('a'), p_ttl => 99999));
select is(pg_temp.ttl('h2'), 1800, 'a longer request is clamped to the 30-minute hard cap');
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('h3'), tests.tid('a'), p_ttl => 1));
select is(pg_temp.ttl('h3'), 30, 'a shorter request is raised to 30 seconds');
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
-- the run never outlives the starter's access token
select set_config('tests.jwt_exp', (extract(epoch from now())::bigint + 120)::text, true);
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('h4'), tests.tid('a')));
select cmp_ok(pg_temp.ttl('h4'), '<=', 121, 'a token with 2 minutes left: the run expires with it (not after 15)');
select cmp_ok(pg_temp.ttl('h4'), '>=', 110, '...and not earlier than the token allows');
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
select set_config('tests.jwt_exp', (extract(epoch from now())::bigint + 2)::text, true);
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))), 'SM202|agent run has expired||||', 'a token about to expire cannot start a run: SM202');
select set_config('tests.jwt_exp', (extract(epoch from now())::bigint - 100)::text, true);
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))), 'SM202|agent run has expired||||', 'an already expired token: SM202');
select set_config('tests.jwt_exp', '', true);

-- ============================================================================ I. limits: runs per hour (30)
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, status, finished_at, expires_at, created_at, input_sha256)
select gen_random_uuid(), tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'), 'succeeded', now(), now() + interval '1 minute', now() - interval '10 minutes', repeat('c', 64)
  from generate_series(1, 30);
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))), 'SM206|agent limit reached||||', 'the 31st run within an hour: SM206');
update public.agent_runs set created_at = now() - interval '2 hours', expires_at = now() - interval '90 minutes' where tenant_id = tests.tid('a') and created_at > now() - interval '1 hour';
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))), 'rows:1', 'once the hour has passed, starting works again');
-- the limits come from the operator table, not from the function
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
update public.agent_limits set limit_value = 1 where limit_key = 'max_concurrent_runs';
select tests.scalar_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('i1'), tests.tid('a')));
select is(tests.error_full_as(tests.uid('a_owner'), pg_temp.start_sql(gen_random_uuid(), tests.tid('a'))), 'SM206|agent limit reached||||', 'lowering max_concurrent_runs in agent_limits takes effect immediately');
update public.agent_limits set limit_value = 3 where limit_key = 'max_concurrent_runs';

-- ============================================================================ J. what a run looks like, and the audit trail
update public.agent_runs set status = 'succeeded', finished_at = now() where tenant_id = tests.tid('a');
select tests.scalar_as(tests.uid('a_admin'), format('select public.start_agent_run(%L, %L, ''selftest'', ''v7'', ''company'', %L, %L, %L::jsonb)', tests.rid('j1'), tests.tid('a'), tests.rid('a_company'), repeat('e', 64), format('{"company_id": "%s"}', tests.rid('a_company'))));
select results_eq($$select tenant_id, started_by, agent_name, agent_version, status::text, company_id, lead_id is null, input_sha256, input_refs::text, finished_at is null,
                           writes_used, tool_calls_used, input_tokens_used, output_tokens_used, cost_micros_used, error_code is null
                      from public.agent_runs where id = $$ || quote_literal(tests.rid('j1')),
  format($$values (%L::uuid, %L::uuid, 'selftest'::text, 'v7'::text, 'running'::text, %L::uuid, true, %L::text, %L::text, true, 0, 0, 0, 0, 0::bigint, true)$$,
         tests.tid('a'), tests.uid('a_admin'), tests.rid('a_company'), repeat('e', 64), format('{"company_id": "%s"}', tests.rid('a_company'))),
  'the run: tenant from the argument the caller was proven to hold, started_by = the caller, status running, the hash and typed refs stored, nothing used');
select is((select count(*) from public.audit_events where entity_type = 'agent_run' and entity_id = tests.rid('j1') and action = 'agent_run.create' and actor_user_id = tests.uid('a_admin') and tenant_id = tests.tid('a')), 1::bigint,
  'starting a run is audited (actor = the starter)');
select is((select count(*) from public.audit_events where entity_type = 'agent_run' and to_jsonb(audit_events)::text ~ 'selftest.observation|Generic|Company a'), 0::bigint, 'and the audit row carries no content');

select * from finish();
rollback;
