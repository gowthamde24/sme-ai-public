-- Job CK (ADR 0084 part 1, blueprint section 4): packs as data and the MODULE MATRIX with default deny in the database.
--   A structure and grants          B pack rows are immutable           C app.module_enabled: default deny
--   D THE EQUIVALENCE PROOF: the default pack (textiles) keeps every module that exists today on, every guard is a no-op for it, every existing business runs it
--   E the guards refuse an off module (and only on insert), per pack     F every tenant table is guarded or listed as exempt, with a reason (a new table must decide)
--   G the readers                       H units                          I the default-pack trigger
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

-- privileged statement -> its SQLSTATE, or 'ok'
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.set_pack(p_tenant text, p_code text) returns void language plpgsql as $$
begin
  update packs.workspace_pack set pack_code = p_code, pack_version = (select max(version) from packs.pack_versions where code = p_code) where tenant_id = tests.tid(p_tenant);
end $$;

-- ============================================================================ A. structure and grants
select is((select count(*) from pg_namespace where nspname = 'packs'), 1::bigint, 'A1 the packs schema exists');
select is((select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'packs', 'usage')), 0::bigint, 'A2 no client role has usage on the packs schema');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'packs' and grantee in ('anon', 'authenticated', 'service_role', 'public')), 0::bigint, 'A3 no client role holds a privilege on any packs table');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'packs' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity), 8::bigint, 'A4 RLS is enabled and forced on all eight packs tables');
select is((select count(*) from packs.modules), 27::bigint, 'A5 twenty-seven modules (job CN added `materials`, job DS added the core `lead_desk`)');
select is((select count(*) from packs.modules where guard not in ('tables', 'agents', 'flag', 'future')), 0::bigint, 'A6 every module says how the database refuses it');
select is((select string_agg(code, ',' order by position) from packs.units), 'piece,set,sq_ft,sq_m,box,bag,tonne,cft,truckload', 'A7 the closed list of selling units');
select is((select string_agg(enumlabel, ',' order by enumlabel) from pg_enum where enumtypid = 'public.quote_sale_unit'::regtype), (select string_agg(code, ',' order by code) from packs.units), 'A8 the quote sale unit enum carries exactly the same units');
select is((select count(*) from packs.pack_versions), 25::bigint, 'A9 thirteen packs, twenty-five versions (construction_materials has a second version: job CN; nine leads packs: job DR; the generic Lead Desk pack: job DT; a labels-only version 2 of the eleven lead packs: job DW)');
select is((select string_agg(code || ':' || version || ':' || status, ',' order by code, version) from packs.pack_versions), 'auto_dealer:1:preview,auto_dealer:2:preview,clinic:1:preview,clinic:2:preview,coaching:1:preview,coaching:2:preview,construction_materials:1:preview,construction_materials:2:preview,education:1:preview,education:2:preview,general_business:1:preview,general_business:2:preview,gym:1:preview,gym:2:preview,insurance_loans:1:preview,insurance_loans:2:preview,interiors_solar:1:preview,interiors_solar:2:preview,real_estate:1:preview,real_estate:2:preview,textiles:1:published,travel:1:preview,travel:2:preview,wholesale_b2b:1:preview,wholesale_b2b:2:preview', 'A10 textiles is published, the two new business types are previews');
select is((select count(*) from packs.pack_versions where is_default), 1::bigint, 'A11 exactly one default pack');
select is((select code from packs.pack_versions where is_default), 'textiles', 'A12 and it is textiles (today''s behaviour)');
select is((select count(*) from packs.pack_versions where manifest ->> 'id' <> code or (manifest ->> 'version')::integer <> version or manifest ->> 'status' <> status), 0::bigint, 'A13 each manifest agrees with its row');
select is((select count(*) from packs.pack_versions where manifest_sha256 !~ '^[0-9a-f]{64}$'), 0::bigint, 'A14 each manifest has its SHA-256');
select is((select count(*) from packs.pack_versions v where (select count(*) from packs.pack_modules m where m.code = v.code and m.version = v.version) <> jsonb_array_length(v.manifest -> 'modules')), 0::bigint, 'A15 the module rows are the manifest''s modules');
select is((select count(*) from packs.pack_modules m left join packs.modules x on x.code = m.module where x.code is null), 0::bigint, 'A16 every module a pack lists is in the closed list');

-- ============================================================================ B. pack rows never change
select is(pg_temp.sc($$update packs.pack_versions set status = 'preview' where code = 'textiles'$$), '42501', 'B1 a published pack version is never edited');
select is(pg_temp.sc($$update packs.pack_versions set manifest = '{}'::jsonb where code = 'education'$$), '42501', 'B2 nor a manifest');
select is(pg_temp.sc($$delete from packs.pack_versions where code = 'education'$$), '42501', 'B3 nor deleted');
select is(pg_temp.sc($$delete from packs.pack_modules where code = 'education'$$), '42501', 'B4 module rows are never deleted');
select is(pg_temp.sc($$update packs.modules set exists_today = false where code = 'quotes'$$), '42501', 'B5 the closed list of modules is never edited');
select is(pg_temp.sc($$update packs.units set label = 'x' where code = 'piece'$$), '42501', 'B6 nor the units');
select is(pg_temp.sc($$insert into packs.pack_versions (code, version, status, manifest, manifest_sha256) values ('bad', 1, 'published', '{}', repeat('0', 64))$$), '23514', 'B7 a published pack must name who reviewed it');
select is(pg_temp.sc($$insert into packs.pack_versions (code, version, status, is_default, manifest, manifest_sha256) values ('bad', 1, 'preview', true, '{}', repeat('0', 64))$$), '23514', 'B8 a default pack must be published');

-- ============================================================================ C. app.module_enabled: default deny
select is(app.module_enabled(tests.tid('a'), 'quotes'), true, 'C1 a module the pack lists is on');
select is(app.module_enabled(tests.tid('a'), 'deliveries'), false, 'C2 a module the pack does not list is off');
select is(app.module_enabled(tests.tid('a'), 'no_such_module'), false, 'C3 an unknown module is off');
select is(app.module_enabled(gen_random_uuid(), 'quotes'), false, 'C4 an unknown business has nothing on');
select is(app.module_enabled(null, 'quotes'), false, 'C5 null has nothing on');
select is(app.module_enabled(tests.tid('a'), null), false, 'C6 a null module is off');
delete from packs.workspace_pack where tenant_id = tests.tid('b');
select is(app.module_enabled(tests.tid('b'), 'contacts'), false, 'C7 a business with no pack row has NOTHING on (fail closed)');
insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select tests.tid('b'), code, version, 'default' from packs.pack_versions where is_default;

-- ============================================================================ D. THE EQUIVALENCE PROOF: textiles = today's behaviour
-- the modules that existed before this job, pinned here as a literal: if a module that exists today is ever taken off the default pack, this fails
select is((select string_agg(m.module, ',' order by m.module) from packs.pack_modules m where m.code = 'textiles' and m.version = 1),
  'call_list,catalogue,companies,contacts,enquiries,followups,inbox,integrations,lead_finder,office,orders,payment_links,quotes,reports,research,today,visits',
  'D1 the default pack lists exactly the seventeen modules that exist today');
select is((select string_agg(code, ',' order by code) from packs.modules where exists_today), (select string_agg(m.module, ',' order by m.module) from packs.pack_modules m where m.code = 'textiles' and m.version = 1), 'D2 and they are every module marked "exists today"');
select is((select count(*) from packs.pack_modules m join packs.modules x on x.code = m.module where m.code = 'textiles' and not x.exists_today), 0::bigint, 'D3 and no module that does not exist yet');
select is((select jsonb_array_length(manifest -> 'custom_fields') from packs.pack_versions where code = 'textiles' order by version desc limit 1), 0, 'D4 the default pack adds no custom fields');
select is((select count(*) from public.custom_field_defs d where d.tenant_id in (tests.tid('a'), tests.tid('b'))), 0::bigint, 'D5 and a business on it has none');
select is((select count(*) from public.tenants t where not exists (select 1 from packs.workspace_pack w where w.tenant_id = t.id)), 0::bigint, 'D6 every business has a pack row');
select is((select string_agg(distinct source, ',') from packs.workspace_pack where tenant_id in (tests.tid('a'), tests.tid('b'))), 'default', 'D7 a business made without choosing runs the default pack');
-- every guard trigger names a module the default pack has on: so for the default pack the guards change nothing
create temp table guards as
select n.nspname || '.' || c.relname as tbl, (regexp_split_to_array(encode(t.tgargs, 'escape'), '\\000'))[1] as module
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where t.tgfoid = 'app.module_guard()'::regprocedure and not t.tgisinternal
union all
-- the companies guard has its one exemption (the WhatsApp placeholder), so it is its own function
select n.nspname || '.' || c.relname, 'companies'
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where t.tgfoid = 'app.module_guard_companies()'::regprocedure and not t.tgisinternal;
select cmp_ok((select count(*) from guards), '>=', 30::bigint, 'D8 the guard list is not vacuous');
-- (job CN: the modules of sites, dues, materials and deliveries are new, are NOT in the default pack and have guards: so the rule is that every guard of a module that EXISTS TODAY is on for the default pack)
select is((select count(*) from guards g where not app.module_enabled(tests.tid('a'), g.module) and g.module in (select code from packs.modules where exists_today)), 0::bigint, 'D9 every guarded module that exists today is ON for the default pack: those guards are a no-op for it');
select is((select count(*) from guards g where g.module not in (select code from packs.modules where guard = 'tables')), 0::bigint, 'D10 every guard names a module whose guard kind is `tables`');
select is((select count(*) from packs.modules x where x.guard = 'tables' and not exists (select 1 from guards g where g.module = x.code)), 0::bigint, 'D11 and every module of kind `tables` has at least one guarded table');
select is((select count(*) from packs.modules x where x.guard = 'future' and exists (select 1 from guards g where g.module = x.code)), 0::bigint, 'D12 a `future` module has no guard yet (its job registers them)');
select is((select count(*) from packs.agent_modules a where not app.module_enabled(tests.tid('a'), a.module)), 0::bigint, 'D13 every agent module is ON for the default pack');
-- and a real insert into each of a few guarded tables works for the default pack, exactly as before
select is(pg_temp.sc(format($$insert into public.companies (tenant_id, name) values (%L, 'Default pack co')$$, tests.tid('a'))), 'ok', 'D14 a company can be made on the default pack');
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name, unit) values (%L, 'D-1', 'Default pack product', 'piece')$$, tests.tid('a'))), 'ok', 'D15 a product can');
select is(pg_temp.sc(format($$insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values (gen_random_uuid(), %L, 'Saree', 'soft_silk', array['red'], '5k_10k', %L)$$, tests.tid('a'), tests.uid('a_owner'))), 'ok', 'D16 a catalogue item can');

-- the companies guard looks at the created_via the INSERT supplies, so it must fire before the trigger that overwrites it (triggers fire in name order)
select ok((select tgname from pg_trigger where tgrelid = 'public.companies'::regclass and tgfoid = 'app.module_guard_companies()'::regprocedure) < 'companies_set_created_meta' collate "C", 'D17 the companies guard fires before companies_set_created_meta');
select is((select has_column_privilege('authenticated', 'public.companies', 'created_via', 'INSERT')), false, 'D18 and no client can supply created_via on a company (so no client can use the exemption)');

-- ============================================================================ E. the guards refuse an off module, on insert only
-- education: no companies, no catalogue, no products, no quotes, no orders, no research
select pg_temp.set_pack('b', 'education');
select is(app.module_enabled(tests.tid('b'), 'companies'), false, 'E1 education has no companies module');
select is(pg_temp.sc(format($$insert into public.companies (tenant_id, name) values (%L, 'Nope')$$, tests.tid('b'))), 'SM701', 'E2 so a company cannot be made (SM701)');
select is(pg_temp.sc(format($$insert into public.companies (tenant_id, name, created_via) values (%L, 'WhatsApp customer a1b2c3', 'manual')$$, tests.tid('b'))), 'SM701', 'E2a and the look-alike placeholder name is not enough: only trusted server code (created_via agent) is exempt');
select is(pg_temp.sc(format($$insert into public.companies (tenant_id, name, created_via) values (%L, 'Another company', 'agent')$$, tests.tid('b'))), 'SM701', 'E2b nor is an agent''s company with another name');
select is(pg_temp.sc(format($$insert into public.companies (id, tenant_id, name, created_via) values (gen_random_uuid(), %L, 'WhatsApp customer a1b2c3', 'agent')$$, tests.tid('b'))), 'ok', 'E2c BUT the placeholder company that WhatsApp ingestion makes for a new number is allowed: an inbound message is never refused');
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name) values (%L, 'E-1', 'Nope')$$, tests.tid('b'))), 'SM701', 'E3 nor a product');
select is(pg_temp.sc(format($$insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values (gen_random_uuid(), %L, 'Nope', 'soft_silk', array['red'], '5k_10k', %L)$$, tests.tid('b'), tests.uid('b_owner'))), 'SM701', 'E4 nor a catalogue item');
select is(pg_temp.sc(format($$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256)
  values (gen_random_uuid(), %L, %L, 'research', 'v1', %L, now() + interval '15 minutes', repeat('0', 64))$$, tests.tid('b'), tests.uid('b_owner'), tests.rid('b_company'))), 'SM701', 'E5 nor a research agent run');
select is(pg_temp.sc(format($$insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256)
  values (gen_random_uuid(), %L, %L, 'assistant', 'v1', %L, now() + interval '15 minutes', repeat('0', 64))$$, tests.tid('b'), tests.uid('b_owner'), tests.rid('b_company'))), 'ok', 'E6 but the Agent OWL (the `today` module) can run');
select is(pg_temp.sc(format($$insert into public.contacts (tenant_id, full_name) values (%L, 'Example: Guardian')$$, tests.tid('b'))), 'ok', 'E7 contacts are on for education');
select is(pg_temp.sc(format($$insert into public.leads (tenant_id) values (%L)$$, tests.tid('b'))), 'ok', 'E8 and so are enquiries (a lead that names a contact still needs a company: the table''s own rule, which job CR meets for admissions)');
select is(pg_temp.sc(format($$update public.products set name = 'Renamed' where tenant_id = %L$$, tests.tid('b'))), 'ok', 'E9 the guard never blocks an update or a read');
select is((select count(*) from public.companies where tenant_id = tests.tid('b')), 2::bigint, 'E10 the company that existed before the switch (and the placeholder) are still readable');
-- the same refusal through a client role: a tenant-B owner on the education pack
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$insert into public.companies (tenant_id, name) values (%L, 'Nope')$$, tests.tid('b'))), 'SM701', 'E11 a client is refused the same way');
-- construction_materials: companies, catalogue, products, quotes and research are on
select pg_temp.set_pack('b', 'construction_materials');
select is(pg_temp.sc(format($$insert into public.companies (tenant_id, name) values (%L, 'Contractor')$$, tests.tid('b'))), 'ok', 'E12 construction can make a company');
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name, unit) values (%L, 'C-1', 'Paver', 'sq_ft')$$, tests.tid('b'))), 'ok', 'E13 and a product sold per sq ft');
select is(app.module_enabled(tests.tid('b'), 'deliveries'), true, 'E14 construction lists deliveries (its job comes later)');
select is(app.module_enabled(tests.tid('b'), 'fees'), false, 'E15 and not fees');
select pg_temp.set_pack('b', 'textiles');

-- ============================================================================ F. every tenant table is guarded or exempt, with a reason
create temp table exempt (tbl text primary key, why text not null);
insert into exempt (tbl, why) values
  ('integrations.lead_items', 'lead sources: the idempotency ledger, every business type (job DR)'), ('integrations.calendar_tokens', 'the calendar feed: a credential, not a module'), ('integrations.call_bridges', 'telephony account settings'), ('integrations.missed_calls', 'inbound calls are recorded whatever the pack'),
  ('integrations.pull_state', 'connector cursor'), ('integrations.wa_conversation_state', 'inbox: inbound messages are never refused'), ('integrations.wa_events', 'inbox: inbound events are never refused'),
  ('integrations.wa_message_status', 'delivery receipts'), ('integrations.wa_templates', 'WhatsApp templates'), ('integrations.whatsapp_accounts', 'the WhatsApp connection (second factor)'),
  ('notify.member_state', 'notifications'), ('notify.push_prefs', 'notifications'), ('notify.push_sent', 'notifications'),
  ('privacy.data_exports', 'privacy rights apply to every business'), ('privacy.deletion_requests', 'privacy rights'), ('privacy.grievances', 'privacy rights'),
  ('privacy.retention_runs', 'privacy rights'), ('privacy.retention_settings', 'privacy rights'),
  ('privacy.lapse_erasures', 'privacy rights: the lapse erasure follows the workspace, every business (job DQ)'),
  ('public.agent_runs', 'guarded by app.module_guard_agent through packs.agent_modules'), ('public.agent_cost_reservations', 'agent ledger: follows its run'), ('public.agent_run_steps', 'agent ledger: follows its run'), ('public.assistant_conversations', 'Agent OWL chats'),
  ('public.assistant_context_versions', 'the owner''s notes about the business: every business type (job EB)'),
  ('public.lead_inbound_addresses', 'lead sources: every business type (job EB)'),
  ('public.lead_website_forms', 'lead sources: every business type (job EK)'),
  ('public.lead_profiles', 'lead sources: every business type (job EE)'),
  ('public.assistant_messages', 'Agent OWL chats'), ('public.assistant_reply_drafts', 'Agent OWL chats'), ('public.audit_events', 'the audit trail'), ('public.business_profile', 'the business itself'),
  ('public.claim_reviews', 'research evidence follows its (guarded) agent run'), ('public.claims', 'research evidence follows its (guarded) agent run'), ('public.consent_events', 'the consent ledger: every business'),
  ('public.custom_field_defs', 'custom fields: guarded by the entity''s module inside the writer functions'), ('public.custom_field_values', 'custom fields: guarded by the entity''s module inside the writer functions'),
  ('public.data_exports', 'exports'), ('public.erasure_requests', 'erasure applies to every business'), ('public.evidence', 'research evidence'), ('public.evidence_links', 'research evidence'),
  ('public.icp_config_versions', 'lead scoring configuration'), ('public.import_batches', 'lead import batches'), ('public.import_rows', 'lead import rows'), ('public.lead_labels', 'lead review'),
  ('public.memberships', 'the team'), ('public.outbox_events', 'the outbox: policy, not a module'), ('public.outbox_message_media', 'the outbox'), ('public.outbox_messages', 'the outbox'),
  ('public.own_voices', 'the owner''s own voice: every business type may have one (job DP)'),
  ('public.tasks', 'tasks: every business type may give the assistant a task (job DR)'), ('public.task_contacts', 'tasks (job DR)'),
  ('public.outbox_settings', 'the outbox'), ('public.scheduler_runs', 'the scheduler'), ('public.scheduler_settings', 'the scheduler'), ('public.tenant_agent_settings', 'agent switches'),
  ('public.tenant_data_policy', 'the real-data gate'), ('suppression.contact_keys', 'suppression applies to every business'), ('suppression.key_events', 'suppression'),
  ('team.invitations', 'the team'), ('workspace.profiles', 'the workspace profile'),
  ('public.call_settings', 'call settings: every business type has calls (job DP)'),
  ('public.lead_playbooks', 'the lead playbook: every business type (job DR)'), ('public.knowledge_sources', 'the knowledge base: every business type (job DR)'), ('public.knowledge_facts', 'the knowledge base: every business type (job DR)'),
  ('public.lead_sources', 'lead sources: every business type (job DR)'), ('public.lead_consents', 'lead sources: every business type (job DR)'), ('public.lead_intakes', 'lead sources: every business type (job DR)'), ('public.lead_flags', 'lead sources: every business type (job DR)'),
  ('public.lead_arrivals', 'lead sources: every business type (job DR)'), ('public.lead_source_costs', 'lead sources: every business type (job DR)'), ('public.lead_sheet_links', 'lead sources: every business type (job DR)'), ('public.lead_unparsed', 'lead sources: every business type (job DR)'),
  ('public.outreach_policy', 'speed to lead and approve once: every business type (job DR A3)'),
  ('public.outreach_batches', 'speed to lead and approve once: every business type (job DR A3)'),
  ('public.outreach_rules', 'speed to lead and approve once: every business type (job DR A3)'),
  ('public.outreach_items', 'speed to lead and approve once: every business type (job DR A3)'),
  ('public.outreach_attempts', 'speed to lead and approve once: every business type (job DR A3)'),
  ('public.outreach_handoffs', 'speed to lead and approve once: every business type (job DR A3)'),
  ('public.outcome_details', 'speed to lead and approve once: every business type (job DR A3)'),
  ('public.speaking_styles', 'how the assistant talks: every business type (job DS)'), ('public.call_handover_rules', 'call settings: every business type has calls (job DP)'),
  ('public.billing_subscriptions', 'plans and billing: every business has a plan'), ('public.billing_events', 'plans and billing'), ('public.billing_usage_events', 'plans and billing: the meters'),
  ('public.billing_topups', 'plans and billing'), ('public.billing_notices', 'plans and billing'), ('public.billing_invoices', 'plans and billing'), ('public.billing_topup_purchases', 'plans and billing'), ('public.billing_topup_draws', 'plans and billing'), ('public.billing_topup_settings', 'plans and billing'), ('public.billing_alert_sends', 'plans and billing'), ('public.billing_lapse_reminders', 'plans and billing'), ('public.billing_pending_reminders', 'plans and billing'), ('public.outcomes', 'outcomes of calls and follow-ups: the follow-ups module, always on, guards the writers (job DM)'), ('public.assistant_settings', 'the assistant settings of every business type (job DM)'),
  ('public.billing_trial_reminders', 'plans and billing: the trial reminder e-mails (job RESEND)'),
  ('packs.workspace_pack', 'the pack itself'), ('packs.example_batches', 'example data bookkeeping'), ('packs.example_rows', 'example data bookkeeping');
select is((select coalesce(string_agg(c.table_schema || '.' || c.table_name, ', ' order by c.table_schema, c.table_name), '')
             from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
            where c.column_name = 'tenant_id' and c.table_schema not in ('pg_catalog', 'information_schema')
              and not exists (select 1 from guards g where g.tbl = c.table_schema || '.' || c.table_name)
              and not exists (select 1 from exempt e where e.tbl = c.table_schema || '.' || c.table_name)),
  '', 'F1 every tenant-owned table is guarded by a module or listed here as exempt with a reason: a NEW table must decide');
select is((select coalesce(string_agg(e.tbl, ', '), '') from exempt e where not exists (select 1 from information_schema.tables t where t.table_schema || '.' || t.table_name = e.tbl)), '', 'F2 and the exempt list has no stale entry');

-- ============================================================================ G. the readers
select is((tests.scalar_as(tests.uid('a_owner'), format($$select public.workspace_pack_get(%L) ->> 'pack_id'$$, tests.tid('a')))), 'textiles', 'G1 a member reads their business''s pack');
select is((tests.scalar_as(tests.uid('a_viewer'), format($$select public.workspace_pack_get(%L) ->> 'validated'$$, tests.tid('a')))), 'true', 'G2 a Viewer too, and it says the pack was validated by a real owner');
select is((tests.scalar_as(tests.uid('a_owner'), format($$select jsonb_array_length(public.workspace_pack_get(%L) -> 'modules')::text$$, tests.tid('a')))), '18', 'G3 with its seventeen modules and the core lead_desk');
select is((tests.scalar_as(tests.uid('a_owner'), format($$select (public.workspace_pack_get(%L) -> 'manifest') ? 'example_data'$$, tests.tid('a')))), 'false', 'G4 and without the bulky example data');
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$select public.workspace_pack_get(%L)$$, tests.tid('a'))), '42501', 'G5 DENY: another business''s Owner');
select is(tests.sqlstate_as(tests.uid('outsider'), format($$select public.workspace_pack_get(%L)$$, tests.tid('a'))), '42501', 'G6 DENY: an outsider');
select is(tests.sqlstate_as(null, format($$select public.workspace_pack_get(%L)$$, tests.tid('a'))), '42501', 'G7 DENY: no identity');
select is((tests.scalar_as(tests.uid('a_viewer'), format($$select (select count(*) from jsonb_array_elements(public.workspace_modules(%L)) e where (e ->> 'enabled')::boolean)::text$$, tests.tid('a')))), '18', 'G8 the modules list says which are on (seventeen of the pack and the core lead_desk)');
select is((tests.scalar_as(tests.uid('a_viewer'), format($$select jsonb_array_length(public.workspace_modules(%L))::text$$, tests.tid('a')))), '27', 'G9 and lists all twenty-seven');
select is(tests.sqlstate_as(tests.uid('b_viewer'), format($$select public.workspace_modules(%L)$$, tests.tid('a'))), '42501', 'G10 DENY: another business reads no module list');
select is((tests.scalar_as(tests.uid('outsider'), $$select jsonb_array_length(public.pack_catalogue())::text$$)), '13', 'G11 any signed-in person sees the thirteen business types');
select is((tests.scalar_as(tests.uid('outsider'), $$select (select e ->> 'validated' from jsonb_array_elements(public.pack_catalogue()) e where e ->> 'pack_id' = 'education')$$)), 'false', 'G12 and which have been validated by a real owner (education has not)');
select is(tests.sqlstate_as(null, 'select public.pack_catalogue()'), '42501', 'G13 DENY: no identity');
select is(has_function_privilege('anon', 'public.pack_catalogue()', 'execute'), false, 'G14 anon cannot execute the catalogue');

-- ============================================================================ H. units
-- the default pack keeps today's behaviour: any short word (the demo sells fabric by the metre)
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name, unit) values (%L, 'U-M', 'Fabric', 'metre')$$, tests.tid('a'))), 'ok', 'H1 a textile business can still sell by the "metre" (today''s behaviour)');
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name, unit) values (%L, 'U-T', 'Truck', 'truckload')$$, tests.tid('a'))), 'ok', 'H2 and by any listed unit');
-- a construction business may use only the units its pack offers
select pg_temp.set_pack('b', 'construction_materials');
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name, unit) values (%L, 'U-1', 'Unit test', 'truckload')$$, tests.tid('b'))), 'ok', 'H3 a construction product can be sold by the truckload');
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name, unit) values (%L, 'U-2', 'Unit test', 'bunch')$$, tests.tid('b'))), '22023', 'H4 a unit outside the list is refused');
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name, unit) values (%L, 'U-2b', 'Unit test', 'set')$$, tests.tid('b'))), '22023', 'H5 and so is a unit the pack does not offer (`set` is a textile unit)');
select is(pg_temp.sc(format($$insert into public.products (tenant_id, sku, name, unit) values (%L, 'U-3', 'Unit test', null)$$, tests.tid('b'))), 'ok', 'H6 no unit at all is still fine');
select is(pg_temp.sc(format($$update public.products set unit = 'tonne' where tenant_id = %L and sku = 'U-3'$$, tests.tid('b'))), 'ok', 'H7 a unit can be set later');
select is(pg_temp.sc(format($$update public.products set unit = 'bunch' where tenant_id = %L and sku = 'U-3'$$, tests.tid('b'))), '22023', 'H8 but not to a word outside the list');
alter table public.products disable trigger products_unit_check;
insert into public.products (tenant_id, sku, name, unit) values (tests.tid('b'), 'U-OLD', 'Legacy unit', 'metres');
alter table public.products enable trigger products_unit_check;
select is(pg_temp.sc(format($$update public.products set name = 'Legacy renamed' where tenant_id = %L and sku = 'U-OLD'$$, tests.tid('b'))), 'ok', 'H9 a row with an older unit word can still be saved without touching the unit');
select is(pg_temp.sc($$select 'tonne'::public.quote_sale_unit, 'sq_ft'::public.quote_sale_unit, 'truckload'::public.quote_sale_unit$$), 'ok', 'H10 the new sale units are accepted by the quote sale unit enum');
select pg_temp.set_pack('b', 'textiles');

-- ============================================================================ I. the default-pack trigger
select is((select source from packs.workspace_pack where tenant_id = tests.tid('a')), 'default', 'I1 a business gets the default pack the moment it is made');
update packs.pack_versions set is_default = false where is_default;
select is(pg_temp.sc($$insert into public.tenants (name, slug) values ('No default', 'no-default-xx')$$), 'SM702', 'I2 with no default pack installed, a business is REFUSED (fail closed)');
update packs.pack_versions set is_default = true where code = 'textiles';

select * from finish();
rollback;
