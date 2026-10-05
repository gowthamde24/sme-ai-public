-- T006b M1 (ADR 0014): erasing ONE CONTACT. The canary person is "Zed Qxjv" (zed.qxjv@canary.test, +91 98765 43210).
--   * the contact row, its ledger reference and its linked leads / opportunities are anonymised
--   * the exact identifiers (e-mail, phone) are replaced INSIDE any free text of the workspace
--   * a field that EQUALS the name is tombstoned; a field that merely CONTAINS it is NOT touched and is listed for manual review
--   * the company, other contacts, labels, the ledger's structure and tenant b are untouched
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.er_plant('a');
select tests.er_plant('b');
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (tests.rid('a_other'), tests.tid('a'), tests.rid('a_company'), 'Other Person', 'other.person@example.test', '+91 90000 00009');
insert into public.lead_labels (id, tenant_id, lead_id, label) values (tests.rid('a_label'), tests.tid('a'), tests.rid('a_lead'), 'good');

create function pg_temp.d(p_sql text) returns text language plpgsql as $$ declare v text; begin execute p_sql into v; return v; end $$;
create temp table pre as select
  tests.er_digest('b') as b_digest,
  pg_temp.d($$select md5(string_agg(concat_ws('|', id, name, website, city, region, erased_at), '~' order by id)) from public.companies where tenant_id = tests.tid('a')$$) as companies_digest,
  pg_temp.d($$select md5(x::text) from public.contacts x where id = tests.rid('a_other')$$) as other_digest,
  pg_temp.d($$select md5(string_agg(x::text, '~' order by x::text)) from public.lead_labels x where tenant_id = tests.tid('a')$$) as labels_digest,
  tests.er_hits('a', 'kzv9') as kzv9_before,
  tests.er_hits('a', 'qxjv') as qxjv_before;
select ok(cardinality((select qxjv_before from pre)) >= 15, 'sanity: the person''s canary is planted in many places (' || cardinality((select qxjv_before from pre)) || ')');

select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid('c1'), tests.tid('a'), tests.rid('a_contact')));
create temp table res as select tests.scalar_as(tests.uid('a_owner'), format('select public.execute_erasure(%L, false)', tests.rid('c1')))::jsonb as r;
select is((select r ->> 'status' from res), 'executed', 'the Owner erased the contact');

-- ---- the contact and its ledger
select results_eq(format($$select full_name, email, phone, job_title, erased_at is not null, archived_at is not null from public.contacts where id = %L$$, tests.rid('a_contact')),
  $$values ('erased:1'::text, null::text, null::text, null::text, true, true)$$, 'the contact: name tombstoned, e-mail / phone / title gone, marked erased and archived');
select results_eq(format($$select event_type::text, channel::text, basis::text, evidence_type::text, evidence_ref from public.consent_events where id = %L$$, tests.rid('a_er_consent')),
  $$values ('granted'::text, 'email'::text, 'explicit_consent'::text, 'web_form'::text, 'erased:1'::text)$$, 'the ledger is KEPT (event, channel, basis, type); only the reference is tombstoned');
select is((select count(*) from public.consent_events where tenant_id = tests.tid('a')), 1::bigint, 'no ledger row was deleted');

-- ---- linked rows (by contact_id) are anonymised whole
select results_eq(format($$select source, disqualified_reason, contact_id = %L from public.leads where id = %L$$, tests.rid('a_contact'), tests.rid('a_lead')),
  $$values ('erased:1'::text, 'erased:1'::text, true)$$, 'the linked lead: free text tombstoned, still linked');
select results_eq(format($$select title, lost_reason, status::text from public.opportunities where id = %L$$, tests.rid('a_opp')),
  $$values ('erased:1'::text, 'erased:1'::text, 'lost'::text)$$, 'the linked opportunity: free text tombstoned, status kept');

-- ---- the sweep: exact identifiers are replaced INSIDE any free text
select results_eq(format($$select source, disqualified_reason from public.leads where id = %L$$, tests.rid('a_er_lead2')),
  $$values ('fwd erased-1'::text, 'ref erased-1'::text)$$, 'an unlinked lead: e-mail and phone replaced inside the text');
select is((select title from public.opportunities where id = tests.rid('a_er_opp2')), 'Call erased-1 re order', 'a phone written with a space is found');
select is((select description from public.products where id = tests.rid('a_product')), 'Sold by erased-1', 'a product description');
select results_eq(format($$select url, reference, snippet from public.evidence where id = %L$$, tests.rid('a_er_e1')),
  $$values ('https://example.test/p?e=erased-1'::text, 'call:erased-1'::text, 'Mail erased-1 or call erased-1 today'::text)$$, 'evidence url, reference and snippet: identifiers replaced, the shapes stay valid');
select is((select value from public.claims where id = tests.rid('a_er_c1')), 'Phone erased-1', 'a claim value with the phone written with a dash');
select is((select tags::text from public.companies where id = tests.rid('a_er_company2')), '{erased-1,vip}', 'a tag that is the e-mail');

-- ---- names: equality is tombstoned, containment is only listed
select is((select snippet from public.evidence where id = tests.rid('a_er_e2')), 'erased:1', 'a snippet that EQUALS the name is tombstoned');
select is((select value from public.claims where id = tests.rid('a_er_c2')), 'erased:1', 'a claim value that equals the name (any case) is tombstoned');
select is((select snippet from public.evidence where id = tests.rid('a_er_e3')), 'Run by Zed Qxjv Textiles Ltd', 'a snippet that merely CONTAINS the name is left untouched');
select is((select value from public.claims where id = tests.rid('a_er_c3')), 'Proprietor Zed Qxjv here', '...a claim value too');
select is((select label from public.import_batches where id = tests.rid('a_er_batch')), 'Zed Qxjv import', '...an import label too');
create temp table review as select 'evidence.snippet#' || tests.rid('a_er_e3') as x union all select 'claims.value#' || tests.rid('a_er_c3') union all select 'import_batches.label#' || tests.rid('a_er_batch');
select is((select array_agg(i->>'table' || '.' || (i->>'column') || '#' || (i->>'id') order by i->>'table', i->>'column', i->>'id') from jsonb_array_elements((select r -> 'review' from res)) i),
          (select array_agg(x order by x) from review), 'the result lists exactly those rows under "needs manual review" (ids only)');

-- ---- the canary scan: everything that is left is on the review list
select is(tests.er_hits('a', '98765[^0-9]{0,3}43210|9876543210'), '{}'::text[], 'no trace of the phone number anywhere in the workspace');
select is(tests.er_hits('a', 'zed\.qxjv@|canary\.test'), '{}'::text[], 'no trace of the e-mail address anywhere');
select is((select array_agg(h order by h) from unnest(tests.er_hits('a', 'qxjv')) h), (select array_agg(x order by x) from review),
          'the ONLY places the name is still found are the three on the review list (audit log included)');

-- ---- what must not move
select is(pg_temp.d($$select md5(string_agg(concat_ws('|', id, name, website, city, region, erased_at), '~' order by id)) from public.companies where tenant_id = tests.tid('a')$$), (select companies_digest from pre), 'contact erasure does not touch any company''s identity (decision 4; an e-mail inside a tag is an identifier and is swept)');
select is(pg_temp.d($$select md5(x::text) from public.contacts x where id = tests.rid('a_other')$$), (select other_digest from pre), 'another contact is untouched');
select is(pg_temp.d($$select md5(string_agg(x::text, '~' order by x::text)) from public.lead_labels x where tenant_id = tests.tid('a')$$), (select labels_digest from pre), 'labels are untouched');
select is(tests.er_digest('b'), (select b_digest from pre), 'tenant b is byte-identical');
select is((select array_agg(h order by h) from unnest(tests.er_hits('a', 'kzv9')) h),
          (select array_agg(h order by h) from unnest((select kzv9_before from pre)) h where h not in ('leads.source#' || tests.rid('a_lead'), 'opportunities.lost_reason#' || tests.rid('a_opp'),
                                                                                                       -- T008: the enquiry captured on the contact's lead and the fields extracted from it
                                                                                                       'enquiries.subject#' || tests.rid('a_er_enq'), 'enquiries.body#' || tests.rid('a_er_enq'),
                                                                                                       'requirement_fields.quote#' || tests.rid('a_er_f1'), 'requirement_fields.quote#' || tests.rid('a_er_f2'),
                                                                                                       'requirement_fields.value_text#' || tests.rid('a_er_f2'))),
          'the company''s own canary is still there (only the contact-linked rows that mentioned it were tombstoned)');

-- ---- the result and the log
select ok((select r -> 'counts' ->> 'contacts.full_name' = '1' and r -> 'counts' ->> 'contacts.email' = '1' from res), 'the counts say what changed');
select ok((select r ? 'exports_logged' from res), 'the result says how many exports were made (files already downloaded are outside the system)');
select ok((select r ->> 'note' ilike '%names%' from res), 'the result states the limit of names every time');
select is((select count(*) from public.erasure_requests where tenant_id in (tests.tid('a'), tests.tid('b')) and result::text ~* '(qxjv|zed|9876|canary)'), 0::bigint, 'the request log holds no value');

select * from finish();
rollback;
