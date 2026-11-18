-- The Owner's approval of EACH call (migration 20261231982800; planner, 18 Nov 2026): a call is covered by the owner's own press, an approved task, a standing rule that is on, or a running approved batch.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.ok(p_user text, p_kind text, p_ref text default null, p_number text default '+91 98333 20001', p_tenant text default null) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.call_approved(%L, %L, %L, %L)::text$q$, coalesce(p_tenant, tests.tid('a')::text), p_kind, p_ref, p_number)) $$;

insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Approve Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Kiran', '+91 98333 20001');
insert into public.tasks (id, tenant_id, instruction, language, created_by) values (tests.rid('t1'), tests.tid('a'), 'Call the new leads', 'en', tests.uid('a_owner'));
insert into public.task_contacts (tenant_id, task_id, contact_id, lead_id) select tests.tid('a'), tests.rid('t1'), tests.rid('k1'), l.id from (select id from public.leads where tenant_id = tests.tid('a') limit 1) l;
insert into public.tasks (id, tenant_id, instruction, language, created_by) values (tests.rid('t2'), tests.tid('a'), 'Another task', 'en', tests.uid('a_owner'));
insert into public.task_contacts (tenant_id, task_id, contact_id, lead_id) select tests.tid('a'), tests.rid('t2'), tests.rid('k1'), l.id from (select id from public.leads where tenant_id = tests.tid('a') limit 1) l;
insert into public.outreach_rules (id, tenant_id, source, action, goal, channel, language, approved_by) values (tests.rid('r1'), tests.tid('a'), 'website_form', 'call_within_minutes', 'general', 'call', 'en', tests.uid('a_owner'));
insert into public.outreach_items (id, tenant_id, rule_id, contact_id, status, next_action, next_at) values (tests.rid('i1'), tests.tid('a'), tests.rid('r1'), tests.rid('k1'), 'waiting', 'call', now());
insert into public.outreach_batches (id, tenant_id, name, goal, channel, language, plan_sha256, created_by) values (tests.rid('b1'), tests.tid('a'), 'Batch', 'general', 'call', 'en', repeat('a', 64), tests.uid('a_owner'));
insert into public.outreach_items (id, tenant_id, batch_id, contact_id, status, next_action, next_at) values (tests.rid('i2'), tests.tid('a'), tests.rid('b1'), tests.rid('k1'), 'waiting', 'call', now());

-- the owner's own press
select is(pg_temp.ok('a_owner', 'owner_test'), 'true', 'A1 the Owner pressing the call button is the approval');
select is(pg_temp.ok('a_admin', 'owner_test'), 'true', 'A2 so is an Admin');
select is(pg_temp.ok('a_sales', 'owner_test'), 'ERR:42501', 'A3 Sales may not even ask');
select is(pg_temp.val('outsider', format($q$select public.call_approved(%L, 'owner_test', null, null)::text$q$, tests.tid('a'))), 'false', 'A4 the phone server with no person behind it is NOT an owner press');

-- a task
select is(pg_temp.ok('outsider', 'task', tests.rid('t1')::text), 'false', 'A5 a task that is only planned approves nothing');
update public.tasks set status = 'approved', approved_at = now(), approved_by = tests.uid('a_owner') where id = tests.rid('t1');
select is(pg_temp.ok('outsider', 'task', tests.rid('t1')::text), 'true', 'A6 an approved task covers its calls');
update public.tasks set status = 'cancelled' where id = tests.rid('t1');
select is(pg_temp.ok('outsider', 'task', tests.rid('t1')::text), 'false', 'A7 a cancelled task covers nothing');

-- a standing rule
select is(pg_temp.ok('outsider', 'standing_rule', tests.rid('i1')::text), 'true', 'A8 an item of a rule that is on is covered');
update public.outreach_rules set active = false, paused_reason = 'owner', paused_at = now() where id = tests.rid('r1');
select is(pg_temp.ok('outsider', 'standing_rule', tests.rid('i1')::text), 'false', 'A9 the owner paused the rule: its calls are no longer approved');

-- a batch plan
select is(pg_temp.ok('outsider', 'plan', tests.rid('i2')::text), 'false', 'A10 a batch that is only planned approves nothing');
update public.outreach_batches set status = 'running', approved_by = tests.uid('a_owner'), approved_at = now() where id = tests.rid('b1');
select is(pg_temp.ok('outsider', 'plan', tests.rid('i2')::text), 'true', 'A11 a running approved batch covers its items');

-- nothing else
select is(pg_temp.ok('outsider', 'whatever', tests.rid('i2')::text), 'false', 'A12 an unknown kind is never approved');
select is(pg_temp.ok('outsider', 'standing_rule', gen_random_uuid()::text), 'false', 'A13 an item that does not exist is not approved');
select is(pg_temp.val('b_owner', format($q$select public.call_approved(%L, 'owner_test', null, null)::text$q$, tests.tid('a'))), 'ERR:42501', 'A14 another workspace''s Owner is refused');

-- review of 18 Nov: it is THIS call (the number), and the statuses matter
select is(pg_temp.ok('outsider', 'standing_rule', tests.rid('i1')::text, '+91 99999 99999'), 'false', 'A15 a rule item with ANOTHER person''s number is not approved (the approval is for this call)');
update public.outreach_rules set active = true, paused_reason = null, paused_at = null where id = tests.rid('r1');
select is(pg_temp.ok('outsider', 'standing_rule', tests.rid('i1')::text, '+919833320001'), 'true', 'A16 the same item with the person''s own number, written another way, is approved');
select is(pg_temp.ok('outsider', 'standing_rule', tests.rid('i1')::text, ''), 'false', 'A17 an empty number approves nothing');
update public.outreach_items set status = 'stopped', next_action = null, next_at = null where id = tests.rid('i1');
select is(pg_temp.ok('outsider', 'standing_rule', tests.rid('i1')::text), 'false', 'A18 an item that is stopped is not approved');
update public.tasks set status = 'approved', approved_at = now(), approved_by = tests.uid('a_owner') where id = tests.rid('t2');
select is(pg_temp.ok('outsider', 'task', tests.rid('t2')::text), 'true', 'A19 an approved task covers the call to ITS contact');
select is(pg_temp.ok('outsider', 'task', tests.rid('t2')::text, '+91 98333 99999'), 'false', 'A20 ... and not to a number that is not one of its contacts');
update public.tasks set status = 'paused', pause_reason = 'owner' where id = tests.rid('t2');
select is(pg_temp.ok('outsider', 'task', tests.rid('t2')::text), 'false', 'A21 a paused task covers nothing');
update public.tasks set status = 'done', pause_reason = null where id = tests.rid('t2');
select is(pg_temp.ok('outsider', 'task', tests.rid('t2')::text), 'false', 'A22 a finished task covers nothing');
update public.outreach_batches set status = 'paused', paused_reason = 'owner', paused_at = now() where id = tests.rid('b1');
select is(pg_temp.ok('outsider', 'plan', tests.rid('i2')::text), 'false', 'A23 a paused batch covers nothing');
select is(pg_temp.ok('outsider', 'task', tests.rid('t1')::text, '+91 98333 20001', tests.tid('b')::text), 'false', 'A24 a task of another workspace is never approved under this workspace');

select * from finish();
rollback;
