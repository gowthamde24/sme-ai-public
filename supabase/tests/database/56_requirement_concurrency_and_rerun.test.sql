-- T008 commit 3c: re-run safety (SM211) and the "only a draft takes a field" guards. The LOCK ORDER itself (enquiry row, then requirement row) is
-- proved with two real connections in tests/integration/test_requirement_concurrency.py; one pgTAP session cannot race itself.
--   A SM211 at start_agent_run (confirmed / corrected / rejected / manual fields)   B proposals only: a re-run is allowed and supersedes
--   C the same test in the run's FIRST write (a person decided a field after the start)   D SM209: a run's own requirement is no longer a draft
--   E who sees what   F the helper is not callable by clients
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_limits set limit_value = 1000 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');
select app.operator_enable_requirement('tenant-a');

create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;

insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body)
select tests.rid(n), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees in Pune. ' || n
  from unnest(array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']) as n;

create function pg_temp.body(p_enq text) returns text language sql as $$ select body from public.enquiries where id = tests.rid(p_enq) $$;
create function pg_temp.start_sql(p_run text, p_enq text) returns text language sql as $$
  select format('select public.start_agent_run(%L, %L, ''requirement'', ''requirement-1'', ''enquiry'', %L, %L, ''{}''::jsonb)', tests.rid(p_run), tests.tid('a'), tests.rid(p_enq), repeat('a', 64)) $$;
create function pg_temp.start(p_run text, p_enq text) returns text language sql as $$ select pg_temp.err('a_sales', pg_temp.start_sql(p_run, p_enq)) $$;
-- an agent write of one field, quoted from the enquiry text (the first occurrence of the phrase)
create function pg_temp.w(p_run text, p_step text, p_enq text, p_phrase text, p_line int, p_key text, p_code text default null, p_int bigint default null, p_basis text default null) returns text language sql as $$
  select pg_temp.err('a_sales', format('select public.agent_write_requirement_field(%L, %L, %L::smallint, %L, %L, %L::bigint, null, null, %L, ''stated'', %L, %s, %s, false)',
                                       tests.rid(p_run), p_step, p_line, p_key, p_code, p_int, p_basis, p_phrase,
                                       strpos(pg_temp.body(p_enq), p_phrase) - 1, strpos(pg_temp.body(p_enq), p_phrase) - 1 + char_length(p_phrase))) $$;
create function pg_temp.ok(p_result text) returns boolean language sql as $$ select p_result = 'ok' $$;
create function pg_temp.fid(p_enq text, p_key text) returns uuid language sql as $$
  select f.id from public.requirement_fields f join public.requirements q on q.tenant_id = f.tenant_id and q.id = f.requirement_id
   where q.enquiry_id = tests.rid(p_enq) and q.status = 'draft' and f.field_key = p_key::public.requirement_field_key $$;
create function pg_temp.draft(p_enq text) returns uuid language sql as $$ select id from public.requirements where enquiry_id = tests.rid(p_enq) and status = 'draft' $$;
create function pg_temp.decide(p_enq text, p_key text, p_decision text, p_int bigint default null) returns text language sql as $$
  select pg_temp.sc('a_sales', format('select public.decide_requirement_field(%L, %L, null, %L::bigint, null, null, %L)', pg_temp.fid(p_enq, p_key), p_decision, p_int,
                                      case when p_decision = 'correct' then 'piece' end)) $$;
create function pg_temp.sm211() returns text language sql as $$ select 'SM211|discard the current draft to re-run||||' $$;

-- ============================================================================ A. a person's work blocks a re-run
-- e1: a CONFIRMED field
select ok(pg_temp.ok(pg_temp.start('r11', 'e1')), 'a run on e1 starts');
select ok(pg_temp.ok(pg_temp.w('r11', 's1', 'e1', 'kanjivaram', 1, 'saree_type', 'kanjivaram')), '...and proposes a saree type');
select is(pg_temp.start('r12', 'e1'), 'ok', 'while the draft holds proposals only, a second run may start');
select is(pg_temp.j(pg_temp.decide('e1', 'saree_type', 'confirm'), 'state'), 'confirmed', 'a person confirms the proposed type');
select is(pg_temp.start('r13', 'e1'), pg_temp.sm211(), 'a CONFIRMED field in the draft: the re-run is refused with SM211');
select is((select count(*) from public.agent_runs where id = tests.rid('r13')), 0::bigint, '...and no run row was created');
select is(pg_temp.start('r13', 'e1'), pg_temp.sm211(), '...and it stays refused on a retry');
-- discard, then the same enquiry runs again
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.discard_requirement(%L)', pg_temp.draft('e1'))), 'status'), 'discarded', 'a person discards the draft');
select is(pg_temp.start('r13', 'e1'), 'ok', '...and now the run starts');

-- e2: a CORRECTED field
select ok(pg_temp.ok(pg_temp.start('r21', 'e2')), 'e2: a run starts');
select ok(pg_temp.ok(pg_temp.w('r21', 's1', 'e2', 'Need 20', 1, 'quantity', null, 20, 'piece')), '...and proposes a quantity');
select is(pg_temp.j(pg_temp.decide('e2', 'quantity', 'correct', 25), 'state'), 'corrected', 'a person corrects it');
select is(pg_temp.start('r22', 'e2'), pg_temp.sm211(), 'a CORRECTED field in the draft: SM211');

-- e3: a REJECTED field
select ok(pg_temp.ok(pg_temp.start('r31', 'e3')), 'e3: a run starts');
select ok(pg_temp.ok(pg_temp.w('r31', 's1', 'e3', 'kanjivaram', 1, 'saree_type', 'kanjivaram')), '...and proposes a saree type');
select is(pg_temp.j(pg_temp.decide('e3', 'saree_type', 'reject'), 'state'), 'rejected', 'a person rejects it');
select is(pg_temp.start('r32', 'e3'), pg_temp.sm211(), 'a REJECTED field in the draft: SM211');

-- e4: a MANUALLY ADDED field and no agent draft at all
select ok(pg_temp.j(pg_temp.sc('a_sales', format('select public.add_requirement_field(%L, 1::smallint, ''saree_type'', ''kanjivaram'')', tests.rid('e4'))), 'field_id') is not null, 'e4: a person adds a field by hand');
select is(pg_temp.start('r41', 'e4'), pg_temp.sm211(), 'a MANUAL field in the draft: SM211');

-- ============================================================================ B. proposals only: a re-run is allowed and supersedes the old draft
select ok(pg_temp.ok(pg_temp.start('r51', 'e5')), 'e5: a run starts');
select ok(pg_temp.ok(pg_temp.w('r51', 's1', 'e5', 'kanjivaram', 1, 'saree_type', 'kanjivaram')), '...proposes a type');
select is(pg_temp.start('r52', 'e5'), 'ok', 'a second run starts');
select ok(pg_temp.ok(pg_temp.w('r52', 's1', 'e5', 'kanjivaram', 1, 'saree_type', 'kanjivaram')), '...and its first write supersedes the first run''s draft');
select is((select string_agg(status::text, ',' order by agent_run_id = tests.rid('r52')) from public.requirements where enquiry_id = tests.rid('e5')), 'superseded,draft', 'the old draft is superseded, the new one is the draft');

-- ============================================================================ C. the same test in the first write (a decision after the start)
select ok(pg_temp.ok(pg_temp.start('r61', 'e6')), 'e6: a run starts');
select ok(pg_temp.ok(pg_temp.w('r61', 's1', 'e6', 'kanjivaram', 1, 'saree_type', 'kanjivaram')), '...proposes a type');
select is(pg_temp.start('r62', 'e6'), 'ok', 'a second run starts (the draft holds proposals only)');
select is(pg_temp.j(pg_temp.decide('e6', 'saree_type', 'confirm'), 'state'), 'confirmed', 'a person confirms the type while the second run is going');
select is(pg_temp.w('r62', 's1', 'e6', 'kanjivaram', 1, 'saree_type', 'kanjivaram'), pg_temp.sm211(), 'the second run''s FIRST write is refused with SM211');
select is((select count(*) from public.requirements where agent_run_id = tests.rid('r62')), 0::bigint, '...it created no requirement');
select is((select q.status::text || '|' || f.state::text from public.requirements q join public.requirement_fields f on f.requirement_id = q.id where q.agent_run_id = tests.rid('r61')), 'draft|confirmed', '...and the person''s draft is untouched');
select is(pg_temp.w('r62', 's2', 'e6', 'Need 20', 1, 'quantity', null, 20, 'piece'), pg_temp.sm211(), '...and every later write of that run is refused too');

-- ============================================================================ D. SM209: a run's own requirement is no longer a draft
select ok(pg_temp.ok(pg_temp.start('r71', 'e7')), 'e7: a run starts');
select ok(pg_temp.ok(pg_temp.w('r71', 's1', 'e7', 'kanjivaram', 1, 'saree_type', 'kanjivaram')), '...writes its first field');
select pg_temp.sc('a_sales', format('select public.discard_requirement(%L)', pg_temp.draft('e7')));
select is(pg_temp.w('r71', 's2', 'e7', 'Need 20', 1, 'quantity', null, 20, 'piece'), 'SM209|requirement is not a draft||||', 'a person discarded the draft: the run''s next write is SM209');
select is((select count(*) from public.requirement_fields f join public.requirements q on q.id = f.requirement_id where q.agent_run_id = tests.rid('r71')), 1::bigint, '...and wrote nothing');

select ok(pg_temp.ok(pg_temp.start('r81', 'e8')), 'e8: a run starts');
select ok(pg_temp.ok(pg_temp.w('r81', 's1', 'e8', 'kanjivaram', 1, 'saree_type', 'kanjivaram')), '...writes its first field');
select is(pg_temp.start('r82', 'e8'), 'ok', 'a second run starts');
select ok(pg_temp.ok(pg_temp.w('r82', 's1', 'e8', 'kanjivaram', 1, 'saree_type', 'kanjivaram')), '...and supersedes the first run''s draft');
select is(pg_temp.w('r81', 's2', 'e8', 'Need 20', 1, 'quantity', null, 20, 'piece'), 'SM209|requirement is not a draft||||', 'the first run, superseded, cannot add a field to its old requirement: SM209');
select is((select count(*) from public.requirement_fields f join public.requirements q on q.id = f.requirement_id where q.agent_run_id = tests.rid('r81')), 1::bigint, '...and wrote nothing');

-- ============================================================================ E. SM211 is not an oracle
select is(pg_temp.err('a_viewer', pg_temp.start_sql('r91', 'e1')), pg_temp.err('a_viewer', pg_temp.start_sql('r91', 'e2')), 'a Viewer is refused the same way on any enquiry (never SM211)');
select ok(pg_temp.err('b_owner', pg_temp.start_sql('r92', 'e2')) like '42501|%', 'another tenant''s Owner is denied (42501), not told the draft has work in it');
select is(pg_temp.err('b_owner', pg_temp.start_sql('r92', 'e2')), pg_temp.err('b_owner', pg_temp.start_sql('r92', 'e4')), '...identically for a draft with work and one without');

-- ============================================================================ F. the helper is not a client function
select ok(not has_function_privilege('authenticated', 'app.requirement_human_work(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'app.requirement_human_work(uuid,uuid)', 'execute'),
          'app.requirement_human_work is not executable by clients');

select * from finish();
rollback;
