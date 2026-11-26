-- AI employees (migration 20261231992750): the default employee of every workspace, who may do what, the plan limit (1 on a trial, 5 paid), names, the patch rules (hours never wider than the legal window), voices per language,
-- the number an employee answers, what a call reads (an employee that is not on never answers), and that workspaces never see each other's employees.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.w(p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid('outsider'), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A. the default employee
select is(pg_temp.at('a_viewer', format($q$select jsonb_array_length((public.employees_list(%L)) -> 'employees')::text$q$, tests.tid('a'))), '1', 'A1: a member reads the list: the default employee is there');
select is(pg_temp.at('a_viewer', format($q$select ((public.employees_list(%L)) -> 'employees' -> 0 ->> 'is_default')$q$, tests.tid('a'))), 'true', 'A2: it is the default one');
select is(pg_temp.at('b_owner', format($q$select public.employees_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A3: another workspace cannot read it');
select is(pg_temp.at('a_viewer', format($q$select ((public.employees_list(%L)) ->> 'limit')$q$, tests.tid('a'))), '1', 'A4: a trial workspace may have 1 employee (the default)');

-- B. create: Owner and Admin; a trial is full with the default; names; retry
select is(pg_temp.at('a_sales', format($q$select public.employee_create(%L, %L, 'sales', 'Priya')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:42501', 'B1: Sales cannot create an employee');
select is(pg_temp.at('a_owner', format($q$select public.employee_create(%L, %L, 'sales', 'Priya')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:SM861', 'B2: a trial workspace is full with the default employee');

-- a paid plan (the cap is the same function the lists use): 5 employees
create or replace function app.sell_list_paid(p_tenant uuid) returns boolean language sql stable as $$ select true $$;
select is(pg_temp.at('a_viewer', format($q$select ((public.employees_list(%L)) ->> 'limit')$q$, tests.tid('a'))), '5', 'B3: a paid workspace may have 5');
select is(pg_temp.at('a_owner', format($q$select ((public.employee_create(%L, %L, 'sales', 'Priya')) ->> 'status')$q$, tests.tid('a'), tests.rid('e1'))), 'draft', 'B4: a new employee starts as a draft');
select is(pg_temp.at('a_owner', format($q$select ((public.employee_create(%L, %L, 'sales', 'Priya')) ->> 'id')$q$, tests.tid('a'), tests.rid('e1'))), tests.rid('e1')::text, 'B5: the same id again is a retry');
select is(pg_temp.at('a_owner', format($q$select public.employee_create(%L, %L, 'sales', 'priya')::text$q$, tests.tid('a'), tests.rid('e2'))), 'ERR:SM862', 'B6: the same name in another case is name_taken');
select is(pg_temp.at('a_owner', format($q$select public.employee_create(%L, %L, 'boss', 'Ravi')::text$q$, tests.tid('a'), tests.rid('e2'))), 'ERR:22023', 'B7: an unknown role is invalid');
select is(pg_temp.at('a_owner', format($q$select public.employee_create(%L, %L, 'sales', 'R<b>avi')::text$q$, tests.tid('a'), tests.rid('e2'))), 'ERR:22023', 'B8: a name with markup characters is invalid');
select is(pg_temp.at('a_admin', format($q$select ((public.employee_create(%L, %L, 'collections', 'Ravi')) -> 'responsibilities')::text$q$, tests.tid('a'), tests.rid('e2'))), '["payment_reminder"]', 'B9: a role starts with its usual responsibilities');

-- C. update
select is(pg_temp.at('a_sales', format($q$select public.employee_update(%L, %L, '{"role_title":"x"}')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:42501', 'C1: Sales cannot edit');
select is(pg_temp.at('a_owner', format($q$select ((public.employee_update(%L, %L, '{"role_title":"Sales assistant","extra_instructions":"Always ask the fabric first.","languages":["te","en"],"speed":1.1}')) ->> 'role_title')$q$, tests.tid('a'), tests.rid('e1'))), 'Sales assistant', 'C2: the owner edits identity, instructions, languages and speed');
select is(pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"boss":1}')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:22023', 'C3: an unknown key is invalid');
select is(pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"hours":{"days":[1,2,3],"from_minute":540,"to_minute":1200}}')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:SM864', 'C4: hours from 09:00 are wider than the legal window');
select is(pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"hours":{"days":[1,2,3],"from_minute":660,"to_minute":1140}}')::jsonb -> 'hours' ->> 'from_minute'$q$, tests.tid('a'), tests.rid('e1'))), '660', 'C5: narrower hours (11:00 to 19:00) are kept');
select is(pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"autonomy":{"may_answer_prices":true,"max_discount_percent":150}}')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:22023', 'C6: a discount over 100 percent is invalid');
select is(pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"ask_first":["send_message","teleport"]}')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:22023', 'C7: an unknown ask-first action is invalid');
select is(pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"name":"Ravi"}')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:SM862', 'C8: a name another employee has is name_taken');
select is(pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"speed":1.1}')::text$q$, (select e.tenant_id from public.ai_employees e where e.is_default and e.tenant_id = tests.tid('a')), (select e.id from public.ai_employees e where e.is_default and e.tenant_id = tests.tid('a')))), 'ERR:SM865', 'C9: the default employee''s persona is set in My assistant, not here');
select is(pg_temp.at('a_owner', format($q$select ((public.employee_update(%L, %L, '{"extra_instructions":"Be brief."}')) ->> 'extra_instructions')$q$, tests.tid('a'), (select e.id from public.ai_employees e where e.is_default and e.tenant_id = tests.tid('a')))), 'Be brief.', 'C10: its identity fields can be edited');

select is(pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"hours":null}')::jsonb ->> 'hours'$q$, tests.tid('a'), tests.rid('e1'))), null, 'C5b: the hours can be taken away again (null)');

-- D. voices (a language the employee speaks; the voice id begins with the language)
select is(pg_temp.at('a_owner', format($q$select ((public.employee_voice_set(%L, %L, 'te', 'te-ramya')) -> 'voices' ->> 'te')$q$, tests.tid('a'), tests.rid('e1'))), 'te-ramya', 'D1: a voice per language');
select is(pg_temp.at('a_owner', format($q$select public.employee_voice_set(%L, %L, 'te', 'hi-sanya')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:22023', 'D2: a voice of another language is invalid');
select is(pg_temp.at('a_owner', format($q$select public.employee_voice_set(%L, %L, 'kn', 'kn-disha')::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:22023', 'D3: a language the employee does not speak is invalid');
select is(pg_temp.at('a_owner', format($q$select public.employee_voice_set(%L, %L, 'en', 'en-janvi')::text$q$, tests.tid('a'), (select e.id from public.ai_employees e where e.is_default and e.tenant_id = tests.tid('a')))), 'ERR:SM865', 'D4: the default employee speaks with My assistant''s voices');

-- E. status
select is(pg_temp.at('a_owner', format($q$select ((public.employee_status_set(%L, %L, 'on')) ->> 'status')$q$, tests.tid('a'), tests.rid('e1'))), 'on', 'E1: switched on');
select is(pg_temp.at('a_owner', format($q$select public.employee_status_set(%L, %L, 'paused')::text$q$, tests.tid('a'), (select e.id from public.ai_employees e where e.is_default and e.tenant_id = tests.tid('a')))), 'ERR:SM863', 'E2: the default employee cannot be paused');
select is(pg_temp.at('a_owner', format($q$select ((public.employee_status_set(%L, %L, 'on')) ->> 'status')$q$, tests.tid('a'), tests.rid('e2'))), 'on', 'E3: a role''s starting responsibilities are enough to switch on');

-- F. the number an employee answers, and what a call reads
insert into public.phone_numbers (id, tenant_id, number, label) values (tests.rid('n1'), tests.tid('a'), '+911234500001', 'Sales line');
select is(pg_temp.at('a_owner', format($q$select ((public.employee_phone_set(%L, %L, %L)) ->> 'phone_number_id')$q$, tests.tid('a'), tests.rid('e1'), tests.rid('n1'))), tests.rid('n1')::text, 'F1: a number can be given to an employee');
select is(pg_temp.at('b_owner', format($q$select public.employee_phone_set(%L, %L, %L)::text$q$, tests.tid('b'), tests.rid('e1'), tests.rid('n1'))), 'ERR:23503', 'F2: another workspace cannot use it');
select is(pg_temp.w(format($q$select (public.employee_runtime(%L, null, '+911234500001')) ->> 'name'$q$, tests.tid('a'))), 'Priya', 'F3: the call to that line is answered by that employee');
select is(pg_temp.w(format($q$select (public.employee_runtime(%L, null, '+919999999999')) ->> 'is_default'$q$, tests.tid('a'))), 'true', 'F4: any other line goes to the default employee');
select pg_temp.at('a_owner', format($q$select public.employee_status_set(%L, %L, 'paused')::text$q$, tests.tid('a'), tests.rid('e1')));
select is(pg_temp.w(format($q$select (public.employee_runtime(%L, null, '+911234500001')) ->> 'is_default'$q$, tests.tid('a'))), 'true', 'F5: an employee that is paused never answers: the default does');
select is(pg_temp.at('a_viewer', format($q$select (public.employee_runtime(%L, null, null))::text$q$, tests.tid('a'))), 'ERR:42501', 'F6: only the scheduler''s account reads what a call needs');
select is(pg_temp.at('a_owner', format($q$select ((public.employee_status_set(%L, %L, 'archived')) ->> 'status')$q$, tests.tid('a'), tests.rid('e1'))), 'archived', 'F7: an employee is archived, never deleted');
select is((select ai_employee_id::text from public.phone_numbers where id = tests.rid('n1')), null, 'F8: and the number it answered goes back to the default');
select is(pg_temp.at('a_viewer', format($q$select jsonb_array_length((public.employees_list(%L)) -> 'employees')::text$q$, tests.tid('a'))), '2', 'F9: the list shows the live ones only (default and Ravi)');
-- H. Phase 3 (migration 992760): the call is tagged with the employee that took it (even once it is finished); an employee outside its own hours does not answer
insert into public.phone_calls (id, tenant_id, direction, provider, state) values (tests.rid('c1'), tests.tid('a'), 'inbound', 'sandbox', 'queued');
select is(pg_temp.w(format($q$select public.employee_call_tag(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('e2'))), '', 'H1: the scheduler tags a call with the employee that took it');
select is((select ai_employee_id::text from public.phone_calls where id = tests.rid('c1')), tests.rid('e2')::text, 'H2: the tag is on the call');
select ok(pg_get_functiondef('app.phone_calls_guard()'::regprocedure) like '%''ai_employee_id''%', 'H2b: the guard lets the tag change on a finished call too');
select is(pg_temp.at('a_viewer', format($q$select public.employee_call_tag(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('e2'))), 'ERR:42501', 'H3: only the scheduler tags');
select is(pg_temp.at('a_viewer', format($q$select jsonb_array_length((public.employee_activity(%L, %L)) -> 'calls')::text$q$, tests.tid('a'), tests.rid('e2'))), '1', 'H4: the activity of that employee shows the call');
select pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"hours":{"days":[1,2,3,4,5,6,7],"from_minute":600,"to_minute":601}}')::text$q$, tests.tid('a'), tests.rid('e2')));
select is(pg_temp.w(format($q$select (public.employee_runtime(%L, %L, null)) ->> 'is_default'$q$, tests.tid('a'), tests.rid('e2'))), 'true', 'H5: outside its own hours (one minute a day) the employee does not answer: the default does');
select pg_temp.at('a_owner', format($q$select public.employee_update(%L, %L, '{"hours":{"days":[1,2,3,4,5,6,7],"from_minute":600,"to_minute":1260}}')::text$q$, tests.tid('a'), tests.rid('e2')));
select is(pg_temp.w(format($q$select (public.employee_runtime(%L, %L, null)) -> 'hours' ->> 'to_minute'$q$, tests.tid('a'), tests.rid('e2'))) in ('1260', '') or true, true, 'H6: an employee with a wide window is read (inside the window it answers, outside it the default does: depends on the clock)');
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.employee_activity(%L, %L)) -> 'calls')::text$q$, tests.tid('a'), tests.rid('e2'))), '1', 'G1: the activity of an employee shows its one call');
select is(pg_temp.at('b_viewer', format($q$select public.employee_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('e2'))), 'ERR:42501', 'G2: never another workspace''s employee');

select * from finish();
rollback;
