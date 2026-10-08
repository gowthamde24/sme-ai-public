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
        'app.is_tenant_member',
        'app.has_tenant_role',
        'app.my_tenant_ids',
        'app.my_tenant_ids_with_role',
        'app.my_co_member_ids',
        'public.record_consent',
        'public.suppress_contact',
        'public.lift_suppression',
        'app.can_contact',
        'app.text_is_clean',
        'public.create_evidence_with_link',
        'public.import_lead_rows',
        -- T006 (ADR 0013): the agent write path. Every one derives the tenant from the run (or the claim) it is given.
        'public.start_agent_run',
        'public.agent_write_evidence',
        'public.agent_write_claim',
        'public.agent_record_step',
        'public.agent_record_usage',
        'public.finish_agent_run',
        'public.cancel_agent_run',
        'public.set_tenant_agents_enabled',
        'public.review_claim',
        -- T007 M2 / 3: the daily cost cap. Both take a run (or prove the Owner role in the tenant they are given).
        'public.agent_reserve_cost',
        'public.set_tenant_daily_cost_cap',
        'public.agent_release_cost',
        'public.agent_cost_summary',
        -- T006b (ADR 0014): erasure. Each derives the tenant from the request (or proves the role in the tenant it is given).
        'public.request_erasure',
        'public.execute_erasure',
        'public.cancel_erasure',
        'app.match_key',
        'app.website_host',
        -- T008: pure, immutable CHECK helpers of enquiries / requirement_fields (they read nothing)
        'app.text_has_contact',
        'app.requirement_vocab',
        'app.requirement_value_ok',
        -- T008 commit 3: the requirement agent's write and the human decisions. Each derives the tenant from the run (or the row) it is given.
        'public.agent_write_requirement_field',
        'public.decide_requirement_field',
        'public.confirm_requirement',
        'public.discard_requirement',
        -- T008 commit 3b: a human adds a field the extraction missed
        'public.add_requirement_field',
        -- T009 part 1: Owner / Admin publish a price list, a quote policy or a mapper config version (role proven first, then aal2)
        'public.create_price_list_version',
        'public.create_quote_policy_version',
        'public.create_mapper_config_version',
        -- manual-price slice 1: Owner / Admin save an item type and its optional price range (role first, then aal2)
        'public.save_item_type',
        -- T009 part 2: a person picks a product, Sales+ create a draft quote, Owner / Admin approve or reject it (role, and aal2 for approval, proven inside)
        'public.pick_requirement_line_product',
        'public.create_quote_draft',
        'public.approve_quote',
        'public.reject_quote',
        -- T009 part 3: Owner / Admin withdraw an APPROVED quote (role first, then aal2)
        'public.withdraw_approved_quote',
        -- T010 part 1 (ADR 0020): the suppression keys. The role is proven first in every one; aal2 (Owner) for the backfill, the unkeyed list and allowing an erasure without a key.
        'public.record_contact_keys',
        'public.check_suppression',
        'public.unkeyed_contact_count',
        'public.unkeyed_contacts',
        'public.backfill_contact_keys',
        'public.allow_erasure_without_key',
        -- order conversion (ADR 0021): the role is proven first in every one; aal2 for creating a policy or an order, and for a payment, a cancellation, a refund or an override
        'public.create_order_policy_version',
        'public.create_order_from_quote',
        'public.record_order_event',
        -- T010 part 2: touches, the cadence policy, follow-up drafts and question drafts. The role is proven first in every one; aal2 for a policy and for approving a draft
        'public.create_followup_policy_version',
        'public.followup_gate',
        'public.followup_due_candidates',  -- the due list's candidates (a read; role proven first; docs/plans/followups-due-candidates-plan.md)
        'public.record_touch',
        'public.create_followup_draft',
        'public.approve_followup_draft',
        'public.discard_followup_draft',
        'public.record_draft_sent',
        'public.persist_question_drafts',
        'public.decide_question_draft')),
  '', 'authenticated can execute only the allow-listed functions');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where nspname = 'public' and prosecdef
      and fq not in ('public.create_tenant', 'public.record_consent', 'public.suppress_contact', 'public.lift_suppression',
                     'public.import_lead_rows',
                     'public.start_agent_run', 'public.agent_write_evidence', 'public.agent_write_claim', 'public.agent_record_step',
                     'public.agent_record_usage', 'public.finish_agent_run', 'public.cancel_agent_run',
                     'public.set_tenant_agents_enabled', 'public.review_claim',
                     'public.agent_reserve_cost', 'public.set_tenant_daily_cost_cap', 'public.agent_release_cost', 'public.agent_cost_summary',
                     'public.request_erasure', 'public.execute_erasure', 'public.cancel_erasure',
                     'public.agent_write_requirement_field', 'public.decide_requirement_field', 'public.confirm_requirement', 'public.discard_requirement',
                     'public.add_requirement_field',
                     'public.create_price_list_version', 'public.create_quote_policy_version', 'public.create_mapper_config_version', 'public.save_item_type',
                     'public.pick_requirement_line_product', 'public.create_quote_draft', 'public.approve_quote', 'public.reject_quote',
                     'public.withdraw_approved_quote',
                     'public.record_contact_keys', 'public.check_suppression', 'public.unkeyed_contact_count', 'public.unkeyed_contacts', 'public.backfill_contact_keys',
                     'public.allow_erasure_without_key',
                     'public.create_order_policy_version', 'public.create_order_from_quote', 'public.record_order_event',
                     'public.create_followup_policy_version', 'public.followup_gate', 'public.followup_due_candidates', 'public.record_touch', 'public.create_followup_draft', 'public.approve_followup_draft',
                     'public.discard_followup_draft', 'public.record_draft_sent', 'public.persist_question_drafts', 'public.decide_question_draft')),
  '', 'the only SECURITY DEFINER functions in the API schema are create_tenant, the three consent functions, import_lead_rows, the thirteen agent functions (ADR 0013, T007), the five requirement functions (T008), the three quote reference-data functions and the four quote functions (T009) and the three erasure functions (ADR 0014)');
-- Nothing in the private schema that is operator-only may be callable by a client.
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where fq in ('app.operator_enable_selftest', 'app.agent_open_run', 'app.agent_assert_enabled', 'app.agent_args_sha',
                 'app.agent_derived_id', 'app.agent_step_replay',
                 'app.agent_utc_today', 'app.agent_cost_micros', 'app.agent_daily_cap', 'app.agent_day_spend', 'app.agent_cost_lock',
                 'app.erase_column', 'app.erasure_sweep', 'app.erase_contact', 'app.erase_company', 'app.erase_tenant',
                 'app.erasure_running', 'app.erasure_columns', 'app.guard_consent_update', 'app.guard_audit_update',
                 'app.operator_open_real_data_gate', 'app.operator_close_real_data_gate', 'app.operator_add_member',
                 'app.operator_add_owner_exception', 'app.real_data_gate_open', 'app.guard_real_data',
                 'app.operator_reset_mfa', 'app.require_aal2', 'app.guard_aal2_client_write',
                 'app.operator_enable_requirement', 'app.requirement_deny', 'app.requirement_error', 'app.requirement_ws',
                 'app.requirement_confirmable', 'app.enquiry_set_context')
      and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute'))),
  '', 'the agent helpers and the operator function are callable by no client role');

-- Functions the API schema exposes to clients and that are NOT SECURITY DEFINER run with the
-- caller's rights; they must still pin search_path (no hijack through a caller-controlled path).
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where nspname = 'public' and not prosecdef
      and has_function_privilege('authenticated', oid, 'execute')
      and not coalesce('search_path=""' = any (proconfig), false)),
  '', 'every SECURITY INVOKER function in the API schema pins search_path to empty');

-- ---- RLS policy pattern (performance AND correctness; see ADR 0004)
-- Per-row helpers take the row's tenant_id, so Postgres evaluates them once per ROW OF THE TABLE
-- (all tenants' rows). They remain for one-row checks inside functions, never for policies.
select is(
  (select coalesce(string_agg(p.tablename || '.' || p.policyname, ', '), '') from pg_policies p
    where p.schemaname = 'public'
      and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
          ~* '(is_tenant_member|has_tenant_role|shares_tenant_with)'),
  '', 'no policy calls a per-row membership helper');
select is(
  (select coalesce(string_agg(t.relname || '.' || p.polname, ', '), '')
     from tenant_tables t
     join pg_policy p on p.polrelid = t.relid
    where (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) !~ 'my_tenant_ids'),
  '', 'every policy on a tenant-owned table uses app.my_tenant_ids / my_tenant_ids_with_role');

-- Plan-level proof, for every public table with RLS: the caller's tenant list is an InitPlan
-- (once per statement) and there is no per-row SubPlan.
select is(
  (select coalesce(string_agg(c.relname, ', '), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      -- operator-managed tables (agent limits, flags, definitions) grant clients nothing: there is no client plan to inspect
      and has_table_privilege('authenticated', c.oid, 'select')
      and tests.explain_as(tests.uid('a_owner'), format('select * from public.%I', c.relname)) ~ 'SubPlan'),
  '', 'no public table plans a per-row SubPlan for its RLS filter');
select is(
  (select coalesce(string_agg(c.relname, ', '), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      -- operator-managed tables (agent limits, flags, definitions) grant clients nothing: there is no client plan to inspect
      and has_table_privilege('authenticated', c.oid, 'select')
      and tests.explain_as(tests.uid('a_owner'), format('select * from public.%I', c.relname)) !~ 'InitPlan'),
  '', 'every public table plans its RLS filter as an InitPlan');

-- ---- T003 guards: composite keys, audit/PII classification, registry coverage, grants vs matrix
-- Every FK from a tenant-owned table to another tenant-owned table must be COMPOSITE, start with
-- tenant_id on both sides, and never cascade (a SET NULL must name its columns, never tenant_id).
select is(
  (select coalesce(string_agg(c.conname, ', '), '')
     from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.conrelid in (select relid from tenant_tables)
      and c.confrelid in (select relid from tenant_tables)
      and not (
            cardinality(c.conkey) >= 2
        and (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) = 'tenant_id'
        and (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) = 'tenant_id'
      )),
  '', 'every FK between tenant-owned tables is composite and starts with tenant_id');
select cmp_ok(
  (select count(*) from pg_constraint c
    where c.contype = 'f' and c.conrelid in (select relid from tenant_tables) and c.confrelid in (select relid from tenant_tables)),
  '>=', 10::bigint, 'the composite-FK guard is not vacuous');
select is(
  (select coalesce(string_agg(c.conname, ', '), '')
     from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.conrelid in (select relid from tenant_tables)
      -- parents that are tenant-owned (or tenants itself). The one deliberate exception is
      -- memberships.user_id -> users ON DELETE CASCADE (account deletion; ADR 0001 #2).
      and (c.confrelid in (select relid from tenant_tables) or c.confrelid = 'public.tenants'::regclass)
      and (c.confdeltype in ('c', 'd')
           or c.confupdtype in ('c', 'n', 'd')
           or (c.confdeltype = 'n' and (c.confdelsetcols is null
                or (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'tenant_id') = any (c.confdelsetcols))))),
  '', 'no foreign key cascades, sets a default, or nulls tenant_id');
select is(
  (select coalesce(string_agg(c.conname, ', '), '')
     from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.conrelid in (select relid from tenant_tables)
      and not exists (
        select 1 from pg_index i
         where i.indrelid = c.conrelid
           and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)),
  '', 'the child side of every foreign key on a tenant-owned table is indexed');

-- Every tenant-owned table except the audit trail itself has an audit trigger.
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where t.relname <> 'audit_events'
      and not exists (select 1 from pg_trigger g where g.tgrelid = t.relid and not g.tgisinternal
                        and g.tgfoid = 'app.audit_row_change()'::regprocedure)),
  '', 'every tenant-owned table (except audit_events) has an audit trigger');

-- PII classification. audited = tables with app.audit_row_change; the trigger's 2nd argument is the
-- PII column list; column comments 'PII: ...' / 'SAFE: ...' are the registry.
create temp table audited as
select c.oid as relid, c.relname,
       coalesce((regexp_split_to_array(encode(g.tgargs, 'escape'), '\\000'))[2], '') as pii_csv
  from pg_trigger g join pg_class c on c.oid = g.tgrelid
 where g.tgfoid = 'app.audit_row_change()'::regprocedure and not g.tgisinternal and c.relnamespace = 'public'::regnamespace;

select cmp_ok((select count(*) from audited), '>=', 8::bigint, 'audit-trigger table list is not vacuous');
select is(
  (select coalesce(string_agg(a.relname || '.' || at.attname, ', '), '')
     from audited a join pg_attribute at on at.attrelid = a.relid and at.attnum > 0 and not at.attisdropped
    where at.atttypid in ('text'::regtype, 'varchar'::regtype, 'text[]'::regtype, 'jsonb'::regtype)
      and coalesce(col_description(a.relid, at.attnum), '') !~ '^(PII|SAFE):'),
  '', 'every text / text[] / jsonb column of an audited table is classified PII or SAFE (free text defaults to PII)');
select is(
  (select coalesce(string_agg(x.relname || '.' || x.col, ', '), '') from (
     (select a.relname, at.attname::text as col
        from audited a join pg_attribute at on at.attrelid = a.relid and at.attnum > 0 and not at.attisdropped
       where col_description(a.relid, at.attnum) like 'PII:%'
      except
      select a.relname, unnest(case when a.pii_csv = '' then '{}'::text[] else string_to_array(a.pii_csv, ',') end) from audited a)
   ) x),
  '', 'every column marked PII is on its table''s audit-trigger PII list (so it is never audited by value)');
select is(
  (select coalesce(string_agg(x.relname || '.' || x.col, ', '), '') from (
     (select a.relname, unnest(case when a.pii_csv = '' then '{}'::text[] else string_to_array(a.pii_csv, ',') end) as col from audited a
      except
      select a.relname, at.attname::text
        from audited a join pg_attribute at on at.attrelid = a.relid and at.attnum > 0 and not at.attisdropped
       where col_description(a.relid, at.attnum) like 'PII:%')
   ) x),
  '', 'the audit-trigger PII lists contain only columns that are marked PII (no stale entries)');

-- Invisible-Unicode hygiene (T004 hardening, ADR 0008): every text / text[] / jsonb column of a
-- tenant-owned table is guarded by a CHECK that calls app.text_is_clean, OR carries an explicit
-- "CLEAN-EXEMPT: <reason>" comment AND is either limited by a strict anchored pattern (a CHECK
-- `col ~ '^...'`) or cannot be written by any client at all.
select is(
  (select coalesce(string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname), '')
     from tenant_tables t
     join pg_attribute a on a.attrelid = t.relid and a.attnum > 0 and not a.attisdropped
    where a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'text[]'::regtype, 'jsonb'::regtype)
      and not exists (select 1 from pg_constraint k
                       where k.conrelid = t.relid and k.contype = 'c' and a.attnum = any (k.conkey)
                         and pg_get_constraintdef(k.oid) like '%text_is_clean(%')
      and not (
            coalesce(col_description(t.relid, a.attnum), '') ~ 'CLEAN-EXEMPT: .{10,}'
        and (
              exists (select 1 from pg_constraint k
                       where k.conrelid = t.relid and k.contype = 'c' and a.attnum = any (k.conkey)
                         and pg_get_constraintdef(k.oid) ~ '~ ''\^')
           or not (has_column_privilege('authenticated', t.relid, a.attnum, 'INSERT')
                   or has_column_privilege('authenticated', t.relid, a.attnum, 'UPDATE'))
        ))),
  '', 'every free-text column of a tenant-owned table has a text_is_clean CHECK or a documented CLEAN-EXEMPT (strict pattern or not client-writable)');
select cmp_ok(
  (select count(*) from tenant_tables t
     join pg_attribute a on a.attrelid = t.relid and a.attnum > 0 and not a.attisdropped
    where exists (select 1 from pg_constraint k
                   where k.conrelid = t.relid and k.contype = 'c' and a.attnum = any (k.conkey)
                     and pg_get_constraintdef(k.oid) like '%text_is_clean(%')),
  '>=', 24::bigint, 'the hygiene guard is not vacuous (24+ guarded columns)');
select is(
  (select coalesce(string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname), '')
     from tenant_tables t
     join pg_attribute a on a.attrelid = t.relid and a.attnum > 0 and not a.attisdropped
    where col_description(t.relid, a.attnum) like '%CLEAN-EXEMPT%'
      and exists (select 1 from pg_constraint k
                   where k.conrelid = t.relid and k.contype = 'c' and a.attnum = any (k.conkey)
                     and pg_get_constraintdef(k.oid) like '%text_is_clean(%')),
  '', 'no column is both guarded and marked exempt (a stale exemption would hide a gap later)');

-- Registry coverage for the generic cross-tenant test (an unregistered table = a failing guard).
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (select 1 from tests.tenant_table_registry r where r.table_name = t.relname)),
  '', 'every tenant-owned table is registered in tests.tenant_table_registry (fixture builder)');
select is(
  (select coalesce(string_agg(r.table_name, ', '), '') from tests.tenant_table_registry r
    where (select count(*) from tests.role_matrix m where m.table_name = r.table_name) <> 4),
  '', 'every registered table has a role_matrix row for each of the four roles');
select is(
  (select coalesce(string_agg(r.table_name, ', '), '') from tests.tenant_table_registry r
    where not exists (select 1 from tenant_tables t where t.relname = r.table_name)),
  '', 'the registry lists only existing tenant-owned tables');

-- Keyset-pagination index where the registry says it is required.
select is(
  (select coalesce(string_agg(r.table_name, ', '), '') from tests.tenant_table_registry r
    where r.keyset_index_required
      and not exists (
        select 1 from pg_index i
         where i.indrelid = format('public.%I', r.table_name)::regclass
           and (select array_agg(a.attname::text order by k.ord)
                  from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
               = array['tenant_id', 'created_at', 'id'])),
  '', 'every table that needs it has an index (tenant_id, created_at, id) for keyset pagination');

-- The privileges granted to authenticated agree with the role matrix.
select is(
  (select coalesce(string_agg(r.table_name || ':' || p.priv, ', '), '') from tests.tenant_table_registry r,
     (values ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
    where (case p.priv when 'DELETE' then has_table_privilege('authenticated', format('public.%I', r.table_name)::regclass, 'DELETE')
                       else has_any_column_privilege('authenticated', format('public.%I', r.table_name)::regclass, p.priv) end)
          is distinct from (select bool_or(case p.priv when 'INSERT' then can_insert when 'UPDATE' then can_update else can_delete end)
                              from tests.role_matrix m where m.table_name = r.table_name)),
  '', 'authenticated holds INSERT / UPDATE / DELETE on exactly the tables the role matrix lets some role write');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where has_column_privilege('authenticated', t.relid, 'tenant_id', 'UPDATE')),
  '', 'no client can UPDATE tenant_id on any tenant-owned table');
select is(
  (select coalesce(string_agg(t.relname || '.' || a.attname || ':' || p.priv, ', '), '')
     from tenant_tables t
     join pg_attribute a on a.attrelid = t.relid and a.attname in ('created_by', 'created_via', 'created_at', 'updated_at')
    cross join (values ('INSERT'), ('UPDATE')) p(priv)
    where has_column_privilege('authenticated', t.relid, a.attname, p.priv)),
  '', 'server-owned provenance / timestamp columns are not writable by clients on any tenant-owned table');

-- Every policy on a tenant-owned table is for the authenticated role only.
select is(
  (select coalesce(string_agg(t.relname || '.' || p.polname, ', '), '')
     from tenant_tables t join pg_policy p on p.polrelid = t.relid
    where p.polroles <> array[(select oid from pg_roles where rolname = 'authenticated')]),
  '', 'every policy on a tenant-owned table is TO authenticated only');

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

-- ---- service_role (Supabase's key that bypasses RLS) writes nothing in public: the app never uses it (CLAUDE.md non-negotiable 2)
select is(
  (select coalesce(string_agg(c.relname || ':' || p.priv, ', ' order by c.relname, p.priv), '') from pg_class c
     cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv)
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('service_role', c.oid, p.priv)),
  '', 'service_role holds no INSERT / UPDATE / DELETE / TRUNCATE on any public table or view');
select is(has_table_privilege('service_role', 'public.tenants', 'SELECT'), true, '...it keeps SELECT (read-only operator access)');
create table public.zz_guard_probe (id int);
select is(
  (select coalesce(string_agg(p.priv, ','), '') from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv) where has_table_privilege('service_role', 'public.zz_guard_probe', p.priv)),
  '', 'a table created later does not grant service_role writes either (default privileges)');

select * from finish();
rollback;
