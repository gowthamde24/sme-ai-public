-- Hand over to a person (migration 20261231160000): a hand-over call shows on Today until a member marks it handled; a finished call otherwise still never changes.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.open_gate('a');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, end_reason, answered_at, ended_at)
values (tests.rid('h1'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'completed', 'handover', now() - interval '3 minutes', now() - interval '2 minutes'),
       (tests.rid('h2'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'completed', 'goodbye', now() - interval '3 minutes', now() - interval '2 minutes');

select is(pg_temp.q('a_owner', $q$select count(*)::text from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'person_requested'$q$), '1', 'A1 the hand-over call is on Today');
select is(pg_temp.q('a_sales', $q$select (select x ->> 'customer' from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'person_requested')$q$), 'A caller', 'A2 ... for Sales too, "A caller" without a contact');
select is(pg_temp.q('a_viewer', $q$select count(*)::text from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'person_requested'$q$), '0', 'A3 not for a Viewer');
select is(pg_temp.q('a_viewer', format($q$select public.phone_call_handled(%%L, %L)::text$q$, tests.rid('h1'))), 'ERR:42501', 'B1 a Viewer cannot mark it');
select ok(pg_temp.q('a_sales', format($q$select public.phone_call_handled(%%L, %L) ->> 'handled_at'$q$, tests.rid('h1'))) is not null, 'B2 Sales marks it handled');
select is(pg_temp.q('a_owner', $q$select count(*)::text from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'person_requested'$q$), '0', 'B3 ... and it leaves Today');
select is(pg_temp.q('a_owner', format($q$select public.phone_call_handled(%%L, %L)::text$q$, gen_random_uuid())), 'ERR:23503', 'B4 an unknown call');
select throws_ok($$update public.phone_calls set summary = 'changed' where id = tests.rid('h2')$$, 'SM961', null, 'C1 a finished call still does not change');
select throws_ok($$update public.phone_calls set handled_at = null, handled_by = null where id = tests.rid('h1')$$, 'SM961', null, 'C2 nor can the mark be taken back');

select * from finish();
rollback;
