-- T006 / M1 (ADR 0013, decision 5): unaccepted agent claims do NOT count toward an ICP score.
-- public.claims_effective shows every claim with its review state; public.claims_for_scoring is what scoring reads: manual and
-- import claims as before, agent claims only when their NEWEST review is "accepted". Both are security_invoker views, so a
-- caller sees only their own tenants' claims, and nothing a foreign tenant does can reach another tenant's score.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

-- claims of every kind about tenant A's company, and one agent claim in tenant B about B's company (same predicate)
create function pg_temp.mk(p_name text, p_via text, p_run uuid, p_tenant text, p_predicate text default 'buyer_type', p_value text default 'saree_shop') returns void
language plpgsql as $$
begin
  perform set_config('app.created_via', p_via, true);
  perform set_config('app.agent_run_id', coalesce(p_run::text, ''), true);
  insert into public.claims (id, tenant_id, company_id, predicate, value, confidence)
  values (tests.rid(p_name), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), p_predicate, p_value, 'unverified');
  if p_via = 'agent' then
    insert into public.evidence (id, tenant_id, kind, provider, reference) values (tests.rid(p_name || '_ev'), tests.tid(p_tenant), 'note', 'agent.selftest', 'run:' || p_run);
    insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance) values (tests.rid(p_name || '_lk'), tests.tid(p_tenant), tests.rid(p_name || '_ev'), tests.rid(p_name), 'supports');
  end if;
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);
end $$;
select pg_temp.mk('k_manual',  'manual', null, 'a', 'size_band', 'large');
select pg_temp.mk('k_import',  'import', null, 'a', 'order_scale', 'five_or_more_per_order');
select pg_temp.mk('k_unrev',   'agent', tests.rid('a_run_sales'), 'a');                              -- unreviewed
select pg_temp.mk('k_accept',  'agent', tests.rid('a_run_sales'), 'a', 'operating_status', 'active');  -- will be accepted
select pg_temp.mk('k_reject',  'agent', tests.rid('a_run_sales'), 'a', 'size_band', 'micro');          -- will be rejected
select pg_temp.mk('k_flip',    'agent', tests.rid('a_run_admin'), 'a', 'order_scale', 'x_flip');       -- accepted, then rejected
select pg_temp.mk('k_b_agent', 'agent', tests.rid('b_run'), 'b');                                      -- tenant B, never reviewed
select pg_temp.mk('k_b_acc',   'agent', tests.rid('b_run'), 'b', 'operating_status', 'active');        -- tenant B, accepted

create function pg_temp.review(p_user text, p_review text, p_claim text, p_decision text, p_conf text default null, p_reason text default null) returns text
language sql as $$
  select tests.outcome_as(tests.uid(p_user), format('select public.review_claim(%L, %L, %L::public.claim_review_decision, %L::public.claim_confidence, %L::public.claim_review_reason)',
    tests.rid(p_review), tests.rid(p_claim), p_decision, p_conf, p_reason)) $$;
select is(pg_temp.review('a_owner', 'v1', 'k_accept', 'accepted', 'medium'), 'rows:1', 'sanity: an Owner accepts one agent claim (medium)');
select is(pg_temp.review('a_owner', 'v2', 'k_reject', 'rejected', null, 'incorrect'), 'rows:1', '...rejects another');
select is(pg_temp.review('a_admin', 'v3', 'k_flip', 'accepted', 'low'), 'rows:1', '...accepts a third');
select is(pg_temp.review('a_admin', 'v4', 'k_flip', 'rejected', null, 'outdated'), 'rows:1', '...and then rejects that same one (the newest review wins)');
select is(pg_temp.review('b_owner', 'v5', 'k_b_acc', 'accepted', 'high'), 'rows:1', 'tenant B''s Owner accepts a tenant-B claim');

-- ============================================================================ the views
select ok((select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.claims_effective'::regclass), 'claims_effective is security_invoker');
select ok((select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.claims_for_scoring'::regclass), 'claims_for_scoring is security_invoker');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('claims_effective', 'claims_for_scoring') and grantee in ('anon', 'public')), 0::bigint, 'anon and PUBLIC hold nothing on the views');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('claims_effective', 'claims_for_scoring') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'authenticated can only SELECT them');
select is(tests.outcome_as(null, 'select 1 from public.claims_for_scoring'), '42501', 'anon: permission denied');

create function pg_temp.scoring_ids(p_user text, p_tenant text default 'a') returns text
language plpgsql as $$
declare v text; v_tenant uuid := tests.tid(p_tenant); v_uid uuid := tests.uid(p_user);
begin
  perform tests.set_identity(v_uid);
  begin
    execute format('select coalesce(string_agg(predicate || '':'' || value, '','' order by predicate, value), '''') from public.claims_for_scoring where tenant_id = %L', v_tenant) into v;
  exception when others then v := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
select is(pg_temp.scoring_ids('a_sales'),
  'operating_status:active,order_scale:five_or_more_per_order,size_band:large',
  'tenant A scoring input: manual + import claims + the ACCEPTED agent claim; NOT the unreviewed, the rejected, or the accepted-then-rejected one');
select is(pg_temp.scoring_ids('a_sales'), (select string_agg(predicate || ':' || value, ',' order by predicate, value)
   from public.claims where tenant_id = tests.tid('a') and id in (tests.rid('k_manual'), tests.rid('k_import'), tests.rid('k_accept'))), 'exactly those three claims');
select is(pg_temp.scoring_ids('a_viewer'), pg_temp.scoring_ids('a_sales'), 'every member sees the same scoring input (it is a tenant fact, not a per-user view)');
select is(pg_temp.scoring_ids('b_owner', 'b'), 'operating_status:active', 'tenant B scoring input: its accepted agent claim only');
select is(pg_temp.scoring_ids('b_owner', 'a'), '', 'tenant B reads NOTHING of tenant A through the view');
select is(pg_temp.scoring_ids('a_owner', 'b'), '', 'and tenant A nothing of tenant B');
select is(pg_temp.scoring_ids('outsider'), '', 'an outsider reads nothing');

-- the confidence the view reports is the HUMAN-assigned one for an accepted claim
select results_eq(format($$select confidence::text from public.claims_for_scoring where id = %L$$, tests.rid('k_accept')), $$values ('medium'::text)$$, 'an accepted agent claim carries the confidence the human assigned (medium), not "unverified"');
select results_eq(format($$select claim_confidence::text, confidence::text, review_state from public.claims_effective where id = %L$$, tests.rid('k_accept')), $$values ('unverified'::text, 'medium'::text, 'accepted'::text)$$, 'claims_effective shows both: the claim''s own confidence and the effective one');
select is((select review_state from public.claims_effective where id = tests.rid('k_unrev')), 'unreviewed', 'an agent claim with no review is "unreviewed"');
select is((select review_state from public.claims_effective where id = tests.rid('k_reject')), 'rejected', 'a rejected one is "rejected"');
select is((select review_state from public.claims_effective where id = tests.rid('k_flip')), 'rejected', 'accepted-then-rejected is "rejected": the NEWEST review wins');
select is((select review_state from public.claims_effective where id = tests.rid('k_manual')), 'not_applicable', 'a manual claim is not subject to review');
select is((select review_state from public.claims_effective where id = tests.rid('k_import')), 'not_applicable', 'nor is an imported one');
-- and the other direction: reject then accept again
select is(pg_temp.review('a_owner', 'v6', 'k_flip', 'accepted', 'low'), 'rows:1', 'a later acceptance revives it');
select is((select review_state from public.claims_effective where id = tests.rid('k_flip')), 'accepted', '...the newest review wins in both directions');
select is(pg_temp.scoring_ids('a_sales'), 'operating_status:active,order_scale:five_or_more_per_order,order_scale:x_flip,size_band:large', '...and it counts again');
-- archiving removes a claim from scoring whatever its review says
update public.claims set archived_at = now() where id = tests.rid('k_accept');
select is(pg_temp.scoring_ids('a_sales') like '%operating_status%', false, 'an archived claim is not a scoring input');

-- ============================================================================ nothing a foreign tenant does can reach another tenant's input
-- B cannot review A's claims, cannot attach reviews to them, cannot aim a claim at A's company
select is(pg_temp.review('b_owner', 'x1', 'k_unrev', 'accepted', 'high'), '42501', 'tenant B''s Owner cannot review tenant A''s claim');
select is(tests.outcome_as(tests.uid('b_owner'), format($q$insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, self_review) values (gen_random_uuid(), %L, %L, 'accepted', 'high', false)$q$, tests.tid('b'), tests.rid('k_unrev'))), '42501', 'nor insert a review row directly (no INSERT grant)');
select is((select agent_run_id is not null from public.claims where id = tests.rid('k_b_acc')), true, 'sanity: B''s claim is an agent claim of B''s run');
select is(
  (select count(*) from public.claims_for_scoring s where s.tenant_id = tests.tid('b') and s.company_id <> tests.rid('b_company')), 0::bigint,
  'every scoring input of tenant B is about a company of tenant B');
-- a review row is joined to its claim by (tenant_id, claim_id): a review in tenant A can never revive a claim of tenant B
insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, self_review) values (tests.rid('x2'), tests.tid('a'), tests.rid('k_unrev'), 'accepted', 'high', false);
select is(pg_temp.scoring_ids('b_owner', 'b'), 'operating_status:active', 'a review that exists in tenant A changes nothing in tenant B''s scoring input');
select throws_ok(format($q$insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, self_review) values (gen_random_uuid(), %L, %L, 'accepted', 'high', false)$q$, tests.tid('a'), tests.rid('k_b_agent')), '23503', null,
  'a review in tenant A cannot even reference a claim of tenant B (composite foreign key)');

select * from finish();
rollback;
