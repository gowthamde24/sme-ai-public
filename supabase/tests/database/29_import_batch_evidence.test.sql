-- T005 fix round F / group C: provenance for imported claims.
-- Every import batch records ONE evidence row (kind import_batch, reference import:<batch id>) and every claim the
-- batch writes is linked to it, so "where did this fact come from" has an answer (CLAUDE.md non-negotiable 5).
--   A the evidence row   B the claim links   C what it must not contain   D dry run / replay / refusals
--   E a client cannot forge import provenance   F tenants
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.imp(p_user text, p_tenant text, p_rows jsonb, p_batch uuid, p_dry boolean default false, p_label text default null) returns jsonb
language sql as $$
  select tests.scalar_as(tests.uid(p_user),
    format('select public.import_lead_rows(%L, %L, %L::jsonb, %L, %L)', tests.tid(p_tenant), p_batch, p_rows::text, p_label, p_dry))::jsonb
$$;
create function pg_temp.row(p_company text, p_extra jsonb default '{}') returns jsonb language sql as
$$ select jsonb_build_object('company_name', p_company) || p_extra $$;
create function pg_temp.ref(p_batch text) returns text language sql as $$ select 'import:' || tests.rid(p_batch)::text $$;
create function pg_temp.n_evidence(p_tenant text) returns bigint language sql as $$ select count(*) from public.evidence where tenant_id = tests.tid(p_tenant) $$;
create function pg_temp.n_links(p_tenant text) returns bigint language sql as $$ select count(*) from public.evidence_links where tenant_id = tests.tid(p_tenant) $$;

-- ============================================================================ the first batch
create temp table run1 as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO Prov One', jsonb_build_object('city', 'Bengaluru', 'buyer_type', 'saree_shop', 'size_band', 'large',
                'contact_name', 'DEMO Prov Person', 'contact_email', 'prov1@demo.example.test', 'contact_phone', '+00 000 000 0101')),
  pg_temp.row('DEMO Prov Two', jsonb_build_object('buyer_type', 'boutique')),
  pg_temp.row('DEMO Prov Three')), tests.rid('prov1'), false, 'DEMO provenance') as report;

select is((select report -> 'counts' ->> 'claims_created' from run1), '3', 'sanity: the batch wrote 3 attribute claims');

-- ============================================================================ A. the evidence row
select is((select count(*) from public.evidence where tenant_id = tests.tid('a') and reference = pg_temp.ref('prov1')), 1::bigint, 'exactly one evidence row per batch');
select results_eq(
  format($$select kind::text, provider, url, reference, snippet, created_via::text, created_by, archived_at is null
             from public.evidence where tenant_id = %L and reference = %L$$, tests.tid('a'), pg_temp.ref('prov1')),
  format($$values ('import_batch'::text, 'import.csv'::text, null::text, %L::text, 'Lead import batch: 3 submitted rows'::text, 'import'::text, %L::uuid, true)$$,
         pg_temp.ref('prov1'), tests.uid('a_sales')),
  'the evidence: kind import_batch, provider import.csv, no url, typed reference to the batch, counts only, created by the importing user');
select ok((select retrieved_at between now() - interval '1 minute' and now() + interval '1 minute' from public.evidence where reference = pg_temp.ref('prov1')), 'retrieved_at is the import time');

-- ============================================================================ B. the claim links
select is((select count(*) from public.claims where tenant_id = tests.tid('a') and created_via = 'import'), 3::bigint, 'three imported claims exist');
select is(
  (select count(*) from public.claims c
    where c.tenant_id = tests.tid('a') and c.created_via = 'import'
      and (select count(*) from public.evidence_links l join public.evidence e on e.tenant_id = l.tenant_id and e.id = l.evidence_id
            where l.claim_id = c.id and e.reference = pg_temp.ref('prov1')) <> 1),
  0::bigint, 'every imported claim has EXACTLY ONE link to the batch evidence');
select is((select count(*) from public.evidence_links l join public.evidence e on e.tenant_id = l.tenant_id and e.id = l.evidence_id where e.reference = pg_temp.ref('prov1')), 3::bigint,
  'and the batch evidence has no other links (one per claim)');
select results_eq(
  format($$select l.stance::text, l.company_id is null, l.lead_id is null, l.claim_id is not null, l.created_via::text, l.created_by, l.archived_at is null
             from public.evidence_links l join public.evidence e on e.tenant_id = l.tenant_id and e.id = l.evidence_id
            where e.reference = %L$$, pg_temp.ref('prov1')),
  format($$values ('supports'::text, true, true, true, 'import'::text, %1$L::uuid, true), ('supports', true, true, true, 'import', %1$L::uuid, true), ('supports', true, true, true, 'import', %1$L::uuid, true)$$, tests.uid('a_sales')),
  'each link is a claim link: stance supports, no company / lead target, created by the importing user as an import');
select is((select count(*) from public.claims c where c.tenant_id = tests.tid('a') and c.created_via = 'import' and c.confidence <> 'unverified'), 0::bigint, 'the claims stay unverified: provenance does not upgrade confidence');

-- ============================================================================ C. no cell values, no PII
select is(
  (select count(*) from public.evidence e where e.reference = pg_temp.ref('prov1')
     and to_jsonb(e)::text ~* '(prov one|prov two|prov three|prov person|prov1@|bengaluru|saree_shop|boutique|large|000 000 0101|demo provenance)'),
  0::bigint, 'the evidence row holds no company, contact, attribute value or batch label');
select is((select count(*) from public.audit_events a where a.tenant_id = tests.tid('a') and a.entity_type in ('evidence', 'evidence_links')
              and to_jsonb(a)::text ~* '(prov one|prov person|prov1@|bengaluru|saree_shop|000 000 0101)'), 0::bigint, 'nor does the audit trail of the evidence and its links');

-- ============================================================================ D. dry run, replay, refusals
create temp table before_dry as select pg_temp.n_evidence('a') as ev, pg_temp.n_links('a') as ln;
select pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO Prov Dry', jsonb_build_object('buyer_type', 'wholesaler'))), tests.rid('prov_dry'), true);
select is(pg_temp.n_evidence('a') || ',' || pg_temp.n_links('a'), (select ev || ',' || ln from before_dry), 'a dry run leaves no evidence and no link behind');

create temp table replay as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO Prov One', jsonb_build_object('city', 'Bengaluru', 'buyer_type', 'saree_shop', 'size_band', 'large',
                'contact_name', 'DEMO Prov Person', 'contact_email', 'prov1@demo.example.test', 'contact_phone', '+00 000 000 0101')),
  pg_temp.row('DEMO Prov Two', jsonb_build_object('buyer_type', 'boutique')),
  pg_temp.row('DEMO Prov Three')), tests.rid('prov1'), false, 'DEMO provenance') as report;
select is((select report ->> 'replayed' from replay), 'true', 'sanity: the same batch id with the same rows is a replay');
select is(pg_temp.n_evidence('a') || ',' || pg_temp.n_links('a'), (select ev || ',' || ln from before_dry), 'a replay adds no second evidence row and no link');

-- a second batch: its own evidence; attributes that already exist as claims are KEPT and get no new link
create temp table run2 as
select pg_temp.imp('a_admin', 'a', jsonb_build_array(
  pg_temp.row('DEMO Prov Two', jsonb_build_object('buyer_type', 'boutique', 'size_band', 'small')),
  pg_temp.row('DEMO Prov Bad', jsonb_build_object('buyer_type', 'wholesaler', 'contact_name', 'Real Person', 'contact_email', 'real.person@gmail.com'))), tests.rid('prov2'), false) as report;
select is((select report -> 'rows' -> 0 ->> 'outcome' from run2), 'skipped_duplicate', 'sanity: row 1 is an open-lead duplicate');
select is((select report -> 'rows' -> 1 ->> 'reason' from run2), 'contact_domain_not_reserved', 'sanity: row 2 is refused by the real-data gate');
select is((select count(*) from public.evidence where tenant_id = tests.tid('a') and reference = pg_temp.ref('prov2')), 1::bigint, 'the second batch has its own evidence row');
select isnt((select id from public.evidence where reference = pg_temp.ref('prov1')), (select id from public.evidence where reference = pg_temp.ref('prov2')), 'a different one');
select is((select count(*) from public.evidence_links l join public.evidence e on e.tenant_id = l.tenant_id and e.id = l.evidence_id where e.reference = pg_temp.ref('prov2')), 0::bigint,
  'a refused row and a duplicate wrote no claim, hence no link (rolled back together)');
select is((select count(*) from public.claims where company_id in (select id from public.companies where name = 'DEMO Prov Bad')), 0::bigint, 'the refused row left no claim');
select is(
  (select count(*) from public.claims c where c.tenant_id = tests.tid('a') and c.created_via = 'import'
      and (select count(*) from public.evidence_links l where l.claim_id = c.id) <> 1),
  0::bigint, 'overall: no imported claim is without its link, none has two');

-- a third batch: the company exists and already carries a claim for buyer_type (kept, not rewritten, not re-sourced)
insert into public.companies (id, tenant_id, name, city) values (tests.rid('co_kept'), tests.tid('a'), 'DEMO Prov Kept', 'Chennai');
insert into public.claims (id, tenant_id, company_id, predicate, value, confidence)
  values (tests.rid('cl_kept'), tests.tid('a'), tests.rid('co_kept'), 'buyer_type', 'wholesaler', 'low');
create temp table run3 as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO Prov Kept', jsonb_build_object('buyer_type', 'boutique', 'size_band', 'small'))), tests.rid('prov3')) as report;
select is((select report -> 'rows' -> 0 ->> 'outcome' from run3) || ',' || (select report -> 'rows' -> 0 ->> 'attributes_written' from run3) || ',' || (select report -> 'rows' -> 0 ->> 'attributes_kept' from run3),
  'created,1,1', 'sanity: a new lead for an existing company writes the new attribute and keeps the existing one');
select is((select count(*) from public.evidence_links where claim_id = tests.rid('cl_kept')), 0::bigint, 'the KEPT claim was not sourced by this batch: it gets no link');
select is((select count(*) from public.evidence_links l join public.evidence e on e.tenant_id = l.tenant_id and e.id = l.evidence_id where e.reference = pg_temp.ref('prov3')), 1::bigint,
  'only the claim this batch wrote is linked to it');
select is((select value from public.claims where id = tests.rid('cl_kept')), 'wholesaler', 'and the kept claim is untouched');

-- ============================================================================ E. a client cannot forge import provenance
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'import_batch', 'import.csv', null, 'import:forged-by-hand')$q$,
  tests.tid('a'), tests.rid('a_company'))), '23514', 'even an Owner cannot create import_batch evidence through the RPC (the origin must be import)');
select isnt(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.evidence (id, tenant_id, kind, provider, reference) values (gen_random_uuid(), %L, 'import_batch', 'import.csv', 'import:forged-by-hand')$q$, tests.tid('a'))),
  'rows:1', 'nor with a direct insert');
select is((select count(*) from public.evidence where reference = 'import:forged-by-hand'), 0::bigint, 'and nothing was left behind');
select ok((select count(*) = 1 from pg_constraint where conrelid = 'public.evidence'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'import_batch'),
  'one CHECK on public.evidence ties kind import_batch to created_via import');

-- ============================================================================ F. tenants
select is((select count(*) from public.evidence where tenant_id = tests.tid('b') and kind = 'import_batch'), 0::bigint, 'tenant B has no import evidence');
select is((select count(*) from public.evidence where tenant_id = tests.tid('a') and kind = 'import_batch'), 3::bigint, 'tenant A has exactly its three batches');
select is(tests.scalar_as(tests.uid('b_sales'), 'select count(*) from public.evidence where kind = ''import_batch'''), '0', 'tenant B cannot see tenant A''s import evidence');
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from public.evidence where kind = ''import_batch'''), '3', 'a Viewer of A can read it (read = any member)');

select * from finish();
rollback;
