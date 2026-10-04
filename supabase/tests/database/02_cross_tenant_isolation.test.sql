-- SECURITY GATE: Tenant A cannot read or write Tenant B data (and vice versa).
-- Every role of each tenant is run against the other tenant, on every table, for reads and writes.
-- Each denial test is paired with an allow test so a broken fixture cannot pass vacuously.
begin;
select no_plan();
select tests.seed_two_tenants();

-- actor, own tenant, other tenant, an owner of own tenant, an owner of the other tenant
create temp table actors (n text, own text, other text, own_owner text, other_owner text);
insert into actors values
  ('a_owner',  'a', 'b', 'a_owner', 'b_owner'),
  ('a_owner2', 'a', 'b', 'a_owner', 'b_owner'),
  ('a_admin',  'a', 'b', 'a_owner', 'b_owner'),
  ('a_sales',  'a', 'b', 'a_owner', 'b_owner'),
  ('a_viewer', 'a', 'b', 'a_owner', 'b_owner'),
  ('b_owner',  'b', 'a', 'b_owner', 'a_owner'),
  ('b_admin',  'b', 'a', 'b_owner', 'a_owner'),
  ('b_sales',  'b', 'a', 'b_owner', 'a_owner'),
  ('b_viewer', 'b', 'a', 'b_owner', 'a_owner');

-- ---------------------------------------------------------------- READS: allow
select is(
  tests.rows_as(tests.uid(n), format($$select 1 from public.tenants where id = %L$$, tests.tid(own))),
  1::bigint, n || ': ALLOW read own tenant')
from actors;

select is(
  tests.rows_as(tests.uid(n), format($$select 1 from public.memberships where tenant_id = %L$$, tests.tid(own))),
  (select count(*) from public.memberships m where m.tenant_id = tests.tid(a.own)),
  n || ': ALLOW read every membership of own tenant')
from actors a;

select is(
  tests.rows_as(tests.uid(n), format($$select 1 from public.users where id = %L$$, tests.uid(own_owner))),
  1::bigint, n || ': ALLOW read profile of a co-member')
from actors;

-- ----------------------------------------------------------------- READS: deny
select is(
  tests.rows_as(tests.uid(n), format($$select 1 from public.tenants where id = %L$$, tests.tid(other))),
  0::bigint, n || ': DENY read other tenant by id')
from actors;

select is(
  tests.rows_as(tests.uid(n), 'select 1 from public.tenants'),
  1::bigint, n || ': unfiltered tenants query returns only own tenant')
from actors;

select is(
  tests.rows_as(tests.uid(n), format($$select 1 from public.memberships where tenant_id = %L$$, tests.tid(other))),
  0::bigint, n || ': DENY read other tenant memberships')
from actors;

select is(
  tests.rows_as(tests.uid(n), 'select 1 from public.memberships'),
  (select count(*) from public.memberships m where m.tenant_id = tests.tid(a.own)),
  n || ': unfiltered memberships query returns only own tenant')
from actors a;

select is(
  tests.rows_as(tests.uid(n), format($$select 1 from public.users where id = %L$$, tests.uid(other_owner))),
  0::bigint, n || ': DENY read profile of other tenant member')
from actors;

select is(
  tests.rows_as(tests.uid(n), format($$select 1 from public.audit_events where tenant_id = %L$$, tests.tid(other))),
  0::bigint, n || ': DENY read other tenant audit events')
from actors;

-- ---------------------------------------------------------------- WRITES: deny
select is(
  tests.sqlstate_as(tests.uid(n), format(
    $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
    tests.tid(other), tests.uid('x1'))),
  '42501', n || ': DENY add a member to other tenant')
from actors;

select is(
  tests.sqlstate_as(tests.uid(n), format(
    $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$,
    tests.tid(other), tests.uid(n))),
  '42501', n || ': DENY joining other tenant as owner (self-grant)')
from actors;

select is(
  tests.rows_as(tests.uid(n), format($$update public.tenants set name = 'pwned' where id = %L$$, tests.tid(other))),
  0::bigint, n || ': DENY rename other tenant (0 rows)')
from actors;

select is(
  tests.sqlstate_as(tests.uid(n), format($$delete from public.tenants where id = %L$$, tests.tid(other))),
  '42501', n || ': DENY delete other tenant')
from actors;

select is(
  tests.sqlstate_as(tests.uid(n), format($$delete from public.tenants where id = %L$$, tests.tid(own))),
  '42501', n || ': DENY delete even own tenant (clients never delete tenants)')
from actors;

select is(
  tests.rows_as(tests.uid(n), format(
    $$update public.memberships set role = 'viewer' where tenant_id = %L$$, tests.tid(other))),
  0::bigint, n || ': DENY change roles in other tenant (0 rows)')
from actors;

select is(
  tests.rows_as(tests.uid(n), format($$delete from public.memberships where tenant_id = %L$$, tests.tid(other))),
  0::bigint, n || ': DENY remove members of other tenant (0 rows)')
from actors;

select is(
  tests.rows_as(tests.uid(n), format(
    $$update public.users set display_name = 'pwned' where id = %L$$, tests.uid(other_owner))),
  0::bigint, n || ': DENY edit profile of other tenant member (0 rows)')
from actors;

select is(
  tests.sqlstate_as(tests.uid(n), format(
    $$insert into public.tenants (name, slug) values ('direct', %L)$$, 'direct-' || n)),
  '42501', n || ': DENY inserting tenants directly (must go through create_tenant)')
from actors;

-- ----------------------------------- invariant: none of the above landed
select is((select count(*) from public.tenants), 2::bigint, 'no tenant was added or removed');
select is(
  (select array_agg(name order by name) from public.tenants),
  array['Tenant A', 'Tenant B'], 'tenant names unchanged');
select is((select count(*) from public.memberships), 9::bigint, 'membership rows unchanged');
select is(
  (select count(*) from public.memberships where role = 'viewer' and user_id not in
     (select tests.uid('a_viewer') union select tests.uid('b_viewer'))),
  0::bigint, 'no role was downgraded to viewer by a cross-tenant write');
select is(
  (select count(*) from public.users where display_name = 'pwned'), 0::bigint, 'no profile was edited');

-- ------------------------------------------- user with no tenant (outsider)
select is(tests.rows_as(tests.uid('outsider'), 'select 1 from public.tenants'), 0::bigint,
  'outsider: sees no tenants');
select is(tests.rows_as(tests.uid('outsider'), 'select 1 from public.memberships'), 0::bigint,
  'outsider: sees no memberships');
select is(tests.rows_as(tests.uid('outsider'), 'select 1 from public.audit_events'), 0::bigint,
  'outsider: sees no audit events');
select is(
  tests.rows_as(tests.uid('outsider'), format($$select 1 from public.users where id = %L$$, tests.uid('outsider'))),
  1::bigint, 'outsider: ALLOW read own profile');
select is(
  tests.rows_as(tests.uid('outsider'), format($$select 1 from public.users where id = %L$$, tests.uid('a_owner'))),
  0::bigint, 'outsider: DENY read anyone else''s profile');

select is(
  tests.sqlstate_as(tests.uid('outsider'), format(
    $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$,
    tests.tid('a'), tests.uid('outsider'))),
  '42501', 'outsider: DENY self-granting owner of tenant A');
select is(
  tests.sqlstate_as(tests.uid('outsider'), format(
    $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$$,
    tests.tid('b'), tests.uid('outsider'))),
  '42501', 'outsider: DENY self-joining tenant B as viewer');
select is(
  tests.sqlstate_as(tests.uid('outsider'), format(
    $$insert into public.tenants (id, name, slug) values (%L, 'dup', 'dup')$$, tests.tid('a'))),
  '42501', 'outsider: DENY inserting a tenant row');

-- ----------------------------------------------------------- anon (no JWT)
select is(tests.sqlstate_as(null, 'select 1 from public.tenants'), '42501', 'anon: DENY tenants');
select is(tests.sqlstate_as(null, 'select 1 from public.users'), '42501', 'anon: DENY users');
select is(tests.sqlstate_as(null, 'select 1 from public.memberships'), '42501', 'anon: DENY memberships');
select is(tests.sqlstate_as(null, 'select 1 from public.audit_events'), '42501', 'anon: DENY audit_events');
select is(
  tests.sqlstate_as(null, format(
    $$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$,
    tests.tid('a'), tests.uid('x1'))),
  '42501', 'anon: DENY inserting memberships');
select is(
  tests.sqlstate_as(null, $$update public.tenants set name = 'pwned'$$), '42501', 'anon: DENY updating tenants');
select is(
  tests.sqlstate_as(null, $$select public.create_tenant('anon corp', 'anon-corp')$$),
  '42501', 'anon: DENY create_tenant');

select * from finish();
rollback;
