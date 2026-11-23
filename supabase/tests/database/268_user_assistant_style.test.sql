-- "To you": a person's own assistant style (migration 20261231988200).  A a person reads and sets only their own   B the seven words, clearing, a retry   C nobody else, nobody signed out
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_get() ->> 'saved')$$), 'false', 'A1: a person who never chose has nothing saved');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_set('calm_caring') ->> 'value')$$), 'calm_caring', 'A2: choosing returns the choice');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_get() ->> 'saved')$$), 'true', 'A3: and it is saved');
select is(pg_temp.at('a_viewer', $$select (public.my_assistant_style_get() ->> 'saved')$$), 'false', 'A4: another person of the same business sees nothing of it (their own setting is separate)');
select is(pg_temp.at('b_owner', $$select (public.my_assistant_style_get() ->> 'value')$$), null, 'A5: nor a person of another business');
select is(pg_temp.at('a_viewer', $$select (public.my_assistant_style_set('cheerful') ->> 'value')$$), 'cheerful', 'A6: any member sets their own, a Viewer too');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_get() ->> 'value')$$), 'calm_caring', 'A7: and that did not touch the Owner''s');

-- B
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_set('confident') ->> 'value')$$), 'confident', 'B1: a change replaces the old one');
select is((select count(*) from public.user_assistant_style where user_id = tests.uid('a_owner')), 1::bigint, 'B2: still one row');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_set('confident') ->> 'value')$$), 'confident', 'B3: the same again is fine');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_set('casual') ->> 'value')$$), 'ERR:22023', 'B4: casual is test-call only, not a choice');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_set('Friendly ') ->> 'value')$$), 'ERR:22023', 'B5: a word that is not exactly one of the seven is invalid');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_get() ->> 'value')$$), 'confident', 'B6: a refusal changed nothing');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_set(null) ->> 'saved')$$), 'false', 'B7: null clears it');
select is((select count(*) from public.user_assistant_style where user_id = tests.uid('a_owner')), 0::bigint, 'B8: the row is gone');
select is(pg_temp.at('a_owner', $$select (public.my_assistant_style_set(null) ->> 'saved')$$), 'false', 'B9: clearing again is fine');

-- C
select is(pg_temp.at('anon', $$select public.my_assistant_style_get()::text$$), 'ERR:42501', 'C1: nobody signed out reads');
select is(pg_temp.at('anon', $$select public.my_assistant_style_set('cheerful')::text$$), 'ERR:42501', 'C2: nor writes');
select is(has_table_privilege('authenticated', 'public.user_assistant_style', 'select'), false, 'C3: the table itself is closed to clients (only the two functions reach it)');
select is(has_table_privilege('anon', 'public.user_assistant_style', 'insert'), false, 'C4: and to a signed-out visitor');
select is(has_function_privilege('anon', 'public.my_assistant_style_set(text)', 'execute'), false, 'C5: a signed-out visitor cannot run the setter');

select * from finish();
rollback;
