-- Catalog guards. These inspect the schema itself, so any table, view or function added by a later
-- ticket (T003+) is policed automatically: forget RLS on a new tenant-owned table and this fails.
begin;
select no_plan();

-- ---- every tenant-owned table (any public table with a tenant_id column)
create temp table tenant_tables as
select c.oid as relid, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
where n.nspname = 'public' and c.relkind = 'r';

select cmp_ok((select count(*) from tenant_tables), '>=', 2::bigint,
  'guard is not vacuous: tenant-owned tables were found');

select is(
  (select coalesce(string_agg(c.relname, ', '), '') from tenant_tables t
    join pg_class c on c.oid = t.relid where not c.relrowsecurity),
  '', 'every tenant-owned table has RLS enabled');
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from tenant_tables t
    join pg_class c on c.oid = t.relid where not c.relforcerowsecurity),
  '', 'every tenant-owned table has RLS FORCED');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = t.relid)),
  '', 'every tenant-owned table has at least one policy');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    join pg_attribute a on a.attrelid = t.relid and a.attname = 'tenant_id' where not a.attnotnull),
  '', 'tenant_id is NOT NULL on every tenant-owned table');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (
      select 1 from pg_constraint k
      where k.conrelid = t.relid and k.contype = 'f' and k.confrelid = 'public.tenants'::regclass
        and k.conkey = array[(select attnum from pg_attribute where attrelid = t.relid and attname = 'tenant_id')])),
  '', 'tenant_id is a foreign key to tenants on every tenant-owned table');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (
      select 1 from pg_index i
      where i.indrelid = t.relid
        and i.indkey[0] = (select attnum from pg_attribute where attrelid = t.relid and attname = 'tenant_id'))),
  '', 'tenant_id is the leading column of an index on every tenant-owned table');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (
      select 1 from pg_trigger g
      where g.tgrelid = t.relid and not g.tgisinternal
        and g.tgfoid = 'app.forbid_tenant_id_change()'::regprocedure)),
  '', 'tenant_id is immutable (trigger) on every tenant-owned table');

-- ---- RLS everywhere in public (a table without tenant_id still must not be open)
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)),
  '', 'every public table has RLS enabled and forced');

-- ---- policies: never granted to PUBLIC or anon
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and (roles = '{public}' or 'anon' = any (roles))),
  0::bigint, 'no policy applies to PUBLIC or anon');

-- ---- grants
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0::bigint, 'anon holds no table privileges in public');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0::bigint, 'authenticated holds no TRUNCATE/REFERENCES/TRIGGER in public');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name = 'audit_events'
      and privilege_type <> 'SELECT'),
  0::bigint, 'authenticated can only SELECT audit_events');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name = 'tenants'
      and privilege_type in ('INSERT', 'DELETE')),
  0::bigint, 'authenticated cannot INSERT/DELETE tenants directly');

-- future tables must not be auto-exposed: default privileges for the migration owner in public
select is(
  (select count(*) from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public' and d.defaclobjtype in ('r', 'S', 'f') and d.defaclrole = 'postgres'::regrole
      and exists (select 1 from aclexplode(d.defaclacl) x
                   where x.grantee = 0
                      or x.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid))),
  0::bigint, 'default privileges of the migration role do not auto-grant new tables/sequences/functions in public to anon, authenticated or PUBLIC');

-- ---- functions in public/app (excluding extension-owned)
create temp table our_functions as
select p.oid, p.oid::regprocedure::text as sig, n.nspname || '.' || p.proname as fq,
       p.prosecdef, p.proconfig, n.nspname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

select cmp_ok((select count(*) from our_functions), '>=', 5::bigint, 'guard is not vacuous: functions were found');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where prosecdef and not coalesce('search_path=""' = any (proconfig), false)),
  '', 'every SECURITY DEFINER function pins search_path to empty');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where has_function_privilege('anon', oid, 'execute')),
  '', 'anon can execute none of our functions');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where has_function_privilege('authenticated', oid, 'execute')
      and fq not in (
        'public.create_tenant',
        'app.current_user_id',
        'app.is_tenant_member',
        'app.has_tenant_role',
        'app.shares_tenant_with')),
  '', 'authenticated can execute only the allow-listed functions');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where nspname = 'public' and prosecdef and fq <> 'public.create_tenant'),
  '', 'the only SECURITY DEFINER function reachable through the API schema is create_tenant');

-- ---- views bypass RLS unless security_invoker
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  '', 'every public view is security_invoker (cannot bypass RLS)');

-- ---- the private schema stays private
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon has no USAGE on schema app');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'v', 'm', 'p')),
  0::bigint, 'schema app holds functions only: no tables or views to expose');

select * from finish();
rollback;
