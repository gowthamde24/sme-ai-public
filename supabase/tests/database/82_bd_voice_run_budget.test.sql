-- Job BD review (ADR 0071 addendum, migration 20261113090000): a run's cost budget stays its own (Rs 1.00 for the assistant) for everything the MODEL spends, and a run that carries voice (a reservation of
-- the voice-stt or voice-tts accounting model) may be charged up to Rs 3.00 in all, for its voice charges only.
--   A the definitions    B a run with no voice: the budget is exact    C a run with voice: voice up to Rs 3.00, the model's own spending still held to the run's budget
--   D the early check    E the audit and isolation are untouched
-- Prices: fake-selftest costs ONE micro a token; voice-stt and voice-tts cost 1,000 micros a token (so 600 tokens of voice-stt = 600,000 = a minute, 2,000 tokens of voice-tts = 2,000,000 = 500 characters).
-- The runs are inserted with a SMALL budget (max_cost_micros 1000) so the model side can be tested with small numbers; the voice ceiling is the absolute 3,000,000 (greatest(max_cost_micros, 3000000)).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_limits set limit_value = 100 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');
update public.tenant_agent_settings set daily_cost_cap_micros = 500000000 where tenant_id = tests.tid('a');

create function pg_temp.sc(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(p_uid, p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.rsv(p_run uuid, p_key text, p_in bigint, p_model text default 'fake-selftest') returns text language sql as $$
  select format('select public.agent_reserve_cost(%L, %L, %L, %s, 0)', p_run, p_key, p_model, p_in) $$;
create function pg_temp.use(p_run uuid, p_key text, p_in bigint, p_cost bigint default 0) returns text language sql as $$
  select format('select public.agent_record_usage(%L, %L, %s, 0, %s)', p_run, p_key, p_in, p_cost) $$;
create function pg_temp.run(p_label text, p_budget bigint default 1000) returns uuid language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs, max_cost_micros, max_input_tokens, max_output_tokens)
  values (tests.rid(p_label), tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'), now() + interval '15 minutes', repeat('7', 64), '{}'::jsonb, p_budget, 100000, 1000);
  return tests.rid(p_label);
end $$;
-- charge: reserve then settle one step as the run's starter; returns 'ok' or the SQLSTATE of the first refusal
create function pg_temp.charge(p_run uuid, p_key text, p_tokens bigint, p_model text default 'fake-selftest') returns text language plpgsql as $$
declare v text;
begin
  v := pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(p_run, p_key, p_tokens, p_model));
  if v like '%error%' then return 'reserve:' || (v::jsonb ->> 'error'); end if;
  if (v::jsonb ->> 'granted') is distinct from 'true' then return 'reserve:refused'; end if;
  v := pg_temp.sc(tests.uid('a_sales'), pg_temp.use(p_run, p_key, p_tokens, 0));
  if v like '{"error"%' then return 'use:' || (v::jsonb ->> 'error'); end if;
  return 'ok';
end $$;

-- ============================================================================ A. the definitions
select is((select max_cost_micros from public.agent_definitions where agent_name = 'assistant'), 1000000::bigint, 'the assistant run is back to Rs 1.00');
select is((select count(*) from public.agent_model_prices where model in ('voice-stt', 'voice-tts') and input_micros_per_mtok = 1000000000), 2::bigint, 'the two voice accounting models are priced at 1,000 micros a token');
select is((select pg_get_functiondef('public.agent_record_usage(uuid, text, bigint, bigint, bigint)'::regprocedure) like '%voice-%'), true, 'agent_record_usage knows the voice models');

-- ============================================================================ B. a run with no voice: its budget is exact
select pg_temp.run('text_ok');
select is(pg_temp.charge(tests.rid('text_ok'), 'm-1', 1000), 'ok', 'TEXT RUN: the model may spend exactly the run''s budget (1000)');
select is((select cost_micros_used from public.agent_runs where id = tests.rid('text_ok')), 1000::bigint, '...and the run counts it');
select pg_temp.run('text_over');
select is(pg_temp.charge(tests.rid('text_over'), 'm-1', 1001), 'use:SM203', 'TEXT RUN: one micro over the budget is refused (SM203)');
select pg_temp.run('text_twice');
select is(pg_temp.charge(tests.rid('text_twice'), 'm-1', 600) || '/' || pg_temp.charge(tests.rid('text_twice'), 'm-2', 401), 'ok/use:SM203', 'TEXT RUN: the budget is for the whole run: 600 then 401 is refused');
select pg_temp.run('text_rs1', 1000000);
select is(pg_temp.charge(tests.rid('text_rs1'), 'v-1', 600, 'voice-stt'), 'ok', '(a run that charges a voice model IS a voice run: that is the only way to the larger ceiling)');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('text_over'), 'nokey', 1, 5000)), 'SM203|agent run budget exhausted||||', 'TEXT RUN, the early check: a reported cost over the budget is SM203 even with no reservation, as before');

-- ============================================================================ C. a run with voice
select pg_temp.run('voice_run');
select is(pg_temp.charge(tests.rid('voice_run'), 'voice-stt', 600, 'voice-stt'), 'ok', 'VOICE RUN: a minute of speech to text (600,000 micros) is charged although the run''s own budget is 1000');
select is((select cost_micros_used from public.agent_runs where id = tests.rid('voice_run')), 0::bigint, '...it is on the ledger and the step, not in the run''s own counter (that counts the model, and a table check holds it to the run''s budget)');
select is((select sum(settled_micros) from public.agent_cost_reservations where run_id = tests.rid('voice_run')), 600000::numeric, '...the ledger holds Rs 0.60');
select is(pg_temp.charge(tests.rid('voice_run'), 'm-1', 1000), 'ok', 'VOICE RUN: the model may still spend its own budget (1000) AFTER the voice charge: voice does not use it up');
select is(pg_temp.charge(tests.rid('voice_run'), 'm-2', 1), 'use:SM203', 'VOICE RUN: but not one micro more than its own budget: the model''s spending is held to 1000 without the voice');
select is(pg_temp.charge(tests.rid('voice_run'), 'voice-tts', 2000, 'voice-tts'), 'ok', 'VOICE RUN: a spoken answer of 500 characters (2,000,000 micros) fits: 0.60 + 0.001 + 2.00 is under Rs 3.00');
select is((select sum(settled_micros) from public.agent_cost_reservations where run_id = tests.rid('voice_run')), 2601000::numeric, '...the run now holds 2,601,000 in all');
select is(pg_temp.charge(tests.rid('voice_run'), 'voice-tts-2', 400, 'voice-tts'), 'use:SM203', 'VOICE RUN: 400 more tokens of speech (400,000) would pass Rs 3.00 (3,001,000): refused (SM203)');
select is(pg_temp.charge(tests.rid('voice_run'), 'voice-tts-3', 399, 'voice-tts'), 'ok', '...399 (399,000) reaches 3,000,000 exactly and is allowed: the ceiling is "> 3,000,000"');
select is((select sum(settled_micros) from public.agent_cost_reservations where run_id = tests.rid('voice_run')), 3000000::numeric, '...exactly Rs 3.00');
select is((select cost_micros_used from public.agent_runs where id = tests.rid('voice_run')), 1000::bigint, '...of which the model''s own counter is 1000');
select pg_temp.run('voice_first_llm');
select is(pg_temp.charge(tests.rid('voice_first_llm'), 'm-1', 700), 'ok', 'the model''s call first (700 of its 1000)...');
select is(pg_temp.charge(tests.rid('voice_first_llm'), 'voice-stt', 600, 'voice-stt'), 'ok', '...then speech to text: allowed');
select is(pg_temp.charge(tests.rid('voice_first_llm'), 'm-2', 301), 'use:SM203', '...then the model again: 701 + 301 would be 1002 of its own: refused');
select is(pg_temp.charge(tests.rid('voice_first_llm'), 'm-3', 300), 'ok', '...300 more is exactly its budget: allowed');
-- a bigger run definition is respected: the voice ceiling is the GREATER of the run's budget and Rs 3.00
select pg_temp.run('big_budget', 5000000);

-- ============================================================================ D. the early check
select pg_temp.run('voice_early');
select is(pg_temp.charge(tests.rid('voice_early'), 'voice-stt', 100, 'voice-stt'), 'ok', 'a voice run...');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('voice_early'), 'nokey', 1, 2000000)) like 'SM203%', false, '...a reported cost inside the voice ceiling passes the early check (and then fails for the missing reservation, not for the budget)');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('voice_early'), 'nokey', 1, 3000001)), 'SM203|agent run budget exhausted||||', '...and one that would pass Rs 3.00 is SM203');

-- ============================================================================ E. isolation and privileges are untouched
select is(pg_temp.err('b_sales', pg_temp.use(tests.rid('voice_run'), 'voice-stt', 600)), '42501|agent action not permitted||||', 'another business cannot record usage on the run');
select is(pg_temp.err('a_admin', pg_temp.use(tests.rid('voice_run'), 'voice-stt', 600)), '42501|agent action not permitted||||', 'nor can another member');
select is(has_function_privilege('anon', 'public.agent_record_usage(uuid, text, bigint, bigint, bigint)', 'execute'), false, 'anon still has no EXECUTE');
select is(has_function_privilege('authenticated', 'public.agent_record_usage(uuid, text, bigint, bigint, bigint)', 'execute'), true, 'authenticated does (the function proves the run is theirs)');
select is((select prosecdef and 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.agent_record_usage(uuid, text, bigint, bigint, bigint)'::regprocedure), true, 'still SECURITY DEFINER with an empty search_path');

select * from finish();
rollback;
