-- T006 / M1 review fixes (owner review of migrations 20261009090000 and 20261009090100).
--   1  agent_definitions.allowed_evidence_kinds: an agent may write only the evidence kinds its definition names
--   2  provenance is decided by an ALLOW-LIST of the trusted role, with the SAME predicate in both triggers
--   3  agent_record_step cannot register a tool name the write functions own (a pre-registered key cannot poison a replay)
--   4  agent_record_usage: oversized values are a budget refusal (SM203), never a numeric overflow
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

create function pg_temp.newrun(p_name text) returns uuid
language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256)
  values (tests.rid(p_name), tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'),
          now() + interval '15 minutes', repeat('1', 64));
  return tests.rid(p_name);
end $$;
create function pg_temp.err(p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid('a_sales'), p_sql) $$;
create function pg_temp.ev_sql(p_run uuid, p_step text, p_kind text, p_url text default null, p_reference text default null) returns text
language sql as $$
  select format('select public.agent_write_evidence(%L, %L, %L::public.evidence_kind, %L, %L, %L)', p_run, p_step, p_kind, p_url, p_reference, 'DEMO agent note')
$$;
create function pg_temp.rows(p_tenant text default 'a') returns text language sql as $$
  select concat_ws('/', (select count(*) from public.evidence where tenant_id = tests.tid(p_tenant)),
                        (select count(*) from public.evidence_links where tenant_id = tests.tid(p_tenant)),
                        (select count(*) from public.agent_run_steps where tenant_id = tests.tid(p_tenant)))
$$;

-- ============================================================================ 1. allowed evidence kinds
select is((select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.agent_definitions'::regclass and a.attname = 'allowed_evidence_kinds'),
          'evidence_kind[]', 'agent_definitions.allowed_evidence_kinds exists and is an evidence_kind[]');
select ok((select a.attnotnull from pg_attribute a where a.attrelid = 'public.agent_definitions'::regclass and a.attname = 'allowed_evidence_kinds'), '...NOT NULL');
select is((select allowed_evidence_kinds::text from public.agent_definitions where agent_name = 'selftest'), '{note}', 'selftest may write only {note}');
select ok((select pg_get_expr(d.adbin, d.adrelid) is null from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = 'public.agent_definitions'::regclass and a.attname = 'allowed_evidence_kinds'),
          '...with no column default: a new agent definition must state its kinds');
-- T008: an empty list is now allowed on purpose: it means "writes NO evidence" (the requirement agent writes requirement fields only)
select lives_ok($$insert into public.agent_definitions (agent_name, allowed_predicates, max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, allowed_evidence_kinds)
                   values ('zz_empty', array['x.y'], 1, 1, 1, 1, 1, '{}')$$, 'an empty list of kinds means the agent writes no evidence at all (T008)');
select throws_ok($$insert into public.agent_definitions (agent_name, allowed_predicates, max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, allowed_evidence_kinds)
                   values ('zz_many', array['x.y'], 1, 1, 1, 1, 1, array['note','note','note','note','note','note','note','note']::public.evidence_kind[])$$, '23514', null, 'more than seven kinds is still refused');

select pg_temp.newrun('k_run');
select is(pg_temp.rows(), '0/0/0', 'sanity: nothing written yet');
select is(pg_temp.err(pg_temp.ev_sql(tests.rid('k_run'), 'k-web', 'web_page', 'https://demo.test/x')), '23514|value not allowed||||', 'web_page: refused (23514, fixed message)');
select is(pg_temp.err(pg_temp.ev_sql(tests.rid('k_run'), 'k-doc', 'document', null, 'doc:1')), '23514|value not allowed||||', 'document: refused');
select is(pg_temp.err(pg_temp.ev_sql(tests.rid('k_run'), 'k-mail', 'email', null, 'mail:1')), '23514|value not allowed||||', 'email: refused');
select is(pg_temp.err(pg_temp.ev_sql(tests.rid('k_run'), 'k-list', 'listing', 'https://demo.test/l')), '23514|value not allowed||||', 'listing: refused');
select is(pg_temp.err(pg_temp.ev_sql(tests.rid('k_run'), 'k-reg', 'registry', null, 'reg:1')), '23514|value not allowed||||', 'registry: refused');
select is(pg_temp.err(pg_temp.ev_sql(tests.rid('k_run'), 'k-imp', 'import_batch', null, 'batch:1')), '23514|value not allowed||||', 'import_batch: refused');
select is((select count(*) from unnest(enum_range(null::public.evidence_kind)) k where k <> 'note'), 6::bigint, 'sanity: six kinds other than note exist, and each of them was tried above');
select is(pg_temp.rows(), '0/0/0', 'none of the refused kinds wrote a row, a link or a step');
select is((select (tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('k_run'), 'k-note', 'note'))::jsonb ->> 'replayed')), 'false', 'a note is written');
select is(pg_temp.rows(), '1/1/1', '...exactly one evidence row, one link, one step');
-- the allow-list is the DEFINITION's: widen it and the kind passes (a web_page row must sit on the target company's own host: T007 research)
update public.companies set website = 'https://demo.test' where id = tests.rid('a_company');
update public.agent_definitions set allowed_evidence_kinds = array['note', 'web_page']::public.evidence_kind[] where agent_name = 'selftest';
select is((select (tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('k_run'), 'k-web2', 'web_page', 'https://demo.test/x'))::jsonb ->> 'replayed')), 'false', 'widening the definition lets web_page through (the list, not the code, decides)');
update public.agent_definitions set allowed_evidence_kinds = array['note']::public.evidence_kind[] where agent_name = 'selftest';
-- a refusal is the same whether or not the step key was used before
select is(pg_temp.err(pg_temp.ev_sql(tests.rid('k_run'), 'k-web2', 'web_page', 'https://demo.test/x')), '23514|value not allowed||||', 'a kind removed from the definition is refused even for a key that was once used');

-- ============================================================================ 2. one trusted-role predicate in both triggers
create temp table trg as
  select p.proname, p.prosrc from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('set_created_meta', 'set_agent_run_id');
select is((select count(*) from trg), 2::bigint, 'both trigger functions exist');
select is((select count(*) from trg where prosrc ~ $re$current_user\s*=\s*'postgres'$re$), 2::bigint, 'both decide on the SAME predicate: current_user = ''postgres'' (an allow-list of the one trusted role)');
select is((select count(*) from trg where prosrc ~* $re$'authenticated'|'anon'|service_role$re$), 0::bigint, 'neither names the client roles any more (no deny-list)');
select is((select string_agg(distinct m[1], ',') from trg, regexp_matches(prosrc, '(current_user\s*=\s*''[a-z_]+'')', 'g') as m), 'current_user = ''postgres''', 'the predicate text is identical in both');

-- roles other than the trusted one. Each is given exactly the table rights it needs to insert, so the ONLY thing that can stop
-- the forgery is the trigger. zz_other has BYPASSRLS (it is not stopped by a policy either); service_role is Supabase's own.
create role zz_other nologin bypassrls in role authenticated;
grant zz_other to current_user with set true;
grant insert, select on public.evidence to service_role, zz_other;
grant usage on schema app to service_role;
grant execute on all functions in schema app to service_role;  -- (rolled back with the test) so a CHECK that calls app.text_is_clean can run
create function pg_temp.forge(p_role text, p_via text) returns text
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_tenant uuid := tests.tid('a');
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('a_sales'), 'role', 'authenticated')::text, true);
  perform set_config('app.created_via', p_via, true);
  perform set_config('app.agent_run_id', tests.rid('a_run_sales')::text, true);
  execute format('set local role %I', p_role);
  begin
    insert into public.evidence (id, tenant_id, kind, provider, reference, snippet)
    values (v_id, v_tenant, 'note', 'forged', 'ref:forge', 'DEMO forged');
  exception when others then
    reset role;
    return 'error:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);
  select e.created_via::text || '/' || coalesce(e.agent_run_id::text, 'null') into v_out from public.evidence e where e.id = v_id;
  return v_out;
end $$;
select is(pg_temp.forge('zz_other', 'agent'),      'manual/null', 'a non-client, non-trusted role (BYPASSRLS) cannot declare origin ''agent'' or a run id: the row is manual, run id NULL');
select is(pg_temp.forge('zz_other', 'import'),     'manual/null', '...nor ''import''');
select is(pg_temp.forge('service_role', 'agent'),  'manual/null', 'service_role cannot either: manual, run id NULL');
select is(pg_temp.forge('service_role', 'import'), 'manual/null', '...nor ''import''');
select is(pg_temp.forge('authenticated', 'agent'), 'manual/null', 'a client (authenticated) cannot either, as before');
-- and the trusted role still can (this is how every definer function, including agent_write_evidence, records an agent)
create function pg_temp.trusted() returns text
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_out text;
begin
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', tests.rid('a_run_sales')::text, true);
  insert into public.evidence (id, tenant_id, kind, provider, reference, snippet) values (v_id, tests.tid('a'), 'note', 'agent.selftest', 'run:x', 'DEMO trusted');
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);
  select e.created_via::text || '/' || (e.agent_run_id = tests.rid('a_run_sales'))::text into v_out from public.evidence e where e.id = v_id;
  return v_out;
end $$;
select is(pg_temp.trusted(), 'agent/true', 'the trusted role (postgres, i.e. every SECURITY DEFINER function here) still records agent / run id');

-- ============================================================================ 3. reserved tool names
select pg_temp.newrun('r_run');
create function pg_temp.step_sql(p_run uuid, p_key text, p_tool text, p_sha text default repeat('a', 64)) returns text
language sql as $$ select format('select public.agent_record_step(%L, %L, %L, %L)', p_run, p_key, p_tool, p_sha) $$;
select is(pg_temp.err(pg_temp.step_sql(tests.rid('r_run'), 'r1', 'agent_write_evidence')), '23514|value not allowed||||', 'agent_write_evidence is reserved (the write function owns that name)');
select is(pg_temp.err(pg_temp.step_sql(tests.rid('r_run'), 'r2', 'agent_write_claim')),    '23514|value not allowed||||', 'agent_write_claim is reserved');
select is(pg_temp.err(pg_temp.step_sql(tests.rid('r_run'), 'r3', 'usage')),                '23514|value not allowed||||', 'usage is reserved');
select is(pg_temp.err(pg_temp.step_sql(tests.rid('r_run'), 'r4', 'agent_write_anything')), '23514|value not allowed||||', 'any name starting agent_write is reserved');
select is(pg_temp.err(pg_temp.step_sql(tests.rid('r_run'), 'r5', 'agent_write')),          '23514|value not allowed||||', '...including the bare prefix');
select is(pg_temp.err(pg_temp.step_sql(tests.rid('r_run'), 'r6', 'Agent_Write_Evidence')), '23514|value not allowed||||', '...in any letter case');
select is(pg_temp.err(pg_temp.step_sql(tests.rid('r_run'), 'r7', 'USAGE')),                '23514|value not allowed||||', '...in any letter case (usage)');
select is((select count(*) from public.agent_run_steps where run_id = tests.rid('r_run')), 0::bigint, 'no refused name left a step behind');
select is((select (tests.scalar_as(tests.uid('a_sales'), pg_temp.step_sql(tests.rid('r_run'), 'r8', 'read_target'))::jsonb ->> 'replayed')), 'false', 'an ordinary tool name is still recorded');
-- the attack: pre-register the key a later write will use, with a forged result, so the write "replays" and writes nothing
select is(pg_temp.err(format($q$select public.agent_record_step(%L, 'poison', 'agent_write_evidence', %L, 'ok', '{"evidence_id":"00000000-0000-0000-0000-000000000001"}')$q$,
                              tests.rid('r_run'), repeat('b', 64))), '23514|value not allowed||||', 'the poisoning pre-registration is refused');
select is((select (tests.scalar_as(tests.uid('a_sales'), pg_temp.ev_sql(tests.rid('r_run'), 'poison', 'note'))::jsonb ->> 'replayed')), 'false', '...so the real write with that key is a real write, not a replay of the forged result');
select is((select count(*) from public.evidence where agent_run_id = tests.rid('r_run')), 1::bigint, '...and the evidence row exists');

-- ============================================================================ 4. oversized usage is a budget refusal
select pg_temp.newrun('u_run');
update public.agent_runs set input_tokens_used = 5, output_tokens_used = 5, cost_micros_used = 100 where id = tests.rid('u_run');
create function pg_temp.use_sql(p_run uuid, p_key text, p_in text, p_out text, p_cost text) returns text
language sql as $$ select format('select public.agent_record_usage(%L, %L, %s, %s, %s)', p_run, p_key, p_in, p_out, p_cost) $$;
select is(pg_temp.err(pg_temp.use_sql(tests.rid('u_run'), 'u1', '2147483647', '1', '1')), 'SM203|agent run budget exhausted||||', 'int4-max input tokens: SM203 (not 22003)');
select is(pg_temp.err(pg_temp.use_sql(tests.rid('u_run'), 'u2', '3000000000', '1', '1')), 'SM203|agent run budget exhausted||||', 'input tokens beyond int4: SM203 (not 22003 / a function-not-found error)');
select is(pg_temp.err(pg_temp.use_sql(tests.rid('u_run'), 'u3', '1', '9000000000', '1')), 'SM203|agent run budget exhausted||||', 'output tokens beyond int4: SM203');
select is(pg_temp.err(pg_temp.use_sql(tests.rid('u_run'), 'u4', '1', '1', '9223372036854775807')), 'SM203|agent run budget exhausted||||', 'cost at bigint max (used + max would overflow): SM203');
select is(pg_temp.err(pg_temp.use_sql(tests.rid('u_run'), 'u5', '9223372036854775807', '9223372036854775807', '9223372036854775807')), 'SM203|agent run budget exhausted||||', 'everything at bigint max: SM203');
select is(pg_temp.err(pg_temp.use_sql(tests.rid('u_run'), 'u6', '-1', '1', '1')), '22023|invalid argument||||', 'a negative value is still an invalid argument');
select is((select input_tokens_used::text || '/' || output_tokens_used || '/' || cost_micros_used from public.agent_runs where id = tests.rid('u_run')), '5/5/100', 'no refusal changed a counter');
select is((select count(*) from public.agent_run_steps where run_id = tests.rid('u_run')), 0::bigint, '...or left a step');
create function pg_temp.resv(p_run uuid, p_key text, p_micros bigint) returns void language sql as $$
  insert into public.agent_cost_reservations (tenant_id, run_id, step_key, cost_day, model, input_micros_per_mtok, output_micros_per_mtok, max_input_tokens, max_output_tokens, reserved_micros, args_sha256)
  select tenant_id, id, p_key, app.agent_utc_today(), 'fake-selftest', 1000000, 1000000, 0, 0, p_micros, repeat('0', 64) from public.agent_runs where id = p_run $$;
select pg_temp.resv(tests.rid('u_run'), 'u7', 20);
select is((select (tests.scalar_as(tests.uid('a_sales'), pg_temp.use_sql(tests.rid('u_run'), 'u7', '10', '10', '10'))::jsonb ->> 'replayed')), 'false', 'a normal usage record still works');
select is((select input_tokens_used::text || '/' || output_tokens_used || '/' || cost_micros_used from public.agent_runs where id = tests.rid('u_run')), '15/15/120', '...and adds up (the run counts the CHARGE: the larger of the reported 10 and the 20 computed from the tokens)');

select * from finish();
rollback;
