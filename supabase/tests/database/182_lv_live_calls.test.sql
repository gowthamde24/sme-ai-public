-- The live-calls bar never lies (migration 20261231380000): a call is live only while fresh (under 10 minutes old, a heartbeat within 6 minutes); an orphaned call is closed by the worker; the call carries the
-- assistant's name and the line; only the phone server and members write the notes.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.live(p_user text) returns text language plpgsql as $$
begin
  return pg_temp.q(p_user, format($q$select coalesce(string_agg(x ->> 'id', ',' order by x ->> 'id'), '') from jsonb_array_elements(public.phone_calls_list(%L, 'live')) x$q$, tests.tid('a')));
end $$;

insert into public.phone_numbers (id, tenant_id, number, label, inbound_on) values (tests.rid('line'), tests.tid('a'), '+914045903172', 'Hyderabad ExoPhone', true);
insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, answered_at, created_at, heartbeat_at) values
  (tests.rid('c_fresh'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'in_progress', now() - interval '20 seconds', now() - interval '30 seconds', now() - interval '5 seconds'),
  (tests.rid('c_old'),   tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'in_progress', now() - interval '11 minutes', now() - interval '11 minutes', now() - interval '5 seconds'),
  (tests.rid('c_quiet'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'in_progress', now() - interval '8 minutes', now() - interval '9 minutes', now() - interval '7 minutes'),
  (tests.rid('c_nobeat'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'in_progress', now() - interval '20 seconds', now() - interval '30 seconds', null),
  (tests.rid('c_ancient'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'in_progress', now() - interval '20 minutes', now() - interval '20 minutes', now() - interval '5 seconds');

select is(pg_temp.live('a_owner'), (select string_agg(i, ',' order by i) from (values (tests.rid('c_fresh')::text), (tests.rid('c_nobeat')::text)) v(i)), 'A1 only fresh calls are live: not one over 10 minutes old, not one that has been silent for 6 minutes; a call that has not beaten yet counts from its start');
select is(pg_temp.q('a_owner', format($q$select (select x ->> 'live' from jsonb_array_elements(public.phone_calls_list(%L, 'all')) x where x ->> 'id' = %L)$q$, tests.tid('a'), tests.rid('c_old'))), 'false', 'A2 the same ghost shows as not live in "all"');
select is(pg_temp.q('a_owner', format($q$select jsonb_array_length(public.phone_calls_list(%L, 'finished'))::text$q$, tests.tid('a'))), '0', 'A3 and it is not "finished" either, until the worker closes it');
select is(pg_temp.q('a_sales', format($q$select (public.phone_call_get(%L, %L) ->> 'live')$q$, tests.tid('a'), tests.rid('c_fresh'))), 'true', 'A4 the detail says the same');

-- the heartbeat brings a quiet call back
select is(pg_temp.q('outsider', format($q$select public.phone_call_heartbeat(%L, %L)::text$q$, tests.tid('a'), tests.rid('c_quiet'))), 'true', 'B1 the phone server beats');
select is(pg_temp.live('a_owner'), (select string_agg(i, ',' order by i) from (values (tests.rid('c_fresh')::text), (tests.rid('c_nobeat')::text), (tests.rid('c_quiet')::text)) v(i)), 'B2 the quiet call is live again');
select is(pg_temp.q('a_viewer', format($q$select public.phone_call_heartbeat(%L, %L)::text$q$, tests.tid('a'), tests.rid('c_quiet'))), 'ERR:42501', 'B3 a Viewer cannot beat for a call');
select is(pg_temp.q('b_owner', format($q$select public.phone_call_heartbeat(%L, %L)::text$q$, tests.tid('a'), tests.rid('c_quiet'))), 'ERR:42501', 'B4 nor another workspace');

-- the notes
select is(pg_temp.q('outsider', format($q$select public.phone_call_note(%L, %L, 'Priya', %L)::text$q$, tests.tid('a'), tests.rid('c_fresh'), tests.rid('line'))), '', 'C1 the phone server notes the assistant name and the line');
select is(pg_temp.q('outsider', format($q$select public.phone_call_note(%L, %L, 'Other', null)::text$q$, tests.tid('a'), tests.rid('c_fresh'))), '', 'C2 a second note keeps the first');
select is(pg_temp.q('a_owner', format($q$select (public.phone_call_get(%L, %L) ->> 'assistant_name') || '|' || (public.phone_call_get(%L, %L) ->> 'line') || '|' || (public.phone_call_get(%L, %L) ->> 'line_ending')$q$, tests.tid('a'), tests.rid('c_fresh'), tests.tid('a'), tests.rid('c_fresh'), tests.tid('a'), tests.rid('c_fresh'))),
          'Priya|Hyderabad ExoPhone|172', 'C3 the Owner reads the name, the line''s name and its ending');
select is(pg_temp.q('a_sales', format($q$select (public.phone_call_get(%L, %L) ->> 'assistant_name') || '|' || coalesce(public.phone_call_get(%L, %L) ->> 'line', 'none') || '|' || (public.phone_call_get(%L, %L) ->> 'line_ending')$q$, tests.tid('a'), tests.rid('c_fresh'), tests.tid('a'), tests.rid('c_fresh'), tests.tid('a'), tests.rid('c_fresh'))),
          'Priya|none|172', 'C4 Sales read the name and the ending, not the line''s name (they cannot read the lines)');
select is(pg_temp.q('outsider', format($q$select public.phone_call_note(%L, %L, 'a<script>', null)::text$q$, tests.tid('a'), tests.rid('c_fresh'))), 'ERR:22023', 'C5 a name with markup is refused');
select is(pg_temp.q('b_owner', format($q$select public.phone_call_note(%L, %L, 'x', null)::text$q$, tests.tid('a'), tests.rid('c_fresh'))), 'ERR:42501', 'C6 another workspace cannot');

-- a call that finished before its note arrived still gets it (a very short call)
update public.phone_calls set state = 'completed', ended_at = now(), end_reason = 'goodbye' where id = tests.rid('c_nobeat');
select is(pg_temp.q('outsider', format($q$select public.phone_call_note(%L, %L, 'Priya', null)::text$q$, tests.tid('a'), tests.rid('c_nobeat'))), '', 'D1 the note reaches a finished call');
select is(pg_temp.q('outsider', format($q$select public.phone_call_heartbeat(%L, %L)::text$q$, tests.tid('a'), tests.rid('c_nobeat'))), 'false', 'D2 and a beat for a finished call does nothing');
select throws_ok($$update public.phone_calls set summary = 'changed' where id = tests.rid('c_nobeat')$$, 'SM961', null, 'D3 the finished call still does not change in any other way');

-- the worker closes orphans
select is(pg_temp.q('a_owner', $$select public.phone_calls_close_orphans(240)::text$$), 'ERR:42501', 'E1 only the worker closes calls');
select is(pg_temp.q('outsider', $$select public.phone_calls_close_orphans(5)::text$$), 'ERR:22023', 'E2 the seconds are bounded');
update public.phone_calls set heartbeat_at = now() - interval '7 minutes' where id = tests.rid('c_quiet');
select is(pg_temp.q('outsider', $$select public.phone_calls_close_orphans(240)::text$$), '2', 'E3 the call silent for 7 minutes and the one older than 15 minutes (though it still beats) are closed; the 11-minute-old call that beats is left to the display rule');
select is((select state || '/' || end_reason || '/' || outcome from public.phone_calls where id = tests.rid('c_quiet')), 'failed/error/failed', 'E4 closed as failed with the reason error');
select ok((select ended_at is not null and duration_s >= 1200 from public.phone_calls where id = tests.rid('c_ancient')), 'E5 with an end time and the length it ran');
select is((select state from public.phone_calls where id = tests.rid('c_fresh')), 'in_progress', 'E6 a live call is left alone');
select is(pg_temp.q('a_owner', format($q$select jsonb_array_length(public.phone_calls_list(%L, 'finished'))::text$q$, tests.tid('a'))), '3', 'E7 the closed ones are finished now');

select is(pg_temp.q('outsider', format($q$select public.phone_line_find('+914045903172') ->> 'line_id'$q$)), tests.rid('line')::text, 'F1 the line lookup names the line');

select * from finish();
rollback;
