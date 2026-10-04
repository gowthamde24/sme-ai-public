-- Shape of the T003 schema: tables, columns, enums, keys (composite!), indexes, triggers.
begin;
select no_plan();

select has_table('public', t, t || ' exists')
from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities', 'consent_events']) t;

-- ---------------------------------------------------------------- enums
select enum_has_labels('public', 'company_type', array['prospect', 'customer', 'supplier', 'other']);
select enum_has_labels('public', 'lead_status', array['new', 'in_review', 'qualified', 'disqualified']);
select enum_has_labels('public', 'opportunity_status', array['open', 'won', 'lost']);
select enum_has_labels('public', 'record_origin', array['manual', 'import', 'agent']);
select enum_has_labels('public', 'consent_status', array['unknown', 'granted', 'withdrawn']);
select enum_has_labels('public', 'suppression_reason', array['opted_out', 'bounced', 'complained', 'legal', 'manual']);
select enum_has_labels('public', 'consent_channel', array['email', 'whatsapp', 'phone']);
select enum_has_labels('public', 'consent_event_type', array['granted', 'withdrawn', 'suppressed', 'suppression_lifted']);
select enum_has_labels('public', 'evidence_type', array['web_form', 'email_reply', 'verbal', 'written', 'imported', 'other']);

-- ----------------------------------------------- columns the product decisions asked for
select has_column('public', 'companies', c, 'companies.' || c) from unnest(array['type', 'tags', 'name', 'website', 'country', 'region', 'city', 'industry', 'archived_at']) c;
select has_column('public', 'products', 'attributes', 'products.attributes (size-capped jsonb)');
select has_column('public', 'contacts', c, 'contacts.' || c)
from unnest(array['full_name', 'email', 'phone', 'job_title', 'email_consent', 'whatsapp_consent', 'phone_consent', 'suppressed_at', 'suppression_reason']) c;
select has_column('public', 'consent_events', c, 'consent_events.' || c)
from unnest(array['contact_id', 'event_type', 'channel', 'basis', 'evidence_type', 'evidence_ref', 'suppression_reason', 'recorded_by']) c;
select hasnt_column('public', 'consent_events', 'evidence_note', 'no free-text evidence note exists');
select hasnt_column('public', 'opportunities', 'stage', 'pipeline stages are deferred');
select hasnt_column('public', 'opportunities', 'value_estimate', 'value_estimate is deferred');

-- No price (or money-shaped) column anywhere in the CRM tables: pricing belongs to the
-- deterministic quote service (CLAUDE.md #4).
select is(
  (select coalesce(string_agg(table_name || '.' || column_name, ', '), '')
     from information_schema.columns
    where table_schema = 'public'
      and table_name in ('companies', 'contacts', 'products', 'leads', 'opportunities', 'consent_events')
      and column_name ~* '(^|_)(price|prices|cost|amount|discount|margin|value|revenue|currency|total|mrp|rate)(_|$)'),
  '', 'no price / money columns in the CRM tables');

-- ----------------------------------------------------------- keys
select is(
  (select count(*) from pg_constraint c
    where c.conrelid = 'public.memberships'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['tenant_id', 'user_id']),
  1::bigint, 'memberships has unique (tenant_id, user_id): the target of the owner foreign keys');

select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = format('public.%I', t)::regclass and c.contype = 'u'
             and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                   where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['id', 'tenant_id']),
  t || ' has unique (tenant_id, id): the target of composite foreign keys')
from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities', 'consent_events']) t;

select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = 'public.contacts'::regclass and c.contype = 'u'
             and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                   where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['company_id', 'id', 'tenant_id']),
  'contacts has unique (tenant_id, id, company_id): proves "this contact belongs to this company"');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.products'::regclass and c.contype = 'u'
  and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
        where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['sku', 'tenant_id']),
  'products has unique (tenant_id, sku)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'contacts_tenant_email_key'
  and indexdef ilike '%(tenant_id, lower(email))%'), 'contacts has a per-tenant unique index on lower(email)');

-- ----------------------------------------- every reference is a COMPOSITE foreign key
select fk_ok('public', 'contacts', array['tenant_id', 'company_id'], 'public', 'companies', array['tenant_id', 'id']);
select fk_ok('public', 'leads', array['tenant_id', 'company_id'], 'public', 'companies', array['tenant_id', 'id']);
select fk_ok('public', 'leads', array['tenant_id', 'contact_id'], 'public', 'contacts', array['tenant_id', 'id']);
select fk_ok('public', 'leads', array['tenant_id', 'contact_id', 'company_id'], 'public', 'contacts', array['tenant_id', 'id', 'company_id']);
select fk_ok('public', 'leads', array['tenant_id', 'owner_user_id'], 'public', 'memberships', array['tenant_id', 'user_id']);
select fk_ok('public', 'opportunities', array['tenant_id', 'company_id'], 'public', 'companies', array['tenant_id', 'id']);
select fk_ok('public', 'opportunities', array['tenant_id', 'contact_id'], 'public', 'contacts', array['tenant_id', 'id']);
select fk_ok('public', 'opportunities', array['tenant_id', 'contact_id', 'company_id'], 'public', 'contacts', array['tenant_id', 'id', 'company_id']);
select fk_ok('public', 'opportunities', array['tenant_id', 'lead_id'], 'public', 'leads', array['tenant_id', 'id']);
select fk_ok('public', 'opportunities', array['tenant_id', 'owner_user_id'], 'public', 'memberships', array['tenant_id', 'user_id']);
select fk_ok('public', 'consent_events', array['tenant_id', 'contact_id'], 'public', 'contacts', array['tenant_id', 'id']);

-- Owner references null ONLY the owner column when a member is removed (never tenant_id).
select is(
  (select count(*) from pg_constraint c
    where c.contype = 'f' and c.conrelid in ('public.leads'::regclass, 'public.opportunities'::regclass)
      and c.confrelid = 'public.memberships'::regclass
      and c.confdeltype = 'n'
      and (select array_agg(a.attname::text) from pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = any (c.confdelsetcols)) = array['owner_user_id']),
  2::bigint, 'owner foreign keys are ON DELETE SET NULL (owner_user_id) and nothing else');

-- -------------------------------------------------- indexes for keyset pagination
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = format('public.%I', t)::regclass
             and (select array_agg(a.attname::text order by k.ord)
                    from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
                 = array['tenant_id', 'created_at', 'id']),
  t || ' has an index (tenant_id, created_at, id) for keyset pagination')
from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities', 'consent_events']) t;

-- --------------------------------------------------------------- triggers
select has_trigger('public', t, t || '_forbid_tenant_id_change', t || ': tenant_id is immutable')
from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities']) t;
select has_trigger('public', t, t || '_set_created_meta', t || ': created_by / created_via are server-set')
from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities']) t;
select has_trigger('public', t, t || '_guard_archive', t || ': archiving is Admin+ (trigger)')
from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities']) t;
select has_trigger('public', 'opportunities', 'opportunities_guard_status', 'opportunity state machine');
select has_trigger('public', 'consent_events', 'consent_events_no_update', 'ledger: UPDATE blocked');
select has_trigger('public', 'consent_events', 'consent_events_no_delete', 'ledger: DELETE blocked');
select has_trigger('public', 'consent_events', 'consent_events_no_truncate', 'ledger: TRUNCATE blocked');

-- RLS forced everywhere (the generic guard in 06 also checks this for any future table)
select is(
  (select count(*) from pg_class c
    where c.oid = any (array['public.companies'::regclass, 'public.contacts'::regclass, 'public.products'::regclass,
                             'public.leads'::regclass, 'public.opportunities'::regclass, 'public.consent_events'::regclass])
      and c.relrowsecurity and c.relforcerowsecurity),
  6::bigint, 'RLS is enabled and forced on all six CRM tables');

select * from finish();
rollback;
