-- T004 / milestone 1: SHAPE of the evidence model (ADR 0008): tables, enums, columns, keys
-- (composite!), indexes, triggers, grants, classification comments. Behaviour is in 19 / 20.
begin;
select no_plan();

select has_table('public', t, t || ' exists') from unnest(array['evidence', 'evidence_links', 'claims']) t;

-- ---------------------------------------------------------------- enums
select enum_has_labels('public', 'evidence_kind', array['web_page', 'document', 'email', 'listing', 'registry', 'note', 'import_batch']);
select enum_has_labels('public', 'evidence_stance', array['supports', 'contradicts', 'context']);
select enum_has_labels('public', 'claim_confidence', array['unverified', 'low', 'medium', 'high']);

-- ---------------------------------------------------------------- columns
select has_column('public', 'evidence', c, 'evidence.' || c)
from unnest(array['id', 'tenant_id', 'kind', 'provider', 'url', 'reference', 'snippet', 'retrieved_at', 'published_at',
                  'created_by', 'created_via', 'created_at', 'archived_at']) c;
select has_column('public', 'evidence_links', c, 'evidence_links.' || c)
from unnest(array['id', 'tenant_id', 'evidence_id', 'company_id', 'lead_id', 'claim_id', 'stance',
                  'created_by', 'created_via', 'created_at', 'archived_at']) c;
select has_column('public', 'claims', c, 'claims.' || c)
from unnest(array['id', 'tenant_id', 'company_id', 'lead_id', 'predicate', 'value', 'confidence',
                  'created_by', 'created_via', 'created_at', 'archived_at']) c;

-- Scope decisions (owner-approved): no contact / opportunity targets, no supersede chain, no
-- claim review state, no numeric score, no body/hash, no updated_at (these tables are immutable).
select hasnt_column('public', 'evidence_links', c, 'evidence_links has no ' || c)
from unnest(array['contact_id', 'opportunity_id', 'supersedes_id', 'updated_at']) c;
select hasnt_column('public', 'evidence', c, 'evidence has no ' || c)
from unnest(array['supersedes_id', 'superseded_by_id', 'updated_at', 'body', 'content', 'content_hash', 'title']) c;
select hasnt_column('public', 'claims', c, 'claims has no ' || c)
from unnest(array['supersedes_id', 'contact_id', 'opportunity_id', 'review_status', 'score', 'updated_at']) c;

-- Uncertainty is always stated: confidence has no default and may not be NULL. A source is
-- always classified. The stance column has no default (NULL unless the link is to a claim).
select col_not_null('public', 'claims', 'confidence', 'claims.confidence is NOT NULL');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'claims' and column_name = 'confidence'), null,
  'claims.confidence has no default: uncertainty is always stated by the writer');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'evidence_links' and column_name = 'stance'), null,
  'evidence_links.stance has no default');
select col_not_null('public', 'evidence', c, 'evidence.' || c || ' is NOT NULL') from unnest(array['kind', 'provider', 'retrieved_at']) c;
select col_not_null('public', 'claims', c, 'claims.' || c || ' is NOT NULL') from unnest(array['predicate', 'value']) c;

-- No money-shaped columns. (claims.value is a text fact about a company; prices belong to the
-- deterministic quote service, CLAUDE.md #4.)
select is(
  (select coalesce(string_agg(table_name || '.' || column_name, ', '), '')
     from information_schema.columns
    where table_schema = 'public' and table_name in ('evidence', 'evidence_links', 'claims')
      and column_name ~* '(^|_)(price|prices|cost|amount|discount|margin|revenue|currency|total|mrp|rate)(_|$)'),
  '', 'no price / money columns in the evidence tables');

-- ------------------------------------------------------------------ keys
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = format('public.%I', t)::regclass and c.contype = 'u'
             and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                   where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['id', 'tenant_id']),
  t || ' has unique (tenant_id, id): the target of composite foreign keys')
from unnest(array['evidence', 'evidence_links', 'claims']) t;

-- Every reference is a COMPOSITE foreign key, and the exact set of references is the approved one.
select fk_ok('public', 'evidence_links', array['tenant_id', 'evidence_id'], 'public', 'evidence', array['tenant_id', 'id']);
select fk_ok('public', 'evidence_links', array['tenant_id', 'company_id'], 'public', 'companies', array['tenant_id', 'id']);
select fk_ok('public', 'evidence_links', array['tenant_id', 'lead_id'], 'public', 'leads', array['tenant_id', 'id']);
select fk_ok('public', 'evidence_links', array['tenant_id', 'claim_id'], 'public', 'claims', array['tenant_id', 'id']);
select fk_ok('public', 'claims', array['tenant_id', 'company_id'], 'public', 'companies', array['tenant_id', 'id']);
select fk_ok('public', 'claims', array['tenant_id', 'lead_id'], 'public', 'leads', array['tenant_id', 'id']);
select is(
  (select count(*) from pg_constraint c
    where c.contype = 'f' and c.conrelid = 'public.evidence_links'::regclass and c.confrelid <> 'public.tenants'::regclass),
  5::bigint, 'evidence_links has exactly five references besides the tenant (evidence, company, lead, claim, and since T006 the agent run)');
select is(
  (select count(*) from pg_constraint c
    where c.contype = 'f' and c.conrelid = 'public.claims'::regclass and c.confrelid <> 'public.tenants'::regclass),
  4::bigint, 'claims has exactly four references besides the tenant (company, lead, the agent run since T006, the source lead since T007)');
select is(
  (select count(*) from pg_constraint c
    where c.contype = 'f' and c.conrelid = 'public.evidence'::regclass and c.confrelid <> 'public.tenants'::regclass),
  1::bigint, 'evidence references only agent_runs (T006 provenance); links point at it, never the other way');

-- No cascade of any kind: a parent cannot be removed out from under its evidence.
select is(
  (select coalesce(string_agg(c.conname, ', '), '') from pg_constraint c
    where c.contype = 'f' and c.conrelid in ('public.evidence'::regclass, 'public.evidence_links'::regclass, 'public.claims'::regclass)
      and (c.confdeltype <> 'a' and not (c.confrelid = 'public.tenants'::regclass and c.confdeltype = 'r'))),
  '', 'no foreign key of the evidence tables cascades or sets null (tenants: RESTRICT, others: NO ACTION)');

-- ---------------------------------------------------------------- CHECK constraints exist
select is(
  (select count(*) from pg_constraint c
    where c.conrelid = 'public.evidence_links'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ 'num_nonnulls'),
  1::bigint, 'evidence_links has the exactly-one-target CHECK');
select is(
  (select count(*) from pg_constraint c
    where c.conrelid = 'public.evidence_links'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ 'stance IS NULL'),
  1::bigint, 'evidence_links has the (claim_id is null) = (stance is null) CHECK');
select is(
  (select count(*) from pg_constraint c
    where c.conrelid = 'public.claims'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ 'num_nonnulls'),
  1::bigint, 'claims has the exactly-one-subject CHECK');
select is(
  (select count(*) from pg_constraint c
    where c.conrelid = 'public.evidence'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ 'published_at <= retrieved_at'),
  1::bigint, 'published_at <= retrieved_at is a CHECK (immutable expression)');
select is(
  (select count(*) from pg_constraint c
    where c.conrelid = 'public.evidence'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~* 'now\('),
  0::bigint, 'no CHECK uses now(): the future-date rule is a trigger');

-- ---------------------------------------------------------------- indexes
-- keyset pagination
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = format('public.%I', t)::regclass
             and (select array_agg(a.attname::text order by k.ord)
                    from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
                 = array['tenant_id', 'created_at', 'id']),
  t || ' has an index (tenant_id, created_at, id) for keyset pagination')
from unnest(array['evidence', 'evidence_links', 'claims']) t;

-- One partial UNIQUE index per link target: a (target, evidence) pair exists once, and the same
-- index is the child-side index of the target's composite FK (it leads with tenant_id, target).
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = 'public.evidence_links'::regclass and i.indisunique and i.indpred is not null
             and (select array_agg(a.attname::text order by k.ord)
                    from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
                 = array['tenant_id', col, 'evidence_id']),
  'evidence_links: partial unique index (tenant_id, ' || col || ', evidence_id) where ' || col || ' is not null')
from unnest(array['company_id', 'lead_id', 'claim_id']) col;

-- ---------------------------------------------------------------- triggers
select has_trigger('public', t, t || '_forbid_tenant_id_change', t || ': tenant_id is immutable')
from unnest(array['evidence', 'evidence_links', 'claims']) t;
select has_trigger('public', t, t || '_set_created_meta', t || ': created_by / created_via are server-set')
from unnest(array['evidence', 'evidence_links', 'claims']) t;
select has_trigger('public', t, t || '_guard_archive', t || ': archiving is Admin+ (trigger)')
from unnest(array['evidence', 'evidence_links', 'claims']) t;
select has_trigger('public', t, t || '_guard_immutable', t || ': only archived_at can ever change (trigger)')
from unnest(array['evidence', 'evidence_links', 'claims']) t;
select has_trigger('public', 'evidence', 'evidence_guard_retrieved_at', 'evidence: retrieved_at may not be in the future (trigger)');
select ok(not exists (
    select 1 from pg_trigger g where g.tgrelid = 'public.evidence'::regclass and not g.tgisinternal
       and g.tgname = 'evidence_guard_retrieved_at' and (g.tgtype & 4) = 0),
  'the retrieved_at trigger fires on INSERT');

-- Audit triggers carry the exact PII lists (url, snippet and reference are PII; value is PII).
select is(
  (select (regexp_split_to_array(encode(g.tgargs, 'escape'), '\\000'))[2] from pg_trigger g
    where g.tgrelid = 'public.evidence'::regclass and g.tgfoid = 'app.audit_row_change()'::regprocedure),
  'url,snippet,reference', 'audit(evidence): PII list is url,snippet,reference');
select is(
  (select (regexp_split_to_array(encode(g.tgargs, 'escape'), '\\000'))[2] from pg_trigger g
    where g.tgrelid = 'public.claims'::regclass and g.tgfoid = 'app.audit_row_change()'::regprocedure),
  'value', 'audit(claims): PII list is value');
select ok(exists (select 1 from pg_trigger g where g.tgrelid = 'public.evidence_links'::regclass
                    and g.tgfoid = 'app.audit_row_change()'::regprocedure),
  'audit(evidence_links): audited (no PII columns)');

-- ---------------------------------------------------------------- classification comments
select is(col_description('public.evidence'::regclass, (select attnum from pg_attribute where attrelid = 'public.evidence'::regclass and attname = c)) ~ '^PII:', true,
  'evidence.' || c || ' is classified PII')
from unnest(array['url', 'snippet', 'reference']) c;
select is(col_description('public.evidence'::regclass, (select attnum from pg_attribute where attrelid = 'public.evidence'::regclass and attname = c)) ~* 'UNTRUSTED', true,
  'evidence.' || c || ' comment says UNTRUSTED (data, never instructions)')
from unnest(array['url', 'snippet', 'reference']) c;
select is(col_description('public.evidence'::regclass, (select attnum from pg_attribute where attrelid = 'public.evidence'::regclass and attname = 'provider')) ~ '^SAFE:', true,
  'evidence.provider is classified SAFE (slug-constrained)');
select is(col_description('public.claims'::regclass, (select attnum from pg_attribute where attrelid = 'public.claims'::regclass and attname = 'value')) ~ '^PII:.*UNTRUSTED', true,
  'claims.value is PII and UNTRUSTED');
select is(col_description('public.claims'::regclass, (select attnum from pg_attribute where attrelid = 'public.claims'::regclass and attname = 'predicate')) ~ '^SAFE:', true,
  'claims.predicate is classified SAFE (slug-constrained)');

-- Untrusted-content guard (extends 06 for any future evidence-like table): every free-text column
-- classified PII in these three tables must also say UNTRUSTED.
select is(
  (select coalesce(string_agg(c.relname || '.' || a.attname, ', '), '')
     from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.oid in ('public.evidence'::regclass, 'public.claims'::regclass, 'public.evidence_links'::regclass)
      and a.atttypid = 'text'::regtype
      and col_description(c.oid, a.attnum) like 'PII:%'
      and col_description(c.oid, a.attnum) !~* 'UNTRUSTED'),
  '', 'every PII free-text column of the evidence tables is marked UNTRUSTED');

-- ---------------------------------------------------------------- grants: column level
select is(has_table_privilege('authenticated', format('public.%I', t)::regclass, 'DELETE'), false, t || ': no DELETE grant')
from unnest(array['evidence', 'evidence_links', 'claims']) t;
select is(has_table_privilege('authenticated', format('public.%I', t)::regclass, 'UPDATE'), false, t || ': no table-wide UPDATE grant')
from unnest(array['evidence', 'evidence_links', 'claims']) t;
select is(has_table_privilege('anon', format('public.%I', t)::regclass, 'SELECT'), false, t || ': anon has no SELECT')
from unnest(array['evidence', 'evidence_links', 'claims']) t;

-- UPDATE is granted on archived_at ONLY, on all three tables (content is immutable).
select is(
  (select coalesce(string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname), '')
     from (values ('evidence'), ('evidence_links'), ('claims')) t(relname)
     join pg_attribute a on a.attrelid = format('public.%I', t.relname)::regclass and a.attnum > 0 and not a.attisdropped
    where has_column_privilege('authenticated', format('public.%I', t.relname)::regclass, a.attname, 'UPDATE')),
  'claims.archived_at, evidence.archived_at, evidence_links.archived_at',
  'UPDATE is granted on archived_at only');

-- INSERT is granted on exactly the approved client columns.
select is(
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.evidence'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.evidence'::regclass, a.attname, 'INSERT')),
  'id,kind,provider,published_at,reference,retrieved_at,snippet,tenant_id,url', 'evidence: INSERT columns');
select is(
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.evidence_links'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.evidence_links'::regclass, a.attname, 'INSERT')),
  'claim_id,company_id,evidence_id,id,lead_id,stance,tenant_id', 'evidence_links: INSERT columns');
select is(
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.claims'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.claims'::regclass, a.attname, 'INSERT')),
  'company_id,confidence,id,lead_id,predicate,tenant_id,value', 'claims: INSERT columns');

-- ---------------------------------------------------------------- RLS + policies
select is(
  (select count(*) from pg_class c
    where c.oid = any (array['public.evidence'::regclass, 'public.evidence_links'::regclass, 'public.claims'::regclass])
      and c.relrowsecurity and c.relforcerowsecurity),
  3::bigint, 'RLS is enabled and forced on all three evidence tables');
select is(
  (select string_agg(p.cmd::text, ',' order by p.cmd::text) from pg_policies p where p.schemaname = 'public' and p.tablename = t),
  'INSERT,SELECT,UPDATE', t || ': exactly select / insert / update policies (no delete policy)')
from unnest(array['evidence', 'evidence_links', 'claims']) t;
select is(
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('evidence', 'evidence_links', 'claims')
     and p.cmd in ('INSERT', 'UPDATE') and p.with_check ~ 'owner' and p.with_check ~ 'admin' and p.with_check ~ 'sales' and p.with_check !~ 'viewer'),
  6::bigint, 'insert and update policies name owner, admin and sales and not viewer');

select * from finish();
rollback;
