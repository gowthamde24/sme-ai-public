-- Language pill (migration 20261224160000): the language a member chose for talking to the assistant, kept per member.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.mset(p_user text, p_patch text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.val(p_user, format('select public.my_profile_set(%L, %L::jsonb)::text', tests.tid(p_tenant), p_patch)) $$;
create function pg_temp.mget(p_user text, p_tenant text default 'a') returns jsonb language sql as $$
  select pg_temp.val(p_user, format('select public.my_profile_get(%L)::text', tests.tid(p_tenant)))::jsonb $$;

select is(pg_temp.mget('a_sales') -> 'preferred_chat_language', 'null'::jsonb, 'A1: never chosen: null (auto)');
select is((pg_temp.mset('a_sales', '{"preferred_chat_language":"te"}')::jsonb) ->> 'preferred_chat_language', 'te', 'A2: a member chooses Telugu');
select is(pg_temp.mget('a_sales') ->> 'preferred_chat_language', 'te', 'A3: ...and reads it back');
select is(pg_temp.mget('a_owner') -> 'preferred_chat_language', 'null'::jsonb, 'A4: it is theirs alone: the Owner has not chosen');
select is((pg_temp.mset('a_sales', '{"preferred_chat_language":"auto"}')::jsonb) ->> 'preferred_chat_language', 'auto', 'A5: auto is a choice too');
select is((pg_temp.mset('a_sales', '{"preferred_chat_language":"ml","address_as":"Anna"}')::jsonb) ->> 'address_as', 'Anna', 'A6: together with the other profile fields');
select is(pg_temp.mset('a_sales', '{"preferred_chat_language":"xx"}'), 'ERR:22023', 'B1: an unknown language is refused');
select is(pg_temp.mset('a_sales', '{"preferred_chat_language":null}'), 'ERR:22023', 'B2: null is not a language (auto is)');
select is(pg_temp.mset('a_sales', '{"preferred_chat_language":5}'), 'ERR:22023', 'B3: nor a number');
select is(pg_temp.mset('a_sales', '{"preferred_chat_language":"te"}', 'b'), 'ERR:42501', 'C1: not in another workspace');
select is(pg_temp.mset('anon', '{"preferred_chat_language":"te"}'), 'ERR:42501', 'C2: nor anon');
select is(pg_temp.mget('a_viewer') -> 'preferred_chat_language', 'null'::jsonb, 'C3: a Viewer may have one too (null until they choose)');
select is((pg_temp.mset('a_viewer', '{"preferred_chat_language":"hi"}')::jsonb) ->> 'preferred_chat_language', 'hi', 'C4: and chooses it');
select * from finish();
rollback;
