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
   'status = status', $$delete from public.assistant_reply_drafts where id = %2$L$$, true);

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
  -- T002 tables
  ('memberships',   'owner',  true, true,  true,  true ), ('memberships',   'admin',  true, true,  true,  true ),
  ('memberships',   'sales',  true, false, false, false), ('memberships',   'viewer', true, false, false, false),
  ('audit_events',  'owner',  true, false, false, false), ('audit_events',  'admin',  true, false, false, false),
  ('audit_events',  'sales',  false, false, false, false), ('audit_events', 'viewer', false, false, false, false)
) as m(t, r, s, i, u, d);

select plan(1);
select pass('tenant table registry installed');
select * from finish();
