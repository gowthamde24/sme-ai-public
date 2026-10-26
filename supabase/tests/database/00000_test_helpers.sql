-- Test helpers for the RLS/isolation suite. Installed into the LOCAL test database only
-- (schema `tests`); never part of a migration. Runs first (file name sorts first).
--
-- Why helper functions instead of `set local role` in test files: pgTAP keeps its state in
-- temp tables owned by the session user, which the `authenticated` role cannot touch. These
-- helpers switch role inside a function, run exactly one statement as that identity, switch
-- back, and return a plain value so every assertion itself runs as the privileged session user.
--
-- Identity convention: a NULL uid means the `anon` role (no JWT). A uuid means `authenticated`
-- with that uuid as the JWT `sub`, exactly the claims PostgREST would set from a Supabase JWT.

create schema if not exists tests;

-- Deterministic ids so tests read as prose: tests.uid('a_owner'), tests.tid('a').
create or replace function tests.uid(p_name text) returns uuid
language sql immutable as $$ select md5('tests.uid:' || p_name)::uuid $$;

create or replace function tests.tid(p_name text) returns uuid
language sql immutable as $$ select md5('tests.tid:' || p_name)::uuid $$;

create or replace function tests.set_identity(p_uid uuid) returns void
language plpgsql as $$
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config(
      'request.jwt.claims',
      -- 'exp' only when a test set tests.jwt_exp (the agent functions bound a run's life by the token's exp)
      (json_build_object('sub', p_uid, 'role', 'authenticated', 'aud', 'authenticated')::jsonb
        || case when nullif(current_setting('tests.jwt_exp', true), '') is null then '{}'::jsonb
                else jsonb_build_object('exp', current_setting('tests.jwt_exp', true)::bigint) end
        -- the session's assurance level (ADR 0016): aal2 unless a test sets tests.jwt_aal to 'aal1', or to 'absent' to omit the claim
        || case coalesce(nullif(current_setting('tests.jwt_aal', true), ''), 'aal2')
             when 'absent' then '{}'::jsonb
             else jsonb_build_object('aal', coalesce(nullif(current_setting('tests.jwt_aal', true), ''), 'aal2')) end)::text,
      true
    );
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

-- Run one statement as the given identity and return the number of rows it returned/affected.
-- Errors propagate (the caller expects success).
create or replace function tests.rows_as(p_uid uuid, p_sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  perform tests.set_identity(p_uid);
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    raise;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- Run one statement as the given identity and return 'ok' or the SQLSTATE it failed with.
create or replace function tests.sqlstate_as(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  state text := 'ok';
begin
  perform tests.set_identity(p_uid);
  begin
    execute p_sql;
  exception when others then
    state := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return state;
end $$;

-- Run one single-value query as the given identity and return its first column as text.
create or replace function tests.scalar_as(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  v text;
begin
  perform tests.set_identity(p_uid);
  begin
    execute p_sql into v;
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    raise;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

-- Run one statement as the given identity and return 'rows:<n>' (rows returned/affected) or the
-- SQLSTATE it failed with. One value to assert on for allow AND deny paths.
create or replace function tests.outcome_as(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  n bigint;
  result text;
begin
  perform tests.set_identity(p_uid);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    result := 'rows:' || n;
  exception when others then
    result := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return result;
end $$;

-- Like outcome_as, but for errors returns '<sqlstate>:<constraint>:<table>' so two failures can be
-- compared for IDENTICAL shape (e.g. "foreign id" vs "nonexistent id": no existence leak).
create or replace function tests.error_shape_as(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  result text := 'ok';
  v_state text; v_constraint text; v_table text;
begin
  perform tests.set_identity(p_uid);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_constraint = constraint_name, v_table = table_name;
    v_state := sqlstate;
    result := v_state || ':' || coalesce(v_constraint, '') || ':' || coalesce(v_table, '');
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return result;
end $$;

-- The WHOLE error a caller can see: sqlstate | message | detail | hint | constraint | table. Two refusals are
-- indistinguishable (no existence oracle) only if this entire string is identical.
create or replace function tests.error_full_as(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  result text := 'ok';
  v_msg text; v_detail text; v_hint text; v_constraint text; v_table text;
begin
  perform tests.set_identity(p_uid);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint,
                            v_constraint = constraint_name, v_table = table_name;
    result := sqlstate || '|' || v_msg || '|' || coalesce(v_detail, '') || '|' || coalesce(v_hint, '') || '|' ||
              coalesce(v_constraint, '') || '|' || coalesce(v_table, '');
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return result;
end $$;

-- Deterministic ids for CRM fixtures: tests.rid('a_company').
create or replace function tests.rid(p_name text) returns uuid
language sql immutable as $$ select md5('tests.rid:' || p_name)::uuid $$;

-- Extra unaffiliated users for tests that need many distinct members: tests.pool_uid(n).
create or replace function tests.pool_uid(p_n int) returns uuid
language sql immutable as $$ select tests.uid('pool' || p_n) $$;

create or replace function tests.make_pool_users(p_count int) returns void
language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select tests.pool_uid(i), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'pool' || i || '@test.local', jsonb_build_object('display_name', 'pool' || i), now(), now()
  from generate_series(1, p_count) i;
end $$;

-- One company, contact (in that company), product, lead and opportunity per fixture tenant.
-- Prefix 'a' / 'b': tests.rid('a_company'), tests.rid('a_contact'), ... Requires seed_two_tenants().
create or replace function tests.seed_crm() returns void
language plpgsql as $$
declare
  p text;
begin
  foreach p in array array['a', 'b'] loop
    insert into public.companies (id, tenant_id, name)
    values (tests.rid(p || '_company'), tests.tid(p), 'Company ' || p);
    insert into public.contacts (id, tenant_id, company_id, full_name, email, phone)
    values (tests.rid(p || '_contact'), tests.tid(p), tests.rid(p || '_company'),
            'Contact ' || p, p || '.contact@example.test', '+00 90000 0000' || (case p when 'a' then 1 else 2 end));
    insert into public.products (id, tenant_id, sku, name)
    values (tests.rid(p || '_product'), tests.tid(p), 'SKU-1', 'Product ' || p);
    insert into public.leads (id, tenant_id, company_id, contact_id)
    values (tests.rid(p || '_lead'), tests.tid(p), tests.rid(p || '_company'), tests.rid(p || '_contact'));
    insert into public.opportunities (id, tenant_id, company_id, contact_id, lead_id, title)
    values (tests.rid(p || '_opp'), tests.tid(p), tests.rid(p || '_company'), tests.rid(p || '_contact'),
            tests.rid(p || '_lead'), 'Opportunity ' || p);
  end loop;
end $$;

-- T004: one evidence row, one claim (about the company) and two links per fixture tenant.
-- Prefix 'a' / 'b': tests.rid('a_evidence'), tests.rid('a_claim'), tests.rid('a_link_company'),
-- tests.rid('a_link_claim'). Requires seed_two_tenants() and seed_crm().
create or replace function tests.seed_evidence() returns void
language plpgsql as $$
declare
  p text;
begin
  foreach p in array array['a', 'b'] loop
    insert into public.evidence (id, tenant_id, kind, provider, url, snippet)
    values (tests.rid(p || '_evidence'), tests.tid(p), 'web_page', 'manual',
            'https://example.test/' || p, 'Fixture snippet for tenant ' || p);
    insert into public.claims (id, tenant_id, company_id, predicate, value, confidence)
    values (tests.rid(p || '_claim'), tests.tid(p), tests.rid(p || '_company'), 'exports_to', 'Fixture value ' || p, 'low');
    insert into public.evidence_links (id, tenant_id, evidence_id, company_id)
    values (tests.rid(p || '_link_company'), tests.tid(p), tests.rid(p || '_evidence'), tests.rid(p || '_company'));
    insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance)
    values (tests.rid(p || '_link_claim'), tests.tid(p), tests.rid(p || '_evidence'), tests.rid(p || '_claim'), 'supports');
  end loop;
end $$;

-- T008: one enquiry and one requirement per fixture tenant (parents for the composite-foreign-key attacks of 12).
-- Prefix 'a' / 'b': tests.rid('a_enquiry'), tests.rid('a_requirement'). Requires seed_two_tenants() and seed_crm().
create or replace function tests.seed_t008() returns void
language plpgsql as $$
declare
  p text;
begin
  foreach p in array array['a', 'b'] loop
    insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body)
    values (tests.rid(p || '_enquiry'), tests.tid(p), tests.rid(p || '_lead'), 'email', now() - interval '1 hour', 'Fixture enquiry for tenant ' || p);
    insert into public.requirements (id, tenant_id, enquiry_id)
    values (tests.rid(p || '_requirement'), tests.tid(p), tests.rid(p || '_enquiry'));
  end loop;
end $$;

-- T009 part 1: one price list with a version, an item and a break, one policy version and one mapper config version per fixture tenant (parents for
-- the composite-foreign-key attacks of 12). Prefix 'a' / 'b': tests.rid('a_price_list'), tests.rid('a_price_version'), tests.rid('a_price_item'),
-- tests.rid('a_policy_version'), tests.rid('a_mapper_version'). Requires seed_two_tenants() and seed_crm() (the tenant's product).
create or replace function tests.seed_t009() returns void
language plpgsql as $$
declare
  p text;
begin
  foreach p in array array['a', 'b'] loop
    insert into public.price_lists (id, tenant_id, name) values (tests.rid(p || '_price_list'), tests.tid(p), 'Fixture price list');
    insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256)
    values (tests.rid(p || '_price_version'), tests.tid(p), tests.rid(p || '_price_list'), 1, current_date, 1, repeat('0', 64));
    insert into public.price_list_items (id, tenant_id, version_id, product_id, sku, name, unit_price_paise, minimum_order_quantity, tax_bps)
    values (tests.rid(p || '_price_item'), tests.tid(p), tests.rid(p || '_price_version'), tests.rid(p || '_product'), 'SKU-1', 'Product ' || p, 100000, 1, 500);
    insert into public.price_list_breaks (id, tenant_id, item_id, min_qty, unit_price_paise)
    values (tests.rid(p || '_price_break'), tests.tid(p), tests.rid(p || '_price_item'), 10, 90000);
    insert into public.quote_policy_versions (id, tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps,
                                              validity_days, new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_rate_bps, gst_effective_from, seller_state, content_sha256)
    values (tests.rid(p || '_policy_version'), tests.tid(p), 1, current_date, 0, 0, 0, 15, 0, 0, 30, 30, 500, current_date, 'TS', repeat('1', 64));
    insert into public.item_types (id, tenant_id, code, name) values (tests.rid(p || '_item_type'), tests.tid(p), upper(p) || '1', 'Fixture item type ' || p);
    insert into public.mapper_config_versions (id, tenant_id, version_no, effective_from, config, content_sha256)
    values (tests.rid(p || '_mapper_version'), tests.tid(p), 1, current_date, '{}'::jsonb, repeat('2', 64));
    -- part 2 (needs seed_t008 first: the tenant's enquiry and requirement): one rejected quote with one line, and one pick
    insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text,
                               result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise,
                               shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
    values (tests.rid(p || '_quote'), tests.tid(p), 1, tests.rid(p || '_requirement'), tests.rid(p || '_enquiry'), tests.rid(p || '_lead'), 'rejected',
            tests.rid(p || '_price_version'), tests.rid(p || '_policy_version'), '1.1.0', '{}', '{}', repeat('3', 64), 'new', 'TS', 'intra_state', current_date,
            current_date, current_date, 0, 0, 0, 0, 0, 0, 0, false, tests.uid(p || '_owner'), now(), 'other');
    insert into public.quote_lines (id, tenant_id, quote_id, line_no, requirement_line_no, product_id, sku, name, sale_unit, qty, unit_price_applied_paise,
                                    line_subtotal_paise, net_paise, tax_paise, gross_paise, tax_bps)
    values (tests.rid(p || '_quote_line'), tests.tid(p), tests.rid(p || '_quote'), 1, 1, tests.rid(p || '_product'), 'SKU-1', 'Product ' || p, 'piece', 1, 100, 100, 100, 5, 105, 500);
    insert into public.requirement_line_picks (id, tenant_id, requirement_id, line_no, product_id, qty, sale_unit, decided_by)
    values (tests.rid(p || '_pick'), tests.tid(p), tests.rid(p || '_requirement'), 1, tests.rid(p || '_product'), 1, 'piece', tests.uid(p || '_owner'));
  end loop;
end $$;

-- Order conversion (ADR 0021): one order policy version, one order (for the tenant's rejected fixture quote) and its `created` event per fixture tenant, written the way a
-- privileged fixture may (the functions are tested in 61). Prefix 'a' / 'b': tests.rid('a_order_policy'), tests.rid('a_order'), tests.rid('a_order_event').
-- Requires seed_t009() (the quote, its enquiry and requirement).
create or replace function tests.seed_orders() returns void
language plpgsql as $$
declare
  p text;
begin
  foreach p in array array['a', 'b'] loop
    insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state,
                                              allow_zero_value_orders, content_sha256)
    values (tests.rid(p || '_order_policy'), tests.tid(p), 1, current_date, true, true, 'in_preparation', false, repeat('4', 64));
    insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
    values (tests.rid(p || '_order'), tests.tid(p), 1, tests.rid(p || '_quote'), tests.rid(p || '_enquiry'), tests.rid(p || '_requirement'), tests.rid(p || '_lead'), 0, 0,
            current_date, tests.rid(p || '_order_policy'));
    insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at)
    values (tests.rid(p || '_order_event'), tests.tid(p), tests.rid(p || '_order'), 1, 'created', null, 'quote_approved', now());
  end loop;
end $$;

-- T010 part 2: one follow-up policy version, one open draft, one touch (a reply, so it is attached to no draft) and one question draft per fixture tenant, written the way a privileged fixture may
-- (the functions are tested in 62). Prefix 'a' / 'b': tests.rid('a_followup_policy'), tests.rid('a_followup_draft'), tests.rid('a_touch'), tests.rid('a_question'). Requires seed_crm() and seed_t008().
create or replace function tests.seed_followups() returns void
language plpgsql as $$
declare
  p text;
begin
  foreach p in array array['a', 'b'] loop
    insert into public.followup_policy_versions (id, tenant_id, version_no, effective_from, gap_days, max_touches, quiet_start, quiet_end, allowed_weekdays, holidays, min_gap_hours,
                                                 recipient_utc_offset_minutes, content_sha256)
    values (tests.rid(p || '_followup_policy'), tests.tid(p), 1, current_date, '{3}', 2, '21:00', '09:00', '{0,1,2,3,4,5}', '{}', 24, 330, repeat('5', 64));
    insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text,
                                        canonical_hash, state_hash, as_of)
    values (tests.rid(p || '_followup_draft'), tests.tid(p), tests.rid(p || '_lead'), tests.rid(p || '_contact'), 2, 'email', 'followup_gentle', 'Synthetic fixture draft body text',
            tests.rid(p || '_followup_policy'), '1.0.0', '{}', '{}', repeat('1', 64), repeat('2', 64), now());
    insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at)
    values (tests.rid(p || '_touch'), tests.tid(p), tests.rid(p || '_lead'), tests.rid(p || '_contact'), 'in', 'email', now());
    insert into public.question_drafts (id, tenant_id, requirement_id, line_no, question_code, question_text)
    values (tests.rid(p || '_question'), tests.tid(p), tests.rid(p || '_requirement'), 0, 'missing_quantity', 'How many pieces do you need?');
  end loop;
end $$;

-- Job AG: one chat of the Main agent per fixture tenant: the conversation, its run, the owner's message, the answer and a customer-reply draft. Prefix 'a' / 'b':
-- tests.rid('a_conv'), tests.rid('a_arun'), tests.rid('a_msg1'), tests.rid('a_msg2'), tests.rid('a_reply_draft'). Requires seed_two_tenants() and seed_crm().
create or replace function tests.seed_assistant() returns void
language plpgsql as $$
declare
  p text;
begin
  foreach p in array array['a', 'b'] loop
    insert into public.assistant_conversations (id, tenant_id, created_by) values (tests.rid(p || '_conv'), tests.tid(p), tests.uid(p || '_owner'));
    insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, conversation_id, expires_at, input_sha256)
    values (tests.rid(p || '_arun'), tests.tid(p), tests.uid(p || '_owner'), 'assistant', 'assistant-1', tests.rid(p || '_conv'), now() + interval '15 minutes', repeat('8', 64));
    insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, created_by, run_id) values
      (tests.rid(p || '_msg1'), tests.tid(p), tests.rid(p || '_conv'), 1, 'user', 'What is waiting for me today?', tests.uid(p || '_owner'), tests.rid(p || '_arun'));
    insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, language, sources, created_by, run_id) values
      (tests.rid(p || '_msg2'), tests.tid(p), tests.rid(p || '_conv'), 2, 'assistant', 'One quote is waiting for your approval.', 'en',
       jsonb_build_array(jsonb_build_object('type', 'lead', 'id', tests.rid(p || '_lead'))), tests.uid(p || '_owner'), tests.rid(p || '_arun'));
    insert into public.assistant_reply_drafts (id, tenant_id, conversation_id, run_id, lead_id, language, body, gloss_en, created_by)
    values (tests.rid(p || '_reply_draft'), tests.tid(p), tests.rid(p || '_conv'), tests.rid(p || '_arun'), tests.rid(p || '_lead'), 'en', 'Thank you for your enquiry.', 'Thank you for your enquiry.', tests.uid(p || '_owner'));
  end loop;
end $$;

-- T005: one ICP config version, one import batch and one lead label per fixture tenant.
-- Prefix 'a' / 'b': tests.rid('a_icp1'), tests.rid('a_batch'), tests.rid('a_label').
-- Requires seed_two_tenants() and seed_crm().
create or replace function tests.seed_t005() returns void
language plpgsql as $$
declare
  p text;
begin
  foreach p in array array['a', 'b'] loop
    insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config)
    values (tests.rid(p || '_icp1'), tests.tid(p), 'icp-rules', 1,
            '{"factors":[{"id":"fit","max_points":100}],"bands":[]}'::jsonb);
    insert into public.import_batches (id, tenant_id, content_sha256, row_count, rejected_count)
    values (tests.rid(p || '_batch'), tests.tid(p), repeat('3', 64), 1, 1);
    insert into public.lead_labels (id, tenant_id, lead_id, label)
    values (tests.rid(p || '_label'), tests.tid(p), tests.rid(p || '_lead'), 'good');
  end loop;
end $$;

-- T006: agents switched on for tenant A (and the platform), the selftest agent allowed for tenant A only, and
-- two running runs in tenant A against its base company: tests.rid('a_run_sales') started by a_sales,
-- tests.rid('a_run_admin') by a_admin, and tests.rid('b_run') in tenant B (started by b_sales). Requires seed_two_tenants() and seed_crm().
create or replace function tests.seed_agents() returns void
language plpgsql as $$
begin
  update public.platform_flags set enabled = true where key in ('agents_enabled', 'selftest_enabled');
  update public.agent_definitions set allowed_tenants = array[tests.tid('a')] where agent_name = 'selftest';
  insert into public.tenant_agent_settings (tenant_id, enabled) values (tests.tid('a'), true);
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, input_refs)
  values (tests.rid('a_run_sales'), tests.tid('a'), tests.uid('a_sales'), 'selftest', 'v1', tests.rid('a_company'),
          now() + interval '15 minutes', repeat('1', 64), '{}'::jsonb),
         (tests.rid('a_run_admin'), tests.tid('a'), tests.uid('a_admin'), 'selftest', 'v1', tests.rid('a_company'),
          now() + interval '15 minutes', repeat('2', 64), '{}'::jsonb),
         -- tenant B has a run too (a foreign parent for the cross-tenant tests); agents are NOT enabled for B
         (tests.rid('b_run'), tests.tid('b'), tests.uid('b_sales'), 'selftest', 'v1', tests.rid('b_company'),
          now() + interval '15 minutes', repeat('3', 64), '{}'::jsonb);
end $$;

-- Return the EXPLAIN plan (no costs) of one statement as the given identity.
create or replace function tests.explain_as(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  line text;
  plan text := '';
begin
  perform tests.set_identity(p_uid);
  begin
    for line in execute 'explain (costs off) ' || p_sql loop
      plan := plan || line || E'\n';
    end loop;
  exception when others then
    -- Never abort the calling guard: a table the caller cannot even read has no usable plan, and
    -- the guards treat "ERROR:..." as "no InitPlan" so the table is reported, not skipped.
    plan := 'ERROR:' || sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return plan;
end $$;

-- Two tenants with every role, plus unaffiliated users. Runs as the privileged session user,
-- so it exercises the same triggers (audit, profile creation) a real signup would.
--
--   Tenant A: a_owner, a_owner2, dual (owners), a_admin, a_sales, a_viewer   (6 memberships)
--   Tenant B: b_owner (sole owner), b_admin, b_sales, b_viewer, dual (viewer) (5 memberships)
--   dual     : Owner of A and Viewer of B (multi-tenant user, different role per tenant)
--   No tenant: outsider, x1..x6
create or replace function tests.seed_two_tenants() returns void
language plpgsql as $$
declare
  n text;
begin
  foreach n in array array[
    'a_owner', 'a_owner2', 'a_admin', 'a_sales', 'a_viewer',
    'b_owner', 'b_admin', 'b_sales', 'b_viewer',
    'dual', 'outsider', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6'
  ] loop
    insert into auth.users (
      id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at
    ) values (
      tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      n || '@test.local', now(), jsonb_build_object('display_name', n), now(), now()
    );
  end loop;

  insert into public.tenants (id, name, slug) values
    (tests.tid('a'), 'Tenant A', 'tenant-a'),
    (tests.tid('b'), 'Tenant B', 'tenant-b');

  insert into public.memberships (tenant_id, user_id, role) values
    (tests.tid('a'), tests.uid('a_owner'),  'owner'),
    (tests.tid('a'), tests.uid('a_owner2'), 'owner'),
    (tests.tid('a'), tests.uid('dual'),     'owner'),
    (tests.tid('a'), tests.uid('a_admin'),  'admin'),
    (tests.tid('a'), tests.uid('a_sales'),  'sales'),
    (tests.tid('a'), tests.uid('a_viewer'), 'viewer'),
    (tests.tid('b'), tests.uid('b_owner'),  'owner'),
    (tests.tid('b'), tests.uid('b_admin'),  'admin'),
    (tests.tid('b'), tests.uid('b_sales'),  'sales'),
    (tests.tid('b'), tests.uid('b_viewer'), 'viewer'),
    (tests.tid('b'), tests.uid('dual'),     'viewer');
end $$;

-- `supabase test db` expects every file to emit TAP output.
select plan(1);
select pass('test helpers installed');
select * from finish();

-- ============================================================================ erasure (T006b M1, ADR 0014)
-- Plant a PII canary in EVERY column the erasure registry knows, through plain inserts/updates (the privileged session), for
-- fixture tenant p ('a' / 'b'). Requires seed_two_tenants() and seed_crm(). Two tokens:
--   qxjv  the PERSON: contact "Zed Qxjv", zed.qxjv@canary.test, +91 98765 43210 (digits 9876543210)
--   kzv9  the COMPANY: "Kzv9 Silks", kzv9-silks.test, city, region, tag
-- Row ids: tests.rid(p || '_er_<name>').
create or replace function tests.er_plant(p text) returns void
language plpgsql as $$
declare
  t uuid := tests.tid(p);
  c uuid := tests.rid(p || '_company');
  c2 uuid := tests.rid(p || '_er_company2');
  k uuid := tests.rid(p || '_contact');
  l uuid := tests.rid(p || '_lead');
begin
  perform tests.open_gate(p);  -- the canary phone is a real-looking number: this is the world where erasure matters
  update public.contacts set full_name = 'Zed Qxjv', email = 'zed.qxjv@canary.test', phone = '+91 98765 43210', job_title = 'Qxjv director' where id = k;
  update public.companies set name = 'Kzv9 Silks', website = 'https://kzv9-silks.test/shop', city = 'Kzv9pur', region = 'Kzv9 State', tags = array['kzv9'], gstin = '27AAPFU0939F1ZV' where id = c;
  insert into public.companies (id, tenant_id, name, tags) values (c2, t, 'Other Co', array['zed.qxjv@canary.test', 'vip']);
  insert into public.consent_events (id, tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref)
  values (tests.rid(p || '_er_consent'), t, k, 'granted', 'email', 'explicit_consent', 'web_form', 'form:qxjv-9876543210');
  update public.leads set source = 'Intro by Zed Qxjv at Kzv9 fair', disqualified_reason = 'Zed Qxjv declined' where id = l;
  insert into public.leads (id, tenant_id, company_id, source, disqualified_reason)
  values (tests.rid(p || '_er_lead2'), t, c2, 'fwd zed.qxjv@canary.test', 'ref 9876543210');
  update public.opportunities set title = 'Deal Zed Qxjv', status = 'lost', lost_reason = 'Kzv9 lost it' where id = tests.rid(p || '_opp');
  insert into public.opportunities (id, tenant_id, company_id, title) values (tests.rid(p || '_er_opp2'), t, c2, 'Call 98765 43210 re order');
  update public.products set description = 'Sold by zed.qxjv@canary.test' where id = tests.rid(p || '_product');
  insert into public.import_batches (id, tenant_id, label, content_sha256, row_count, rejected_count)
  values (tests.rid(p || '_er_batch'), t, 'Zed Qxjv import', repeat('4', 64), 1, 1);
  -- evidence
  insert into public.evidence (id, tenant_id, kind, provider, url, reference, snippet) values
    (tests.rid(p || '_er_e1'), t, 'web_page', 'manual', 'https://example.test/p?e=zed.qxjv@canary.test', 'call:9876543210', 'Mail zed.qxjv@canary.test or call +91 98765 43210 today'),
    (tests.rid(p || '_er_e2'), t, 'note', 'manual', null, 'note:e2', 'Zed Qxjv'),
    (tests.rid(p || '_er_e3'), t, 'note', 'manual', null, 'note:e3', 'Run by Zed Qxjv Textiles Ltd'),
    (tests.rid(p || '_er_e4'), t, 'web_page', 'manual', 'https://kzv9-silks.test/c', 'doc:kzv9-cat', 'Kzv9 Silks catalogue'),
    (tests.rid(p || '_er_e5'), t, 'note', 'manual', null, 'note:e5', 'Lead note kzv9'),
    (tests.rid(p || '_er_e6'), t, 'note', 'manual', null, 'note:e6', 'support kzv9'),
    (tests.rid(p || '_er_e7'), t, 'note', 'manual', null, 'note:e7', 'Kzv9 Silks'),
    (tests.rid(p || '_er_e8'), t, 'note', 'manual', null, 'note:e8', 'Visit kzv9-silks.test for more'),
    (tests.rid(p || '_er_e9'), t, 'note', 'manual', null, 'note:e9', 'Kzv9 Silks Pvt Ltd range');
  -- claims
  insert into public.claims (id, tenant_id, company_id, lead_id, predicate, value, confidence) values
    (tests.rid(p || '_er_c1'), t, c2, null, 'exports_to', 'Phone +91 98765-43210', 'low'),
    (tests.rid(p || '_er_c2'), t, c2, null, 'exports_to', 'zed qxjv', 'low'),
    (tests.rid(p || '_er_c3'), t, c2, null, 'exports_to', 'Proprietor Zed Qxjv here', 'low'),
    (tests.rid(p || '_er_c4'), t, c, null, 'exports_to', 'Kzv9 exports silk', 'low'),
    (tests.rid(p || '_er_c5'), t, null, l, 'exports_to', 'Lead claim kzv9', 'low');
  insert into public.evidence_links (id, tenant_id, evidence_id, company_id, lead_id, claim_id, stance) values
    (tests.rid(p || '_er_l4'), t, tests.rid(p || '_er_e4'), c, null, null, null),
    (tests.rid(p || '_er_l5'), t, tests.rid(p || '_er_e5'), null, l, null, null),
    (tests.rid(p || '_er_l6'), t, tests.rid(p || '_er_e6'), null, null, tests.rid(p || '_er_c4'), 'supports');
  -- T008: an enquiry captured on the lead (company c, contact k) and the fields extracted from it
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, subject, body)
  values (tests.rid(p || '_er_enq'), t, l, 'email', now() - interval '1 hour', 'Re: Kzv9 order from Zed Qxjv', 'Zed Qxjv here from Kzv9pur: need 20 sarees');
  insert into public.requirements (id, tenant_id, enquiry_id) values (tests.rid(p || '_er_req'), t, tests.rid(p || '_er_enq'));
  insert into public.requirement_fields (id, tenant_id, requirement_id, line_no, field_key, value_int, basis, certainty, quote, quote_start, quote_end) values
    (tests.rid(p || '_er_f1'), t, tests.rid(p || '_er_req'), 1, 'quantity', 20, 'piece', 'stated', 'Zed Qxjv here from Kzv9pur: need 20 sarees', 0, 41);
  insert into public.requirement_fields (id, tenant_id, requirement_id, line_no, field_key, value_text, certainty, quote, quote_start, quote_end) values
    (tests.rid(p || '_er_f2'), t, tests.rid(p || '_er_req'), null, 'delivery_city', 'Kzv9pur', 'stated', 'Kzv9pur', 20, 27);
  -- job AG: a chat of the Main agent that names the person, and a customer-reply draft with the same identifiers
  insert into public.assistant_conversations (id, tenant_id, created_by) values (tests.rid(p || '_er_conv'), t, tests.uid(p || '_owner'));
  insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, created_by) values
    (tests.rid(p || '_er_m1'), t, tests.rid(p || '_er_conv'), 1, 'user', 'Ask about zed.qxjv@canary.test or +91 98765 43210 for me', tests.uid(p || '_owner'));
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, conversation_id, expires_at, input_sha256)
  values (tests.rid(p || '_er_run'), t, tests.uid(p || '_owner'), 'assistant', 'assistant-1', tests.rid(p || '_er_conv'), now() + interval '15 minutes', repeat('9', 64));
  insert into public.assistant_reply_drafts (id, tenant_id, conversation_id, run_id, lead_id, language, body, gloss_en, created_by) values
    (tests.rid(p || '_er_rd'), t, tests.rid(p || '_er_conv'), tests.rid(p || '_er_run'), l, 'en', 'Thank you for writing from zed.qxjv@canary.test', 'We will call 98765 43210', tests.uid(p || '_owner'));
  -- job AT: a message to the person that waits for approval, and a call request the Owner decided, both naming them
  insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, gloss_en, language, category, status, reason, request_sha256, created_by) values
    (tests.rid(p || '_er_ob'), t, l, k, 'whatsapp', 'Hello Zed Qxjv, call 98765 43210 or write to zed.qxjv@canary.test', 'English gloss for Zed Qxjv, call 98765 43210', 'en', 'info', 'needs_approval', 'category_other', repeat('3', 64), tests.uid(p || '_owner'));
  insert into public.call_requests (id, tenant_id, lead_id, contact_id, reason, script_draft, language, status, request_sha256, requested_by, decided_by, decided_at, decision_note) values
    (tests.rid(p || '_er_cr'), t, l, k, 'Call Zed Qxjv about the order', 'Hello Zed Qxjv, this is about 9876543210', 'en', 'approved', repeat('4', 64), tests.uid(p || '_owner'), tests.uid(p || '_owner'), now(), 'Reach zed.qxjv@canary.test first');
  -- job AS: a store visit for the person, with free text that names them (what it is for, a note, why it was cancelled)
  insert into public.store_visits (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, purpose, note, request_sha256, created_by)
  values (tests.rid(p || '_er_sv'), t, l, k, c, date '2026-10-06', timestamptz '2026-10-06 11:00+05:30', timestamptz '2026-10-06 11:30+05:30', 'Bridal sarees for Zed Qxjv', 'Call 98765 43210 before the visit', repeat('5', 64), tests.uid(p || '_owner'));
  update public.store_visits set status = 'cancelled', closed_at = now(), cancel_reason = 'Zed Qxjv wrote from zed.qxjv@canary.test' where id = tests.rid(p || '_er_sv');
  -- job CK: five custom field values on the contact, one per value column (a personal-class text field that names them, a number, a date, a yes/no and a choice list)
  insert into public.custom_field_defs (id, tenant_id, entity, code, label, kind, choices, pii_class, source) values
    (tests.rid(p || '_er_cf1'), t, 'contact', 'er_note',   '{"en": "Note"}',   'text',         null, 'personal', 'owner'),
    (tests.rid(p || '_er_cf2'), t, 'contact', 'er_number', '{"en": "Number"}', 'number',       null, 'personal', 'owner'),
    (tests.rid(p || '_er_cf3'), t, 'contact', 'er_date',   '{"en": "Date"}',   'date',         null, 'personal', 'owner'),
    (tests.rid(p || '_er_cf4'), t, 'contact', 'er_flag',   '{"en": "Flag"}',   'yes_no',       null, 'personal', 'owner'),
    (tests.rid(p || '_er_cf5'), t, 'contact', 'er_multi',  '{"en": "Multi"}',  'multi_choice', '[{"code": "a1", "label": {"en": "A"}}, {"code": "b2", "label": {"en": "B"}}]'::jsonb, 'personal', 'owner');
  insert into public.custom_field_values (id, tenant_id, field_id, entity, contact_id, value_text, value_number, value_date, value_bool, value_choices) values
    (tests.rid(p || '_er_cv1'), t, tests.rid(p || '_er_cf1'), 'contact', k, 'Zed Qxjv, call 98765 43210', null, null, null, null),
    (tests.rid(p || '_er_cv2'), t, tests.rid(p || '_er_cf2'), 'contact', k, null, 98765, null, null, null),
    (tests.rid(p || '_er_cv3'), t, tests.rid(p || '_er_cf3'), 'contact', k, null, null, date '1980-05-17', null, null),
    (tests.rid(p || '_er_cv4'), t, tests.rid(p || '_er_cf4'), 'contact', k, null, null, null, true, null),
    (tests.rid(p || '_er_cv5'), t, tests.rid(p || '_er_cf5'), 'contact', k, null, null, null, null, array['a1', 'b2']);
  -- job CN: a site of the company (its words are the COMPANY's canary, never the person's), and one trip with a proof (the driver's and the receiver's names and the driver's phone are the person's canary,
  -- as a whole field or a number). The modules that guard these tables are off for the fixture tenant, so their guards are switched off inside this transaction.
  perform tests.cn_guards_off();
  insert into public.customer_sites (id, tenant_id, company_id, name, address_line, city, pin, map_lat, map_lng, access_notes, site_contact_id, created_by) values
    (tests.rid(p || '_er_site'), t, c, 'Kzv9 site', 'Plot 9, Kzv9pur', 'Kzv9pur', '500001', 17.385044, 78.486671, 'Lane behind the Kzv9 temple', k, tests.uid(p || '_owner'));
  insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256) values
    (tests.rid(p || '_er_mp'), t, 1, current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb, repeat('5', 64));
  insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips,
                                      material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, rejected_by, rejected_at, reject_code)
  values (tests.rid(p || '_er_mq'), t, 1, tests.rid(p || '_er_req'), tests.rid(p || '_er_enq'), l, 'rejected', tests.rid(p || '_er_mp'), '1.0.0', '{}', '{}', repeat('6', 64), current_date, current_date, 1,
          0, 0, 0, 0, 0, 0, 0, 0, false, tests.uid(p || '_owner'), now(), 'other');
  insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256)
  values (tests.rid(p || '_er_op'), t, (select coalesce(max(version_no), 0) + 1 from public.order_policy_versions where tenant_id = t), current_date, true, true, 'in_preparation', false, repeat('4', 64));
  insert into public.orders (id, tenant_id, order_no, quote_id, material_quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
  values (tests.rid(p || '_er_mo'), t, (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = t), null, tests.rid(p || '_er_mq'), tests.rid(p || '_er_enq'), tests.rid(p || '_er_req'), l, 0, 0, current_date,
          tests.rid(p || '_er_op'));
  insert into public.delivery_trips (id, tenant_id, order_id, trip_no, challan_no, planned_date, vehicle_no, driver_name, driver_phone, created_by) values
    (tests.rid(p || '_er_trip'), t, tests.rid(p || '_er_mo'), 1, (select coalesce(max(challan_no), 0) + 1 from public.delivery_trips where tenant_id = t), current_date, 'QV09 AB 1234', 'Zed Qxjv', '+91 98765 43210', tests.uid(p || '_owner'));
  insert into public.delivery_proofs (id, trip_id, tenant_id, received_by, photo_id, bucket, path, width, height, bytes, recorded_by) values
    (tests.rid(p || '_er_pod'), tests.rid(p || '_er_trip'), t, 'Zed Qxjv', tests.rid(p || '_er_podphoto'), app.pod_bucket(t), tests.rid(p || '_er_trip')::text || '/' || tests.rid(p || '_er_podphoto')::text || '.jpg', 640, 640, 1000, tests.uid(p || '_owner'));
  -- job CR: a student of the canary contact (the label and the admission number are PII columns; the programme name is the school's own word, not a person's)
  insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (tests.rid(p || '_er_prog'), t, 'Class Five', 'class', 'section', tests.uid(p || '_owner'));
  insert into public.students (id, tenant_id, contact_id, is_adult, child_label, programme_id, admission_no, created_by)
  values (tests.rid(p || '_er_student'), t, k, false, 'Qxjvkid', tests.rid(p || '_er_prog'), 'QXJV-1234', tests.uid(p || '_owner'));
  -- job CP: a campaign's name and text are the owner's own words, not tied to one person (a campaign has many people): they carry a business canary, erased with the workspace and swept
  insert into public.campaigns (id, tenant_id, name, kind, language, message_text, steps, created_by) values
    (tests.rid(p || '_er_cmp'), t, 'Cmpq7 reminder', 'payment_due', 'en', 'Dear {{name}}, Cmpq7 shop reminds you of {{amount}} due on {{due_date}}', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, tests.uid(p || '_owner'));
  -- job DP part 4: the hand-over person's name and number (a team member) carry canaries, erased with the workspace
  insert into public.call_handover_rules (tenant_id, topic, person_name, phone, updated_by) values (t, 'pricing', 'Hndq7 Person', '+917000011122', tests.uid(p || '_owner'));
  -- job DM: an outcome's one-line reason is free text about an adult customer: it carries a canary, erased with the workspace and swept
  insert into public.outcomes (id, tenant_id, contact_id, kind, source_id, outcome, category, reason, recorded_by_kind, ai_outcome, ai_category, occurred_at)
  values (tests.rid(p || '_er_out'), t, k, 'call', tests.rid(p || '_er_out'), 'unclear', 'call_back_later', 'Outq7 asked to be called later', 'ai', 'unclear', 'call_back_later', now());
  -- job DR part A2: what a person wrote when they arrived (a touch of the canary lead) and a forwarded mail nobody could read: the business's words, a business canary, erased with the workspace and swept
  insert into public.lead_arrivals (id, tenant_id, lead_id, contact_id, source_tag, kind, message) values (tests.rid(p || '_er_ltouch'), t, l, k, 'webhook', 'first', 'Lsrq7 wants a plot near the highway');
  insert into public.lead_sources (id, tenant_id, kind, tag, label, token_hash, token_hint, created_by)
  values (tests.rid(p || '_er_lsrc'), t, 'email_forward', 'webhook', 'Lsrq7 mail', encode(sha256(convert_to(p || '_er_lsrc', 'UTF8')), 'hex'), 'wxyz', tests.uid(p || '_owner'));
  insert into public.lead_unparsed (id, tenant_id, source_id, subject, body) values (tests.rid(p || '_er_lunp'), t, tests.rid(p || '_er_lsrc'), 'Lsrq7 enquiry', 'Lsrq7 wrote: please call me about the plot');
  -- job DP part 5: the consenting person's name and the sentence they read (the Owner's) carry canaries, erased with the workspace
  insert into public.own_voices (id, tenant_id, status, consenting_name, consent_sentence, consented_by, consented_at, bucket, sample_path, consent_path)
  values (tests.rid(p || '_er_ovc'), t, 'pending', 'Ovcq7 Person', 'I, Ovcq7 Person, allow Stack19 to create an AI voice of me for Ovcq7 Shop', tests.uid(p || '_owner'), now(), 'ovc-' || t::text, tests.rid(p || '_er_ovc')::text || '/sample.wav', tests.rid(p || '_er_ovc')::text || '/consent.wav');
  -- job DR part A1: text the owner gave the assistant (a source and a fact) is the business's own words: a business canary, erased with the workspace and swept
  insert into public.knowledge_sources (id, tenant_id, kind, title, filename, content_type, text, chars, status, created_by)
  values (tests.rid(p || '_er_ksrc'), t, 'file', 'Knwq7 brochure', 'knwq7-brochure.pdf', 'application/pdf', 'Knwq7 Traders, open all week', 28, 'read', tests.uid(p || '_owner'));
  insert into public.knowledge_facts (id, tenant_id, source_id, kind, text, created_by)
  values (tests.rid(p || '_er_kfact'), t, tests.rid(p || '_er_ksrc'), 'hours', 'Knwq7 Traders is open all week', tests.uid(p || '_owner'));
end $$;

-- job CN: the generic registry tests (11, 12) and the erasure planter insert into tables guarded by modules that are OFF for the default pack the fixture tenants run (sites, dues, materials, deliveries).
-- Inside the calling transaction (DDL is transactional) the guards of every module that is off for tenant 'a' are switched off; the guards themselves are proved in 96 to 99.
create or replace function tests.cn_guards_off() returns void
language plpgsql as $$
declare
  g record;
begin
  for g in
    select n.nspname as sch, c.relname as tbl
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where t.tgname = 'module_guard' and not t.tgisinternal and t.tgenabled <> 'D'
       and not app.module_enabled(tests.tid('a'), (string_to_array(encode(t.tgargs, 'escape'), '\000'))[1])
  loop
    execute format('alter table %I.%I disable trigger module_guard', g.sch, g.tbl);
  end loop;
  alter table public.catalogue_items disable trigger catalogue_items_kind_insert;  -- the same guard for a material item (its function is the catalogue's own)
end $$;

-- job CN: put fixture tenant p on the building-materials pack (the newest version) with its custom fields, as a sign-up does.
create or replace function tests.cn_construction(p text) returns void
language plpgsql as $$
declare
  v packs.pack_versions;
begin
  select * into v from packs.pack_versions x where x.code = 'construction_materials' order by x.version desc limit 1;
  update packs.workspace_pack w set pack_code = v.code, pack_version = v.version, source = 'operator' where w.tenant_id = tests.tid(p);
  perform app.apply_pack_fields(tests.tid(p), v.code, v.version, tests.uid(p || '_owner'));
end $$;

-- Every place a pattern still appears in tenant p, as 'table.column#row id' strings (text, text[] and jsonb columns of EVERY table with a
-- tenant_id, registered or not). p_regex is a case-insensitive POSIX regex.
create or replace function tests.er_hits(p text, p_regex text) returns text[]
language plpgsql as $$
declare
  r record;
  v text;
  out text[] := '{}';
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.data_type in ('text', 'character varying', 'jsonb', 'ARRAY')
       and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.table_name and k.column_name = 'tenant_id')
     order by 1, 2
  loop
    execute format('select string_agg(%L || ''#'' || coalesce(to_jsonb(x)->>''id'', ''-''), '','' order by to_jsonb(x)->>''id'') from public.%I x where x.tenant_id = $1 and x.%I::text ~* $2',
                   r.table_name || '.' || r.column_name, r.table_name, r.column_name) into v using tests.tid(p), p_regex;
    if v is not null then
      out := out || string_to_array(v, ',');
    end if;
  end loop;
  return out;
end $$;

-- A digest of everything the tenant owns (every table with a tenant_id, every row, as text): proves "untouched".
create or replace function tests.er_digest(p text) returns text
language plpgsql as $$
declare
  r record;
  v text;
  acc text := '';
begin
  for r in
    select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'tenant_id' order by 1
  loop
    execute format('select coalesce(md5(string_agg(x::text, ''~'' order by x::text)), '''') from public.%I x where x.tenant_id = $1', r.table_name) into v using tests.tid(p);
    acc := acc || r.table_name || ':' || v || ';';
  end loop;
  return md5(acc);
end $$;

-- ============================================================================ real-data gate (T006b M2, ADR 0015)
-- Open the real-data gate for fixture tenant p ('a' / 'b') the way the operator does (as the database owner). Tests that plant real-looking
-- phone numbers or addresses (the erasure canaries) call this first: it is the world in which erasure matters.
create or replace function tests.open_gate(p text) returns void
language plpgsql as $$
begin
  perform app.operator_open_real_data_gate((select slug from public.tenants where id = tests.tid(p)),
    'adr:0014', 'doc:hosting-staging',
    -- job CR: a workspace that keeps student records (module `programmes`) opens only with the CHILDREN's review reference
    case when app.module_enabled(tests.tid(p), 'programmes') then 'dpdp-children:review' else 'doc:dpdp-review' end, 'doc:restore-drill');
end $$;


-- Run following statements at a given assurance level (ADR 0016): tests.as_aal('aal1') / 'aal2' / 'absent'. Transaction-local.
create or replace function tests.as_aal(p text) returns void
language plpgsql as $$
begin
  perform set_config('tests.jwt_aal', p, true);
end $$;

-- job CP: put fixture tenant p on the newest version of pack `code` (construction_materials, education or textiles), with its custom fields, as a sign-up does.
drop function if exists tests.cp_pack(text, text);
create function tests.cp_pack(p text, p_code text) returns void
language plpgsql as $$
declare
  v packs.pack_versions;
begin
  select * into v from packs.pack_versions x where x.code = p_code order by x.version desc limit 1;
  update packs.workspace_pack w set pack_code = v.code, pack_version = v.version, source = 'operator' where w.tenant_id = tests.tid(p);
  perform app.apply_pack_fields(tests.tid(p), v.code, v.version, tests.uid(p || '_owner'));
end $$;
