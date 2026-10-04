-- audit_events: written only by DB triggers, readable by Owner/Admin of the same tenant,
-- append-only for every role, with before/after values on changes.
begin;
select no_plan();
select tests.seed_two_tenants();

-- ------------------------------------------ system-written events (no JWT present)
select is(
  (select count(*) from public.audit_events
    where tenant_id = tests.tid('a') and action = 'tenant.create' and actor_type = 'system'
      and actor_user_id is null and entity_type = 'tenant' and entity_id = tests.tid('a')),
  1::bigint, 'seeding a tenant without a JWT is audited as actor_type=system');
select is(
  (select count(*) from public.audit_events
    where tenant_id = tests.tid('a') and action = 'membership.create'),
  5::bigint, 'each seeded membership of tenant A produced one audit event');
select is(
  (select new_values ->> 'role' from public.audit_events
    where tenant_id = tests.tid('a') and action = 'membership.create'
      and new_values ->> 'user_id' = tests.uid('a_admin')::text),
  'admin', 'create event carries the new role');
select is(
  (select old_values from public.audit_events
    where tenant_id = tests.tid('a') and action = 'tenant.create'),
  null, 'create events have no old_values');

-- ------------------------------------------ user-driven changes are attributed + diffed
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('a'), tests.uid('x1'))), 'ok', 'setup: owner adds x1 as viewer');
select is(
  (select actor_user_id from public.audit_events
    where tenant_id = tests.tid('a') and action = 'membership.create'
      and new_values ->> 'user_id' = tests.uid('x1')::text),
  tests.uid('a_owner'), 'event actor is the JWT subject');
select is(
  (select actor_type from public.audit_events
    where tenant_id = tests.tid('a') and action = 'membership.create'
      and new_values ->> 'user_id' = tests.uid('x1')::text),
  'user', 'event actor_type is user');

select is(tests.rows_as(tests.uid('a_owner'), format(
  $$update public.memberships set role = 'sales' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x1'))), 1::bigint, 'setup: owner changes x1 viewer -> sales');
select results_eq(
  format($$select old_values ->> 'role', new_values ->> 'role', actor_user_id, entity_type, entity_id
    from public.audit_events
    where tenant_id = %L and action = 'membership.update' and new_values ->> 'user_id' = %L$$,
    tests.tid('a'), tests.uid('x1')),
  format($$values ('viewer'::text, 'sales'::text, %L::uuid, 'membership'::text, (select id from public.memberships
    where tenant_id = %L and user_id = %L))$$, tests.uid('a_owner'), tests.tid('a'), tests.uid('x1')),
  'role change records BEFORE (viewer) and AFTER (sales), actor, and entity');

select is(tests.rows_as(tests.uid('a_owner'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x1'))), 1::bigint, 'setup: owner removes x1');
select results_eq(
  format($$select old_values ->> 'role', new_values from public.audit_events
    where tenant_id = %L and action = 'membership.delete' and old_values ->> 'user_id' = %L$$,
    tests.tid('a'), tests.uid('x1')),
  $$values ('sales'::text, null::jsonb)$$,
  'delete records the last role as BEFORE and no AFTER');

select is(tests.rows_as(tests.uid('a_owner'), format(
  $$update public.tenants set name = 'Renamed A' where id = %L$$, tests.tid('a'))),
  1::bigint, 'setup: owner renames tenant');
select results_eq(
  format($$select old_values ->> 'name', new_values ->> 'name' from public.audit_events
    where tenant_id = %L and action = 'tenant.update'$$, tests.tid('a')),
  $$values ('Tenant A'::text, 'Renamed A'::text)$$,
  'tenant rename records old and new name');

-- denied writes leave no trace of success
select is(tests.rows_as(tests.uid('a_sales'), format(
  $$update public.tenants set name = 'x' where id = %L$$, tests.tid('a'))),
  0::bigint, 'setup: sales rename attempt affects 0 rows');
select is(
  (select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'tenant.update'),
  1::bigint, 'a denied write produced no audit event');

-- ------------------------------------------------------------------------ who can read
select cmp_ok(tests.rows_as(tests.uid('a_owner'), 'select 1 from public.audit_events'), '>', 0::bigint,
  'owner: ALLOW read own tenant audit trail');
select cmp_ok(tests.rows_as(tests.uid('a_admin'), 'select 1 from public.audit_events'), '>', 0::bigint,
  'admin: ALLOW read own tenant audit trail');
select is(tests.rows_as(tests.uid('a_sales'), 'select 1 from public.audit_events'), 0::bigint,
  'sales: DENY read audit trail');
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.audit_events'), 0::bigint,
  'viewer: DENY read audit trail');
select is(
  tests.rows_as(tests.uid('a_owner'), format($$select 1 from public.audit_events where tenant_id <> %L$$, tests.tid('a'))),
  0::bigint, 'owner A: sees no audit events of other tenants');
select is(
  tests.rows_as(tests.uid('b_owner'), format($$select 1 from public.audit_events where tenant_id = %L$$, tests.tid('a'))),
  0::bigint, 'owner B: DENY tenant A audit trail');
select is(tests.rows_as(tests.uid('outsider'), 'select 1 from public.audit_events'), 0::bigint,
  'outsider: DENY audit trail');

-- --------------------------------------------------- append-only for application roles
create temp table everyone (n text);
insert into everyone values ('a_owner'), ('a_admin'), ('a_sales'), ('a_viewer'), ('b_owner'), ('outsider');

select is(tests.sqlstate_as(tests.uid(n), format(
  $$insert into public.audit_events (tenant_id, action, entity_type) values (%L, 'forged', 'x')$$,
  tests.tid('a'))), '42501', n || ': DENY forging an audit event')
from everyone;
select is(tests.sqlstate_as(tests.uid(n), $$update public.audit_events set action = 'edited'$$),
  '42501', n || ': DENY editing audit events')
from everyone;
select is(tests.sqlstate_as(tests.uid(n), 'delete from public.audit_events'),
  '42501', n || ': DENY deleting audit events')
from everyone;
select is(tests.sqlstate_as(tests.uid(n), 'truncate public.audit_events'),
  '42501', n || ': DENY truncating audit events')
from everyone;
select is(tests.sqlstate_as(null, 'delete from public.audit_events'), '42501', 'anon: DENY deleting audit events');

select ok(
  not has_function_privilege('authenticated', 'app.write_audit_event(uuid,text,text,uuid,jsonb,jsonb)', 'execute'),
  'authenticated cannot call the audit writer directly');
select ok(
  not has_function_privilege('anon', 'app.write_audit_event(uuid,text,text,uuid,jsonb,jsonb)', 'execute'),
  'anon cannot call the audit writer directly');

-- ---------------------------- append-only even for the privileged session user (triggers)
select throws_ok($$update public.audit_events set action = 'edited'$$, '42501', null,
  'trigger blocks UPDATE even for the table owner');
select throws_ok($$delete from public.audit_events$$, '42501', null,
  'trigger blocks DELETE even for the table owner');
select throws_ok($$truncate public.audit_events$$, '42501', null,
  'trigger blocks TRUNCATE even for the table owner');
select throws_ok(
  format($$delete from public.tenants where id = %L$$, tests.tid('a')), '23503', null,
  'deleting a tenant with audit history is refused (ON DELETE RESTRICT)');
select cmp_ok((select count(*) from public.audit_events), '>', 0::bigint, 'audit rows survived every attempt');

select * from finish();
rollback;
