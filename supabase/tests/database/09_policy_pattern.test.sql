-- The tenant-list helpers behind every RLS policy (ADR 0004).
-- Contract: they NEVER return NULL; "nothing" is '{}', which matches no rows (fail closed).
begin;
select no_plan();
select tests.seed_two_tenants();

-- ------------------------------------------------------ no identity at all: '{}', not NULL
select is(app.my_tenant_ids(), '{}'::uuid[], 'my_tenant_ids(): no auth.uid() -> {} (not NULL)');
select is(app.my_tenant_ids_with_role(array['owner']::public.app_role[]), '{}'::uuid[],
  'my_tenant_ids_with_role(): no auth.uid() -> {}');
select is(app.my_co_member_ids(), '{}'::uuid[], 'my_co_member_ids(): no auth.uid() -> {}');

-- ----------------------------------------------- an identity with no tenant: still '{}'
select is(tests.scalar_as(tests.uid('outsider'), 'select app.my_tenant_ids()::text'), '{}',
  'outsider: my_tenant_ids() is the empty array');
select is(tests.scalar_as(tests.uid('outsider'), 'select (app.my_tenant_ids() is null)::text'), 'false',
  'outsider: my_tenant_ids() is not NULL');
select is(tests.scalar_as(tests.uid('outsider'),
  $$select (app.my_tenant_ids_with_role(array['owner','admin','sales','viewer']::public.app_role[]) is null)::text$$),
  'false', 'outsider: my_tenant_ids_with_role() is not NULL');
select is(tests.scalar_as(tests.uid('outsider'), 'select (app.my_co_member_ids() is null)::text'), 'false',
  'outsider: my_co_member_ids() is not NULL');

-- ------------------------------------------------------------------ whose tenants it lists
select is(tests.scalar_as(tests.uid('a_owner'), 'select cardinality(app.my_tenant_ids())::text'), '1',
  'a_owner: belongs to one tenant');
select is(tests.scalar_as(tests.uid('a_owner'),
  format('select (app.my_tenant_ids() = array[%L]::uuid[])::text', tests.tid('a'))), 'true',
  'a_owner: that tenant is A, nothing else');
select is(tests.scalar_as(tests.uid('dual'), 'select cardinality(app.my_tenant_ids())::text'), '2',
  'dual: belongs to two tenants');
select is(tests.scalar_as(tests.uid('dual'),
  format('select (app.my_tenant_ids() @> array[%L, %L]::uuid[])::text', tests.tid('a'), tests.tid('b'))),
  'true', 'dual: A and B');

-- ------------------------------------------------------------------ role filtering is exact
select is(tests.scalar_as(tests.uid('a_owner'),
  $$select cardinality(app.my_tenant_ids_with_role(array['owner']::public.app_role[]))::text$$), '1',
  'a_owner holds owner somewhere');
select is(tests.scalar_as(tests.uid('a_admin'),
  $$select cardinality(app.my_tenant_ids_with_role(array['owner']::public.app_role[]))::text$$), '0',
  'a_admin holds no owner role');
select is(tests.scalar_as(tests.uid('a_admin'),
  $$select cardinality(app.my_tenant_ids_with_role(array['owner','admin']::public.app_role[]))::text$$), '1',
  'a_admin holds admin');
select is(tests.scalar_as(tests.uid('a_viewer'),
  $$select cardinality(app.my_tenant_ids_with_role(array['owner','admin','sales']::public.app_role[]))::text$$),
  '0', 'a_viewer holds no write role');
select is(tests.scalar_as(tests.uid('dual'),
  format($$select (app.my_tenant_ids_with_role(array['owner']::public.app_role[]) = array[%L]::uuid[])::text$$, tests.tid('a'))),
  'true', 'dual: owner role -> only A');
select is(tests.scalar_as(tests.uid('dual'),
  format($$select (app.my_tenant_ids_with_role(array['viewer']::public.app_role[]) = array[%L]::uuid[])::text$$, tests.tid('b'))),
  'true', 'dual: viewer role -> only B (no carry-over from A)');
select is(tests.scalar_as(tests.uid('dual'),
  $$select cardinality(app.my_tenant_ids_with_role(array['admin','sales']::public.app_role[]))::text$$), '0',
  'dual: neither admin nor sales anywhere');
select is(tests.scalar_as(tests.uid('a_owner'), 'select app.my_tenant_ids_with_role(null)::text'), '{}',
  'NULL role list -> {} (not NULL, not everything)');
select is(tests.scalar_as(tests.uid('a_owner'), $$select app.my_tenant_ids_with_role('{}'::public.app_role[])::text$$), '{}',
  'empty role list -> {}');

-- ---------------------------------------------------------------------- co-members
select is(tests.scalar_as(tests.uid('a_viewer'), 'select cardinality(app.my_co_member_ids())::text'), '6',
  'a_viewer: 6 people in tenant A (including themself)');
select is(tests.scalar_as(tests.uid('dual'), 'select cardinality(app.my_co_member_ids())::text'), '10',
  'dual: 6 in A + 5 in B, counted once = 10');
select is(tests.scalar_as(tests.uid('outsider'), 'select cardinality(app.my_co_member_ids())::text'), '0',
  'outsider: no co-members');

-- --------------------------------------------------------- revocation is visible immediately
delete from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('a_sales');
select is(tests.scalar_as(tests.uid('a_sales'), 'select cardinality(app.my_tenant_ids())::text'), '0',
  'removing a membership removes the tenant from the list at once (no cached claims)');
select is(tests.rows_as(tests.uid('a_sales'), 'select 1 from public.tenants'), 0::bigint,
  '... and the policies stop matching with it');

-- ------------------------------------------------------------------------ plans + privileges
select ok(tests.explain_as(tests.uid('a_owner'), 'select * from public.tenants') like '%InitPlan%',
  'tenants: tenant list is an InitPlan');
select ok(tests.explain_as(tests.uid('a_owner'), 'select * from public.memberships') not like '%SubPlan%',
  'memberships: no per-row SubPlan');
select ok(tests.explain_as(tests.uid('a_owner'), 'select * from public.audit_events') not like '%SubPlan%',
  'audit_events: no per-row SubPlan');
select ok(tests.explain_as(tests.uid('a_owner'), 'select * from public.users') not like '%SubPlan%',
  'users: no per-row SubPlan');

select ok(has_function_privilege('authenticated', 'app.my_tenant_ids()', 'execute'), 'authenticated may call my_tenant_ids');
select ok(not has_function_privilege('anon', 'app.my_tenant_ids()', 'execute'), 'anon may not call my_tenant_ids');
select ok(not has_function_privilege('anon', 'app.my_tenant_ids_with_role(public.app_role[])', 'execute'),
  'anon may not call my_tenant_ids_with_role');
select ok(not has_function_privilege('anon', 'app.my_co_member_ids()', 'execute'), 'anon may not call my_co_member_ids');
select is_definer('app', 'my_tenant_ids', array[]::text[], 'my_tenant_ids is SECURITY DEFINER');
select is_definer('app', 'my_co_member_ids', array[]::text[], 'my_co_member_ids is SECURITY DEFINER');

-- retired helpers are gone; the one-row helpers remain for function bodies
select hasnt_function('app', 'shares_tenant_with', 'shares_tenant_with was retired');
select hasnt_function('app', 'current_user_id', 'current_user_id was retired');
select has_function('app', 'is_tenant_member', array['uuid'], 'is_tenant_member remains (one-row checks)');
select has_function('app', 'has_tenant_role', array['uuid', 'app_role[]'], 'has_tenant_role remains (one-row checks)');

select * from finish();
rollback;
