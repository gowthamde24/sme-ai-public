-- One person, two tenants, different roles: `dual` is Owner of A and Viewer of B.
-- Authority is per tenant. Being Owner of A must grant nothing in B, and vice versa.
begin;
select no_plan();
select tests.seed_two_tenants();

-- ------------------------------------------------------------------ reads: both tenants
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.tenants where id = %L$$, tests.tid('a'))),
  1::bigint, 'dual: ALLOW read tenant A');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.tenants where id = %L$$, tests.tid('b'))),
  1::bigint, 'dual: ALLOW read tenant B');
select is(tests.rows_as(tests.uid('dual'), 'select 1 from public.tenants'), 2::bigint,
  'dual: sees exactly the two tenants they belong to');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.memberships where tenant_id = %L$$, tests.tid('a'))),
  6::bigint, 'dual: ALLOW read all 6 memberships of A');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.memberships where tenant_id = %L$$, tests.tid('b'))),
  5::bigint, 'dual: ALLOW read all 5 memberships of B');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.users where id = %L$$, tests.uid('b_owner'))),
  1::bigint, 'dual: ALLOW read profile of a B member');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.users where id = %L$$, tests.uid('a_viewer'))),
  1::bigint, 'dual: ALLOW read profile of an A member');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.users where id = %L$$, tests.uid('outsider'))),
  0::bigint, 'dual: DENY read profile of someone in neither tenant');

-- ------------------------------------------------------- no role carry-over, B -> as Viewer
select is(tests.scalar_as(tests.uid('dual'), format(
  $$select app.has_tenant_role(%L, array['owner','admin','sales']::public.app_role[])$$, tests.tid('b'))),
  'false', 'dual: holds no owner/admin/sales authority in B');
select is(tests.scalar_as(tests.uid('dual'), format(
  $$select app.has_tenant_role(%L, array['viewer']::public.app_role[])$$, tests.tid('b'))),
  'true', 'dual: is exactly a viewer in B');
select is(tests.scalar_as(tests.uid('dual'), format(
  $$select app.has_tenant_role(%L, array['owner']::public.app_role[])$$, tests.tid('a'))),
  'true', 'dual: is owner in A');
select is(tests.scalar_as(tests.uid('dual'), format(
  $$select app.has_tenant_role(%L, array['viewer']::public.app_role[])$$, tests.tid('a'))),
  'false', 'dual: viewer in B does not leak into A as a second role');

select is(tests.sqlstate_as(tests.uid('dual'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('b'), tests.uid('x1'))), '42501', 'dual: DENY adding a viewer to B');
select is(tests.sqlstate_as(tests.uid('dual'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$,
  tests.tid('b'), tests.uid('x1'))), '42501', 'dual: DENY adding an owner to B');
select is(tests.rows_as(tests.uid('dual'), format(
  $$update public.memberships set role = 'owner' where tenant_id = %L and user_id = %L$$,
  tests.tid('b'), tests.uid('dual'))), 0::bigint, 'dual: DENY self-promotion in B (0 rows)');
select is(tests.rows_as(tests.uid('dual'), format(
  $$update public.memberships set role = 'viewer' where tenant_id = %L and user_id <> %L$$,
  tests.tid('b'), tests.uid('dual'))), 0::bigint, 'dual: DENY changing other members of B (0 rows)');
select is(tests.rows_as(tests.uid('dual'), format(
  $$delete from public.memberships where tenant_id = %L$$, tests.tid('b'))),
  0::bigint, 'dual: DENY removing members of B (0 rows)');
select is(tests.rows_as(tests.uid('dual'), format(
  $$update public.tenants set name = 'dual was here' where id = %L$$, tests.tid('b'))),
  0::bigint, 'dual: DENY renaming B (0 rows)');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.audit_events where tenant_id = %L$$, tests.tid('b'))),
  0::bigint, 'dual: DENY reading B audit trail (viewer there)');

-- Owner authority in A still works, and is visible only in A.
select cmp_ok(tests.rows_as(tests.uid('dual'), format($$select 1 from public.audit_events where tenant_id = %L$$, tests.tid('a'))),
  '>', 0::bigint, 'dual: ALLOW reading A audit trail (owner there)');
select is(tests.sqlstate_as(tests.uid('dual'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('a'), tests.uid('x1'))), 'ok', 'dual: ALLOW adding a viewer to A');
select is(
  (select count(*) from public.audit_events
    where action = 'membership.create' and actor_user_id = tests.uid('dual')
      and tenant_id = tests.tid('a') and new_values ->> 'user_id' = tests.uid('x1')::text),
  1::bigint, 'dual: the A-side change is audited against tenant A');
select is(
  (select count(*) from public.audit_events where tenant_id = tests.tid('b') and actor_user_id = tests.uid('dual')),
  0::bigint, 'dual: no audit event was attributed to tenant B');
select is((select count(*) from public.memberships where tenant_id = tests.tid('b')), 5::bigint,
  'dual: B membership rows are unchanged');
select is((select name from public.tenants where id = tests.tid('b')), 'Tenant B', 'dual: B name unchanged');

-- ----------------------------------------------- demotion in A does not touch B, and vice versa
select is(tests.rows_as(tests.uid('a_owner'), format(
  $$update public.memberships set role = 'viewer' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('dual'))), 1::bigint, 'setup: A owner demotes dual to viewer in A');
select is((select role::text from public.memberships where tenant_id = tests.tid('b') and user_id = tests.uid('dual')),
  'viewer', 'dual: role in B is unaffected by the change in A');
select is(tests.sqlstate_as(tests.uid('dual'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('a'), tests.uid('x2'))), '42501', 'dual: DENY writing A once demoted');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.audit_events where tenant_id = %L$$, tests.tid('a'))),
  0::bigint, 'dual: DENY reading A audit trail once demoted');
select is(tests.rows_as(tests.uid('dual'), format($$select 1 from public.memberships where tenant_id = %L$$, tests.tid('a'))),
  7::bigint, 'dual: still ALLOW reading A as a viewer');

-- Promotion in B does not leak into A either: promote dual to admin in B (as B's owner), then check A.
select is(tests.rows_as(tests.uid('b_owner'), format(
  $$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$,
  tests.tid('b'), tests.uid('dual'))), 1::bigint, 'setup: B owner promotes dual to admin in B');
select is(tests.sqlstate_as(tests.uid('dual'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('b'), tests.uid('x2'))), 'ok', 'dual: ALLOW adding a viewer to B once admin there');
select is(tests.sqlstate_as(tests.uid('dual'), format(
  $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
  tests.tid('a'), tests.uid('x3'))), '42501', 'dual: admin in B still gives nothing in A');
select is(tests.rows_as(tests.uid('dual'), format(
  $$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$,
  tests.tid('a'), tests.uid('dual'))), 0::bigint, 'dual: DENY promoting self in A');

select * from finish();
rollback;
