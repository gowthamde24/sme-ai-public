-- T005 / milestone 1: SHAPE of the lead-review tables (ADR 0010): icp_config_versions, lead_labels,
-- data_exports, import_batches, import_rows. Behaviour is in 24..28.
begin;
select no_plan();

select has_table('public', t, t || ' exists')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;

-- ---------------------------------------------------------------- enums
select enum_has_labels('public', 'lead_label', array['good', 'bad', 'maybe']);
select enum_has_labels('public', 'lead_label_reason', array[
  'not_our_market', 'wrong_product', 'too_small', 'too_large', 'inactive', 'not_a_business',
  'no_contact_route', 'already_customer', 'duplicate', 'insufficient_info', 'payment_risk']);
select is((select count(*) from pg_enum where enumtypid = 'public.lead_label_reason'::regtype), 11::bigint, 'exactly 11 reason codes');
select enum_has_labels('public', 'import_outcome', array['created', 'skipped_duplicate', 'ambiguous', 'rejected']);
select enum_has_labels('public', 'import_reason', array[
  'invalid_row', 'unknown_field', 'company_name_missing', 'contact_requires_email', 'contact_name_missing',
  'contact_domain_not_reserved', 'contact_phone_not_reserved', 'contact_belongs_to_other_company',
  'archived_company', 'ambiguous_company', 'existing_open_lead', 'invalid_attribute', 'data_rejected']);
select enum_has_labels('public', 'export_kind', array['lead_labels']);
select enum_has_labels('public', 'export_format', array['csv', 'json']);

-- ---------------------------------------------------------------- columns
select has_column('public', 'icp_config_versions', c, 'icp_config_versions.' || c)
from unnest(array['id', 'tenant_id', 'version_no', 'engine', 'schema_version', 'config', 'config_sha256', 'created_by', 'created_via', 'created_at']) c;
select has_column('public', 'lead_labels', c, 'lead_labels.' || c)
from unnest(array['id', 'tenant_id', 'lead_id', 'label', 'reason_code', 'icp_version_id', 'score', 'score_max_reachable', 'snapshot', 'created_by', 'created_via', 'created_at']) c;
select has_column('public', 'data_exports', c, 'data_exports.' || c)
from unnest(array['id', 'tenant_id', 'kind', 'format', 'row_count', 'content_sha256', 'created_by', 'created_via', 'created_at']) c;
select has_column('public', 'import_batches', c, 'import_batches.' || c)
from unnest(array['id', 'tenant_id', 'label', 'content_sha256', 'row_count', 'created_count', 'duplicate_count', 'ambiguous_count',
                  'rejected_count', 'companies_created', 'contacts_created', 'claims_created', 'created_by', 'created_via', 'created_at']) c;
select has_column('public', 'import_rows', c, 'import_rows.' || c)
from unnest(array['id', 'tenant_id', 'batch_id', 'row_no', 'outcome', 'reason', 'constraint_name', 'sqlstate', 'company_id', 'contact_id',
                  'lead_id', 'company_created', 'contact_created', 'attributes_written', 'attributes_kept', 'created_by', 'created_via', 'created_at']) c;

-- Scope decisions (owner-approved): all five are append-only (no archive, no updated_at); labels carry no
-- free text; the batch record holds no file, filename or cell, and the row record holds ids and codes only.
select hasnt_column('public', t, c, t || ' has no ' || c)
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t,
     unnest(array['archived_at', 'updated_at']) c;
select hasnt_column('public', 'lead_labels', c, 'lead_labels has no ' || c)
from unnest(array['note', 'comment', 'reason', 'free_text', 'text']) c;
select hasnt_column('public', 'import_batches', c, 'import_batches has no ' || c)
from unnest(array['filename', 'file_name', 'csv', 'content', 'raw', 'payload', 'rows']) c;
select hasnt_column('public', 'import_rows', c, 'import_rows has no ' || c)
from unnest(array['value', 'values', 'cells', 'raw', 'payload', 'email', 'full_name', 'name', 'phone', 'website', 'company_name']) c;
select hasnt_column('public', 'data_exports', c, 'data_exports has no ' || c)
from unnest(array['content', 'body', 'filename', 'payload']) c;

-- ----------------------------------------------------------------- no money columns
select is(
  (select coalesce(string_agg(table_name || '.' || column_name, ', '), '')
     from information_schema.columns
    where table_schema = 'public'
      and table_name in ('icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows')
      and column_name ~* '(^|_)(price|prices|cost|amount|discount|margin|revenue|currency|total|mrp|rate)(_|$)'),
  '', 'no price / money columns');

-- ---------------------------------------------------------------- keys
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = format('public.%I', t)::regclass and c.contype = 'u'
             and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                   where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['id', 'tenant_id']),
  t || ' has unique (tenant_id, id)')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.icp_config_versions'::regclass and c.contype = 'u'
  and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['tenant_id', 'version_no']),
  'icp_config_versions: unique (tenant_id, version_no)');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.import_rows'::regclass and c.contype = 'u'
  and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['batch_id', 'row_no', 'tenant_id']),
  'import_rows: unique (tenant_id, batch_id, row_no)');

select fk_ok('public', 'lead_labels', array['tenant_id', 'lead_id'], 'public', 'leads', array['tenant_id', 'id']);
select fk_ok('public', 'lead_labels', array['tenant_id', 'icp_version_id'], 'public', 'icp_config_versions', array['tenant_id', 'id']);
select fk_ok('public', 'import_rows', array['tenant_id', 'batch_id'], 'public', 'import_batches', array['tenant_id', 'id']);
select fk_ok('public', 'import_rows', array['tenant_id', 'company_id'], 'public', 'companies', array['tenant_id', 'id']);
select fk_ok('public', 'import_rows', array['tenant_id', 'contact_id'], 'public', 'contacts', array['tenant_id', 'id']);
select fk_ok('public', 'import_rows', array['tenant_id', 'lead_id'], 'public', 'leads', array['tenant_id', 'id']);
select is((select count(*) from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.lead_labels'::regclass and c.confrelid <> 'public.tenants'::regclass),
  2::bigint, 'lead_labels has exactly two references besides the tenant (lead, icp version)');
select is((select count(*) from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.import_rows'::regclass and c.confrelid <> 'public.tenants'::regclass),
  4::bigint, 'import_rows has exactly four references besides the tenant (batch, company, contact, lead)');
select is((select count(*) from pg_constraint c where c.contype = 'f'
            and c.conrelid in ('public.icp_config_versions'::regclass, 'public.data_exports'::regclass, 'public.import_batches'::regclass)
            and c.confrelid <> 'public.tenants'::regclass),
  0::bigint, 'the other three tables reference nothing but the tenant');
-- the batch reference is checked at commit: the batch row is written after its rows, in one transaction
select ok((select condeferrable and condeferred from pg_constraint c
            where c.conrelid = 'public.import_rows'::regclass and c.contype = 'f' and c.confrelid = 'public.import_batches'::regclass),
  'import_rows -> import_batches is DEFERRABLE INITIALLY DEFERRED');
select is(
  (select coalesce(string_agg(c.conname, ', '), '') from pg_constraint c
    where c.contype = 'f' and c.conrelid in ('public.icp_config_versions'::regclass, 'public.lead_labels'::regclass, 'public.data_exports'::regclass,
                                             'public.import_batches'::regclass, 'public.import_rows'::regclass)
      and (c.confdeltype <> 'a' and not (c.confrelid = 'public.tenants'::regclass and c.confdeltype = 'r'))),
  '', 'no foreign key of the new tables cascades or sets null');

-- ---------------------------------------------------------------- CHECK constraints exist
select is((select count(*) from pg_constraint c where c.conrelid = 'public.lead_labels'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ~ 'label <> ''bad'''), 1::bigint, 'lead_labels: a Bad label requires a reason (CHECK)');
select is((select count(*) from pg_constraint c where c.conrelid = 'public.lead_labels'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ~ 'icp_version_id IS NULL' and pg_get_constraintdef(c.oid) ~ 'snapshot IS NULL'), 1::bigint,
  'lead_labels: the score snapshot is all-or-nothing (CHECK)');
select is((select count(*) from pg_constraint c where c.conrelid = 'public.lead_labels'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ~ 'score <= score_max_reachable'), 1::bigint, 'lead_labels: score <= max reachable (CHECK)');
select is((select count(*) from pg_constraint c where c.conrelid = 'public.import_batches'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ~ 'row_count = '), 1::bigint, 'import_batches: row_count = the sum of the outcomes (CHECK)');
select is((select count(*) from pg_constraint c where c.conrelid = 'public.import_rows'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ~ 'outcome = ''created'''), 2::bigint, 'import_rows: reason and lead id follow the outcome (two CHECKs)');

-- ---------------------------------------------------------------- indexes
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = format('public.%I', t)::regclass
             and (select array_agg(a.attname::text order by k.ord)
                    from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
                 = array['tenant_id', 'created_at', 'id']),
  t || ' has an index (tenant_id, created_at, id) for keyset pagination')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select ok(exists (select 1 from pg_index i where i.indrelid = 'public.lead_labels'::regclass
   and (select array_agg(a.attname::text order by k.ord) from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = array['tenant_id', 'lead_id', 'created_by', 'created_at', 'id']),
  'lead_labels: index (tenant_id, lead_id, created_by, created_at, id) for "latest label per lead and reviewer"');
select ok(exists (select 1 from pg_index i where i.indrelid = 'public.claims'::regclass and i.indpred is not null
   and (select array_agg(a.attname::text order by k.ord) from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = array['tenant_id', 'company_id', 'predicate', 'created_at', 'id']),
  'claims: partial index (tenant_id, company_id, predicate, created_at, id): the newest claim per (company, predicate)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'companies' and indexdef ~ 'app\.match_key\(name\)' and indexdef ~ '\(tenant_id, '),
  'companies: expression index on (tenant_id, app.match_key(name))');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'companies' and indexdef ~ 'app\.website_host\(website\)' and indexdef ~ '\(tenant_id, '),
  'companies: expression index on (tenant_id, app.website_host(website))');

-- ---------------------------------------------------------------- triggers
select has_trigger('public', t, t || '_forbid_tenant_id_change', t || ': tenant_id is immutable')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select has_trigger('public', t, t || '_set_created_meta', t || ': created_by / created_via are server-set')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select has_trigger('public', t, t || '_guard_immutable', t || ': append-only (trigger)')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select has_trigger('public', 'icp_config_versions', 'icp_config_versions_assign_version', 'icp_config_versions: version number and hash are server-assigned');
select ok(exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t)::regclass and g.tgfoid = 'app.audit_row_change()'::regprocedure and not g.tgisinternal),
  t || ': audited')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select is(
  (select (regexp_split_to_array(encode(g.tgargs, 'escape'), '\\000'))[2] from pg_trigger g
    where g.tgrelid = 'public.import_batches'::regclass and g.tgfoid = 'app.audit_row_change()'::regprocedure),
  'label', 'audit(import_batches): the label is PII (audited by name only)');

-- ---------------------------------------------------------------- grants: column level, append-only
select is(has_table_privilege('authenticated', format('public.%I', t)::regclass, 'DELETE'), false, t || ': no DELETE grant')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select is(has_any_column_privilege('authenticated', format('public.%I', t)::regclass, 'UPDATE'), false, t || ': no UPDATE grant on any column')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select is(has_table_privilege('anon', format('public.%I', t)::regclass, 'SELECT'), false, t || ': anon has no SELECT')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports', 'import_batches', 'import_rows']) t;
select is(has_any_column_privilege('authenticated', format('public.%I', t)::regclass, 'INSERT'), false,
  t || ': no INSERT grant at all (only public.import_lead_rows writes it)')
from unnest(array['import_batches', 'import_rows']) t;

select is(
  (select array_agg(a.attname::text order by a.attname) from pg_attribute a
    where a.attrelid = 'public.icp_config_versions'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.icp_config_versions'::regclass, a.attname, 'INSERT')),
  (select array_agg(x order by x) from unnest(array['id', 'tenant_id', 'engine', 'schema_version', 'config']) x), 'icp_config_versions: INSERT columns');
select is(
  (select array_agg(a.attname::text order by a.attname) from pg_attribute a
    where a.attrelid = 'public.lead_labels'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.lead_labels'::regclass, a.attname, 'INSERT')),
  (select array_agg(x order by x) from unnest(array['id', 'tenant_id', 'lead_id', 'label', 'reason_code', 'icp_version_id', 'score', 'score_max_reachable', 'snapshot']) x),
  'lead_labels: INSERT columns');
select is(
  (select array_agg(a.attname::text order by a.attname) from pg_attribute a
    where a.attrelid = 'public.data_exports'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.data_exports'::regclass, a.attname, 'INSERT')),
  (select array_agg(x order by x) from unnest(array['id', 'tenant_id', 'kind', 'format', 'row_count', 'content_sha256']) x), 'data_exports: INSERT columns');

-- ---------------------------------------------------------------- RLS + policies
select is(
  (select count(*) from pg_class c
    where c.oid = any (array['public.icp_config_versions'::regclass, 'public.lead_labels'::regclass, 'public.data_exports'::regclass,
                             'public.import_batches'::regclass, 'public.import_rows'::regclass])
      and c.relrowsecurity and c.relforcerowsecurity),
  5::bigint, 'RLS is enabled and forced on all five tables');
select is((select string_agg(p.cmd::text, ',' order by p.cmd::text) from pg_policies p where p.schemaname = 'public' and p.tablename = t),
  'INSERT,SELECT', t || ': select and insert policies only (no update, no delete)')
from unnest(array['icp_config_versions', 'lead_labels', 'data_exports']) t;
select is((select string_agg(p.cmd::text, ',' order by p.cmd::text) from pg_policies p where p.schemaname = 'public' and p.tablename = t),
  'SELECT', t || ': a select policy only (rows are written by the definer function)')
from unnest(array['import_batches', 'import_rows']) t;
select is((select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('icp_config_versions', 'data_exports')
             and p.cmd = 'INSERT' and p.with_check ~ 'owner' and p.with_check ~ 'admin' and p.with_check !~ 'sales' and p.with_check !~ 'viewer'),
  2::bigint, 'icp_config_versions and data_exports: Owner / Admin insert only');
select is((select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'lead_labels'
             and p.cmd = 'INSERT' and p.with_check ~ 'owner' and p.with_check ~ 'admin' and p.with_check ~ 'sales' and p.with_check !~ 'viewer'),
  1::bigint, 'lead_labels: Owner / Admin / Sales insert');
select is((select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'data_exports'
             and p.cmd = 'SELECT' and p.qual ~ 'owner' and p.qual ~ 'admin' and p.qual !~ 'sales'),
  1::bigint, 'data_exports: only Owner / Admin read');

-- ---------------------------------------------------------------- classification
select is(coalesce(col_description(format('public.%I', t)::regclass, (select attnum from pg_attribute where attrelid = format('public.%I', t)::regclass and attname = c)), '') ~ '^(PII|SAFE):',
  true, t || '.' || c || ' is classified')
from (values ('icp_config_versions', 'engine'), ('icp_config_versions', 'config'), ('icp_config_versions', 'config_sha256'),
             ('lead_labels', 'snapshot'), ('data_exports', 'content_sha256'), ('import_batches', 'label'),
             ('import_batches', 'content_sha256'), ('import_rows', 'constraint_name'), ('import_rows', 'sqlstate')) v(t, c);
select is(col_description('public.import_batches'::regclass, (select attnum from pg_attribute where attrelid = 'public.import_batches'::regclass and attname = 'label')) ~ '^PII:',
  true, 'import_batches.label is PII (a person could name a batch after themselves)');

-- ---------------------------------------------------------------- functions
select has_function('app', 'match_key', array['text'], 'app.match_key(text) exists');
select has_function('app', 'website_host', array['text'], 'app.website_host(text) exists');
select has_function('app', 'is_shared_host', array['text'], 'app.is_shared_host(text) exists');
select has_function('public', 'import_lead_rows', array['uuid', 'uuid', 'jsonb', 'text', 'boolean'], 'public.import_lead_rows exists');
select has_function('app', 'assign_icp_version', 'app.assign_icp_version exists');

select * from finish();
rollback;
