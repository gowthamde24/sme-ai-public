-- T006 review fixes 2: unaccepted AGENT evidence must not influence a lead's score.
-- public.evidence_for_scoring is what the evidence-quality factor reads (the review queue AND the label snapshot):
-- manual / import evidence as before; agent-origin evidence only when it is cited (stance 'supports') by a claim whose NEWEST
-- review is 'accepted'. Security invoker: a caller sees only their own tenants' evidence.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

-- agent evidence on tenant X's lead (and optionally a claim citing it with a stance)
create function pg_temp.agent_ev(p_name text, p_tenant text, p_run text, p_cites text default null, p_stance text default 'supports') returns void
language plpgsql as $$
begin
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', tests.rid(p_run)::text, true);
  insert into public.evidence (id, tenant_id, kind, provider, reference) values (tests.rid(p_name), tests.tid(p_tenant), 'note', 'agent.selftest', 'run:' || p_run);
  insert into public.evidence_links (id, tenant_id, evidence_id, lead_id) values (tests.rid(p_name || '_lead'), tests.tid(p_tenant), tests.rid(p_name), tests.rid(p_tenant || '_lead'));
  if p_cites is not null then
    insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (tests.rid(p_cites), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'selftest.observation', 'v ' || p_cites, 'unverified');
    insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance) values (tests.rid(p_name || '_claim'), tests.tid(p_tenant), tests.rid(p_name), tests.rid(p_cites), p_stance::public.evidence_stance);
  end if;
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);
end $$;

create function pg_temp.review(p_user text, p_review text, p_claim text, p_decision text, p_conf text default null, p_reason text default null) returns text
language sql as $$
  select tests.outcome_as(tests.uid(p_user), format('select public.review_claim(%L, %L, %L::public.claim_review_decision, %L::public.claim_confidence, %L::public.claim_review_reason)',
    tests.rid(p_review), tests.rid(p_claim), p_decision, p_conf, p_reason)) $$;

-- as the owner of tenant A, which evidence names does the scoring view show for A's lead?
create function pg_temp.seen(p_user text default 'a_owner', p_tenant text default 'a') returns text
language plpgsql as $$
declare v text; v_tenant uuid := tests.tid(p_tenant); v_uid uuid := tests.uid(p_user);
begin
  perform tests.set_identity(v_uid);
  begin
    execute format('select coalesce(string_agg(l.link_id::text, '','' order by l.link_id), '''') from public.evidence_for_scoring l where l.tenant_id = %L and l.lead_id is not null', v_tenant) into v;
  exception when others then v := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

-- a manual evidence row on A's lead (always counts)
insert into public.evidence (id, tenant_id, kind, provider, url) values (tests.rid('m_ev'), tests.tid('a'), 'web_page', 'manual', 'https://example.test/m');
insert into public.evidence_links (id, tenant_id, evidence_id, lead_id) values (tests.rid('m_link'), tests.tid('a'), tests.rid('m_ev'), tests.rid('a_lead'));
-- N agent notes, none cited by an accepted claim: n1 cited by an unreviewed claim, n2 by a claim we will reject, n3 by an accepted
-- claim, n4 by a claim accepted but only as CONTEXT, n5 not cited at all
select pg_temp.agent_ev('n1', 'a', 'a_run_sales', 'k1');
select pg_temp.agent_ev('n2', 'a', 'a_run_sales', 'k2');
select pg_temp.agent_ev('n3', 'a', 'a_run_sales', 'k3');
select pg_temp.agent_ev('n4', 'a', 'a_run_sales', 'k4', 'context');
select pg_temp.agent_ev('n5', 'a', 'a_run_sales');
select pg_temp.agent_ev('b1', 'b', 'b_run', 'kb1');

select ok((select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.evidence_for_scoring'::regclass), 'evidence_for_scoring is security_invoker');
select is(tests.outcome_as(null, 'select 1 from public.evidence_for_scoring'), '42501', 'anon: permission denied');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'evidence_for_scoring' and (grantee in ('anon', 'public') or (grantee = 'authenticated' and privilege_type <> 'SELECT'))), 0::bigint, 'only authenticated SELECT');

select is(pg_temp.seen(), tests.rid('m_link')::text, 'N agent notes with no accepted claim: only the manual evidence counts');
select is(pg_temp.review('a_owner', 'r1', 'k1', 'rejected', null, 'incorrect'), 'rows:1', 'sanity: reject k1');
select is(pg_temp.seen(), tests.rid('m_link')::text, 'a rejected claim does not make its evidence count');
select is(pg_temp.review('a_owner', 'r3', 'k3', 'accepted', 'medium'), 'rows:1', 'sanity: accept k3 (medium)');
select is(pg_temp.seen(), (select string_agg(x, ',' order by x) from unnest(array[tests.rid('m_link')::text, tests.rid('n3_lead')::text]) x), 'after a human accepts a claim citing n3, ONLY n3 counts (not n1, n2, n4, n5)');
select is(pg_temp.review('a_owner', 'r4', 'k4', 'accepted', 'low'), 'rows:1', 'accept k4 (its link is only context)');
select is(pg_temp.seen(), (select string_agg(x, ',' order by x) from unnest(array[tests.rid('m_link')::text, tests.rid('n3_lead')::text]) x), 'evidence cited only as context does not count');
select is(pg_temp.review('a_admin', 'r3b', 'k3', 'rejected', null, 'outdated'), 'rows:1', 'the newest review wins: k3 is rejected afterwards');
select is(pg_temp.seen(), tests.rid('m_link')::text, '...and n3 stops counting');

-- foreign tenants
select is(pg_temp.seen('b_owner', 'a'), '', 'tenant B sees none of tenant A''s evidence through the view');
select is(pg_temp.seen('b_owner', 'b'), '', 'tenant B''s unreviewed agent note does not count for B either');
select is(pg_temp.seen('outsider', 'a'), '', 'an outsider sees nothing');

-- an archived link never counts
select is(pg_temp.review('a_owner', 'r3c', 'k3', 'accepted', 'high'), 'rows:1', 'accept k3 again');
update public.evidence_links set archived_at = now() where id = tests.rid('n3_lead');
select is(pg_temp.seen(), tests.rid('m_link')::text, 'an archived link does not count, accepted claim or not');

select * from finish();
rollback;
