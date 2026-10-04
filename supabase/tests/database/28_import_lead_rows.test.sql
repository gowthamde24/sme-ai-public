-- T005 / milestone 1: public.import_lead_rows (ADR 0010). The ONLY writer of import_batches / import_rows and the
-- only place where created_via = 'import' is declared. SECURITY DEFINER: every check below is therefore a test of
-- a boundary that row level security does NOT provide here.
--   A properties   B authorization    C limits       D the real-data gate        E what a created row looks like
--   F company dedup   G contact dedup   H lead dedup   I attributes (claims)     J idempotency + dry run
--   K per-row isolation   L provenance cannot be spoofed   M audit / PII   N source audit   O non-Latin text
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.sha(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- SQL text of a call (for outcome_as / error_shape_as)
create function pg_temp.call_sql(p_tenant text, p_rows text, p_batch uuid default gen_random_uuid(), p_dry boolean default false, p_label text default null) returns text
language sql as $$
  select format('select public.import_lead_rows(%L, %L, %L::jsonb, %L, %L)', tests.tid(p_tenant), p_batch, p_rows, p_label, p_dry)
$$;
-- run as a user and parse the report
create function pg_temp.imp(p_user text, p_tenant text, p_rows jsonb, p_batch uuid default gen_random_uuid(), p_dry boolean default false, p_label text default null) returns jsonb
language sql as $$
  select tests.scalar_as(tests.uid(p_user), pg_temp.call_sql(p_tenant, p_rows::text, p_batch, p_dry, p_label))::jsonb
$$;
create function pg_temp.row(p_company text, p_extra jsonb default '{}') returns jsonb language sql as
$$ select jsonb_build_object('company_name', p_company) || p_extra $$;
create function pg_temp.out(p_report jsonb, p_row int) returns text language sql as $$ select p_report -> 'rows' -> (p_row - 1) ->> 'outcome' $$;
create function pg_temp.why(p_report jsonb, p_row int) returns text language sql as $$ select p_report -> 'rows' -> (p_row - 1) ->> 'reason' $$;
create function pg_temp.cnt(p_tenant text default 'a') returns text language sql as $$
  select concat_ws(',',
    (select count(*) from public.companies where tenant_id = tests.tid(p_tenant)),
    (select count(*) from public.contacts where tenant_id = tests.tid(p_tenant)),
    (select count(*) from public.leads where tenant_id = tests.tid(p_tenant)),
    (select count(*) from public.claims where tenant_id = tests.tid(p_tenant)),
    (select count(*) from public.import_batches where tenant_id = tests.tid(p_tenant)),
    (select count(*) from public.import_rows where tenant_id = tests.tid(p_tenant)))
$$;
create function pg_temp.shape(p_sql text) returns text
language plpgsql as $$
declare v_constraint text;
begin
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    get stacked diagnostics v_constraint = constraint_name;
    return sqlstate || ':' || coalesce(v_constraint, '');
  end;
end $$;

-- ============================================================================ A. properties
select has_function('public', 'import_lead_rows', array['uuid', 'uuid', 'jsonb', 'text', 'boolean']);
select is((select count(*) from pg_proc where proname = 'import_lead_rows'), 1::bigint, 'exactly one overload');
select ok((select prosecdef from pg_proc where proname = 'import_lead_rows'), 'it is SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where proname = 'import_lead_rows'), 'it pins search_path to empty');
select is((select prorettype::regtype::text from pg_proc where proname = 'import_lead_rows'), 'jsonb', 'it returns a jsonb report');
select ok(has_function_privilege('authenticated', 'public.import_lead_rows(uuid,uuid,jsonb,text,boolean)', 'execute'), 'authenticated may execute it');
select ok(not has_function_privilege('anon', 'public.import_lead_rows(uuid,uuid,jsonb,text,boolean)', 'execute'), 'anon may not');
select ok((select proowner::regrole::text from pg_proc where proname = 'import_lead_rows') = 'postgres', 'it is owned by the migration role');

-- ============================================================================ B. authorization
create temp table base_rows as select jsonb_build_array(pg_temp.row('DEMO Auth Probe')) as rows;
select is(tests.outcome_as(tests.uid('a_viewer'), pg_temp.call_sql('a', (select rows::text from base_rows))), '42501', 'Viewer cannot import');
select is(tests.outcome_as(tests.uid('outsider'), pg_temp.call_sql('a', (select rows::text from base_rows))), '42501', 'a user with no tenant cannot import');
select is(tests.outcome_as(null, pg_temp.call_sql('a', (select rows::text from base_rows))), '42501', 'anon cannot import (no EXECUTE)');
select is(tests.outcome_as(tests.uid('b_sales'), pg_temp.call_sql('a', (select rows::text from base_rows))), '42501', 'a tenant-B Sales user cannot import into tenant A (forged tenant id)');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.call_sql('b', (select rows::text from base_rows))), '42501', 'a tenant-A Owner cannot import into tenant B');
select is(tests.outcome_as(tests.uid('dual'), pg_temp.call_sql('b', (select rows::text from base_rows))), '42501', 'dual (Viewer of B) cannot import into B');
select is(tests.outcome_as(tests.uid('a_sales'), format('select public.import_lead_rows(%L, gen_random_uuid(), %L::jsonb)', gen_random_uuid(), (select rows::text from base_rows))), '42501',
  'an unknown tenant id gives the same refusal as a foreign one (no existence oracle)');
select is(pg_temp.cnt('a') || '|' || pg_temp.cnt('b'), '1,1,1,0,0,0|1,1,1,0,0,0', 'every refused call left nothing behind (only the fixtures exist)');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.call_sql('a', (select rows::text from base_rows), p_dry => true)), 'rows:1', 'Owner may import (dry run)');
select is(tests.outcome_as(tests.uid('a_admin'), pg_temp.call_sql('a', (select rows::text from base_rows), p_dry => true)), 'rows:1', 'Admin may import (dry run)');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', (select rows::text from base_rows), p_dry => true)), 'rows:1', 'Sales may import (dry run)');
select is(tests.outcome_as(tests.uid('dual'), pg_temp.call_sql('a', (select rows::text from base_rows), p_dry => true)), 'rows:1', 'dual (Owner of A) may import into A');
select is(tests.outcome_as(tests.uid('a_viewer'), pg_temp.call_sql('a', (select rows::text from base_rows), p_dry => true)), '42501', 'Viewer cannot even preview');
select is(pg_temp.cnt('a'), '1,1,1,0,0,0', 'dry runs wrote nothing');

-- the batch id is a global primary key: another tenant's batch id fails like one of your own with different content
select is(pg_temp.imp('b_sales', 'b', jsonb_build_array(pg_temp.row('DEMO B Batch Owner')), tests.rid('batch_b'))->'counts'->>'created', '1', 'setup: tenant B imports with batch id X');
select is(tests.error_shape_as(tests.uid('a_sales'), pg_temp.call_sql('a', (select rows::text from base_rows), tests.rid('batch_b'))),
  '23505:import_batches_pkey:import_batches', 'tenant A reusing B''s batch id -> 23505 on the primary key');
select is(pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO A Batch Own One')), tests.rid('batch_a'))->'counts'->>'created', '1', 'setup: tenant A imports with batch id Y');
select is(tests.error_shape_as(tests.uid('a_sales'), pg_temp.call_sql('a', jsonb_build_array(pg_temp.row('DEMO A Batch Own Two'))::text, tests.rid('batch_a'))),
  '23505:import_batches_pkey:import_batches', 'tenant A reusing its own batch id with different rows -> the identical shape');

-- ============================================================================ C. limits and argument checks
select is(tests.outcome_as(tests.uid('a_sales'), format('select public.import_lead_rows(null, gen_random_uuid(), %L::jsonb)', (select rows::text from base_rows))), '22023', 'NULL tenant -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), format('select public.import_lead_rows(%L, null, %L::jsonb)', tests.tid('a'), (select rows::text from base_rows))), '22023', 'NULL batch id -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), format('select public.import_lead_rows(%L, gen_random_uuid(), null)', tests.tid('a'))), '22023', 'NULL rows -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', '{"company_name":"x"}')), '22023', 'rows must be an array (an object is refused)');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', '"text"')), '22023', 'rows must be an array (a string is refused)');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', '[]')), '22023', 'zero rows -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', (select jsonb_agg(pg_temp.row('DEMO Cap ' || i))::text from generate_series(1, 501) i), p_dry => true)), '22023', '501 rows -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', (select jsonb_agg(pg_temp.row('DEMO Cap ' || i))::text from generate_series(1, 500) i), p_dry => true)), 'rows:1', '500 rows is accepted');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', (select jsonb_agg(pg_temp.row('DEMO Big ' || i, jsonb_build_object('source', repeat('s', 4000))))::text from generate_series(1, 300) i), p_dry => true)), '22023', 'more than 1 MB of rows -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', (select rows::text from base_rows), p_label => 'bad/label')), '22023', 'a label that is not a plain slug -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', (select rows::text from base_rows), p_label => repeat('x', 61))), '22023', 'a 61-character label -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.call_sql('a', (select rows::text from base_rows), p_label => 'DEMO fixture file 1')), 'rows:1', 'a plain label is accepted');
select is(pg_temp.cnt('a'), '3,1,3,0,2,2', 'refused and previewed calls wrote nothing (the two real runs above account for the extra rows)');

-- ============================================================================ D. the real-data gate
-- Contact fields are accepted only together with a contact_email on a reserved domain, and a phone starting +00 (or none).
-- Every case runs as a dry run: the outcome and the reason are what is asserted. Company-level fields may be real.
create function pg_temp.gate(p_label text, p_extra jsonb, p_outcome text, p_reason text default null) returns setof text
language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO Gate ' || md5(p_label), p_extra)), gen_random_uuid(), true);
  return next is(pg_temp.out(r, 1), p_outcome, 'gate: ' || p_label || ' -> outcome');
  return next is(pg_temp.why(r, 1), p_reason, 'gate: ' || p_label || ' -> reason');
end $$;

-- accepted
select pg_temp.gate('no contact fields at all', '{}', 'created');
select pg_temp.gate('a reserved .test domain with a +00 phone', '{"contact_name":"DEMO A","contact_email":"asha@demo.example.test","contact_phone":"+00 000 000 0001","contact_job_title":"DEMO Buyer"}', 'created');
select pg_temp.gate('example.com', '{"contact_name":"DEMO A","contact_email":"a@example.com"}', 'created');
select pg_temp.gate('example.org', '{"contact_name":"DEMO A","contact_email":"a@example.org"}', 'created');
select pg_temp.gate('example.net', '{"contact_name":"DEMO A","contact_email":"a@example.net"}', 'created');
select pg_temp.gate('a subdomain of example.com', '{"contact_name":"DEMO A","contact_email":"a@mail.shop.example.com"}', 'created');
select pg_temp.gate('the .test top-level domain', '{"contact_name":"DEMO A","contact_email":"a@shop.test"}', 'created');
select pg_temp.gate('the .invalid top-level domain', '{"contact_name":"DEMO A","contact_email":"a@shop.invalid"}', 'created');
select pg_temp.gate('the .example top-level domain', '{"contact_name":"DEMO A","contact_email":"a@shop.example"}', 'created');
select pg_temp.gate('upper case domain', '{"contact_name":"DEMO A","contact_email":"A@EXAMPLE.COM"}', 'created');
select pg_temp.gate('e-mail with surrounding blanks', '{"contact_name":"DEMO A","contact_email":"  a@example.com  "}', 'created');
select pg_temp.gate('phone with surrounding blanks', '{"contact_name":"DEMO A","contact_email":"a@example.com","contact_phone":"  +00 12 "}', 'created');
select pg_temp.gate('no phone', '{"contact_name":"DEMO A","contact_email":"a@example.com"}', 'created');
select pg_temp.gate('company-level fields may be real (website, city, industry, country)', '{"website":"https://www.a-real-looking-shop.com","city":"Bengaluru","industry":"Silk sarees","country":"IN"}', 'created');

-- refused: contact fields without a contact e-mail
select pg_temp.gate('contact_name alone', '{"contact_name":"DEMO A"}', 'rejected', 'contact_requires_email');
select pg_temp.gate('contact_job_title alone', '{"contact_job_title":"Owner"}', 'rejected', 'contact_requires_email');
select pg_temp.gate('contact_phone alone', '{"contact_phone":"+00 1234"}', 'rejected', 'contact_requires_email');
select pg_temp.gate('name and phone, no e-mail', '{"contact_name":"DEMO A","contact_phone":"+00 1234"}', 'rejected', 'contact_requires_email');
select pg_temp.gate('an empty e-mail with a name', '{"contact_name":"DEMO A","contact_email":""}', 'rejected', 'contact_requires_email');
select pg_temp.gate('a blank e-mail with a name', '{"contact_name":"DEMO A","contact_email":"   "}', 'rejected', 'contact_requires_email');
select pg_temp.gate('a null e-mail with a name', '{"contact_name":"DEMO A","contact_email":null}', 'rejected', 'contact_requires_email');
-- refused: a real-looking or tricky domain
select pg_temp.gate('gmail.com', '{"contact_name":"DEMO A","contact_email":"a@gmail.com"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a company domain', '{"contact_name":"DEMO A","contact_email":"a@acme-silks.in"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('example.com as a prefix of another domain', '{"contact_name":"DEMO A","contact_email":"a@example.com.evil.in"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a domain merely ending in "example.com"', '{"contact_name":"DEMO A","contact_email":"a@notexample.com"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a domain merely ending in "test"', '{"contact_name":"DEMO A","contact_email":"a@fastest"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a domain ending in "test" without a dot', '{"contact_name":"DEMO A","contact_email":"a@mytest.com"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a trailing dot', '{"contact_name":"DEMO A","contact_email":"a@example.com."}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a Cyrillic look-alike letter', U&'{"contact_name":"DEMO A","contact_email":"a@ex\0430mple.com"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a zero-width space inside the domain', U&'{"contact_name":"DEMO A","contact_email":"a@exam\200Bple.com"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('two @ signs', '{"contact_name":"DEMO A","contact_email":"a@b@example.com"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a fragment trick before .test', '{"contact_name":"DEMO A","contact_email":"a@evil.com#.test"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a slash trick before .test', '{"contact_name":"DEMO A","contact_email":"a@evil.com/x.test"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a query trick before .test', '{"contact_name":"DEMO A","contact_email":"a@evil.com?.test"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a leading dot', '{"contact_name":"DEMO A","contact_email":"a@.example.com"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('localhost', '{"contact_name":"DEMO A","contact_email":"a@localhost"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('an IP address', '{"contact_name":"DEMO A","contact_email":"a@192.0.2.1"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('no @ at all', '{"contact_name":"DEMO A","contact_email":"example.com"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('an empty domain', '{"contact_name":"DEMO A","contact_email":"a@"}', 'rejected', 'contact_domain_not_reserved');
select pg_temp.gate('a real e-mail, no name', '{"contact_email":"a@gmail.com"}', 'rejected', 'contact_domain_not_reserved');
-- refused: a real-looking phone
select pg_temp.gate('an Indian mobile number', '{"contact_name":"DEMO A","contact_email":"a@example.com","contact_phone":"+91 98765 43210"}', 'rejected', 'contact_phone_not_reserved');
select pg_temp.gate('a number without a plus', '{"contact_name":"DEMO A","contact_email":"a@example.com","contact_phone":"0091 12345"}', 'rejected', 'contact_phone_not_reserved');
select pg_temp.gate('+0 is not +00', '{"contact_name":"DEMO A","contact_email":"a@example.com","contact_phone":"+0123456"}', 'rejected', 'contact_phone_not_reserved');
select pg_temp.gate('"+00" in the middle', '{"contact_name":"DEMO A","contact_email":"a@example.com","contact_phone":"98765 +00 123"}', 'rejected', 'contact_phone_not_reserved');
select pg_temp.gate('a blank phone is "no phone"', '{"contact_name":"DEMO A","contact_email":"a@example.com","contact_phone":"  "}', 'created');
-- refused: a contact without a name
select pg_temp.gate('a reserved e-mail but no name', '{"contact_email":"a@example.com"}', 'rejected', 'contact_name_missing');
-- the row itself
select pg_temp.gate('no company name', '{"company_name":null}', 'rejected', 'company_name_missing');
select pg_temp.gate('a blank company name', '{"company_name":"   "}', 'rejected', 'company_name_missing');
select pg_temp.gate('an unknown column', '{"phone":"+91 1"}', 'rejected', 'unknown_field');
select pg_temp.gate('a differently cased column', '{"Contact_Email":"a@gmail.com","contact_name":"DEMO A"}', 'rejected', 'unknown_field');
select pg_temp.gate('a nested contact object', '{"contact":{"email":"a@gmail.com","name":"Real Person"}}', 'rejected', 'unknown_field');
select pg_temp.gate('a forged tenant id inside a row', jsonb_build_object('tenant_id', tests.tid('b')), 'rejected', 'unknown_field');
select pg_temp.gate('a forged created_via inside a row', '{"created_via":"agent"}', 'rejected', 'unknown_field');
select pg_temp.gate('a forged id inside a row', jsonb_build_object('id', gen_random_uuid()), 'rejected', 'unknown_field');
select pg_temp.gate('a forged lead id inside a row', jsonb_build_object('lead_id', gen_random_uuid()), 'rejected', 'unknown_field');
select pg_temp.gate('a number where text belongs', '{"contact_email":5}', 'rejected', 'invalid_row');
select pg_temp.gate('an array where text belongs', '{"contact_email":["a@example.com"]}', 'rejected', 'invalid_row');
select pg_temp.gate('an object where text belongs', '{"city":{"x":1}}', 'rejected', 'invalid_row');
select pg_temp.gate('categories that are not text', '{"categories":[1,2]}', 'rejected', 'invalid_row');
select pg_temp.gate('categories that are not a list', '{"categories":"silk"}', 'rejected', 'invalid_row');
select pg_temp.gate('an empty category', '{"categories":["silk",""]}', 'rejected', 'invalid_row');
-- a row that is not an object
select is(pg_temp.out(pg_temp.imp('a_sales', 'a', jsonb_build_array('just text', 5, null, jsonb_build_array(1), pg_temp.row('DEMO After Junk')), gen_random_uuid(), true), 1), 'rejected', 'a string row is rejected');
select is(pg_temp.why(pg_temp.imp('a_sales', 'a', jsonb_build_array('just text', 5, null, jsonb_build_array(1), pg_temp.row('DEMO After Junk')), gen_random_uuid(), true), 3), 'invalid_row', 'a null row -> invalid_row');
select is(pg_temp.out(pg_temp.imp('a_sales', 'a', jsonb_build_array('just text', 5, null, jsonb_build_array(1), pg_temp.row('DEMO After Junk')), gen_random_uuid(), true), 5), 'created', '...and a good row after junk is still handled');

-- the gate canary: a real-looking person never reaches a table, a report or the audit trail
select is(pg_temp.cnt('a'), '3,1,3,0,2,2', 'every gate case was a dry run: nothing written');
create temp table gate_canary as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO Canary Co', jsonb_build_object('contact_name', 'Zephyrine Quasimodo', 'contact_email', 'zephyrine.quasi@gmail-canary.example.in', 'contact_phone', '+91 98765 43210', 'contact_job_title', 'Chief Pretzel Officer'))), gen_random_uuid()) as report;
select is(pg_temp.out((select report from gate_canary), 1), 'rejected', 'a real-looking contact is rejected on a real (not dry) run');
select is(pg_temp.cnt('a'), '3,1,3,0,3,3', 'the rejected row created no company, contact or lead (only the batch and its row record)');
select is((select count(*) from public.companies where name = 'DEMO Canary Co'), 0::bigint, 'the rejected row''s company does not exist');
select is(
  (select count(*) from (
     select to_jsonb(x)::text t from public.import_rows x union all select to_jsonb(x)::text from public.import_batches x
     union all select to_jsonb(x)::text from public.audit_events x union all select (select report from gate_canary)::text) s
    where t ~* '(zephyrine|quasimodo|gmail-canary|98765|pretzel)'),
  0::bigint, 'no part of the rejected contact appears in the report, the batch / row records or the audit trail');

-- ============================================================================ E. what a created row looks like
create temp table first_run as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  jsonb_build_object('company_name', 'DEMO Silks One', 'website', 'https://www.demo-silks-one.example.test/shop', 'country', 'IN', 'city', 'Bengaluru',
                     'industry', 'Silk sarees', 'categories', jsonb_build_array('saree', 'silk'),
                     'contact_name', 'DEMO Asha Testperson', 'contact_email', 'asha1@demo.example.test', 'contact_phone', '+00 000 000 0001',
                     'contact_job_title', 'DEMO Owner', 'source', 'DEMO trade fair',
                     'buyer_type', 'independent_shop', 'size_band', 'small', 'operating_status', 'active', 'order_scale', 'bulk'),
  pg_temp.row('DEMO Silks Two')), tests.rid('batch_e'), false, 'DEMO fixture file 1') as report;

select is((select report -> 'counts' from first_run), jsonb_build_object('rows', 2, 'created', 2, 'skipped_duplicate', 0, 'ambiguous', 0, 'rejected', 0,
                                                                         'companies_created', 2, 'contacts_created', 1, 'claims_created', 4),
  'the report counts: 2 created, 2 companies, 1 contact, 4 attribute claims');
select is((select report ->> 'replayed' from first_run), 'false', 'a first run is not a replay');
select is((select report ->> 'dry_run' from first_run), 'false', 'and not a dry run');
select is((select report ->> 'batch_id' from first_run), tests.rid('batch_e')::text, 'the report names the batch');
select is((select count(*) from jsonb_array_elements((select report -> 'rows' from first_run)) r where r ? 'lead_id' and r ? 'company_id'), 2::bigint, 'each created row reports its lead and company ids');

select results_eq(
  $$select name, type::text, website, country, city, industry, tags, created_via::text, created_by is not null, archived_at is null from public.companies where name = 'DEMO Silks One'$$,
  $$values ('DEMO Silks One'::text, 'prospect'::text, 'https://www.demo-silks-one.example.test/shop'::text, 'IN'::text, 'Bengaluru'::text, 'Silk sarees'::text, array['saree','silk']::text[], 'import'::text, true, true)$$,
  'the company: columns as sent, type prospect, categories become tags, created_via = import, a human creator');
select results_eq(
  $$select full_name, email, phone, job_title, email_consent::text, whatsapp_consent::text, phone_consent::text, suppressed_at is null, created_via::text, created_by
      from public.contacts where email = 'asha1@demo.example.test'$$,
  format($$values ('DEMO Asha Testperson'::text, 'asha1@demo.example.test'::text, '+00 000 000 0001'::text, 'DEMO Owner'::text, 'unknown'::text, 'unknown'::text, 'unknown'::text, true, 'import'::text, %L::uuid)$$, tests.uid('a_sales')),
  'the contact: as sent, EVERY consent channel unknown, not suppressed, created_via = import by the importing user');
select results_eq(
  $$select l.status::text, l.source, l.owner_user_id is null, l.created_via::text, l.created_by, c.name, k.email
      from public.leads l join public.companies c on c.id = l.company_id left join public.contacts k on k.id = l.contact_id where c.name = 'DEMO Silks One'$$,
  format($$values ('new'::text, 'DEMO trade fair'::text, true, 'import'::text, %L::uuid, 'DEMO Silks One'::text, 'asha1@demo.example.test'::text)$$, tests.uid('a_sales')),
  'the lead: status new, source kept, no owner, linked to the company AND its contact');
select results_eq(
  $$select predicate, value, confidence::text, created_via::text, created_by is not null from public.claims
     where company_id = (select id from public.companies where name = 'DEMO Silks One') order by predicate$$,
  $$values ('buyer_type'::text, 'independent_shop'::text, 'unverified'::text, 'import'::text, true),
           ('operating_status', 'active', 'unverified', 'import', true),
           ('order_scale', 'bulk', 'unverified', 'import', true),
           ('size_band', 'small', 'unverified', 'import', true)$$,
  'four attribute claims about the company: confidence unverified, created_via import');
select is((select count(*) from public.claims where company_id = (select id from public.companies where name = 'DEMO Silks Two')), 0::bigint, 'no attribute columns, no claims');
select is((select count(*) from public.contacts where company_id = (select id from public.companies where name = 'DEMO Silks Two')), 0::bigint, 'no contact fields, no contact');
select results_eq(
  $$select label, row_count, created_count, duplicate_count, ambiguous_count, rejected_count, companies_created, contacts_created, claims_created, created_via::text, created_by is not null
      from public.import_batches where id = $$ || quote_literal(tests.rid('batch_e')),
  $$values ('DEMO fixture file 1'::text, 2, 2, 0, 0, 0, 2, 1, 4, 'import'::text, true)$$,
  'the batch record: label, counts, who');
select results_eq(
  $$select row_no, outcome::text, reason::text, company_created, contact_created, attributes_written, attributes_kept, lead_id is not null
      from public.import_rows where batch_id = $$ || quote_literal(tests.rid('batch_e')) || $$ order by row_no$$,
  $$values (1::smallint, 'created'::text, null::text, true, true, 4::smallint, 0::smallint, true), (2::smallint, 'created', null, true, false, 0::smallint, 0::smallint, true)$$,
  'the row records: outcome, what was created, attribute counts, ids only');
select is((select content_sha256 from public.import_batches where id = tests.rid('batch_e')),
  pg_temp.sha(jsonb_build_array(
    jsonb_build_object('company_name', 'DEMO Silks One', 'website', 'https://www.demo-silks-one.example.test/shop', 'country', 'IN', 'city', 'Bengaluru',
                     'industry', 'Silk sarees', 'categories', jsonb_build_array('saree', 'silk'),
                     'contact_name', 'DEMO Asha Testperson', 'contact_email', 'asha1@demo.example.test', 'contact_phone', '+00 000 000 0001',
                     'contact_job_title', 'DEMO Owner', 'source', 'DEMO trade fair',
                     'buyer_type', 'independent_shop', 'size_band', 'small', 'operating_status', 'active', 'order_scale', 'bulk'),
    pg_temp.row('DEMO Silks Two'))::text), 'the content hash is computed by the database from the rows, not supplied by the caller');
select is(current_setting('app.created_via', true), '', 'the function leaves app.created_via cleared');
select is((select count(*) from public.import_rows where batch_id = tests.rid('batch_e') and to_jsonb(import_rows)::text ~* '(silks|asha|demo|bengaluru)'), 0::bigint, 'the row records hold no company or contact text');

-- ============================================================================ F. company de-duplication
insert into public.companies (id, tenant_id, name, website, city) values
  (tests.rid('co_host'),   tests.tid('a'), 'DEMO Host Original Name', 'https://host-match.example.test', 'Bengaluru'),
  (tests.rid('co_name'),   tests.tid('a'), 'DEMO Sri Silks', null, 'Bengaluru'),
  (tests.rid('co_name2'),  tests.tid('a'), 'DEMO Same Name', 'https://a-same.example.test', null),
  (tests.rid('co_city'),   tests.tid('a'), 'DEMO City Name', null, 'Bengaluru'),
  (tests.rid('co_arch'),   tests.tid('a'), 'DEMO Archived Co', 'https://archived.example.test', null);
update public.companies set archived_at = now() where id = tests.rid('co_arch');
create temp table dedup as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('A Different Name Entirely', jsonb_build_object('website', 'HTTP://WWW.HOST-MATCH.EXAMPLE.TEST/about?x=1')),   -- 1 host match
  pg_temp.row('demo  SRI   silks'),                                                                                             -- 2 name match (case, blanks)
  pg_temp.row('ＤＥＭＯ Ｓｒｉ Ｓｉｌｋｓ', '{"city":"BENGALURU "}'),                                                           -- 3 name match (full width) + same city; row 2 made the lead
  pg_temp.row('DEMO Same Name'),                                                                                                -- 4 no host on the row -> matches the only company of that name
  pg_temp.row('DEMO Same Name', '{"website":"https://b-same.example.test"}'),                                                  -- 5 conflicting host -> a different company
  pg_temp.row('DEMO City Name', '{"city":"Tirupati"}'),                                                                        -- 6 conflicting city -> a different company
  pg_temp.row('DEMO City Name', '{"city":"bengaluru"}'),                                                                       -- 7 same city, any case -> match
  pg_temp.row('DEMO Brand New Co'),                                                                                             -- 8 no match -> created
  pg_temp.row('x', '{"website":"https://archived.example.test"}'),                                                              -- 9 matches an ARCHIVED company
  pg_temp.row('DEMO Archived Co')                                                                                               -- 10 same, by name
)) as report;
select is(pg_temp.out((select report from dedup), 1) || ':' || (select (lead_id is not null and company_id = tests.rid('co_host'))::text from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from dedup) and row_no = 1),
  'created:true', 'F1 a website host (case, scheme, www, path, query ignored) matches the existing company, whatever the name');
select is((select report -> 'rows' -> 0 ->> 'company_created' from dedup), 'false', 'F1 and no company is created');
select is((select company_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from dedup) and row_no = 2), tests.rid('co_name'), 'F2 a name matches regardless of case and blanks');
select is((select company_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from dedup) and row_no = 3), tests.rid('co_name'), 'F3 full-width Latin matches (NFKC) and the same city in another case does not block it');
select is(pg_temp.out((select report from dedup), 3), 'skipped_duplicate', 'F3 the second row for that company is a duplicate OPEN lead (row 2 made one)');
select is((select company_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from dedup) and row_no = 4), tests.rid('co_name2'), 'F4 a row with no website matches the company of that name');
select is((select (company_id <> tests.rid('co_name2'))::text from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from dedup) and row_no = 5), 'true', 'F5 the same name with a DIFFERENT website host is a different company');
select is((select report -> 'rows' -> 4 ->> 'company_created' from dedup), 'true', 'F5 a new company was created for it');
select is((select (company_id <> tests.rid('co_city'))::text from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from dedup) and row_no = 6), 'true', 'F6 the same name in a DIFFERENT city is a different company');
select is((select company_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from dedup) and row_no = 7), tests.rid('co_city'), 'F7 the same name in the same city (any case) matches');
select is(pg_temp.out((select report from dedup), 8), 'created', 'F8 a new name creates a company');
select is(pg_temp.why((select report from dedup), 9), 'archived_company', 'F9 matching an archived company by host is refused');
select is(pg_temp.why((select report from dedup), 10), 'archived_company', 'F10 matching an archived company by name is refused');
select is((select count(*) from public.companies where tenant_id = tests.tid('a') and name = 'DEMO Archived Co'), 1::bigint, 'F11 and no second "DEMO Archived Co" was created');

-- ambiguous: two companies share a host / a name
insert into public.companies (id, tenant_id, name, website) values
  (tests.rid('amb_h1'), tests.tid('a'), 'DEMO Amb Host One', 'https://ambiguous-host.example.test'),
  (tests.rid('amb_h2'), tests.tid('a'), 'DEMO Amb Host Two', 'https://www.ambiguous-host.example.test/x'),
  (tests.rid('amb_n1'), tests.tid('a'), 'DEMO Amb Name', 'https://n1.example.test'),
  (tests.rid('amb_n2'), tests.tid('a'), 'DEMO amb  name', 'https://n2.example.test');
create temp table amb as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('whatever', '{"website":"https://ambiguous-host.example.test"}'),
  pg_temp.row('DEMO AMB NAME')
)) as report;
select is(pg_temp.out((select report from amb), 1) || '/' || pg_temp.why((select report from amb), 1), 'ambiguous/ambiguous_company', 'F12 two companies on one host -> ambiguous, skipped');
select is(pg_temp.out((select report from amb), 2) || '/' || pg_temp.why((select report from amb), 2), 'ambiguous/ambiguous_company', 'F13 two companies of one name -> ambiguous, skipped');
select is((select count(*) from public.leads where company_id in (tests.rid('amb_h1'), tests.rid('amb_h2'), tests.rid('amb_n1'), tests.rid('amb_n2'))), 0::bigint, 'F14 an ambiguous row creates nothing');
select is((select (report -> 'counts' ->> 'ambiguous') from amb), '2', 'F15 the report counts the ambiguous rows');

-- shared hosts never identify a business
create temp table shared_run as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO Page Alpha', '{"website":"https://www.facebook.com/alpha.page"}'),
  pg_temp.row('DEMO Page Beta',  '{"website":"https://facebook.com/beta.page"}'),
  pg_temp.row('DEMO Shop Gamma', '{"website":"https://gamma.business.site"}'),
  pg_temp.row('DEMO Shop Delta', '{"website":"https://delta.business.site"}'),
  pg_temp.row('DEMO Page Alpha', '{"website":"https://facebook.com/someone.else"}')
)) as report;
select is((select report -> 'counts' ->> 'companies_created' from shared_run), '4', 'F16 four businesses on shared hosts stay four companies (host never merges them); the fifth row matches Alpha by name');
select is(pg_temp.out((select report from shared_run), 5), 'skipped_duplicate', 'F17 the fifth row matched "DEMO Page Alpha" by NAME and its lead already exists');

-- ============================================================================ G. contact de-duplication
insert into public.companies (id, tenant_id, name) values (tests.rid('g_c1'), tests.tid('a'), 'DEMO G Company One'), (tests.rid('g_c2'), tests.tid('a'), 'DEMO G Company Two');
insert into public.contacts (id, tenant_id, company_id, full_name, email) values
  (tests.rid('g_k1'), tests.tid('a'), tests.rid('g_c1'), 'DEMO Original Name', 'old.contact@demo.example.test'),
  (tests.rid('g_k2'), tests.tid('a'), tests.rid('g_c2'), 'DEMO Other Company Person', 'other.contact@demo.example.test'),
  (tests.rid('g_k3'), tests.tid('a'), null, 'DEMO No Company Person', 'nocompany.contact@demo.example.test');
create temp table contacts_run as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO G Company One', '{"contact_name":"DEMO Changed Name","contact_email":"OLD.Contact@Demo.Example.Test","contact_job_title":"DEMO New Title"}'),   -- 1 existing contact, same company
  pg_temp.row('DEMO G Fresh Company', '{"contact_name":"DEMO X","contact_email":"other.contact@demo.example.test"}'),                                                    -- 2 belongs to another company
  pg_temp.row('DEMO G Company One', '{"contact_name":"DEMO X","contact_email":"nocompany.contact@demo.example.test"}'),                                                  -- 3 existing contact has no company
  pg_temp.row('DEMO G Company Two', '{"contact_name":"DEMO Y","contact_email":"brand.new@demo.example.test"}')                                                            -- 4 new contact
)) as report;
select is(pg_temp.out((select report from contacts_run), 1), 'created', 'G1 an existing contact of the same company (e-mail in any case) is reused');
select is((select report -> 'rows' -> 0 ->> 'contact_created' from contacts_run), 'false', 'G1 and no contact is created');
select is((select contact_id from public.leads where company_id = tests.rid('g_c1') order by created_at limit 1), tests.rid('g_k1'), 'G1 the new lead points at the existing contact');
select results_eq($$select full_name, job_title from public.contacts where id = $$ || quote_literal(tests.rid('g_k1')), $$values ('DEMO Original Name'::text, null::text)$$,
  'G1 an existing contact is NEVER updated (no name or title overwrite)');
select is(pg_temp.out((select report from contacts_run), 2) || '/' || pg_temp.why((select report from contacts_run), 2), 'rejected/contact_belongs_to_other_company', 'G2 an e-mail that belongs to another company is refused');
select is((select count(*) from public.companies where name = 'DEMO G Fresh Company'), 0::bigint, 'G2 and the company created for that row was rolled back');
select is(pg_temp.why((select report from contacts_run), 3), 'contact_belongs_to_other_company', 'G3 an existing contact with no company is refused too');
select is(pg_temp.out((select report from contacts_run), 4), 'created', 'G4 a new contact is created');
select is((select count(*) from public.contacts where tenant_id = tests.tid('a') and lower(email) = 'brand.new@demo.example.test'), 1::bigint, 'G4 exactly one');
select is((select count(*) from public.contacts where tenant_id = tests.tid('a') and lower(email) = 'old.contact@demo.example.test'), 1::bigint, 'G5 still one contact for the reused e-mail (the unique index never fired)');

-- ============================================================================ H. lead de-duplication
insert into public.companies (id, tenant_id, name) values (tests.rid('h_c'), tests.tid('a'), 'DEMO H Company');
insert into public.contacts (id, tenant_id, company_id, full_name, email) values
  (tests.rid('h_k1'), tests.tid('a'), tests.rid('h_c'), 'DEMO H Contact One', 'h1@demo.example.test'),
  (tests.rid('h_k2'), tests.tid('a'), tests.rid('h_c'), 'DEMO H Contact Two', 'h2@demo.example.test');
create temp table leads_run_1 as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO H Company', '{"contact_name":"x","contact_email":"h1@demo.example.test"}'),   -- 1 creates a lead (company + contact 1)
  pg_temp.row('DEMO H Company', '{"contact_name":"x","contact_email":"h1@demo.example.test"}'),   -- 2 same company + contact in the same file -> duplicate
  pg_temp.row('DEMO H Company', '{"contact_name":"x","contact_email":"h2@demo.example.test"}'),   -- 3 another contact of the company -> a new lead
  pg_temp.row('DEMO H Company')                                                                     -- 4 no contact, an open lead exists -> duplicate
)) as report;
select is(pg_temp.out((select report from leads_run_1), 1), 'created', 'H1 first row creates the lead');
select is(pg_temp.out((select report from leads_run_1), 2) || '/' || pg_temp.why((select report from leads_run_1), 2), 'skipped_duplicate/existing_open_lead', 'H2 the same company + contact again (even inside one file) is a duplicate');
select is(pg_temp.out((select report from leads_run_1), 3), 'created', 'H3 another contact of the same company is a different lead');
select is(pg_temp.out((select report from leads_run_1), 4), 'skipped_duplicate', 'H4 a row with no contact is a duplicate when ANY open lead exists for the company');
select is((select count(*) from public.leads where company_id = tests.rid('h_c')), 2::bigint, 'H5 two leads exist in total');
-- statuses and archive
update public.leads set status = 'disqualified' where company_id = tests.rid('h_c') and contact_id = tests.rid('h_k1');
update public.leads set archived_at = now() where company_id = tests.rid('h_c') and contact_id = tests.rid('h_k2');
create temp table leads_run_2 as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO H Company', '{"contact_name":"x","contact_email":"h1@demo.example.test"}'),   -- the only lead for contact 1 is disqualified -> a new lead
  pg_temp.row('DEMO H Company', '{"contact_name":"x","contact_email":"h2@demo.example.test"}')    -- the only lead for contact 2 is archived -> a new lead
)) as report;
select is(pg_temp.out((select report from leads_run_2), 1) || '/' || pg_temp.out((select report from leads_run_2), 2), 'created/created', 'H6 a disqualified lead and an archived lead do not block a new one');
update public.leads set status = 'in_review' where id = (select lead_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from leads_run_2) and row_no = 1);
update public.leads set status = 'qualified' where id = (select lead_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from leads_run_2) and row_no = 2);
select is(pg_temp.out(pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO H Company', '{"contact_name":"x","contact_email":"h1@demo.example.test"}'))), 1), 'skipped_duplicate', 'H7 an in_review lead blocks');
select is(pg_temp.out(pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO H Company', '{"contact_name":"x","contact_email":"h2@demo.example.test"}'))), 1), 'skipped_duplicate', 'H8 a qualified lead blocks');
select is((select report -> 'counts' ->> 'skipped_duplicate' from leads_run_1), '2', 'H9 the report counts duplicates');

-- ============================================================================ I. attributes are claims, and an import never overrides one
insert into public.companies (id, tenant_id, name) values (tests.rid('i_c1'), tests.tid('a'), 'DEMO I Company One'), (tests.rid('i_c2'), tests.tid('a'), 'DEMO I Company Two'), (tests.rid('i_c3'), tests.tid('a'), 'DEMO I Company Three');
-- a person (Sales) recorded buyer_type for company 1 as a manual claim; company 2 has an ARCHIVED size_band claim
select tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (%L, %L, %L, 'buyer_type', 'boutique', 'medium')$q$, tests.rid('i_human'), tests.tid('a'), tests.rid('i_c1')));
insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (tests.rid('i_arch'), tests.tid('a'), tests.rid('i_c2'), 'size_band', 'micro', 'low');
update public.claims set archived_at = now() where id = tests.rid('i_arch');
create temp table attr_run as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO I Company One', '{"buyer_type":"independent_shop","size_band":"small"}'),
  pg_temp.row('DEMO I Company Two', '{"size_band":"medium"}'),
  pg_temp.row('DEMO I Company Three', '{"buyer_type":"Independent Shop"}'),
  pg_temp.row('DEMO I Fresh Company', '{"buyer_type":"x","operating_status":"UPPER"}'),
  pg_temp.row('DEMO I Company Four', jsonb_build_object('order_scale', repeat('a', 41))),
  pg_temp.row('DEMO I Company Five', '{"buyer_type":"1abc"}'),
  pg_temp.row('DEMO I Company Six', '{"buyer_type":"a b"}'),
  pg_temp.row('DEMO I Company Seven', '{"buyer_type":""}')
)) as report;
select results_eq($$select value, confidence::text, created_via::text from public.claims where company_id = $$ || quote_literal(tests.rid('i_c1')) || $$ and predicate = 'buyer_type'$$,
  $$values ('boutique'::text, 'medium'::text, 'manual'::text)$$, 'I1 the person''s claim is untouched and no import claim was added next to it');
select is((select report -> 'rows' -> 0 ->> 'attributes_kept' from attr_run) || '/' || (select report -> 'rows' -> 0 ->> 'attributes_written' from attr_run), '1/1', 'I1 the report says one attribute was kept and one written');
select is((select value from public.claims where company_id = tests.rid('i_c1') and predicate = 'size_band'), 'small', 'I2 the other attribute of that company was written');
select is((select value || '/' || created_via::text from public.claims where company_id = tests.rid('i_c2') and predicate = 'size_band' and archived_at is null), 'medium/import', 'I3 an ARCHIVED claim does not count: the import writes a fresh one');
select is(pg_temp.why((select report from attr_run), 3), 'invalid_attribute', 'I4 "Independent Shop" is not a slug -> invalid_attribute');
select is((select count(*) from public.companies where name in ('DEMO I Fresh Company', 'DEMO I Company Four', 'DEMO I Company Five', 'DEMO I Company Six')), 0::bigint, 'I5 rows with a bad attribute create nothing (the company is rolled back)');
select is(pg_temp.why((select report from attr_run), 4) || '/' || pg_temp.why((select report from attr_run), 5) || '/' || pg_temp.why((select report from attr_run), 6) || '/' || pg_temp.why((select report from attr_run), 7),
  'invalid_attribute/invalid_attribute/invalid_attribute/invalid_attribute', 'I6 upper case, 41 characters, a leading digit and a blank inside are all refused');
select is(pg_temp.out((select report from attr_run), 8), 'created', 'I7 an empty attribute value means "not supplied"');
-- a second import with a different value does not override
select is(pg_temp.out(pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO I Company Two', '{"size_band":"large"}'))), 1), 'skipped_duplicate', 'I8 re-importing the company is a duplicate lead...');
select is((select count(*) from public.claims where company_id = tests.rid('i_c2') and predicate = 'size_band' and archived_at is null), 1::bigint, 'I9 ...and writes no second claim');
select is((select value from public.claims where company_id = tests.rid('i_c2') and predicate = 'size_band' and archived_at is null), 'medium', 'I10 the stored value did not change');
-- only the four predicates; a row cannot write any other claim
select is(pg_temp.why(pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO I Other', '{"exports_to":"germany"}')), gen_random_uuid(), true), 1), 'unknown_field', 'I11 no other claim predicate can be written');
select is(pg_temp.why(pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO I Other', '{"confidence":"high"}')), gen_random_uuid(), true), 1), 'unknown_field', 'I12 and the confidence cannot be chosen');

-- ============================================================================ J. idempotency and dry run
create temp table idem as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO J One'), pg_temp.row('DEMO J Two')), tests.rid('batch_j')) as report;
select is(pg_temp.cnt('a'), pg_temp.cnt('a'), 'J0 (control)');
create temp table before_replay as select pg_temp.cnt('a') as c;
create temp table replay as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO J One'), pg_temp.row('DEMO J Two')), tests.rid('batch_j')) as report;
select is((select report ->> 'replayed' from replay), 'true', 'J1 the same batch id with the same rows is a replay');
select is((select report -> 'counts' from replay), (select report -> 'counts' from idem), 'J2 and returns the same counts');
select is((select report -> 'rows' from replay), (select report -> 'rows' from idem), 'J3 and the same per-row report');
select is(pg_temp.cnt('a'), (select c from before_replay), 'J4 a replay writes nothing');
select is(pg_temp.imp('a_admin', 'a', jsonb_build_array(pg_temp.row('DEMO J One'), pg_temp.row('DEMO J Two')), tests.rid('batch_j')) ->> 'replayed', 'true', 'J6 another member of the tenant replaying the same batch also gets the stored report');
select is(tests.error_shape_as(tests.uid('a_sales'), pg_temp.call_sql('a', jsonb_build_array(pg_temp.row('DEMO J One'), pg_temp.row('DEMO J Three'))::text, tests.rid('batch_j'))),
  '23505:import_batches_pkey:import_batches', 'J7 the same batch id with DIFFERENT rows -> 23505');
select is(tests.outcome_as(tests.uid('a_viewer'), pg_temp.call_sql('a', jsonb_build_array(pg_temp.row('DEMO J One'), pg_temp.row('DEMO J Two'))::text, tests.rid('batch_j'))), '42501', 'J8 a Viewer cannot replay either');
create temp table again as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO J One'), pg_temp.row('DEMO J Two'))) as report;
select is((select report -> 'counts' ->> 'created' from again) || '/' || (select report -> 'counts' ->> 'skipped_duplicate' from again), '0/2', 'J9 the same file under a NEW batch id creates nothing: every row is a duplicate');
select is((select report ->> 'replayed' from again), 'false', 'J10 and it is a real, new batch');
-- dry run
create temp table before_dry as select pg_temp.cnt('a') as c;
create temp table dry as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO K Dry One', '{"buyer_type":"x"}'), pg_temp.row('DEMO K Dry Two'), pg_temp.row('DEMO K Dry Two'), pg_temp.row(''),
  pg_temp.row('DEMO H Company'), pg_temp.row('DEMO K Dry Three', '{"contact_name":"a","contact_email":"dry3@demo.example.test"}')), tests.rid('batch_dry'), true, 'DEMO dry') as report;
select is((select report ->> 'dry_run' from dry), 'true', 'J11 a dry run says so');
select is((select report ->> 'batch_id' from dry), null, 'J12 and names no batch');
select is((select report -> 'counts' ->> 'created' from dry), '3', 'J13 it reports exactly what a real run would do: 3 created');
select is((select report -> 'counts' ->> 'skipped_duplicate' from dry) || '/' || (select report -> 'counts' ->> 'rejected' from dry), '2/1', 'J14 ...2 duplicates (a repeated row, an existing lead) and 1 rejected (empty name)');
select is(pg_temp.why((select report from dry), 4), 'company_name_missing', 'J15 with the same reasons');
select is(pg_temp.cnt('a'), (select c from before_dry), 'J16 a dry run writes NOTHING (companies, contacts, leads, claims, batches, rows)');
select is((select count(*) from public.audit_events where entity_type in ('company', 'contact', 'lead', 'claim', 'import_batch', 'import_row') and to_jsonb(audit_events)::text ~ 'DEMO K Dry'), 0::bigint, 'J17 not even audit rows survive a dry run');
select is(pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO K Probe')), tests.rid('batch_dry')) ->> 'replayed', 'false', 'J18 a dry run does not consume the batch id (a real run with the same id is a fresh batch)');
select is(current_setting('app.created_via', true), '', 'J19 and leaves app.created_via cleared');
-- the real run does what the dry run said
create temp table real_after_dry as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO K Dry One', '{"buyer_type":"x"}'), pg_temp.row('DEMO K Dry Two'), pg_temp.row('DEMO K Dry Two'), pg_temp.row(''),
  pg_temp.row('DEMO H Company'), pg_temp.row('DEMO K Dry Three', '{"contact_name":"a","contact_email":"dry3@demo.example.test"}'))) as report;
select is((select report -> 'counts' from real_after_dry), (select report -> 'counts' from dry), 'J20 the real run produces exactly the counts the dry run predicted');
select is((select report -> 'rows' from real_after_dry) - 0, (select report -> 'rows' from dry) - 0, 'J21 and the same per-row outcomes') where false;
select is(
  (select jsonb_agg(jsonb_build_array(r ->> 'row', r ->> 'outcome', r ->> 'reason') order by (r ->> 'row')::int) from jsonb_array_elements((select report -> 'rows' from real_after_dry)) r),
  (select jsonb_agg(jsonb_build_array(r ->> 'row', r ->> 'outcome', r ->> 'reason') order by (r ->> 'row')::int) from jsonb_array_elements((select report -> 'rows' from dry)) r),
  'J21 and the same outcome and reason for every row');

-- ============================================================================ K. one bad row never takes a neighbour down, or leaves a fragment
create temp table iso as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  pg_temp.row('DEMO Iso Good One'),
  pg_temp.row(repeat('n', 201)),
  pg_temp.row('DEMO Iso Good Two', '{"contact_name":"DEMO Z","contact_email":"iso2@demo.example.test"}'),
  jsonb_build_object('company_name', 'DEMO Iso Hidden ' || chr(8203) || 'x'),
  pg_temp.row('DEMO Iso Bad Email', '{"contact_name":"DEMO Z","contact_email":"a b@example.com"}'),
  pg_temp.row('DEMO Iso Long Site', jsonb_build_object('website', 'https://' || repeat('w', 200) || '.example.test')),
  pg_temp.row('DEMO Iso Tag Hidden', jsonb_build_object('industry', 'Silk' || chr(917536))),
  pg_temp.row('DEMO Iso Many Tags', jsonb_build_object('categories', (select jsonb_agg('t' || i) from generate_series(1, 21) i))),
  pg_temp.row('DEMO Iso Good Three')
)) as report;
select is((select report -> 'counts' ->> 'created' from iso) || '/' || (select report -> 'counts' ->> 'rejected' from iso), '3/6', 'K1 three good rows are created, six bad ones rejected');
select is(pg_temp.why((select report from iso), 2) || '/' || (select report -> 'rows' -> 1 ->> 'constraint' from iso), 'data_rejected/companies_name_check', 'K2 an over-long name: data_rejected, and the report names the CONSTRAINT');
select is((select report -> 'rows' -> 3 ->> 'constraint' from iso), 'companies_name_clean', 'K3 a zero-width space: the hygiene constraint');
select is((select report -> 'rows' -> 4 ->> 'constraint' from iso), 'contacts_email_check', 'K4 a malformed e-mail: the contacts e-mail constraint');
select is((select report -> 'rows' -> 5 ->> 'constraint' from iso), 'companies_website_check', 'K5 a 200+ character website: the website constraint');
select is((select report -> 'rows' -> 6 ->> 'constraint' from iso), 'companies_industry_clean', 'K6 a tag character: the hygiene constraint');
select is((select report -> 'rows' -> 7 ->> 'constraint' from iso), 'companies_tags_check', 'K7 21 categories: the tags constraint');
select is((select report -> 'rows' -> 1 ->> 'sqlstate' from iso), '23514', 'K8 and the SQLSTATE');
select is((select count(*) from public.companies where name like 'DEMO Iso %'), 3::bigint, 'K9 exactly the three good companies exist: no fragment of a bad row');
select is((select count(*) from public.contacts where lower(email) in ('iso2@demo.example.test')), 1::bigint, 'K10 the good contact exists');
select is((select count(*) from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from iso)), 9::bigint, 'K11 all nine rows have a record, rejected ones included');
select is((select count(*) from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from iso) and outcome = 'rejected' and (company_id is not null or lead_id is not null)), 0::bigint, 'K12 a rejected row records no ids');
select is((select count(*) from public.import_rows where tenant_id = tests.tid('a') and outcome = 'rejected' and constraint_name is not null and sqlstate is null), 0::bigint, 'K13 a constraint is always recorded with its SQLSTATE');
select is(
  (select count(*) from (select to_jsonb(x)::text t from public.import_rows x union all select (select report from iso)::text) s where t like '%wwwwwwwwww%' or t like '%nnnnnnnnnn%'), 0::bigint,
  'K14 neither the report nor the row records contain a rejected value');

-- ============================================================================ L. provenance cannot be spoofed
select set_config('app.created_via', 'agent', true);
create temp table spoof as select pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO Spoof One', '{"contact_name":"x","contact_email":"spoof@demo.example.test","buyer_type":"boutique"}')), gen_random_uuid()) as report;
select is((select string_agg(distinct v, ',') from (
   select created_via::text v from public.companies where name = 'DEMO Spoof One'
   union all select created_via::text from public.contacts where lower(email) = 'spoof@demo.example.test'
   union all select created_via::text from public.leads where company_id = (select id from public.companies where name = 'DEMO Spoof One')
   union all select created_via::text from public.claims where company_id = (select id from public.companies where name = 'DEMO Spoof One')
   union all select created_via::text from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from spoof)
   union all select created_via::text from public.import_batches where id = (select (report ->> 'batch_id')::uuid from spoof)) s),
  'import', 'L1 a pre-set app.created_via = agent is overwritten: every row says import');
select is(current_setting('app.created_via', true), '', 'L2 and it is cleared afterwards');
select set_config('app.created_via', 'manual', true);
create temp table spoof2 as select pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO Spoof Two'))) as report;
select is((select created_via::text from public.companies where id = (select company_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from spoof2) limit 1)), 'import', 'L3 a pre-set "manual" does not turn an import into a manual row either');
select set_config('app.created_via', '', true);
select is((select bool_and(created_by = tests.uid('a_sales')) from public.companies where name like 'DEMO Spoof %'), true, 'L4 created_by is the signed-in importer, not a value from the payload');
-- clients still cannot declare import themselves
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence, created_via) values (gen_random_uuid(), %L, %L, 'buyer_type', 'x', 'low', 'import')$q$, tests.tid('a'), tests.rid('i_c3'))), '42501', 'L5 a client cannot insert created_via = import into claims');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.companies (id, tenant_id, name, created_via) values (gen_random_uuid(), %L, 'DEMO Forged', 'import')$q$, tests.tid('a'))), '42501', 'L6 nor into companies');
select set_config('app.created_via', 'import', true);
select tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.companies (id, tenant_id, name) values (%L, %L, 'DEMO Guc Forgery')$q$, tests.rid('guc_co'), tests.tid('a')));
select is((select created_via::text from public.companies where id = tests.rid('guc_co')), 'manual', 'L7 setting the GUC from a client session does not make a client insert an import');
select set_config('app.created_via', '', true);
-- direct writes to the import tables are impossible
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.import_batches (id, tenant_id, content_sha256, row_count, rejected_count) values (gen_random_uuid(), %L, repeat('a', 64), 1, 1)$q$, tests.tid('a'))), '42501', 'L8 nobody inserts an import batch directly');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.import_rows (tenant_id, batch_id, row_no, outcome, reason) values (%L, %L, 1, 'rejected', 'invalid_row')$q$, tests.tid('a'), tests.rid('batch_e'))), '42501', 'L9 nor an import row');
select is(tests.outcome_as(tests.uid('a_owner'), format('update public.import_batches set row_count = 1 where id = %L', tests.rid('batch_e'))), '42501', 'L10 nor update one');
select is(tests.outcome_as(tests.uid('a_owner'), format('delete from public.import_rows where batch_id = %L', tests.rid('batch_e'))), '42501', 'L11 nor delete rows');
select is(tests.outcome_as(tests.uid('a_viewer'), format('select 1 from public.import_batches where id = %L', tests.rid('batch_e'))), 'rows:1', 'L12 every member reads the batch record');
select is(tests.outcome_as(tests.uid('b_sales'), format('select 1 from public.import_batches where id = %L', tests.rid('batch_e'))), 'rows:0', 'L13 another tenant does not');
select is(tests.outcome_as(tests.uid('b_sales'), format('select 1 from public.import_rows where batch_id = %L', tests.rid('batch_e'))), 'rows:0', 'L14 nor the row records');

-- ============================================================================ M. audit and PII
create temp table audit_run as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(pg_temp.row('DEMO Audit Co', jsonb_build_object(
  'contact_name', 'Zephyrine Quasimodo', 'contact_email', 'zephyrine.quasi@demo.example.test', 'contact_phone', '+00 555 0100',
  'contact_job_title', 'Chief Pretzel Officer', 'source', 'whispered by Mr Xylo', 'buyer_type', 'boutique'))), gen_random_uuid(), false, 'DEMO audit label') as report;
select is((select report -> 'counts' ->> 'created' from audit_run), '1', 'M0 setup: a fully populated row imported');
select is((select count(*) from public.audit_events where actor_user_id = tests.uid('a_sales') and action in ('company.create', 'contact.create', 'lead.create', 'claim.create', 'import_batch.create', 'import_row.create')
            and entity_id in (select company_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from audit_run)
                              union select contact_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from audit_run)
                              union select lead_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from audit_run)
                              union select (report ->> 'batch_id')::uuid from audit_run)), 4::bigint,
  'M1 company, contact, lead and batch creations are audited with the importing user as actor');
select is((select count(*) from public.audit_events where action = 'claim.create' and actor_user_id = tests.uid('a_sales') and (new_values ->> 'company_id')::uuid in (select company_id from public.import_rows where batch_id = (select (report ->> 'batch_id')::uuid from audit_run))), 1::bigint, 'M2 the attribute claim is audited too');
select is((select count(*) from public.audit_events a where to_jsonb(a)::text ~* '(zephyrine|quasimodo|pretzel|xylo|555 0100|demo audit label|zephyrine\.quasi)'), 0::bigint,
  'M3 no contact name / e-mail / phone / title, source text or batch label appears ANYWHERE in audit_events');
select ok((select metadata -> 'pii_fields_changed' @> '["label"]'::jsonb from public.audit_events where action = 'import_batch.create' and entity_id = (select (report ->> 'batch_id')::uuid from audit_run)), 'M4 the batch label is audited by NAME only');
select is((select count(*) from (select to_jsonb(x)::text t from public.import_rows x union all select to_jsonb(x)::text from public.import_batches x) s where t ~* '(zephyrine|quasimodo|pretzel|xylo|555 0100|zephyrine\.quasi|DEMO Audit Co)'), 0::bigint,
  'M5 the batch / row records hold no personal text and no company text');

-- ============================================================================ N. the function source is the audit trail of what it can write
create temp table src as select pg_get_functiondef('public.import_lead_rows(uuid,uuid,jsonb,text,boolean)'::regprocedure) as def;
select is((select string_agg(distinct m[1], ',' order by m[1]) from src, regexp_matches(def, 'insert\s+into\s+public\.(\w+)', 'gi') m),
  'claims,companies,contacts,evidence,evidence_links,import_batches,import_rows,leads', 'N1 it inserts into exactly: claims, companies, contacts, evidence, evidence_links, import_batches, import_rows, leads');
select is((select count(*) from src where def ~* '\mupdate\s+(public\.)?\w+\s+set\M'), 0::bigint, 'N2 it never UPDATEs anything');
select is((select count(*) from src where def ~* '\mdelete\s+from\M'), 0::bigint, 'N3 it never DELETEs anything');
select is((select count(*) from src where def ~* '\mtruncate\M'), 0::bigint, 'N4 it never TRUNCATEs');
select is((select count(*) from src where def ~* 'current_setting\s*\('), 0::bigint, 'N5 it never READS a setting (so a pre-set app.created_via cannot be trusted by it)');
select ok((select def ~ 'set_config\(''app\.created_via'', ''import'', true\)' from src), 'N6 it sets app.created_via = import explicitly');
select ok((select def ~ 'set_config\(''app\.created_via'', '''', true\)' from src), 'N7 and clears it again');
select ok((select def ~ 'has_tenant_role\(p_tenant_id, array\[''owner'', ''admin'', ''sales''\]' from src), 'N8 it checks the caller''s role in the named tenant');
select ok((select def ~* 'auth\.uid\(\)' from src), 'N9 it requires a signed-in user');
select ok((select def ~* 'pg_advisory_xact_lock' from src), 'N10 it serialises imports per tenant');
select cmp_ok((select count(*) from src, regexp_matches(def, 'tenant_id\s*=\s*p_tenant_id', 'g')), '>=', 8::bigint, 'N11 every read of tenant data is filtered by the checked tenant id');
select ok((select def ~ '''example\.com''' and def ~ '''example\.org''' and def ~ '''example\.net''' and def ~ '''invalid''' and def ~ '''test''' and def ~ '''example''' and def ~ '\+00' from src), 'N12 the reserved domains and the +00 phone prefix are constants in the function body');
select is((select count(*) from src where def ~* 'p_tenant_id\s*:=|p_tenant_id\s*=\s*coalesce'), 0::bigint, 'N13 the tenant id argument is never reassigned');
select is((select count(*) from src where def ~* '\mset\s+role\M|\mset_config\(''role'''), 0::bigint, 'N14 it never switches role');
select is((select count(*) from src where def ~* 'execute\s+(format|''|\$)'), 0::bigint, 'N15 no dynamic SQL');
select is((select count(*) from src, regexp_split_to_table(def, ';') stmt
            where stmt ~* 'from\s+public\.(companies|contacts|leads|claims)\M' and stmt !~* 'tenant_id\s*=\s*p_tenant_id'), 0::bigint,
  'N16 every statement that reads a tenant table carries the tenant filter');
select ok(not has_function_privilege('authenticated', 'app.is_shared_host(text)', 'execute'), 'N17 the internal helper is not callable by clients');

-- ============================================================================ O. non-Latin text end to end
create temp table indic as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  jsonb_build_object('company_name', 'DEMO శ్రీ సిల్క్స్ (కల్పిత)', 'city', 'బెంగళూరు', 'industry', 'చీరలు', 'categories', jsonb_build_array('చీర', 'పట్టు')),
  jsonb_build_object('company_name', 'DEMO ಸಿಲ್ಕ್' || chr(8205) || ' ಹೌಸ್ (ಕಾಲ್ಪನಿಕ)', 'city', 'ಬೆಂಗಳೂರು', 'contact_name', 'DEMO ಆಶಾ', 'contact_email', 'asha.k@demo.example.test', 'contact_job_title', 'ಮಾಲೀಕರು'),
  jsonb_build_object('company_name', 'DEMO साड़ी भंडार (काल्पनिक)'),
  jsonb_build_object('company_name', 'DEMO مرحبا للحرير'),
  jsonb_build_object('company_name', 'DEMO می' || chr(8204) || 'خواهم')
)) as report;
select is((select report -> 'counts' ->> 'created' from indic), '5', 'O1 Telugu, Kannada (with a ZWJ), Devanagari, Arabic and Persian (with a ZWNJ) rows are all created');
select ok(exists (select 1 from public.companies where name = 'DEMO శ్రీ సిల్క్స్ (కల్పిత)' and city = 'బెంగళూరు' and tags = array['చీర', 'పట్టు']), 'O2 Telugu text is stored verbatim');
select ok(exists (select 1 from public.companies where name = 'DEMO ಸಿಲ್ಕ್' || chr(8205) || ' ಹೌಸ್ (ಕಾಲ್ಪನಿಕ)'), 'O3 a ZWJ inside a Kannada name is kept in the stored text');
select ok(exists (select 1 from public.contacts where full_name = 'DEMO ಆಶಾ' and job_title = 'ಮಾಲೀಕರು'), 'O4 Kannada contact fields are stored verbatim');
create temp table indic2 as
select pg_temp.imp('a_sales', 'a', jsonb_build_array(
  jsonb_build_object('company_name', 'DEMO శ్రీ సిల్క్స్ (కల్పిత)'),                                              -- identical
  jsonb_build_object('company_name', 'DEMO ಸಿಲ್ಕ್ ಹೌಸ್ (ಕಾಲ್ಪನಿಕ)'),                                          -- the Kannada name WITHOUT its ZWJ
  jsonb_build_object('company_name', 'demo   ಸಿಲ್ಕ್' || chr(8204) || ' ಹೌಸ್ (ಕಾಲ್ಪನಿಕ)'),                        -- other case / blanks / a ZWNJ instead
  jsonb_build_object('company_name', 'DEMO می' || chr(8205) || 'خواهم'),                                         -- Persian with ZWJ instead of ZWNJ
  jsonb_build_object('company_name', 'DEMO శ్రీ సిల్క్స్ (కల్పిత) 2')                                           -- a different Telugu name
)) as report;
select is(pg_temp.out((select report from indic2), 1) || '/' || pg_temp.out((select report from indic2), 2) || '/' || pg_temp.out((select report from indic2), 3) || '/' || pg_temp.out((select report from indic2), 4),
  'skipped_duplicate/skipped_duplicate/skipped_duplicate/skipped_duplicate', 'O5 joiner and spacing variants of existing non-Latin names match them (and their leads already exist)');
select is(pg_temp.out((select report from indic2), 5), 'created', 'O6 a genuinely different Telugu name is a new company');
select is((select report -> 'counts' ->> 'companies_created' from indic2), '1', 'O7 only one new company');
select is(pg_temp.out(pg_temp.imp('a_sales', 'a', jsonb_build_array(jsonb_build_object('company_name', 'DEMO తెలుగు' || chr(917536) || 'x')), gen_random_uuid(), true), 1) || '/' ||
          (pg_temp.imp('a_sales', 'a', jsonb_build_array(jsonb_build_object('company_name', 'DEMO తెలుగు' || chr(917536) || 'x')), gen_random_uuid(), true) -> 'rows' -> 0 ->> 'constraint'),
  'rejected/companies_name_clean', 'O8 a tag character hidden in Telugu text is refused by the hygiene constraint');
select is(pg_temp.out(pg_temp.imp('a_sales', 'a', jsonb_build_array(jsonb_build_object('company_name', 'DEMO ಕನ್ನಡ' || chr(8203) || 'x')), gen_random_uuid(), true), 1), 'rejected', 'O9 and a zero-width space hidden in Kannada text');

select * from finish();
rollback;
