-- T007 M2 / 2: THE CLAIM HOME. A claim of a lead-target run is stored on the lead's COMPANY (the place every score reader looks),
-- the lead stays as provenance (claims.source_lead_id), nothing old is rewritten, and old lead-target rows still read.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
-- the scoring predicates are not selftest's own: widen its allow-list inside this rolled-back transaction
update public.agent_definitions set allowed_predicates = array['selftest.observation', 'buyer_type', 'operating_status', 'size_band', 'order_scale'] where agent_name = 'selftest';

create function pg_temp.ev_sql(p_run uuid, p_step text) returns text language sql as $$
  select format('select public.agent_write_evidence(%L, %L, ''note''::public.evidence_kind, null, null, ''DEMO agent note'')', p_run, p_step) $$;
create function pg_temp.cl_sql(p_run uuid, p_step text, p_evidence uuid, p_predicate text, p_value text) returns text language sql as $$
  select format('select public.agent_write_claim(%L, %L, %L, %L, %L::uuid[], ''supports'')', p_run, p_step, p_predicate, p_value, array[p_evidence]) $$;
create function pg_temp.newrun(p_name text, p_tenant text, p_user text, p_company text, p_lead text) returns uuid language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, lead_id, expires_at, input_sha256)
  values (tests.rid(p_name), tests.tid(p_tenant), tests.uid(p_user), 'selftest', 'v1',
          case when p_company is not null then tests.rid(p_company) end, case when p_lead is not null then tests.rid(p_lead) end,
          now() + interval '15 minutes', repeat('1', 64));
  return tests.rid(p_name);
end $$;
-- one evidence row + one claim through the real functions, as a_sales; returns the claim id
create function pg_temp.propose(p_run text, p_predicate text, p_value text) returns uuid language plpgsql as $$
declare v_ev uuid; v_claim uuid;
begin
  v_ev := (tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid(p_run), p_run || '_e'))::jsonb ->> 'evidence_id')::uuid;
  v_claim := (tests.scalar_as(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid(p_run), p_run || '_c', v_ev, p_predicate, p_value))::jsonb ->> 'claim_id')::uuid;
  return v_claim;
end $$;
create function pg_temp.review(p_user text, p_review text, p_claim uuid, p_decision text, p_conf text default null, p_reason text default null) returns text language sql as $$
  select tests.outcome_as(tests.uid(p_user), format('select public.review_claim(%L, %L, %L::public.claim_review_decision, %L::public.claim_confidence, %L::public.claim_review_reason)',
    tests.rid(p_review), p_claim, p_decision, p_conf, p_reason)) $$;
create function pg_temp.scored(p_user text, p_company text, p_tenant text default 'a') returns text language plpgsql as $$
declare v text; v_tenant uuid := tests.tid(p_tenant); v_company uuid := tests.rid(p_company); v_uid uuid := tests.uid(p_user);
begin
  perform tests.set_identity(v_uid);
  select coalesce(string_agg(predicate || ':' || value, ',' order by predicate, value), '') into v
    from public.claims_for_scoring where tenant_id = v_tenant and company_id = v_company;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

-- ============================================================================ 1. the schema
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'claims' and column_name = 'source_lead_id'), 'claims.source_lead_id exists');
select is((select count(*) from pg_constraint where conrelid = 'public.claims'::regclass and contype = 'f' and confrelid = 'public.leads'::regclass), 2::bigint, 'two foreign keys to leads: lead_id (old shape) and source_lead_id');
select is((select count(*) from pg_constraint where conrelid = 'public.claims'::regclass and conname = 'claims_source_lead_agent_chk'), 1::bigint, 'the CHECK that only an agent claim with a company home may carry a source lead exists');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, source_lead_id) values (%L, %L, %L, 'buyer_type', 'saree_shop', %L)$q$, gen_random_uuid(), tests.tid('a'), tests.rid('a_company'), tests.rid('a_lead'))), '42501', 'a client cannot insert claims at all (no grant), so it cannot set source_lead_id either');
create function pg_temp.try_as(p_via text, p_run uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('app.created_via', p_via, true);
  perform set_config('app.agent_run_id', coalesce(p_run::text, ''), true);
  -- a trusted-role insert still needs an author for a non-agent claim: name one (auth.uid() reads this setting)
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('a_sales'), 'role', 'authenticated')::text, true);
  begin execute p_sql; perform set_config('app.created_via', '', true); perform set_config('app.agent_run_id', '', true); perform set_config('request.jwt.claims', '', true); return 'ok';
  exception when others then perform set_config('app.created_via', '', true); perform set_config('app.agent_run_id', '', true); perform set_config('request.jwt.claims', '', true); return sqlstate; end;
end $$;
select is(pg_temp.try_as('import', null, format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, source_lead_id) values (%L, %L, %L, 'buyer_type', 'saree_shop', 'unverified', %L)$q$, gen_random_uuid(), tests.tid('a'), tests.rid('a_company'), tests.rid('a_lead'))), '23514', 'even the trusted role cannot attach a source lead to a NON-agent claim: the CHECK refuses');
select is((select count(*) from public.claims where source_lead_id is not null and tenant_id = tests.tid('a')), 0::bigint, '...and nothing was written');

-- ============================================================================ 2. a LEAD run: the claim lives on the lead's company
select pg_temp.newrun('r_lead', 'a', 'a_sales', null, 'a_lead');
create temp table c1 as select pg_temp.propose('r_lead', 'buyer_type', 'saree_shop') as id;
select results_eq(format($$select company_id = %L::uuid, lead_id is null, source_lead_id = %L::uuid, created_via::text, agent_run_id = %L::uuid from public.claims where id = %L$$,
                          tests.rid('a_company'), tests.rid('a_lead'), tests.rid('r_lead'), (select id from c1)),
  $$values (true, true, true, 'agent'::text, true)$$, 'the claim: home company = the lead''s company, lead_id NULL, source_lead_id = the lead, agent origin, this run');
select is((select lead_id from public.agent_runs where id = tests.rid('r_lead')), tests.rid('a_lead'), 'the run still records the lead as its target');
select is((select count(*) from public.evidence_links where agent_run_id = tests.rid('r_lead') and lead_id = tests.rid('a_lead') and company_id is null), 1::bigint, 'the evidence of a lead run is still linked to the LEAD');
-- a company run: no source lead
select pg_temp.newrun('r_company', 'a', 'a_sales', 'a_company', null);
create temp table c2 as select pg_temp.propose('r_company', 'size_band', 'medium') as id;
select results_eq(format($$select company_id = %L::uuid, lead_id is null, source_lead_id is null from public.claims where id = %L$$, tests.rid('a_company'), (select id from c2)),
  $$values (true, true, true)$$, 'a company run: company home, no source lead (unchanged behaviour)');

-- ============================================================================ 3. a lead with no company cannot receive a claim
create function pg_temp.mk_orphan_lead() returns void language plpgsql as $$
begin
  insert into public.leads (id, tenant_id, company_id) values (tests.rid('a_lead_nocompany'), tests.tid('a'), null);
exception when others then
  raise notice 'leads.company_id is NOT NULL here: %', sqlerrm;
end $$;
select pg_temp.mk_orphan_lead();
select pg_temp.newrun('r_orphan', 'a', 'a_sales', null, 'a_lead_nocompany');
create temp table e3 as select (tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('r_orphan'), 'o_e'))::jsonb ->> 'evidence_id')::uuid as id;
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('r_orphan'), 'o_c', (select id from e3), 'buyer_type', 'saree_shop')) like '23503|%' or
          not exists (select 1 from public.leads where id = tests.rid('a_lead_nocompany')), true,
          'a lead with no company: the claim is refused with the generic reference error (or such a lead cannot exist here)');

-- ============================================================================ 4. scoring: unaccepted never, rejected never, accepted yes
select is(pg_temp.scored('a_sales', 'a_company'), '', 'unaccepted agent claims (both) are not in the scoring view');
select is(pg_temp.review('a_owner', 'rv1', (select id from c1), 'accepted', 'high'), 'rows:1', 'an Owner accepts the lead-run claim');
select is(pg_temp.scored('a_sales', 'a_company'), 'buyer_type:saree_shop', 'only the ACCEPTED claim reaches the scoring view, under the company');
select is(pg_temp.review('a_owner', 'rv2', (select id from c2), 'rejected', null, 'incorrect'), 'rows:1', 'an Owner rejects the company-run claim');
select is(pg_temp.scored('a_sales', 'a_company'), 'buyer_type:saree_shop', 'a REJECTED claim never reaches it');
select is(pg_temp.review('a_owner', 'rv3', (select id from c1), 'rejected', null, 'outdated'), 'rows:1', 'the newest review wins: the accepted claim is rejected afterwards');
select is(pg_temp.scored('a_sales', 'a_company'), '', '...and it leaves the scoring view');
select is(pg_temp.review('a_owner', 'rv4', (select id from c1), 'accepted', 'medium'), 'rows:1', 'accepted again');
select is(pg_temp.scored('a_sales', 'a_company'), 'buyer_type:saree_shop', '...and it is back, once');
select is((select count(*) from public.claims_for_scoring where id = (select id from c1)), 1::bigint, 'no double counting: one claim, one row in the scoring view');

-- ============================================================================ 5. the views read BOTH shapes
-- an OLD-shape row (how T006 stored a lead-run claim): lead_id set, company_id NULL; inserted as the trusted role, as the old function did
select pg_temp.newrun('r_old', 'a', 'a_sales', null, 'a_lead');
select set_config('app.created_via', 'agent', true), set_config('app.agent_run_id', tests.rid('r_old')::text, true);
insert into public.claims (id, tenant_id, company_id, lead_id, predicate, value, confidence) values (tests.rid('old_claim'), tests.tid('a'), null, tests.rid('a_lead'), 'operating_status', 'active', 'unverified');
select set_config('app.created_via', '', true), set_config('app.agent_run_id', '', true);
select is(pg_temp.try_as('agent', tests.rid('r_old'), format($q$insert into public.claims (id, tenant_id, lead_id, predicate, value, confidence, source_lead_id) values (%L, %L, %L, 'buyer_type', 'saree_shop', 'unverified', %L)$q$, gen_random_uuid(), tests.tid('a'), tests.rid('a_lead'), tests.rid('a_lead'))), '23514', 'a source lead needs a company home: a lead-home row cannot carry one');
select results_eq(format($$select home_company_id = %L::uuid, about_lead_id = %L::uuid from public.claims_effective where id = %L$$, tests.rid('a_company'), tests.rid('a_lead'), tests.rid('old_claim')),
  $$values (true, true)$$, 'claims_effective: an old lead-target row resolves its home company and keeps its lead');
select results_eq(format($$select home_company_id = %L::uuid, about_lead_id = %L::uuid from public.claims_effective where id = %L$$, tests.rid('a_company'), tests.rid('a_lead'), (select id from c1)),
  $$values (true, true)$$, 'a new row: home company from company_id, lead from source_lead_id');
select is((select count(*) from public.claims_effective where id in (tests.rid('old_claim'), (select id from c1), (select id from c2))), 3::bigint, 'each claim appears once in claims_effective');
select is(pg_temp.scored('a_sales', 'a_company'), 'buyer_type:saree_shop', 'the old row is unreviewed: not scored');
select is(pg_temp.review('a_owner', 'rv5', tests.rid('old_claim'), 'accepted', 'low'), 'rows:1', 'an Owner accepts the OLD-shape claim');
select is(pg_temp.scored('a_sales', 'a_company'), 'buyer_type:saree_shop,operating_status:active', 'it now reads under its lead''s company, next to the new-shape claim');
select is((select count(*) from public.claims_for_scoring where company_id = tests.rid('a_company') and predicate in ('buyer_type', 'operating_status')), 2::bigint, 'two claims, two rows: nothing is counted twice');
select is((select count(*) from public.claims_for_scoring where id = tests.rid('old_claim') and lead_id = tests.rid('a_lead')), 1::bigint, '(the old row keeps its own lead_id in the scoring view)');
select is((select count(*) from public.claims where id = tests.rid('old_claim') and company_id is null and lead_id = tests.rid('a_lead')), 1::bigint, 'the old row itself was not rewritten');
-- a lead page lists both shapes
select is((select count(*) from public.claims_effective where about_lead_id = tests.rid('a_lead')), 2::bigint, 'about_lead_id lists the old row and the new lead-run claim (the company-run claim is not about the lead)');

-- ============================================================================ 6. immutability and isolation
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.claims set source_lead_id = null where id = %L$q$, (select id from c1))), '42501', 'an Owner cannot change source_lead_id after the fact (claims are immutable)');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.claims set company_id = %L where id = %L$q$, tests.rid('b_company'), (select id from c1))), '42501', '...nor move a claim to another company (or tenant)');
select is(pg_temp.scored('b_owner', 'a_company', 'a'), '', 'tenant B sees nothing of tenant A through the scoring view');
select is(pg_temp.scored('b_sales', 'b_company', 'b'), '', 'tenant B''s own company has no claims');

-- ============================================================================ 7. a foreign lead id gets the generic refusal
create function pg_temp.start_lead(p_user text, p_tenant text, p_lead text) returns text language sql as $$
  select tests.error_full_as(tests.uid(p_user), format('select public.start_agent_run(%L, %L, ''selftest'', ''v1'', ''lead'', %L, %L, ''{}''::jsonb, null, null::jsonb)', gen_random_uuid(), tests.tid(p_tenant), tests.rid(p_lead), repeat('a', 64))) $$;
-- agents ON for tenant B too, so the refusal we look at is the reference check and not 'agents are off'
insert into public.tenant_agent_settings (tenant_id, enabled) values (tests.tid('b'), true);
update public.agent_definitions set allowed_tenants = array[tests.tid('a'), tests.tid('b')] where agent_name = 'selftest';
update public.agent_runs set status = 'succeeded', finished_at = now();
select is(substr(pg_temp.start_lead('b_sales', 'b', 'a_lead'), 1, 6), '23503|', 'tenant B naming tenant A''s lead id in B: the fixed "invalid reference" refusal');
select is(pg_temp.start_lead('b_sales', 'b', 'a_lead'), pg_temp.start_lead('b_sales', 'b', 'a_company'), '...identical to a company id that is not a lead of B: no oracle for what exists elsewhere');
select is(pg_temp.start_lead('b_sales', 'a', 'a_lead'), pg_temp.start_lead('outsider', 'a', 'a_lead'), 'aiming at tenant A itself: the generic refusal, the same as for a stranger');
select ok(pg_temp.start_lead('b_sales', 'b', 'a_lead') !~ '[0-9a-f]{8}-[0-9a-f]{4}', 'and the message carries no id');
select is((select count(*) from public.claims where tenant_id = tests.tid('b')), 0::bigint, 'nothing was written in tenant B');

select * from finish();
rollback;
