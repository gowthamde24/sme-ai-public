-- Shape of the T002 schema: tables, columns, enum, FKs, RLS switches, audit triggers.
begin;
select no_plan();

select has_schema('app', 'private app schema exists');

select has_table('public', 'tenants', 'tenants table exists');
select has_table('public', 'users', 'users (profile) table exists');
select has_table('public', 'memberships', 'memberships table exists');
select has_table('public', 'audit_events', 'audit_events table exists');

select enum_has_labels(
  'public', 'app_role', array['owner', 'admin', 'sales', 'viewer'],
  'app_role has exactly the four V1 roles'
);

-- tenants
select col_not_null('public', 'tenants', 'name', 'tenants.name not null');
select col_is_unique('public', 'tenants', 'slug', 'tenants.slug is unique');

-- users: profile only, no PII beyond a display name (email stays in auth.users)
select fk_ok('public', 'users', 'id', 'auth', 'users', 'id', 'users.id references auth.users');
select hasnt_column('public', 'users', 'email', 'profile does not duplicate email');
select has_column('public', 'users', 'display_name', 'users.display_name exists');

-- memberships
select fk_ok('public', 'memberships', 'tenant_id', 'public', 'tenants', 'id',
  'memberships.tenant_id references tenants');
select fk_ok('public', 'memberships', 'user_id', 'public', 'users', 'id',
  'memberships.user_id references users');
select col_not_null('public', 'memberships', 'role', 'memberships.role not null');
select col_type_is('public', 'memberships', 'role', 'public', 'app_role', 'memberships.role is app_role');
select is(
  (select count(*) from pg_constraint c
    where c.conrelid = 'public.memberships'::regclass and c.contype in ('p', 'u')
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['tenant_id', 'user_id']),
  1::bigint,
  'exactly one of PK/unique on (tenant_id, user_id): a user has one role per tenant'
);

-- audit_events: who/what/where plus before/after values
select col_not_null('public', 'audit_events', 'tenant_id', 'audit_events.tenant_id not null');
select has_column('public', 'audit_events', 'actor_user_id', 'audit_events.actor_user_id');
select has_column('public', 'audit_events', 'actor_type', 'audit_events.actor_type');
select has_column('public', 'audit_events', 'action', 'audit_events.action');
select has_column('public', 'audit_events', 'entity_type', 'audit_events.entity_type');
select has_column('public', 'audit_events', 'entity_id', 'audit_events.entity_id');
select has_column('public', 'audit_events', 'old_values', 'audit_events.old_values (before)');
select has_column('public', 'audit_events', 'new_values', 'audit_events.new_values (after)');
select has_column('public', 'audit_events', 'metadata', 'audit_events.metadata');
select has_column('public', 'audit_events', 'request_id', 'audit_events.request_id');
select has_column('public', 'audit_events', 'created_at', 'audit_events.created_at');
select fk_ok('public', 'audit_events', 'tenant_id', 'public', 'tenants', 'id',
  'audit_events.tenant_id references tenants');
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.audit_events'::regclass and contype = 'f'
      and confrelid = 'public.tenants'::regclass),
  'r',
  'audit_events FK to tenants is ON DELETE RESTRICT (history cannot be cascaded away)'
);

-- RLS is on and forced everywhere
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('tenants', 'users', 'memberships', 'audit_events')
      and c.relrowsecurity and c.relforcerowsecurity),
  4::bigint,
  'RLS is enabled AND forced on all four tables'
);

-- Functions the rest of the system depends on
select has_function('public', 'create_tenant', array['text', 'text'], 'public.create_tenant(text, text)');
select is_definer('public', 'create_tenant', array['text', 'text'], 'create_tenant is SECURITY DEFINER');
select has_function('app', 'is_tenant_member', array['uuid'], 'app.is_tenant_member(uuid)');
select has_function('app', 'has_tenant_role', array['uuid', 'app_role[]'], 'app.has_tenant_role(uuid, app_role[])');
select has_function('app', 'write_audit_event',
  array['uuid', 'text', 'text', 'uuid', 'jsonb', 'jsonb'], 'app.write_audit_event(...)');
select has_function('app', 'forbid_tenant_id_change', 'app.forbid_tenant_id_change()');

-- Triggers that make the guarantees non-bypassable by app code
select has_trigger('auth', 'users', 'on_auth_user_created', 'profile row is created on signup');
select has_trigger('public', 'tenants', 'audit_tenants', 'tenant changes are audited by the DB');
select has_trigger('public', 'memberships', 'audit_memberships', 'membership changes are audited by the DB');

select * from finish();
rollback;
