-- T007 M2 / 4: the Research agent's database half.
--   A the definition, the flag and the operator switch   B start (gated, lead and company targets)
--   C web evidence: a URL on the target's OWN host, a quote of at most 300 characters   D claims: four predicates, slug values
--   E the two agents cannot cross over (selftest cannot write web_page, research cannot write a note)
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_limits set limit_value = 100 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');
update public.companies set website = 'https://saree-house.test/' where id = tests.rid('a_company');
update public.companies set website = 'https://other-house.test' where id = tests.rid('b_company');

create function pg_temp.sc(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(p_uid, p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.start_sql(p_run uuid, p_tenant text, p_kind text, p_target uuid) returns text language sql as $$
  select format('select public.start_agent_run(%L, %L, ''research'', ''research-1'', %L, %L, %L, ''{}''::jsonb)', p_run, tests.tid(p_tenant), p_kind, p_target, repeat('a', 64)) $$;
create function pg_temp.web_sql(p_run uuid, p_step text, p_url text, p_quote text) returns text language sql as $$
  select format('select public.agent_write_evidence(%L, %L, ''web_page''::public.evidence_kind, %L, null, %L)', p_run, p_step, p_url, p_quote) $$;
create function pg_temp.note_sql(p_run uuid, p_step text) returns text language sql as $$
  select format('select public.agent_write_evidence(%L, %L, ''note''::public.evidence_kind, null, null, ''DEMO'')', p_run, p_step) $$;
create function pg_temp.cl_sql(p_run uuid, p_step text, p_predicate text, p_value text, p_evidence uuid) returns text language sql as $$
  select format('select public.agent_write_claim(%L, %L, %L, %L, %L::uuid[], ''supports'')', p_run, p_step, p_predicate, p_value, array[p_evidence]) $$;
create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.newrun(p_name text, p_agent text, p_company text, p_lead text) returns uuid language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, lead_id, expires_at, input_sha256)
  values (tests.rid(p_name), tests.tid('a'), tests.uid('a_sales'), p_agent, 'v1',
          case when p_company is not null then tests.rid(p_company) end, case when p_lead is not null then tests.rid(p_lead) end,
          now() + interval '15 minutes', repeat('1', 64));
  return tests.rid(p_name);
end $$;

-- ============================================================================ A. definition, flag, operator switch
select results_eq($$select agent_name, requires_flag, allowed_predicates, allowed_evidence_kinds::text[], allowed_stances::text[], max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, claim_value_pattern
                      from public.agent_definitions where agent_name = 'research'$$,
  $$values ('research'::text, 'research_enabled'::text, array['buyer_type','order_scale','size_band','operating_status']::text[], array['web_page']::text[],
            array['supports','context','contradicts']::text[], 7, 14, 120000, 4000, 150000::bigint, '^[a-z][a-z0-9_]{1,39}$'::text)$$,
  'the research definition: its flag, the four ICP predicates, web_page only, all three stances, the ceilings, a slug value shape');
select is((select enabled from public.platform_flags where key = 'research_enabled'), false, 'the research switch is OFF');
select is((select cardinality(allowed_tenants) from public.agent_definitions where agent_name = 'research'), 0, 'and no tenant may use it yet');
select is((select count(*) from public.agent_definitions where allowed_tenants is null), 0::bigint, 'no agent is open to every tenant');
select ok(not has_function_privilege('authenticated', 'app.operator_enable_research(text)', 'execute') and not has_function_privilege('anon', 'app.operator_enable_research(text)', 'execute')
          and not has_function_privilege('service_role', 'app.operator_enable_research(text)', 'execute'), 'no application role can execute the operator switch');
select throws_ok($$select app.operator_enable_research('no-such-tenant')$$, 'P0002', null, 'an unknown tenant slug is an error (it never opens research to everyone)');
select throws_ok($$insert into public.agent_definitions (agent_name, allowed_predicates, allowed_evidence_kinds, max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, claim_value_pattern) values ('zz_long', array['x.y'], array['note']::public.evidence_kind[], 1, 1, 1, 1, 1, repeat('a', 101))$$, '23514', null, 'a value pattern is bounded');

-- ============================================================================ B. start
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s0'), 'a', 'company', tests.rid('a_company'))), 'SM204|agents are disabled||||', 'before the operator acts: SM204 (the research flag is OFF and the tenant is not allowed)');
select lives_ok($$select app.operator_enable_research('tenant-a')$$, 'the operator enables research for ONE named tenant');
select is((select enabled from public.platform_flags where key = 'research_enabled'), true, '...the research flag is now ON');
select results_eq($$select allowed_tenants from public.agent_definitions where agent_name = 'research'$$, format($$values (array[%L]::uuid[])$$, tests.tid('a')), '...and the allow-list holds exactly tenant A');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s1'), 'a', 'company', tests.rid('a_company'))), 'rows:1', 'tenant A starts a research run on a company');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('s2'), 'a', 'lead', tests.rid('a_lead'))), 'rows:1', '...and on a lead');
select is(pg_temp.err('b_sales', format('select public.start_agent_run(%L, %L, ''research'', ''research-1'', ''company'', %L, %L, ''{}''::jsonb)', gen_random_uuid(), tests.tid('b'), tests.rid('b_company'), repeat('a', 64))), 'SM204|agents are disabled||||', 'tenant B is not on the allow-list: SM204');
select is((select agent_name || '|' || max_writes || '|' || max_tool_calls || '|' || max_input_tokens || '|' || max_cost_micros from public.agent_runs where id = tests.rid('s2')), 'research|7|14|120000|150000', 'the run took the research ceilings');
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s3'), 'a', 'company', gen_random_uuid())), '23503|invalid reference||||', 'an unknown target: the usual refusal');
update public.platform_flags set enabled = false where key = 'research_enabled';
select is(pg_temp.err('a_sales', pg_temp.start_sql(tests.rid('s4'), 'a', 'company', tests.rid('a_company'))), 'SM204|agents are disabled||||', 'research OFF stops research starts');
select is(tests.outcome_as(tests.uid('a_sales'), format('select public.start_agent_run(%L, %L, ''selftest'', ''v1'', ''company'', %L, %L, ''{}''::jsonb)', tests.rid('s5'), tests.tid('a'), tests.rid('a_company'), repeat('a', 64))), 'rows:1', '...and leaves selftest alone');
update public.platform_flags set enabled = true where key = 'research_enabled';

-- ============================================================================ C. web evidence
select pg_temp.newrun('r_co', 'research', 'a_company', null);
select pg_temp.newrun('r_lead', 'research', null, 'a_lead');
create function pg_temp.web(p_run text, p_step text, p_url text, p_quote text) returns text language sql as $$
  select pg_temp.err('a_sales', pg_temp.web_sql(tests.rid(p_run), p_step, p_url, p_quote)) $$;
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.web_sql(tests.rid('r_co'), 'w1', 'https://saree-house.test/', 'We sell silk sarees to retail shops in bulk.')), 'replayed'), 'false', 'a quote and a URL on the target''s own host: written');
select is((select kind::text || '|' || provider || '|' || created_via || '|' || url || '|' || snippet from public.evidence where agent_run_id = tests.rid('r_co')), 'web_page|agent.research|agent|https://saree-house.test/|We sell silk sarees to retail shops in bulk.', '...as web_page evidence of the research agent');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.web_sql(tests.rid('r_co'), 'w2', 'https://www.saree-house.test/about', 'Established 1985.')), 'replayed'), 'false', 'the www twin of the host is the same host');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.web_sql(tests.rid('r_co'), 'w3', 'http://SAREE-HOUSE.test:80/products/silk', 'Silk range.')), 'replayed'), 'false', 'case and the port do not matter either');
select is(pg_temp.web('r_co', 'w4', 'https://evil.test/x', 'A quote'), '23514|value not allowed||||', 'another host: refused');
select is(pg_temp.web('r_co', 'w5', 'https://saree-house.test.evil.test/', 'A quote'), '23514|value not allowed||||', 'a look-alike host (the target as a prefix): refused');
select is(pg_temp.web('r_co', 'w6', 'https://evil.test/saree-house.test', 'A quote'), '23514|value not allowed||||', 'the target name in the PATH of another host: refused');
select is(pg_temp.web('r_co', 'w7', 'https://other-house.test/', 'A quote'), '23514|value not allowed||||', 'another tenant''s company host: refused');
select is(pg_temp.web('r_co', 'w8', 'https://saree-house.test/?d=secret', 'A quote'), '23514|value not allowed||||', 'a query string (it could carry data out): refused');
select is(pg_temp.web('r_co', 'w9', 'https://saree-house.test/#frag', 'A quote'), '23514|value not allowed||||', 'a fragment: refused');
select is(substr(pg_temp.web('r_co', 'w10', 'https://evil.test@saree-house.test/', 'A quote'), 1, 5), '23514', 'userinfo in the URL (a host trick): refused');
select is(pg_temp.err('a_sales', format('select public.agent_write_evidence(%L, ''w11'', ''web_page''::public.evidence_kind, null, ''ref:x'', ''A quote'')', tests.rid('r_co'))), '23514|value not allowed||||', 'a web_page row with no URL: refused');
select is(pg_temp.err('a_sales', format('select public.agent_write_evidence(%L, ''w12'', ''web_page''::public.evidence_kind, ''https://saree-house.test/'', null, null)', tests.rid('r_co'))), '23514|value not allowed||||', 'a web_page row with no quote: refused');
select is(pg_temp.web('r_co', 'w13', 'https://saree-house.test/', repeat('a', 301)), '23514|value not allowed||||', 'a quote of 301 characters: refused');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.web_sql(tests.rid('r_co'), 'w14', 'https://saree-house.test/', repeat('a', 300))), 'replayed'), 'false', 'a quote of exactly 300 characters: written');
select is((select count(*) from public.evidence where agent_run_id = tests.rid('r_co')), 4::bigint, 'only the four valid rows exist (nothing of the refused attempts)');
select is((select count(*) from public.evidence_links where agent_run_id = tests.rid('r_co') and company_id = tests.rid('a_company') and lead_id is null), 4::bigint, '...each linked to the run''s company');
-- a LEAD run is scoped to the lead's company's host
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.web_sql(tests.rid('r_lead'), 'l1', 'https://saree-house.test/about', 'Established 1985.')), 'replayed'), 'false', 'a lead run: its company''s host is allowed');
select is(pg_temp.web('r_lead', 'l2', 'https://evil.test/', 'A quote'), '23514|value not allowed||||', '...and nothing else');
update public.companies set website = null where id = tests.rid('a_company');
select is(pg_temp.web('r_lead', 'l3', 'https://saree-house.test/', 'A quote'), '23514|value not allowed||||', 'a company with NO website has no host: every web_page row is refused');
update public.companies set website = 'https://saree-house.test/' where id = tests.rid('a_company');

-- ============================================================================ D. claims
create temp table ev as select (pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.web_sql(tests.rid('r_co'), 'ce1', 'https://saree-house.test/', 'We sell wholesale to retail shops.')), 'evidence_id'))::uuid as id;
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('r_co'), 'c1', 'buyer_type', 'wholesaler', (select id from ev))), 'replayed'), 'false', 'a claim with an allowed predicate and a slug value: written');
select is((select predicate || '|' || value || '|' || confidence::text || '|' || created_via::text || '|' || company_id from public.claims where agent_run_id = tests.rid('r_co')), 'buyer_type|wholesaler|unverified|agent|' || tests.rid('a_company'), '...unverified, as the agent, on the company');
select is(pg_temp.err('a_sales', pg_temp.cl_sql(tests.rid('r_co'), 'c2', 'selftest.observation', 'wholesaler', (select id from ev))), '23514|value not allowed||||', 'a predicate outside the four: refused');
select is(pg_temp.err('a_sales', pg_temp.cl_sql(tests.rid('r_co'), 'c3', 'contact_email', 'wholesaler', (select id from ev))), '23514|value not allowed||||', '...also a contact predicate');
select is(pg_temp.err('a_sales', pg_temp.cl_sql(tests.rid('r_co'), 'c4', 'buyer_type', 'Free text about a person', (select id from ev))), '23514|value not allowed||||', 'a value that is not a slug: refused');
select is(pg_temp.err('a_sales', pg_temp.cl_sql(tests.rid('r_co'), 'c5', 'buyer_type', 'x', (select id from ev))), '23514|value not allowed||||', 'a one-character value: refused');
select is(pg_temp.err('a_sales', pg_temp.cl_sql(tests.rid('r_co'), 'c6', 'buyer_type', 'a@b.co', (select id from ev))), '23514|value not allowed||||', 'an e-mail address as a value: refused');
select is(pg_temp.err('a_sales', pg_temp.cl_sql(tests.rid('r_co'), 'c7', 'buyer_type', repeat('a', 41), (select id from ev))), '23514|value not allowed||||', 'a 41-character value: refused');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('r_co'), 'c8', 'size_band', 'medium', (select id from ev))), 'replayed'), 'false', 'every one of the four predicates is accepted (size_band)');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('r_co'), 'c9', 'order_scale', 'five_or_more_per_order', (select id from ev))), 'replayed'), 'false', '...order_scale');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.cl_sql(tests.rid('r_co'), 'c10', 'operating_status', 'closed', (select id from ev))), 'replayed'), 'false', '...operating_status');
-- an accepted claim reaches the score input through the company; unreviewed does not
select is((select count(*) from public.claims_for_scoring where tenant_id = tests.tid('a') and company_id = tests.rid('a_company') and predicate in ('buyer_type', 'size_band', 'order_scale', 'operating_status')), 0::bigint, 'none of the research claims is a score input while unreviewed');

-- ============================================================================ E. the two agents cannot cross over
select pg_temp.newrun('st_run', 'selftest', 'a_company', null);
select is(tests.error_full_as(tests.uid('a_sales'), pg_temp.web_sql(tests.rid('st_run'), 'x1', 'https://saree-house.test/', 'A quote that is long enough')), '23514|value not allowed||||', 'the selftest agent cannot write web_page evidence');
select is(pg_temp.err('a_sales', pg_temp.note_sql(tests.rid('r_co'), 'x2')), '23514|value not allowed||||', 'the research agent cannot write a note');
select is(pg_temp.err('a_sales', pg_temp.cl_sql(tests.rid('st_run'), 'x3', 'buyer_type', 'wholesaler', (select id from ev))), '23514|value not allowed||||', 'selftest cannot write research predicates');
select is(pg_temp.err('b_sales', pg_temp.web_sql(tests.rid('r_co'), 'x4', 'https://saree-house.test/', 'A quote that is long enough')), '42501|agent action not permitted||||', 'tenant B cannot write into tenant A''s research run');

select * from finish();
rollback;
