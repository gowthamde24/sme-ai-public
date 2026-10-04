-- T006b M1 (ADR 0014): erasing ONE COMPANY (a sole proprietor's business, the Owner's choice) and a WHOLE WORKSPACE.
--   company: name, website, city, region, tags; its leads / opportunities / claims / evidence; the sweep for its name and website host;
--            audit rows written BEFORE the company columns were classified PII are scrubbed of those four values; its contacts are untouched
--   tenant:  every PII column of every row, every contact; company identities are NOT touched (use the company scope)
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.er_plant('a');
select tests.er_plant('b');
-- a legacy audit row: written before companies.name / website / city / region were PII-classified, so it carries the values
insert into public.audit_events (tenant_id, actor_type, action, entity_type, entity_id, old_values, new_values, metadata)
values (tests.tid('a'), 'user', 'company.update', 'company', tests.rid('a_company'),
        '{"name":"Old Kzv9 Silks","website":"https://kzv9-silks.test","country":"IN"}', '{"name":"Kzv9 Silks","city":"Kzv9pur","region":"Kzv9 State","industry":"Textiles"}', '{}');
select ok(exists (select 1 from public.audit_events where tenant_id = tests.tid('a') and new_values::text ilike '%kzv9%'), 'sanity: a legacy audit row carries the company values');

create function pg_temp.d(p_sql text) returns text language plpgsql as $$ declare v text; begin execute p_sql into v; return v; end $$;
create temp table pre as select tests.er_digest('b') as b_digest,
  pg_temp.d($$select md5(string_agg(x::text, '~' order by x::text)) from public.contacts x where tenant_id = tests.tid('a')$$) as contacts_digest,
  pg_temp.d($$select md5(string_agg(x::text, '~' order by x::text)) from public.companies x where tenant_id = tests.tid('a') and id <> tests.rid('a_company')$$) as other_companies_digest;

-- ================================================================== company scope
select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''company'', %L)', tests.rid('k1'), tests.tid('a'), tests.rid('a_company')));
create temp table res as select tests.scalar_as(tests.uid('a_owner'), format('select public.execute_erasure(%L, false)', tests.rid('k1')))::jsonb as r;
select is((select r ->> 'status' from res), 'executed', 'the Owner erased the company');
select results_eq(format($$select name, website, city, region, tags::text, erased_at is not null from public.companies where id = %L$$, tests.rid('a_company')),
  $$values ('erased:1'::text, null::text, null::text, null::text, '{}'::text, true)$$, 'the company: name tombstoned, website / city / region gone, tags emptied, marked erased');
select results_eq(format($$select country, industry from public.companies where id = %L$$, tests.rid('a_company')), $$select country, industry from public.companies where id = (select id from public.companies where tenant_id = (select tests.tid('b')) limit 1)$$, 'country and industry are kept (the dataset stays usable)');
select is(pg_temp.d($$select md5(string_agg(x::text, '~' order by x::text)) from public.contacts x where tenant_id = tests.tid('a')$$), (select contacts_digest from pre), 'the company''s contacts are NOT touched (each is its own data principal)');
select is(pg_temp.d($$select md5(string_agg(x::text, '~' order by x::text)) from public.companies x where tenant_id = tests.tid('a') and id <> tests.rid('a_company')$$), (select other_companies_digest from pre), 'other companies are untouched');
select results_eq(format($$select source, disqualified_reason from public.leads where id = %L$$, tests.rid('a_lead')), $$values ('erased:1'::text, 'erased:1'::text)$$, 'the company''s lead: free text tombstoned');
select results_eq(format($$select title, lost_reason from public.opportunities where id = %L$$, tests.rid('a_opp')), $$values ('erased:1'::text, 'erased:1'::text)$$, 'the company''s opportunity');
select is((select value from public.claims where id = tests.rid('a_er_c4')), 'erased:1', 'a claim about the company');
select is((select value from public.claims where id = tests.rid('a_er_c5')), 'erased:1', 'a claim about one of the company''s leads');
select results_eq(format($$select url, reference, snippet from public.evidence where id = %L$$, tests.rid('a_er_e4')), $$values (null::text, 'erased:1'::text, 'erased:1'::text)$$, 'evidence attached to the company (a reference must stay, so it becomes the tombstone)');
select is((select snippet from public.evidence where id = tests.rid('a_er_e5')), 'erased:1', 'evidence attached to the company''s lead');
select is((select snippet from public.evidence where id = tests.rid('a_er_e6')), 'erased:1', 'evidence supporting the company''s claim');
select is((select snippet from public.evidence where id = tests.rid('a_er_e7')), 'erased:1', 'an unlinked snippet that EQUALS the company name');
select is((select snippet from public.evidence where id = tests.rid('a_er_e8')), 'Visit erased-1 for more', 'an unlinked snippet with the website host inside');
select is((select snippet from public.evidence where id = tests.rid('a_er_e9')), 'Kzv9 Silks Pvt Ltd range', 'an unlinked snippet that merely CONTAINS the name is left');
select is((select array_agg(i->>'table' || '.' || (i->>'column') || '#' || (i->>'id'))
             from jsonb_array_elements((select r -> 'review' from res)) i), array['evidence.snippet#' || tests.rid('a_er_e9')], 'and listed for manual review');
select is((select array_agg(h order by h) from unnest(tests.er_hits('a', 'kzv9')) h), array['evidence.snippet#' || tests.rid('a_er_e9')], 'nothing else of the company''s canary remains ANYWHERE, audit log included');
select ok(not exists (select 1 from public.audit_events where tenant_id = tests.tid('a') and (old_values ? 'name' or new_values ? 'name' or old_values ? 'website' or new_values ? 'city' or new_values ? 'region') and entity_type = 'company' and entity_id = tests.rid('a_company')), 'the legacy audit row lost the four values');
select results_eq(format($$select old_values::text, new_values::text from public.audit_events where tenant_id = %L and entity_id = %L and action = 'company.update' and old_values @> '{"country":"IN"}'$$, tests.tid('a'), tests.rid('a_company')),
  $$values ('{"country": "IN"}'::text, '{"industry": "Textiles"}'::text)$$, '...and kept every other key');
select is(tests.er_digest('b'), (select b_digest from pre), 'tenant b is byte-identical');
select is(tests.er_hits('a', 'qxjv') <@ tests.er_hits('a', 'qxjv'), true, 'sanity');

-- ================================================================== tenant scope
-- (fresh fixture: plant again in a clean transaction state by planting into tenant b, which was never erased)
create temp table tpre as select tests.er_digest('a') as a_digest;
select tests.scalar_as(tests.uid('b_owner'), format('select public.request_erasure(%L, %L, ''tenant'')', tests.rid('t1'), tests.tid('b')));
select is(tests.error_full_as(tests.uid('b_owner'), format('select public.execute_erasure(%L, false)', tests.rid('t1'))), 'SM302|erasure window has not elapsed||||', 'the 24-hour window holds');
update public.erasure_requests set execute_after = now() - interval '1 minute' where id = tests.rid('t1');  -- time travel: the window has passed
create temp table tres as select tests.scalar_as(tests.uid('b_owner'), format('select public.execute_erasure(%L, false)', tests.rid('t1')))::jsonb as r;
select is((select r ->> 'status' from tres), 'executed', 'after the window the Owner erases the whole workspace');
select is(tests.er_digest('a'), (select a_digest from tpre), 'tenant a is byte-identical after tenant b''s erasure');
select is(tests.er_hits('b', 'qxjv'), '{}'::text[], 'tenant scope: NO trace of the person anywhere (names in free text included, audit log included)');
select is(tests.er_hits('b', '9876[^0-9]{0,3}5432|canary\.test'), '{}'::text[], '...nor of the phone or the e-mail');
select is((select array_agg(h order by h) from unnest(tests.er_hits('b', 'kzv9')) h),
          array['companies.city#' || tests.rid('b_company'), 'companies.name#' || tests.rid('b_company'), 'companies.region#' || tests.rid('b_company'), 'companies.website#' || tests.rid('b_company')],
          'the company identities are NOT touched by the tenant scope (decision 4: use the company scope)');
select results_eq(format($$select count(*) filter (where full_name = 'erased:1' and email is null and phone is null and job_title is null and erased_at is not null), count(*) from public.contacts where tenant_id = %L$$, tests.tid('b')),
  $$select count(*), count(*) from public.contacts where tenant_id = (select tests.tid('b'))$$, 'every contact of the workspace is anonymised');
select is((select count(*) from public.leads where tenant_id = tests.tid('b')), 2::bigint, 'rows are kept (leads)');
select is((select count(*) from public.evidence where tenant_id = tests.tid('b')), 9::bigint, 'rows are kept (evidence)');

select * from finish();
rollback;
