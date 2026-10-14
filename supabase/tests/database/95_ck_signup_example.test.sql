-- Job CK (blueprint sections 3 and 4): sign-up with the business type as the ONLY input, Google and Facebook accounts, the second factor NOT asked at sign-up but asked before approvals and a WhatsApp connection,
-- the example-data workspace, and what erasure does to custom values.
--   A the pack is chosen at sign-up       B Google / Facebook accounts           C the second factor     D the example data     E erasure of custom values
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.mk(p_name text, p_confirmed boolean, p_meta jsonb) returns uuid language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (tests.uid(p_name), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_name || '@signup.test', case when p_confirmed then now() end, p_meta, now(), now());
  return tests.uid(p_name);
end $$;
create function pg_temp.ident(p_name text, p_provider text, p_data jsonb) returns void language plpgsql as $$
begin
  insert into auth.identities (provider_id, user_id, identity_data, provider) values (p_name || '-' || p_provider, tests.uid(p_name), p_data, p_provider);
end $$;
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.sqlstate_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  return r;
end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
-- the business of a person who set up, as a text id
create function pg_temp.biz(p_name text) returns uuid language sql as $$ select created_tenant_id from public.account_setups where user_id = tests.uid(p_name) $$;

select pg_temp.mk('con',  true,  '{"business_name": "Sai Constructions", "terms_version": "draft-1"}');
select pg_temp.mk('edu',  true,  '{"terms_version": "draft-1"}');
select pg_temp.mk('tex',  true,  '{"business_name": "Sri Lakshmi Silks", "terms_version": "draft-1"}');
select pg_temp.mk('goog', true,  '{}');
select pg_temp.mk('fb',   true,  '{}');
select pg_temp.mk('bad_goog', true, '{}');
select pg_temp.mk('unconf_goog', false, '{}');
select pg_temp.mk('joined', true, '{}');
select pg_temp.mk('plain', true, '{}');
select pg_temp.mk('draftie', true, '{"terms_version": "draft-1"}');
delete from public.account_setups where user_id in (select tests.uid(n) from unnest(array['con','edu','tex','goog','fb','bad_goog','unconf_goog','joined','plain','draftie']) n);
select pg_temp.ident('goog', 'google', '{"email": "goog@signup.test", "email_verified": true, "sub": "g1"}');
select pg_temp.ident('fb', 'facebook', '{"email": "fb@signup.test", "sub": "f1"}');
select pg_temp.ident('bad_goog', 'google', '{"email": "bad_goog@signup.test", "email_verified": false, "sub": "g2"}');
select pg_temp.ident('unconf_goog', 'google', '{"email": "unconf_goog@signup.test", "email_verified": true, "sub": "g3"}');
select pg_temp.ident('joined', 'google', '{"email": "joined@signup.test", "email_verified": true, "sub": "g4"}');

-- ============================================================================ A. the pack is chosen at sign-up
select is(tests.scalar_as(tests.uid('con'), $$select (public.complete_setup('construction_materials', 'en') ->> 'created')$$), 'true', 'A1 ALLOW: a construction business signs up with its business type');
select is((select pack_code || ':' || pack_version || ':' || source from packs.workspace_pack where tenant_id = pg_temp.biz('con')), 'construction_materials:1:signup', 'A2 and runs that pack (source signup)');
select is((select business_type from public.account_setups where user_id = tests.uid('con')), 'construction_materials', 'A3 the pack code is the recorded business type');
select is((select t.name from public.tenants t where t.id = pg_temp.biz('con')), 'Sai Constructions', 'A4 the name typed at an e-mail sign-up is still used when there is one');
select is((select count(*) from public.custom_field_defs where tenant_id = pg_temp.biz('con') and entity = 'contact' and source = 'pack'), 2::bigint, 'A5 the pack''s two contact fields were made for the business');
select is((select count(*) from public.custom_field_defs where tenant_id = pg_temp.biz('con') and entity = 'catalogue_item' and source = 'pack'), 14::bigint, 'A6 and its fourteen product fields');
select is((select string_agg(code, ',' order by position) from public.custom_field_defs where tenant_id = pg_temp.biz('con') and entity = 'contact'), 'customer_kind,typical_application', 'A7 in the pack''s order');
select is((select count(*) from public.custom_field_defs where tenant_id = pg_temp.biz('con') and (pii_class <> 'none' or not active)), 0::bigint, 'A8 every pack field is class none and active');
select is(app.module_enabled(pg_temp.biz('con'), 'deliveries'), true, 'A9 construction has the deliveries module on');
select is(app.module_enabled(pg_temp.biz('con'), 'fees'), false, 'A10 and not fees');
select is((select count(*) from public.audit_events where tenant_id = pg_temp.biz('con') and action = 'workspace_pack.choose'), 1::bigint, 'A11 the choice is audited');
-- education: nothing typed but the type; named "My business"
select is(tests.scalar_as(tests.uid('edu'), $$select (public.complete_setup('education', 'hi') ->> 'created')$$), 'true', 'A12 ALLOW: an education business signs up with NOTHING typed but its type');
select is((select t.name from public.tenants t where t.id = pg_temp.biz('edu')), 'My business', 'A13 and is called "My business" until the checklist asks');
select is((select string_agg(code, ',' order by position) from public.custom_field_defs where tenant_id = pg_temp.biz('edu')), 'relation,preferred_language,programme_interested', 'A14 its three contact fields, and no catalogue fields');
select is(app.module_enabled(pg_temp.biz('edu'), 'companies'), false, 'A15 no companies module for education');
select is(pg_temp.at('aal2', 'edu', format($$insert into public.companies (tenant_id, name) values (%L, 'Nope')$$, pg_temp.biz('edu'))), 'SM701', 'A16 and the database refuses a company there');
-- textiles: exactly today's behaviour
select is(tests.scalar_as(tests.uid('tex'), $$select (public.complete_setup('textiles', 'te') ->> 'created')$$), 'true', 'A17 ALLOW: a textile business signs up');
select is((select pack_code || ':' || source from packs.workspace_pack where tenant_id = pg_temp.biz('tex')), 'textiles:signup', 'A18 on the textile pack');
select is((select count(*) from public.custom_field_defs where tenant_id = pg_temp.biz('tex')), 0::bigint, 'A19 with no custom fields (today''s behaviour)');
select is((select count(*) from packs.pack_modules m join packs.workspace_pack w on w.pack_code = m.code and w.pack_version = m.version where w.tenant_id = pg_temp.biz('tex')), 17::bigint, 'A20 and the seventeen modules that exist today');
-- not selectable
insert into packs.pack_versions (code, version, status, manifest, manifest_sha256) values ('draftpack', 1, 'draft', '{"id": "draftpack"}', repeat('0', 64));
select is(tests.sqlstate_as(tests.uid('draftie'), $$select public.complete_setup('draftpack', 'en')$$), 'SM702', 'A21 DENY: a draft pack cannot be chosen (SM702)');
select is(tests.sqlstate_as(tests.uid('draftie'), $$select public.complete_setup('nonesuch', 'en')$$), 'SM702', 'A22 DENY: nor one that does not exist');
select is(tests.sqlstate_as(tests.uid('draftie'), $$select public.complete_setup('construction', 'en')$$), 'SM702', 'A23 DENY: the older word `construction` is not a pack');
select is((select count(*) from public.account_setups where user_id = tests.uid('draftie')), 0::bigint, 'A24 and nothing was made');
-- a repeat never changes the pack
select is(tests.scalar_as(tests.uid('con'), $$select (public.complete_setup('education', 'te') ->> 'created')$$), 'false', 'A25 a repeat with another type changes nothing');
select is((select pack_code from packs.workspace_pack where tenant_id = pg_temp.biz('con')), 'construction_materials', 'A26 the first choice stands');
select is((select count(*) from public.custom_field_defs where tenant_id = pg_temp.biz('con')), 16::bigint, 'A27 and no field was added a second time');
select is((select count(*) from public.tenants t where t.name = 'Sai Constructions' and exists (select 1 from public.memberships m where m.tenant_id = t.id and m.user_id = tests.uid('con'))), 1::bigint, 'A28 still one business');

-- ============================================================================ B. Google and Facebook accounts
select is(tests.scalar_as(tests.uid('goog'), 'select public.get_account_setup()::text'), '{"state": "needed", "tenant_id": null, "business_name": null}', 'B1 a Google account with no business yet "needs" the setup');
select is(tests.scalar_as(tests.uid('fb'), $$select (public.get_account_setup() ->> 'state')$$), 'needed', 'B2 so does a Facebook account');
select is(tests.scalar_as(tests.uid('plain'), $$select (public.get_account_setup() ->> 'state')$$), 'none', 'B3 an e-mail account with no sign-up terms and no provider has nothing to set up (an invited person)');
select is(tests.sqlstate_as(tests.uid('goog'), $$select public.complete_setup('education', 'en')$$), 'SM308', 'B4 DENY: no terms were accepted yet');
select is(tests.scalar_as(tests.uid('goog'), $$select jsonb_array_length(public.policy_accept('draft-1', 'draft-1', 'setup'))::text$$), '2', 'B5 the acceptance record is written first (terms and privacy)');
select is(tests.scalar_as(tests.uid('goog'), $$select (public.complete_setup('education', 'en') ->> 'created')$$), 'true', 'B6 ALLOW: the Google account then sets up, with the terms evidenced by the acceptance record');
select is((select t.name from public.tenants t where t.id = pg_temp.biz('goog')), 'My business', 'B7 named "My business"');
select is((select count(*) from integrations.policy_acceptances where user_id = tests.uid('goog') and kind = 'terms' and via = 'setup'), 1::bigint, 'B8 and the terms acceptance is recorded with its time and the way (setup)');
select is(tests.scalar_as(tests.uid('goog'), $$select (public.get_account_setup() ->> 'state')$$), 'done', 'B9 and then the account is done');
select is(tests.scalar_as(tests.uid('fb'), $$select jsonb_array_length(public.policy_accept('draft-1', null, 'setup'))::text$$), '1', 'B10 Facebook: terms only is enough for the setup');
select is(tests.scalar_as(tests.uid('fb'), $$select (public.complete_setup('construction_materials', 'kn') ->> 'created')$$), 'true', 'B11 ALLOW: and the Facebook account sets up');
-- link by verified e-mail only
select is(tests.sqlstate_as(tests.uid('bad_goog'), $$select public.policy_accept('draft-1', null, 'setup')$$), 'ok', 'B12 (the unverified account accepts the terms)');
select is(tests.sqlstate_as(tests.uid('bad_goog'), $$select public.complete_setup('education', 'en')$$), 'SM309', 'B13 DENY: a provider that says the e-mail is NOT verified (SM309)');
select is(tests.sqlstate_as(tests.uid('unconf_goog'), $$select public.policy_accept('draft-1', null, 'setup')$$), 'ok', 'B14 (an account whose e-mail Supabase did not confirm accepts the terms)');
select is(tests.sqlstate_as(tests.uid('unconf_goog'), $$select public.complete_setup('education', 'en')$$), 'SM309', 'B15 DENY: and is refused too, whatever the provider says');
select is((select count(*) from public.account_setups where user_id in (tests.uid('bad_goog'), tests.uid('unconf_goog'))), 0::bigint, 'B16 neither left a business behind');
select is(app.account_email_verified(tests.uid('goog')), true, 'B17 a confirmed and provider-verified e-mail is trusted');
select is(app.account_email_verified(tests.uid('fb')), true, 'B18 a Facebook identity that carries no verified flag is trusted when Supabase confirmed the e-mail');
select is(app.account_email_verified(tests.uid('bad_goog')), false, 'B19 an explicitly unverified one is not');
select is(app.account_email_verified(gen_random_uuid()), false, 'B20 nor an unknown account');
-- a person who already joined a business is not offered a second one by their Google sign-in
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('a'), tests.uid('joined'), 'sales');
select is(tests.scalar_as(tests.uid('joined'), $$select (public.get_account_setup() ->> 'state')$$), 'none', 'B21 a Google account that already joined a business has nothing to set up');
-- the same terms evidence does not let an account skip the setup's other checks
select is(tests.sqlstate_as(tests.uid('goog'), $$select public.complete_setup('textiles', 'fr')$$), '22023', 'B22 a language outside the list is still refused');
select is(has_function_privilege('anon', 'public.complete_setup(text, text)', 'execute'), false, 'B23 anon still cannot set up');
select is(has_function_privilege('authenticated', 'app.account_email_verified(uuid)', 'execute'), false, 'B24 the verification helper is not callable by a client');

-- ============================================================================ C. the second factor is NOT asked at sign-up, and IS asked before approvals and a WhatsApp connection
select pg_temp.mk('fresh', true, '{"terms_version": "draft-1"}');
select pg_temp.ident('fresh', 'google', '{"email": "fresh@signup.test", "email_verified": true, "sub": "g9"}');
select is(pg_temp.at('aal1', 'fresh', $$select public.complete_setup('construction_materials', 'en')$$), 'ok', 'C1 ALLOW: a password-only (aal1) session can sign up and make its business');
select is(pg_temp.at('aal1', 'fresh', format($$select public.example_data_load(%L)$$, pg_temp.biz('fresh'))), 'ok', 'C3 ALLOW: and can load the example data, without a second factor');
select is(pg_temp.at('aal1', 'fresh', format($$select public.custom_values_set(%L, 'contact', %L, '{"customer_kind": "builder"}')$$, pg_temp.biz('fresh'), (select id from public.contacts where tenant_id = pg_temp.biz('fresh') limit 1))), 'ok', 'C4 ALLOW: and fill in a field');
select is(pg_temp.at('aal1', 'fresh', format($$select public.whatsapp_account_save(%L, '200000000000501', '100000000000501', '+91 98765 43210', true, 'shop_fresh')$$, pg_temp.biz('fresh'))), 'SM306', 'C5 DENY: connecting WhatsApp needs the second factor (SM306)');
select is(pg_temp.at('aal2', 'fresh', format($$select public.whatsapp_account_save(%L, '200000000000501', '100000000000501', '+91 98765 43210', true, 'shop_fresh')$$, pg_temp.biz('fresh'))), 'ok', 'C6 ALLOW: with it, the same Owner connects');
select is(pg_temp.at('aal1', 'fresh', format($$select public.outbox_decide(%L, gen_random_uuid(), 'approve')$$, pg_temp.biz('fresh'))), 'SM306', 'C7 DENY: approving a message needs the second factor');
select is(pg_temp.at('aal2', 'fresh', format($$select public.outbox_decide(%L, gen_random_uuid(), 'approve')$$, pg_temp.biz('fresh'))), '23503', 'C8 (with it, the call goes on to look for the message)');
select is(pg_temp.at('aal1', 'fresh', format($$select public.call_request_decide(%L, gen_random_uuid(), 'approve')$$, pg_temp.biz('fresh'))), 'SM306', 'C9 DENY: approving a call needs the second factor');
-- (a quote needs a real quote to approve: its second-factor rule is proved in 47_mfa_aal2 and 58)
select is(pg_temp.at('aal1', 'fresh', format($$select public.custom_field_def_create(%L, 'contact', 'extra', '{"en": "Extra"}', 'text', null, false)$$, pg_temp.biz('fresh'))), 'SM306', 'C10 DENY: changing the fields needs the second factor');

-- ============================================================================ D. the example data
select is(tests.scalar_as(tests.uid('a_viewer'), format($$select (public.example_data_status(%L) ->> 'loaded')$$, tests.tid('a'))), 'false', 'D1 every member sees the status: not loaded');
select is(pg_temp.at('aal2', 'a_sales', format($$select public.example_data_load(%L)$$, tests.tid('a'))), '42501', 'D2 DENY: Sales cannot load it');
select is(pg_temp.at('aal2', 'a_viewer', format($$select public.example_data_load(%L)$$, tests.tid('a'))), '42501', 'D3 DENY: nor a Viewer');
select is(pg_temp.at('aal2', 'b_owner', format($$select public.example_data_load(%L)$$, tests.tid('a'))), '42501', 'D4 DENY: nor another business''s Owner');
select is(pg_temp.at('aal2', 'anon', format($$select public.example_data_load(%L)$$, tests.tid('a'))), '42501', 'D5 DENY: nor anon');
create temp table before_counts as select (select count(*) from public.companies where tenant_id = tests.tid('a')) as co, (select count(*) from public.contacts where tenant_id = tests.tid('a')) as ct,
  (select count(*) from public.leads where tenant_id = tests.tid('a')) as ld, (select count(*) from public.products where tenant_id = tests.tid('a')) as pr;
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.example_data_load(%L) -> 'counts')::text$$, tests.tid('a'))), '{"leads": 2, "contacts": 3, "products": 5, "companies": 3}', 'D6 ALLOW: the Owner loads the textile sample (three shops, three contacts, two leads, five products)');
select is((select count(*) from public.companies where tenant_id = tests.tid('a')) - (select co from before_counts), 3::bigint, 'D7 three companies were added');
select is((select count(*) from public.companies where tenant_id = tests.tid('a') and name like 'Example: %'), 3::bigint, 'D8 every sample company is labelled "Example:"');
select is((select count(*) from public.contacts where tenant_id = tests.tid('a') and full_name like 'Example: %'), 3::bigint, 'D9 and every sample contact');
select is((select count(*) from public.contacts where tenant_id = tests.tid('a') and full_name like 'Example: %' and (email is not null or phone is not null)), 0::bigint, 'D10 a sample contact has NO e-mail and NO phone number: nothing can be sent to it');
select is((select count(*) from public.leads where tenant_id = tests.tid('a') and source = 'Example data'), 2::bigint, 'D11 the sample leads say where they came from');
select is((select count(*) from public.products where tenant_id = tests.tid('a') and name like 'Example: %' and sku like 'EX-%'), 5::bigint, 'D12 the products are labelled and have EX- codes');
select is((select string_agg(distinct unit, ',' order by unit) from public.products where tenant_id = tests.tid('a') and sku like 'EX-%'), 'piece,set', 'D13 in the textile units');
select is(tests.scalar_as(tests.uid('a_viewer'), format($$select (public.example_data_status(%L) ->> 'loaded')$$, tests.tid('a'))), 'true', 'D14 the status now says loaded');
select is(pg_temp.at('aal2', 'a_admin', format($$select public.example_data_load(%L)$$, tests.tid('a'))), 'SM721', 'D15 DENY: a second load while the first is live (SM721)');
select is((select count(*) from public.companies where tenant_id = tests.tid('a') and name like 'Example: %'), 3::bigint, 'D16 and nothing was added twice');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'example_data.load'), 1::bigint, 'D17 the load is audited');
-- real rows are never touched: a row the person changed is KEPT, and so is one that is in use
update public.companies set city = 'Edited by hand' where tenant_id = tests.tid('a') and name like 'Example: Padma%';
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, subject, body)
select tests.rid('a_ex_enq'), tests.tid('a'), l.id, 'email', now(), 'Real enquiry', 'A real enquiry on a sample lead' from public.leads l join public.companies c on c.id = l.company_id where l.tenant_id = tests.tid('a') and l.source = 'Example data' and c.name like 'Example: Vasantha%';
create temp table removed as select tests.scalar_as(tests.uid('a_owner'), format($$select public.example_data_remove(%L)::text$$, tests.tid('a')))::jsonb as r;
select is((select r -> 'kept' ->> 'companies' from removed), '2', 'D18 the company Padma (edited) is kept, and the one a kept contact still points at');
select is((select r -> 'kept' ->> 'leads' from removed), '1', 'D19 the lead that has a real enquiry is kept');
select is((select r -> 'removed' ->> 'products' from removed), '5', 'D20 every untouched, unused product is removed');
select is((select count(*) from public.products where tenant_id = tests.tid('a') and sku like 'EX-%'), 0::bigint, 'D21 and gone');
select is((select count(*) from public.enquiries where id = tests.rid('a_ex_enq')), 1::bigint, 'D22 the real enquiry is untouched');
select is((select count(*) from public.leads where tenant_id = tests.tid('a') and source = 'Example data'), 1::bigint, 'D23 one sample lead remains because it is in use');
select is((select count(*) from public.companies where tenant_id = tests.tid('a') and city = 'Edited by hand'), 1::bigint, 'D24 the edited company keeps its edit');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'example_data.remove'), 1::bigint, 'D25 the removal is audited');
select is(tests.scalar_as(tests.uid('a_viewer'), format($$select (public.example_data_status(%L) ->> 'loaded')$$, tests.tid('a'))), 'false', 'D26 the status says removed');
select is(pg_temp.at('aal2', 'a_sales', format($$select public.example_data_remove(%L)$$, tests.tid('a'))), '42501', 'D27 DENY: Sales cannot remove it');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.example_data_remove(%L) -> 'removed')::text$$, tests.tid('a'))), '{"leads": 0, "contacts": 0, "products": 0, "companies": 0}', 'D28 a second removal removes nothing');
select is(pg_temp.at('aal2', 'a_admin', format($$select public.example_data_load(%L)$$, tests.tid('a'))), 'ok', 'D29 ALLOW: it can be loaded again after a removal (a new batch)');
select is((select count(*) from packs.example_batches where tenant_id = tests.tid('a')), 2::bigint, 'D30 two batches are on record');
-- the other packs have their own sample
select is(tests.scalar_as(tests.uid('edu'), format($$select (public.example_data_load(%L) -> 'counts')::text$$, pg_temp.biz('edu'))), '{"leads": 0, "contacts": 3, "products": 0, "companies": 0}', 'D32 ALLOW: education loads three sample contacts and nothing it has no module for');
select is(tests.scalar_as(tests.uid('con'), format($$select (public.example_data_load(%L) -> 'counts')::text$$, pg_temp.biz('con'))), '{"leads": 2, "contacts": 3, "products": 6, "companies": 3}', 'D33 ALLOW: construction loads its contractors and six products');
select is((select string_agg(distinct unit, ',' order by unit) from public.products where tenant_id = pg_temp.biz('con') and sku like 'EX-%'), 'bag,piece,sq_ft,tonne,truckload', 'D34 in construction units');
select is(tests.scalar_as(tests.uid('con'), format($$select (public.example_data_remove(%L) -> 'removed')::text$$, pg_temp.biz('con'))), '{"leads": 2, "contacts": 3, "products": 6, "companies": 3}', 'D35 and removes all of it again (nothing was changed or used)');
select is((select count(*) from public.companies where tenant_id = pg_temp.biz('con')), 0::bigint, 'D36 leaving the business exactly as it was');
-- an update never trips a module guard, even when the pack has since lost the module
update packs.workspace_pack set pack_code = 'education', pack_version = 1 where tenant_id = tests.tid('b');
select is(pg_temp.sc(format($$update public.companies set name = name where tenant_id = %L$$, tests.tid('b'))), 'ok', 'D37 a company of a business whose pack has no companies module can still be edited');
update packs.workspace_pack set pack_code = 'textiles', pack_version = 1 where tenant_id = tests.tid('b');

-- ============================================================================ E. erasure of custom values
select tests.er_plant('a');
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and contact_id = tests.rid('a_contact')), 5::bigint, 'E1 the planter put five values on the contact');
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and value_text ilike '%qxjv%'), 1::bigint, 'E2 one of them names the person');
select tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, jsonb_build_object('version', 1, 'email', %L, 'phone', %L))$q$, tests.rid('a_contact'), md5('k1') || md5('k2'), md5('k3') || md5('k4')));
select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid('e1'), tests.tid('a'), tests.rid('a_contact')));
select is((tests.scalar_as(tests.uid('a_owner'), format('select public.execute_erasure(%L, false)', tests.rid('e1')))::jsonb ->> 'status'), 'executed', 'E3 the Owner erased the contact');
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and contact_id = tests.rid('a_contact')), 0::bigint, 'E4 every custom value of the contact is gone');
select is(tests.er_hits('a', 'qxjv') = '{}'::text[] or not exists (select 1 from unnest(tests.er_hits('a', 'qxjv')) h where h like 'custom_field_values%'), true, 'E5 and no trace of the person remains in the custom values');

select * from finish();
rollback;
