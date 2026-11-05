-- "How I talk to customers" (migration 20261231150000): the Owner saves (second factor), the Owner and an Admin read, the scheduler reads it for a call; size and clean text are checked.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.open_gate('a');
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.q(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin
  perform tests.as_aal(p_aal);
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(pg_temp.q('a_owner', $q$select public.talk_training_get(%L)::text$q$), null, 'A1 nothing saved yet: null (the API shows the defaults)');
select is(pg_temp.q('a_owner', $q$select public.talk_training_save(%L, '{"address": "plain", "never_say": ["guaranteed delivery"]}') -> 'doc' ->> 'address'$q$), 'plain', 'A2 the Owner saves');
select is(pg_temp.q('a_owner', $q$select public.talk_training_save(%L, '{"address": "garu"}') ->> 'doc'$q$, 'aal1'), 'ERR:SM306', 'A3 ... only with the second factor');
select is(pg_temp.q('a_admin', $q$select public.talk_training_save(%L, '{"address": "garu"}') ->> 'doc'$q$), 'ERR:42501', 'A4 an Admin does not save');
select is(pg_temp.q('a_admin', $q$select public.talk_training_get(%L) -> 'doc' -> 'never_say' ->> 0$q$), 'guaranteed delivery', 'A5 an Admin reads it');
select is(pg_temp.q('a_sales', $q$select public.talk_training_get(%L)::text$q$), 'ERR:42501', 'A6 Sales does not');
select is(pg_temp.q('b_owner', format($q$select public.talk_training_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A7 nor another workspace''s Owner');
select is(pg_temp.q('a_owner', $q$select public.talk_training_save(%L, '[1, 2]') ->> 'doc'$q$), 'ERR:22023', 'A8 not an object: refused');
select is(pg_temp.q('a_owner', format($q$select public.talk_training_save(%%L, %L::jsonb) ->> 'doc'$q$, jsonb_build_object('never_say', jsonb_build_array(repeat('x', 21000))))), 'ERR:22023', 'A9 too big: refused');
select is(pg_temp.q('x5', $q$select public.talk_training_for_call(%L) ->> 'address'$q$), 'plain', 'B1 the scheduler reads it for a call');
select is(pg_temp.q('a_owner', $q$select public.talk_training_for_call(%L) ->> 'address'$q$), 'ERR:42501', 'B2 a person does not use the call door');
select is(pg_temp.q('a_owner', $q$select public.talk_training_reset(%L)::text$q$), '', 'C1 the Owner goes back to the defaults');
select is(pg_temp.q('a_owner', $q$select public.talk_training_get(%L)::text$q$), null, 'C2 ... nothing saved again');

select * from finish();
rollback;
