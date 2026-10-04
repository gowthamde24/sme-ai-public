-- T006 / M1 (ADR 0013, decision 7): the audit trail tells the truth about delegated agent writes.
-- Before this migration app.write_audit_event recorded actor_type = 'user' whenever a JWT subject existed, so an agent's write
-- made with a human's token read as that human's own. Now: content written through the agent functions is actor_type 'agent',
-- names the run, and keeps the starting human as actor_user_id ("on behalf of"). Manual writes stay 'user'.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.audit_of(p_entity text, p_id uuid) returns text language sql as $$
  select coalesce(string_agg(actor_type || '/' || coalesce(actor_user_id::text, 'null') || '/' || coalesce(agent_run_id::text, 'null') || '/' || action, ',' order by id), '')
    from public.audit_events where entity_type = p_entity and entity_id = p_id $$;

-- ============================================================================ the column
select has_column('public', 'audit_events', 'agent_run_id', 'audit_events.agent_run_id exists');
select is((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'audit_events' and column_name = 'agent_run_id'), 'YES', '...and is nullable (most events are not agent events)');
select is((select count(*) from pg_constraint where conrelid = 'public.audit_events'::regclass and contype = 'f' and confrelid = 'public.agent_runs'::regclass), 0::bigint, '...with NO foreign key (the trail must outlive the run)');
select is(has_column_privilege('authenticated', 'public.audit_events', 'agent_run_id', 'INSERT') or has_column_privilege('authenticated', 'public.audit_events', 'agent_run_id', 'UPDATE'), false, 'no client can write it');

-- ============================================================================ an agent's writes
create temp table w as select
  tests.scalar_as(tests.uid('a_sales'), format($q$select public.agent_write_evidence(%L, 'w1', 'note', null, null, 'DEMO agent note')$q$, tests.rid('a_run_sales'))) as ev;
create temp table w2 as select
  tests.scalar_as(tests.uid('a_sales'), format($q$select public.agent_write_claim(%L, 'w2', 'selftest.observation', 'DEMO observation', array[%L]::uuid[])$q$, tests.rid('a_run_sales'), (select pg_temp.j(ev, 'evidence_id') from w)::uuid)) as cl;

select is(pg_temp.audit_of('evidence', (select pg_temp.j(ev, 'evidence_id')::uuid from w)),
          'agent/' || tests.uid('a_sales') || '/' || tests.rid('a_run_sales') || '/evidence.create',
          'the evidence an agent wrote: actor_type agent, on behalf of the starting human, naming the run');
select is(pg_temp.audit_of('evidence_link', (select pg_temp.j(ev, 'link_id')::uuid from w)),
          'agent/' || tests.uid('a_sales') || '/' || tests.rid('a_run_sales') || '/evidence_link.create', 'its link: the same');
select is(pg_temp.audit_of('claim', (select pg_temp.j(cl, 'claim_id')::uuid from w2)),
          'agent/' || tests.uid('a_sales') || '/' || tests.rid('a_run_sales') || '/claim.create', 'the claim: the same');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and actor_type = 'agent' and agent_run_id is distinct from tests.rid('a_run_sales')), 0::bigint, 'every agent audit row names THE run');
select is((select count(*) from public.audit_events where actor_type = 'agent' and actor_user_id is null), 0::bigint, 'and an agent row always has the accountable human');
select is((select count(*) from public.audit_events where actor_type = 'agent' and to_jsonb(audit_events)::text ~* 'DEMO agent note|DEMO observation'), 0::bigint, 'the audit rows of agent writes carry no snippet or claim text (PII columns are audited by name)');

-- ============================================================================ manual writes are still 'user', with no run
insert into public.evidence (id, tenant_id, kind, provider, url) values (tests.rid('m_ev_seed'), tests.tid('a'), 'web_page', 'manual', 'https://example.test/seed');
select tests.scalar_as(tests.uid('a_sales'), format($q$insert into public.evidence (id, tenant_id, kind, provider, url) values (%L, %L, 'web_page', 'manual', 'https://example.test/m') returning id$q$, tests.rid('m_ev'), tests.tid('a')));
select is(pg_temp.audit_of('evidence', tests.rid('m_ev')), 'user/' || tests.uid('a_sales') || '/null/evidence.create', 'a manual evidence row by a human is actor_type user with no run');
select is(pg_temp.audit_of('evidence', tests.rid('m_ev_seed')), 'system/null/null/evidence.create', 'and privileged maintenance (no JWT) stays system');

-- ============================================================================ a client cannot make its own writes look like (or hide as) an agent's
create function public.zz_client_audit_forges(p_run uuid, p_id uuid, p_tenant uuid) returns void language plpgsql as $$
begin
  perform set_config('app.agent_run_id', p_run::text, true);
  perform set_config('app.created_via', 'agent', true);
  insert into public.evidence (id, tenant_id, kind, provider, url) values (p_id, p_tenant, 'web_page', 'manual', 'https://example.test/forged-audit');
  perform set_config('app.agent_run_id', '', true);
  perform set_config('app.created_via', '', true);
end $$;
grant execute on function public.zz_client_audit_forges(uuid, uuid, uuid) to authenticated;
-- a_sales names her OWN running run
select tests.outcome_as(tests.uid('a_sales'), format($q$select public.zz_client_audit_forges(%L, %L, %L)$q$, tests.rid('a_run_sales'), tests.rid('forge1'), tests.tid('a')));
select is(pg_temp.audit_of('evidence', tests.rid('forge1')), 'agent/' || tests.uid('a_sales') || '/' || tests.rid('a_run_sales') || '/evidence.create',
  'DOCUMENTED LIMIT: a client holding its own running run id could label its OWN audit row as that run (the row itself is still manual; this needs the client to set a database setting, which PostgREST does not allow)');
select is((select created_via::text from public.evidence where id = tests.rid('forge1')), 'manual', 'the forged evidence row itself is manual with no run id');
select is((select agent_run_id is null from public.evidence where id = tests.rid('forge1')), true, '...and carries no run id');
-- naming ANOTHER user's run, or another tenant's run, never works
select tests.outcome_as(tests.uid('a_sales'), format($q$select public.zz_client_audit_forges(%L, %L, %L)$q$, tests.rid('a_run_admin'), tests.rid('forge2'), tests.tid('a')));
select is(pg_temp.audit_of('evidence', tests.rid('forge2')), 'user/' || tests.uid('a_sales') || '/null/evidence.create', 'naming another user''s run: the audit row stays actor_type user, no run');
select tests.outcome_as(tests.uid('a_sales'), format($q$select public.zz_client_audit_forges(%L, %L, %L)$q$, tests.rid('b_run'), tests.rid('forge3'), tests.tid('a')));
select is(pg_temp.audit_of('evidence', tests.rid('forge3')), 'user/' || tests.uid('a_sales') || '/null/evidence.create', 'naming another tenant''s run: the same');
-- the SAME user, naming a run THEY started in ANOTHER tenant, writing in this one: the run's tenant must match
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
values (tests.rid('dual_b_run'), tests.tid('b'), tests.uid('dual'), 'selftest', 'v1', tests.rid('b_company'), now() + interval '10 minutes', repeat('9', 64), '{}'::jsonb);
select tests.outcome_as(tests.uid('dual'), format($q$select public.zz_client_audit_forges(%L, %L, %L)$q$, tests.rid('dual_b_run'), tests.rid('forge5'), tests.tid('a')));
select is(pg_temp.audit_of('evidence', tests.rid('forge5')), 'user/' || tests.uid('dual') || '/null/evidence.create', 'a run the actor started in ANOTHER tenant does not label a row in this one (the tenant must match)');
select tests.outcome_as(tests.uid('a_sales'), format($q$select public.zz_client_audit_forges(%L, %L, %L)$q$, gen_random_uuid(), tests.rid('forge4'), tests.tid('a')));
select is(pg_temp.audit_of('evidence', tests.rid('forge4')), 'user/' || tests.uid('a_sales') || '/null/evidence.create', 'naming a run that does not exist: the same');

-- ============================================================================ the writer itself
select ok((select prosecdef and 'search_path=""' = any (proconfig) from pg_proc where oid = 'app.write_audit_event(uuid,text,text,uuid,jsonb,jsonb,jsonb)'::regprocedure), 'app.write_audit_event is still SECURITY DEFINER with an empty search_path');
select ok(not has_function_privilege('authenticated', 'app.write_audit_event(uuid,text,text,uuid,jsonb,jsonb,jsonb)', 'execute'), '...and no client can call it');
select is((select count(*) from public.audit_events where actor_type = 'agent' and entity_type not in ('evidence', 'evidence_link', 'claim')), 0::bigint,
  'run bookkeeping (counters, the step ledger) is audited as the human who started the run; only the CONTENT an agent wrote is actor_type agent');

select * from finish();
rollback;
