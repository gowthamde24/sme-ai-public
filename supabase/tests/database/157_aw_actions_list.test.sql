-- The assistant does the work: Settings -> Activity (migration 20261231110000). The action log as a list for the Owner and an Admin only, newest first, one entry by its id, never the stored undo.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

create temp table pl as select gen_random_uuid() as id, gen_random_uuid() as msg;
grant select on pl to authenticated;
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_put(%%L, %L::jsonb) ->> 'status'$q$,
  jsonb_build_object('plan_id', (select id from pl), 'message_id', (select msg from pl), 'title', 'Pause IndiaMART', 'steps', jsonb_build_array(jsonb_build_object('tool', 'lead-sources.pause_source', 'status', 'proposed'), jsonb_build_object('tool', 'lead-sources.resume_source', 'status', 'proposed'))))), 'proposed', 'A1 a plan');
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_move(%%L, %L, 'proposed', 'running') ->> 'status'$q$, (select id from pl))), 'running', 'A2 running');
select ok(pg_temp.q('a_sales', format($q$select public.assistant_action_record(%%L, %L, 1, 'lead-sources.pause_source', 'IndiaMART: active -> paused', 'done', null, '{}', '{"kind": "inverse", "tool": "lead-sources.resume_source", "path": {"source_id": "x"}}') ->> 'action_id'$q$, (select id from pl))) ~ '^[0-9a-f-]{36}$', 'A3 a step with an undo');
select ok(pg_temp.q('a_sales', format($q$select public.assistant_action_record(%%L, %L, 2, 'lead-sources.resume_source', 'IndiaMART: paused -> active', 'failed', 'conflict', '{}', null) ->> 'action_id'$q$, (select id from pl))) ~ '^[0-9a-f-]{36}$', 'A4 a step that failed');
update public.assistant_work_actions set created_at = created_at + interval '1 second' where step_no = 2 and plan_id = (select id from pl);   -- one transaction: the second step a second later

select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.assistant_actions_list(%L))::text$q$), '2', 'B1 the Owner lists both');
select is(pg_temp.q('a_admin', $q$select (public.assistant_actions_list(%L) -> 0 ->> 'summary')$q$), 'IndiaMART: paused -> active', 'B2 an Admin too, newest first');
select is(pg_temp.q('a_sales', $q$select jsonb_array_length(public.assistant_actions_list(%L))::text$q$), 'ERR:42501', 'B3 Sales does not');
select is(pg_temp.q('a_viewer', $q$select jsonb_array_length(public.assistant_actions_list(%L))::text$q$), 'ERR:42501', 'B4 nor a Viewer');
select is(pg_temp.q('b_owner', format($q$select jsonb_array_length(public.assistant_actions_list(%L))::text$q$, tests.tid('a'))), 'ERR:42501', 'B5 another workspace''s Owner: refused');
select is(pg_temp.q('a_owner', $q$select string_agg(x ->> 'undo', ',' order by x ->> 'step_no') from jsonb_array_elements(public.assistant_actions_list(%L)) x$q$), 'available,none', 'B6 the undo''s state: available for the done step, none for the failed one');
select is(pg_temp.q('a_owner', $q$select count(*)::text from jsonb_array_elements(public.assistant_actions_list(%L)) x where x ? 'undo_until' or x::text like '%%resume_source"%%path%%'$q$), '0', 'B7 the stored undo itself is never returned');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.assistant_actions_list(%L, null, null, 1))::text$q$), '1', 'B8 a limit');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.assistant_actions_list(%L, null, null, 0))::text$q$), 'ERR:22023', 'B9 a limit of 0 is refused');
select is(pg_temp.q('a_owner', format($q$select (public.assistant_actions_list(%%L, null, null, 50, (select id from public.assistant_work_actions where step_no = 1 and plan_id = %L)) -> 0 ->> 'step_no')$q$, (select id from pl))), '1', 'B10 one entry by its id');
update public.assistant_work_actions set undo_until = now() - interval '1 minute' where step_no = 1 and plan_id = (select id from pl);
select is(pg_temp.q('a_owner', $q$select string_agg(x ->> 'undo', ',' order by x ->> 'step_no') from jsonb_array_elements(public.assistant_actions_list(%L)) x$q$), 'expired,none', 'B11 an undo past its 7 days is expired');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.assistant_actions_list(%L, now() + interval '1 hour'))::text$q$), '0', 'B12 since: nothing after now');

select is(pg_temp.q('a_owner', format($q$select jsonb_array_length(public.assistant_actions_list(%%L, null, null, 50, null, %L))::text$q$, (select id from pl))), '2', 'B13 one plan''s entries');
select is(pg_temp.q('a_owner', format($q$select jsonb_array_length(public.assistant_actions_list(%%L, null, null, 50, null, %L))::text$q$, gen_random_uuid())), '0', 'B14 another plan: none');

select * from finish();
rollback;
