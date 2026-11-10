-- Job AI: the phone line reads the workspace's "mention that I'm an AI" switch (migration 20261231470000): the scheduler reads it, nobody else does, no row means ON.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.open_gate('a');
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.q(p_user text, p_tenant text default 'a') returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');
  return tests.scalar_as(tests.uid(p_user), format('select public.phone_mention_ai_for_call(%L)::text', tests.tid(p_tenant)));
exception when others then return 'ERR:' || sqlstate;
end $$;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'phone_mention_ai_for_call' and p.prosecdef and p.proconfig @> array['search_path=""']), 1::bigint, 'A: a security-definer function with an empty search path');
select is((select has_function_privilege('anon', 'public.phone_mention_ai_for_call(uuid)', 'execute')), false, 'A: anon cannot run it');
select is(pg_temp.q('x5'), 'true', 'B1: no row means the greeting mentions the AI (default ON)');
select is(pg_temp.q('a_owner'), 'ERR:42501', 'B2: a person does not use the call door (Owner)');
select is(pg_temp.q('a_admin'), 'ERR:42501', 'B3: ... nor an Admin');
select is(pg_temp.q('b_owner', 'a'), 'ERR:42501', 'B4: ... nor another workspace''s Owner');

-- the Owner switches it off through the existing door; the scheduler then reads false, only for that workspace
select tests.as_aal('aal2');
select lives_ok(format($q$select tests.scalar_as(tests.uid('a_owner'), format('select public.opening_set_mention(%%L, null, false)::text', %L))$q$, tests.tid('a')), 'C1: the Owner switches it off');
select is(pg_temp.q('x5'), 'false', 'C2: the scheduler now reads OFF for that workspace');
select is(pg_temp.q('x5', 'b'), 'true', 'C3: another workspace is still ON');
select * from finish();
rollback;
