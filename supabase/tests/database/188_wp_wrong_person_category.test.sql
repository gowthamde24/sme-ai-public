-- Owner, 12 Nov 2026 (migration 20261231500000): a call can end as "wrong_person"; the category list stays closed.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

create temp table t_call as select (pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'outbound', 'sandbox', true, %L, 'visit_reminder', 'te', null, true)::text$q$, tests.tid('a'), tests.rid('a_contact')))::jsonb ->> 'id') as id;
create temp table t_call2 as select (pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'outbound', 'sandbox', true, %L, 'visit_reminder', 'te', null, true)::text$q$, tests.tid('a'), tests.rid('a_contact')))::jsonb ->> 'id') as id;
select pg_temp.sc('a_owner', format($q$select public.phone_call_update(%L, %L, 'in_progress')::text$q$, tests.tid('a'), (select id from t_call)));
select pg_temp.sc('a_owner', format($q$select public.phone_call_update(%L, %L, 'in_progress')::text$q$, tests.tid('a'), (select id from t_call2)));

select is((pg_temp.sc('a_owner', format($q$select public.phone_call_finish(%L, %L, 'completed', 'goodbye', 'negative', 'wrong_person', null, '{"goal_result":"not_done"}'::jsonb, 'Not done: the caller was an uncle.', null, 30)::text$q$, tests.tid('a'), (select id from t_call)))::jsonb) ->> 'category', 'wrong_person', 'A1: a call finishes with the category wrong_person');
select is((select category from public.phone_calls where id = (select id::uuid from t_call)), 'wrong_person', 'A2: and it is stored');
select ok(pg_temp.sc('a_owner', format($q$select public.phone_call_finish(%L, %L, 'completed', 'goodbye', 'negative', 'not_a_category', null, null, null, null, 30)::text$q$, tests.tid('a'), (select id from t_call2))) like 'ERR:%', 'A3: a word that is not on the list is still refused');
select is((select category from public.phone_calls where id = (select id::uuid from t_call2)), null, 'A4: and nothing was stored');
select is((select count(*) from pg_constraint where conname = 'phone_calls_category_check' and conrelid = 'public.phone_calls'::regclass), 1::bigint, 'A5: one category constraint');
select * from finish();
rollback;
