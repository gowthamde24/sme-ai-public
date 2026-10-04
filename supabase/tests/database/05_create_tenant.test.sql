-- public.create_tenant(name, slug): the only way a client creates a tenant. Atomic (tenant + first
-- Owner membership), idempotent on retry, audited, and not a way to touch someone else's tenant.
begin;
select no_plan();
select tests.seed_two_tenants();

-- run as the outsider via the same helper used elsewhere, then inspect as the session user
select is(
  tests.sqlstate_as(tests.uid('outsider'), $$select public.create_tenant('Acme Silks', 'acme-silks')$$),
  'ok', 'ALLOW: authenticated user creates a tenant');

select is((select count(*) from public.tenants where slug = 'acme-silks'), 1::bigint, 'tenant row exists');
select is(
  (select m.role::text from public.memberships m join public.tenants t on t.id = m.tenant_id
    where t.slug = 'acme-silks' and m.user_id = tests.uid('outsider')),
  'owner', 'creator became the Owner in the same transaction');
select is(
  (select count(*) from public.memberships m join public.tenants t on t.id = m.tenant_id
    where t.slug = 'acme-silks'),
  1::bigint, 'creator is the only member');

select is(
  (select count(*) from public.audit_events a join public.tenants t on t.id = a.tenant_id
    where t.slug = 'acme-silks' and a.action = 'tenant.create' and a.actor_user_id = tests.uid('outsider')
      and a.actor_type = 'user'),
  1::bigint, 'tenant.create audited with the creator as actor');
select is(
  (select count(*) from public.audit_events a join public.tenants t on t.id = a.tenant_id
    where t.slug = 'acme-silks' and a.action = 'membership.create' and a.new_values ->> 'role' = 'owner'),
  1::bigint, 'first owner membership audited with role');

-- returns the created tenant to the caller
select is(
  tests.rows_as(tests.uid('outsider'), $$select (public.create_tenant('Acme Silks', 'acme-silks')).id$$),
  1::bigint, 'ALLOW: create_tenant returns the tenant row');

-- ----------------------------------------------------------------- idempotency
select is((select count(*) from public.tenants where slug = 'acme-silks'), 1::bigint,
  'retry did not create a second tenant');
select is(
  (select count(*) from public.memberships m join public.tenants t on t.id = m.tenant_id
    where t.slug = 'acme-silks'),
  1::bigint, 'retry did not duplicate the owner membership');
select is(
  (select count(*) from public.audit_events a join public.tenants t on t.id = a.tenant_id
    where t.slug = 'acme-silks' and a.action = 'tenant.create'),
  1::bigint, 'retry did not duplicate the audit event');

select is(
  tests.sqlstate_as(tests.uid('outsider'), $$select public.create_tenant('Different Name', 'acme-silks')$$),
  'ok', 'retry with a different name by the same owner is tolerated');
select is((select name from public.tenants where slug = 'acme-silks'), 'Acme Silks',
  'retry never overwrites an existing tenant');

-- ---------------------------------------------------------------- not a takeover vector
select is(
  tests.sqlstate_as(tests.uid('b_owner'), $$select public.create_tenant('Mine now', 'tenant-a')$$),
  '23505', 'DENY: claiming a slug that belongs to another tenant');
select is(
  (select count(*) from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('b_owner')),
  0::bigint, 'failed claim gave no membership in the other tenant');
select is(
  tests.sqlstate_as(tests.uid('a_admin'), $$select public.create_tenant('Mine now', 'tenant-a')$$),
  '23505', 'DENY: a non-owner member cannot "retry" their way into ownership');
select is((select name from public.tenants where id = tests.tid('a')), 'Tenant A', 'tenant A untouched');

-- the new tenant is private to its creator
select is(
  tests.rows_as(tests.uid('a_owner'), $$select 1 from public.tenants where slug = 'acme-silks'$$),
  0::bigint, 'other tenants cannot see the newly created tenant');
select is(
  tests.rows_as(tests.uid('outsider'), $$select 1 from public.tenants where slug = 'acme-silks'$$),
  1::bigint, 'creator can see it');

-- ---------------------------------------------------------------------- validation
select is(tests.sqlstate_as(tests.uid('x1'), $$select public.create_tenant('', 'okay-slug')$$),
  '22023', 'DENY: empty name');
select is(tests.sqlstate_as(tests.uid('x1'), $$select public.create_tenant('Name', 'Bad Slug!')$$),
  '22023', 'DENY: slug with uppercase/space/punctuation');
select is(tests.sqlstate_as(tests.uid('x1'), $$select public.create_tenant('Name', 'ab')$$),
  '22023', 'DENY: slug shorter than 3');
select is(tests.sqlstate_as(tests.uid('x1'), $$select public.create_tenant('Name', repeat('a', 41))$$),
  '22023', 'DENY: slug longer than 40');
select is(tests.sqlstate_as(tests.uid('x1'), $$select public.create_tenant(null, 'null-name')$$),
  '22023', 'DENY: null name');

select is(tests.sqlstate_as(null, $$select public.create_tenant('Anon', 'anon-co')$$),
  '42501', 'DENY: anon cannot create tenants');

select * from finish();
rollback;
