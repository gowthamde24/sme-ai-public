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
  -- T007 M2 / 3: the daily cost ledger. Owner / Admin read it, nobody writes it directly; never paginated.
  ('agent_cost_reservations',
   $$with r as (insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
                values (%2$L, %1$L, %5$L, 'selftest', 'v1', %3$L, now() + interval '15 minutes', repeat('0', 64), '{}'::jsonb) returning id)
     insert into public.agent_cost_reservations (id, tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, args_sha256)
     select %2$L, %1$L, r.id, 'usage-' || left(%2$L, 8), current_date, 1, 1, 1, repeat('0', 64) from r$$,
   'reserved_micros = reserved_micros', $$delete from public.agent_cost_reservations where id = %2$L$$, false),
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
  -- T008. Enquiries are inserted by Owner / Admin / Sales (already scrubbed: app.text_has_contact); requirements and their fields are written
  -- only by the definer functions, so no role inserts, updates or deletes them directly.
  ('enquiries',
   $$insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, subject, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Saree enquiry', 'Need 20 kanjivaram sarees by 15 November')$$,
   'archived_at = archived_at', $$delete from public.enquiries where id = %2$L$$, true),
  ('requirements',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id)
     insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e$$,
   'status = status', $$delete from public.requirements where id = %2$L$$, true),
  ('requirement_fields',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id)
     insert into public.requirement_fields (id, tenant_id, requirement_id, line_no, field_key, value_int, basis, certainty, quote, quote_start, quote_end) select %2$L, %1$L, r.id, 1, 'quantity', 20, 'piece', 'stated', '20 kanjivaram sarees', 5, 25 from r$$,
   'state = state', $$delete from public.requirement_fields where id = %2$L$$, true),
  -- T009 part 1. Reference-data versions are written ONLY by the definer functions (Owner / Admin + aal2); nobody updates or deletes them; a
  -- Viewer reads none of them. The fixtures build their parents inside one statement (a CTE chain).
  ('price_lists',
   $$insert into public.price_lists (id, tenant_id, name) values (%2$L, %1$L, 'Generic price list')$$,
   'name = name', $$delete from public.price_lists where id = %2$L$$, true),
  ('price_list_versions',
   $$with l as (insert into public.price_lists (id, tenant_id, name) values (%2$L, %1$L, 'Generic price list') returning id)
     insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256) select %2$L, %1$L, l.id, 1, current_date, 1, repeat('0', 64) from l$$,
   'version_no = version_no', $$delete from public.price_list_versions where id = %2$L$$, true),
  ('price_list_items',
   $$with l as (insert into public.price_lists (id, tenant_id, name) values (%2$L, %1$L, 'Generic price list') returning id),
          v as (insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256) select %2$L, %1$L, l.id, 1, current_date, 1, repeat('0', 64) from l returning id)
     insert into public.price_list_items (id, tenant_id, version_id, product_id, sku, name, unit_price_paise, minimum_order_quantity, tax_bps) select %2$L, %1$L, v.id, (select id from public.products where tenant_id = %1$L order by id limit 1), 'G-ITEM', 'Generic item', 1000, 1, 0 from v$$,
   'sku = sku', $$delete from public.price_list_items where id = %2$L$$, false),
  ('price_list_breaks',
   $$with l as (insert into public.price_lists (id, tenant_id, name) values (%2$L, %1$L, 'Generic price list') returning id),
          v as (insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256) select %2$L, %1$L, l.id, 1, current_date, 1, repeat('0', 64) from l returning id),
          i as (insert into public.price_list_items (id, tenant_id, version_id, product_id, sku, name, unit_price_paise, minimum_order_quantity, tax_bps) select %2$L, %1$L, v.id, (select id from public.products where tenant_id = %1$L order by id limit 1), 'G-ITEM', 'Generic item', 1000, 1, 0 from v returning id)
     insert into public.price_list_breaks (id, tenant_id, item_id, min_qty, unit_price_paise) select %2$L, %1$L, i.id, 5, 900 from i$$,
   'min_qty = min_qty', $$delete from public.price_list_breaks where id = %2$L$$, false),
  ('quote_policy_versions',
   $$insert into public.quote_policy_versions (id, tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps, validity_days, new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_rate_bps, gst_effective_from, seller_state, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.quote_policy_versions where tenant_id = %1$L), current_date, 0, 0, 0, 15, 0, 0, 30, 30, 500, current_date, 'TS', repeat('1', 64))$$,
   'version_no = version_no', $$delete from public.quote_policy_versions where id = %2$L$$, true),
  ('mapper_config_versions',
   $$insert into public.mapper_config_versions (id, tenant_id, version_no, effective_from, config, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.mapper_config_versions where tenant_id = %1$L), current_date, '{}'::jsonb, repeat('2', 64))$$,
   'version_no = version_no', $$delete from public.mapper_config_versions where id = %2$L$$, true),
  -- manual-price slice 1: written only by public.save_item_type (no client write grant)
  ('item_types',
   $$insert into public.item_types (id, tenant_id, code, name) values (%2$L, %1$L, 'G-' || left(%2$L, 8), 'Generic item type')$$,
   'name = name', $$delete from public.item_types where id = %2$L$$, true),
  -- T009 part 2. Picks are written by pick_requirement_line_product, quotes and lines by the quote functions: no role inserts, updates or deletes them
  -- directly, and a Viewer reads none of them. The fixtures build their parents in one statement (a CTE chain); the quote is REJECTED so that the
  -- partial unique indexes (one draft, one approved per requirement) never meet a second generic insert.
  ('requirement_line_picks',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id)
     insert into public.requirement_line_picks (id, tenant_id, requirement_id, line_no, product_id, qty, sale_unit, decided_by) select %2$L, %1$L, r.id, 1, (select id from public.products where tenant_id = %1$L order by id limit 1), 1, 'piece', %5$L from r$$,
   'qty = qty', $$delete from public.requirement_line_picks where id = %2$L$$, false),
  ('quotes',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          l as (insert into public.price_lists (id, tenant_id, name) values (%2$L, %1$L, 'Generic price list') returning id),
          v as (insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256) select %2$L, %1$L, l.id, 1, current_date, 1, repeat('0', 64) from l returning id),
          p as (insert into public.quote_policy_versions (id, tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps, validity_days, new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_rate_bps, gst_effective_from, seller_state, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.quote_policy_versions where tenant_id = %1$L), current_date, 0, 0, 0, 15, 0, 0, 30, 30, 500, current_date, 'TS', repeat('1', 64)) returning id)
     insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', v.id, p.id, '1.1.0', '{}', '{}', repeat('3', 64), 'new', 'TS', 'intra_state', current_date, current_date, current_date, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, v, p$$,
   'status = status', $$delete from public.quotes where id = %2$L$$, true),
  ('quote_lines',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          l as (insert into public.price_lists (id, tenant_id, name) values (%2$L, %1$L, 'Generic price list') returning id),
          v as (insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256) select %2$L, %1$L, l.id, 1, current_date, 1, repeat('0', 64) from l returning id),
          p as (insert into public.quote_policy_versions (id, tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps, validity_days, new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_rate_bps, gst_effective_from, seller_state, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.quote_policy_versions where tenant_id = %1$L), current_date, 0, 0, 0, 15, 0, 0, 30, 30, 500, current_date, 'TS', repeat('1', 64)) returning id),
          z as (insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', v.id, p.id, '1.1.0', '{}', '{}', repeat('3', 64), 'new', 'TS', 'intra_state', current_date, current_date, current_date, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, v, p returning id)
     insert into public.quote_lines (id, tenant_id, quote_id, line_no, requirement_line_no, product_id, sku, name, sale_unit, qty, unit_price_applied_paise, line_subtotal_paise, net_paise, tax_paise, gross_paise, tax_bps) select %2$L, %1$L, z.id, 1, 1, (select id from public.products where tenant_id = %1$L order by id limit 1), 'G-LINE', 'Generic line', 'piece', 1, 100, 100, 100, 5, 105, 500 from z$$,
   'sku = sku', $$delete from public.quote_lines where id = %2$L$$, false),
  -- Order conversion (ADR 0021). Policy versions, orders and events are written by the order functions: no role inserts, updates or deletes them directly, and a Viewer reads none of
  -- them. The fixtures build their parents in one statement (a CTE chain, as for quotes); the quote is REJECTED so the quote indexes never meet a second generic insert.
  ('order_policy_versions',
   $$insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.order_policy_versions where tenant_id = %1$L), current_date, true, true, 'in_preparation', false, repeat('4', 64))$$,
   'version_no = version_no', $$delete from public.order_policy_versions where id = %2$L$$, true),
  ('orders',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          l as (insert into public.price_lists (id, tenant_id, name) values (%2$L, %1$L, 'Generic price list') returning id),
          v as (insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256) select %2$L, %1$L, l.id, 1, current_date, 1, repeat('0', 64) from l returning id),
          p as (insert into public.quote_policy_versions (id, tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps, validity_days, new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_rate_bps, gst_effective_from, seller_state, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.quote_policy_versions where tenant_id = %1$L), current_date, 0, 0, 0, 15, 0, 0, 30, 30, 500, current_date, 'TS', repeat('1', 64)) returning id),
          z as (insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', v.id, p.id, '1.1.0', '{}', '{}', repeat('3', 64), 'new', 'TS', 'intra_state', current_date, current_date, current_date, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, v, p returning id),
          op as (insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.order_policy_versions where tenant_id = %1$L), current_date, true, true, 'in_preparation', false, repeat('4', 64)) returning id),
          o as (insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
                select %2$L, %1$L, (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = %1$L), z.id, e.id, r.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 0, 0, current_date, op.id from z, e, r, op returning id)
     select 1 from o$$,
   'state = state', $$delete from public.orders where id = %2$L$$, true),
  ('order_events',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          l as (insert into public.price_lists (id, tenant_id, name) values (%2$L, %1$L, 'Generic price list') returning id),
          v as (insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256) select %2$L, %1$L, l.id, 1, current_date, 1, repeat('0', 64) from l returning id),
          p as (insert into public.quote_policy_versions (id, tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps, validity_days, new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_rate_bps, gst_effective_from, seller_state, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.quote_policy_versions where tenant_id = %1$L), current_date, 0, 0, 0, 15, 0, 0, 30, 30, 500, current_date, 'TS', repeat('1', 64)) returning id),
          z as (insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', v.id, p.id, '1.1.0', '{}', '{}', repeat('3', 64), 'new', 'TS', 'intra_state', current_date, current_date, current_date, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, v, p returning id),
          op as (insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.order_policy_versions where tenant_id = %1$L), current_date, true, true, 'in_preparation', false, repeat('4', 64)) returning id),
          o as (insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
                select %2$L, %1$L, (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = %1$L), z.id, e.id, r.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 0, 0, current_date, op.id from z, e, r, op returning id)
     insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at) select %2$L, %1$L, o.id, 1, 'created', null, 'quote_approved', now() from o$$,
   'seq = seq', $$delete from public.order_events where id = %2$L$$, false),
  -- T010 part 2. Policy versions, touches, drafts and question drafts are written by the follow-up functions: no role inserts, updates or deletes them directly, and a Viewer reads none of them.
  ('followup_policy_versions',
   $$insert into public.followup_policy_versions (id, tenant_id, version_no, effective_from, gap_days, max_touches, quiet_start, quiet_end, allowed_weekdays, holidays, min_gap_hours, recipient_utc_offset_minutes, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.followup_policy_versions where tenant_id = %1$L), current_date, '{3}', 2, '21:00', '09:00', '{0,1,2,3,4,5}', '{}', 24, 330, repeat('0', 64))$$,
   'version_no = version_no', $$delete from public.followup_policy_versions where id = %2$L$$, true),
  ('lead_touches',
   $$insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'in', 'email', now())$$,
   'channel = channel', $$delete from public.lead_touches where id = %2$L$$, false),
  ('followup_drafts',
   $$with p as (insert into public.followup_policy_versions (id, tenant_id, version_no, effective_from, gap_days, max_touches, quiet_start, quiet_end, allowed_weekdays, holidays, min_gap_hours, recipient_utc_offset_minutes, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.followup_policy_versions where tenant_id = %1$L), current_date, '{3}', 2, '21:00', '09:00', '{0,1,2,3,4,5}', '{}', 24, 330, repeat('0', 64)) returning id),
          l as (select id, contact_id from public.leads where tenant_id = %1$L and contact_id is not null order by id limit 1)
     insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
     select %2$L, %1$L, l.id, l.contact_id, (select coalesce(max(touch_number), 1) + 1 from public.followup_drafts where tenant_id = %1$L), 'email', 'followup_gentle', 'Synthetic generic draft body text', p.id, '1.0.0', '{}', '{}', repeat('1', 64), repeat('2', 64), now() from p, l$$,
   'status = status', $$delete from public.followup_drafts where id = %2$L$$, true),
  ('question_drafts',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id)
     insert into public.question_drafts (id, tenant_id, requirement_id, line_no, question_code, question_text) select %2$L, %1$L, r.id, 0, 'missing_quantity', 'How many pieces do you need?' from r$$,
   'status = status', $$delete from public.question_drafts where id = %2$L$$, true),
  ('memberships',
   $$insert into public.memberships (tenant_id, user_id, role) values (%1$L, %5$L, 'viewer')$$,
   'role = role', $$delete from public.memberships where tenant_id = %1$L and user_id = %5$L$$, false),
  ('audit_events',
   $$insert into public.audit_events (tenant_id, actor_type, action, entity_type) values (%1$L, 'system', 'test.generic', 'test')$$,
   'action = action', $$delete from public.audit_events where tenant_id = %1$L$$, false);

--                                           select insert update delete
-- job AG: the Main agent's tables. A chat is private to the person who started it, so a fixture row made by an unaffiliated user is readable by no role.
insert into tests.tenant_table_registry (table_name, insert_sql, update_set, delete_sql, keyset_index_required) values
  -- job AT: the outbox. Written only by SECURITY DEFINER functions; the fixture builder inserts a message that waits for approval (the only states a row may start in besides queued and blocked).
  ('outbox_settings',
   $$insert into public.outbox_settings (tenant_id) values (%1$L) on conflict (tenant_id) do update set per_customer_daily_limit = 3$$,
   'per_customer_daily_limit = per_customer_daily_limit', $$delete from public.outbox_settings where tenant_id = %1$L$$, false),
  -- job CA: the shop's own GSTIN; one row per business, written only by public.business_profile_set
  ('business_profile',
   $$insert into public.business_profile (tenant_id, gstin) values (%1$L, null) on conflict (tenant_id) do update set gstin = null$$,
   'gstin = gstin', $$delete from public.business_profile where tenant_id = %1$L$$, false),
  -- job CK: custom fields. Definitions and values are written only by SECURITY DEFINER functions (no role inserts, updates or deletes directly); a value row is built with its own definition in the same statement
  ('custom_field_defs',
   $$insert into public.custom_field_defs (id, tenant_id, entity, code, label, kind, source) values (%2$L, %1$L, 'contact', 'g_' || left(replace(%2$L, '-', ''), 12), '{"en": "Generic field"}'::jsonb, 'text', 'owner')$$,
   'required = required', $$delete from public.custom_field_defs where id = %2$L$$, false),
  ('custom_field_values',
   $$with d as (insert into public.custom_field_defs (id, tenant_id, entity, code, label, kind, source) values (%2$L, %1$L, 'contact', 'v_' || left(replace(%2$L, '-', ''), 12), '{"en": "Generic value field"}'::jsonb, 'text', 'owner') returning id)
     insert into public.custom_field_values (id, tenant_id, field_id, entity, contact_id, value_text) select %2$L, %1$L, d.id, 'contact', %4$L, 'generic' from d$$,
   'entity = entity', $$delete from public.custom_field_values where id = %2$L$$, false),
  ('outbox_messages',
   $$insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by)
     select %2$L, %1$L, l.id, l.contact_id, 'whatsapp', 'Synthetic generic message', 'en', 'info', 'needs_approval', 'category_other', repeat('1', 64), %5$L
       from (select id, contact_id from public.leads where tenant_id = %1$L order by id limit 1) l$$,
   'status = status', $$delete from public.outbox_messages where id = %2$L$$, true),
  ('call_requests',
   $$insert into public.call_requests (id, tenant_id, lead_id, contact_id, reason, script_draft, language, request_sha256, requested_by)
     select %2$L, %1$L, l.id, l.contact_id, 'Synthetic reason', 'Synthetic script', 'en', repeat('2', 64), %5$L
       from (select id, contact_id from public.leads where tenant_id = %1$L order by id limit 1) l$$,
   'status = status', $$delete from public.call_requests where id = %2$L$$, true),
  -- job AS: store visits. Written only by SECURITY DEFINER functions; every member of the business reads.
  ('store_settings',
   $$insert into public.store_settings (tenant_id, weekly_hours) values (%1$L, app.visit_default_hours()) on conflict (tenant_id) do update set slot_minutes = 30$$,
   'slot_minutes = slot_minutes', $$delete from public.store_settings where tenant_id = %1$L$$, false),
  ('store_visits',
   $$insert into public.store_visits (id, tenant_id, lead_id, contact_id, visit_date, starts_at, ends_at, request_sha256, created_by)
     select %2$L, %1$L, l.id, l.contact_id, date '2026-10-06', timestamptz '2026-10-06 11:00+05:30', timestamptz '2026-10-06 11:30+05:30', repeat('6', 64), %5$L
       from (select id, contact_id from public.leads where tenant_id = %1$L order by id limit 1) l$$,
   'status = status', $$delete from public.store_visits where id = %2$L$$, true),
  -- job AW: the scheduler. Written only by SECURITY DEFINER functions (the worker's principal); Owner and Admin read (visit_reminders: Sales too).
  ('scheduler_settings',
   $$insert into public.scheduler_settings (tenant_id) values (%1$L) on conflict (tenant_id) do update set no_show_after_minutes = 30$$,
   'no_show_after_minutes = no_show_after_minutes', $$delete from public.scheduler_settings where tenant_id = %1$L$$, false),
  ('visit_reminders',
   $$insert into public.visit_reminders (id, tenant_id, visit_id, kind, for_starts_at, message_id)
     select %2$L, %1$L, v.id, 'heads_up', v.starts_at + make_interval(secs => mod(abs(hashtext(%2$L)), 1000000)), m.id
       from (select id, starts_at from public.store_visits where tenant_id = %1$L order by id limit 1) v, (select id from public.outbox_messages where tenant_id = %1$L order by id limit 1) m$$,
   'kind = kind', $$delete from public.visit_reminders where id = %2$L$$, false),
  ('scheduler_runs',
   $$insert into public.scheduler_runs (id, tenant_id, run_at, sent) values (%2$L, %1$L, timestamptz '2026-10-06 11:00+05:30', 1)$$,
   'sent = sent', $$delete from public.scheduler_runs where id = %2$L$$, false),
  -- job AY: the catalogue and the photos of a message. Written only by SECURITY DEFINER functions; every member reads the catalogue.
  ('catalogue_items',
   $$insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values (%2$L, %1$L, 'Synthetic saree', 'soft_silk', array['red'], '5k_10k', %5$L)$$,
   'name = name', $$delete from public.catalogue_items where id = %2$L$$, false),
  ('catalogue_photos',
   $$with i as (insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values (gen_random_uuid(), %1$L, 'Synthetic saree', 'soft_silk', array['red'], '5k_10k', %5$L) returning id)
     insert into public.catalogue_photos (id, tenant_id, item_id, position, bucket, path, thumb_path, width, height, bytes, thumb_bytes, created_by)
     select %2$L, %1$L, i.id, 1, app.catalogue_bucket(%1$L), i.id::text || '/' || %2$L || '.jpg', i.id::text || '/' || %2$L || '_t.jpg', 640, 640, 1000, 100, %5$L from i$$,
   'position = position', $$delete from public.catalogue_photos where id = %2$L$$, false),
  -- job BB: the events of a message. Written only by the trigger on the message row; the fixture row is a step on the tenant's first message.
  ('outbox_events',
   $$with m as (insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by)
                select gen_random_uuid(), %1$L, l.id, l.contact_id, 'whatsapp', 'Synthetic generic message', 'en', 'info', 'needs_approval', 'category_other', repeat('1', 64), %5$L
                  from (select id, contact_id from public.leads where tenant_id = %1$L order by id limit 1) l returning id)
     insert into public.outbox_events (id, tenant_id, message_id, kind, at, actor_kind) select %2$L, %1$L, m.id, 'queued', timestamptz '2026-10-06 11:00+05:30', 'system' from m$$,
   'kind = kind', $$delete from public.outbox_events where id = %2$L$$, false),
  ('outbox_message_media',
   $$with i as (insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values (gen_random_uuid(), %1$L, 'Synthetic saree', 'soft_silk', array['red'], '5k_10k', %5$L) returning id),
          ph as (select gen_random_uuid() as pid),
          p as (insert into public.catalogue_photos (id, tenant_id, item_id, position, bucket, path, thumb_path, width, height, bytes, thumb_bytes, created_by)
                select ph.pid, %1$L, i.id, 1, app.catalogue_bucket(%1$L), i.id::text || '/' || ph.pid::text || '.jpg', i.id::text || '/' || ph.pid::text || '_t.jpg', 640, 640, 1000, 100, %5$L from i, ph returning id),
          m as (insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by)
                select gen_random_uuid(), %1$L, l.id, l.contact_id, 'whatsapp', 'Synthetic generic message', 'en', 'info', 'needs_approval', 'category_other', repeat('1', 64), %5$L
                  from (select id, contact_id from public.leads where tenant_id = %1$L order by id limit 1) l returning id)
     insert into public.outbox_message_media (id, tenant_id, message_id, photo_id, position) select %2$L, %1$L, m.id, p.id, 1 from m, p$$,
   'position = position', $$delete from public.outbox_message_media where id = %2$L$$, false),
  ('assistant_conversations',
   $$insert into public.assistant_conversations (id, tenant_id, created_by) values (%2$L, %1$L, %5$L)$$,
   'updated_at = updated_at', $$delete from public.assistant_conversations where id = %2$L$$, true),
  ('assistant_messages',
   $$with c as (insert into public.assistant_conversations (id, tenant_id, created_by) values (%2$L, %1$L, %5$L) returning id)
     insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, created_by) select %2$L, %1$L, c.id, 1, 'user', 'Generic question', %5$L from c$$,
   'body = body', $$delete from public.assistant_messages where id = %2$L$$, true),
  ('assistant_reply_drafts',
   $$with c as (insert into public.assistant_conversations (id, tenant_id, created_by) values (%2$L, %1$L, %5$L) returning id),
          r as (insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, conversation_id, expires_at, input_sha256) select %2$L, %1$L, %5$L, 'assistant', 'assistant-1', c.id, now() + interval '15 minutes', repeat('a', 64) from c returning id)
     insert into public.assistant_reply_drafts (id, tenant_id, conversation_id, run_id, lead_id, language, body, gloss_en, created_by)
       select %2$L, %1$L, %2$L, r.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'en', 'Thank you for your enquiry', 'Thank you for your enquiry', %5$L from r$$,
   'status = status', $$delete from public.assistant_reply_drafts where id = %2$L$$, true),
  -- job CN: sites, dues, material quotes and deliveries. Written only by definer functions: no role inserts, updates or deletes directly. The modules that guard them are OFF for the default pack the
  -- fixture tenants run, so 11 and 12 call tests.cn_guards_off() first (their own rules are proved in 96 to 99).
  ('customer_sites',
   $$insert into public.customer_sites (id, tenant_id, company_id, name, created_by) values (%2$L, %1$L, %3$L, 'Generic site', %5$L)$$,
   'name = name', $$delete from public.customer_sites where id = %2$L$$, true),
  -- job CP: the shared ledger (accounts and entries) replaced CN's two tables; each builder makes its own company so the one-account-per-party rule is never hit
  ('ledger_accounts',
   $$with c as (insert into public.companies (id, tenant_id, name) values (%2$L, %1$L, 'Ledger Co') returning id)
     insert into public.ledger_accounts (id, tenant_id, company_id) select %2$L, %1$L, c.id from c$$,
   'company_id = company_id', $$delete from public.ledger_accounts where id = %2$L$$, false),
  ('ledger_entries',
   $$with c as (insert into public.companies (id, tenant_id, name) values (%2$L, %1$L, 'Ledger Co') returning id),
          a as (insert into public.ledger_accounts (id, tenant_id, company_id) select %2$L, %1$L, c.id from c returning id)
     insert into public.ledger_entries (id, tenant_id, account_id, kind, direction, amount_paise, entry_date, due_date, invoice_no, source, recorded_by)
       select %2$L, %1$L, a.id, 'charge', 'debit', 1000, date '2026-10-01', date '2026-10-31', 'G-' || left(%2$L, 8), 'manual', %5$L from a$$,
   'amount_paise = amount_paise', $$delete from public.ledger_entries where id = %2$L$$, false),
  -- job CP: campaigns, their lists and steps, and the call list. Written only by definer functions; the modules that guard them are OFF for the default pack of the fixture tenants (tests 11 and 12 call
  -- tests.cn_guards_off() first); their own rules are proved in 100 to 103.
  ('campaigns',
   $$insert into public.campaigns (id, tenant_id, name, kind, language, message_text, steps, created_by) values (%2$L, %1$L, 'Generic campaign', 'payment_due', 'en', 'Payment of {{amount}} is due on {{due_date}}', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, %5$L)$$,
   'name = name', $$delete from public.campaigns where id = %2$L$$, true),
  ('campaign_recipients',
   $$with cmp as (insert into public.campaigns (id, tenant_id, name, kind, language, message_text, steps, created_by) values (%2$L, %1$L, 'Generic campaign', 'payment_due', 'en', 'Payment of {{amount}} is due on {{due_date}}', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, %5$L) returning id)
     insert into public.campaign_recipients (id, tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, row_hash, created_by)
       select %2$L, %1$L, cmp.id, %4$L, (select l.id from public.leads l where l.tenant_id = %1$L order by l.id limit 1), date '2026-10-01', 1000, repeat('a', 64), %5$L from cmp$$,
   'row_hash = row_hash', $$delete from public.campaign_recipients where id = %2$L$$, false),
  ('campaign_steps',
   $$with cmp as (insert into public.campaigns (id, tenant_id, name, kind, language, message_text, steps, created_by) values (%2$L, %1$L, 'Generic campaign', 'payment_due', 'en', 'Payment of {{amount}} is due on {{due_date}}', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, %5$L) returning id),
          rcp as (insert into public.campaign_recipients (id, tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, row_hash, created_by)
                    select %2$L, %1$L, cmp.id, %4$L, (select l.id from public.leads l where l.tenant_id = %1$L order by l.id limit 1), date '2026-10-01', 1000, repeat('a', 64), %5$L from cmp returning id)
     insert into public.campaign_steps (id, tenant_id, campaign_id, recipient_id, step_no, scheduled_for) select %2$L, %1$L, cmp.id, rcp.id, 1, now() + interval '1 day' from cmp, rcp$$,
   'step_no = step_no', $$delete from public.campaign_steps where id = %2$L$$, false),
  ('call_list_items',
   $$with cmp as (insert into public.campaigns (id, tenant_id, name, kind, language, message_text, steps, created_by) values (%2$L, %1$L, 'Generic campaign', 'payment_due', 'en', 'Payment of {{amount}} is due on {{due_date}}', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, %5$L) returning id),
          ld as (select l.id as lead_id from public.leads l where l.tenant_id = %1$L order by l.id limit 1),
          rcp as (insert into public.campaign_recipients (id, tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, row_hash, created_by)
                    select %2$L, %1$L, cmp.id, %4$L, ld.lead_id, date '2026-10-01', 1000, repeat('a', 64), %5$L from cmp, ld returning id),
          cr as (insert into public.call_requests (id, tenant_id, lead_id, contact_id, reason, script_draft, language, request_sha256, requested_by)
                   select %2$L, %1$L, ld.lead_id, %4$L, 'Generic reason', 'Generic script', 'en', repeat('b', 64), %5$L from ld returning id)
     insert into public.call_list_items (id, tenant_id, campaign_id, recipient_id, call_request_id, lead_id, contact_id, step_no)
       select %2$L, %1$L, cmp.id, rcp.id, cr.id, ld.lead_id, %4$L, 1 from cmp, rcp, cr, ld$$,
   'attempts = attempts', $$delete from public.call_list_items where id = %2$L$$, true),
  -- job DP part 4: call settings (one workspace row, optional campaign overrides) and the hand-over rules; written only by the Owner's functions, no module guard (every business type has calls)
  ('call_settings',
   $$insert into public.call_settings (id, tenant_id, campaign_id, settings, updated_by) values (%2$L, %1$L, null, '{}'::jsonb, %5$L) on conflict (tenant_id) where campaign_id is null do nothing$$,
   'settings = settings', $$delete from public.call_settings where tenant_id = %1$L$$, false),
  ('call_handover_rules',
   $$insert into public.call_handover_rules (id, tenant_id, topic, person_name, phone, updated_by) values (%2$L, %1$L, 'other', 'Generic Person', '+917000000001', %5$L) on conflict (tenant_id, topic) do nothing$$,
   'topic = topic', $$delete from public.call_handover_rules where tenant_id = %1$L$$, false),
  -- job DM: the AI assistant's settings (one row per workspace; written only by the Owner's function)
  ('assistant_settings',
   $$insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media, may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute) values (%1$L, 'Generic', 'female_warm', 'te', true, true, 'warm', 1, true, true, true, true, 0, true, true, array[1], 540, 600) on conflict (tenant_id) do nothing$$,
   'max_discount_percent = max_discount_percent', $$delete from public.assistant_settings where tenant_id = %1$L$$, false),
  -- job DM: outcomes (written only by the definer functions; no module guard, like the billing tables)
  ('outcomes',
   $$insert into public.outcomes (id, tenant_id, contact_id, kind, source_id, outcome, category, recorded_by_kind, recorded_by, occurred_at) values (%2$L, %1$L, %4$L, 'call', %2$L, 'unclear', null, 'person', %5$L, now())$$,
   'outcome = outcome', $$delete from public.outcomes where id = %2$L$$, false),
  -- job CR: the education pack. Written only by definer functions; the modules that guard them (programmes, fees) are OFF for the default pack of the fixture tenants (tests 11 and 12 call
  -- tests.cn_guards_off() first); their own rules are proved in 104 to 107.
  ('institution_profiles',
   $$insert into public.institution_profiles (tenant_id, institution_type, year_start_month, parent_languages, created_by) values (%1$L, 'school', 6, array['en'], %5$L) on conflict (tenant_id) do nothing$$,
   'institution_type = institution_type', $$delete from public.institution_profiles where tenant_id = %1$L$$, false),
  ('programmes',
   $$insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (%2$L, %1$L, 'Generic ' || left(%2$L, 8), 'class', 'section', %5$L)$$,
   'name = name', $$delete from public.programmes where id = %2$L$$, true),
  ('programme_groups',
   $$with p as (insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (%2$L, %1$L, 'Generic ' || left(%2$L, 8), 'class', 'section', %5$L) returning id)
     insert into public.programme_groups (id, tenant_id, programme_id, label, created_by) select %2$L, %1$L, p.id, 'G', %5$L from p$$,
   'label = label', $$delete from public.programme_groups where id = %2$L$$, true),
  ('students',
   $$with p as (insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (%2$L, %1$L, 'Generic ' || left(%2$L, 8), 'class', 'section', %5$L) returning id)
     insert into public.students (id, tenant_id, contact_id, programme_id, child_label, created_by) select %2$L, %1$L, %4$L, p.id, 'Generic', %5$L from p$$,
   'status = status', $$delete from public.students where id = %2$L$$, true),
  ('admissions',
   $$insert into public.admissions (id, tenant_id, lead_id, contact_id, source, created_by) select %2$L, %1$L, (select l.id from public.leads l where l.tenant_id = %1$L order by l.id limit 1), %4$L, 'other', %5$L$$,
   'stage = stage', $$delete from public.admissions where id = %2$L$$, true),
  ('admission_events',
   $$with a as (insert into public.admissions (id, tenant_id, lead_id, contact_id, source, created_by) select %2$L, %1$L, (select l.id from public.leads l where l.tenant_id = %1$L order by l.id limit 1), %4$L, 'other', %5$L returning id)
     insert into public.admission_events (id, tenant_id, admission_id, stage) select %2$L, %1$L, a.id, 'enquiry' from a$$,
   'stage = stage', $$delete from public.admission_events where id = %2$L$$, true),
  ('fee_plans',
   $$with p as (insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (%2$L, %1$L, 'Generic ' || left(%2$L, 8), 'class', 'section', %5$L) returning id)
     insert into public.fee_plans (id, tenant_id, name, programme_id, academic_year, created_by) select %2$L, %1$L, 'Generic ' || left(%2$L, 8), p.id, '2026-27', %5$L from p$$,
   'name = name', $$delete from public.fee_plans where id = %2$L$$, true),
  ('fee_plan_lines',
   $$with p as (insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (%2$L, %1$L, 'Generic ' || left(%2$L, 8), 'class', 'section', %5$L) returning id),
          fp as (insert into public.fee_plans (id, tenant_id, name, programme_id, academic_year, created_by) select %2$L, %1$L, 'Generic ' || left(%2$L, 8), p.id, '2026-27', %5$L from p returning id),
          g as (select set_config('app.fee_plan_edit', %2$L, true))
     insert into public.fee_plan_lines (id, tenant_id, plan_id, head, instalment_no, due_date, amount_paise) select %2$L, %1$L, fp.id, 'tuition', 1, date '2026-10-31', 1000 from fp, g$$,
   'head = head', $$delete from public.fee_plan_lines where id = %2$L$$, true),
  ('fee_assignments',
   $$with p as (insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (%2$L, %1$L, 'Generic ' || left(%2$L, 8), 'class', 'section', %5$L) returning id),
          s as (insert into public.students (id, tenant_id, contact_id, programme_id, child_label, created_by) select %2$L, %1$L, %4$L, p.id, 'Generic', %5$L from p returning id),
          fp as (insert into public.fee_plans (id, tenant_id, name, programme_id, academic_year, created_by) select %2$L, %1$L, 'Generic ' || left(%2$L, 8), (select id from p), '2026-27', %5$L returning id)
     insert into public.fee_assignments (id, tenant_id, student_id, plan_id, academic_year, assigned_on, assigned_by) select %2$L, %1$L, s.id, fp.id, '2026-27', date '2026-10-01', %5$L from s, fp$$,
   'academic_year = academic_year', $$delete from public.fee_assignments where id = %2$L$$, true),
  -- job CV: voice notes. Written only by definer functions; the module that guards them (voice_notes) is OFF for the default pack of the fixture tenants (tests 11 and 12 call tests.cn_guards_off() first).
  ('voice_settings',
   $$insert into public.voice_settings (tenant_id) values (%1$L) on conflict (tenant_id) do nothing$$,
   'speed = speed', $$delete from public.voice_settings where tenant_id = %1$L$$, false),
  ('voice_choices',
   $$insert into public.voice_choices (tenant_id, language, voice_code) values (%1$L, 'en', 'fake-en') on conflict do nothing$$,
   'voice_code = voice_code', $$delete from public.voice_choices where tenant_id = %1$L$$, false),
  ('campaign_voice',
   $$with cmp as (insert into public.campaigns (id, tenant_id, name, kind, language, message_text, steps, created_by) values (%2$L, %1$L, 'Generic campaign', 'payment_due', 'en', 'Payment of {{amount}} is due on {{due_date}}', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, %5$L) returning id)
     insert into public.campaign_voice (id, tenant_id, campaign_id) select %2$L, %1$L, cmp.id from cmp$$,
   'enabled = enabled', $$delete from public.campaign_voice where id = %2$L$$, false),
  ('voice_note_usage',
   $$insert into public.voice_note_usage (tenant_id, ref_id, kind, seconds, chars, voice_code, language) values (%1$L, %2$L, 'note', 5, 50, 'fake-en', 'en')$$,
   'seconds = seconds', $$delete from public.voice_note_usage where ref_id = %2$L$$, false),
  -- job DI: plans and billing. Written only by definer functions (the owner starts a trial and cancels; the channel account records call seconds and applies provider events); read by Owner and Admin.
  ('billing_subscriptions',
   $$insert into public.billing_subscriptions (tenant_id, plan_id, catalogue_version, status, provider, provider_ref, payment_method_on_file, trial_started_at, trial_ends_at) values (%1$L, 'growth', 1, 'trialing', 'fake', 'sub_fake_generic', true, now(), now() + interval '30 days') on conflict (tenant_id) do nothing$$,
   'status = status', $$delete from public.billing_subscriptions where tenant_id = %1$L$$, false),
  ('billing_events',
   $$insert into public.billing_events (tenant_id, event_id, kind, at) values (%1$L, 'ev_' || %2$L, 'trial_started', now())$$,
   'kind = kind', $$delete from public.billing_events where event_id = 'ev_' || %2$L$$, false),
  ('billing_usage_events',
   $$insert into public.billing_usage_events (tenant_id, kind, ref_id, units) values (%1$L, 'call_minutes', %2$L, 60)$$,
   'units = units', $$delete from public.billing_usage_events where ref_id = %2$L$$, false),
  ('billing_topups',
   $$insert into public.billing_topups (tenant_id, id, kind, units) values (%1$L, %2$L, 'call_minutes', 5)$$,
   'units = units', $$delete from public.billing_topups where id = %2$L$$, false),
  ('billing_lapse_reminders',
   $$insert into public.billing_lapse_reminders (tenant_id, day) values (%1$L, 30) on conflict do nothing$$,
   'day = day', $$delete from public.billing_lapse_reminders where tenant_id = %1$L$$, false),
  ('billing_pending_reminders',
   $$insert into public.billing_pending_reminders (tenant_id, day) values (%1$L, 30) on conflict do nothing$$,
   'day = day', $$delete from public.billing_pending_reminders where tenant_id = %1$L$$, false),
  ('billing_notices',
   $$insert into public.billing_notices (tenant_id, kind, level, period_start) values (%1$L, 'call_minutes', 80, date '2026-10-01') on conflict do nothing$$,
   'level = level', $$delete from public.billing_notices where tenant_id = %1$L$$, false),
  ('customer_credit_limits',
   $$insert into public.customer_credit_limits (id, tenant_id, company_id, limit_paise, set_by) values (%2$L, %1$L, %3$L, 100000, %5$L) on conflict (tenant_id, company_id) do nothing$$,
   'limit_paise = limit_paise', $$delete from public.customer_credit_limits where id = %2$L$$, false),
  ('material_quote_policies',
   $$insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.material_quote_policies where tenant_id = %1$L), current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb, repeat('5', 64))$$,
   'version_no = version_no', $$delete from public.material_quote_policies where id = %2$L$$, false),
  ('material_quotes',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          mp as (insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.material_quote_policies where tenant_id = %1$L), current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb, repeat('5', 64)) returning id),
          mq as (insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips, material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.material_quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', mp.id, '1.0.0', '{}', '{}', repeat('6', 64), current_date, current_date, 1, 0, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, mp returning id)
     select 1 from mq$$,
   'status = status', $$delete from public.material_quotes where id = %2$L$$, true),
  ('material_quote_lines',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          mp as (insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.material_quote_policies where tenant_id = %1$L), current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb, repeat('5', 64)) returning id),
          mq as (insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips, material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.material_quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', mp.id, '1.0.0', '{}', '{}', repeat('6', 64), current_date, current_date, 1, 0, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, mp returning id),
          ci as (insert into public.catalogue_items (id, tenant_id, name, item_kind, sell_unit, area_unit, created_by) values (%2$L, %1$L, 'Generic material', 'material', 'sq_ft', 'sq_ft', %5$L) returning id),
          ql as (insert into public.material_quote_lines (id, tenant_id, quote_id, line_no, catalogue_item_id, name, mode, sold_per, unit_price_paise, gst_bps, billed_quantity, material_paise, tax_paise)
                select %2$L, %1$L, mq.id, 1, ci.id, 'Generic material', 'direct', 'bag', 0, 0, 0, 0, 0 from mq, ci returning id)
     select 1 from ql$$,
   'name = name', $$delete from public.material_quote_lines where id = %2$L$$, false),
  ('delivery_trips',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          mp as (insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.material_quote_policies where tenant_id = %1$L), current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb, repeat('5', 64)) returning id),
          mq as (insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips, material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.material_quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', mp.id, '1.0.0', '{}', '{}', repeat('6', 64), current_date, current_date, 1, 0, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, mp returning id),
          op as (insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.order_policy_versions where tenant_id = %1$L), current_date, true, true, 'in_preparation', false, repeat('4', 64)) returning id),
          o as (insert into public.orders (id, tenant_id, order_no, quote_id, material_quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
                select %2$L, %1$L, (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = %1$L), null, mq.id, e.id, r.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 0, 0, current_date, op.id from mq, e, r, op returning id),
          t as (insert into public.delivery_trips (id, tenant_id, order_id, trip_no, challan_no, planned_date, created_by)
                select %2$L, %1$L, o.id, 1, (select coalesce(max(challan_no), 0) + 1 from public.delivery_trips where tenant_id = %1$L), current_date, %5$L from o returning id)
     select 1 from t$$,
   'status = status', $$delete from public.delivery_trips where id = %2$L$$, true),
  ('delivery_trip_lines',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          mp as (insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.material_quote_policies where tenant_id = %1$L), current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb, repeat('5', 64)) returning id),
          mq as (insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips, material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.material_quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', mp.id, '1.0.0', '{}', '{}', repeat('6', 64), current_date, current_date, 1, 0, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, mp returning id),
          ci as (insert into public.catalogue_items (id, tenant_id, name, item_kind, sell_unit, area_unit, created_by) values (%2$L, %1$L, 'Generic material', 'material', 'sq_ft', 'sq_ft', %5$L) returning id),
          ql as (insert into public.material_quote_lines (id, tenant_id, quote_id, line_no, catalogue_item_id, name, mode, sold_per, unit_price_paise, gst_bps, billed_quantity, material_paise, tax_paise)
                select %2$L, %1$L, mq.id, 1, ci.id, 'Generic material', 'direct', 'bag', 0, 0, 0, 0, 0 from mq, ci returning id),
          op as (insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.order_policy_versions where tenant_id = %1$L), current_date, true, true, 'in_preparation', false, repeat('4', 64)) returning id),
          o as (insert into public.orders (id, tenant_id, order_no, quote_id, material_quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
                select %2$L, %1$L, (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = %1$L), null, mq.id, e.id, r.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 0, 0, current_date, op.id from mq, e, r, op returning id),
          t as (insert into public.delivery_trips (id, tenant_id, order_id, trip_no, challan_no, planned_date, created_by)
                select %2$L, %1$L, o.id, 1, (select coalesce(max(challan_no), 0) + 1 from public.delivery_trips where tenant_id = %1$L), current_date, %5$L from o returning id)
     insert into public.delivery_trip_lines (id, tenant_id, trip_id, quote_line_id, quantity) select %2$L, %1$L, t.id, ql.id, 1 from t, ql$$,
   'quantity = quantity', $$delete from public.delivery_trip_lines where id = %2$L$$, false),
  ('delivery_trip_events',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          mp as (insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.material_quote_policies where tenant_id = %1$L), current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb, repeat('5', 64)) returning id),
          mq as (insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips, material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.material_quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', mp.id, '1.0.0', '{}', '{}', repeat('6', 64), current_date, current_date, 1, 0, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, mp returning id),
          op as (insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.order_policy_versions where tenant_id = %1$L), current_date, true, true, 'in_preparation', false, repeat('4', 64)) returning id),
          o as (insert into public.orders (id, tenant_id, order_no, quote_id, material_quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
                select %2$L, %1$L, (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = %1$L), null, mq.id, e.id, r.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 0, 0, current_date, op.id from mq, e, r, op returning id),
          t as (insert into public.delivery_trips (id, tenant_id, order_id, trip_no, challan_no, planned_date, created_by)
                select %2$L, %1$L, o.id, 1, (select coalesce(max(challan_no), 0) + 1 from public.delivery_trips where tenant_id = %1$L), current_date, %5$L from o returning id)
     insert into public.delivery_trip_events (id, tenant_id, trip_id, seq, to_status) select %2$L, %1$L, t.id, 1, 'planned' from t$$,
   'seq = seq', $$delete from public.delivery_trip_events where id = %2$L$$, false),
  ('delivery_proofs',
   $$with e as (insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (%2$L, %1$L, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'email', now() - interval '1 hour', 'Need 20 kanjivaram sarees') returning id),
          r as (insert into public.requirements (id, tenant_id, enquiry_id) select %2$L, %1$L, e.id from e returning id),
          mp as (insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.material_quote_policies where tenant_id = %1$L), current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb, repeat('5', 64)) returning id),
          mq as (insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips, material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
                select %2$L, %1$L, (select coalesce(max(quote_no), 0) + 1 from public.material_quotes where tenant_id = %1$L), r.id, e.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 'rejected', mp.id, '1.0.0', '{}', '{}', repeat('6', 64), current_date, current_date, 1, 0, 0, 0, 0, 0, 0, 0, 0, false, %5$L, now(), 'other' from e, r, mp returning id),
          op as (insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256) values (%2$L, %1$L, (select coalesce(max(version_no), 0) + 1 from public.order_policy_versions where tenant_id = %1$L), current_date, true, true, 'in_preparation', false, repeat('4', 64)) returning id),
          o as (insert into public.orders (id, tenant_id, order_no, quote_id, material_quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
                select %2$L, %1$L, (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = %1$L), null, mq.id, e.id, r.id, (select id from public.leads where tenant_id = %1$L order by id limit 1), 0, 0, current_date, op.id from mq, e, r, op returning id),
          t as (insert into public.delivery_trips (id, tenant_id, order_id, trip_no, challan_no, planned_date, created_by)
                select %2$L, %1$L, o.id, 1, (select coalesce(max(challan_no), 0) + 1 from public.delivery_trips where tenant_id = %1$L), current_date, %5$L from o returning id)
     insert into public.delivery_proofs (id, trip_id, tenant_id, received_by, photo_id, bucket, path, width, height, bytes, recorded_by) select %2$L, t.id, %1$L, 'Generic receiver', %2$L, app.pod_bucket(%1$L), t.id::text || '/' || %2$L::text || '.jpg', 640, 640, 1000, %5$L from t$$,
   'received_by = received_by', $$delete from public.delivery_proofs where id = %2$L$$, false);

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
  ('agent_cost_reservations','owner', true, false, false, false), ('agent_cost_reservations','admin', true, false, false, false),
  ('agent_cost_reservations','sales', false, false, false, false), ('agent_cost_reservations','viewer', false, false, false, false),
  -- T006b M1: the erasure log is read by Owner / Admin only and written by nobody directly.
  ('erasure_requests','owner', true, false, false, false), ('erasure_requests','admin', true, false, false, false),
  ('erasure_requests','sales', false, false, false, false), ('erasure_requests','viewer', false, false, false, false),
  -- T006b M2: every member reads the gate (the web shows "synthetic data only" while it is closed); nobody writes it from a request.
  ('tenant_data_policy','owner', true, false, false, false), ('tenant_data_policy','admin', true, false, false, false),
  ('tenant_data_policy','sales', true, false, false, false), ('tenant_data_policy','viewer', true, false, false, false),
  ('claim_reviews', 'owner',  true, false, false, false), ('claim_reviews', 'admin',  true, false, false, false),
  ('claim_reviews', 'sales',  true, false, false, false), ('claim_reviews', 'viewer', true, false, false, false),
  -- T008: everyone reads; Owner / Admin / Sales capture an enquiry (and Owner / Admin archive it); requirements and fields are written only by definer functions.
  ('enquiries',     'owner',  true, true,  true,  false), ('enquiries',     'admin',  true, true,  true,  false),
  ('enquiries',     'sales',  true, true,  true,  false), ('enquiries',     'viewer', true, false, false, false),
  ('requirements',  'owner',  true, false, false, false), ('requirements',  'admin',  true, false, false, false),
  ('requirements',  'sales',  true, false, false, false), ('requirements',  'viewer', true, false, false, false),
  ('requirement_fields','owner', true, false, false, false), ('requirement_fields','admin', true, false, false, false),
  ('requirement_fields','sales', true, false, false, false), ('requirement_fields','viewer', true, false, false, false),
  -- T009 part 1: Owner / Admin / Sales read; a Viewer reads none of the prices, policies or mapper config; nobody writes directly.
  ('price_lists',          'owner', true, false, false, false), ('price_lists',          'admin', true, false, false, false),
  ('price_lists',          'sales', true, false, false, false), ('price_lists',          'viewer', false, false, false, false),
  ('price_list_versions',  'owner', true, false, false, false), ('price_list_versions',  'admin', true, false, false, false),
  ('price_list_versions',  'sales', true, false, false, false), ('price_list_versions',  'viewer', false, false, false, false),
  ('price_list_items',     'owner', true, false, false, false), ('price_list_items',     'admin', true, false, false, false),
  ('price_list_items',     'sales', true, false, false, false), ('price_list_items',     'viewer', false, false, false, false),
  ('price_list_breaks',    'owner', true, false, false, false), ('price_list_breaks',    'admin', true, false, false, false),
  ('price_list_breaks',    'sales', true, false, false, false), ('price_list_breaks',    'viewer', false, false, false, false),
  ('quote_policy_versions','owner', true, false, false, false), ('quote_policy_versions','admin', true, false, false, false),
  ('quote_policy_versions','sales', true, false, false, false), ('quote_policy_versions','viewer', false, false, false, false),
  ('mapper_config_versions','owner', true, false, false, false), ('mapper_config_versions','admin', true, false, false, false),
  ('mapper_config_versions','sales', true, false, false, false), ('mapper_config_versions','viewer', false, false, false, false),
  ('item_types',          'owner', true, false, false, false), ('item_types',          'admin', true, false, false, false),
  ('item_types',          'sales', true, false, false, false), ('item_types',          'viewer', false, false, false, false),
  -- T009 part 2: Owner / Admin / Sales read picks, quotes and lines; a Viewer reads no price and no total; nobody writes directly.
  ('requirement_line_picks','owner', true, false, false, false), ('requirement_line_picks','admin', true, false, false, false),
  ('requirement_line_picks','sales', true, false, false, false), ('requirement_line_picks','viewer', false, false, false, false),
  ('quotes',               'owner', true, false, false, false), ('quotes',               'admin', true, false, false, false),
  ('quotes',               'sales', true, false, false, false), ('quotes',               'viewer', false, false, false, false),
  ('quote_lines',          'owner', true, false, false, false), ('quote_lines',          'admin', true, false, false, false),
  ('quote_lines',          'sales', true, false, false, false), ('quote_lines',          'viewer', false, false, false, false),
  -- Order conversion: Owner / Admin / Sales read; a Viewer reads no amount; nobody writes directly.
  ('order_policy_versions','owner', true, false, false, false), ('order_policy_versions','admin', true, false, false, false),
  ('order_policy_versions','sales', true, false, false, false), ('order_policy_versions','viewer', false, false, false, false),
  ('orders',               'owner', true, false, false, false), ('orders',               'admin', true, false, false, false),
  ('orders',               'sales', true, false, false, false), ('orders',               'viewer', false, false, false, false),
  ('order_events',         'owner', true, false, false, false), ('order_events',         'admin', true, false, false, false),
  ('order_events',         'sales', true, false, false, false), ('order_events',         'viewer', false, false, false, false),
  -- T010 part 2: Owner / Admin / Sales read; a Viewer reads none of it; nobody writes directly.
  ('followup_policy_versions','owner', true, false, false, false), ('followup_policy_versions','admin', true, false, false, false),
  ('followup_policy_versions','sales', true, false, false, false), ('followup_policy_versions','viewer', false, false, false, false),
  ('lead_touches',         'owner', true, false, false, false), ('lead_touches',         'admin', true, false, false, false),
  ('lead_touches',         'sales', true, false, false, false), ('lead_touches',         'viewer', false, false, false, false),
  ('followup_drafts',      'owner', true, false, false, false), ('followup_drafts',      'admin', true, false, false, false),
  ('followup_drafts',      'sales', true, false, false, false), ('followup_drafts',      'viewer', false, false, false, false),
  ('question_drafts',      'owner', true, false, false, false), ('question_drafts',      'admin', true, false, false, false),
  ('question_drafts',      'sales', true, false, false, false), ('question_drafts',      'viewer', false, false, false, false),
  -- job AG: the Main agent. Private to the person who started the chat; nobody writes directly.
  ('assistant_conversations','owner', false, false, false, false), ('assistant_conversations','admin', false, false, false, false),
  ('assistant_conversations','sales', false, false, false, false), ('assistant_conversations','viewer', false, false, false, false),
  ('assistant_messages',    'owner', false, false, false, false), ('assistant_messages',    'admin', false, false, false, false),
  ('assistant_messages',    'sales', false, false, false, false), ('assistant_messages',    'viewer', false, false, false, false),
  ('assistant_reply_drafts','owner', false, false, false, false), ('assistant_reply_drafts','admin', false, false, false, false),
  ('assistant_reply_drafts','sales', false, false, false, false), ('assistant_reply_drafts','viewer', false, false, false, false),
  -- job AT: the outbox, its settings and call requests. Owner / Admin / Sales read; a Viewer reads none (a message can hold a price); nobody writes directly.
  ('outbox_settings',      'owner', true, false, false, false), ('outbox_settings',      'admin', true, false, false, false),
  ('outbox_settings',      'sales', true, false, false, false), ('outbox_settings',      'viewer', false, false, false, false),
  ('business_profile',     'owner', true, false, false, false), ('business_profile',     'admin', true, false, false, false),
  ('business_profile',     'sales', true, false, false, false), ('business_profile',     'viewer', true, false, false, false),
  -- job CK: every member reads the definitions; the values are read directly by Owner / Admin / Sales (a Viewer reads them through public.custom_values_get, which hides the personal ones); nobody writes directly
  ('custom_field_defs',    'owner', true, false, false, false), ('custom_field_defs',    'admin', true, false, false, false),
  ('custom_field_defs',    'sales', true, false, false, false), ('custom_field_defs',    'viewer', true, false, false, false),
  ('custom_field_values',  'owner', true, false, false, false), ('custom_field_values',  'admin', true, false, false, false),
  ('custom_field_values',  'sales', true, false, false, false), ('custom_field_values',  'viewer', false, false, false, false),
  ('outbox_messages',      'owner', true, false, false, false), ('outbox_messages',      'admin', true, false, false, false),
  ('outbox_messages',      'sales', true, false, false, false), ('outbox_messages',      'viewer', false, false, false, false),
  ('call_requests',        'owner', true, false, false, false), ('call_requests',        'admin', true, false, false, false),
  ('call_requests',        'sales', true, false, false, false), ('call_requests',        'viewer', false, false, false, false),
  -- job AS: store visits and their hours. Every member reads (Today shows who is coming to anyone who may read leads); nobody writes directly.
  ('store_settings',       'owner', true, false, false, false), ('store_settings',       'admin', true, false, false, false),
  ('store_settings',       'sales', true, false, false, false), ('store_settings',       'viewer', true, false, false, false),
  ('store_visits',         'owner', true, false, false, false), ('store_visits',         'admin', true, false, false, false),
  ('store_visits',         'sales', true, false, false, false), ('store_visits',         'viewer', true, false, false, false),
  ('catalogue_items',      'owner', true, false, false, false), ('catalogue_items',      'admin', true, false, false, false),
  ('catalogue_items',      'sales', true, false, false, false), ('catalogue_items',      'viewer', true, false, false, false),
  ('catalogue_photos',     'owner', true, false, false, false), ('catalogue_photos',     'admin', true, false, false, false),
  ('catalogue_photos',     'sales', true, false, false, false), ('catalogue_photos',     'viewer', true, false, false, false),
  ('outbox_events',       'owner', true, false, false, false), ('outbox_events',       'admin', true, false, false, false),
  ('outbox_events',       'sales', true, false, false, false), ('outbox_events',       'viewer', false, false, false, false),
  ('outbox_message_media', 'owner', true, false, false, false), ('outbox_message_media', 'admin', true, false, false, false),
  ('outbox_message_media', 'sales', true, false, false, false), ('outbox_message_media', 'viewer', false, false, false, false),
  ('scheduler_settings',   'owner', true, false, false, false), ('scheduler_settings',   'admin', true, false, false, false),
  ('scheduler_settings',   'sales', false, false, false, false), ('scheduler_settings',   'viewer', false, false, false, false),
  ('visit_reminders',      'owner', true, false, false, false), ('visit_reminders',      'admin', true, false, false, false),
  ('visit_reminders',      'sales', true, false, false, false), ('visit_reminders',      'viewer', false, false, false, false),
  ('scheduler_runs',       'owner', true, false, false, false), ('scheduler_runs',       'admin', true, false, false, false),
  ('scheduler_runs',       'sales', false, false, false, false), ('scheduler_runs',       'viewer', false, false, false, false),
  -- job CN: money and delivery tables are read by Owner / Admin / Sales (a Viewer reads none); the sites are read by every member; nobody writes directly.
  ('customer_sites', 'owner', true, false, false, false), ('customer_sites', 'admin', true, false, false, false),
  ('customer_sites', 'sales', true, false, false, false), ('customer_sites', 'viewer', true, false, false, false),
  ('ledger_accounts', 'owner', true, false, false, false), ('ledger_accounts', 'admin', true, false, false, false),
  ('ledger_accounts', 'sales', true, false, false, false), ('ledger_accounts', 'viewer', false, false, false, false),
  ('ledger_entries', 'owner', true, false, false, false), ('ledger_entries', 'admin', true, false, false, false),
  ('ledger_entries', 'sales', true, false, false, false), ('ledger_entries', 'viewer', false, false, false, false),
  ('campaigns', 'owner', true, false, false, false), ('campaigns', 'admin', true, false, false, false),
  ('campaigns', 'sales', true, false, false, false), ('campaigns', 'viewer', false, false, false, false),
  ('campaign_recipients', 'owner', true, false, false, false), ('campaign_recipients', 'admin', true, false, false, false),
  ('campaign_recipients', 'sales', true, false, false, false), ('campaign_recipients', 'viewer', false, false, false, false),
  ('campaign_steps', 'owner', true, false, false, false), ('campaign_steps', 'admin', true, false, false, false),
  ('campaign_steps', 'sales', true, false, false, false), ('campaign_steps', 'viewer', false, false, false, false),
  ('call_list_items', 'owner', true, false, false, false), ('call_list_items', 'admin', true, false, false, false),
  ('call_list_items', 'sales', true, false, false, false), ('call_list_items', 'viewer', false, false, false, false),
  ('call_settings', 'owner', true, false, false, false), ('call_settings', 'admin', true, false, false, false),
  ('call_settings', 'sales', false, false, false, false), ('call_settings', 'viewer', false, false, false, false),
  ('call_handover_rules', 'owner', true, false, false, false), ('call_handover_rules', 'admin', true, false, false, false),
  ('call_handover_rules', 'sales', false, false, false, false), ('call_handover_rules', 'viewer', false, false, false, false),
  ('assistant_settings', 'owner', true, false, false, false), ('assistant_settings', 'admin', true, false, false, false),
  ('assistant_settings', 'sales', false, false, false, false), ('assistant_settings', 'viewer', false, false, false, false),
  ('outcomes', 'owner', true, false, false, false), ('outcomes', 'admin', true, false, false, false),
  ('outcomes', 'sales', true, false, false, false), ('outcomes', 'viewer', true, false, false, false),
  ('customer_credit_limits', 'owner', true, false, false, false), ('customer_credit_limits', 'admin', true, false, false, false),
  ('customer_credit_limits', 'sales', true, false, false, false), ('customer_credit_limits', 'viewer', false, false, false, false),
  ('material_quote_policies', 'owner', true, false, false, false), ('material_quote_policies', 'admin', true, false, false, false),
  ('material_quote_policies', 'sales', true, false, false, false), ('material_quote_policies', 'viewer', false, false, false, false),
  ('material_quotes', 'owner', true, false, false, false), ('material_quotes', 'admin', true, false, false, false),
  ('material_quotes', 'sales', true, false, false, false), ('material_quotes', 'viewer', false, false, false, false),
  ('material_quote_lines', 'owner', true, false, false, false), ('material_quote_lines', 'admin', true, false, false, false),
  ('material_quote_lines', 'sales', true, false, false, false), ('material_quote_lines', 'viewer', false, false, false, false),
  ('delivery_trips', 'owner', true, false, false, false), ('delivery_trips', 'admin', true, false, false, false),
  ('delivery_trips', 'sales', true, false, false, false), ('delivery_trips', 'viewer', false, false, false, false),
  ('delivery_trip_lines', 'owner', true, false, false, false), ('delivery_trip_lines', 'admin', true, false, false, false),
  ('delivery_trip_lines', 'sales', true, false, false, false), ('delivery_trip_lines', 'viewer', false, false, false, false),
  ('delivery_trip_events', 'owner', true, false, false, false), ('delivery_trip_events', 'admin', true, false, false, false),
  ('delivery_trip_events', 'sales', true, false, false, false), ('delivery_trip_events', 'viewer', false, false, false, false),
  ('delivery_proofs', 'owner', true, false, false, false), ('delivery_proofs', 'admin', true, false, false, false),
  ('delivery_proofs', 'sales', true, false, false, false), ('delivery_proofs', 'viewer', false, false, false, false),
  -- job CR: the programmes and the profile are read by every member; the students, the admissions and the fee tables (children and money) only by Owner / Admin / Sales; nobody writes directly.
  ('institution_profiles', 'owner', true, false, false, false), ('institution_profiles', 'admin', true, false, false, false),
  ('institution_profiles', 'sales', true, false, false, false), ('institution_profiles', 'viewer', true, false, false, false),
  ('programmes', 'owner', true, false, false, false), ('programmes', 'admin', true, false, false, false),
  ('programmes', 'sales', true, false, false, false), ('programmes', 'viewer', true, false, false, false),
  ('programme_groups', 'owner', true, false, false, false), ('programme_groups', 'admin', true, false, false, false),
  ('programme_groups', 'sales', true, false, false, false), ('programme_groups', 'viewer', true, false, false, false),
  ('students', 'owner', true, false, false, false), ('students', 'admin', true, false, false, false),
  ('students', 'sales', true, false, false, false), ('students', 'viewer', false, false, false, false),
  ('admissions', 'owner', true, false, false, false), ('admissions', 'admin', true, false, false, false),
  ('admissions', 'sales', true, false, false, false), ('admissions', 'viewer', false, false, false, false),
  ('admission_events', 'owner', true, false, false, false), ('admission_events', 'admin', true, false, false, false),
  ('admission_events', 'sales', true, false, false, false), ('admission_events', 'viewer', false, false, false, false),
  ('fee_plans', 'owner', true, false, false, false), ('fee_plans', 'admin', true, false, false, false),
  ('fee_plans', 'sales', true, false, false, false), ('fee_plans', 'viewer', false, false, false, false),
  ('fee_plan_lines', 'owner', true, false, false, false), ('fee_plan_lines', 'admin', true, false, false, false),
  ('fee_plan_lines', 'sales', true, false, false, false), ('fee_plan_lines', 'viewer', false, false, false, false),
  ('fee_assignments', 'owner', true, false, false, false), ('fee_assignments', 'admin', true, false, false, false),
  ('fee_assignments', 'sales', true, false, false, false), ('fee_assignments', 'viewer', false, false, false, false),
  -- job CV: the voice settings, choices, campaign switch and ledger are read by Owner and Admin; nobody writes directly.
  ('voice_settings', 'owner', true, false, false, false), ('voice_settings', 'admin', true, false, false, false),
  ('voice_settings', 'sales', false, false, false, false), ('voice_settings', 'viewer', false, false, false, false),
  ('voice_choices', 'owner', true, false, false, false), ('voice_choices', 'admin', true, false, false, false),
  ('voice_choices', 'sales', false, false, false, false), ('voice_choices', 'viewer', false, false, false, false),
  ('campaign_voice', 'owner', true, false, false, false), ('campaign_voice', 'admin', true, false, false, false),
  ('campaign_voice', 'sales', false, false, false, false), ('campaign_voice', 'viewer', false, false, false, false),
  ('voice_note_usage', 'owner', true, false, false, false), ('voice_note_usage', 'admin', true, false, false, false),
  ('voice_note_usage', 'sales', false, false, false, false), ('voice_note_usage', 'viewer', false, false, false, false),
  -- job DI: the billing tables are read by Owner and Admin; nobody writes directly.
  ('billing_subscriptions', 'owner', true, false, false, false), ('billing_subscriptions', 'admin', true, false, false, false),
  ('billing_subscriptions', 'sales', false, false, false, false), ('billing_subscriptions', 'viewer', false, false, false, false),
  ('billing_events', 'owner', true, false, false, false), ('billing_events', 'admin', true, false, false, false),
  ('billing_events', 'sales', false, false, false, false), ('billing_events', 'viewer', false, false, false, false),
  ('billing_usage_events', 'owner', true, false, false, false), ('billing_usage_events', 'admin', true, false, false, false),
  ('billing_usage_events', 'sales', false, false, false, false), ('billing_usage_events', 'viewer', false, false, false, false),
  ('billing_topups', 'owner', true, false, false, false), ('billing_topups', 'admin', true, false, false, false),
  ('billing_topups', 'sales', false, false, false, false), ('billing_topups', 'viewer', false, false, false, false),
  ('billing_lapse_reminders', 'owner', true, false, false, false), ('billing_lapse_reminders', 'admin', true, false, false, false),
  ('billing_lapse_reminders', 'sales', false, false, false, false), ('billing_lapse_reminders', 'viewer', false, false, false, false),
  ('billing_pending_reminders', 'owner', true, false, false, false), ('billing_pending_reminders', 'admin', true, false, false, false),
  ('billing_pending_reminders', 'sales', false, false, false, false), ('billing_pending_reminders', 'viewer', false, false, false, false),
  ('billing_notices', 'owner', true, false, false, false), ('billing_notices', 'admin', true, false, false, false),
  ('billing_notices', 'sales', false, false, false, false), ('billing_notices', 'viewer', false, false, false, false),
  -- T002 tables
  ('memberships',   'owner',  true, true,  true,  true ), ('memberships',   'admin',  true, true,  true,  true ),
  ('memberships',   'sales',  true, false, false, false), ('memberships',   'viewer', true, false, false, false),
  ('audit_events',  'owner',  true, false, false, false), ('audit_events',  'admin',  true, false, false, false),
  ('audit_events',  'sales',  false, false, false, false), ('audit_events', 'viewer', false, false, false, false)
) as m(t, r, s, i, u, d);

select plan(1);
select pass('tenant table registry installed');
select * from finish();
