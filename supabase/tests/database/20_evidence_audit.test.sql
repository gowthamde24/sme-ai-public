-- T004 / milestone 1: PII-aware audit for the evidence tables (ADR 0005 / 0008).
-- url, snippet, reference (evidence) and value (claims) are personal data by default: they are
-- recorded by NAME only. Everything else keeps its before/after values. Canary strings are
-- distinctive so a whole-row text scan of audit_events is meaningful.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.audit_text(p_tenant uuid) returns text
language sql as $$ select coalesce(string_agg(to_jsonb(a)::text, E'\n'), '') from public.audit_events a where a.tenant_id = p_tenant $$;

-- ---------------------------------------------------------------- created through the client path
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $q$insert into public.evidence (id, tenant_id, kind, provider, url, reference, snippet, retrieved_at)
     values (%L, %L, 'web_page', 'serper', 'https://canary-host-qq7.example/in/zephyrine-quasimodo?token=canary-tok-91',
             'doc:canary-ref-5521', 'Zephyrine Quasimodo says canary-snippet-8844 about silk exports', '2026-02-03T04:05:06Z')$q$,
  tests.rid('e1'), tests.tid('a'))), 'rows:1', 'setup: sales creates evidence containing personal-looking text');

select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'evidence.create' and entity_id = tests.rid('e1')),
  1::bigint, 'the create is audited (entity evidence)');
select results_eq(
  format($$select (select array_agg(x order by x) from jsonb_array_elements_text(metadata -> 'pii_fields_changed') x), actor_user_id, actor_type, old_values is null
           from public.audit_events where entity_id = %L and action = 'evidence.create'$$, tests.rid('e1')),
  format($$values (array['reference','snippet','url']::text[], %L::uuid, 'user'::text, true)$$, tests.uid('a_sales')),
  'create: the PII FIELD NAMES that were set (url, snippet, reference), the actor, no old values');
select ok(not (select new_values ? 'url' or new_values ? 'snippet' or new_values ? 'reference'
                 from public.audit_events where entity_id = tests.rid('e1') and action = 'evidence.create'),
  'create: new_values has none of the PII keys');
select ok((select new_values ->> 'kind' = 'web_page' and new_values ->> 'provider' = 'serper'
                  and new_values ->> 'tenant_id' = tests.tid('a')::text and new_values ->> 'created_via' = 'manual'
                  and new_values ->> 'retrieved_at' is not null
             from public.audit_events where entity_id = tests.rid('e1') and action = 'evidence.create'),
  'create: SAFE columns keep their values (kind, provider, tenant_id, created_via, retrieved_at)');

-- a reference-only evidence row names only the field that was set
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $q$insert into public.evidence (id, tenant_id, kind, provider, reference) values (%L, %L, 'document', 'manual', 'upload:canary-ref-only-3300')$q$, tests.rid('e2'), tests.tid('a'))), 'rows:1', 'setup: reference-only evidence');
select is(
  (select array_agg(x order by x) from public.audit_events a, jsonb_array_elements_text(a.metadata -> 'pii_fields_changed') x
    where a.entity_id = tests.rid('e2') and a.action = 'evidence.create'),
  array['reference']::text[], 'only the fields that were actually set are named');

-- ---------------------------------------------------------------- archive
select is(tests.outcome_as(tests.uid('a_admin'), format('update public.evidence set archived_at = now() where id = %L', tests.rid('e1'))), 'rows:1', 'setup: admin archives the evidence');
select results_eq(
  format($$select old_values ->> 'archived_at' is null, new_values ->> 'archived_at' is not null, metadata -> 'pii_fields_changed', actor_user_id
           from public.audit_events where entity_id = %L and action = 'evidence.update'$$, tests.rid('e1')),
  format($$values (true, true, '[]'::jsonb, %L::uuid)$$, tests.uid('a_admin')),
  'archive is audited with before/after archived_at, no PII fields changed, the admin as actor');
select ok(not exists (select 1 from public.audit_events a where a.entity_id = tests.rid('e1') and a.action = 'evidence.update'
                        and (a.old_values ? 'url' or a.new_values ? 'url' or a.old_values ? 'snippet' or a.new_values ? 'snippet'
                             or a.old_values ? 'reference' or a.new_values ? 'reference')),
  'archive: neither old_values nor new_values carries a PII key');

-- ---------------------------------------------------------------- claims
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence)
     values (%L, %L, %L, 'exports_to', 'Quasimodo Ltd ships to canary-claim-value-6677', 'medium')$q$,
  tests.rid('c1'), tests.tid('a'), tests.rid('a_company'))), 'rows:1', 'setup: sales creates a claim');
select results_eq(
  format($$select metadata -> 'pii_fields_changed', new_values ->> 'predicate', new_values ->> 'confidence', new_values ? 'value'
           from public.audit_events where entity_id = %L and action = 'claim.create'$$, tests.rid('c1')),
  $$values ('["value"]'::jsonb, 'exports_to'::text, 'medium'::text, false)$$,
  'claim create: value by NAME only; predicate and confidence keep their values');

-- ---------------------------------------------------------------- links
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $q$insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance) values (%L, %L, %L, %L, 'supports')$q$,
  tests.rid('l1'), tests.tid('a'), tests.rid('e1'), tests.rid('c1'))), 'rows:1', 'setup: sales links evidence to the claim');
select results_eq(
  format($$select new_values ->> 'stance', new_values ->> 'evidence_id', new_values ->> 'claim_id', metadata
           from public.audit_events where entity_id = %L and action = 'evidence_link.create'$$, tests.rid('l1')),
  format($$values ('supports'::text, %L::text, %L::text, '{}'::jsonb)$$, tests.rid('e1'), tests.rid('c1')),
  'link create: stance and the ids are audited with values; no PII fields exist on a link');

-- ====================== THE ASSERTION: no personal-looking value anywhere in the audit table
select is(
  (select count(*) from public.audit_events a
    where to_jsonb(a)::text ~* '(canary-|quasimodo|zephyrine|serper-secret|in/zephyrine|token=)'),
  0::bigint, 'no url, snippet, reference or claim value appears ANYWHERE in audit_events (whole row as text)');
select is(
  (select count(*) from public.audit_events a where a.entity_type in ('evidence', 'evidence_link', 'claim')),
  5::bigint, 'five audit rows exist for the evidence tables (2 evidence creates, 1 archive, 1 claim, 1 link)');

-- audit rows are tenant-scoped and readable only by Owner / Admin (T002 policy, unchanged)
select ok(pg_temp.audit_text(tests.tid('b')) !~ 'evidence', 'tenant B''s audit trail has nothing about tenant A''s evidence');
select is(tests.outcome_as(tests.uid('a_admin'), format($$select 1 from public.audit_events where entity_type = 'evidence' and tenant_id = %L$$, tests.tid('a'))), 'rows:3', 'an Admin reads the evidence audit rows of their tenant');
select is(tests.outcome_as(tests.uid('a_sales'), format($$select 1 from public.audit_events where entity_type = 'evidence' and tenant_id = %L$$, tests.tid('a'))), 'rows:0', 'Sales cannot read the audit trail');
select is(tests.outcome_as(tests.uid('b_admin'), format($$select 1 from public.audit_events where entity_type = 'evidence' and tenant_id = %L$$, tests.tid('a'))), 'rows:0', 'another tenant''s Admin cannot either');

select * from finish();
rollback;
