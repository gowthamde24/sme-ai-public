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
  -- T005. None of these tables is updated or deleted by anyone. import_batches / import_rows are written
  -- only by public.import_lead_rows, so no role may insert into them directly.
  ('icp_config_versions',
   $$insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config) values (%2$L, %1$L, 'icp-rules', 1, '{"factors":[{"id":"fit","max_points":100}],"bands":[]}'::jsonb)$$,
   'engine = engine', $$delete from public.icp_config_versions where id = %2$L$$, true),
  ('lead_labels',
   $$insert into public.lead_labels (id, tenant_id, lead_id, label) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'maybe')$$,
   'label = label', $$delete from public.lead_labels where id = %2$L$$, true),
  ('data_exports',
   $$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256) values (%2$L, %1$L, 'lead_labels', 'csv', 0, repeat('0', 64))$$,
   'format = format', $$delete from public.data_exports where id = %2$L$$, true),
  ('import_batches',
   $$insert into public.import_batches (id, tenant_id, content_sha256, row_count, rejected_count) values (%2$L, %1$L, repeat('1', 64), 1, 1)$$,
   'row_count = row_count', $$delete from public.import_batches where id = %2$L$$, true),
  ('import_rows',
   $$with b as (insert into public.import_batches (id, tenant_id, content_sha256, row_count, rejected_count) values (%2$L, %1$L, repeat('2', 64), 1, 1) returning id)
     insert into public.import_rows (id, tenant_id, batch_id, row_no, outcome, reason) select %2$L, %1$L, b.id, 1, 'rejected', 'invalid_row' from b$$,
   'row_no = row_no', $$delete from public.import_rows where id = %2$L$$, true),
  -- T006 (ADR 0013). Written only by SECURITY DEFINER functions: no role inserts, updates or deletes directly.
  -- tenant_agent_settings has one row per tenant, so its fixture builder is an upsert.
  ('tenant_agent_settings',
   $$insert into public.tenant_agent_settings (tenant_id, enabled) values (%1$L, true) on conflict (tenant_id) do update set enabled = true$$,
   'enabled = enabled', $$delete from public.tenant_agent_settings where tenant_id = %1$L$$, false),
  ('agent_runs',
   $$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
     values (%2$L, %1$L, %5$L, 'selftest', 'v1', %3$L, now() + interval '15 minutes', repeat('0', 64), '{}'::jsonb)$$,
   'status = status', $$delete from public.agent_runs where id = %2$L$$, true),
  ('agent_run_steps',
   $$with r as (insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
                values (%2$L, %1$L, %5$L, 'selftest', 'v1', %3$L, now() + interval '15 minutes', repeat('0', 64), '{}'::jsonb) returning id)
     insert into public.agent_run_steps (id, tenant_id, run_id, started_by, step_key, kind, status)
     select %2$L, %1$L, r.id, %5$L, 'step-' || left(%2$L, 8), 'tool_call', 'ok' from r$$,
   'status = status', $$delete from public.agent_run_steps where id = %2$L$$, true),
  ('erasure_requests',
   $$insert into public.erasure_requests (id, tenant_id, scope, requested_by, execute_after) values (%2$L, %1$L, 'tenant', %5$L, now())$$,
   'status = status', $$delete from public.erasure_requests where id = %2$L$$, true),
  ('tenant_data_policy',
   $$insert into public.tenant_data_policy (tenant_id) values (%1$L) on conflict (tenant_id) do nothing$$,
   'real_data_allowed = real_data_allowed', $$delete from public.tenant_data_policy where tenant_id = %1$L$$, false),
  ('claim_reviews',
   $$with c as (insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (%2$L, %1$L, %3$L, 'exports_to', 'Generic value', 'low') returning id)
     insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, self_review) select %2$L, %1$L, c.id, 'accepted', 'low', false from c$$,
   'decision = decision', $$delete from public.claim_reviews where id = %2$L$$, true),
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
  -- T005: everyone reads (data_exports: Owner / Admin only); ICP versions and exports are written by Owner / Admin,
  -- labels by Owner / Admin / Sales; import_batches / import_rows are written ONLY by the definer function.
  ('icp_config_versions','owner',  true, true,  false, false), ('icp_config_versions','admin',  true, true,  false, false),
  ('icp_config_versions','sales',  true, false, false, false), ('icp_config_versions','viewer', true, false, false, false),
  ('lead_labels',   'owner',  true, true,  false, false), ('lead_labels',   'admin',  true, true,  false, false),
  ('lead_labels',   'sales',  true, true,  false, false), ('lead_labels',   'viewer', true, false, false, false),
  ('data_exports',  'owner',  true, true,  false, false), ('data_exports',  'admin',  true, true,  false, false),
  ('data_exports',  'sales',  false, false, false, false), ('data_exports', 'viewer', false, false, false, false),
  ('import_batches','owner',  true, false, false, false), ('import_batches','admin',  true, false, false, false),
  ('import_batches','sales',  true, false, false, false), ('import_batches','viewer', true, false, false, false),
  ('import_rows',   'owner',  true, false, false, false), ('import_rows',   'admin',  true, false, false, false),
  ('import_rows',   'sales',  true, false, false, false), ('import_rows',   'viewer', true, false, false, false),
  -- T006: nobody writes directly. tenant_agent_settings and claim_reviews are readable by every member; agent_runs and
  -- agent_run_steps by Owner / Admin for every row (Sales and Viewer see only the runs they started: tested in 30).
  ('tenant_agent_settings','owner',  true, false, false, false), ('tenant_agent_settings','admin',  true, false, false, false),
  ('tenant_agent_settings','sales',  true, false, false, false), ('tenant_agent_settings','viewer', true, false, false, false),
  ('agent_runs',    'owner',  true, false, false, false), ('agent_runs',    'admin',  true, false, false, false),
  ('agent_runs',    'sales',  false, false, false, false), ('agent_runs',   'viewer', false, false, false, false),
  ('agent_run_steps','owner', true, false, false, false), ('agent_run_steps','admin', true, false, false, false),
  ('agent_run_steps','sales', false, false, false, false), ('agent_run_steps','viewer', false, false, false, false),
  -- T006b M1: the erasure log is read by Owner / Admin only and written by nobody directly.
  ('erasure_requests','owner', true, false, false, false), ('erasure_requests','admin', true, false, false, false),
  ('erasure_requests','sales', false, false, false, false), ('erasure_requests','viewer', false, false, false, false),
  -- T006b M2: every member reads the gate (the web shows "synthetic data only" while it is closed); nobody writes it from a request.
  ('tenant_data_policy','owner', true, false, false, false), ('tenant_data_policy','admin', true, false, false, false),
  ('tenant_data_policy','sales', true, false, false, false), ('tenant_data_policy','viewer', true, false, false, false),
  ('claim_reviews', 'owner',  true, false, false, false), ('claim_reviews', 'admin',  true, false, false, false),
  ('claim_reviews', 'sales',  true, false, false, false), ('claim_reviews', 'viewer', true, false, false, false),
  -- T002 tables
  ('memberships',   'owner',  true, true,  true,  true ), ('memberships',   'admin',  true, true,  true,  true ),
  ('memberships',   'sales',  true, false, false, false), ('memberships',   'viewer', true, false, false, false),
  ('audit_events',  'owner',  true, false, false, false), ('audit_events',  'admin',  true, false, false, false),
  ('audit_events',  'sales',  false, false, false, false), ('audit_events', 'viewer', false, false, false, false)
) as m(t, r, s, i, u, d);

select plan(1);
select pass('tenant table registry installed');
select * from finish();
