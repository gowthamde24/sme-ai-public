-- Job DR / A2 (migration 20261205090000): lead sources and imports.
--   A catalog and privileges   B the consent confirmation   C an import (preview, apply, replay)   D what an import does to a person   E live sources through the worker
--   F mail nobody could read   G the history of a lead   H Google Sheets kept in sync   I isolation and roles
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');
-- the clock is fixed for the whole file (the per-minute cap of a live source must not straddle a minute)
create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select timestamptz '2026-10-26 14:00:00+05:30' $b$;

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.w(p_sql text) returns text language sql as $$ select pg_temp.val('outsider', p_sql) $$;
create function pg_temp.tid(p text) returns text language sql as $$ select quote_literal(tests.tid(p)) $$;
create function pg_temp.rid(p text) returns text language sql as $$ select quote_literal(tests.rid(p)) $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- ============================================================================ A. catalog and privileges
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
            and c.relname in ('lead_sources', 'lead_consents', 'lead_intakes', 'lead_flags', 'lead_arrivals', 'lead_source_costs', 'lead_sheet_links', 'lead_unparsed') and c.relrowsecurity and c.relforcerowsecurity), 8, 'A1 row-level security is on and forced for the eight tables');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
            and table_name in ('lead_sources', 'lead_consents', 'lead_intakes', 'lead_flags', 'lead_arrivals', 'lead_source_costs', 'lead_sheet_links', 'lead_unparsed') and privilege_type <> 'SELECT'), 0, 'A2 nobody writes a table directly');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'integrations' and table_name in ('lead_items', 'lead_source_hits') and grantee in ('anon', 'authenticated')), 0, 'A3 the two ledgers in the integrations schema are not readable by clients');
select is((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'lead_source_costs'), 'tenant_id,source,cost_per_lead_paise,updated_by,created_at,updated_at', 'A4 the cost table has the columns agreed with A3 (and created_at)');
select is((select string_agg(a.attname, ',' order by a.attnum) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey) where i.indrelid = 'public.lead_source_costs'::regclass and i.indisprimary), 'tenant_id,source', 'A5 ... with the primary key (tenant_id, source)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname = any (array['lead_consent_confirm', 'lead_intake_apply', 'lead_intakes_list', 'lead_source_create', 'lead_sources_list', 'lead_source_rotate', 'lead_source_set_status', 'scheduler_lead_intake_live',
                                       'scheduler_lead_unparsed_add', 'lead_unparsed_list', 'lead_unparsed_discard', 'lead_arrivals_list', 'lead_sheet_link_create', 'lead_sheet_links_list', 'lead_sheet_link_action',
                                       'scheduler_sheet_links_due', 'scheduler_lead_sheet_apply', 'scheduler_lead_sheet_failed'])
            and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 0, 'A6 anon runs none of the new functions; signed-in accounts run all of them (each checks its own door)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname = any (array['lead_consent_confirm', 'lead_intake_apply', 'lead_intakes_list', 'lead_source_create', 'lead_sources_list', 'lead_source_rotate', 'lead_source_set_status', 'scheduler_lead_intake_live',
                                       'scheduler_lead_unparsed_add', 'lead_unparsed_list', 'lead_unparsed_discard', 'lead_arrivals_list', 'lead_sheet_link_create', 'lead_sheet_links_list', 'lead_sheet_link_action',
                                       'scheduler_sheet_links_due', 'scheduler_lead_sheet_apply', 'scheduler_lead_sheet_failed'])), 18, 'A7 eighteen functions');

-- ============================================================================ B. the consent confirmation
select is(pg_temp.val('a_owner', format($q$select public.lead_consent_confirm(%s, %s, 'Diwali list', 'Offers on our flats', 'explicit_consent', 'Collected on our stall form')::text$q$, pg_temp.tid('a'), pg_temp.rid('c1'))) like '%Diwali list%', true, 'B1 the Owner confirms consent for a list');
select is(pg_temp.val('a_sales', format($q$select (public.lead_consent_confirm(%s, %s, 'Diwali list', 'Offers on our flats', 'explicit_consent', 'Collected on our stall form') ->> 'list_name')$q$, pg_temp.tid('a'), pg_temp.rid('c1'))), 'Diwali list', 'B2 a repeat of the same words is the same record (Sales may import, so Sales may confirm)');
select is(pg_temp.val('a_owner', format($q$select public.lead_consent_confirm(%s, %s, 'Other list', 'Offers on our flats', 'explicit_consent', 'Collected on our stall form')::text$q$, pg_temp.tid('a'), pg_temp.rid('c1'))), 'ERR:23505', 'B3 other words under the same id: conflict');
select is(pg_temp.val('a_viewer', format($q$select public.lead_consent_confirm(%s, %s, 'x', 'y', 'explicit_consent', 'z')::text$q$, pg_temp.tid('a'), pg_temp.rid('c9'))), 'ERR:42501', 'B4 a Viewer cannot');
select is(pg_temp.val('a_owner', format($q$select public.lead_consent_confirm(%s, %s, 'x', 'y', 'other', 'z')::text$q$, pg_temp.tid('a'), pg_temp.rid('c9'))), 'ERR:22023', 'B5 a basis outside the three offered is invalid');
select is((select count(*)::int from public.lead_consents where tenant_id = tests.tid('a')), 1, 'B6 one record was stored');
select is((select confirmed_by from public.lead_consents where id = tests.rid('c1')), tests.uid('a_owner'), 'B7 ... with who confirmed it');
select throws_ok(format($$update public.lead_consents set purpose = 'changed' where id = %L$$, tests.rid('c1')), '42501', null, 'B8 a confirmation is evidence: it cannot be changed');
select throws_ok(format($$delete from public.lead_consents where id = %L$$, tests.rid('c1')), '42501', null, 'B9 ... or deleted');

-- ============================================================================ C. an import
create temp table rows_main as
select jsonb_build_array(
  jsonb_build_object('name', 'Ravi Kumar', 'phone', '+919876543210', 'email', 'ravi@example.test', 'message', 'Interested in a 3BHK, call me on 9876543210 or mail ravi@example.test'),
  jsonb_build_object('name', 'Anita', 'phone', '+919123456789', 'dnd', true),
  jsonb_build_object('name', 'Wrong', 'phone', '12345'),
  jsonb_build_object('name', 'No way to reach'),
  jsonb_build_object('name', 'Ravi again', 'phone', '+919876543210', 'message', 'Please send the brochure'),
  jsonb_build_object('name', 'Email only', 'phone', 'abc', 'email', 'only@example.test')) as r;

select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, %L::jsonb, null, true) #>> '{counts,ready}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i0'), pg_temp.rid('imp0'), (select r from rows_main))), '3', 'C1 the preview counts three new leads (a dry run)');
select is((pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, %L::jsonb, null, true)::text$q$,
  pg_temp.tid('a'), pg_temp.rid('i0'), pg_temp.rid('imp0'), (select r from rows_main))))::jsonb -> 'counts', '{"dnd": 1, "ready": 3, "blocked": 0, "invalid": 2, "no_consent": 4, "already_imported": 0, "duplicates_merged": 1}'::jsonb, 'C2 ... one merged, two invalid, one on the DND register, all four without consent');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and full_name in ('Ravi Kumar', 'Anita', 'Email only')), 0, 'C3 a preview wrote nothing');
select is((select count(*)::int from public.lead_intakes where tenant_id = tests.tid('a')), 0, 'C4 ... not even the ledger');
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', %s, %L::jsonb, 4500, false) #>> '{counts,ready}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i1'), pg_temp.rid('imp1'), pg_temp.rid('c1'), (select r from rows_main))), '3', 'C5 the import creates the three leads');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and full_name in ('Ravi Kumar', 'Anita', 'Email only')), 3, 'C6 ... as contacts');
select is((select count(*)::int from public.leads l join public.contacts c on c.id = l.contact_id and c.tenant_id = l.tenant_id where l.tenant_id = tests.tid('a') and c.full_name in ('Ravi Kumar', 'Anita', 'Email only') and l.source = 'pasted_list'), 3, 'C7 ... each with a lead tagged with the source');
select is((select phone from public.contacts where tenant_id = tests.tid('a') and full_name = 'Ravi Kumar'), '+919876543210', 'C8 the phone is stored as +91 and ten digits');
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', %s, %L::jsonb, 4500, false) ->> 'replayed'$q$,
  pg_temp.tid('a'), pg_temp.rid('i1'), pg_temp.rid('imp1'), pg_temp.rid('c1'), (select r from rows_main))), 'true', 'C9 a retry of the same import changes nothing');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and full_name = 'Ravi Kumar'), 1, 'C10 ... no second person');
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', %s, '[{"phone": "+919000000001"}]'::jsonb, null, false)::text$q$,
  pg_temp.tid('a'), pg_temp.rid('i1'), pg_temp.rid('imp1'), pg_temp.rid('c1'))), 'ERR:23505', 'C11 the same id with other rows: conflict');
select is((select cost_per_lead_paise from public.lead_source_costs where tenant_id = tests.tid('a') and source = 'pasted_list'), 4500::bigint, 'C12 the stated cost per lead is in the cost table');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.lead_intakes_list(%s, 25, null))::text$q$, pg_temp.tid('a'))), '1', 'C13 the history has one import');
select is(pg_temp.val('a_owner', format($q$select (public.lead_intakes_list(%s, 25, null) -> 0 -> 'counts' ->> 'ready')$q$, pg_temp.tid('a'))), '3', 'C14 ... with its counts');
select is(pg_temp.val('a_sales', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, '[{"phone": "+919000000002"}]'::jsonb, null, true) #>> '{counts,ready}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i2'), pg_temp.rid('imp2'))), '1', 'C15 Sales may import');
select is(pg_temp.val('a_viewer', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, '[{"phone": "+919000000002"}]'::jsonb, null, true)::text$q$,
  pg_temp.tid('a'), pg_temp.rid('i2'), pg_temp.rid('imp2'))), 'ERR:42501', 'C16 a Viewer may not');
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'unknown_tag', null, '[{"phone": "+919000000002"}]'::jsonb, null, true)::text$q$,
  pg_temp.tid('a'), pg_temp.rid('i2'), pg_temp.rid('imp2'))), 'ERR:22023', 'C17 a tag outside the closed list is invalid');
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, '[]'::jsonb, null, true)::text$q$,
  pg_temp.tid('a'), pg_temp.rid('i2'), pg_temp.rid('imp2'))), 'ERR:22023', 'C18 no rows is invalid');

-- ============================================================================ D. what an import does to a person
select is((select whatsapp_consent::text from public.contacts where tenant_id = tests.tid('a') and full_name = 'Ravi Kumar'), 'granted', 'D1 with the confirmation the person has WhatsApp consent');
select is((select phone_consent::text from public.contacts where tenant_id = tests.tid('a') and full_name = 'Ravi Kumar'), 'granted', 'D2 ... and phone consent');
select is((select evidence_ref from public.consent_events where tenant_id = tests.tid('a') and contact_id = (select id from public.contacts where tenant_id = tests.tid('a') and full_name = 'Ravi Kumar') and channel = 'whatsapp'), 'lcn:' || tests.rid('c1')::text, 'D3 ... recorded against the confirmation');
select is((select phone_consent::text from public.contacts where tenant_id = tests.tid('a') and full_name = 'Anita'), 'withdrawn', 'D4 a number on the DND register gets no promotional calls');
select is((select whatsapp_consent::text from public.contacts where tenant_id = tests.tid('a') and full_name = 'Anita'), 'granted', 'D5 ... but WhatsApp stays');
select is((select count(*)::int from public.lead_flags where tenant_id = tests.tid('a') and flag = 'dnd'), 1, 'D6 the flag is there for the screen');
select is((select count(*)::int from public.lead_flags where tenant_id = tests.tid('a') and flag = 'invalid_number'), 1, 'D7 a number that cannot be called is flagged on the person who has an e-mail');
select is((select count(*)::int from public.lead_arrivals t join public.contacts c on c.id = t.contact_id and c.tenant_id = t.tenant_id where t.tenant_id = tests.tid('a') and c.full_name = 'Ravi Kumar'), 2, 'D8 the same phone twice is one person with two touches');
select is((select string_agg(t.kind, ',' order by t.kind) from public.lead_arrivals t join public.contacts c on c.id = t.contact_id and c.tenant_id = t.tenant_id where t.tenant_id = tests.tid('a') and c.full_name = 'Ravi Kumar'), 'first,repeat', 'D9 ... the first and a repeat');
select is((select count(*)::int from public.leads l join public.contacts c on c.id = l.contact_id and c.tenant_id = l.tenant_id where l.tenant_id = tests.tid('a') and c.full_name = 'Ravi Kumar'), 1, 'D10 ... and one lead');
select is((select message from public.lead_arrivals where tenant_id = tests.tid('a') and kind = 'first' and message like 'Interested%'), 'Interested in a 3BHK, call me on [removed] or mail [removed]', 'D11 a number or an address inside the words is removed');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and email = 'only@example.test' and phone is null), 1, 'D12 a row with only an e-mail address is a person without a number');
-- a person who withdrew is never made consenting again
select tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%s, %s, 'whatsapp', 'withdrawn')::text$q$, pg_temp.tid('a'), pg_temp.rid('a_contact')));
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'file', 'excel_upload', %s, '[{"name": "Contact a", "phone": "+00 90000 00001"}]'::jsonb, null, false) #>> '{counts,duplicates_merged}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i3'), pg_temp.rid('imp3'), pg_temp.rid('c1'))), '1', 'D13 a number the business already holds is merged');
select is((select whatsapp_consent::text from public.contacts where id = tests.rid('a_contact')), 'withdrawn', 'D14 ... and a withdrawal is never undone by an import');
-- a workspace whose real-data gate is closed
select is(pg_temp.val('b_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, '[{"name": "Real", "phone": "+919811111111"}, {"name": "Synthetic", "phone": "+00 90000 05555"}]'::jsonb, null, false) -> 'counts'$q$,
  pg_temp.tid('b'), pg_temp.rid('i4'), pg_temp.rid('imp4')))::jsonb ->> 'blocked', '1', 'D15 with the gate closed a real number is blocked, row by row');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('b') and full_name = 'Synthetic'), 1, 'D16 ... and the invented one is accepted');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('b') and full_name = 'Real'), 0, 'D17 ... nothing of the blocked row remains');

-- a preview that assumes the consent will be confirmed shows what the confirmation will do, and leaves nothing behind
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, '[{"name": "Pre View", "phone": "+919400000001"}]'::jsonb, null, true, true) #>> '{counts,no_consent}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i5'), pg_temp.rid('imp5'))), '0', 'D18 a preview that assumes the consent counts nobody as without consent');
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, '[{"name": "Pre View", "phone": "+919400000001"}]'::jsonb, null, true, false) #>> '{counts,no_consent}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i5'), pg_temp.rid('imp5'))), '1', 'D19 ... and without the assumption, one');
select is((select count(*)::int from public.lead_consents where tenant_id = tests.tid('a') and list_name = 'preview'), 0, 'D20 the stand-in confirmation is rolled back with the rest');
-- suppression keys: a person who opted out before is not stored again
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, jsonb_build_array(jsonb_build_object('name', 'Keyed', 'phone', '+919400000002', 'keys', jsonb_build_object('version', 1, 'phone', %L))), null, false) #>> '{counts,ready}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i6'), pg_temp.rid('imp6'), pg_temp.h('key-keyed'))), '1', 'D21 a row with its suppression key is stored and keyed');
select is((select count(*)::int from suppression.contact_keys k join public.contacts c on c.id = k.contact_id where c.full_name = 'Keyed' and k.phone_hmac = pg_temp.h('key-keyed')), 1, 'D22 ... the key is on the contact');
select pg_temp.val('a_owner', format($q$select public.suppress_contact(%s, %s, 'opted_out')::text$q$, pg_temp.tid('a'), (select quote_literal(id) from public.contacts where full_name = 'Keyed' and tenant_id = tests.tid('a'))));
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, jsonb_build_array(jsonb_build_object('name', 'Back again', 'phone', '+919400000099', 'keys', jsonb_build_object('version', 1, 'phone', %L))), null, false) #>> '{counts,blocked}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i7'), pg_temp.rid('imp7'), pg_temp.h('key-keyed'))), '1', 'D23 the same identifier arriving again after an opt-out is blocked');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and full_name = 'Back again'), 0, 'D24 ... and nothing of it is stored');

-- ============================================================================ E. live sources through the worker
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%s, %s, 'website_form', 'website_form', 'Website form', %L, 'wxyz', %s, '{"list_name": "Website", "purpose": "Reply to enquiries", "basis": "legitimate_use", "how_collected": "They filled our form"}'::jsonb, 2500) -> 'source' ->> 'id')$q$,
  pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.h('token-one'), pg_temp.rid('c2'))), tests.rid('s1')::text, 'E1 the Owner creates a live source (with its consent confirmation and a cost)');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%s, %s, 'website_form', 'website_form', 'Website form', %L, 'wxyz', null, null, null) ->> 'created')$q$,
  pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.h('token-one'))), 'false', 'E2 a repeat of the same id creates nothing');
select is(pg_temp.val('a_admin', format($q$select (public.lead_sources_list(%s) -> 0 ->> 'consent_confirmed')$q$, pg_temp.tid('a'))), 'true', 'E3 the list says the source has a confirmation');
select is(pg_temp.val('a_sales', format($q$select public.lead_sources_list(%s)::text$q$, pg_temp.tid('a'))), 'ERR:42501', 'E4 Sales does not manage sources');
select is(pg_temp.val('a_owner', format($q$select public.lead_source_create(%s, %s, 'webhook', 'unknown_tag', 'x', %L, 'abcd', null, null, null)::text$q$, pg_temp.tid('a'), pg_temp.rid('s2'), pg_temp.h('t2'))), 'ERR:22023', 'E5 a tag outside the list is invalid');
select is(pg_temp.val('a_owner', format($q$select public.lead_source_create(%s, %s, 'indiamart', 'indiamart', 'IndiaMART', %L, 'abcd', null, null, null)::text$q$, pg_temp.tid('a'), pg_temp.rid('s3'), pg_temp.h('t3'))), 'ERR:22023', 'E6 IndiaMART has no address of its own');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%s, %s, 'indiamart', 'indiamart', 'IndiaMART', null, null, null, null, null) ->> 'created')$q$, pg_temp.tid('a'), pg_temp.rid('s3'))), 'true', 'E7 ... it is registered without one');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"name": "Web Lead", "phone": "+919822222222", "message": "Need a site visit"}]'::jsonb)::text$q$, pg_temp.h('token-one')))::jsonb ->> 'status', 'received', 'E8 the worker passes a live arrival');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and full_name = 'Web Lead' and whatsapp_consent = 'granted'), 1, 'E9 ... a lead with consent from the source''s confirmation');
select is((select l.source from public.leads l join public.contacts c on c.id = l.contact_id and c.tenant_id = l.tenant_id where c.full_name = 'Web Lead'), 'website_form', 'E10 ... tagged with the source');
select is((select received_count from public.lead_sources where id = tests.rid('s1')), 1, 'E11 the source counts what it received');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"name": "Web Lead", "phone": "+919822222222", "message": "Need a site visit"}]'::jsonb) -> 'counts' ->> 'already_imported'$q$, pg_temp.h('token-one'))), '1', 'E12 the same arrival the same day is not made twice');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"name": "Web Lead", "phone": "9822222222", "message": "Different words"}]'::jsonb) -> 'counts' ->> 'duplicates_merged'$q$, pg_temp.h('token-one'))), '1', 'E13 the same person with other words is a repeat touch on the same lead');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"phone": "+919822222233"}]'::jsonb)::text$q$, pg_temp.h('no-such-token')))::jsonb ->> 'status', 'unknown', 'E14 an unknown address learns nothing');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_set_status(%s, %s, 'paused') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('s1'))), 'paused', 'E15 the Owner pauses the source');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"phone": "+919822222244"}]'::jsonb)::text$q$, pg_temp.h('token-one')))::jsonb ->> 'status', 'unknown', 'E16 a paused source receives nothing');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_set_status(%s, %s, 'active') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('s1'))), 'active', 'E17 ... until it is resumed');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_rotate(%s, %s, %L, 'rot2') ->> 'token_hint')$q$, pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.h('token-two'))), 'rot2', 'E18 the Owner rotates the address');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"phone": "+919822222255"}]'::jsonb)::text$q$, pg_temp.h('token-one')))::jsonb ->> 'status', 'unknown', 'E19 the old address stops at once');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"phone": "+919822222255"}]'::jsonb)::text$q$, pg_temp.h('token-two')))::jsonb ->> 'status', 'received', 'E20 the new one works');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_lead_intake_live(%L, '[{"phone": "+919822222266"}]'::jsonb)::text$q$, pg_temp.h('token-two'))), 'ERR:42501', 'E21 a person is not the worker');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, (select jsonb_agg(jsonb_build_object('phone', '+9198222' || lpad(g::text, 5, '0'))) from generate_series(1, 21) g))::text$q$, pg_temp.h('token-two'))), 'ERR:22023', 'E22 more than twenty rows in a call is invalid');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"phone": "+919822233333", "dnd": true}]'::jsonb) -> 'counts' ->> 'dnd'$q$, pg_temp.h('token-two'))), '1', 'E23 a live arrival can carry the DND mark');
-- the cap per minute
do $$
declare i integer;
begin
  for i in 1..70 loop
    perform tests.scalar_as(tests.uid('outsider'), format($q$select public.scheduler_lead_intake_live(%L, '[{"phone": "+91981%s"}]'::jsonb)::text$q$, encode(sha256(convert_to('token-two', 'UTF8')), 'hex'), lpad(i::text, 7, '0')));
  end loop;
end $$;
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"phone": "+919855555555"}]'::jsonb)::text$q$, pg_temp.h('token-two')))::jsonb ->> 'status', 'rate', 'E24 more than sixty calls a minute: refused, nothing written');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and phone = '+919855555555'), 0, 'E25 ... nothing written');

-- ============================================================================ F. mail nobody could read
select is(pg_temp.w(format($q$select public.scheduler_lead_unparsed_add(%L, 'Fwd: enquiry', 'Ravi wrote from 98xxxx: please call')::text$q$, pg_temp.h('token-two')))::jsonb ->> 'status', 'unknown', 'F1 a website source has no mail door');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%s, %s, 'email_forward', 'justdial', 'JustDial mail', %L, 'mail', null, null, null) ->> 'created')$q$, pg_temp.tid('a'), pg_temp.rid('s4'), pg_temp.h('token-mail'))), 'true', 'F2 an e-mail forwarding source is created');
select is(pg_temp.w(format($q$select public.scheduler_lead_unparsed_add(%L, 'Fwd: enquiry', 'Ravi wrote: please call')::text$q$, pg_temp.h('token-mail')))::jsonb ->> 'status', 'kept', 'F3 mail no parser could read is kept');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.lead_unparsed_list(%s))::text$q$, pg_temp.tid('a'))), '1', 'F4 the Owner sees it');
select is(pg_temp.val('a_owner', format($q$select public.lead_unparsed_discard(%s, %s)::text$q$, pg_temp.tid('a'), (select quote_literal(id) from public.lead_unparsed where tenant_id = tests.tid('a') limit 1))), 'true', 'F5 ... and discards it (the text goes)');
select is((select body from public.lead_unparsed where tenant_id = tests.tid('a') limit 1), 'discarded', 'F6 ... the stored words are gone');

-- ============================================================================ G. the history of a lead
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.lead_arrivals_list(%s, (select l.id from public.leads l join public.contacts c on c.id = l.contact_id and c.tenant_id = l.tenant_id where l.tenant_id = %s and c.full_name = 'Ravi Kumar')) -> 'items')::text$q$, pg_temp.tid('a'), pg_temp.tid('a'))), '2', 'G1 Sales reads the touches of a lead');
select is(pg_temp.val('a_sales', format($q$select (public.lead_arrivals_list(%s, (select l.id from public.leads l join public.contacts c on c.id = l.contact_id and c.tenant_id = l.tenant_id where l.tenant_id = %s and c.full_name = 'Anita')) -> 'flags' ->> 0)$q$, pg_temp.tid('a'), pg_temp.tid('a'))), 'dnd', 'G2 ... with the flags of the person');
select is(pg_temp.val('a_viewer', format($q$select public.lead_arrivals_list(%s, %s)::text$q$, pg_temp.tid('a'), pg_temp.rid('a_lead'))), 'ERR:42501', 'G3 a Viewer does not');
select is(pg_temp.val('a_owner', format($q$select public.lead_arrivals_list(%s, %s)::text$q$, pg_temp.tid('a'), pg_temp.rid('b_lead'))), 'ERR:23503', 'G4 a lead of another business is not found');

-- ============================================================================ H. Google Sheets kept in sync
select is(pg_temp.val('a_owner', format($q$select (public.lead_sheet_link_create(%s, %s, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123', '0', '{"name": 0, "phone": 1}'::jsonb, %L, %s, null, null) ->> 'status')$q$,
  pg_temp.tid('a'), pg_temp.rid('sh1'), pg_temp.h('header-1'), pg_temp.rid('c1'))), 'active', 'H1 the Owner links a sheet');
select is(pg_temp.val('a_owner', format($q$select public.lead_sheet_link_create(%s, %s, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123', '0', '{"name": 0, "phone": 1}'::jsonb, %L, %s, null, null)::text$q$,
  pg_temp.tid('a'), pg_temp.rid('sh2'), pg_temp.h('header-1'), pg_temp.rid('c1'))), 'ERR:23505', 'H2 the same sheet and tab twice is a conflict');
select is(pg_temp.w('select jsonb_array_length(public.scheduler_sheet_links_due(10))::text'), '1', 'H3 a link never synced is due');
select is(pg_temp.w(format($q$select public.scheduler_lead_sheet_apply(%s, '[{"name": "Sheet Lead", "phone": "+919833333333", "external_id": "sheet-row-1"}]'::jsonb, %L) -> 'counts' ->> 'ready'$q$, pg_temp.rid('sh1'), pg_temp.h('header-1'))), '1', 'H4 the worker applies the rows of a sheet');
select is((select l.source from public.leads l join public.contacts c on c.id = l.contact_id and c.tenant_id = l.tenant_id where c.full_name = 'Sheet Lead'), 'google_sheet', 'H5 ... tagged google_sheet');
select is(pg_temp.w('select jsonb_array_length(public.scheduler_sheet_links_due(10))::text'), '0', 'H6 a link just synced is not due');
select is(pg_temp.w(format($q$select public.scheduler_lead_sheet_apply(%s, '[{"name": "Sheet Lead", "phone": "+919833333333", "external_id": "sheet-row-1"}]'::jsonb, %L) -> 'counts' ->> 'already_imported'$q$, pg_temp.rid('sh1'), pg_temp.h('header-1'))), '1', 'H7 a row seen before is not made twice');
select is(pg_temp.w(format($q$select public.scheduler_lead_sheet_apply(%s, '[{"phone": "+919833333344"}]'::jsonb, %L)->> 'status'$q$, pg_temp.rid('sh1'), pg_temp.h('header-2'))), 'columns_changed', 'H8 a changed header row stops the link instead of guessing');
select is((select status from public.lead_sheet_links where id = tests.rid('sh1')), 'needs_attention', 'H9 ... and the owner is told');
select is(pg_temp.val('a_owner', format($q$select (public.lead_sheet_link_action(%s, %s, 'resume') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('sh1'))), 'active', 'H10 the Owner resumes it');
select is(pg_temp.val('a_owner', format($q$select (public.lead_sheet_link_action(%s, %s, 'pause') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('sh1'))), 'paused', 'H11 ... or pauses it');
select is(pg_temp.val('a_owner', format($q$select public.lead_sheet_link_action(%s, %s, 'sync_now')::text$q$, pg_temp.tid('a'), pg_temp.rid('sh1'))), 'ERR:22023', 'H12 a paused link cannot be asked to sync');
select is(pg_temp.w(format($q$select public.scheduler_lead_sheet_failed(%s, 'sheet_not_public')::text$q$, pg_temp.rid('sh1'))), 'false', 'H13 a failure of a paused link changes nothing');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.lead_sheet_links_list(%s))::text$q$, pg_temp.tid('a'))), '1', 'H14 the list has the link');
select is(pg_temp.val('a_sales', format($q$select public.lead_sheet_links_list(%s)::text$q$, pg_temp.tid('a'))), 'ERR:42501', 'H15 Sales does not manage links');

-- ============================================================================ I. isolation and roles
select is(pg_temp.val('b_owner', format($q$select count(*)::text from public.lead_sources where tenant_id = %s$q$, pg_temp.tid('a'))), '0', 'I1 another business sees none of the sources');
select is(pg_temp.val('b_owner', format($q$select count(*)::text from public.lead_arrivals where tenant_id = %s$q$, pg_temp.tid('a'))), '0', 'I2 ... or touches');
select is(pg_temp.val('b_owner', format($q$select public.lead_sources_list(%s)::text$q$, pg_temp.tid('a'))), 'ERR:42501', 'I3 ... and cannot list them');
select is(pg_temp.val('a_viewer', 'select count(*)::text from public.lead_arrivals'), '0', 'I4 a Viewer reads no touches');
select is(pg_temp.val('a_sales', 'select (count(*) > 0)::text from public.lead_arrivals'), 'true', 'I5 Sales reads touches');
select is(pg_temp.val('a_sales', 'select count(*)::text from public.lead_sources'), '0', 'I6 Sales reads no sources');
select is(pg_temp.val('anon', format($q$select public.lead_sources_list(%s)::text$q$, pg_temp.tid('a'))), 'ERR:42501', 'I7 no sign-in: refused');
select is(pg_temp.val('a_owner', format($q$select count(*)::text from integrations.lead_items$q$)), 'ERR:42501', 'I8 the ledger is not readable by a person');

select * from finish();
rollback;
