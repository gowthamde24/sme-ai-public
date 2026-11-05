-- Visit booking from a call (migration 20261231180000): the scheduler reads the next free slots (only with the visits module); a call whose caller picked one is on Today until marked done.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.open_gate('a');
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-02T11:00:00+05:30'::timestamptz);   -- a Monday, 11:00 India time
create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

select ok(app.module_enabled(tests.tid('a'), 'visits'), 'S0 (the visits module is on)');

select ok((pg_temp.q('x5', $q$select jsonb_array_length(public.visit_slots_for_call(%L))::text$q$))::int between 1 and 6, 'A1 the scheduler reads the next free slots (at most 6)');
select ok(pg_temp.q('x5', $q$select (public.visit_slots_for_call(%L) -> 0 ->> 'starts_at')::timestamptz >= timestamptz '2026-11-02T11:30:00+05:30'$q$)::boolean, 'A2 none sooner than 30 minutes from now');
select is(pg_temp.q('a_owner', $q$select public.visit_slots_for_call(%L)::text$q$), 'ERR:42501', 'A3 a person does not use the call door');
select is(pg_temp.q('x5', $q$select public.visit_slots_for_call(%L, 9)::text$q$), 'ERR:22023', 'A4 at most a week ahead');

insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, end_reason, answered_at, ended_at, captured)
values (tests.rid('v1'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'completed', 'goodbye', now() - interval '3 minutes', now() - interval '2 minutes', '{"visit_at": "2026-11-03T10:00:00+05:30"}');
select is(pg_temp.q('a_sales', $q$select (select x ->> 'kind' from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'visit_requested')$q$), 'visit_requested', 'B1 the caller''s visit is on Today');
select ok(pg_temp.q('a_owner', format($q$select public.phone_call_handled(%%L, %L) ->> 'handled_at'$q$, tests.rid('v1'))) is not null, 'B2 a member marks it done (after booking it in Visits)');
select is(pg_temp.q('a_owner', $q$select count(*)::text from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'visit_requested'$q$), '0', 'B3 ... and it leaves Today');

select * from finish();
rollback;
