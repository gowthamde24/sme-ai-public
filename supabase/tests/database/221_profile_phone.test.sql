-- Migration 20261231880000: a member's OWN phone on their workspace profile. Set by the member, shown to that member only, read by the assistant as "my number".
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.mset(p_user text, p_patch text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.val(p_user, format('select public.my_profile_set(%L, %L::jsonb)::text', tests.tid(p_tenant), p_patch)) $$;

select is(app.profile_phone_clean('98480 12345'), '+919848012345', 'A1: ten digits get +91');
select is(app.profile_phone_clean('+91 98480-12345'), '+919848012345', 'A2: a +91 number in any spacing');
select is(app.profile_phone_clean('919848012345'), '+919848012345', 'A3: 91 and ten digits');
select is(app.profile_phone_clean('+00 000 000 8101'), '+000000008101', 'A4: a +00 test number (the demo workspaces'' convention) is kept');
select is(app.profile_phone_clean('12345'), null, 'A5: too short');

select is(pg_temp.mset('a_owner', '{"phone":"98480 12345"}')::jsonb ->> 'phone', '+919848012345', 'B1: a member sets their own number (answered back to them)');
select is(pg_temp.mset('a_owner', '{"phone":"98480 12345"}')::jsonb ->> 'phone_confirmed', 'true', 'B2: and it is marked as entered while signed in');
select is(pg_temp.val('a_owner', format('select public.my_profile_get(%L)::text', tests.tid('a')))::jsonb ->> 'phone', '+919848012345', 'B3: they read it back');
select is(pg_temp.val('a_sales', format('select public.my_profile_get(%L)::text', tests.tid('a')))::jsonb ->> 'phone', null, 'B4: another member of the workspace does not see it in their own profile');
select ok(pg_temp.val('a_sales', format('select public.people_profiles(%L)::text', tests.tid('a'))) not like '%9848012345%', 'B5: the team list never carries a phone');
select is(pg_temp.mset('a_owner', '{"phone":"abc"}'), 'ERR:22023', 'B6: a bad number is refused');
select is(pg_temp.mset('a_owner', '{"phone":12345}'), 'ERR:22023', 'B7: a number must be a string');
select is(pg_temp.val('a_owner', format('select public.task_my_phone(%L)::text', tests.tid('a')))::jsonb ->> 'phone', '+919848012345', 'C1: the assistant reads the caller''s own number');
select is(pg_temp.val('a_sales', format('select public.task_my_phone(%L)::text', tests.tid('a')))::jsonb ->> 'phone', null, 'C2: and for another member that member''s own (none), never the owner''s');
select is(pg_temp.val('b_owner', format('select public.task_my_phone(%L)::text', tests.tid('a'))), 'ERR:42501', 'C3: another workspace cannot ask');
select is(pg_temp.mset('a_owner', '{"phone":null}')::jsonb ->> 'phone', null, 'D1: the number is removed with null');
select is(pg_temp.val('a_owner', format('select public.task_my_phone(%L)::text', tests.tid('a')))::jsonb ->> 'phone', null, 'D2: and the assistant then has none');
select * from finish();
rollback;
