-- T006 / M1 (ADR 0013): the agent tables, their grants and RLS, and the provenance machinery on evidence / evidence_links
-- / claims (agent_run_id + the origin CHECK + the trigger that decides it).
--   A the tables exist and are locked down      B operator-managed tables: NO application role can write them
--   C read matrix of runs / steps / reviews     D CHECKs and composite foreign keys
--   E no raw content columns                    F provenance: a client cannot create agent provenance, GUC or not
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

-- ============================================================================ 0. what the MIGRATION leaves behind: everything OFF
-- (checked before seed_agents switches things on for the rest of the file). A local database may legitimately differ in exactly one
-- way: `make seed-demo` ran scripts/dev-enable-selftest.sh, which switches the platform on and allows selftest for the DEMO
-- workspace ONLY. Anything else fails: all OFF and nobody allowed, or exactly that footprint.
create function pg_temp.operator_state() returns text language sql as $$
  select case
    when (select bool_and(not enabled) from public.platform_flags)
         and (select allowed_tenants = '{}'::uuid[] from public.agent_definitions where agent_name = 'selftest') then 'pristine'
    when (select bool_and(enabled) from public.platform_flags)
         and (select allowed_tenants = coalesce((select array_agg(id) from public.tenants where slug = 'demo-synthetic-sme'), '{}'::uuid[])
                     and cardinality(allowed_tenants) = 1
                from public.agent_definitions where agent_name = 'selftest') then 'dev-seeded'
    else 'UNEXPECTED' end
$$;
select ok(pg_temp.operator_state() in ('pristine', 'dev-seeded'),
  'the platform switches are OFF and selftest is allowed for NO tenant (or, on a dev database, exactly the DEMO workspace); found ' || pg_temp.operator_state());
select is((select count(*) from public.tenant_agent_settings where tenant_id in (tests.tid('a'), tests.tid('b'))), 0::bigint, 'a new tenant has agents OFF (no settings row)');
select results_eq($$select agent_name, allowed_tenants is null from public.agent_definitions order by agent_name$$, $$values ('requirement'::text, false), ('research', false), ('selftest', false)$$,
  'no agent is ever open to every tenant (allowed_tenants is not NULL)');
select is((select count(*) from public.agent_runs where tenant_id in (tests.tid('a'), tests.tid('b'))), 0::bigint, 'a new tenant has no runs');

select tests.seed_agents();

-- ============================================================================ A. tables, RLS, grants
select has_table('public', t, t || ' exists')
  from unnest(array['agent_definitions', 'agent_limits', 'platform_flags', 'tenant_agent_settings',
                    'agent_runs', 'agent_run_steps', 'claim_reviews']) t;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS enabled and forced')
  from unnest(array['agent_definitions', 'agent_limits', 'platform_flags', 'tenant_agent_settings',
                    'agent_runs', 'agent_run_steps', 'claim_reviews']) t;
select is(
  (select coalesce(string_agg(t || ':' || p, ', '), '')
     from unnest(array['agent_definitions', 'agent_limits', 'platform_flags', 'tenant_agent_settings',
                       'agent_runs', 'agent_run_steps', 'claim_reviews']) t,
          (values ('INSERT'), ('UPDATE'), ('DELETE')) x(p)
    where case x.p when 'DELETE' then has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE')
                   else has_any_column_privilege('authenticated', ('public.' || t)::regclass, x.p) end
       or has_any_column_privilege('anon', ('public.' || t)::regclass, 'SELECT')),
  '', 'no client INSERT / UPDATE / DELETE on any agent table, and anon reads none');
select is(
  (select coalesce(string_agg(t, ', '), '')
     from unnest(array['agent_definitions', 'agent_limits', 'platform_flags']) t
    where has_any_column_privilege('authenticated', ('public.' || t)::regclass, 'SELECT')),
  '', 'agent_definitions, agent_limits and platform_flags are not even readable by clients');
select is(
  (select coalesce(string_agg(t, ', '), '')
     from unnest(array['tenant_agent_settings', 'agent_runs', 'agent_run_steps', 'claim_reviews']) t
    where not has_table_privilege('authenticated', ('public.' || t)::regclass, 'SELECT')),
  '', 'the four tenant tables are readable (through RLS) by authenticated');

-- ============================================================================ B. the operator-managed tables
-- Decisions 3 and 9: limits, allow-lists and switches change by MIGRATION only. Every application role is shown
-- unable to write them (and unable to read them).
create function pg_temp.operator_attack(p_uid uuid) returns text
language sql as $$
  select concat_ws(',',
    tests.outcome_as(p_uid, $q$insert into public.agent_limits (limit_key, limit_value) values ('max_runs_per_hour', 1)$q$),
    tests.outcome_as(p_uid, $q$update public.agent_limits set limit_value = 100000$q$),
    tests.outcome_as(p_uid, $q$delete from public.agent_limits$q$),
    tests.outcome_as(p_uid, $q$update public.platform_flags set enabled = true$q$),
    tests.outcome_as(p_uid, $q$insert into public.platform_flags (key, enabled) values ('agents_enabled', true)$q$),
    tests.outcome_as(p_uid, $q$delete from public.platform_flags$q$),
    tests.outcome_as(p_uid, $q$update public.agent_definitions set allowed_predicates = array['anything.goes']$q$),
    tests.outcome_as(p_uid, $q$update public.agent_definitions set allowed_tenants = null$q$),
    tests.outcome_as(p_uid, $q$insert into public.agent_definitions (agent_name, allowed_predicates) values ('rogue', array['x.y'])$q$),
    tests.outcome_as(p_uid, $q$delete from public.agent_definitions$q$),
    tests.outcome_as(p_uid, $q$select 1 from public.agent_limits$q$),
    tests.outcome_as(p_uid, $q$select 1 from public.platform_flags$q$),
    tests.outcome_as(p_uid, $q$select 1 from public.agent_definitions$q$))
$$;
select is(pg_temp.operator_attack(tests.uid('a_owner')),   repeat('42501,', 12) || '42501', 'Owner of A cannot read or write limits, flags or definitions');
select is(pg_temp.operator_attack(tests.uid('a_admin')),   repeat('42501,', 12) || '42501', 'Admin cannot');
select is(pg_temp.operator_attack(tests.uid('a_sales')),   repeat('42501,', 12) || '42501', 'Sales cannot');
select is(pg_temp.operator_attack(tests.uid('a_viewer')),  repeat('42501,', 12) || '42501', 'Viewer cannot');
select is(pg_temp.operator_attack(tests.uid('outsider')),  repeat('42501,', 12) || '42501', 'a user with no tenant cannot');
select is(pg_temp.operator_attack(null),                   repeat('42501,', 12) || '42501', 'anon cannot');
select is(pg_temp.operator_attack(tests.uid('dual')),      repeat('42501,', 12) || '42501', 'a multi-tenant Owner cannot');

-- the values the owner decided (decision 3), exactly
select results_eq(
  $$select limit_key, limit_value from public.agent_limits order by limit_key$$,
  $$values ('daily_cost_micros'::text, 2000000), ('max_concurrent_runs', 3), ('max_runs_per_hour', 30), ('max_writes_per_day', 500),
           ('ttl_default_seconds', 900), ('ttl_max_seconds', 1800)$$,
  'agent_limits holds the owner-approved values: 15 min default TTL, 30 min hard cap, 3 concurrent, 30 runs / hour, 500 writes / day, 2.00 per tenant per UTC day (T007)');
select throws_ok($$insert into public.agent_limits (limit_key, limit_value) values ('something_else', 1)$$, '23514', null, 'only the known limit keys exist');
select throws_ok($$update public.agent_limits set limit_value = 0 where limit_key = 'ttl_max_seconds'$$, '23514', null, 'a limit must be positive');
select throws_ok($$update public.agent_limits set limit_value = 5000 where limit_key = 'ttl_default_seconds'$$, '23514', null, 'the default TTL cannot exceed the hard cap');
select throws_ok($$update public.agent_limits set limit_value = 500 where limit_key = 'ttl_max_seconds'$$, '23514', null, 'the hard cap cannot drop below the default TTL');

-- defaults: everything is OFF (the migration's column defaults and seeded rows; seed_agents switched them on for the tests below)
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'platform_flags' and column_name = 'enabled'), 'false', 'platform switches default to OFF');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tenant_agent_settings' and column_name = 'enabled'), 'false', 'the per-tenant switch defaults to OFF');
select is((select count(*) from public.platform_flags where key in ('agents_enabled', 'selftest_enabled', 'research_enabled')), 3::bigint, 'the three platform switches exist');
select results_eq($$select key, enabled from public.platform_flags order by key$$, $$values ('agents_enabled'::text, true), ('requirement_enabled', false), ('research_enabled', false), ('selftest_enabled', true)$$,
  'sanity: seed_agents switched agents and selftest on for the tests; research and requirement stay OFF');
select results_eq(
  $$select agent_name, requires_flag, coalesce(array_length(allowed_tenants, 1), 0), allowed_predicates, max_writes
      from public.agent_definitions order by agent_name$$,
  $$values ('requirement'::text, 'requirement_enabled'::text, 0, array[]::text[], 45),
           ('research'::text, 'research_enabled'::text, 0, array['buyer_type', 'order_scale', 'size_band', 'operating_status']::text[], 7),
           ('selftest', 'selftest_enabled', 1, array['selftest.observation']::text[], 6)$$,
  'each agent is gated by its own flag and tenant-restricted (research: no tenant at all yet; selftest: one), with its own predicates and a small write ceiling');
select throws_ok($$insert into public.platform_flags (key, enabled) values ('anything_else', true)$$, '23514', null, 'only the known flags exist');

-- ============================================================================ C. read matrix
-- a_sales started a_run_sales, a_admin started a_run_admin (seed_agents); steps follow their run.
insert into public.agent_run_steps (id, tenant_id, run_id, started_by, step_key, kind, status)
values (tests.rid('a_step_sales'), tests.tid('a'), tests.rid('a_run_sales'), tests.uid('a_sales'), 'step-1', 'tool_call', 'ok'),
       (tests.rid('a_step_admin'), tests.tid('a'), tests.rid('a_run_admin'), tests.uid('a_admin'), 'step-1', 'tool_call', 'ok');

create function pg_temp.ids_as(p_uid uuid, p_table text) returns text
language plpgsql as $$
declare v text;
begin
  perform tests.set_identity(p_uid);
  begin
    execute format('select coalesce(string_agg(id::text, '','' order by id), '''') from public.%I', p_table) into v;
  exception when others then v := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
create function pg_temp.sorted(variadic p_ids uuid[]) returns text language sql as
$$ select coalesce(string_agg(i::text, ',' order by i), '') from unnest(p_ids) i $$;

select is(pg_temp.ids_as(tests.uid('a_owner'), 'agent_runs'), pg_temp.sorted(tests.rid('a_run_sales'), tests.rid('a_run_admin')), 'Owner reads every run of the tenant');
select is(pg_temp.ids_as(tests.uid('a_admin'), 'agent_runs'), pg_temp.sorted(tests.rid('a_run_sales'), tests.rid('a_run_admin')), 'Admin reads every run of the tenant');
select is(pg_temp.ids_as(tests.uid('a_sales'), 'agent_runs'), tests.rid('a_run_sales')::text, 'Sales reads only the runs they started');
select is(pg_temp.ids_as(tests.uid('a_viewer'), 'agent_runs'), '', 'Viewer started none, reads none');
select is(pg_temp.ids_as(tests.uid('b_owner'), 'agent_runs'), tests.rid('b_run')::text, 'tenant B reads only its own run');
select is(pg_temp.ids_as(tests.uid('outsider'), 'agent_runs'), '', 'a user with no tenant reads none');
select is(pg_temp.ids_as(null, 'agent_runs'), '42501', 'anon: permission denied');
select is(pg_temp.ids_as(tests.uid('a_owner'), 'agent_run_steps'), pg_temp.sorted(tests.rid('a_step_sales'), tests.rid('a_step_admin')), 'Owner reads every step');
select is(pg_temp.ids_as(tests.uid('a_sales'), 'agent_run_steps'), tests.rid('a_step_sales')::text, 'Sales reads the steps of their own runs only');
select is(pg_temp.ids_as(tests.uid('a_viewer'), 'agent_run_steps'), '', 'Viewer reads no steps');
select is(pg_temp.ids_as(tests.uid('b_owner'), 'agent_run_steps'), '', 'no steps for B, and none of A''s');
select is(tests.outcome_as(tests.uid('a_owner'), format('select 1 from public.agent_runs where tenant_id = %L', tests.tid('b'))), 'rows:0', 'tenant A reads nothing of tenant B''s runs');

-- tenant_agent_settings: every member can read whether agents are on; nobody writes directly
select is(tests.outcome_as(tests.uid('a_viewer'), format('select 1 from public.tenant_agent_settings where tenant_id = %L', tests.tid('a'))), 'rows:1', 'a Viewer can see that agents are enabled');
select is(tests.outcome_as(tests.uid('b_owner'), format('select 1 from public.tenant_agent_settings where tenant_id = %L', tests.tid('a'))), 'rows:0', 'another tenant cannot');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.tenant_agent_settings set enabled = false where tenant_id = %L$q$, tests.tid('a'))), '42501', 'even an Owner cannot flip the switch with an UPDATE (it is a function)');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.tenant_agent_settings (tenant_id, enabled) values (%L, true)$q$, tests.tid('b'))), '42501', 'nor insert a row for another tenant');

-- ============================================================================ D. CHECKs and composite foreign keys
create function pg_temp.err(p_sql text) returns text
language plpgsql as $$
declare v_constraint text;
begin
  begin execute p_sql; return 'ok';
  exception when others then
    get stacked diagnostics v_constraint = constraint_name;
    return sqlstate || ':' || coalesce(v_constraint, '');
  end;
end $$;
create function pg_temp.run_sql(p_cols text, p_vals text) returns text language sql as $$
  select format($f$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, expires_at, input_sha256, input_refs%s)
                   values (gen_random_uuid(), %L, %L, 'selftest', 'v1', now() + interval '5 minutes', repeat('4', 64), '{}'::jsonb%s)$f$,
                p_cols, tests.tid('a'), tests.uid('a_sales'), p_vals)
$$;
select is(substr(pg_temp.err(pg_temp.run_sql('', '')), 1, 5), '23514', 'a run without a target is refused (exactly one target)');
select is(substr(pg_temp.err(pg_temp.run_sql(', company_id, lead_id', format(', %L, %L', tests.rid('a_company'), tests.rid('a_lead')))), 1, 5), '23514', 'a run with two targets is refused');
select is(pg_temp.err(pg_temp.run_sql(', company_id', format(', %L', tests.rid('a_company')))), 'ok', 'a run with one target (company) is accepted');
select is(pg_temp.err(pg_temp.run_sql(', lead_id', format(', %L', tests.rid('a_lead')))), 'ok', 'a run with one target (lead) is accepted');
select is(substr(pg_temp.err(pg_temp.run_sql(', company_id, max_writes', format(', %L, -1', tests.rid('a_company')))), 1, 5), '23514', 'a negative budget is refused');
select is(substr(pg_temp.err(pg_temp.run_sql(', company_id, max_writes, writes_used', format(', %L, 2, 3', tests.rid('a_company')))), 1, 5), '23514', 'use above the budget is refused');
select is(substr(pg_temp.err(pg_temp.run_sql(', company_id, status', format(', %L, ''succeeded''', tests.rid('a_company')))), 1, 5), '23514', 'a finished status without finished_at is refused');
select is(substr(pg_temp.err(format($q$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, created_at, expires_at, input_sha256, input_refs)
   values (gen_random_uuid(), %L, %L, 'selftest', 'v1', %L, now(), now() - interval '1 minute', repeat('4', 64), '{}'::jsonb)$q$, tests.tid('a'), tests.uid('a_sales'), tests.rid('a_company'))), 1, 5), '23514', 'a run that expires before it starts is refused');
select is(substr(pg_temp.err(format($q$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
   values (gen_random_uuid(), %L, %L, 'selftest', 'v1', %L, now() + interval '5 minutes', 'not-a-hash', '{}'::jsonb)$q$, tests.tid('a'), tests.uid('a_sales'), tests.rid('a_company'))), 1, 5), '23514', 'input_sha256 must be a sha256 hex string');
select is(substr(pg_temp.err(format($q$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
   values (gen_random_uuid(), %L, %L, 'selftest', 'v1', %L, now() + interval '5 minutes', repeat('4', 64), '[1]'::jsonb)$q$, tests.tid('a'), tests.uid('a_sales'), tests.rid('a_company'))), 1, 5), '23514', 'input_refs must be a JSON object');
select is(substr(pg_temp.err(format($q$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
   values (gen_random_uuid(), %L, %L, 'selftest', 'v1', %L, now() + interval '5 minutes', repeat('4', 64), jsonb_build_object('note', 'a' || chr(8203) || 'b'))$q$, tests.tid('a'), tests.uid('a_sales'), tests.rid('a_company'))), 1, 5), '23514', 'input_refs is hygiene-checked (zero-width space)');
select is(substr(pg_temp.err(format($q$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
   values (gen_random_uuid(), %L, %L, 'nosuchagent', 'v1', %L, now() + interval '5 minutes', repeat('4', 64), '{}'::jsonb)$q$, tests.tid('a'), tests.uid('a_sales'), tests.rid('a_company'))), 1, 5), '23503', 'an agent that is not defined is refused');

-- composite foreign keys: a foreign target fails exactly like a missing one
select is(
  pg_temp.err(pg_temp.run_sql(', company_id', format(', %L', tests.rid('b_company')))),
  pg_temp.err(pg_temp.run_sql(', company_id', format(', %L', gen_random_uuid()))),
  'a run aimed at tenant B''s company fails like a run aimed at a missing company (no existence leak)');
select is(substr(pg_temp.err(pg_temp.run_sql(', company_id', format(', %L', tests.rid('b_company')))), 1, 5), '23503', 'with an invalid-reference error');

-- steps
select is(substr(pg_temp.err(format($q$insert into public.agent_run_steps (id, tenant_id, run_id, started_by, step_key, kind, status)
   values (gen_random_uuid(), %L, %L, %L, 'step-1', 'tool_call', 'ok')$q$, tests.tid('a'), tests.rid('a_run_sales'), tests.uid('a_sales'))), 1, 5), '23505', 'a step key is unique within its run');
select is(pg_temp.err(format($q$insert into public.agent_run_steps (id, tenant_id, run_id, started_by, step_key, kind, status)
   values (gen_random_uuid(), %L, %L, %L, 'step-1', 'tool_call', 'ok')$q$, tests.tid('a'), tests.rid('a_run_admin'), tests.uid('a_admin'))), '23505:agent_run_steps_tenant_id_run_id_step_key_key', 'the constraint is the (tenant, run, step key) unique');
select is(substr(pg_temp.err(format($q$insert into public.agent_run_steps (id, tenant_id, run_id, started_by, step_key, kind, status)
   values (gen_random_uuid(), %L, %L, %L, 'x', 'tool_call', 'ok')$q$, tests.tid('a'), tests.rid('b_run'), tests.uid('a_sales'))), 1, 5), '23503', 'a step cannot point at another tenant''s run');
select is(substr(pg_temp.err(format($q$insert into public.agent_run_steps (id, tenant_id, run_id, started_by, step_key, kind, status)
   values (gen_random_uuid(), %L, %L, %L, 'Has Spaces', 'tool_call', 'ok')$q$, tests.tid('a'), tests.rid('a_run_sales'), tests.uid('a_sales'))), 1, 5), '23514', 'a step key must match its pattern');
select is(substr(pg_temp.err(format($q$insert into public.agent_run_steps (id, tenant_id, run_id, started_by, step_key, kind, status, result_ref)
   values (gen_random_uuid(), %L, %L, %L, 'ok-ref', 'write', 'ok', jsonb_build_object('snippet', 'free text'))$q$, tests.tid('a'), tests.rid('a_run_sales'), tests.uid('a_sales'))), 1, 5), '23514', 'result_ref may hold typed ids only, never free text');

-- claim reviews
select is(substr(pg_temp.err(format($q$insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, self_review)
   values (gen_random_uuid(), %L, %L, 'accepted', 'low', false)$q$, tests.tid('a'), tests.rid('a_company'))), 1, 5), '23503', 'a review of a claim that does not exist (here: a company id) is refused');
insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (tests.rid('a_claim_x'), tests.tid('a'), tests.rid('a_company'), 'exports_to', 'x', 'low');
create function pg_temp.review_sql(p_decision text, p_confidence text, p_reason text) returns text language sql as $$
  select format($f$insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, reason_code, self_review)
                   values (gen_random_uuid(), %L, %L, %L, %s, %s, false)$f$, tests.tid('a'), tests.rid('a_claim_x'), p_decision,
                 coalesce(quote_literal(p_confidence), 'null'), coalesce(quote_literal(p_reason), 'null'))
$$;
select is(pg_temp.err(pg_temp.review_sql('accepted', 'medium', null)), 'ok', 'accepted + a human-assigned confidence is a valid review');
select is(substr(pg_temp.err(pg_temp.review_sql('accepted', null, null)), 1, 5), '23514', 'accepted needs a confidence');
select is(substr(pg_temp.err(pg_temp.review_sql('accepted', 'medium', 'incorrect')), 1, 5), '23514', 'accepted carries no rejection reason');
select is(pg_temp.err(pg_temp.review_sql('rejected', null, null)), 'ok', 'rejected needs NO reason (T007 M3: one tap to say no)');
select is(pg_temp.err(pg_temp.review_sql('rejected', null, 'incorrect')), 'ok', 'rejected + a reason is valid');
select is(substr(pg_temp.err(pg_temp.review_sql('rejected', 'high', 'incorrect')), 1, 5), '23514', 'rejected carries no confidence');
select is(substr(pg_temp.err(pg_temp.review_sql('accepted', 'unverified', null)), 1, 5), '23514', 'a human cannot "accept" at confidence unverified');
create function pg_temp.review_via(p_via text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('app.created_via', p_via, true);   -- what a definer function would do
  v := pg_temp.err(format($f$insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, self_review)
                             values (gen_random_uuid(), %L, %L, 'accepted', 'high', false)$f$, tests.tid('a'), tests.rid('a_claim_x')));
  perform set_config('app.created_via', '', true);
  return v;
end $$;
select is(substr(pg_temp.review_via('agent'), 1, 5), '23514', 'a review is never agent-origin (CHECK created_via = manual, even when the GUC says agent)');
select is(substr(pg_temp.review_via('import'), 1, 5), '23514', 'nor import-origin');
select throws_ok(format($q$update public.claim_reviews set decision = 'rejected' where tenant_id = %L$q$, tests.tid('a')), '42501', null, 'reviews are append-only (UPDATE refused even for the table owner)');
select throws_ok(format($q$update public.claim_reviews set tenant_id = %L where tenant_id = %L$q$, tests.tid('b'), tests.tid('a')), null, null, 'and tenant_id cannot change');

-- ============================================================================ E. no raw content
select is(
  (select coalesce(string_agg(c.relname || '.' || a.attname, ', '), '')
     from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relname in ('agent_definitions', 'agent_limits', 'platform_flags', 'tenant_agent_settings', 'agent_runs', 'agent_run_steps', 'claim_reviews')
      and a.attname ~ '^(prompt|prompts|content|contents|text|body|payload|output|outputs|response|responses|completion|message|messages|raw|raw_.*|input|inputs|transcript|snippet|email|phone|full_name|name)$'),
  '', 'no column of an agent table can hold a prompt, a model answer, a document or a person''s details (input_sha256 and typed input_refs only)');
select is(
  (select coalesce(string_agg(c.relname || '.' || a.attname, ', '), '')
     from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relname in ('agent_runs', 'agent_run_steps', 'claim_reviews', 'tenant_agent_settings')
      and a.atttypid in ('text'::regtype, 'jsonb'::regtype)
      and a.attname not in ('agent_name', 'agent_version', 'input_sha256', 'input_refs', 'step_key', 'tool_name', 'args_sha256', 'result_ref')),
  '', 'the only text / jsonb columns on the four tenant tables are the audited, pattern-checked ones');
select is(
  (select coalesce(string_agg(a.attname, ', '), '') from pg_attribute a
    where a.attrelid = 'public.agent_runs'::regclass and a.attnum > 0 and not a.attisdropped and a.attname in ('input_refs')
      and not exists (select 1 from pg_constraint k where k.conrelid = a.attrelid and k.contype = 'c' and a.attnum = any (k.conkey)
                         and pg_get_constraintdef(k.oid) like '%jsonb_typeof%')),
  '', 'input_refs is constrained to a JSON object');

-- ============================================================================ F. provenance on evidence / evidence_links / claims
select has_column('public', t, 'agent_run_id', t || ' has agent_run_id') from unnest(array['evidence', 'evidence_links', 'claims']) t;
select is(
  (select coalesce(string_agg(t || ':' || p, ', '), '')
     from unnest(array['evidence', 'evidence_links', 'claims']) t, (values ('INSERT'), ('UPDATE')) x(p)
    where has_column_privilege('authenticated', ('public.' || t)::regclass, 'agent_run_id', x.p)),
  '', 'no client holds INSERT or UPDATE on agent_run_id');
select is(
  (select count(*) from pg_constraint k
    where k.conrelid in ('public.evidence'::regclass, 'public.evidence_links'::regclass, 'public.claims'::regclass)
      and k.contype = 'c' and pg_get_constraintdef(k.oid) ~ 'created_via.*agent.*agent_run_id IS NOT NULL'),
  3::bigint, 'each of the three tables ties created_via = agent to a run id with a CHECK');
select is(
  (select count(*) from pg_constraint k
    where k.conrelid in ('public.evidence'::regclass, 'public.evidence_links'::regclass, 'public.claims'::regclass)
      and k.contype = 'f' and k.confrelid = 'public.agent_runs'::regclass
      and (select array_agg(a.attname::text order by o.n) from unnest(k.conkey) with ordinality o(attnum, n) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = o.attnum) = array['tenant_id', 'agent_run_id']),
  3::bigint, 'and a composite (tenant_id, agent_run_id) foreign key to agent_runs');

-- Privileged inserts (what a definer function does), with the GUCs set by hand:
create function pg_temp.insert_claim(p_via text, p_run uuid, p_id uuid) returns text
language plpgsql as $$
declare v_constraint text;
begin
  perform set_config('app.created_via', coalesce(p_via, ''), true);
  perform set_config('app.agent_run_id', coalesce(p_run::text, ''), true);
  begin
    insert into public.claims (id, tenant_id, company_id, predicate, value, confidence)
    values (p_id, tests.tid('a'), tests.rid('a_company'), 'exports_to', 'v', 'unverified');
  exception when others then
    get stacked diagnostics v_constraint = constraint_name;
    perform set_config('app.created_via', '', true); perform set_config('app.agent_run_id', '', true);
    return sqlstate || ':' || coalesce(v_constraint, '');
  end;
  perform set_config('app.created_via', '', true); perform set_config('app.agent_run_id', '', true);
  return 'ok';
end $$;
select is(pg_temp.insert_claim('agent', tests.rid('a_run_sales'), tests.rid('f_ok')), 'ok', 'trusted code (a definer function) may declare agent + a run');
select results_eq(format($$select created_via::text, agent_run_id from public.claims where id = %L$$, tests.rid('f_ok')),
  format($$values ('agent'::text, %L::uuid)$$, tests.rid('a_run_sales')), 'and the row carries both');
select matches(pg_temp.insert_claim('agent', null, tests.rid('f_noid')), '^23514:', 'agent without a run id is refused by the CHECK');
select matches(pg_temp.insert_claim('agent', tests.rid('b_run'), tests.rid('f_foreign')), '^23503:', 'a run of ANOTHER tenant is refused by the composite foreign key');
select matches(pg_temp.insert_claim('agent', gen_random_uuid(), tests.rid('f_missing')), '^23503:', 'and so is a run that does not exist');
select is(pg_temp.insert_claim('manual', tests.rid('a_run_sales'), tests.rid('f_manual')), 'ok', 'a stale run id next to a non-agent origin is dropped, not stored');
select results_eq(format($$select created_via::text, agent_run_id from public.claims where id = %L$$, tests.rid('f_manual')),
  $$values ('manual'::text, null::uuid)$$, 'the row is manual with NO run id');
select is(pg_temp.insert_claim('import', tests.rid('a_run_sales'), tests.rid('f_import')), 'ok', 'same for import');
select results_eq(format($$select created_via::text, agent_run_id from public.claims where id = %L$$, tests.rid('f_import')),
  $$values ('import'::text, null::uuid)$$, 'import + a stray run id: no run id');

-- THE FORGERY TESTS (decision a): a client sets the GUCs itself and inserts. The trigger decides on the ROLE
-- (current_user), never on the GUC alone: the row is manual with no run id, or the insert is refused.
create function public.zz_client_forges(p_table text, p_id uuid, p_run uuid, p_tenant uuid, p_company uuid, p_evidence uuid) returns text
language plpgsql as $$
begin
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', p_run::text, true);
  if p_table = 'claims' then
    insert into public.claims (id, tenant_id, company_id, predicate, value, confidence)
    values (p_id, p_tenant, p_company, 'exports_to', 'forged', 'high');
  elsif p_table = 'evidence' then
    insert into public.evidence (id, tenant_id, kind, provider, url) values (p_id, p_tenant, 'web_page', 'manual', 'https://example.test/forged');
  else
    insert into public.evidence_links (id, tenant_id, evidence_id, company_id) values (p_id, p_tenant, p_evidence, p_company);
  end if;
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);
  return 'ok';
end $$;
grant execute on function public.zz_client_forges(text, uuid, uuid, uuid, uuid, uuid) to authenticated, anon;
create function pg_temp.forge(p_uid uuid, p_table text, p_name text, p_run uuid) returns text language sql as $$
  select tests.outcome_as(p_uid, format($q$select public.zz_client_forges(%L, %L, %L, %L, %L, %L)$q$,
    p_table, tests.rid(p_name), p_run, tests.tid('a'), tests.rid('a_company'), tests.rid('f_ev')))
$$;
create function pg_temp.clear_guc() returns void language sql as
$$ select set_config('app.created_via', '', true), set_config('app.agent_run_id', '', true) $$;
insert into public.evidence (id, tenant_id, kind, provider, url) values (tests.rid('f_ev'), tests.tid('a'), 'web_page', 'manual', 'https://example.test/f');

select is(pg_temp.forge(tests.uid('a_sales'), 'claims', 'forged_claim', tests.rid('a_run_sales')), 'rows:1', 'a Sales client sets app.created_via=agent and app.agent_run_id and inserts a claim: the insert succeeds...');
select results_eq(format($$select created_via::text, agent_run_id, created_by from public.claims where id = %L$$, tests.rid('forged_claim')),
  format($$values ('manual'::text, null::uuid, %L::uuid)$$, tests.uid('a_sales')), '...but the row is MANUAL, has NO run id, and is attributed to the client');
select is(pg_temp.forge(tests.uid('a_sales'), 'evidence', 'forged_ev', tests.rid('a_run_sales')), 'rows:1', 'same for evidence: insert succeeds');
select results_eq(format($$select created_via::text, agent_run_id from public.evidence where id = %L$$, tests.rid('forged_ev')),
  $$values ('manual'::text, null::uuid)$$, '...as manual, no run id');
select is(pg_temp.forge(tests.uid('a_sales'), 'evidence_links', 'forged_link', tests.rid('a_run_sales')), 'rows:1', 'same for evidence_links');
select results_eq(format($$select created_via::text, agent_run_id from public.evidence_links where id = %L$$, tests.rid('forged_link')),
  $$values ('manual'::text, null::uuid)$$, '...as manual, no run id');
select is(pg_temp.forge(tests.uid('a_owner'), 'claims', 'forged_claim2', tests.rid('a_run_admin')), 'rows:1', 'an Owner forging with ANOTHER user''s run id gets the same result');
select results_eq(format($$select created_via::text, agent_run_id from public.claims where id = %L$$, tests.rid('forged_claim2')),
  $$values ('manual'::text, null::uuid)$$, '...manual, no run id');
select is(pg_temp.forge(null, 'claims', 'forged_anon', tests.rid('a_run_sales')), '42501', 'anon cannot insert at all');
select pg_temp.clear_guc();
select is(pg_temp.forge(tests.uid('a_sales'), 'claims', 'forged_foreign', tests.rid('b_run')), 'rows:1', 'forging with a run id of another tenant also yields a plain manual row');
select results_eq(format($$select created_via::text, agent_run_id from public.claims where id = %L$$, tests.rid('forged_foreign')),
  $$values ('manual'::text, null::uuid)$$, '...manual, no run id');
-- the client cannot set the column directly either
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, agent_run_id) values (%L, %L, %L, 'exports_to', 'v', 'low', %L)$q$,
  gen_random_uuid(), tests.tid('a'), tests.rid('a_company'), tests.rid('a_run_sales'))), '42501', 'inserting agent_run_id directly is a column-privilege error');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, created_via) values (%L, %L, %L, 'exports_to', 'v', 'low', 'agent')$q$,
  gen_random_uuid(), tests.tid('a'), tests.rid('a_company'))), '42501', 'inserting created_via directly is a column-privilege error');

-- the origin and the run id never change after the insert (UPDATE restores them)
select is(pg_temp.err(format($q$update public.claims set archived_at = now() where id = %L$q$, tests.rid('f_ok'))), 'ok', 'archiving an agent claim is allowed');
select results_eq(format($$select created_via::text, agent_run_id from public.claims where id = %L$$, tests.rid('f_ok')),
  format($$values ('agent'::text, %L::uuid)$$, tests.rid('a_run_sales')), '...and does not disturb its provenance');
select throws_ok(format($q$update public.claims set agent_run_id = null where id = %L$q$, tests.rid('f_ok')), '42501', null, 'agent_run_id cannot be cleared (the claim is immutable)');
-- defence in depth: with the immutability trigger out of the way, the agent_run_id trigger alone restores the run id
alter table public.claims disable trigger claims_guard_immutable;
update public.claims set agent_run_id = null where id = tests.rid('f_ok');
select results_eq(format($$select created_via::text, agent_run_id from public.claims where id = %L$$, tests.rid('f_ok')),
  format($$values ('agent'::text, %L::uuid)$$, tests.rid('a_run_sales')), 'the agent_run_id trigger restores the run id on UPDATE even without the immutability trigger');
alter table public.claims enable trigger claims_guard_immutable;
select throws_ok(format($q$update public.claims set created_via = 'manual' where id = %L$q$, tests.rid('f_ok')), '42501', null, 'nor can the origin be rewritten');
select results_eq(format($$select created_via::text, agent_run_id from public.claims where id = %L$$, tests.rid('f_ok')),
  format($$values ('agent'::text, %L::uuid)$$, tests.rid('a_run_sales')), 'and the provenance is unchanged');

-- the trigger itself: its name sorts AFTER the origin trigger (it reads the origin that trigger decided), and it exists on all three
select is(
  (select count(*) from pg_trigger g
    where not g.tgisinternal and g.tgname ~ '_zz_set_agent_run_id$' and g.tgrelid in ('public.evidence'::regclass, 'public.evidence_links'::regclass, 'public.claims'::regclass)),
  3::bigint, 'the agent_run_id trigger exists on evidence, evidence_links and claims (named to fire after set_created_meta)');
select ok((select proname from pg_proc where oid = 'app.set_agent_run_id()'::regprocedure) is not null
          and not has_function_privilege('authenticated', 'app.set_agent_run_id()', 'execute'), 'and its function is not callable by clients');

select * from finish();
rollback;
