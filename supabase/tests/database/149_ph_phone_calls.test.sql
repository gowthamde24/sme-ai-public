-- Job phone-calls part 1 (migration 20261225090000): the data of an AI phone call.
--   A catalog and grants   B a call from queued to finished (states, times, the transcript)   C roles   D one workspace only   E guards: no recording, finished calls never move, never deleted, the refusal words
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('phone_call_begin', 'phone_call_update', 'phone_call_finish', 'phone_calls_list', 'phone_call_get', 'phone_calls_stats', 'phone_line_find')
            and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 7::bigint,
          'A1: the seven phone functions are SECURITY DEFINER, empty search_path, not for anon');
select is((select count(*) from information_schema.table_privileges where table_schema = 'public' and table_name in ('phone_calls', 'phone_numbers') and grantee in ('anon', 'authenticated', 'public') and privilege_type <> 'SELECT'), 0::bigint,
          'A2: nobody writes the tables directly');

-- B: a call
create temp table t_call as select (pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'outbound', 'sandbox', true, %L, 'visit_reminder', 'te', null, true)::text$q$, tests.tid('a'), tests.rid('a_contact')))::jsonb ->> 'id') as id;
select is((select state from public.phone_calls where id = (select id::uuid from t_call)), 'queued', 'B1: a new call is queued');
select is((select ai_disclosed from public.phone_calls where id = (select id::uuid from t_call)), true, 'B2: and says whether the AI told the person it is an AI');
select is((select lead_id is not null from public.phone_calls where id = (select id::uuid from t_call)), true, 'B3: it is linked to the contact''s lead');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_call_update(%L, %L, 'ringing', 'CA123456')::text$q$, tests.tid('a'), (select id from t_call))), 'state'), 'ringing', 'B4: ringing');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_call_update(%L, %L, 'in_progress')::text$q$, tests.tid('a'), (select id from t_call))), 'state'), 'in_progress', 'B5: answered');
select is((select provider_call_sid from public.phone_calls where id = (select id::uuid from t_call)), 'CA123456', 'B6: the provider''s call id is kept');
select ok((select answered_at is not null from public.phone_calls where id = (select id::uuid from t_call)), 'B7: the answer time is set');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_calls_stats(%L, %L)::text$q$, tests.tid('a'), tests.rid('a_contact'))), 'active_to_contact'), '1', 'B9: stats count the live call to this person');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_call_finish(%L, %L, 'completed', 'goodbye', 'positive', 'visit_booked', null, '{"day":"Saturday"}'::jsonb, 'Wants to visit on Saturday.',
          '[{"who":"assistant","text":"Hello"},{"who":"caller","text":"Yes"}]'::jsonb, 150)::text$q$, tests.tid('a'), (select id from t_call))), 'state'), 'completed', 'B10: finished');
select ok((select ended_at is not null and duration_s is not null from public.phone_calls where id = (select id::uuid from t_call)), 'B11: with an end time and a length');
select is(jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.phone_call_get(%L, %L)::text$q$, tests.tid('a'), (select id from t_call)))::jsonb -> 'transcript'), 2, 'B12: the Owner reads the transcript');
select is(pg_temp.sc('a_sales', format($q$select (public.phone_call_get(%L, %L)::jsonb ? 'transcript')::text$q$, tests.tid('a'), (select id from t_call))), 'false', 'B13: Sales read the call but not the transcript');
select is(jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.phone_calls_list(%L, 'finished')::text$q$, tests.tid('a')))::jsonb), 1, 'B14: the list of finished calls has it');
select is(jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.phone_calls_list(%L, 'live')::text$q$, tests.tid('a')))::jsonb), 0, 'B15: and the live list does not');

-- C: roles
select is(pg_temp.sc('a_viewer', format($q$select public.phone_calls_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C1: a Viewer does not see the calls');
select is(pg_temp.sc('a_viewer', format($q$select public.phone_call_begin(%L, 'outbound', 'sandbox')::text$q$, tests.tid('a'))), 'ERR:42501', 'C2: nor starts one');
select is(pg_temp.sc('anon', format($q$select public.phone_calls_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C3: anon is nobody');
select isnt(pg_temp.sc('a_sales', format($q$select public.phone_calls_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C4: Sales read the list');

-- D: one workspace
select is(pg_temp.sc('b_owner', format($q$select public.phone_calls_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D1: another workspace''s Owner cannot list these calls');
select is(pg_temp.sc('b_owner', format($q$select public.phone_call_get(%L, %L)::text$q$, tests.tid('b'), (select id from t_call))), 'ERR:23503', 'D2: nor read one by its id through their own workspace');
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'outbound', 'sandbox', true, %L)::text$q$, tests.tid('a'), tests.rid('b_contact'))), 'ERR:23503', 'D3: a call cannot name a contact of another workspace');

-- E: guards
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_finish(%L, %L, 'completed')::text$q$, tests.tid('a'), (select id from t_call))), 'ERR:SM961', 'E1: a finished call does not finish again');
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_update(%L, %L, 'ringing')::text$q$, tests.tid('a'), (select id from t_call))), 'ERR:SM961', 'E2: nor ring again');
select throws_ok(format($q$update public.phone_calls set summary = 'changed' where id = %L$q$, (select id from t_call)), 'SM961', null, 'E3: a finished call does not change');
select throws_ok(format($q$delete from public.phone_calls where id = %L$q$, (select id from t_call)), '42501', null, 'E4: a call is never deleted');
select throws_ok(format($q$insert into public.phone_calls (tenant_id, direction, provider, recorded) values (%L, 'outbound', 'sandbox', true)$q$, tests.tid('a')), '23514', null, 'E6: no call is ever marked recorded (no audio is kept)');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'outbound', 'sandbox', true, %L, 'sales_followup', 'te', null, false, 'dnd')::text$q$, tests.tid('a'), tests.rid('a_contact'))), 'state'), 'refused', 'E7: a call the gate refused is kept, with the reason');
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'outbound', 'sandbox', true, %L, 'sales_followup', 'te', null, false, 'because I said so')::text$q$, tests.tid('a'), tests.rid('a_contact'))), 'ERR:22023', 'E8: the reason is one of the closed words');
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'outbound', 'exotel', true, null, 'sales_followup', 'fr')::text$q$, tests.tid('a'))), 'ERR:22023', 'E9: a language outside the six is refused');
select * from finish();
rollback;
