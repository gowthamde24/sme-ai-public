-- A Lead Finder prospect is never called by the AI (migration 20261231983500; owner, 18 Nov 2026): no task, rule, batch or call row for one, and a prospect who really enquires is a normal lead.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Prospect Co');
-- a prospect of the Lead Finder (never asked for anything) and the same business as a contact with a lead
insert into public.prospects (id, tenant_id, name, name_key, phone, phone_key, source, source_label, place_id, status)
values (tests.rid('z1'), tests.tid('a'), 'Padma Sarees', 'padma sarees', '+91 98444 30001', '919844430001', 'fixture', 'Made-up', 'place:z1', 'call_ready');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Padma Sarees', '+91 98444 30001');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('k2'), tests.tid('a'), tests.rid('co'), 'A Real Customer', '+91 98444 30002');
insert into public.leads (id, tenant_id, company_id, contact_id, source) values (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('k1'), 'lead_finder');
insert into public.leads (id, tenant_id, company_id, contact_id, source) values (tests.rid('l2'), tests.tid('a'), tests.rid('co'), tests.rid('k2'), 'website_form');

-- A. who is a prospect
select is(app.contact_is_prospect(tests.tid('a'), tests.rid('k1')), true, 'A1 a contact with a prospect''s number is a prospect');
select is(app.contact_is_prospect(tests.tid('a'), tests.rid('k2')), false, 'A2 a real customer is not');
select is(app.prospect_number_blocked(tests.tid('a'), '098444 30001'), true, 'A3 the bare number, written another way, is blocked');
select is(app.prospect_number_blocked(tests.tid('a'), '+91 98444 30002'), false, 'A4 another number is not');
select is(app.prospect_number_blocked(tests.tid('b'), '+91 98444 30001'), false, 'A5 another workspace has no such prospect');
select is(app.prospect_number_blocked(tests.tid('a'), ''), false, 'A6 an empty number is not a prospect');

-- B. the queues
insert into public.tasks (id, tenant_id, instruction, language, created_by) values (tests.rid('t1'), tests.tid('a'), 'Call these', 'en', tests.uid('a_owner'));
insert into public.task_contacts (tenant_id, task_id, contact_id, lead_id) values (tests.tid('a'), tests.rid('t1'), tests.rid('k1'), tests.rid('l1')), (tests.tid('a'), tests.rid('t1'), tests.rid('k2'), tests.rid('l2'));
select is((select status || '/' || coalesce(skip_reason, '') from public.task_contacts where task_id = tests.rid('t1') and contact_id = tests.rid('k1')), 'skipped/prospect_no_ai_call', 'B1 a task never queues a prospect: skipped, with the word');
select is((select status from public.task_contacts where task_id = tests.rid('t1') and contact_id = tests.rid('k2')), 'waiting', 'B2 a real customer in the same task is queued');
insert into public.outreach_rules (id, tenant_id, source, action, goal, channel, language, approved_by) values (tests.rid('r1'), tests.tid('a'), 'website_form', 'call_within_minutes', 'general', 'call', 'en', tests.uid('a_owner'));
insert into public.outreach_items (id, tenant_id, rule_id, lead_id, contact_id, status, next_action, next_at) values (tests.rid('i1'), tests.tid('a'), tests.rid('r1'), tests.rid('l1'), tests.rid('k1'), 'waiting', 'call', now());
select is((select status || '/' || coalesce(reason, '') || '/' || coalesce(next_action, '-') from public.outreach_items where id = tests.rid('i1')), 'skipped/prospect_no_ai_call/-', 'B3 a rule never queues a prospect: nothing is due');
insert into public.outreach_batches (id, tenant_id, name, goal, channel, language, plan_sha256, created_by) values (tests.rid('b1'), tests.tid('a'), 'Batch', 'general', 'call', 'en', repeat('a', 64), tests.uid('a_owner'));
insert into public.outreach_items (id, tenant_id, batch_id, contact_id, status, next_action, next_at) values (tests.rid('i2'), tests.tid('a'), tests.rid('b1'), tests.rid('k1'), 'waiting', 'call', now());
select is((select status || '/' || coalesce(reason, '') from public.outreach_items where id = tests.rid('i2')), 'skipped/prospect_no_ai_call', 'B4 nor does a batch or list');
insert into public.outreach_items (id, tenant_id, batch_id, contact_id, status, next_action, next_at) values (tests.rid('i3'), tests.tid('a'), tests.rid('b1'), tests.rid('k2'), 'waiting', 'call', now());
select is((select status from public.outreach_items where id = tests.rid('i3')), 'waiting', 'B5 a real customer in the batch is queued');

-- C. a call row
select throws_ok(format($q$insert into public.phone_calls (tenant_id, direction, state, contact_id) values (%L, 'outbound', 'queued', %L)$q$, tests.tid('a'), tests.rid('k1')), 'SM975', null, 'C1 a call row for a prospect cannot be made (a refused row can)');
select lives_ok(format($q$insert into public.phone_calls (tenant_id, direction, state, refuse_reason, contact_id, provider, ended_at) values (%L, 'outbound', 'refused', 'prospect_no_ai_call', %L, 'plivo', now())$q$, tests.tid('a'), tests.rid('k1')), 'C2 a refused row with the word is accepted (the word is in the closed list)');

-- D. what the call path asks
select is(pg_temp.val('a_owner', format($q$select public.prospect_no_ai_call(%L, '+91 98444 30001')::text$q$, tests.tid('a'))), 'true', 'D1 the call path is told');
select is(pg_temp.val('a_owner', format($q$select public.prospect_no_ai_call(%L, '+91 98444 30002')::text$q$, tests.tid('a'))), 'false', 'D2 ... and a real customer is not');
select is(pg_temp.val('a_sales', format($q$select public.prospect_no_ai_call(%L, '+91 98444 30001')::text$q$, tests.tid('a'))), 'ERR:42501', 'D3 Sales may not ask');
select is(pg_temp.val('b_owner', format($q$select public.prospect_no_ai_call(%L, '+91 98444 30001')::text$q$, tests.tid('a'))), 'ERR:42501', 'D4 nor another workspace');

-- E. a prospect who really enquires is a normal lead again
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, received_at) values (tests.tid('a'), tests.rid('l1'), tests.rid('k1'), 'website_form', 'first', now());
select is(app.contact_is_prospect(tests.tid('a'), tests.rid('k1')), false, 'E1 once the prospect has asked through the website form they are a normal lead (proof of request)');
select is(app.prospect_number_blocked(tests.tid('a'), '+91 98444 30001'), false, 'E2 and their number is no longer blocked');
select is(pg_temp.val('a_owner', format($q$select public.prospect_no_ai_call(%L, '+91 98444 30001')::text$q$, tests.tid('a'))), 'false', 'E3 the call path agrees');
insert into public.outreach_items (id, tenant_id, batch_id, contact_id, status, next_action, next_at) values (tests.rid('i4'), tests.tid('a'), tests.rid('b1'), tests.rid('k1'), 'waiting', 'call', now()) on conflict do nothing;
select is((select status from public.outreach_items where id = tests.rid('i4')), 'waiting', 'E4 a call-back to them can be queued again');

select * from finish();
rollback;
