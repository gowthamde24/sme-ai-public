-- Job DR part A3 (migration 20261206090000): SPEED TO LEAD AND "APPROVE ONCE".
--   A policy and calling hours   B the plan of a batch   C exclude and approve all   D the worker runs it   E a call's result   F caps   G standing rules per source   H hot-lead hand-off   I reports   J doors
-- The clock is pinned: Monday 2 November 2026, 11:00 India time (inside the default hours: Monday to Saturday, 09:00 to 19:00).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-02T11:00:00+05:30'::timestamptz);
select app.operator_register_scheduler('x5@test.local');
create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_json text, p_path text) returns text language sql as $$ select (p_json::jsonb #>> string_to_array(p_path, '.')) $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.val('x5', p_sql) $$;
create function pg_temp.t(p_tenant text) returns uuid language sql as $$ select tests.tid(p_tenant) $$;

-- the people: contacts of tenant a with the consent and the leads the scenarios need
select tests.cn_guards_off();
select tests.open_gate('a');
select tests.open_gate('b');
insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Outreach Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent, created_at) values
  (tests.rid('c1'), tests.tid('a'), tests.rid('co'), 'Asha Rao',   '+91 98000 00001', 'granted', 'granted', '2026-10-01T01:00:00Z'),
  (tests.rid('c2'), tests.tid('a'), tests.rid('co'), 'Ravi Kumar', '+91 98000 00002', 'granted', 'granted', '2026-10-01T02:00:00Z'),
  (tests.rid('c3'), tests.tid('a'), tests.rid('co'), 'Sita Devi',  '+91 98000 00003', 'granted', 'granted', '2026-10-01T03:00:00Z'),
  (tests.rid('c4'), tests.tid('a'), tests.rid('co'), 'No Consent', '+91 98000 00004', 'unknown', 'unknown', '2026-10-01T04:00:00Z'),
  (tests.rid('c5'), tests.tid('a'), tests.rid('co'), 'Stopped One', '+91 98000 00005', 'granted', 'granted', '2026-10-01T05:00:00Z'),
  (tests.rid('c6'), tests.tid('a'), tests.rid('co'), 'No Phone',   null, 'granted', 'granted', '2026-10-01T06:00:00Z'),
  (tests.rid('c7'), tests.tid('a'), tests.rid('co'), 'Twin Of One', '098000 00001', 'granted', 'granted', '2026-10-01T07:00:00Z'),
  (tests.rid('c8'), tests.tid('a'), tests.rid('co'), 'Bina Shah',  '+91 98000 00008', 'granted', 'granted', '2026-10-01T08:00:00Z');
update public.contacts set suppressed_at = now(), suppression_reason = 'opted_out' where id = tests.rid('c5');
insert into public.leads (id, tenant_id, company_id, contact_id, source) values
  (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('c1'), 'excel_upload'),
  (tests.rid('l2'), tests.tid('a'), tests.rid('co'), tests.rid('c2'), 'excel_upload'),
  (tests.rid('l3'), tests.tid('a'), tests.rid('co'), tests.rid('c3'), 'excel_upload'),
  (tests.rid('l8'), tests.tid('a'), tests.rid('co'), tests.rid('c8'), 'excel_upload');
insert into public.contacts (id, tenant_id, full_name, phone, phone_consent) values (tests.rid('bc1'), tests.tid('b'), 'Other Tenant', '+91 97000 00001', 'granted');

-- ============================================================================ A. policy and calling hours
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_get(%L) ->> 'night_call_minute'$q$, pg_temp.t('a'))), '570', 'A1 the default morning call is 09:30');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_get(%L) -> 'hours' ->> 'from'$q$, pg_temp.t('a'))), 'default', 'A2 the hours in force come from a default when nothing is saved');
select is(pg_temp.val('a_sales', format($q$select public.outreach_policy_get(%L)::text$q$, pg_temp.t('a'))), 'ERR:42501', 'A3 Sales cannot read the policy');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"max_attempts": 2, "retry_gap_hours": 20}')::text$q$, pg_temp.t('a')), 'aal1'), 'ERR:SM306', 'A4 setting it needs the second factor');
select is(pg_temp.val('a_admin', format($q$select public.outreach_policy_set(%L, '{"max_attempts": 2}')::text$q$, pg_temp.t('a'))), 'ERR:42501', 'A5 an Admin cannot set it');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"max_attempts": 9}')::text$q$, pg_temp.t('a'))), 'ERR:22023', 'A6 nine attempts is invalid');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"colour": 1}')::text$q$, pg_temp.t('a'))), 'ERR:22023', 'A7 an unknown key is invalid');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"night_call_minute": 575}')::text$q$, pg_temp.t('a'))), 'ERR:22023', 'A8 the morning call is in steps of fifteen minutes');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"max_attempts": 3, "retry_gap_hours": 18, "call_paise_per_minute": 400}') ->> 'saved'$q$, pg_temp.t('a'))), 'true', 'A9 the Owner sets it');
select is(app.outreach_in_hours(pg_temp.t('a'), '2026-11-02T11:00:00+05:30'), true, 'A10 Monday 11:00 is inside the hours');
select is(app.outreach_in_hours(pg_temp.t('a'), '2026-11-01T11:00:00+05:30'), false, 'A11 Sunday is closed');
select is(app.outreach_in_hours(pg_temp.t('a'), '2026-11-02T19:00:00+05:30'), false, 'A12 19:00 is closed');
select is(app.outreach_slot(pg_temp.t('a'), '2026-11-01T11:00:00+05:30'), '2026-11-02T09:00:00+05:30'::timestamptz, 'A13 Sunday noon waits for Monday 09:00');
select is(app.outreach_slot(pg_temp.t('a'), '2026-11-02T19:30:00+05:30'), '2026-11-03T09:00:00+05:30'::timestamptz, 'A14 Monday 19:30 waits for Tuesday 09:00');
select is(app.outreach_slot(pg_temp.t('a'), '2026-11-02T12:00:00+05:30'), '2026-11-02T12:00:00+05:30'::timestamptz, 'A15 inside the hours the slot is now');
select is(app.outreach_next_clock('2026-11-02T22:00:00+05:30', 570), '2026-11-03T09:30:00+05:30'::timestamptz, 'A16 the next 09:30 after Monday 22:00 is Tuesday');
select is(app.outreach_next_clock('2026-11-02T07:00:00+05:30', 570), '2026-11-02T09:30:00+05:30'::timestamptz, 'A17 ... and after 07:00 it is the same morning');
insert into public.call_settings (tenant_id, campaign_id, settings, updated_by) values (pg_temp.t('a'), null, '{"hours": {"days": [1,2,3], "from_minute": 600, "to_minute": 720}, "holidays": ["2026-11-03"]}'::jsonb, tests.uid('a_owner'));
select is(app.outreach_in_hours(pg_temp.t('a'), '2026-11-02T10:30:00+05:30'), true, 'A18 the call settings'' own hours win when set');
select is(app.outreach_in_hours(pg_temp.t('a'), '2026-11-05T10:30:00+05:30'), false, 'A19 ... (Thursday is closed)');
select is(app.outreach_slot(pg_temp.t('a'), '2026-11-02T13:00:00+05:30'), '2026-11-04T10:00:00+05:30'::timestamptz, 'A20 a holiday (Tuesday 3 November) is skipped, and Wednesday is closed too: the next slot is the day the hours say');
delete from public.call_settings where tenant_id = pg_temp.t('a');
select is(app.outreach_hours(pg_temp.t('a')) ->> 'from', 'default', 'A21 back to the default');

-- ============================================================================ B. the plan of a batch
create function pg_temp.plan(p_user text, p_doc text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.outreach_batch_plan(%L, %L::jsonb)::text$q$, pg_temp.t('a'), p_doc), p_aal) $$;
create function pg_temp.doc(p_id text, p_extra text default '') returns text language sql as $$
  select format('{"batch_id": "%s", "name": "Diwali leads", "goal": "site_visit", "channel": "call", "language": "te", "who": {"contact_ids": ["%s","%s","%s","%s","%s","%s","%s"]}, "questions": ["Budget?", "Which area?"]%s}',
    tests.rid(p_id), tests.rid('c1'), tests.rid('c2'), tests.rid('c3'), tests.rid('c4'), tests.rid('c5'), tests.rid('c6'), tests.rid('c7'), p_extra) $$;
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'batch.status'), 'planned', 'B1 Sales builds a draft plan');
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'plan.ready'), '3', 'B2 three people are ready (c1, c2, c3)');
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'plan.skipped.no_consent'), '1', 'B3 one has no consent');
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'plan.skipped.stopped'), '1', 'B4 one asked to stop');
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'plan.skipped.no_phone'), '1', 'B5 one has no number');
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'plan.skipped.duplicate'), '1', 'B6 one is the same number as another (merged)');
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'plan.estimated_minutes'), '9', 'B7 three people, three minutes each');
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'plan.estimated_cost_paise'), '3600', 'B8 nine minutes at 4 rupees: 36 rupees');
select is(pg_temp.j(pg_temp.plan('a_sales', pg_temp.doc('b1')), 'plan.sample.0.name_masked'), 'Asha R.', 'B9 the sample masks the surname (the first ready person, by when they were made)');
select is((select count(*)::int from public.outreach_items where batch_id = tests.rid('b1')), 7, 'B10 re-planning replaced the rows (seven people considered, not twenty-one)');
select is(pg_temp.plan('a_viewer', pg_temp.doc('b9')), 'ERR:42501', 'B11 a Viewer cannot plan');
select is(pg_temp.plan('a_sales', replace(pg_temp.doc('b9'), '"channel": "call"', '"channel": "both"')), 'ERR:22023', 'B12 a WhatsApp step needs the approved text');
select is(pg_temp.plan('a_sales', pg_temp.doc('b9', ', "colour": 1')), 'ERR:22023', 'B13 an unknown key is invalid');
select is(pg_temp.plan('a_sales', replace(pg_temp.doc('b9'), '"goal": "site_visit"', '"goal": "world_peace"')), 'ERR:22023', 'B14 an unknown goal is invalid');
select is(pg_temp.plan('a_sales', format('{"batch_id": "%s", "name": "x", "goal": "general", "channel": "call", "language": "te", "who": {"contact_ids": ["%s"]}}', tests.rid('b9'), tests.rid('bc1'))), 'ERR:22023', 'B15 another workspace''s contact is never a stranger we call: nobody is found');
select is(pg_temp.plan('a_sales', pg_temp.doc('b9', ', "questions": ["a1","a2","a3","a4","a5","a6","a7","a8","a9"]')), 'ERR:22023', 'B16 at most eight questions');
select is(pg_temp.j(pg_temp.plan('a_sales', format('{"batch_id": "%s", "name": "From a source", "goal": "qualify", "channel": "call", "language": "hi", "who": {"source": {"source": "excel_upload", "status": "new"}}}', tests.rid('b2'))), 'plan.ready'), '4', 'B17 a batch can be built from a source (c1, c2, c3, c8)');
select is(pg_temp.j(pg_temp.plan('a_sales', format('{"batch_id": "%s", "name": "From leads", "goal": "qualify", "channel": "call", "language": "hi", "who": {"lead_ids": ["%s"]}}', tests.rid('b3'), tests.rid('l8'))), 'plan.ready'), '1', 'B18 ... or from lead ids');
select is(pg_temp.plan('a_owner', format('{"batch_id": "%s", "name": "x", "goal": "general", "channel": "call", "language": "te", "who": {"contact_ids": ["%s"]}}', tests.rid('b1'), tests.rid('c1')))::text, pg_temp.plan('a_owner', format('{"batch_id": "%s", "name": "x", "goal": "general", "channel": "call", "language": "te", "who": {"contact_ids": ["%s"]}}', tests.rid('b1'), tests.rid('c1')))::text, 'B19 the same plan twice is the same answer');
update public.outreach_batches set status = 'running', approved_at = now(), approved_by = tests.uid('a_owner') where id = tests.rid('b3');
select is(pg_temp.plan('a_sales', format('{"batch_id": "%s", "name": "From leads", "goal": "qualify", "channel": "call", "language": "hi", "who": {"lead_ids": ["%s"]}}', tests.rid('b3'), tests.rid('l8'))), 'ERR:SM811', 'B20 an approved batch cannot be re-planned');
update public.outreach_batches set status = 'cancelled', finished_at = now() where id = tests.rid('b3');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.outreach_batches_list(%L))::text$q$, pg_temp.t('a'))), '3', 'B21 the list shows the three batches');
select is(pg_temp.val('b_owner', format($q$select public.outreach_batch_get(%L, %L)::text$q$, pg_temp.t('b'), tests.rid('b1'))), 'ERR:23503', 'B22 another workspace cannot read it');

-- ============================================================================ C. exclude and approve all
create function pg_temp.sha(p_batch text) returns text language sql as $$ select plan_sha256 from public.outreach_batches where id = tests.rid(p_batch) $$;
create function pg_temp.approve(p_user text, p_batch text, p_sha text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.outreach_batch_approve(%L, %L, %L)::text$q$, pg_temp.t('a'), tests.rid(p_batch), p_sha), p_aal) $$;
select pg_temp.plan('a_sales', pg_temp.doc('b1'));
select is(pg_temp.val('a_sales', format($q$select public.outreach_batch_exclude(%L, %L, array[%L]::uuid[])::text$q$, pg_temp.t('a'), tests.rid('b1'), tests.rid('c2'))), 'ERR:42501', 'C1 Sales cannot exclude');
create temp table before_sha as select pg_temp.sha('b1') as sha;
select is(pg_temp.j(pg_temp.val('a_admin', format($q$select public.outreach_batch_exclude(%L, %L, array[%L]::uuid[])::text$q$, pg_temp.t('a'), tests.rid('b1'), tests.rid('c2'))), 'plan.ready'), '2', 'C2 an Admin excludes Ravi: two are ready');
select isnt(pg_temp.sha('b1'), (select sha from before_sha), 'C3 the plan''s hash changed with it');
select is(pg_temp.approve('a_owner', 'b1', (select sha from before_sha)), 'ERR:SM812', 'C4 approving the plan that was shown BEFORE the change is refused');
select is(pg_temp.approve('a_admin', 'b1', pg_temp.sha('b1')), 'ERR:42501', 'C5 an Admin cannot approve');
select is(pg_temp.approve('a_owner', 'b1', pg_temp.sha('b1'), 'aal1'), 'ERR:SM306', 'C6 the Owner needs the second factor');
select is(pg_temp.j(pg_temp.approve('a_owner', 'b1', pg_temp.sha('b1')), 'batch.status'), 'running', 'C7 approve ALL: the batch runs');
select is((select count(*)::int from public.outreach_items where batch_id = tests.rid('b1') and status = 'waiting'), 2, 'C8 two people wait, nobody was clicked one by one');
select is((select next_at from public.outreach_items where batch_id = tests.rid('b1') and contact_id = tests.rid('c1')), '2026-11-02T11:00:00+05:30'::timestamptz, 'C9 the first call is now (inside the hours)');
select is((select reason from public.outreach_items where batch_id = tests.rid('b1') and contact_id = tests.rid('c2')), 'excluded', 'C10 the excluded person is out');
select is(pg_temp.approve('a_owner', 'b1', pg_temp.sha('b1')), 'ERR:SM811', 'C11 a second approval is refused');
select is((select approved_by from public.outreach_batches where id = tests.rid('b1')), tests.uid('a_owner'), 'C12 who approved is recorded');
select is(pg_temp.j(pg_temp.val('a_admin', format($q$select public.outreach_batch_state(%L, %L, 'pause')::text$q$, pg_temp.t('a'), tests.rid('b1'))), 'batch.paused_reason'), 'owner', 'C13 an Admin can pause');
select is(pg_temp.j(pg_temp.val('a_admin', format($q$select public.outreach_batch_state(%L, %L, 'resume')::text$q$, pg_temp.t('a'), tests.rid('b1'))), 'batch.status'), 'running', 'C14 ... and resume');
select is(pg_temp.val('a_admin', format($q$select public.outreach_batch_state(%L, %L, 'cancel')::text$q$, pg_temp.t('a'), tests.rid('b1'))), 'ERR:42501', 'C15 only the Owner cancels');

-- ============================================================================ D. the worker runs it
select is(pg_temp.val('a_owner', $q$select public.scheduler_outreach_run(10)::text$q$), 'ERR:42501', 'D1 only the worker runs it');
create temp table run1 as select pg_temp.sch('select public.scheduler_outreach_run(10)::text')::jsonb as r;
select is((select jsonb_array_length(r -> 'calls') from run1), 2, 'D2 two calls are handed to the dialer');
select is((select string_agg(c ->> 'phone', ',' order by c ->> 'phone') from run1, jsonb_array_elements(r -> 'calls') c), '+91 98000 00001,+91 98000 00003', 'D3 with the number to dial');
select is((select r -> 'calls' -> 0 ->> 'goal' from run1), 'site_visit', 'D4 and the goal');
select is((select jsonb_array_length(r -> 'calls' -> 0 -> 'questions') from run1), 2, 'D5 and the owner''s questions');
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_run(10) -> ''calls'')::text'), '0', 'D6 a second run right away hands out nothing (the calls are claimed)');
select pg_temp.pin('2026-11-02T20:00:00+05:30'::timestamptz);
update public.outreach_items set next_at = '2026-11-02T20:00:00+05:30', status = 'waiting' where batch_id = tests.rid('b1') and status = 'waiting';
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_run(10) -> ''calls'')::text'), '0', 'D7 after hours nothing is dialled');
select is((select next_at from public.outreach_items where batch_id = tests.rid('b1') and contact_id = tests.rid('c1')), '2026-11-03T09:00:00+05:30'::timestamptz, 'D8 the call waits for the next morning');
select pg_temp.pin('2026-11-03T09:00:00+05:30'::timestamptz);
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_run(10) -> ''calls'')::text'), '2', 'D9 in the morning both are handed out');

-- ============================================================================ E. a call's result
create function pg_temp.item(p_batch text, p_contact text) returns uuid language sql as $$ select id from public.outreach_items where batch_id = tests.rid(p_batch) and contact_id = tests.rid(p_contact) $$;
create function pg_temp.res(p_user text, p_item uuid, p_result text, p_outcome text default 'null', p_minutes numeric default 0, p_stop boolean default false) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.outreach_item_result(%L, %L, %L, %L::jsonb, %s, %L)::text$q$, pg_temp.t('a'), p_item, p_result, p_outcome, p_minutes, p_stop)) $$;
select is(pg_temp.res('a_viewer', pg_temp.item('b1', 'c1'), 'no_answer'), 'ERR:42501', 'E1 a Viewer cannot record a result');
select is(pg_temp.j(pg_temp.res('x5', pg_temp.item('b1', 'c1'), 'no_answer'), 'status'), 'waiting', 'E2 no answer: Asha is tried again');
select is((select next_at from public.outreach_items where id = pg_temp.item('b1', 'c1')), '2026-11-04T09:00:00+05:30'::timestamptz, 'E3 ... after the 18-hour gap, inside the hours (Wednesday 09:00)');
select is((select attempts::int from public.outreach_items where id = pg_temp.item('b1', 'c1')), 1, 'E4 one attempt is counted');
select is(pg_temp.res('x5', pg_temp.item('b1', 'c3'), 'connected', '{"outcome": "positive", "category": "interested", "reason": "wants a flat in Gachibowli", "captured": {"budget": "50 lakh", "area": "Gachibowli"}}', 4.5)::jsonb, ('{"item_id": "' || pg_temp.item('b1', 'c3') || '", "reason": "interested", "status": "stopped"}')::jsonb, 'E6 Sita is interested: the item stops for good');
select is((select category from public.outcomes where contact_id = tests.rid('c3')), 'interested', 'E7 the outcome is recorded');
select is((select recorded_by_kind from public.outcomes where contact_id = tests.rid('c3')), 'ai', 'E8 ... as the AI''s (the worker is the dialer)');
select is((select captured ->> 'budget' from public.outcome_details d join public.outcomes o on o.id = d.outcome_id where o.contact_id = tests.rid('c3')), '50 lakh', 'E9 the captured fields are kept beside it');
select is(pg_temp.val('a_owner', format($q$select (public.outcomes_for_lead(%L, %L, 10) -> 0 -> 'captured' ->> 'area')$q$, pg_temp.t('a'), tests.rid('l3'))), 'Gachibowli', 'E10 and are on the timeline of the lead');
select is((select minutes from public.outreach_attempts where item_id = pg_temp.item('b1', 'c3') and result = 'connected'), 4.50, 'E11 the minutes are recorded');
select is((select count(*)::int from public.outreach_handoffs where contact_id = tests.rid('c3')), 1, 'E12 a hot lead creates a hand-off');
select is(pg_temp.res('x5', pg_temp.item('b1', 'c3'), 'connected', '{"outcome": "positive", "category": "interested"}', 1), 'ERR:SM811', 'E13 a finished item takes no more results');
-- the other categories (use fresh batches so each item is waiting)
create function pg_temp.mk(p_batch text, p_contact text) returns uuid language plpgsql as $$
declare
  v_id uuid := tests.rid(p_batch);
begin
  insert into public.outreach_batches (id, tenant_id, name, goal, channel, language, status, plan_sha256, created_by, approved_by, approved_at)
  values (v_id, tests.tid('a'), 'test ' || p_batch, 'general', 'call', 'en', 'running', repeat('a', 64), tests.uid('a_owner'), tests.uid('a_owner'), now());
  insert into public.outreach_items (tenant_id, batch_id, contact_id, lead_id, status, next_action, next_at)
  select tests.tid('a'), v_id, c.id, (select l.id from public.leads l where l.contact_id = c.id limit 1), 'waiting', 'call', now() from public.contacts c where c.id = tests.rid(p_contact);
  return (select id from public.outreach_items where batch_id = v_id);
end $$;
select is(pg_temp.j(pg_temp.res('a_sales', pg_temp.mk('b4', 'c8'), 'connected', '{"outcome": "negative", "category": "not_interested", "reason": "not now"}', 2), 'reason'), 'refused', 'E14 a person records a refusal: the item stops (refused)');
select is((select recorded_by_kind from public.outcomes where contact_id = tests.rid('c8')), 'person', 'E15 ... as a person''s outcome');
select is(pg_temp.j(pg_temp.plan('a_sales', format('{"batch_id": "%s", "name": "again", "goal": "general", "channel": "call", "language": "te", "who": {"contact_ids": ["%s"]}}', tests.rid('b5'), tests.rid('c8'))), 'plan.skipped.other'), '1', 'E16 a person who said no is not planned again within 90 days');
select is(pg_temp.j(pg_temp.res('x5', pg_temp.mk('b6', 'c1'), 'connected', '{"outcome": "negative", "category": "wrong_number"}', 1), 'reason'), 'wrong_number', 'E17 a wrong number stops');
select is(pg_temp.j(pg_temp.res('x5', pg_temp.mk('b7', 'c2'), 'connected', '{"outcome": "negative", "category": "already_bought", "reason": "bought elsewhere"}', 1), 'reason'), 'already_bought', 'E18 "already bought" is a category now');
select is(pg_temp.res('x5', pg_temp.mk('b8', 'c1'), 'connected', '{"outcome": "negative", "category": "nonsense"}', 1), 'ERR:22023', 'E19 an unknown category is invalid');
select is(pg_temp.res('x5', pg_temp.mk('b9', 'c1'), 'connected', '{"outcome": "positive", "category": "not_interested"}', 1), 'ERR:22023', 'E20 a category must belong to its outcome');
select is(pg_temp.res('x5', pg_temp.mk('ba', 'c1'), 'connected', '{"outcome": "positive", "category": "interested", "captured": {"Bad Key": "x"}}', 1), 'ERR:22023', 'E21 the captured fields have plain keys');
select is(pg_temp.j(pg_temp.res('x5', pg_temp.mk('bb', 'c1'), 'connected', '{"outcome": "unclear", "category": "call_back_later", "callback_at": "2026-11-05T15:00:00+05:30"}', 1), 'next_at')::timestamptz, '2026-11-05T15:00:00+05:30'::timestamptz, 'E22 "call me at 3 on Thursday": the next call is then');
select is((select callback_at from public.outcome_details d join public.outcomes o on o.id = d.outcome_id where o.source_id in (select id from public.outreach_attempts where item_id = (select id from public.outreach_items where batch_id = tests.rid('bb')))), '2026-11-05T15:00:00+05:30'::timestamptz, 'E23 the call-back time is kept');
select is(pg_temp.j(pg_temp.res('x5', pg_temp.mk('bc', 'c2'), 'connected', '{"outcome": "negative", "category": "not_interested"}', 1, true), 'reason'), 'stopped', 'E24 a STOP stops the person for good');
select is((select suppressed_at is not null from public.contacts where id = tests.rid('c2')), true, 'E25 ... and the contact is suppressed (nobody writes or calls them again)');
-- attempts used up: then WhatsApp (channel both) or stop
select pg_temp.pin('2026-11-04T10:00:00+05:30'::timestamptz);
update public.outreach_batches set channel = 'both', message_text = 'Namaste {name}, thanks for your interest.' where id = tests.rid('bb');
select is(pg_temp.j(pg_temp.res('x5', (select id from public.outreach_items where batch_id = tests.rid('bb')), 'no_answer'), 'status'), 'waiting', 'E26 the callback item failed once (attempt 2 of 3): waits');
update public.outreach_items set attempts = 2, next_at = now() where batch_id = tests.rid('bb');
select is(pg_temp.j(pg_temp.res('x5', (select id from public.outreach_items where batch_id = tests.rid('bb')), 'voicemail'), 'next_at')::timestamptz, '2026-11-04T10:00:00+05:30'::timestamptz, 'E27 the last attempt unanswered: WhatsApp now');
select is((select next_action from public.outreach_items where batch_id = tests.rid('bb')), 'whatsapp', 'E28 the next step is the WhatsApp message');
update public.outreach_batches set channel = 'call' where id = tests.rid('b4');

-- ============================================================================ F. caps
select pg_temp.pin('2026-11-04T10:00:00+05:30'::timestamptz);
insert into public.outreach_batches (id, tenant_id, name, goal, channel, language, status, plan_sha256, created_by, approved_by, approved_at, max_calls_per_day, max_total_minutes)
values (tests.rid('cap1'), tests.tid('a'), 'Capped', 'general', 'call', 'en', 'running', repeat('a', 64), tests.uid('a_owner'), tests.uid('a_owner'), now(), 1, 5);
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent) values
  (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Cap One', '+91 98111 00001', 'granted'), (tests.rid('k2'), tests.tid('a'), tests.rid('co'), 'Cap Two', '+91 98111 00002', 'granted');
insert into public.outreach_items (tenant_id, batch_id, contact_id, status, next_action, next_at) select tests.tid('a'), tests.rid('cap1'), c.id, 'waiting', 'call', now() from public.contacts c where c.id in (tests.rid('k1'), tests.rid('k2'));
update public.outreach_items set status = 'stopped', reason = 'cancelled', next_action = null, next_at = null where status = 'waiting' and batch_id <> tests.rid('cap1');
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_run(10) -> ''calls'')::text'), '2', 'F1 both capped-batch calls are handed out when nothing has been made yet');
update public.outreach_items set next_at = now() where batch_id = tests.rid('cap1');
select pg_temp.res('x5', (select id from public.outreach_items where batch_id = tests.rid('cap1') and contact_id = tests.rid('k1')), 'connected', '{"outcome": "unclear"}', 6);
update public.outreach_items set next_at = now() where batch_id = tests.rid('cap1') and status = 'waiting';
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is((select status || ':' || paused_reason from public.outreach_batches where id = tests.rid('cap1')), 'paused:cap_minutes', 'F2 six minutes used of five: the batch pauses (cap_minutes)');
select is(pg_temp.val('a_owner', format($q$select (public.today_summary(%L) -> 'needs_you' -> 0 ->> 'kind')$q$, pg_temp.t('a'))), 'outreach_paused', 'F3 and a Needs-you item appears on Today');
select is(pg_temp.val('a_owner', format($q$select (public.today_summary(%L) -> 'needs_you' -> 0 -> 'target' ->> 'type')$q$, pg_temp.t('a'))), 'outreach_batch', 'F4 pointing at the batch');
select is(pg_temp.val('a_sales', format($q$select (public.today_summary(%L) -> 'needs_you' -> 0 ->> 'kind')$q$, pg_temp.t('a'))), null, 'F5 Sales is not asked');
select is(pg_temp.val('a_admin', format($q$select public.outreach_batch_state(%L, %L, 'resume')::text$q$, pg_temp.t('a'), tests.rid('cap1'))), 'ERR:SM811', 'F6 resuming without raising the minutes cap is refused');
select is(pg_temp.val('a_admin', format($q$select public.outreach_caps_set(%L, 'batch', %L, 5, 20)::text$q$, pg_temp.t('a'), tests.rid('cap1'))), 'ERR:42501', 'F7 raising a cap is the Owner''s');
select is(pg_temp.val('a_owner', format($q$select public.outreach_caps_set(%L, 'batch', %L, 5, 20) -> 'batch' ->> 'status'$q$, pg_temp.t('a'), tests.rid('cap1')), 'aal1'), 'ERR:SM306', 'F8 ... with the second factor');
select is(pg_temp.val('a_owner', format($q$select public.outreach_caps_set(%L, 'batch', %L, 1, 20) -> 'batch' ->> 'status'$q$, pg_temp.t('a'), tests.rid('cap1'))), 'running', 'F9 the Owner raises it: the batch runs again');
update public.outreach_items set next_at = now() where batch_id = tests.rid('cap1') and status = 'waiting';
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is((select count(*)::int from public.outreach_attempts a join public.outreach_items i on i.id = a.item_id where i.batch_id = tests.rid('cap1') and a.channel = 'call' and (a.at at time zone 'Asia/Kolkata')::date = '2026-11-04'), 1, 'F10 one call today so far');
select is((select status || ':' || paused_reason from public.outreach_batches where id = tests.rid('cap1')), 'paused:cap_calls', 'F11 the day''s limit of one call is reached: the batch pauses (cap_calls)');
select is(pg_temp.val('a_owner', format($q$select (public.today_summary(%L) -> 'needs_you' -> 0 ->> 'id')$q$, pg_temp.t('a'))), tests.rid('cap1')::text, 'F12 (and it is on Today again)');
select pg_temp.pin('2026-11-05T09:30:00+05:30'::timestamptz);
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is((select status from public.outreach_batches where id = tests.rid('cap1')), 'running', 'F13 a day''s limit lifts the next morning');

-- ============================================================================ G. standing rules per source
create function pg_temp.rule(p_user text, p_doc text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.outreach_rule_save(%L, %L::jsonb)::text$q$, pg_temp.t('a'), p_doc), p_aal) $$;
create function pg_temp.rdoc(p_id text, p_extra text default '') returns text language sql as $$
  select format('{"rule_id": "%s", "source": "meta_lead_ads", "action": "call_within_minutes", "within_minutes": 2, "goal": "site_visit", "channel": "both", "language": "te", "questions": ["Budget?"], "message_text": "Namaste {name}, we got your enquiry."%s}', tests.rid(p_id), p_extra) $$;
select pg_temp.pin('2026-11-05T11:00:00+05:30'::timestamptz);
select is(pg_temp.rule('a_admin', pg_temp.rdoc('r1')), 'ERR:42501', 'G1 an Admin cannot approve a standing rule');
select is(pg_temp.rule('a_owner', pg_temp.rdoc('r1'), 'aal1'), 'ERR:SM306', 'G2 the Owner needs the second factor');
select is(pg_temp.rule('a_owner', pg_temp.rdoc('r9', ', "action": "teleport"')), 'ERR:22023', 'G3 an unknown action is invalid');
select is(pg_temp.rule('a_owner', replace(pg_temp.rdoc('r9'), '"message_text": "Namaste {name}, we got your enquiry."', '"x": 1')), 'ERR:22023', 'G4 an unknown key is invalid');
select is(pg_temp.j(pg_temp.rule('a_owner', pg_temp.rdoc('r1')), 'active'), 'true', 'G5 the Owner approves the rule once');
select is(pg_temp.rule('a_owner', replace(pg_temp.rdoc('r2'), '"within_minutes": 2', '"within_minutes": 5')), 'ERR:SM811', 'G6 one active rule per source');
-- a lead that arrived BEFORE the approval is not called; one that arrives after is
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent) values
  (tests.rid('m1'), tests.tid('a'), tests.rid('co'), 'Meta One', '+91 98222 00001', 'granted', 'granted'),
  (tests.rid('m2'), tests.tid('a'), tests.rid('co'), 'Meta Two', '+91 98222 00002', 'granted', 'granted'),
  (tests.rid('m3'), tests.tid('a'), tests.rid('co'), 'Meta Three', '+91 98222 00003', 'granted', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values
  (tests.rid('lm0'), tests.tid('a'), tests.rid('co'), tests.rid('m1'), 'meta_lead_ads', '2026-11-05T10:00:00+05:30');
select pg_temp.pin('2026-11-05T11:05:00+05:30'::timestamptz);
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values
  (tests.rid('lm1'), tests.tid('a'), tests.rid('co'), tests.rid('m2'), 'meta_lead_ads', '2026-11-05T11:05:00+05:30');
select is(pg_temp.sch('select public.scheduler_outreach_scan(100)::text'), '{"added": 1}', 'G7 the scan finds one new lead (not the older one)');
select is((select next_action || '@' || next_at::text from public.outreach_items where rule_id = tests.rid('r1')), 'call@' || '2026-11-05T11:07:00+05:30'::timestamptz::text, 'G8 "call within 2 minutes": the call is at 11:07');
select is(pg_temp.sch('select public.scheduler_outreach_scan(100)::text'), '{"added": 0}', 'G9 scanning again adds nothing');
-- after hours: WhatsApp now, the call next morning at 09:30
select pg_temp.pin('2026-11-05T22:00:00+05:30'::timestamptz);
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values
  (tests.rid('lm2'), tests.tid('a'), tests.rid('co'), tests.rid('m3'), 'meta_lead_ads', '2026-11-05T22:00:00+05:30');
select pg_temp.sch('select public.scheduler_outreach_scan(100)::text');
select is((select next_action from public.outreach_items where rule_id = tests.rid('r1') and lead_id = tests.rid('lm2')), 'whatsapp', 'G10 a lead after hours gets WhatsApp now');
select is((select then_action || '@' || then_at::text from public.outreach_items where rule_id = tests.rid('r1') and lead_id = tests.rid('lm2')), 'call@' || '2026-11-06T09:30:00+05:30'::timestamptz::text, 'G11 ... and the call next morning at 09:30');
select is((select first_touch_at from public.outreach_items where rule_id = tests.rid('r1') and lead_id = tests.rid('lm2')), null, 'G12 (nothing has been touched yet)');
select is(pg_temp.sch('select (public.scheduler_outreach_run(10) ->> ''whatsapp'')'), '1', 'G13 the WhatsApp goes at once through the outbox');
select is((select count(*)::int from public.outbox_messages where lead_id = tests.rid('lm2')), 1, 'G14 as an ordinary outbox message');
select is((select category from public.outbox_messages where lead_id = tests.rid('lm2')), 'campaign_reminder', 'G15 (the category the approved-once pipeline uses)');
select is((select position('Meta Three' in body) = 0 and position('Namaste Meta' in body) > 0 from public.outbox_messages where lead_id = tests.rid('lm2')), true, 'G16 {name} became the first name only');
select is((select next_action || '@' || next_at::text from public.outreach_items where lead_id = tests.rid('lm2')), 'call@' || '2026-11-06T09:30:00+05:30'::timestamptz::text, 'G17 and the item now waits for the morning call');
select is((select count(*)::int from public.outreach_attempts where item_id = (select id from public.outreach_items where lead_id = tests.rid('lm2')) and channel = 'whatsapp'), 1, 'G18 the WhatsApp step is recorded as an attempt');
select is(pg_temp.j(pg_temp.val('a_admin', format($q$select public.outreach_rule_state(%L, %L, 'pause')::text$q$, pg_temp.t('a'), tests.rid('r1'))), 'paused_reason'), 'owner', 'G19 an Admin pauses the rule');
select pg_temp.pin('2026-11-06T10:00:00+05:30'::timestamptz);
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent) values (tests.rid('m4'), tests.tid('a'), tests.rid('co'), 'Meta Four', '+91 98222 00004', 'granted', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values (tests.rid('lm3'), tests.tid('a'), tests.rid('co'), tests.rid('m4'), 'meta_lead_ads', '2026-11-06T09:30:00+05:30');
select is(pg_temp.sch('select public.scheduler_outreach_scan(100)::text'), '{"added": 0}', 'G20 a paused rule takes nobody');
select pg_temp.val('a_admin', format($q$select public.outreach_rule_state(%L, %L, 'resume')::text$q$, pg_temp.t('a'), tests.rid('r1')));
select is(pg_temp.sch('select public.scheduler_outreach_scan(100)::text'), '{"added": 0}', 'G21 and a lead that came while it was off is not called afterwards');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.outreach_rules_list(%L))::text$q$, pg_temp.t('a'))), '1', 'G22 the rules can be read by Sales');
update public.contacts set phone_consent = 'withdrawn' where id = tests.rid('m2');
select is((select status from public.outreach_items where lead_id = tests.rid('lm1')), 'waiting', 'G23 (m2 still waits; consent is checked again at dial time)');
select pg_temp.pin('2026-11-06T10:05:00+05:30'::timestamptz);
update public.outreach_items set next_at = now() where lead_id = tests.rid('lm1');
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is((select status || ':' || reason from public.outreach_items where lead_id = tests.rid('lm1')), 'stopped:stopped', 'G24 a customer who withdrew consent is stopped at dial time');

-- ============================================================================ H. hot-lead hand-off
select is((select assigned_to from public.outreach_handoffs where contact_id = tests.rid('c3')), tests.uid('a_sales'), 'H1 the hot lead goes to the Sales member');
select is((select owner_user_id from public.leads where id = tests.rid('l3')), tests.uid('a_sales'), 'H2 and the lead is assigned to them');
select is((select summary from public.outreach_handoffs where contact_id = tests.rid('c3')), 'Sita Devi is interested (site visit): area Gachibowli, budget 50 lakh', 'H3 the summary is one line with the captured fields');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.outreach_handoffs_list(%L, true))::text$q$, pg_temp.t('a'))), '1', 'H4 the assignee sees it');
select is(pg_temp.val('a_viewer', format($q$select public.outreach_handoffs_list(%L, true)::text$q$, pg_temp.t('a'))), 'ERR:42501', 'H5 a Viewer does not');
select pg_temp.pin('2026-11-06T10:10:00+05:30'::timestamptz);
update public.outreach_handoffs set notified_at = '2026-11-06T09:50:00+05:30' where contact_id = tests.rid('c3');
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_reminders(10))::text'), '1', 'H6 twenty minutes later nobody has acted: one reminder');
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_reminders(10))::text'), '0', 'H7 ... once');
select is(pg_temp.val('a_sales', format($q$select (public.today_summary(%L) -> 'needs_you' -> 0 ->> 'kind')$q$, pg_temp.t('a'))), 'hot_lead_waiting', 'H8 the hot lead is on Today for the one who must call');
select is(pg_temp.val('a_viewer', format($q$select public.outreach_handoff_acted(%L, %L)::text$q$, pg_temp.t('a'), (select id from public.outreach_handoffs where contact_id = tests.rid('c3')))), 'ERR:42501', 'H9 a Viewer cannot mark it done');
select is(pg_temp.val('a_sales', format($q$select (public.outreach_handoff_acted(%L, %L) ->> 'acted_at') is not null$q$, pg_temp.t('a'), (select id from public.outreach_handoffs where contact_id = tests.rid('c3')))), 'true', 'H10 the assignee marks it done');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.outreach_handoffs_list(%L, true))::text$q$, pg_temp.t('a'))), '0', 'H11 it leaves the open list');

-- ============================================================================ I. reports
select is(pg_temp.val('a_owner', format($q$select public.outreach_source_costs_set(%L, '[{"source": "excel_upload", "cost_per_lead_paise": 2000}]')::text$q$, pg_temp.t('a'))) like '%excel_upload%', true, 'I1 the Owner sets a cost per lead');
select is(pg_temp.val('a_admin', format($q$select public.outreach_source_costs_set(%L, '[]')::text$q$, pg_temp.t('a'))), 'ERR:42501', 'I2 an Admin cannot');
-- the report counts the leads that arrived in the window: the leads of this file arrive on the day the (pinned) clock says
update public.leads set created_at = '2026-11-02T10:00:00+05:30' where tenant_id = pg_temp.t('a');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent) values (tests.rid('ix1'), tests.tid('a'), tests.rid('co'), 'Never Called', '+91 98000 00099', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values (tests.rid('lix1'), tests.tid('a'), tests.rid('co'), tests.rid('ix1'), 'indiamart', '2026-11-03T10:00:00+05:30');
select pg_temp.val('a_owner', format($q$select public.outreach_source_costs_set(%L, '[{"source": "excel_upload", "cost_per_lead_paise": 2000}, {"source": "indiamart", "cost_per_lead_paise": 3000}]')::text$q$, pg_temp.t('a')));
create temp table rep as select pg_temp.val('a_owner', format($q$select public.outreach_report(%L, '2026-11-01', '2026-11-30')::text$q$, pg_temp.t('a')))::jsonb as r;
select cmp_ok((select (r -> 'total' ->> 'calls')::int from rep), '>=', 5, 'I3 the total counts the calls made');
select cmp_ok((select count(*)::int from rep, jsonb_array_elements(r -> 'by_source')), '>=', 2, 'I4 there is a row per source');
select is((select (e ->> 'first_touch_median_seconds') is not null from rep, jsonb_array_elements(r -> 'by_source') e where e ->> 'source' = 'excel_upload'), true, 'I5 speed to first touch is reported');
select is((select (e ->> 'lead_cost_paise')::int from rep, jsonb_array_elements(r -> 'by_source') e where e ->> 'source' = 'excel_upload') > 0, true, 'I6 the lead cost comes from the source costs');
select is(pg_temp.val('a_viewer', format($q$select (public.outreach_report(%L, null, null) -> 'total' ->> 'leads') is not null$q$, pg_temp.t('a'))), 'true', 'I7 a Viewer can read the report');
select is(pg_temp.val('a_owner', format($q$select public.outreach_report(%L, '2026-12-01', '2026-11-01')::text$q$, pg_temp.t('a'))), 'ERR:22023', 'I8 a backwards range is invalid');
select is((select (e ->> 'leads') || '/' || (e ->> 'calls') || '/' || (e ->> 'lead_cost_paise') from rep, jsonb_array_elements(r -> 'by_source') e where e ->> 'source' = 'indiamart'), '1/0/3000', 'I9 a source whose leads nobody has called yet is still listed, with its cost');
select is((select (e ->> 'first_touch_median_seconds') is null from rep, jsonb_array_elements(r -> 'by_source') e where e ->> 'source' = 'indiamart'), true, 'I10 ... and has no speed to first touch');

-- ============================================================================ J. doors
select is((select count(*)::int from information_schema.role_table_grants where table_name in ('outreach_policy', 'outreach_batches', 'outreach_rules', 'outreach_items', 'outreach_attempts', 'outreach_handoffs', 'outcome_details', 'lead_source_costs')
                                                                                and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0, 'J1 nobody can write the tables directly');
select is((select count(*)::int from information_schema.role_table_grants where table_name in ('outreach_batches', 'outreach_items') and grantee = 'anon'), 0, 'J2 the public key reads nothing');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'outreach\_%' and has_function_privilege('anon', p.oid, 'execute')), 0, 'J3 no outreach function is open to the public key');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'outreach\_%' or p.proname like 'scheduler\_outreach\_%') and not p.prosecdef), 0, 'J4 every outreach function is a definer');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'outreach\_%' or p.proname like 'scheduler\_outreach\_%') and not coalesce(p.proconfig::text ~ 'search_path=', false)), 0, 'J5 ... with a fixed search path');

select * from finish();
rollback;
