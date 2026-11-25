-- JOBS S3a: the AI line follows the job's own override (migration 20261231987600) and the real on/off switch of follow-ups, store visits and the researcher (migration 20261231987700).
--   A the AI line of an outbox message by its category: the job's own word, else the business setting
--   B who may switch a job, which kinds can be switched, that a switch is a row of the job (and nothing else)
--   C the one reader of the switch
--   D the work reads it: every function that does the work of the three jobs asks app.job_enabled (the text of each is checked; what a paused job does end to end is the API's tests)
-- All data is synthetic. (What a paused job does end to end is the API's tests and the integration run: here the reader, the writer and that each place of the work asks.)
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.oc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.outcome_as(tests.uid(p_user), p_sql);
end $$;
create function pg_temp.sw(p_user text, p_kind text, p_on text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select (public.job_meta_set_enabled(%L, %L, %L::boolean) ->> 'enabled')$q$, tests.tid(p_tenant), (select id from public.jobs_meta where tenant_id = tests.tid('a') and kind = p_kind), p_on))
$$;

-- ============================================================================ A. the AI line by message category
insert into public.talk_training (tenant_id, doc, updated_by) values (tests.tid('a'), '{"ai_off_undertaking": {"at": "2026-11-26", "by": "owner"}, "say_ai_when_greeting": false, "say_ai_by_job": {"followups": "on", "store_visits": "off"}}'::jsonb, tests.uid('a_owner'))
  on conflict (tenant_id) do update set doc = excluded.doc;
select is(app.outbox_mention_ai(tests.tid('a'), 'followup'), true, 'A1 the follow-ups job says it is on: the line is added although the business setting is off');
select is(app.outbox_mention_ai(tests.tid('a'), 'visit'), false, 'A2 the store-visits job off, the business off: no line');
select is(app.outbox_mention_ai(tests.tid('a'), 'info'), false, 'A3 a message of no job follows the business setting (off)');
select is(app.outbox_mention_ai(tests.tid('a'), null), false, 'A4 no category: the business setting');
update public.talk_training set doc = '{"ai_off_undertaking": {"at": "2026-11-26", "by": "owner"}, "say_ai_when_greeting": true, "say_ai_by_job": {"followups": "on", "store_visits": "off"}}'::jsonb where tenant_id = tests.tid('a');
select is(app.outbox_mention_ai(tests.tid('a'), 'visit'), false, 'A5 the business on, the store-visits job off: no line');
select is(app.outbox_mention_ai(tests.tid('a'), 'followup'), true, 'A6 ... the follow-ups job on: the line');
select is(app.outbox_mention_ai(tests.tid('a'), 'order_status'), true, 'A7 ... a message of no job: the business setting (on)');
update public.talk_training set doc = '{"say_ai_when_greeting": true, "say_ai_by_job": {"followups": "yes", "store_visits": 3}}'::jsonb where tenant_id = tests.tid('a');
select is(app.outbox_mention_ai(tests.tid('a'), 'followup'), true, 'A8 a word that is not on or off is no override: the business setting');
update public.talk_training set doc = '{"say_ai_when_greeting": true, "say_ai_by_job": "x"}'::jsonb where tenant_id = tests.tid('a');
select is(app.outbox_mention_ai(tests.tid('a'), 'visit'), true, 'A9 a say_ai_by_job that is not an object is ignored');
select is(app.outbox_mention_ai(tests.tid('b'), 'followup'), true, 'A10 a business that never chose: ON (the default, lawyer''s opinion 25 Nov 2026)');
select is(app.outbox_mention_ai(tests.tid('a')), true, 'A11 the one-argument function still answers the business setting');

-- ============================================================================ B. who may switch a job
select is(pg_temp.sc('a_owner', format($q$select (public.job_meta_ensure(%L, %L) ->> 'enabled')$q$, tests.tid('a'), 'followups')), 'true', 'B1 a job is on when it is made (and its page carries `enabled`)');
select pg_temp.sc('a_owner', format($q$select public.job_meta_ensure(%L, 'store_visits')::text$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.job_meta_ensure(%L, 'researcher')::text$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.job_meta_ensure(%L, 'offers')::text$q$, tests.tid('a')));
select is(pg_temp.sw('a_owner', 'followups', 'false'), 'false', 'B2 the Owner switches follow-ups off');
select is(pg_temp.sw('a_admin', 'followups', 'true'), 'true', 'B3 an Admin switches it on');
select is(pg_temp.sw('a_sales', 'followups', 'false'), 'ERR:42501', 'B4 Sales cannot');
select is(pg_temp.sw('a_viewer', 'followups', 'false'), 'ERR:42501', 'B5 a Viewer cannot');
select is(pg_temp.sw('a_owner', 'followups', null), 'ERR:22023', 'B6 no value is refused');
select is(pg_temp.sw('a_owner', 'offers', 'false'), 'ERR:23503', 'B7 a job with a switch of its own (offers) has none here');
select is(pg_temp.sw('b_owner', 'store_visits', 'false', 'b'), 'ERR:23503', 'B8 another business cannot switch this business''s job');
select is((select enabled from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'followups'), true, 'B9 the refusals changed nothing');
select is(pg_temp.sw('a_owner', 'store_visits', 'false'), 'false', 'B10 store visits off');
select is(pg_temp.sw('a_owner', 'researcher', 'false'), 'false', 'B11 the researcher off');
select is((select count(*)::int from public.jobs_meta where tenant_id = tests.tid('a') and not enabled), 2, 'B12 the switches are the rows of the jobs: two are off');
select is(pg_temp.oc('a_owner', $q$update public.jobs_meta set enabled = false$q$), '42501', 'B13 nobody writes the switch directly');
select is(pg_temp.sc('a_viewer', format($q$select (public.job_meta_list(%L)::jsonb -> 0 ->> 'enabled')$q$, tests.tid('a'))) in ('true', 'false'), true, 'B14 every member reads the switch in the list');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'job_meta_set_enabled'
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')
             and p.prosecdef and p.proconfig @> array['search_path=""']), 1, 'B15 signed-in people only, SECURITY DEFINER, an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('job_enabled', 'followup_policy_for_work', 'outbox_mention_ai')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'B16 no client role can execute the internal functions');

-- ============================================================================ C. the one reader
select is(app.job_enabled(tests.tid('a'), 'followups'), true, 'C1 on');
select is(app.job_enabled(tests.tid('a'), 'store_visits'), false, 'C2 off');
select is(app.job_enabled(tests.tid('a'), 'researcher'), false, 'C3 off');
select is(app.job_enabled(tests.tid('b'), 'store_visits'), true, 'C4 another business is not touched, and a job with no row is on');
select is(app.job_enabled(tests.tid('a'), 'offers'), true, 'C5 a kind that was never switched is on');
select is(app.followup_policy_for_work(tests.tid('a'), current_date), (select app.followup_active_policy_version(tests.tid('a'), current_date)), 'C6 follow-ups on: the policy is the active one');
select pg_temp.sw('a_owner', 'followups', 'false');
select is(app.followup_policy_for_work(tests.tid('a'), current_date), null::uuid, 'C7 follow-ups off: no policy is in force for work');
select pg_temp.sw('a_owner', 'followups', 'true');

-- ============================================================================ D. the work reads the switch
select ok(pg_get_functiondef('public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer)'::regprocedure) like '%followup_policy_for_work%', 'D1 the due list asks');
select ok(pg_get_functiondef('public.create_followup_draft(uuid, uuid, text, text, text, text)'::regprocedure) like '%followup_policy_for_work%', 'D2 a new draft asks');
select ok(pg_get_functiondef('app.appointment_assistant_may(uuid)'::regprocedure) like '%job_enabled(p_tenant, ''store_visits'')%', 'D3 the assistant offers and books visits only while the job is on');
select ok(pg_get_functiondef('public.visit_slots_for_call(uuid, integer, integer)'::regprocedure) like '%job_enabled(p_tenant_id, ''store_visits'')%', 'D4 the free slots for a call');
select ok(pg_get_functiondef('app.scheduler_reminder_due(public.store_visits, text, timestamptz, jsonb)'::regprocedure) like '%job_enabled(m.tenant_id, ''store_visits'')%', 'D5 a reminder is due only while the job is on');
select ok(pg_get_functiondef('public.prospect_search_plan(uuid, uuid, text, text, text, integer, text, text, bigint, text)'::regprocedure) like '%job_enabled(p_tenant_id, ''researcher'')%', 'D6 a search is planned only while the researcher is on');
select ok(pg_get_functiondef('public.prospect_search_approve(uuid, uuid)'::regprocedure) like '%job_enabled(p_tenant_id, ''researcher'')%', 'D7 ... and approved');
select ok(pg_get_functiondef('app.outbox_submit_core(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean, text)'::regprocedure) like '%outbox_mention_ai(p_tenant_id, p_category)%', 'D8 the outbox asks with the category');

select * from finish();
rollback;
