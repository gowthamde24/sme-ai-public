-- Job BP (ADR 0078, migration 20261119090000): the database side of the web research tools.
--   A the definitions and privileges   B the accounting ceiling (voice only Rs 3.00, a run with web tools Rs 8.00, the model's own budget untouched)
--   C the daily limit (web_quota_take)  D the usage read (web_usage_today)  E the query check (web_query_check)
-- Prices: web-search 1,000 micros a token (a search = 600 tokens = 600,000), web-page 50 tokens, places-search 3,000 tokens (Rs 3.00), metal-price 100 tokens; voice 1,000 micros a token; fake-selftest 1 micro a token.
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
create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.run(p_label text, p_budget bigint default 1000) returns uuid language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs, max_cost_micros, max_input_tokens, max_output_tokens)
  values (tests.rid(p_label), tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'), now() + interval '15 minutes', repeat('7', 64), '{}'::jsonb, p_budget, 100000, 1000);
  return tests.rid(p_label);
end $$;
-- charge: reserve then settle one step as the run's starter; 'ok' or the first refusal's SQLSTATE
create function pg_temp.charge(p_run uuid, p_key text, p_tokens bigint, p_model text default 'fake-selftest') returns text language plpgsql as $$
declare v text;
begin
  v := pg_temp.sc(tests.uid('a_sales'), format('select public.agent_reserve_cost(%L, %L, %L, %s, 0)', p_run, p_key, p_model, p_tokens));
  if v like '{"error"%' then return 'reserve:' || (v::jsonb ->> 'error'); end if;
  if (v::jsonb ->> 'granted') is distinct from 'true' then return 'reserve:refused'; end if;
  v := pg_temp.sc(tests.uid('a_sales'), format('select public.agent_record_usage(%L, %L, %s, 0, 0)', p_run, p_key, p_tokens));
  if v like '{"error"%' then return 'use:' || (v::jsonb ->> 'error'); end if;
  return 'ok';
end $$;
-- one counted web call, the way the API makes it: the daily limit first, then the reservation, then the settlement
create function pg_temp.web(p_run uuid, p_key text, p_model text, p_tokens bigint) returns text language plpgsql as $$
declare v text;
begin
  v := pg_temp.sc(tests.uid('a_sales'), format('select public.web_quota_take(%L, %L)', p_run, p_model));
  if v like '{"error"%' then return 'quota:' || (v::jsonb ->> 'error'); end if;
  return pg_temp.charge(p_run, p_key, p_tokens, p_model);
end $$;

insert into public.contacts (id, tenant_id, company_id, full_name) values
  (tests.rid('a_lakshmi'), tests.tid('a'), tests.rid('a_company'), 'Lakshmi Devi'),
  (tests.rid('a_raj'), tests.tid('a'), tests.rid('a_company'), 'Raj'),
  (tests.rid('a_spaced'), tests.tid('a'), tests.rid('a_company'), '  Anil   Kumar Rao '),
  (tests.rid('b_suresh'), tests.tid('b'), tests.rid('b_company'), 'Suresh Babu');

-- ============================================================================ A. the definitions and privileges
select is((select count(*) from public.agent_model_prices where model in ('web-search', 'web-page', 'places-search', 'metal-price') and input_micros_per_mtok = 1000000000 and output_micros_per_mtok = 1000000000), 4::bigint, 'the four web accounting models are priced at 1,000 micros a token');
select is((select string_agg(model || '=' || per_day, ',' order by model) from research.web_caps), 'metal-price=20,places-search=10,web-page=60,web-search=30', 'the daily limits per workspace');
select is(app.is_metered_model('voice-stt') and app.is_metered_model('voice-tts') and app.is_metered_model('web-search') and app.is_metered_model('web-page') and app.is_metered_model('places-search') and app.is_metered_model('metal-price'), true, 'the six metered models');
select is(app.is_metered_model('fake-selftest') or app.is_metered_model('claude-sonnet-5-5') or app.is_metered_model('webinar'), false, 'a model call is not a metered call');
select is(has_function_privilege('anon', 'public.web_quota_take(uuid, text)', 'execute') or has_function_privilege('anon', 'public.web_usage_today(uuid)', 'execute') or has_function_privilege('anon', 'public.web_query_check(uuid, text)', 'execute'), false, 'anon can run none of the three');
select is(has_function_privilege('authenticated', 'public.web_quota_take(uuid, text)', 'execute') and has_function_privilege('authenticated', 'public.web_usage_today(uuid)', 'execute') and has_function_privilege('authenticated', 'public.web_query_check(uuid, text)', 'execute'), true, 'authenticated can (each proves the run or the role itself)');
select is(has_function_privilege('authenticated', 'app.metered_ceiling(uuid, uuid)', 'execute') or has_function_privilege('authenticated', 'app.is_metered_model(text)', 'execute'), false, 'the app.* helpers are not callable by a client');
select is((select bool_and(prosecdef and 'search_path=""' = any (proconfig)) from pg_proc where oid in ('public.web_quota_take(uuid, text)'::regprocedure, 'public.web_usage_today(uuid)'::regprocedure, 'public.web_query_check(uuid, text)'::regprocedure)), true, 'SECURITY DEFINER with an empty search_path');
select is(has_schema_privilege('authenticated', 'research', 'usage') or has_table_privilege('authenticated', 'research.web_caps', 'select') or has_table_privilege('service_role', 'research.web_caps', 'select'), false, 'the limits table is closed to every client role');

-- ============================================================================ B. the accounting ceiling
select pg_temp.run('plain');
select is(app.metered_ceiling(tests.tid('a'), tests.rid('plain')), 3000000::bigint, 'a run with nothing metered: the old Rs 3.00');
select pg_temp.run('voice_only');
select is(pg_temp.charge(tests.rid('voice_only'), 'v-1', 600, 'voice-stt'), 'ok', 'a voice charge on a run with a Rs 0.001 own budget');
select is(app.metered_ceiling(tests.tid('a'), tests.rid('voice_only')), 3000000::bigint, 'voice only: the ceiling is still Rs 3.00');
select is(pg_temp.charge(tests.rid('voice_only'), 'v-2', 2400, 'voice-tts'), 'ok', 'voice only: 0.60 + 2.40 = Rs 3.00 exactly is allowed');
select is(pg_temp.charge(tests.rid('voice_only'), 'v-3', 1, 'voice-tts'), 'use:SM203', 'voice only: one micro more is refused (SM203): BD''s rule is unchanged');

select pg_temp.run('web_run');
select is(pg_temp.web(tests.rid('web_run'), 'w-s1', 'web-search', 600), 'ok', 'WEB RUN: a search costs 600,000 micros although the run''s own budget is 1000');
select is(app.metered_ceiling(tests.tid('a'), tests.rid('web_run')), 8000000::bigint, '...and the run''s ceiling for metered spending is now Rs 8.00');
select is(pg_temp.web(tests.rid('web_run'), 'w-s2', 'web-search', 600) || '/' || pg_temp.web(tests.rid('web_run'), 'w-s3', 'web-search', 600), 'ok/ok', 'three searches (Rs 1.80)');
select is(pg_temp.web(tests.rid('web_run'), 'w-pl', 'places-search', 3000), 'ok', 'a places search (Rs 3.00): 4.80');
select is(pg_temp.web(tests.rid('web_run'), 'w-m', 'metal-price', 100) || '/' || pg_temp.web(tests.rid('web_run'), 'w-p1', 'web-page', 50) || '/' || pg_temp.web(tests.rid('web_run'), 'w-p2', 'web-page', 50), 'ok/ok/ok', 'a metal price and two pages: 5.00 in all, the per-question worst case');
select is((select sum(settled_micros) from public.agent_cost_reservations where run_id = tests.rid('web_run')), 5000000::numeric, '...the ledger holds Rs 5.00 for the run');
select is((select cost_micros_used from public.agent_runs where id = tests.rid('web_run')), 0::bigint, '...none of it in the run''s own model counter');
select is(pg_temp.charge(tests.rid('web_run'), 'v-1', 600, 'voice-stt'), 'ok', 'a spoken question on top (voice 0.60): 5.60, under Rs 8.00');
select is(pg_temp.charge(tests.rid('web_run'), 'v-2', 2400, 'voice-tts'), 'ok', 'a spoken answer (2.40): exactly Rs 8.00');
select is(pg_temp.charge(tests.rid('web_run'), 'v-3', 1, 'voice-tts'), 'use:SM203', 'one micro over Rs 8.00 is refused (SM203)');
select is(pg_temp.charge(tests.rid('web_run'), 'm-1', 1000), 'ok', 'the model''s own spending is still its own budget (1000)...');
select is(pg_temp.charge(tests.rid('web_run'), 'm-2', 1), 'use:SM203', '...and one micro more is refused: web charges do not widen it');

select pg_temp.run('text_only');
select is(pg_temp.charge(tests.rid('text_only'), 'm-1', 1001), 'use:SM203', 'a run with no metered call: the model''s budget is exact, as before');

-- ============================================================================ C. the daily limit
-- a fresh day for tenant A: the earlier rows count, so measure from a baseline
select pg_temp.run('quota');
update research.web_caps set per_day = (select count(*) from public.agent_cost_reservations where tenant_id = tests.tid('a') and model = 'web-search' and cost_day = app.agent_cost_day(now()) and outcome is distinct from 'not_billed') + 2 where model = 'web-search';
select is(pg_temp.sc(tests.uid('a_sales'), format('select public.web_quota_take(%L, %L)::jsonb ->> ''left''', tests.rid('quota'), 'web-search')), '1', 'the first call of two left: one is left after it');
select is(pg_temp.web(tests.rid('quota'), 'q-1', 'web-search', 600), 'ok', '(a call that is made)');
select is(pg_temp.web(tests.rid('quota'), 'q-2', 'web-search', 600), 'ok', 'the second (and last) call');
select is(pg_temp.web(tests.rid('quota'), 'q-3', 'web-search', 600), 'quota:SM251', 'the third is refused with SM251');
select is(pg_temp.err('a_sales', format('select public.web_quota_take(%L, %L)', tests.rid('quota'), 'web-search')) like 'SM251|%', true, '...and keeps being refused');
select is(pg_temp.web(tests.rid('quota'), 'q-pg', 'web-page', 50), 'ok', 'another kind of call has its own limit');
select is((select count(*) from public.agent_cost_reservations where run_id = tests.rid('quota') and step_key = 'q-3'), 0::bigint, 'a refused call made no reservation');
-- a released (not billed) call does not use the limit up
select pg_temp.run('quota2');
update research.web_caps set per_day = (select count(*) from public.agent_cost_reservations where tenant_id = tests.tid('a') and model = 'web-search' and cost_day = app.agent_cost_day(now()) and outcome is distinct from 'not_billed') + 1 where model = 'web-search';
select is(pg_temp.sc(tests.uid('a_sales'), format('select public.agent_reserve_cost(%L, %L, %L, 600, 0)::jsonb ->> ''granted''', tests.rid('quota2'), 'r-1', 'web-search')), 'true', 'a reservation is made for a search...');
select is(pg_temp.sc(tests.uid('a_sales'), format('select public.agent_release_cost(%L, %L, %L)::jsonb ->> ''released''', tests.rid('quota2'), 'r-1', 'rate_limited')), 'true', '...and released: the provider refused it');
select is(pg_temp.web(tests.rid('quota2'), 'r-2', 'web-search', 600), 'ok', 'the released call did not count: one call is still allowed');
select is(pg_temp.web(tests.rid('quota2'), 'r-3', 'web-search', 600), 'quota:SM251', '...and then the limit is reached');
-- another workspace's use does not count against this one
insert into public.tenant_agent_settings (tenant_id, enabled) values (tests.tid('b'), true);
update public.agent_definitions set allowed_tenants = array[tests.tid('a'), tests.tid('b')] where agent_name = 'selftest';
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
values (tests.rid('b_quota'), tests.tid('b'), tests.uid('b_sales'), 'selftest', 'v1', tests.rid('b_company'), now() + interval '15 minutes', repeat('8', 64), '{}'::jsonb);
select is(pg_temp.sc(tests.uid('b_sales'), format('select public.web_quota_take(%L, %L)::jsonb ->> ''used''', tests.rid('b_quota'), 'web-search')), '1', 'another workspace counts its own calls from zero');
-- who may ask
select is(pg_temp.err('a_admin', format('select public.web_quota_take(%L, %L)', tests.rid('quota'), 'web-page')), '42501|agent action not permitted||||', 'only the run''s starter may take quota on it');
select is(pg_temp.err('b_sales', format('select public.web_quota_take(%L, %L)', tests.rid('quota'), 'web-page')), '42501|agent action not permitted||||', 'another business cannot');
select is(pg_temp.err('a_sales', format('select public.web_quota_take(%L, %L)', tests.rid('quota'), 'web-fish')) like '22023|%', true, 'an unknown kind of call is invalid');
select is(pg_temp.err('a_sales', format('select public.web_quota_take(%L, %L)', gen_random_uuid(), 'web-search')), '42501|agent action not permitted||||', 'an unknown run is the same refusal');
update research.web_caps set per_day = 30 where model = 'web-search';

-- ============================================================================ D. the usage read
select is(pg_temp.sc(tests.uid('a_owner'), format('select (public.web_usage_today(%L)::jsonb -> ''web-search'' ->> ''cap'')', tests.tid('a'))), '30', 'the Owner reads the limit');
select is((pg_temp.sc(tests.uid('a_admin'), format('select public.web_usage_today(%L)::text', tests.tid('a')))::jsonb -> 'web-page' ->> 'used')::int >= 1, true, 'the Admin reads what was used today');
select is((select count(*) from jsonb_object_keys(pg_temp.sc(tests.uid('a_owner'), format('select public.web_usage_today(%L)::text', tests.tid('a')))::jsonb)), 4::bigint, 'one entry per kind of call');
select is(pg_temp.sc(tests.uid('b_owner'), format('select (public.web_usage_today(%L)::jsonb -> ''web-search'' ->> ''used'')', tests.tid('b'))), '0', 'another workspace sees only its own use (none: the other business''s calls are not in it)');
select is(pg_temp.err('a_sales', format('select public.web_usage_today(%L)', tests.tid('a'))), '42501|not allowed||||', 'Sales may not read it');
select is(pg_temp.err('a_viewer', format('select public.web_usage_today(%L)', tests.tid('a'))), '42501|not allowed||||', 'nor a Viewer');
select is(pg_temp.err('b_owner', format('select public.web_usage_today(%L)', tests.tid('a'))), '42501|not allowed||||', 'nor another business''s Owner');

-- ============================================================================ E. the query check
select pg_temp.run('qc');
create function pg_temp.qc(p_user text, p_q text) returns text language sql as $$
  select pg_temp.sc(tests.uid(p_user), format('select public.web_query_check(%L, %L)', tests.rid('qc'), p_q)) $$;
select is(pg_temp.qc('a_sales', 'saree wholesalers in Guntur'), 'true', 'an ordinary query may go');
select is(pg_temp.qc('a_sales', 'is Lakshmi Devi a reliable payer'), 'false', 'a contact''s full name may not');
select is(pg_temp.qc('a_sales', 'IS LAKSHMI   DEVI A RELIABLE PAYER'), 'false', '...in any case and spacing');
select is(pg_temp.qc('a_sales', 'news about anil kumar rao'), 'false', 'a name stored with extra spaces is still caught');
select is(pg_temp.qc('a_sales', 'Lakshmi silks Chennai'), 'true', 'a first name alone is a fine word (a company can be called that)');
select is(pg_temp.qc('a_sales', 'Raj sarees'), 'true', 'a name shorter than four characters is not compared');
select is(pg_temp.qc('a_sales', 'Suresh Babu silk exports'), 'true', 'another business''s contact is not this business''s concern');
select is(pg_temp.qc('a_sales', 'Company a silks'), 'true', 'a company name may go');
alter table public.contacts disable trigger contacts_guard_erased;  -- the test stands in for an erasure
update public.contacts set erased_at = now() where id = tests.rid('a_lakshmi');
alter table public.contacts enable trigger contacts_guard_erased;
select is(pg_temp.qc('a_sales', 'is Lakshmi Devi a reliable payer'), 'true', 'an erased contact''s name is not compared');
select is(pg_temp.err('a_sales', format('select public.web_query_check(%L, %L)', tests.rid('qc'), repeat('x', 301))) like '22023|%', true, 'a query over 300 characters is invalid');
select is(pg_temp.err('a_admin', format('select public.web_query_check(%L, %L)', tests.rid('qc'), 'silk')), '42501|agent action not permitted||||', 'only the run''s starter may ask');
select is(pg_temp.err('b_sales', format('select public.web_query_check(%L, %L)', tests.rid('qc'), 'silk')), '42501|agent action not permitted||||', 'another business cannot');

select * from finish();
rollback;
