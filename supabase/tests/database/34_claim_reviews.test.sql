-- T006 / M1 (ADR 0013): promotion of an agent claim = public.review_claim. Owner and Admin only (decision 1); one claim per call;
-- the origin of a review is forced to manual; the tenant comes from the CLAIM, never from an argument.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

-- agent claims, built the way the write path builds them (privileged, with the two GUCs)
create function pg_temp.mk(p_name text, p_run uuid, p_tenant text, p_with_link boolean default true) returns void
language plpgsql as $$
begin
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', p_run::text, true);
  insert into public.evidence (id, tenant_id, kind, provider, reference) values (tests.rid(p_name || '_ev'), tests.tid(p_tenant), 'note', 'agent.selftest', 'run:' || p_run);
  insert into public.claims (id, tenant_id, company_id, predicate, value, confidence)
  values (tests.rid(p_name), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'selftest.observation', 'DEMO value ' || p_name, 'unverified');
  if p_with_link then
    insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance) values (tests.rid(p_name || '_lk'), tests.tid(p_tenant), tests.rid(p_name || '_ev'), tests.rid(p_name), 'supports');
  else
    insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance) values (tests.rid(p_name || '_lk'), tests.tid(p_tenant), tests.rid(p_name || '_ev'), tests.rid(p_name), 'context');
  end if;
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);
end $$;
select pg_temp.mk('c_sales', tests.rid('a_run_sales'), 'a');            -- by a_sales's run, with a supporting link
select pg_temp.mk('c_admin', tests.rid('a_run_admin'), 'a');            -- by a_admin's run
select pg_temp.mk('c_nolink', tests.rid('a_run_sales'), 'a', false);    -- only a 'context' link: no SUPPORTING evidence
select pg_temp.mk('c_b', tests.rid('b_run'), 'b');                       -- tenant B
insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (tests.rid('c_manual'), tests.tid('a'), tests.rid('a_company'), 'exports_to', 'manual', 'low');

create function pg_temp.rv(p_review text, p_claim text, p_decision text, p_conf text default null, p_reason text default null) returns text
language sql as $$
  select format('select public.review_claim(%L, %L, %L::public.claim_review_decision, %L::public.claim_confidence, %L::public.claim_review_reason)',
                tests.rid(p_review), tests.rid(p_claim), p_decision, p_conf, p_reason)
$$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(case when p_user is null then null else tests.uid(p_user) end, p_sql) $$;

-- ============================================================================ A. properties
select is((select count(*) from pg_proc where proname = 'review_claim' and pronamespace = 'public'::regnamespace), 1::bigint, 'one overload');
select ok((select prosecdef and 'search_path=""' = any (proconfig) and proowner::regrole::text = 'postgres' from pg_proc where proname = 'review_claim'), 'SECURITY DEFINER, empty search_path, owned by the migration role');
select ok(has_function_privilege('authenticated', 'public.review_claim(uuid,uuid,public.claim_review_decision,public.claim_confidence,public.claim_review_reason)', 'execute')
          and not has_function_privilege('anon', 'public.review_claim(uuid,uuid,public.claim_review_decision,public.claim_confidence,public.claim_review_reason)', 'execute'), 'authenticated may execute, anon may not');
select is((select proargnames::text from pg_proc where proname = 'review_claim'), '{p_review_id,p_claim_id,p_decision,p_confidence,p_reason_code}', 'ONE claim id per call, no tenant parameter');
select is((select string_agg(t::regtype::text, ',') from pg_proc, unnest(proargtypes::oid[]) t where proname = 'review_claim'), 'uuid,uuid,claim_review_decision,claim_confidence,claim_review_reason', '...and the claim id is a scalar uuid, not an array');
select is((select prosrc ~* '\mexecute\M' from pg_proc where proname = 'review_claim'), false, 'no dynamic SQL');
select is((select coalesce(string_agg(distinct m[1], ',' order by m[1]), '') from pg_proc, regexp_matches(prosrc, 'insert\s+into\s+public\.(\w+)', 'gi') m where proname = 'review_claim'), 'claim_reviews', 'it inserts into claim_reviews and nothing else');

-- ============================================================================ B. only Owner and Admin; every other refusal is identical
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.rv('r1', 'c_sales', 'accepted', 'medium')), 'rows:1', 'Owner may accept');
select is(tests.outcome_as(tests.uid('a_admin'), pg_temp.rv('r2', 'c_admin', 'rejected', null, 'incorrect')), 'rows:1', 'Admin may reject');
select is(pg_temp.err('a_sales', pg_temp.rv('s1', 'c_sales', 'accepted', 'low')), '42501|agent action not permitted||||', 'Sales may NOT review (only Owner and Admin)');
select is(pg_temp.err('a_viewer', pg_temp.rv('s2', 'c_sales', 'accepted', 'low')), pg_temp.err('a_sales', pg_temp.rv('s1', 'c_sales', 'accepted', 'low')), 'Viewer: identical');
select is(pg_temp.err('outsider', pg_temp.rv('s3', 'c_sales', 'accepted', 'low')), pg_temp.err('a_sales', pg_temp.rv('s1', 'c_sales', 'accepted', 'low')), 'a user with no tenant: identical');
select is(pg_temp.err('b_owner', pg_temp.rv('s4', 'c_sales', 'accepted', 'low')), pg_temp.err('a_sales', pg_temp.rv('s1', 'c_sales', 'accepted', 'low')), 'an Owner of ANOTHER tenant on a real claim: identical');
select is(tests.error_full_as(tests.uid('a_owner'), format($q$select public.review_claim(%L, %L, 'accepted', 'low', null)$q$, tests.rid('s5'), gen_random_uuid())), '42501|agent action not permitted||||', 'an Owner and a claim that does not exist: identical');
select is(pg_temp.err('dual', pg_temp.rv('s6', 'c_b', 'accepted', 'low')), '42501|agent action not permitted||||', 'dual (Viewer of B) on B''s claim: identical');
select is(pg_temp.err(null, pg_temp.rv('s7', 'c_sales', 'accepted', 'low')), '42501|permission denied for function review_claim||||', 'anon: no EXECUTE');
select is((select count(*) from public.claim_reviews where tenant_id in (tests.tid('a'), tests.tid('b'))), 2::bigint, 'none of the refusals wrote a review');

-- ============================================================================ C. rules
select is(substr(pg_temp.err('a_owner', pg_temp.rv('c1', 'c_manual', 'accepted', 'low')), 1, 5), '23514', 'only AGENT claims are reviewed: a manual claim is refused (23514)');
update public.claims set archived_at = now() where id = tests.rid('c_nolink');
select is(substr(pg_temp.err('a_owner', pg_temp.rv('c2', 'c_nolink', 'accepted', 'low')), 1, 5), '23514', 'an archived claim is refused (23514)');
update public.claims set archived_at = null where id = tests.rid('c_nolink');
select is(substr(pg_temp.err('a_owner', pg_temp.rv('c3', 'c_sales', 'accepted')), 1, 5), '22023', 'accepted without a confidence: 22023');
select is(substr(pg_temp.err('a_owner', pg_temp.rv('c4', 'c_sales', 'accepted', 'unverified')), 1, 5), '22023', 'a human cannot accept at "unverified": 22023');
select is(substr(pg_temp.err('a_owner', pg_temp.rv('c5', 'c_sales', 'rejected', null, null)), 1, 5), '22023', 'rejected without a reason: 22023');
select is(substr(pg_temp.err('a_owner', pg_temp.rv('c6', 'c_sales', 'rejected', 'high', 'incorrect')), 1, 5), '22023', 'rejected with a confidence: 22023');
select is(substr(pg_temp.err('a_owner', pg_temp.rv('c7', 'c_sales', 'accepted', 'low', 'incorrect')), 1, 5), '22023', 'accepted with a rejection reason: 22023');
select is(pg_temp.err('a_owner', pg_temp.rv('c8', 'c_nolink', 'accepted', 'high')), '23514|value not allowed||||', 'medium / high needs at least one SUPPORTING evidence link (only a context link exists): 23514');
select is(pg_temp.err('a_owner', pg_temp.rv('c9', 'c_nolink', 'accepted', 'medium')), '23514|value not allowed||||', '...medium too');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.rv('c10', 'c_nolink', 'accepted', 'low')), 'rows:1', '...but low can be accepted without a supporting link');
update public.evidence_links set archived_at = now() where id = tests.rid('c_sales_lk');
select is(pg_temp.err('a_owner', pg_temp.rv('c11', 'c_sales', 'accepted', 'high')), '23514|value not allowed||||', 'an ARCHIVED supporting link does not count');
update public.evidence_links set archived_at = null where id = tests.rid('c_sales_lk');
select is(tests.outcome_as(tests.uid('a_admin'), pg_temp.rv('c12', 'c_sales', 'accepted', 'high')), 'rows:1', 'with a live supporting link, high is accepted');

-- ============================================================================ D. self review
select results_eq(format($$select self_review from public.claim_reviews where id = %L$$, tests.rid('r2')), $$values (true)$$, 'a_admin rejects a claim from a_admin''s OWN run: self_review = true');
select results_eq(format($$select self_review from public.claim_reviews where id = %L$$, tests.rid('r1')), $$values (false)$$, 'a_owner accepts a claim from a_sales''s run: self_review = false');

-- ============================================================================ E. the origin is forced, whatever the GUCs say
select set_config('app.created_via', 'agent', true);
select set_config('app.agent_run_id', tests.rid('a_run_sales')::text, true);
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.rv('e1', 'c_admin', 'accepted', 'low')), 'rows:1', 'with app.created_via = agent and a run id pre-set, a review still works...');
select set_config('app.created_via', '', true);
select set_config('app.agent_run_id', '', true);
select results_eq(format($$select created_via::text, created_by from public.claim_reviews where id = %L$$, tests.rid('e1')),
  format($$values ('manual'::text, %L::uuid)$$, tests.uid('a_owner')), '...and the review is MANUAL, attributed to the reviewer');
select is((select count(*) from public.claim_reviews where created_via <> 'manual'), 0::bigint, 'no review of any origin but manual exists');
select is(current_setting('app.created_via', true) || '|' || current_setting('app.agent_run_id', true), '|', 'the function leaves the GUCs cleared');

-- ============================================================================ F. idempotency
create temp table rr1 as select tests.scalar_as(tests.uid('a_owner'), pg_temp.rv('i1', 'c_admin', 'rejected', null, 'outdated')) as r;
create temp table rr2 as select tests.scalar_as(tests.uid('a_owner'), pg_temp.rv('i1', 'c_admin', 'rejected', null, 'outdated')) as r;
select is(pg_temp.j((select r from rr1), 'replayed') || pg_temp.j((select r from rr2), 'replayed'), 'falsetrue', 'the same review id with the same payload is a replay');
select is((select count(*) from public.claim_reviews where id = tests.rid('i1')), 1::bigint, '...one row');
select is(tests.error_shape_as(tests.uid('a_owner'), pg_temp.rv('i1', 'c_admin', 'rejected', null, 'duplicate')), '23505:claim_reviews_pkey:claim_reviews', 'the same id with another payload: 23505 on the primary key');
select is(tests.error_shape_as(tests.uid('a_admin'), pg_temp.rv('i1', 'c_admin', 'rejected', null, 'outdated')), '23505:claim_reviews_pkey:claim_reviews', 'the same id and payload by ANOTHER reviewer: not a replay, 23505');
select tests.scalar_as(tests.uid('b_owner'), pg_temp.rv('b1', 'c_b', 'accepted', 'low'));
select is(tests.error_full_as(tests.uid('a_owner'), pg_temp.rv('b1', 'c_admin', 'accepted', 'low')),
          tests.error_full_as(tests.uid('a_owner'), pg_temp.rv('i1', 'c_admin', 'rejected', null, 'duplicate')),
  'a review id that belongs to ANOTHER tenant fails with exactly the same error as a payload conflict (no oracle)');

-- ============================================================================ G. history is kept; the newest review is the effective one (the view is tested in 36)
select tests.scalar_as(tests.uid('a_owner'), pg_temp.rv('h1', 'c_sales', 'accepted', 'low'));
select pg_sleep(0.01);
select tests.scalar_as(tests.uid('a_owner'), pg_temp.rv('h2', 'c_sales', 'rejected', null, 'unsupported_by_evidence'));
select cmp_ok((select count(*) from public.claim_reviews where claim_id = tests.rid('c_sales')), '>=', 4::bigint, 'every review of a claim is kept (append-only)');

-- ============================================================================ H. audit
select is((select count(*) from public.audit_events where entity_type = 'claim_review' and entity_id = tests.rid('r1') and actor_type = 'user' and actor_user_id = tests.uid('a_owner') and tenant_id = tests.tid('a') and action = 'claim_review.create'), 1::bigint,
  'a review is audited: entity claim_review, actor = the reviewer, type user');
select is((select count(*) from public.audit_events where entity_type = 'claim_review' and to_jsonb(audit_events)::text ~* 'DEMO value'), 0::bigint, 'and the audit row carries no claim text');

select * from finish();
rollback;
