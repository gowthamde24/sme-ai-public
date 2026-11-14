-- A plan proposed in a conversation is not a Needs-you item (migration 20261231770000): the Tasks list and the sidebar badge leave it out until it is answered; a plan made on the Tasks screen still waits there.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

insert into public.tasks (id, tenant_id, instruction, language, status, template, plan, estimate, estimated_paise, created_by)
values (tests.rid('screen_plan'), tests.tid('a'), 'Call the new leads', 'en', 'planned', 'custom', '{"channel":"call"}'::jsonb, '{}'::jsonb, 0, tests.uid('a_owner')),
       (tests.rid('talk_plan'), tests.tid('a'), 'a raw Talk live sentence', 'en', 'planned', 'custom', '{"channel":"call"}'::jsonb, '{}'::jsonb, 0, tests.uid('a_owner'));

select is(pg_temp.val('a_sales', format($q$select public.task_mark_conversation(%L, %L)::text$q$, tests.tid('a'), tests.rid('talk_plan'))), '', 'A1: Sales marks a plan it made for a conversation');
select is((select origin from public.tasks where id = tests.rid('talk_plan')), 'conversation', 'A2: it is a conversation plan now');
select is((select origin from public.tasks where id = tests.rid('screen_plan')), 'screen', 'A3: a plan made on the Tasks screen keeps its origin');
select is(pg_temp.val('a_viewer', format($q$select public.task_mark_conversation(%L, %L)::text$q$, tests.tid('a'), tests.rid('screen_plan'))), 'ERR:42501', 'A4: a Viewer cannot');
select is(pg_temp.val('b_owner', format($q$select public.task_mark_conversation(%L, %L)::text$q$, tests.tid('a'), tests.rid('screen_plan'))), 'ERR:42501', 'A5: nor another workspace');
select is(pg_temp.val('a_owner', format($q$select public.task_mark_conversation(%L, %L)::text$q$, tests.tid('a'), gen_random_uuid())), 'ERR:23503', 'A6: a plan that is not there');

select is(jsonb_array_length(pg_temp.val('a_owner', format($q$select public.tasks_list(%L, 'planned')::text$q$, tests.tid('a')))::jsonb), 1, 'B1: only the Tasks screen plan is listed as waiting');
select is(jsonb_array_length(pg_temp.val('a_owner', format($q$select public.tasks_list(%L)::text$q$, tests.tid('a')))::jsonb), 1, 'B2: and the list without a filter leaves the conversation plan out too');
select is(((pg_temp.val('a_owner', format($q$select public.nav_counts(%L)::text$q$, tests.tid('a')))::jsonb) ->> 'lead_desk_waiting')::int, 1, 'B3: the badge counts one waiting plan, not two');

update public.tasks set status = 'cancelled' where id = tests.rid('talk_plan');
select is(jsonb_array_length(pg_temp.val('a_owner', format($q$select public.tasks_list(%L)::text$q$, tests.tid('a')))::jsonb), 2, 'C1: an answered conversation plan (here cancelled) is listed like any other task');

select * from finish();
rollback;
