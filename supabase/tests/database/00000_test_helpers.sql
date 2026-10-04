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
                else jsonb_build_object('exp', current_setting('tests.jwt_exp', true)::bigint) end)::text,
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
            'Contact ' || p, p || '.contact@example.test', '+91 90000 0000' || (case p when 'a' then 1 else 2 end));
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
      id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at
    ) values (
      tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      n || '@test.local', jsonb_build_object('display_name', n), now(), now()
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
  update public.contacts set full_name = 'Zed Qxjv', email = 'zed.qxjv@canary.test', phone = '+91 98765 43210', job_title = 'Qxjv director' where id = k;
  update public.companies set name = 'Kzv9 Silks', website = 'https://kzv9-silks.test/shop', city = 'Kzv9pur', region = 'Kzv9 State', tags = array['kzv9'] where id = c;
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
