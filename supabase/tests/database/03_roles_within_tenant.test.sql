-- Role rules INSIDE one tenant: who may manage members, rename the tenant, and escalate.
--   Owner  : manage everyone incl. other owners; rename tenant
--   Admin  : manage ONLY sales/viewer members. Cannot add, demote, promote or remove an Admin or
--            an Owner, and cannot change their own row.
--   Sales / Viewer : read only in T002
-- The statements run in order and mutate state; comments give the expected state at each step.
begin;
select no_plan();
select tests.seed_two_tenants();

-- ======================================================================== OWNER
-- A starts with owners a_owner, a_owner2, dual.
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('a'), tests.uid('x1'))), 'ok', 'owner: ALLOW add viewer');
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'sales')$$,
  tests.tid('a'), tests.uid('x2'))), 'ok', 'owner: ALLOW add sales');
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'admin')$$,
  tests.tid('a'), tests.uid('x3'))), 'ok', 'owner: ALLOW add admin');
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$,
  tests.tid('a'), tests.uid('x4'))), 'ok', 'owner: ALLOW add another owner');

select is(tests.rows_as(tests.uid('a_owner'), format(
  $$update public.memberships set role = 'sales' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x1'))), 1::bigint, 'owner: ALLOW change a role');
select is((select role::text from public.memberships where user_id = tests.uid('x1')), 'sales',
  'owner: role change actually persisted');

select is(tests.rows_as(tests.uid('a_owner'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x1'))), 1::bigint, 'owner: ALLOW remove a member');

select is(tests.rows_as(tests.uid('a_owner'), format(
  $$update public.tenants set name = 'Tenant A Renamed' where id = %L$$, tests.tid('a'))),
  1::bigint, 'owner: ALLOW rename tenant');
select is((select name from public.tenants where id = tests.tid('a')), 'Tenant A Renamed',
  'owner: rename persisted');

select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$update public.tenants set slug = 'hijack' where id = %L$$, tests.tid('a'))),
  '42501', 'owner: DENY changing slug (immutable after creation)');

-- Identity columns of a membership are immutable, even for owners.
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$update public.memberships set tenant_id = %L where tenant_id = %L and user_id = %L$$,
  tests.tid('b'), tests.tid('a'), tests.uid('a_sales'))),
  '42501', 'owner: DENY moving a membership to another tenant');
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$update public.memberships set user_id = %L where tenant_id = %L and user_id = %L$$,
  tests.uid('x5'), tests.tid('a'), tests.uid('a_sales'))),
  '42501', 'owner: DENY reassigning a membership to a different user');

-- tenant_id immutability also holds below the grant layer (defence in depth), for any role.
select throws_ok(
  format($$update public.memberships set tenant_id = %L where user_id = %L$$,
    tests.tid('b'), tests.uid('a_sales')),
  '42501', null, 'trigger blocks tenant_id change even for the privileged session user');

-- ======================================================================== ADMIN
-- State before this block: members are a_owner, a_owner2, dual, x3 (admin), x4 (owner),
-- a_admin, a_sales, a_viewer, x2 (sales). x1 was removed.
select is(tests.sqlstate_as(tests.uid('a_admin'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$,
  tests.tid('a'), tests.uid('x5'))), '42501', 'admin: DENY adding an owner');
select is(tests.sqlstate_as(tests.uid('a_admin'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'admin')$$,
  tests.tid('a'), tests.uid('x5'))), '42501', 'admin: DENY adding an admin');
select is(tests.sqlstate_as(tests.uid('a_admin'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'sales')$$,
  tests.tid('a'), tests.uid('outsider'))), 'ok', 'admin: ALLOW adding sales');
select is(tests.sqlstate_as(tests.uid('a_admin'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('a'), tests.uid('x6'))), 'ok', 'admin: ALLOW adding a viewer');
select is((select count(*) from public.memberships where user_id = tests.uid('x5')), 0::bigint,
  'admin: denied inserts left no row behind');

-- allowed: moving between sales and viewer
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$update public.memberships set role = 'viewer' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_sales'))), 1::bigint, 'admin: ALLOW demote sales to viewer');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$update public.memberships set role = 'sales' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_sales'))), 1::bigint, 'admin: ALLOW promote viewer to sales');

-- denied: promotion into Admin/Owner (WITH CHECK -> 42501)
select is(tests.sqlstate_as(tests.uid('a_admin'), format(
  $$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_viewer'))), '42501', 'admin: DENY promoting someone to admin');
select is(tests.sqlstate_as(tests.uid('a_admin'), format(
  $$update public.memberships set role = 'owner' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_viewer'))), '42501', 'admin: DENY promoting someone to owner');

-- denied: touching Admin/Owner rows at all (USING -> 0 rows), including their own
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$update public.memberships set role = 'owner' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_admin'))), 0::bigint, 'admin: DENY self-promotion to owner (0 rows)');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$update public.memberships set role = 'viewer' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_admin'))), 0::bigint, 'admin: DENY changing own row (0 rows)');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_admin'))), 0::bigint, 'admin: DENY removing self (0 rows)');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$update public.memberships set role = 'viewer' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x3'))), 0::bigint, 'admin: DENY demoting another admin (0 rows)');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x3'))), 0::bigint, 'admin: DENY removing another admin (0 rows)');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$update public.memberships set role = 'viewer' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_owner2'))), 0::bigint, 'admin: DENY demoting an owner (0 rows)');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_owner2'))), 0::bigint, 'admin: DENY removing an owner (0 rows)');

select is(tests.rows_as(tests.uid('a_admin'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x2'))), 1::bigint, 'admin: ALLOW removing a sales member');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x6'))), 1::bigint, 'admin: ALLOW removing a viewer');
select is(tests.rows_as(tests.uid('a_admin'), format(
  $$update public.tenants set name = 'admin rename' where id = %L$$, tests.tid('a'))),
  0::bigint, 'admin: DENY renaming tenant (owner only)');
select is(
  (select array_agg(user_id::text order by user_id::text) from public.memberships
    where tenant_id = tests.tid('a') and role in ('owner', 'admin')),
  (select array_agg(u::text order by u::text) from (values
     (tests.uid('a_owner')), (tests.uid('a_owner2')), (tests.uid('dual')), (tests.uid('x4')),
     (tests.uid('a_admin')), (tests.uid('x3'))) v(u)),
  'admin could not have changed the set of owners/admins (state check)');

-- ============================================================== SALES / VIEWER
create temp table readers (n text);
insert into readers values ('a_sales'), ('a_viewer');

select is(tests.sqlstate_as(tests.uid(n), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('a'), tests.uid('x5'))), '42501', n || ': DENY adding members')
from readers;
select is(tests.rows_as(tests.uid(n), format(
  $$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid(n))), 0::bigint, n || ': DENY self-escalation to admin (0 rows)')
from readers;
select is(tests.rows_as(tests.uid(n), format(
  $$update public.memberships set role = 'viewer' where tenant_id = %L and user_id <> %L$$,
  tests.tid('a'), tests.uid(n))), 0::bigint, n || ': DENY changing others'' roles (0 rows)')
from readers;
select is(tests.rows_as(tests.uid(n), format(
  $$delete from public.memberships where tenant_id = %L$$, tests.tid('a'))),
  0::bigint, n || ': DENY removing members (0 rows)')
from readers;
select is(tests.rows_as(tests.uid(n), format(
  $$update public.tenants set name = 'nope' where id = %L$$, tests.tid('a'))),
  0::bigint, n || ': DENY renaming tenant (0 rows)')
from readers;
select is((select count(*) from public.tenants where name = 'nope'), 0::bigint,
  'sales/viewer writes did not land');

-- ======================================================================== LAST OWNER
-- B has exactly one owner (b_owner).
select is(tests.sqlstate_as(tests.uid('b_owner'), format(
  $$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$,
  tests.tid('b'), tests.uid('b_owner'))), '23514', 'last owner: DENY demoting self');
select is(tests.sqlstate_as(tests.uid('b_owner'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('b'), tests.uid('b_owner'))), '23514', 'last owner: DENY removing self');
select throws_ok(
  format($$delete from public.memberships where tenant_id = %L and user_id = %L$$,
    tests.tid('b'), tests.uid('b_owner')),
  '23514', null, 'last owner: DENY removal even for the privileged session user');
select is((select count(*) from public.memberships where tenant_id = tests.tid('b') and role = 'owner'),
  1::bigint, 'last owner: B still has its owner');

-- Ownership transfer works: promote b_admin first, then step down.
select is(tests.rows_as(tests.uid('b_owner'), format(
  $$update public.memberships set role = 'owner' where tenant_id = %L and user_id = %L$$,
  tests.tid('b'), tests.uid('b_admin'))), 1::bigint, 'ownership transfer: ALLOW promote second owner');
select is(tests.rows_as(tests.uid('b_owner'), format(
  $$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$,
  tests.tid('b'), tests.uid('b_owner'))), 1::bigint, 'ownership transfer: ALLOW original owner steps down');
select is((select user_id from public.memberships where tenant_id = tests.tid('b') and role = 'owner'),
  tests.uid('b_admin'), 'ownership transfer: b_admin is now the sole owner');

-- A currently has owners a_owner, a_owner2, dual, x4: shrinking to one is allowed, below one is not.
select is(tests.rows_as(tests.uid('a_owner'), format(
  $$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_owner2'))), 1::bigint, 'owners > 1: ALLOW demoting an owner');
select is(tests.rows_as(tests.uid('a_owner'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('x4'))), 1::bigint, 'owners > 1: ALLOW removing an owner');
select is(tests.rows_as(tests.uid('a_owner'), format(
  $$delete from public.memberships where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('dual'))), 1::bigint, 'owners > 1: ALLOW removing another owner (dual)');
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('a_owner'))), '23514', 'owners = 1: DENY demoting the final owner');

select * from finish();
rollback;
