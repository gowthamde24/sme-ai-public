-- Job DR B1 (migration 20261207090000): "Ask Vijaya to do it". The task and its people; one approval for everyone; the runner's two calls; the cap; schools; promotional tasks; nothing deleted.
--   A save   B read   C exclude   D approve   E claim and result   F schools   G promotional   H state   I doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-02T12:00:00+05:30'::timestamptz);

-- tenant a: four people with leads (the seed has one: a_contact / a_lead)
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values
  (tests.rid('a_c2'), tests.tid('a'), tests.rid('a_company'), 'Anu One', '+00 90000 00011'),
  (tests.rid('a_c3'), tests.tid('a'), tests.rid('a_company'), 'Babu Two', '+00 90000 00012'),
  (tests.rid('a_c4'), tests.tid('a'), tests.rid('a_company'), 'Chitra Three', '+00 90000 00013');
insert into public.leads (id, tenant_id, company_id, contact_id) values
  (tests.rid('a_l2'), tests.tid('a'), tests.rid('a_company'), tests.rid('a_c2')),
  (tests.rid('a_l3'), tests.tid('a'), tests.rid('a_company'), tests.rid('a_c3')),
  (tests.rid('a_l4'), tests.tid('a'), tests.rid('a_company'), tests.rid('a_c4'));
create function pg_temp.people() returns text language sql as $$
  select format('[{"contact_id": "%s", "lead_id": "%s"}, {"contact_id": "%s", "lead_id": "%s"}, {"contact_id": "%s", "lead_id": "%s"}]',
                tests.rid('a_c2'), tests.rid('a_l2'), tests.rid('a_c3'), tests.rid('a_l3'), tests.rid('a_c4'), tests.rid('a_l4')) $$;
create function pg_temp.plan(p_goal text default 'Ask the price per bag', p_q text default 'Price per bag?') returns text language sql as $$
  select format('{"channel": "call", "goal": %s, "questions": [{"key": "price", "text": %s, "type": "amount"}], "script_notes": "", "message_text": null, "window": {"date": "2026-11-02", "from_minute": 600, "to_minute": 1140}, "follow_up": {"kind": "none", "after_hours": 24}, "contacts_total": 3, "notes": [], "unmatched": []}', to_json(p_goal)::text, to_json(p_q)::text) $$;
create function pg_temp.save(p_user text, p_tenant text, p_task text, p_status text default 'planned', p_template text default 'supplier_price_enquiry', p_plan text default 'default', p_contacts text default null, p_instr text default 'Ask my three suppliers their price', p_q text default null) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.task_save(%L, %L, %L, 'en', %L, %L, %L, null, %L::jsonb, '{"contacts": 3, "calls": 3, "messages": 0, "minutes": 6, "cost_paise": 900, "basis": "fake"}'::jsonb, 900, %L::jsonb)::text$q$,
    tests.tid(p_tenant), tests.rid(p_task), p_instr, p_status, p_template, p_q, case p_plan when 'default' then pg_temp.plan() when 'null' then null else p_plan end, coalesce(p_contacts, pg_temp.people()))) $$;
create function pg_temp.field(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.sha(p_task text) returns text language sql as $$ select plan_sha256 from public.tasks where id = tests.rid(p_task) $$;
create function pg_temp.st(p_task text) returns text language sql as $$ select status from public.tasks where id = tests.rid(p_task) $$;

-- ============================================================================ A. save
select is(pg_temp.field(pg_temp.save('a_sales', 'a', 't1'), 'status'), 'planned', 'A1 Sales plans a task');
select is((select count(*)::int from public.task_contacts where task_id = tests.rid('t1') and status = 'waiting'), 3, 'A2 ... with its three people waiting');
select ok(pg_temp.sha('t1') ~ '^[0-9a-f]{64}$', 'A3 the plan has a hash to be approved by');
select is(pg_temp.save('a_viewer', 'a', 't9'), 'ERR:42501', 'A4 a Viewer cannot plan');
select is(pg_temp.save('a_sales', 'b', 't9'), 'ERR:42501', 'A5 nobody plans in another workspace');
select is(pg_temp.save('a_sales', 'a', 't9', p_status => 'running'), 'ERR:22023', 'A6 only planned and needs_answer can be saved');
select is(pg_temp.save('a_sales', 'a', 't9', p_status => 'needs_answer'), 'ERR:22023', 'A7 a question is needed for needs_answer');
select is(pg_temp.field(pg_temp.save('a_sales', 'a', 't9', p_status => 'needs_answer', p_plan => 'null', p_q => 'Which suppliers?'), 'question'), 'Which suppliers?', 'A8 a task can wait for ONE answer');
select is(pg_temp.save('a_sales', 'a', 't10', p_contacts => format('[{"contact_id": "%s", "lead_id": "%s"}]', tests.rid('b_contact'), tests.rid('b_lead'))), 'ERR:23503', 'A9 a person of another workspace cannot be added (nobody is a stranger)');
select is(pg_temp.save('a_sales', 'a', 't10', p_contacts => (select jsonb_agg(jsonb_build_object('contact_id', gen_random_uuid(), 'lead_id', gen_random_uuid()))::text from generate_series(1, 501))), 'ERR:22023', 'A10 at most 500 people');
select is(pg_temp.save('a_sales', 'a', 't10', p_template => 'nonsense'), 'ERR:23514', 'A11 an unknown template');
select is(pg_temp.field(pg_temp.save('a_sales', 'a', 't1', p_instr => 'Ask my suppliers again'), 'instruction'), 'Ask my suppliers again', 'A12 a draft can be planned again under the same id');
select is(pg_temp.save('b_owner', 'b', 't1'), 'ERR:23503', 'A13 an id of another workspace is not found');

-- ============================================================================ B. read
select is(pg_temp.val('a_viewer', format($q$select (public.task_get(%L, %L) -> 'progress' ->> 'total')$q$, tests.tid('a'), tests.rid('t1'))), '3', 'B1 every member reads a task, with its progress');
select is(pg_temp.val('a_viewer', format($q$select jsonb_array_length(public.task_get(%L, %L) -> 'contacts_sample')::text$q$, tests.tid('a'), tests.rid('t1'))), '3', 'B2 ... and a sample of the people');
select is(pg_temp.val('outsider', format($q$select public.task_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('t1'))), 'ERR:42501', 'B3 a stranger reads nothing');
select is(pg_temp.val('b_owner', format($q$select public.task_get(%L, %L)::text$q$, tests.tid('b'), tests.rid('t1'))), 'ERR:23503', 'B4 another workspace does not see it');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.tasks_list(%L))::text$q$, tests.tid('a'))), '2', 'B5 the list');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.tasks_list(%L, 'needs_answer'))::text$q$, tests.tid('a'))), '1', 'B6 ... filtered by state');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.task_contacts_list(%L, %L))::text$q$, tests.tid('a'), tests.rid('t1'))), '3', 'B7 the people of a task, paged');
select is(pg_temp.val('a_sales', format($q$select (public.task_contacts_list(%L, %L) -> 0 ->> 'phone_last4')$q$, tests.tid('a'), tests.rid('t1'))), '0011', 'B8 only the last four digits of a phone');
select is(pg_temp.val('a_sales', format($q$select public.tasks_list(%L, 'bogus')::text$q$, tests.tid('a'))), 'ERR:22023', 'B9 an unknown state is invalid');

-- ============================================================================ C. exclude
select pg_temp.val('a_sales', format($q$select public.task_exclude(%L, %L, array[%L]::uuid[], true)::text$q$, tests.tid('a'), tests.rid('t1'), tests.rid('a_c3')));
select is((select status from public.task_contacts where task_id = tests.rid('t1') and contact_id = tests.rid('a_c3')), 'excluded', 'C1 Sales takes one person out');
select is((select count(*)::int from public.task_contacts where task_id = tests.rid('t1') and status = 'waiting'), 2, 'C2 two remain');
select is(pg_temp.val('a_viewer', format($q$select public.task_exclude(%L, %L, array[%L]::uuid[], true)::text$q$, tests.tid('a'), tests.rid('t1'), tests.rid('a_c2'))), 'ERR:42501', 'C3 a Viewer cannot');

-- ============================================================================ D. approve (one approval for everyone not excluded)
select is(pg_temp.val('a_sales', format($q$select public.task_approve(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('t1'), pg_temp.sha('t1'))), 'ERR:42501', 'D1 only the Owner approves');
select is(pg_temp.val('a_owner', format($q$select public.task_approve(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('t1'), pg_temp.sha('t1')), 'aal1'), 'ERR:SM306', 'D2 the Owner needs the second factor');
select is(pg_temp.val('a_owner', format($q$select public.task_approve(%L, %L, repeat('a', 64))::text$q$, tests.tid('a'), tests.rid('t1'))), 'ERR:SM952', 'D3 a plan other than the one seen is refused');
select pg_temp.val('a_sales', format($q$select public.task_exclude(%L, %L, array[%L]::uuid[], false)::text$q$, tests.tid('a'), tests.rid('t1'), tests.rid('a_c3')));
select is((select count(*)::int from public.task_contacts where task_id = tests.rid('t1') and status = 'waiting'), 3, 'D4 a person can be put back');
create temp table sha_seen (sha text);
insert into sha_seen select pg_temp.sha('t1');
select pg_temp.val('a_sales', format($q$select public.task_exclude(%L, %L, array[%L]::uuid[], true)::text$q$, tests.tid('a'), tests.rid('t1'), tests.rid('a_c4')));
select isnt(pg_temp.sha('t1'), (select sha from sha_seen), 'D5 who is in changes the hash');
select is(pg_temp.val('a_owner', format($q$select public.task_approve(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('t1'), (select sha from sha_seen))), 'ERR:SM952', 'D6 an approval of the earlier list is refused');
select is(pg_temp.field(pg_temp.val('a_owner', format($q$select public.task_approve(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('t1'), pg_temp.sha('t1'))), 'status'), 'approved', 'D7 the Owner approves ONCE for everyone left in');
select is((select cap_paise from public.tasks where id = tests.rid('t1')), 1080::bigint, 'D8 the default cap is the estimate plus 20 percent');
select is((select count(*)::int from public.task_contacts where task_id = tests.rid('t1') and status = 'waiting'), 2, 'D9 two people will be contacted');
select is(pg_temp.val('a_owner', format($q$select public.task_approve(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('t1'), pg_temp.sha('t1'))), 'ERR:SM953', 'D10 an approved task is not approved again');
select is(pg_temp.save('a_sales', 'a', 't1'), 'ERR:SM953', 'D11 ... nor planned again');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action = 'task.approved'), 1, 'D12 the approval is in the trail');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and (new_values::text ~* 'suppliers' or old_values::text ~* 'suppliers')), 0, 'D13 the owner''s words are not in the audit trail');

-- ============================================================================ E. claim and result (the runner)
select is(pg_temp.val('a_sales', format($q$select public.task_claim(%L, %L)::text$q$, tests.tid('a'), tests.rid('t1'))), 'ERR:42501', 'E1 Sales cannot run a task');
select is(pg_temp.val('a_admin', format($q$select jsonb_array_length(public.task_claim(%L, %L, 1) -> 'claimed')::text$q$, tests.tid('a'), tests.rid('t1'))), '1', 'E2 the runner is given one person');
select is(pg_temp.st('t1'), 'running', 'E3 the task is running');
select is((select count(*)::int from public.task_contacts where task_id = tests.rid('t1') and status = 'in_progress'), 1, 'E4 that person is in progress');
create temp table claimed (id uuid);
insert into claimed select id from public.task_contacts where task_id = tests.rid('t1') and status = 'in_progress';
select is(pg_temp.val('a_admin', format($q$select public.task_contact_result(%L, %L, %L, '{"status": "bogus"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('t1'), (select id from claimed))), 'ERR:22023', 'E5 an invalid result is refused');
select is(pg_temp.val('a_admin', format($q$select public.task_contact_result(%L, %L, %L, '{"status": "done", "transcript": {}}'::jsonb)::text$q$, tests.tid('a'), tests.rid('t1'), (select id from claimed))), 'ERR:22023', 'E6 a transcript is a list');
select is(pg_temp.val('a_admin', format($q$select (public.task_contact_result(%L, %L, %L, '{"status": "done", "outcome": "positive", "category": "interested", "captured": {"price": 39500}, "transcript": [{"who": "assistant", "text": "Hello, I am Vijaya, the AI assistant"}], "cost_paise": 450}'::jsonb) ->> 'spent_paise')$q$, tests.tid('a'), tests.rid('t1'), (select id from claimed))), '450', 'E7 a result is recorded and its cost counted');
select is((select captured ->> 'price' from public.task_contacts where id = (select id from claimed)), '39500', 'E8 the captured answer is stored');
select is((select simulated from public.task_contacts where id = (select id from claimed)), true, 'E9 and marked simulated');
select is(pg_temp.val('a_admin', format($q$select public.task_contact_result(%L, %L, %L, '{"status": "done"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('t1'), (select id from claimed))), 'ERR:SM953', 'E10 a result is recorded once');
-- the cap: lower it to what is spent, so the next result pauses the task
select is(pg_temp.field(pg_temp.val('a_owner', format($q$select public.task_set_cap(%L, %L, 450)::text$q$, tests.tid('a'), tests.rid('t1'))), 'cap_paise'), '450', 'E11 the Owner changes the cap');
select is(pg_temp.val('a_admin', format($q$select public.task_set_cap(%L, %L, 450)::text$q$, tests.tid('a'), tests.rid('t1'))), 'ERR:42501', 'E12 only the Owner changes the cap');
select is(pg_temp.val('a_admin', format($q$select jsonb_array_length(public.task_claim(%L, %L, 5) -> 'claimed')::text$q$, tests.tid('a'), tests.rid('t1'))), '0', 'E13 at the cap nobody more is handed out');
select is(pg_temp.st('t1'), 'paused', 'E14 the task pauses (a Needs-you item)');
select is((select pause_reason from public.tasks where id = tests.rid('t1')), 'cap', 'E15 and says why');
select is(pg_temp.val('a_admin', format($q$select public.task_set_state(%L, %L, 'resume')::text$q$, tests.tid('a'), tests.rid('t1'))), 'ERR:SM953', 'E16 it cannot resume while the cap is reached');
select pg_temp.val('a_owner', format($q$select public.task_set_cap(%L, %L, 5000)::text$q$, tests.tid('a'), tests.rid('t1')));
select is(pg_temp.field(pg_temp.val('a_admin', format($q$select public.task_set_state(%L, %L, 'resume')::text$q$, tests.tid('a'), tests.rid('t1'))), 'status'), 'running', 'E17 with a higher cap it resumes');
select is(pg_temp.val('a_admin', format($q$select jsonb_array_length(public.task_claim(%L, %L, 1) -> 'claimed')::text$q$, tests.tid('a'), tests.rid('t1'))), '1', 'E18 the last person is handed out');
update public.task_contacts set claimed_at = app.outbox_now() - interval '10 minutes' where task_id = tests.rid('t1') and status = 'in_progress';
select is(pg_temp.val('a_admin', format($q$select jsonb_array_length(public.task_claim(%L, %L, 1) -> 'claimed')::text$q$, tests.tid('a'), tests.rid('t1'))), '1', 'E19 a person whose run stopped midway is handed out again after five minutes');
select is(pg_temp.field(pg_temp.val('a_admin', format($q$select public.task_contact_result(%L, %L, %L, '{"status": "skipped", "skip_reason": "suppressed"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('t1'), (select id from public.task_contacts where task_id = tests.rid('t1') and status = 'in_progress'))), 'status'), 'done', 'E20 when the last person is finished the task is done');
select isnt((select finished_at from public.tasks where id = tests.rid('t1')), null, 'E21 and has a finish time');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action = 'task.done'), 1, 'E22 the end is in the trail');
select is(pg_temp.val('a_viewer', format($q$select jsonb_array_length(public.task_report(%L, %L) -> 'rows')::text$q$, tests.tid('a'), tests.rid('t1'))), '2', 'E23 the report holds a row for each person who was not excluded');
select is(pg_temp.val('a_viewer', format($q$select (public.task_report(%L, %L) -> 'rows' -> 0 -> 'transcript' -> 0 ->> 'who')$q$, tests.tid('a'), tests.rid('t1'))), 'assistant', 'E24 with the transcript');

-- ============================================================================ F. schools
insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select tests.tid('b'), 'education', max(version), 'operator' from packs.pack_versions where code = 'education'
  on conflict (tenant_id) do update set pack_code = excluded.pack_code, pack_version = excluded.pack_version;
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('b_c2'), tests.tid('b'), tests.rid('b_company'), 'Guardian One', '+00 93000 00021');
insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid('b_l2'), tests.tid('b'), tests.rid('b_company'), tests.rid('b_c2'));
create function pg_temp.bpeople() returns text language sql as $$ select format('[{"contact_id": "%s", "lead_id": "%s"}]', tests.rid('b_c2'), tests.rid('b_l2')) $$;
select is(pg_temp.save('b_owner', 'b', 's1', p_template => 'payment_reminder', p_contacts => pg_temp.bpeople()), 'ERR:SM951', 'F1 a school has no payment reminder');
select is(pg_temp.save('b_owner', 'b', 's2', p_template => 'custom', p_plan => pg_temp.plan('Ask the parents about the pending fees'), p_contacts => pg_temp.bpeople()), 'ERR:SM951', 'F2 nor any task whose goal reads as fees');
select is(pg_temp.save('b_owner', 'b', 's3', p_template => 'custom', p_instr => 'Ask the parents to pay the dues', p_contacts => pg_temp.bpeople()), 'ERR:SM951', 'F3 nor one whose instruction does');
select is(pg_temp.field(pg_temp.save('b_owner', 'b', 's4', p_template => 'custom', p_plan => pg_temp.plan('Invite the parents to the open house', 'Will you come?'), p_instr => 'Invite the parents to the open house', p_contacts => pg_temp.bpeople()), 'status'), 'planned', 'F4 an invitation is fine');
select is((select count(*)::int from public.tasks where tenant_id = tests.tid('b') and id in (tests.rid('s1'), tests.rid('s2'), tests.rid('s3'))), 0, 'F5 a refused plan leaves nothing behind');
select is(pg_temp.val('b_owner', format($q$select public.task_approve(%L, %L, %L)::text$q$, tests.tid('b'), tests.rid('s4'), (select plan_sha256 from public.tasks where id = tests.rid('s4')))) like 'ERR%', false, 'F6 and it can be approved');

-- ============================================================================ G. promotional: only people who agreed
select pg_temp.save('a_owner', 'a', 'p1', p_template => 'offer_invite', p_instr => 'Invite my customers to the Diwali sale');
select is(pg_temp.val('a_owner', format($q$select public.task_approve(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('p1'), pg_temp.sha('p1'))), 'ERR:22023', 'G1 nobody agreed to offers: there is nobody to send to');
select is((select count(*)::int from public.task_contacts where task_id = tests.rid('p1') and skip_reason = 'no_consent'), 0, 'G2 a refused approval changes nothing (the skips are rolled back with it)');
set local session_replication_role = replica;
update public.contacts set whatsapp_consent = 'granted' where id = tests.rid('a_c2');
reset session_replication_role;
select pg_temp.save('a_owner', 'a', 'p2', p_template => 'offer_invite', p_instr => 'Invite my customers to the Diwali sale');
select is(pg_temp.field(pg_temp.val('a_owner', format($q$select public.task_approve(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('p2'), pg_temp.sha('p2'))), 'status'), 'approved', 'G3 one person agreed: the task goes to that person only');
select is((select count(*)::int from public.task_contacts where task_id = tests.rid('p2') and status = 'waiting'), 1, 'G4 exactly one');

-- ============================================================================ H. state
select pg_temp.save('a_owner', 'a', 'h1');
select is(pg_temp.val('a_admin', format($q$select public.task_set_state(%L, %L, 'pause')::text$q$, tests.tid('a'), tests.rid('h1'))), 'ERR:SM953', 'H1 a plan that is not approved cannot be paused');
select is(pg_temp.field(pg_temp.val('a_admin', format($q$select public.task_set_state(%L, %L, 'cancel')::text$q$, tests.tid('a'), tests.rid('h1'))), 'status'), 'cancelled', 'H2 it can be cancelled');
select is((select count(*)::int from public.task_contacts where task_id = tests.rid('h1') and skip_reason = 'cancelled'), 3, 'H3 its waiting people are skipped, not deleted');
select is(pg_temp.val('a_admin', format($q$select public.task_set_state(%L, %L, 'cancel')::text$q$, tests.tid('a'), tests.rid('h1'))), 'ERR:SM953', 'H4 a cancelled task is final');
select is(pg_temp.sc(format($q$update public.tasks set plan_sha256 = repeat('c', 64) where id = %L$q$, tests.rid('h1'))), 'SM953', 'H5 a finished task does not change, even for the database owner');
select is(pg_temp.val('a_sales', format($q$select public.task_set_state(%L, %L, 'cancel')::text$q$, tests.tid('a'), tests.rid('t1'))), 'ERR:42501', 'H6 Sales cannot cancel');
select is(pg_temp.val('a_admin', format($q$select public.task_set_state(%L, %L, 'explode')::text$q$, tests.tid('a'), tests.rid('p2'))), 'ERR:22023', 'H7 an unknown action');
select is(pg_temp.field(pg_temp.val('a_admin', format($q$select public.task_set_state(%L, %L, 'pause')::text$q$, tests.tid('a'), tests.rid('p2'))), 'pause_reason'), 'owner', 'H8 an approved task can be paused by the Owner or an Admin');

-- ============================================================================ I. doors
select is(pg_temp.sc(format($q$delete from public.tasks where id = %L$q$, tests.rid('t1'))), '42501', 'I1 a task is never deleted');
select is(pg_temp.sc(format($q$delete from public.task_contacts where task_id = %L$q$, tests.rid('t1'))), '42501', 'I2 nor its people');
select is(pg_temp.val('anon', $q$select count(*)::text from public.tasks$q$), 'ERR:42501', 'I3 the public key reads nothing');
select is(pg_temp.val('a_owner', $q$select count(*)::text from public.tasks$q$), '5', 'I4 a member reads their own workspace''s tasks through the table too (RLS)');
select is((select count(*)::int from information_schema.role_table_grants where table_name in ('tasks', 'task_contacts') and table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0, 'I5 nobody can write the tables directly');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'task\_%' and has_function_privilege('anon', p.oid, 'execute')), 0, 'I6 every task function is closed to the public key');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('task_context', 'task_save', 'task_get', 'tasks_list', 'task_contacts_list', 'task_report', 'task_exclude', 'task_approve', 'task_set_cap', 'task_set_state', 'task_claim', 'task_contact_result') and p.prosecdef and p.proconfig::text ~ 'search_path='), 12, 'I7 every task function is a definer with a fixed search path');
select is((select count(*)::int from erasure.registry where table_name in ('tasks', 'task_contacts')), 9, 'I8 the words of a task are in the erasure registry (workspace scope and the sweep)');
select is(pg_temp.val('a_viewer', format($q$select public.task_context(%L)::text$q$, tests.tid('a'))), '{"school": false}', 'I9 any member asks whether the workspace is a school');
select is(pg_temp.val('b_owner', format($q$select public.task_context(%L)::text$q$, tests.tid('b'))), '{"school": true}', 'I10 ... and a school says so');
select is(pg_temp.val('outsider', format($q$select public.task_context(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'I11 a stranger is refused');

select * from finish();
rollback;
