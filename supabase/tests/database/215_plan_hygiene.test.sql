-- Plan hygiene (migration 20261231810000): a plan with nobody to contact is not a Needs-you item, the task says its origin, and stale plans are cancelled by the worker.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

insert into public.tasks (id, tenant_id, instruction, language, status, template, plan, estimate, estimated_paise, created_by, origin, created_at)
values (tests.rid('empty_plan'), tests.tid('a'), 'call now', 'en', 'planned', 'custom', '{"channel":"call","contacts_total":0,"consent":{"skipped":0}}'::jsonb, '{}'::jsonb, 0, tests.uid('a_owner'), 'screen', now() - interval '45 minutes'),
       (tests.rid('people_plan'), tests.tid('a'), 'call them', 'en', 'planned', 'custom', '{"channel":"call","contacts_total":3,"consent":{"skipped":0}}'::jsonb, '{}'::jsonb, 0, tests.uid('a_owner'), 'screen', now() - interval '45 minutes'),
       (tests.rid('ask_plan'), tests.tid('a'), 'call the rest', 'en', 'planned', 'custom', '{"channel":"call","contacts_total":0,"consent":{"skipped":4}}'::jsonb, '{}'::jsonb, 0, tests.uid('a_owner'), 'screen', now() - interval '45 minutes'),
       (tests.rid('ancient_plan'), tests.tid('a'), 'call them', 'en', 'planned', 'custom', '{"channel":"call","contacts_total":3,"consent":{"skipped":0}}'::jsonb, '{}'::jsonb, 0, tests.uid('a_owner'), 'screen', now() - interval '26 hours');

select is(jsonb_array_length(pg_temp.val('a_owner', format($q$select public.tasks_list(%L, 'planned')::text$q$, tests.tid('a')))::jsonb), 3, 'A1: the plan with nobody in it is not listed');
select is((pg_temp.val('a_owner', format($q$select public.tasks_list(%L, 'planned')::text$q$, tests.tid('a')))::jsonb) -> 0 ->> 'origin', 'screen', 'A2: the task says where it came from');
select is(((pg_temp.val('a_owner', format($q$select public.nav_counts(%L)::text$q$, tests.tid('a')))::jsonb) ->> 'lead_desk_waiting')::int, 3, 'A3: and the badge does not count it');

select is(pg_temp.val('a_owner', 'select public.scheduler_expire_conversation_plans()::text'), 'ERR:42501', 'B1: only the scheduler account expires plans');
insert into scheduler.principals (user_id) values (tests.uid('a_viewer')) on conflict do nothing;
select is(pg_temp.val('a_viewer', 'select public.scheduler_expire_conversation_plans()::text'), '2', 'B2: the empty plan and the 26-hour-old plan are cancelled');
select is((select status from public.tasks where id = tests.rid('empty_plan')), 'cancelled', 'B3: the plan with nobody is cancelled');
select is((select status from public.tasks where id = tests.rid('ancient_plan')), 'cancelled', 'B4: a plan nobody answered for a day is cancelled');
select is((select status from public.tasks where id = tests.rid('people_plan')), 'planned', 'B5: a recent plan with people waits for the Owner');
select is((select status from public.tasks where id = tests.rid('ask_plan')), 'planned', 'B6: a plan whose people must be asked first stays');
select * from finish();
rollback;
