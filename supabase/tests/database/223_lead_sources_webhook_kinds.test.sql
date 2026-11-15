-- Migration 20261231900000 (Track D slice 2): missed calls and Google Ads are source kinds with their own tag, and the Test button of any card sends one test row through the source's real intake (Owner or Admin).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

select is(app.lead_tag_ok('missed_calls') and app.lead_tag_ok('google_ads') and not app.lead_tag_ok('nonsense'), true, 'A1: the two new tags are known, others are not');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%L, %L, 'missed_calls', 'missed_calls', 'Missed calls', repeat('d', 64), 'wxyz', null, null, null))::text$q$, tests.tid('a'), tests.rid('a_missed'))) like '%missed_calls%', true, 'A2: the owner creates a missed-calls source');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%L, %L, 'google_ads', 'google_ads', 'Google Ads', repeat('e', 64), 'abcd', null, null, null))::text$q$, tests.tid('a'), tests.rid('a_gads'))) like '%google_ads%', true, 'A3: and a Google Ads one');
select is(pg_temp.val('a_owner', format($q$select public.lead_source_create(%L, gen_random_uuid(), 'fax', 'webhook', 'Fax', repeat('f', 64), 'abcd', null, null, null)::text$q$, tests.tid('a'))), 'ERR:22023', 'A4: an unknown kind is refused');

-- the Test button
select is(pg_temp.val('a_sales', format($q$select public.lead_source_test_lead(%L, 'missed_calls', '{"name": "Test lead", "phone": "+00 99999 11111"}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:42501', 'B1: Sales cannot test');
select is(pg_temp.val('b_owner', format($q$select public.lead_source_test_lead(%L, 'missed_calls', '{"name": "Test lead", "phone": "+00 99999 11111"}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:42501', 'B2: nor another business');
select is(pg_temp.val('a_owner', format($q$select public.lead_source_test_lead(%L, 'missed_calls', '{"name": "Test lead", "phone": "+91 98765 43210"}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:22023', 'B3: only a +00 99999 test number');
select is(pg_temp.val('a_owner', format($q$select public.lead_source_test_lead(%L, 'indiamart', '{"name": "Test lead", "phone": "+00 99999 11111"}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:22023', 'B4: only the kinds that have a test');
select is((pg_temp.val('a_owner', format($q$select public.lead_source_test_lead(%L, 'meta_lead_ads', '{"name": "Test lead", "phone": "+00 99999 11111"}'::jsonb)::text$q$, tests.tid('a')))::jsonb) ->> 'status', 'unknown', 'B5: a kind the business has not connected answers unknown');
select is((pg_temp.val('a_owner', format($q$select public.lead_source_test_lead(%L, 'missed_calls', '{"name": "Test lead (Missed calls)", "phone": "+00 99999 11111"}'::jsonb)::text$q$, tests.tid('a')))::jsonb) ->> 'status', 'received', 'B6: a connected one takes the row');
select is((select count(*) from public.leads l join public.contacts k on k.id = l.contact_id where l.tenant_id = tests.tid('a') and l.is_test and app.phone_norm(k.phone) = app.phone_norm('+00 99999 11111')), 1::bigint, 'B7: it is a lead, marked as a test');
select is((select count(*) from public.lead_arrivals a where a.tenant_id = tests.tid('a') and a.source_tag = 'missed_calls'), 1::bigint, 'B8: with its arrival tagged missed_calls');
select * from finish();
rollback;
