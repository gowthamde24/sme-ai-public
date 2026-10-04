-- Registry for the generic cross-tenant test (11_generic_tenant_tables.test.sql) and the guards in
-- 06_catalog_guards.test.sql. EVERY tenant-owned table (any public table with a tenant_id column)
-- must be registered here: an unregistered table is a failing guard. Future tickets append rows.
--
-- insert_sql / update_set / delete_sql are templates rendered with format():
--   %1$L tenant id   %2$L new row id   %3$L that tenant's base company   %4$L its base contact
--   %5$L a fresh unaffiliated user (for memberships)
-- insert_sql is both the privileged fixture builder and the "client insert" attempt.
-- update_set is a harmless self-assignment (exercises privilege + RLS without changing data).
create schema if not exists tests;

drop table if exists tests.role_matrix;
drop table if exists tests.tenant_table_registry;

create table tests.tenant_table_registry (
  table_name text primary key,
  insert_sql text not null,
  update_set text not null,
  delete_sql text not null,
  keyset_index_required boolean not null default true
);

create table tests.role_matrix (
  table_name  text not null references tests.tenant_table_registry (table_name),
  role        text not null check (role in ('owner', 'admin', 'sales', 'viewer')),
  can_select  boolean not null,
  can_insert  boolean not null,
  can_update  boolean not null,
  can_delete  boolean not null,
  primary key (table_name, role)
);

insert into tests.tenant_table_registry (table_name, insert_sql, update_set, delete_sql, keyset_index_required) values
  ('companies',
   $$insert into public.companies (id, tenant_id, name) values (%2$L, %1$L, 'Generic Co')$$,
   'name = name', $$delete from public.companies where id = %2$L$$, true),
  ('contacts',
   $$insert into public.contacts (id, tenant_id, company_id, full_name) values (%2$L, %1$L, %3$L, 'Generic Contact')$$,
   'full_name = full_name', $$delete from public.contacts where id = %2$L$$, true),
  ('products',
   $$insert into public.products (id, tenant_id, sku, name) values (%2$L, %1$L, 'G-' || left(%2$L, 8), 'Generic Product')$$,
   'name = name', $$delete from public.products where id = %2$L$$, true),
  ('leads',
   $$insert into public.leads (id, tenant_id, company_id, contact_id) values (%2$L, %1$L, %3$L, %4$L)$$,
   'status = status', $$delete from public.leads where id = %2$L$$, true),
  ('opportunities',
   $$insert into public.opportunities (id, tenant_id, company_id, contact_id, title) values (%2$L, %1$L, %3$L, %4$L, 'Generic Opp')$$,
   'title = title', $$delete from public.opportunities where id = %2$L$$, true),
  ('consent_events',
   $$insert into public.consent_events (id, tenant_id, contact_id, event_type, channel) values (%2$L, %1$L, %4$L, 'withdrawn', 'email')$$,
   'channel = channel', $$delete from public.consent_events where id = %2$L$$, true),
  -- T004. evidence_links builds its own evidence row in the same statement (a CTE) so that every
  -- generated insert is a new (company, evidence) pair; the link and the evidence share the id.
  ('evidence',
   $$insert into public.evidence (id, tenant_id, kind, provider, url, snippet) values (%2$L, %1$L, 'web_page', 'manual', 'https://example.test/generic', 'Generic snippet')$$,
   'archived_at = archived_at', $$delete from public.evidence where id = %2$L$$, true),
  ('evidence_links',
   $$with e as (insert into public.evidence (id, tenant_id, kind, provider, url) values (%2$L, %1$L, 'web_page', 'manual', 'https://example.test/generic-link') returning id)
     insert into public.evidence_links (id, tenant_id, evidence_id, company_id) select %2$L, %1$L, e.id, %3$L from e$$,
   'archived_at = archived_at', $$delete from public.evidence_links where id = %2$L$$, true),
  ('claims',
   $$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (%2$L, %1$L, %3$L, 'exports_to', 'Generic value', 'low')$$,
   'archived_at = archived_at', $$delete from public.claims where id = %2$L$$, true),
  ('memberships',
   $$insert into public.memberships (tenant_id, user_id, role) values (%1$L, %5$L, 'viewer')$$,
   'role = role', $$delete from public.memberships where tenant_id = %1$L and user_id = %5$L$$, false),
  ('audit_events',
   $$insert into public.audit_events (tenant_id, actor_type, action, entity_type) values (%1$L, 'system', 'test.generic', 'test')$$,
   'action = action', $$delete from public.audit_events where tenant_id = %1$L$$, false);

--                                           select insert update delete
insert into tests.role_matrix (table_name, role, can_select, can_insert, can_update, can_delete)
select t, r, s, i, u, d from (values
  -- Sales create/update; Viewer read-only; Admin/Owner the same plus archive (a column-level rule, tested in 13)
  ('companies',     'owner',  true, true,  true,  false), ('companies',     'admin',  true, true,  true,  false),
  ('companies',     'sales',  true, true,  true,  false), ('companies',     'viewer', true, false, false, false),
  ('contacts',      'owner',  true, true,  true,  false), ('contacts',      'admin',  true, true,  true,  false),
  ('contacts',      'sales',  true, true,  true,  false), ('contacts',      'viewer', true, false, false, false),
  ('leads',         'owner',  true, true,  true,  false), ('leads',         'admin',  true, true,  true,  false),
  ('leads',         'sales',  true, true,  true,  false), ('leads',         'viewer', true, false, false, false),
  ('opportunities', 'owner',  true, true,  true,  false), ('opportunities', 'admin',  true, true,  true,  false),
  ('opportunities', 'sales',  true, true,  true,  false), ('opportunities', 'viewer', true, false, false, false),
  -- Products: only Admin/Owner write
  ('products',      'owner',  true, true,  true,  false), ('products',      'admin',  true, true,  true,  false),
  ('products',      'sales',  true, false, false, false), ('products',      'viewer', true, false, false, false),
  -- Consent ledger: everyone reads; nobody writes directly (the SECURITY DEFINER functions do)
  ('consent_events','owner',  true, false, false, false), ('consent_events','admin',  true, false, false, false),
  ('consent_events','sales',  true, false, false, false), ('consent_events','viewer', true, false, false, false),
  -- T004 evidence model: everyone reads; Owner/Admin/Sales write; nobody deletes. (Archive is Admin+: a
  -- column-level rule tested in 19.) Content columns are not updatable by anybody (tested in 19).
  ('evidence',      'owner',  true, true,  true,  false), ('evidence',      'admin',  true, true,  true,  false),
  ('evidence',      'sales',  true, true,  true,  false), ('evidence',      'viewer', true, false, false, false),
  ('evidence_links','owner',  true, true,  true,  false), ('evidence_links','admin',  true, true,  true,  false),
  ('evidence_links','sales',  true, true,  true,  false), ('evidence_links','viewer', true, false, false, false),
  ('claims',        'owner',  true, true,  true,  false), ('claims',        'admin',  true, true,  true,  false),
  ('claims',        'sales',  true, true,  true,  false), ('claims',        'viewer', true, false, false, false),
  -- T002 tables
  ('memberships',   'owner',  true, true,  true,  true ), ('memberships',   'admin',  true, true,  true,  true ),
  ('memberships',   'sales',  true, false, false, false), ('memberships',   'viewer', true, false, false, false),
  ('audit_events',  'owner',  true, false, false, false), ('audit_events',  'admin',  true, false, false, false),
  ('audit_events',  'sales',  false, false, false, false), ('audit_events', 'viewer', false, false, false, false)
) as m(t, r, s, i, u, d);

select plan(1);
select pass('tenant table registry installed');
select * from finish();
