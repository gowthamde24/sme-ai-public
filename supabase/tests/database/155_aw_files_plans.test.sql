-- The assistant does the work, A2 (migration 20261229090000): the chat's files, the plan cards, the action log, and the undo of a lead import.
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

-- A: a file is read back only by the person who dropped it, never from the table, and only until it expires
select is(pg_temp.q('a_sales', $q$select (public.assistant_file_put(%L, 'march leads.csv', 'text/csv', 'sheet', encode(convert_to('name,phone' || chr(10) || 'Ravi,9000000001', 'UTF8'), 'base64')) ->> 'kind')$q$), 'sheet', 'A1 Sales drops a file');
create temp table f as select id from public.assistant_files where name = 'march leads.csv';
grant select on f to authenticated;
select is(pg_temp.q('a_sales', format($q$select convert_from(decode(public.assistant_file_get(%%L, %L) ->> 'data_base64', 'base64'), 'UTF8')$q$, (select id from f))), 'name,phone' || chr(10) || 'Ravi,9000000001', 'A2 and reads its bytes back');
select is(pg_temp.q('a_owner', format($q$select public.assistant_file_get(%%L, %L) ->> 'name'$q$, (select id from f))), 'ERR:23503', 'A3 not even the Owner reads someone else''s file');
select is(pg_temp.q('a_viewer', $q$select (public.assistant_file_put(%L, 'x.csv', 'text/csv', 'sheet', 'QQ==') ->> 'kind')$q$), 'ERR:42501', 'A4 a Viewer drops no file');
select is(pg_temp.q('a_sales', $q$select count(data)::text from public.assistant_files where tenant_id = %L$q$), 'ERR:42501', 'A5 the bytes are not readable from the table (not granted)');
select is(pg_temp.q('a_sales', $q$select count(*)::text from (select id, name from public.assistant_files where tenant_id = %L) x$q$), '1', 'A6 the person sees their own file''s name and size');
select is(pg_temp.q('b_owner', format($q$select public.assistant_file_get(%L, %L) ->> 'name'$q$, tests.tid('a'), (select id from f))), 'ERR:42501', 'A7 another workspace: refused');
select is(pg_temp.q('a_sales', $q$select (public.assistant_file_put(%L, 'big.csv', 'text/csv', 'sheet', '') ->> 'kind')$q$), 'ERR:22023', 'A8 an empty file is refused');
update public.assistant_files set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = (select id from f);
select is(pg_temp.q('a_sales', format($q$select public.assistant_file_get(%%L, %L) ->> 'name'$q$, (select id from f))), 'ERR:23503', 'A9 an expired file is gone');

-- B: a plan, its compare-and-set moves, and who may move it
create temp table pl as select gen_random_uuid() as id, gen_random_uuid() as msg;
grant select on pl to authenticated;
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_put(%%L, %L::jsonb) ->> 'status'$q$,
  jsonb_build_object('plan_id', (select id from pl), 'message_id', (select msg from pl), 'title', 'Add 1 lead from ''march leads.csv''', 'steps', jsonb_build_array(jsonb_build_object('tool', 'lead-imports.import_leads', 'status', 'proposed'))))), 'proposed', 'B1 Sales proposes a plan');
select is(pg_temp.q('a_sales', format($q$select jsonb_array_length(public.assistant_plans_for_messages(%%L, array[%L]::uuid[]))::text$q$, (select msg from pl))), '1', 'B2 the reply''s plan is found by its message');
select is(pg_temp.q('a_admin', format($q$select public.assistant_plan_get(%%L, %L) ->> 'title'$q$, (select id from pl))), 'Add 1 lead from ''march leads.csv''', 'B3 an Admin reads it');
select is(pg_temp.q('a_viewer', format($q$select public.assistant_plan_get(%%L, %L) ->> 'title'$q$, (select id from pl))), 'ERR:42501', 'B4 a Viewer does not');
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_move(%%L, %L, 'proposed', 'done') ->> 'status'$q$, (select id from pl))), 'ERR:22023', 'B5 no jump from proposed to done');
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_move(%%L, %L, 'proposed', 'running') ->> 'status'$q$, (select id from pl))), 'running', 'B6 "Do it": running');
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_move(%%L, %L, 'proposed', 'running') ->> 'status'$q$, (select id from pl))), 'ERR:SM981', 'B7 a second "Do it" is refused (it runs once)');
select is(pg_temp.q('a_owner', format($q$select public.assistant_action_record(%%L, %L, 1, 'lead-imports.import_leads', 'Added 1 new lead', 'done', null, '{"leads_added": 1}', '{"kind": "inverse"}') ->> 'action_id'$q$, (select id from pl))), 'ERR:SM981', 'B8 only whoever runs the plan writes its log');
select ok(pg_temp.q('a_sales', format($q$select public.assistant_action_record(%%L, %L, 1, 'lead-imports.import_leads', 'Added 1 new lead', 'done', null, '{"leads_added": 1}', '{"kind": "inverse"}') ->> 'action_id'$q$, (select id from pl))) ~ '^[0-9a-f-]{36}$', 'B9 the runner logs the step');
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_move(%%L, %L, 'running', 'done', %L::jsonb, true) ->> 'file_id'$q$, (select id from pl), jsonb_build_array(jsonb_build_object('tool', 'lead-imports.import_leads', 'status', 'done')))), null, 'B10 done, and the file is let go');
select is(pg_temp.q('a_owner', $q$select count(*)::text from public.assistant_work_actions where tenant_id = %L and status = 'done' and undo_until > now() + interval '6 days'$q$), '1', 'B11 the Owner sees it in the action log, with an undo for 7 days');
select is(pg_temp.q('a_sales', $q$select count(*)::text from public.assistant_work_actions where tenant_id = %L$q$), '0', 'B12 Sales does not read the action log');
select is(pg_temp.q('a_admin', format($q$select public.assistant_plan_move(%%L, %L, 'done', 'undone') ->> 'status'$q$, (select id from pl))), 'ERR:42501', 'B13 an Admin who did not say "Do it" cannot undo it');
select is(pg_temp.q('a_sales', format($q$select public.assistant_action_mark_undone(%%L, %L, 1)::text$q$, (select id from pl))), 'true', 'B14 the step is marked undone');
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_move(%%L, %L, 'done', 'undone') ->> 'status'$q$, (select id from pl))), 'undone', 'B15 and the plan');
create temp table pl2 as select gen_random_uuid() as id;
grant select on pl2 to authenticated;
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_put(%%L, %L::jsonb) ->> 'status'$q$,
  jsonb_build_object('plan_id', (select id from pl2), 'message_id', gen_random_uuid(), 'title', 'Another', 'owner_only', true, 'sensitive', 'money', 'steps', jsonb_build_array(jsonb_build_object('tool', 'x.y'))))), 'proposed', 'B16 a sensitive plan');
select is(pg_temp.q('a_sales', format($q$select public.assistant_plan_move(%%L, %L, 'proposed', 'running') ->> 'status'$q$, (select id from pl2))), 'ERR:42501', 'B17 the Owner''s only: Sales cannot run it');
select is(pg_temp.q('a_admin', format($q$select public.assistant_plan_move(%%L, %L, 'proposed', 'running') ->> 'status'$q$, (select id from pl2))), 'ERR:42501', 'B18 nor an Admin');
update public.assistant_work_plans set created_at = now() - interval '40 minutes', expires_at = now() - interval '10 minutes' where id = (select id from pl2);
select is(pg_temp.q('a_owner', format($q$select public.assistant_plan_get(%%L, %L) ->> 'status'$q$, (select id from pl2))), 'expired', 'B19 after 30 minutes it reads as expired');
select is(pg_temp.q('a_owner', format($q$select public.assistant_plan_move(%%L, %L, 'proposed', 'running') ->> 'status'$q$, (select id from pl2))), 'ERR:SM982', 'B20 and cannot run');

-- C: an import records what it CREATED; its undo archives what nobody worked on since and keeps the rest
create temp table imp as select gen_random_uuid() as id;
grant select on imp to authenticated;
select is(pg_temp.q('a_sales', format($q$select public.lead_intake_apply(%%L, gen_random_uuid(), %L, 1, 'file', 'excel_upload', null, %L::jsonb, null, true) -> 'counts' ->> 'ready'$q$,
  (select id from imp), '[{"name": "Asha Rao", "phone": "9000000101"}, {"name": "Bala K", "phone": "9000000102"}]')), '2', 'C1 a preview counts two new');
select is((select count(*)::text from public.lead_intake_created where import_id = (select id from imp)), '0', 'C2 a preview records nothing');
select is(pg_temp.q('a_sales', format($q$select public.lead_intake_apply(%%L, gen_random_uuid(), %L, 1, 'file', 'excel_upload', null, %L::jsonb, null, false) -> 'counts' ->> 'ready'$q$,
  (select id from imp), '[{"name": "Asha Rao", "phone": "9000000101"}, {"name": "Bala K", "phone": "9000000102"}, {"name": "Chitra", "phone": "9000000103"}]')), '3', 'C3 the import adds three');
select is((select count(*)::text from public.lead_intake_created where import_id = (select id from imp)), '3', 'C4 and records the three it created');
select is(pg_temp.q('a_sales', format($q$select public.lead_intake_apply(%%L, gen_random_uuid(), gen_random_uuid(), 1, 'paste', 'pasted_list', null, %L::jsonb, null, false) -> 'counts' ->> 'duplicates_merged'$q$,
  '[{"name": "Bala K", "phone": "9000000102"}]')), '1', 'C5 another import merges into one of them (a second arrival)');
update public.leads set status = 'in_review' where id = (select lead_id from public.lead_intake_created c join public.contacts k on k.id = c.contact_id where c.import_id = (select id from imp) and k.full_name = 'Chitra');
select is(pg_temp.q('a_viewer', format($q$select public.lead_import_undo(%%L, %L)::text$q$, (select id from imp))), 'ERR:42501', 'C6 a Viewer cannot undo');
select is(pg_temp.q('a_sales', format($q$select public.lead_import_undo(%%L, %L)::text$q$, (select id from imp))), 'ERR:42501', 'C7a archiving is the Owner''s or an Admin''s: Sales cannot undo an import');
select is(pg_temp.q('a_admin', format($q$select (public.lead_import_undo(%%L, %L) - 'import_id')::text$q$, (select id from imp))), '{"kept": 2, "archived": 1, "already_undone": false}', 'C7 the undo archives the untouched one, keeps the one that arrived again and the one that moved on');
select is((select count(*)::text from public.contacts k join public.lead_intake_created c on c.contact_id = k.id where c.import_id = (select id from imp) and k.archived_at is not null), '1', 'C8 one contact archived');
select is((select string_agg(k.full_name, ',') from public.contacts k join public.lead_intake_created c on c.contact_id = k.id join public.leads l on l.id = c.lead_id where c.import_id = (select id from imp) and l.archived_at is null), 'Bala K,Chitra', 'C9 the two kept are live');
select is(pg_temp.q('a_owner', format($q$select (public.lead_import_undo(%%L, %L) ->> 'already_undone')$q$, (select id from imp))), 'true', 'C10 a second undo changes nothing and says so');
select is(pg_temp.q('b_owner', format($q$select public.lead_import_undo(%L, %L)::text$q$, tests.tid('a'), (select id from imp))), 'ERR:42501', 'C11 another workspace: refused');
select is(pg_temp.q('a_owner', $q$select public.lead_import_undo(%L, gen_random_uuid())::text$q$), 'ERR:23503', 'C12 an import that does not exist: not found');

select * from finish();
rollback;
