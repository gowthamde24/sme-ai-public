-- T007 M2 / claim-home follow-ups:
--   A a lead with no company is refused at START (before any fetch or model spend)
--   B agent_write_claim: a run naming a company AND a lead must name a lead OF that company
--   C a client cannot forge an agent claim (set_config + direct insert) nor set source_lead_id, in any way
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_definitions set allowed_predicates = array['selftest.observation', 'buyer_type', 'operating_status', 'size_band', 'order_scale'] where agent_name = 'selftest';
update public.agent_limits set limit_value = 100 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');

create function pg_temp.sc(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(p_uid, p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.start_sql(p_run uuid, p_kind text, p_target uuid) returns text language sql as $$
  select format('select public.start_agent_run(%L, %L, ''selftest'', ''v1'', %L, %L, %L, ''{}''::jsonb)', p_run, tests.tid('a'), p_kind, p_target, repeat('a', 64)) $$;
create function pg_temp.ev_sql(p_run uuid, p_step text) returns text language sql as $$
  select format('select public.agent_write_evidence(%L, %L, ''note''::public.evidence_kind, null, null, ''DEMO agent note'')', p_run, p_step) $$;
create function pg_temp.cl_sql(p_run uuid, p_step text, p_evidence uuid) returns text language sql as $$
  select format('select public.agent_write_claim(%L, %L, ''buyer_type'', ''saree_shop'', %L::uuid[], ''supports'')', p_run, p_step, array[p_evidence]) $$;

-- ============================================================================ A. a lead with no company
insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid('orphan_lead'), tests.tid('a'), null, null);
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s_orphan'), 'lead', tests.rid('orphan_lead'))), '23503|invalid reference||||',
  'start_agent_run on a lead with no company: refused (the same 23503 as an unknown lead)');
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s_ghost'), 'lead', gen_random_uuid())), '23503|invalid reference||||', '...identical to an unknown lead');
select is((select count(*) from public.agent_runs where id = tests.rid('s_orphan')), 0::bigint, '...no run was created, so nothing can fetch or call a model for it');
select is((select count(*) from public.agent_cost_reservations where tenant_id = tests.tid('a')), 0::bigint, '...and nothing was reserved');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s_ok'), 'lead', tests.rid('a_lead'))), 'rows:1', 'a lead WITH a company still starts');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s_company'), 'company', tests.rid('a_company'))), 'rows:1', '...and a company target is unchanged');

-- ============================================================================ B. both a company and a lead on one run
-- agent_runs forbids naming both (CHECK num_nonnulls = 1); drop that CHECK in this rolled-back transaction to prove the function does not rely on it
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.agent_runs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%num_nonnulls%' loop
    execute format('alter table public.agent_runs drop constraint %I', c.conname);
  end loop;
end $$;
insert into public.companies (id, tenant_id, name) values (tests.rid('other_company'), tests.tid('a'), 'Other Co');
insert into public.leads (id, tenant_id, company_id) values (tests.rid('other_lead'), tests.tid('a'), tests.rid('other_company'));
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, lead_id, expires_at, input_sha256) values
  (tests.rid('r_mismatch'), tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'), tests.rid('other_lead'), now() + interval '15 minutes', repeat('1', 64)),
  (tests.rid('r_match'),    tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'), tests.rid('a_lead'),     now() + interval '15 minutes', repeat('2', 64));
-- (a run naming both a company and a lead cannot write evidence through the function either: an evidence link names ONE target. So the evidence
-- rows are planted the way the function plants them, as the trusted role with the agent settings, to reach the claim check.)
create function pg_temp.plant_evidence(p_id uuid, p_run uuid) returns void language plpgsql as $$
begin
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', p_run::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('a_sales'), 'role', 'authenticated')::text, true);
  insert into public.evidence (id, tenant_id, kind, provider, reference) values (p_id, tests.tid('a'), 'note', 'agent.selftest', 'run:' || p_run::text);
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
select pg_temp.plant_evidence(tests.rid('ev_mis'), tests.rid('r_mismatch'));
select pg_temp.plant_evidence(tests.rid('ev_ok'), tests.rid('r_match'));
create temp table ev_mis as select tests.rid('ev_mis') as id;
create temp table ev_ok as select tests.rid('ev_ok') as id;
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('r_mismatch'), 'c1', (select id from ev_mis))), '23503|invalid reference||||',
  'a run naming company X and a lead of company Y: the claim is refused (the generic reference error)');
select is((select count(*) from public.claims where agent_run_id = tests.rid('r_mismatch')), 0::bigint, '...and nothing was stored');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('r_match'), 'c1', (select id from ev_ok))), 'replayed'), 'false', 'a run naming a company and one of ITS leads writes the claim');
select is((select company_id || '|' || source_lead_id from public.claims where agent_run_id = tests.rid('r_match')), tests.rid('a_company') || '|' || tests.rid('a_lead'), '...on the company, the lead as provenance');

-- ============================================================================ C. a client cannot forge an agent claim or a source lead
create function pg_temp.forge(p_user text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  -- the settings the definer function sets for itself, set by the CLIENT in its own transaction
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', tests.rid('r_match')::text, true);
  v := tests.outcome_as(tests.uid(p_user), p_sql);
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);
  return v;
end $$;
select is(pg_temp.forge('a_owner', format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, created_via, agent_run_id) values (%L, %L, %L, 'buyer_type', 'saree_shop', 'high', 'agent', %L)$q$,
  gen_random_uuid(), tests.tid('a'), tests.rid('a_company'), tests.rid('r_match'))), '42501', 'an Owner who sets the agent settings and inserts an agent claim directly: refused (no INSERT privilege)');
select is(pg_temp.forge('a_sales', format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, created_via, agent_run_id, source_lead_id) values (%L, %L, %L, 'buyer_type', 'saree_shop', 'high', 'agent', %L, %L)$q$,
  gen_random_uuid(), tests.tid('a'), tests.rid('a_company'), tests.rid('r_match'), tests.rid('a_lead'))), '42501', '...and with a source_lead_id');
select is(pg_temp.forge('a_admin', format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (%L, %L, %L, 'buyer_type', 'saree_shop', 'low')$q$,
  tests.rid('forged_manual'), tests.tid('a'), tests.rid('a_company'))), 'rows:1', 'a client insert with only the columns a client may write succeeds (a human may add a manual claim)');
select is((select created_via::text || '|' || coalesce(agent_run_id::text, 'null') || '|' || coalesce(source_lead_id::text, 'null') from public.claims where id = tests.rid('forged_manual')), 'manual|null|null',
  '...but with the agent settings set it is still MANUAL: no run id, no source lead (the role decides the origin, never the setting)');
select is(pg_temp.forge('a_owner', format($q$update public.claims set source_lead_id = %L, created_via = 'agent' where agent_run_id = %L$q$, tests.rid('a_lead'), tests.rid('r_match'))), '42501', 'nor can a client rewrite a claim into an agent claim or set its source lead (no UPDATE privilege)');
select is(pg_temp.forge('a_owner', format($q$delete from public.claims where agent_run_id = %L$q$, tests.rid('r_match'))), '42501', '...or delete one');
select is(pg_temp.forge('a_owner', format($q$insert into public.evidence (id, tenant_id, kind, provider, url, created_via, agent_run_id) values (%L, %L, 'web_page', 'agent.selftest', 'https://example.test/x', 'agent', %L)$q$,
  gen_random_uuid(), tests.tid('a'), tests.rid('r_match'))), '42501', 'the same for evidence');
select is((select count(*) from public.claims where tenant_id = tests.tid('a') and agent_run_id = tests.rid('r_match')), 1::bigint, 'only the one claim the function wrote exists');
-- the trusted role (the function owner) cannot create the forged shapes either: the table CHECKs hold
select throws_ok(format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, source_lead_id, created_by) values (%L, %L, %L, 'buyer_type', 'saree_shop', 'unverified', %L, %L)$q$,
  gen_random_uuid(), tests.tid('a'), tests.rid('a_company'), tests.rid('a_lead'), tests.uid('a_sales')), '23514', null, 'a manual claim with a source lead violates the CHECK even for the table owner');
select throws_ok(format($q$insert into public.claims (id, tenant_id, company_id, lead_id, predicate, value, confidence, created_via, agent_run_id, source_lead_id) values (%L, %L, %L, %L, 'buyer_type', 'saree_shop', 'unverified', 'agent', %L, %L)$q$,
  gen_random_uuid(), tests.tid('a'), tests.rid('a_company'), tests.rid('a_lead'), tests.rid('r_match'), tests.rid('a_lead')), '23514', null, 'an agent claim with BOTH a lead_id and a source_lead_id violates the CHECK');

select * from finish();
rollback;
