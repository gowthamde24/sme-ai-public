-- Catalog guards. These inspect the schema itself, so any table, view or function added by a later
-- ticket (T003+) is policed automatically: forget RLS on a new tenant-owned table and this fails.
begin;
select no_plan();

-- ---- every tenant-owned table (any public table with a tenant_id column)
create temp table tenant_tables as
select c.oid as relid, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
where n.nspname = 'public' and c.relkind = 'r';

select cmp_ok((select count(*) from tenant_tables), '>=', 2::bigint,
  'guard is not vacuous: tenant-owned tables were found');

select is(
  (select coalesce(string_agg(c.relname, ', '), '') from tenant_tables t
    join pg_class c on c.oid = t.relid where not c.relrowsecurity),
  '', 'every tenant-owned table has RLS enabled');
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from tenant_tables t
    join pg_class c on c.oid = t.relid where not c.relforcerowsecurity),
  '', 'every tenant-owned table has RLS FORCED');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = t.relid)),
  '', 'every tenant-owned table has at least one policy');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    join pg_attribute a on a.attrelid = t.relid and a.attname = 'tenant_id' where not a.attnotnull),
  '', 'tenant_id is NOT NULL on every tenant-owned table');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (
      select 1 from pg_constraint k
      where k.conrelid = t.relid and k.contype = 'f' and k.confrelid = 'public.tenants'::regclass
        and k.conkey = array[(select attnum from pg_attribute where attrelid = t.relid and attname = 'tenant_id')])),
  '', 'tenant_id is a foreign key to tenants on every tenant-owned table');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (
      select 1 from pg_index i
      where i.indrelid = t.relid
        and i.indkey[0] = (select attnum from pg_attribute where attrelid = t.relid and attname = 'tenant_id'))),
  '', 'tenant_id is the leading column of an index on every tenant-owned table');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (
      select 1 from pg_trigger g
      where g.tgrelid = t.relid and not g.tgisinternal
        and g.tgfoid = 'app.forbid_tenant_id_change()'::regprocedure)),
  '', 'tenant_id is immutable (trigger) on every tenant-owned table');

-- ---- RLS everywhere in public (a table without tenant_id still must not be open)
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)),
  '', 'every public table has RLS enabled and forced');

-- ---- policies: never granted to PUBLIC or anon
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and (roles = '{public}' or 'anon' = any (roles))),
  0::bigint, 'no policy applies to PUBLIC or anon');

-- ---- grants
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0::bigint, 'anon holds no table privileges in public');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0::bigint, 'authenticated holds no TRUNCATE/REFERENCES/TRIGGER in public');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name = 'audit_events'
      and privilege_type <> 'SELECT'),
  0::bigint, 'authenticated can only SELECT audit_events');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name = 'tenants'
      and privilege_type in ('INSERT', 'DELETE')),
  0::bigint, 'authenticated cannot INSERT/DELETE tenants directly');

-- future tables must not be auto-exposed: default privileges for the migration owner in public
select is(
  (select count(*) from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public' and d.defaclobjtype in ('r', 'S', 'f') and d.defaclrole = 'postgres'::regrole
      and exists (select 1 from aclexplode(d.defaclacl) x
                   where x.grantee = 0
                      or x.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid))),
  0::bigint, 'default privileges of the migration role do not auto-grant new tables/sequences/functions in public to anon, authenticated or PUBLIC');

-- ---- functions in public/app (excluding extension-owned)
create temp table our_functions as
select p.oid, p.oid::regprocedure::text as sig, n.nspname || '.' || p.proname as fq,
       p.prosecdef, p.proconfig, n.nspname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

select cmp_ok((select count(*) from our_functions), '>=', 5::bigint, 'guard is not vacuous: functions were found');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where prosecdef and not coalesce('search_path=""' = any (proconfig), false)),
  '', 'every SECURITY DEFINER function pins search_path to empty');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where has_function_privilege('anon', oid, 'execute')
      -- job BI (ADR 0073): a calendar app has no sign-in; the hash of a private token is its credential. This is the ONE exception.
      and fq not in ('public.calendar_feed_read', 'public.public_grievance_submit', 'public.waitlist_join')),
  '', 'anon can execute none of our functions except the calendar feed read');
select is(
  (select coalesce(string_agg(sig, ', ' order by sig), '') from our_functions where has_function_privilege('anon', oid, 'execute')),
  'calendar_feed_read(text), public_grievance_submit(uuid,text,text,text,text,text), waitlist_join(text,text,text,text,text,text,boolean,text)', 'anon can execute the calendar feed read (job BI, ADR 0073) and the two public doors of job DQ (a grievance, the waitlist; they hold their own caps)');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where has_function_privilege('authenticated', oid, 'execute')
      and fq not in (
        'public.create_tenant',
        -- job AD / D1: the workspace limit's counting helper (called by the invoker trigger on memberships; reads two numbers about one person)
        'app.owner_allowance',
        -- job AD / D2: open sign-up. Both derive the person from auth.uid(); there is no user parameter
        'public.get_account_setup',
        'public.complete_setup',
        -- job AD / D3: two read-only SECURITY INVOKER reads for the Today screen and the office (the caller's own row-level security decides every row)
        'public.today_summary',
        'public.agents_status',
        -- job AD / review fix 2: today's AI spend for the Indian day (Owner or Admin proven first)
        'public.ai_usage_today',
        'public.ai_usage',
        'public.ai_paused_until',
        -- job AG: the Main agent. Each derives the person from auth.uid() (or the run's starter) and proves the role / the run first; app.agent_switch_on is a boolean read for a member
        'public.assistant_begin_message',
        'public.assistant_save_reply',
        'public.assistant_save_reply_draft',
        -- job EA: the conversational assistant: the type of a stored reply, the caller's own conversation list, and archive. Each proves the role (or the run) first
        'public.assistant_mark_reply',
        'public.assistant_conversations_list',
        'public.assistant_conversation_archive',
        -- job AT: the outbox and call requests. Each proves the role first (Owner / Admin / Sales as stated in migration 20261106090000) and derives the person from auth.uid()
        'public.outbox_submit',
        'public.outbox_edit',
        'public.outbox_decide',
        'public.outbox_claim_due',
        'public.outbox_mark',
        'public.outbox_set_settings',
        'public.outbox_settings_get',
        'public.call_request_create',
        'public.call_request_decide',
        -- job AS: store visits. Each proves the role (every member reads; Owner / Admin edit the hours; Owner / Admin / Sales book and step; the Owner offers a visit) and derives the person from auth.uid()
        'public.visit_settings_get',
        'public.visit_settings_set',
        'public.visit_slots',
        'public.visit_book',
        'public.visit_change',
        'public.visit_step',
        'public.visit_complete',
        'public.visit_send_message',
        'public.call_request_offer_visit',
        'public.visit_list',
        'public.ai_usage_week',
        -- job AW: the scheduler. Six are the worker's (each starts with the principal check), two are the Owner's settings, one is the Owner's read.
        'public.scheduler_settings_get',
        'public.scheduler_settings_set',
        'public.scheduler_tenants',
        'public.scheduler_heartbeat',
        'public.scheduler_claim_due',
        'public.scheduler_mark',
        'public.scheduler_due_reminders',
        'public.scheduler_queue_reminder',
        'public.scheduler_mark_no_shows',
        'public.scheduler_record',
        'public.scheduler_status',
        -- job AY: the catalogue (the first five are SECURITY DEFINER writes, the Owner's or Admin's; the last three are SECURITY INVOKER reads of what the caller may already see)
        'app.catalogue_item_json',  -- the two helpers the SECURITY INVOKER reads below call: one formats a row the caller may already read, the other only raises
        'app.catalogue_error',
        'app.catalogue_bucket_tenant',  -- evaluated by the storage rules as the signed-in caller
        'app.images_bucket_tenant',  -- job DT: the same for the business's images bucket (logo, members' pictures)
        'app.my_second_factor_on',  -- job DT: the client-write trigger (security invoker) asks it; it answers for the caller only
        'public.catalogue_ensure_bucket',
        'public.catalogue_item_save',
        'public.catalogue_photo_add',
        'public.catalogue_photo_remove',
        'public.catalogue_photos_reorder',
        'public.catalogue_get',
        'public.catalogue_search',
        'public.lead_search',
        -- job BB: the outbox log (a page of ids, the counts) proves Owner / Admin / Sales first; the worker's read rule for the files of a message it has claimed, evaluated by storage as the signed-in caller
        'public.outbox_list',
        'public.outbox_summary',
        'app.worker_may_read_object',
        'app.export_bucket_owner',  -- job BN: evaluated by the storage rules as the signed-in caller (the person's own export bucket) and the worker's rule for an EXPIRED export file
        'app.worker_may_delete_export',
        'app.agent_switch_on',
        'app.is_tenant_member',
        'app.has_tenant_role',
        'app.my_tenant_ids',
        'app.my_tenant_ids_with_role',
        'app.my_co_member_ids',
        'public.record_consent',
        'public.suppress_contact',
        'public.lift_suppression',
        'app.can_contact',
        'app.text_is_clean',
        'app.gstin_is_valid',  -- job CA: a CHECK on companies.gstin and business_profile.gstin runs with the writer's rights
        'public.create_evidence_with_link',
        'public.import_lead_rows',
        -- T006 (ADR 0013): the agent write path. Every one derives the tenant from the run (or the claim) it is given.
        'public.start_agent_run',
        'public.agent_write_evidence',
        'public.agent_write_claim',
        'public.agent_record_step',
        'public.agent_record_usage',
        'public.finish_agent_run',
        'public.cancel_agent_run',
        'public.set_tenant_agents_enabled',
        'public.review_claim',
        -- T007 M2 / 3: the daily cost cap. Both take a run (or prove the Owner role in the tenant they are given).
        'public.agent_reserve_cost',
        'public.set_tenant_daily_cost_cap',
        'public.agent_release_cost',
        'public.agent_ai_mode',
        'public.agent_cost_summary',
        -- T006b (ADR 0014): erasure. Each derives the tenant from the request (or proves the role in the tenant it is given).
        'public.request_erasure',
        'public.execute_erasure',
        'public.cancel_erasure',
        'app.match_key',
        'app.website_host',
        -- T008: pure, immutable CHECK helpers of enquiries / requirement_fields (they read nothing)
        'app.text_has_contact',
        'app.requirement_vocab',
        'app.requirement_value_ok',
        -- T008 commit 3: the requirement agent's write and the human decisions. Each derives the tenant from the run (or the row) it is given.
        'public.agent_write_requirement_field',
        'public.decide_requirement_field',
        'public.confirm_requirement',
        'public.discard_requirement',
        -- T008 commit 3b: a human adds a field the extraction missed
        'public.add_requirement_field',
        -- T009 part 1: Owner / Admin publish a price list, a quote policy or a mapper config version (role proven first, then aal2)
        'public.create_price_list_version',
        'public.create_quote_policy_version',
        'public.create_mapper_config_version',
        -- manual-price slice 1: Owner / Admin save an item type and its optional price range (role first, then aal2)
        'public.save_item_type',
        -- manual-price slice 2: Owner / Admin type the prices of a manual quote (role first; never inside an agent context)
        'public.create_manual_quote_draft',
        -- T009 part 2: a person picks a product, Sales+ create a draft quote, Owner / Admin approve or reject it (role, and aal2 for approval, proven inside)
        'public.pick_requirement_line_product',
        'public.create_quote_draft',
        'public.approve_quote',
        'public.reject_quote',
        -- T009 part 3: Owner / Admin withdraw an APPROVED quote (role first, then aal2)
        'public.withdraw_approved_quote',
        -- T010 part 1 (ADR 0020): the suppression keys. The role is proven first in every one; aal2 (Owner) for the backfill, the unkeyed list and allowing an erasure without a key.
        'public.record_contact_keys',
        'public.check_suppression',
        'public.unkeyed_contact_count',
        'public.unkeyed_contacts',
        'public.backfill_contact_keys',
        'public.allow_erasure_without_key',
        -- order conversion (ADR 0021): the role is proven first in every one; aal2 for creating a policy or an order, and for a payment, a cancellation, a refund or an override
        'public.create_order_policy_version',
        'public.create_order_from_quote',
        'public.record_order_event',
        -- T010 part 2: touches, the cadence policy, follow-up drafts and question drafts. The role is proven first in every one; aal2 for a policy and for approving a draft
        'public.create_followup_policy_version',
        'public.followup_gate',
        'public.followup_due_candidates',  -- the due list's candidates (a read; role proven first; docs/plans/followups-due-candidates-plan.md)
        'public.record_touch',
        'public.create_followup_draft',
        'public.approve_followup_draft',
        'public.discard_followup_draft',
        'public.record_draft_sent',
        'public.persist_question_drafts',
        'public.decide_question_draft',
        -- job BO (ADR 0074): the phone comparison form (the unique index on contacts is evaluated as the writer) and the duplicate lookup
        'app.phone_norm', 'public.find_contact_by_phone',
        -- job BI (ADR 0073): the accounting export, the spreadsheet import jobs, the stock import, the calendar feed and the policy acceptance. Role first in every one; aal2 for the export and for running an import
        'public.export_accounting_data', 'public.import_job_preview_save', 'public.import_job_get', 'public.import_job_list', 'public.import_job_begin', 'public.import_job_finish',
        'public.catalogue_stock_list', 'public.catalogue_stock_apply', 'public.calendar_feed_create', 'public.calendar_feed_status', 'public.calendar_feed_revoke', 'public.calendar_feed_read',
        'public.policy_accept', 'public.policy_acceptances_mine',
        -- job BN (ADR 0075): download my data, deletion with a cooling-off, retention, grievances, and the worker's three steps
        'public.data_export_ensure_bucket', 'public.data_export_request', 'public.data_export_get', 'public.data_export_list', 'public.data_export_begin', 'public.data_export_finish', 'public.data_export_link', 'public.data_export_person_data',
        'public.deletion_request', 'public.deletion_cancel', 'public.deletion_list', 'public.deletion_execute_workspace',
        'public.retention_get', 'public.retention_set', 'public.retention_preview', 'public.grievance_submit', 'public.grievance_list', 'public.grievance_get', 'public.grievance_update',
        'public.privacy_worker_execute_account_deletions', 'public.privacy_worker_expired_exports', 'public.privacy_worker_export_cleaned', 'public.privacy_worker_run_retention',
        -- job BR (ADR 0076): WhatsApp. The business's own calls (role first), the inbox, and the three calls that only the registered channel account may make
        'public.whatsapp_account_get', 'public.whatsapp_account_save', 'public.whatsapp_account_set_status', 'public.wa_template_save', 'public.wa_template_list', 'public.wa_template_set_status',
        'public.conversation_list', 'public.conversation_thread', 'public.conversation_mark_read', 'public.wa_account_for', 'public.wa_ingest_inbound', 'public.wa_ingest_status',
        -- job BY (ADR 0077): the team, the shop's basics, the weekly report, the feed and web-push. Role first in every one; the worker's three (push_worker_*) accept only the registered scheduler account
        'public.create_invitation', 'public.accept_invitation', 'public.revoke_invitation', 'public.list_invitations', 'public.change_member_role', 'public.remove_member', 'public.team_members',
        'public.workspace_profile_get', 'public.workspace_profile_save', 'public.weekly_report',
        -- job DT (ADR 0115): the business profile, the members' own profiles and the sign-in status
        'public.workspace_business_get', 'public.workspace_business_set', 'public.workspace_images_ensure_bucket', 'public.workspace_logo_set', 'public.my_profile_get', 'public.my_profile_set', 'public.people_profiles', 'public.account_security_get',
        -- job DT (ADR 0116): the opening line and the AI-mention switch
        'public.opening_get', 'public.opening_set_line', 'public.opening_set_mention',
        -- job voice-picker: the workspace's chosen voice per language
        'public.call_voice_get', 'public.call_voice_set',
        -- job DV follow-up: the browser voice's daily caps
        'public.browser_voice_usage_get', 'public.browser_voice_usage_add',
        -- job DY: the automatic WhatsApp reply: the Owner's switch and the worker's three calls
        'public.auto_reply_get', 'public.auto_reply_set', 'public.scheduler_auto_reply_pending', 'public.scheduler_auto_reply_submit', 'public.scheduler_auto_reply_skip', 'public.assistant_context_get', 'public.assistant_context_versions_list', 'public.assistant_context_version_get', 'public.assistant_context_save', 'public.scheduler_assistant_context', 'public.lead_inbound_address_get', 'public.lead_inbound_address_set', 'public.lead_source_cards_stats',
        'public.notifications_list', 'public.notifications_mark_seen', 'public.push_subscribe', 'public.push_unsubscribe', 'public.push_prefs_get', 'public.push_prefs_set',
        'public.push_worker_pending', 'public.push_worker_mark', 'public.push_worker_report',
        -- job BP (ADR 0078): the web research tools' daily limit, usage read and query check. Each proves the run (or the role) first
        'public.web_quota_take', 'public.web_usage_today', 'public.web_query_check',
        -- job BZ (ADR 0080): the connectors. A person's functions check a workspace role first; the scheduler_* ones check the worker account
        'public.indiamart_pull_begin', 'public.indiamart_pull_finish', 'public.payment_link_begin', 'public.payment_link_attach', 'public.payment_link_fail', 'public.payment_link_list', 'public.payment_link_get', 'public.payment_link_mark_recorded', 'public.scheduler_payment_event', 'public.scheduler_missed_call', 'public.missed_call_list', 'public.missed_call_handle', 'public.call_bridge_prepare', 'public.call_bridge_finish', 'public.scheduler_call_status', 'public.connectors_status',
        -- job CA (ADR 0081): the shop's own GSTIN (Owner or Admin, second factor)
        'public.business_profile_set',
        -- job CK (ADR 0084 parts 1 and 2): the pack a business runs and its modules (every member reads), the packs a person may choose, custom fields (Owner / Admin with a second factor to define; the roles that may edit the
        -- entity to fill in), and the example data (Owner / Admin). Each proves the role first; the pack tables themselves have no client grant.
        'public.workspace_pack_get', 'public.workspace_modules', 'public.pack_catalogue',
        'public.custom_field_defs_list', 'public.custom_field_def_create', 'public.custom_field_def_update', 'public.custom_values_get', 'public.custom_values_set', 'public.custom_values_set_many',
        'public.example_data_status', 'public.example_data_load', 'public.example_data_remove',
        -- job DR B1: "Ask Vijaya to do it" (Owner/Admin/Sales plan, the Owner approves with a second factor, Owner/Admin run)
        'public.task_context', 'public.task_save', 'public.task_get', 'public.tasks_list', 'public.task_contacts_list', 'public.task_report', 'public.task_exclude', 'public.task_approve', 'public.task_set_cap', 'public.task_set_state', 'public.task_claim', 'public.task_contact_result',
        -- job CN (ADR 0085): sites, the building-materials catalogue item, dues, material quotes and their order, deliveries. Each proves the role first; money moves need aal2 where the file says so
        'public.catalogue_material_save', 'public.site_save', 'public.site_get', 'public.sites_list', 'public.invoice_record', 'public.invoices_import', 'public.invoice_void', 'public.payment_record', 'public.payment_void', 'public.credit_limit_set', 'public.dues_statement', 'public.dues_summary', 'public.credit_check', 'public.dues_ledger', 'public.material_item_inputs', 'public.material_policy_create', 'public.material_policy_get', 'public.material_quote_build', 'public.material_quote_draft', 'public.material_quote_approve', 'public.material_quote_reject', 'public.material_quote_get', 'public.material_quotes_list', 'public.create_order_from_material_quote', 'public.trip_plan', 'public.trip_update', 'public.trip_set_status', 'public.trip_deliver', 'public.pod_ensure_bucket', 'public.trip_get', 'public.trips_list', 'public.delivery_challan_get', 'public.trip_update_submit',
        -- job CP (ADR 0086): the shared ledger (entries, imports, statements, receipts)
        'public.ledger_entry_record', 'public.ledger_entry_void', 'public.ledger_charges_import', 'public.ledger_statement', 'public.ledger_summary', 'public.ledger_entries_list', 'public.ledger_receipt_get',
        -- job RESEND: the trial reminder e-mails (the scheduler's two calls)
        'public.scheduler_billing_trial_due', 'public.scheduler_billing_trial_mark',
        -- job DR A3: speed to lead and approve once (the Owner approves a plan once; staff report results; the worker scans, takes due calls and reminds)
        'public.outreach_batch_approve', 'public.outreach_batch_exclude', 'public.outreach_batch_get', 'public.outreach_batch_plan', 'public.outreach_batch_state', 'public.outreach_batches_list', 'public.outreach_caps_set', 'public.outreach_handoff_acted', 'public.outreach_handoffs_list', 'public.outreach_item_result', 'public.outreach_items_list',
        'public.outreach_policy_get', 'public.outreach_policy_set', 'public.outreach_report', 'public.outreach_rule_save', 'public.outreach_rule_state', 'public.outreach_rules_list', 'public.outreach_source_costs_get', 'public.outreach_source_costs_set', 'public.scheduler_outreach_reminders', 'public.scheduler_outreach_run', 'public.scheduler_outreach_scan',
        -- job DS part E2: running out before the month ends (the Owner reads and buys; the worker closes periods and sends alerts)
        'public.billing_topups_get', 'public.billing_topup_buy', 'public.billing_topup_settings_set', 'public.billing_invoices_list', 'public.billing_invoice_get', 'public.billing_upgrade_preview', 'public.billing_upgrade', 'public.scheduler_billing_topup_tick', 'public.scheduler_usage_alerts_due', 'public.scheduler_usage_alert_mark',
        -- job DQ part 4 (DPDP): consent, profile, the public grievance and waitlist doors (open to the public key, with their own caps), the worker's intake, lapse and purge calls
        'public.consents_mine', 'public.consent_set_marketing', 'public.profile_get', 'public.profile_set', 'public.public_grievance_submit', 'public.waitlist_join',
        'public.scheduler_public_intake_due', 'public.scheduler_public_intake_mark', 'public.scheduler_lapse_due', 'public.scheduler_lapse_warned', 'public.scheduler_lapse_erase', 'public.lapse_erasure_status', 'public.privacy_worker_purge_logs',
        -- job DS: how the assistant talks (every member reads, the Owner with a second factor sets)
        'public.speaking_style_get', 'public.speaking_style_set',
        -- job DR / A1: the lead playbook (any member reads, the Owner with a second factor saves) and the knowledge base (Owner/Admin manage, every member reads the approved facts)
        'public.lead_playbook_get', 'public.lead_playbook_save', 'public.lead_playbook_reset', 'public.knowledge_source_add', 'public.knowledge_sources_list', 'public.knowledge_source_text', 'public.knowledge_source_discard',
        'public.knowledge_facts_draft_replace', 'public.knowledge_fact_add', 'public.knowledge_fact_edit', 'public.knowledge_fact_decide', 'public.knowledge_facts_list', 'public.knowledge_facts_approved',
        -- job DR / A2: lead sources and imports (a person imports; Owner/Admin manage sources; the worker account is the door for the public arrivals and the sheets)
        'public.lead_consent_confirm', 'public.lead_intake_apply', 'public.lead_intakes_list', 'public.lead_source_create', 'public.lead_sources_list', 'public.lead_source_rotate', 'public.lead_source_set_status',
        'public.scheduler_lead_intake_live', 'public.scheduler_lead_unparsed_add', 'public.lead_unparsed_list', 'public.lead_unparsed_discard', 'public.lead_arrivals_list', 'public.lead_desk_page', 'public.lead_desk_get', 'public.lead_profile_unseeded', 'public.lead_profile_seed', 'public.lead_profile_apply_ai', 'public.lead_profile_fix', 'public.lead_profile_open',
        'public.lead_sheet_link_create', 'public.lead_sheet_links_list', 'public.lead_sheet_link_action', 'public.scheduler_sheet_links_due', 'public.scheduler_lead_sheet_apply', 'public.scheduler_lead_sheet_failed',
        -- job CP: reminder campaigns, the call list and the results
        'public.campaign_save', 'public.campaign_get', 'public.campaigns_list', 'public.campaign_recipients_add', 'public.campaign_recipients_from_ledger', 'public.campaign_recipient_remove', 'public.campaign_recipients_list', 'public.campaign_preview', 'public.campaign_approve', 'public.campaign_set_state', 'public.scheduler_campaign_run', 'public.call_list', 'public.call_list_outcome', 'public.campaign_results',
        -- job DP part 4: call settings (the Owner with a second factor saves; Owner and Admin read)
        'public.call_settings_get', 'public.call_settings_save', 'public.call_settings_campaign_get', 'public.call_settings_campaign_save', 'public.call_settings_campaign_clear',
        -- job CR (ADR 0087): the education pack (profile, programmes, students, admissions, fees, reports). Each proves the role first; children's data is read only by Owner / Admin / Sales
        'public.institution_profile_get', 'public.institution_profile_set', 'public.programme_save', 'public.programme_group_save', 'public.programmes_list', 'public.student_save', 'public.student_set_status', 'public.student_get', 'public.students_list', 'public.student_erase', 'public.scheduler_students_retention', 'public.admission_create', 'public.admission_stage_set', 'public.admission_get', 'public.admissions_list', 'public.admission_admit', 'public.fee_plan_save', 'public.fee_plan_get', 'public.fee_plans_list', 'public.fee_assign', 'public.fee_assignment_void', 'public.fee_payment_record', 'public.fee_concession_apply', 'public.fee_adjustment_record', 'public.fee_late_fees_preview', 'public.fee_late_fees_post', 'public.fee_statement', 'public.fee_entries_list', 'public.fee_receipt_get', 'public.fee_guardian_statement', 'public.fee_pending_list', 'public.campaign_recipients_from_students', 'public.students_import', 'public.education_report',
        -- job DP part 2: marks messages to guardians (the send log; the Owner with a second factor approves)
        'public.marks_send_resolve', 'public.marks_send_begin', 'public.marks_send_finish', 'public.marks_send_batches', 'public.marks_send_batch',
        -- job CV (ADR 0088): voice notes (settings, voices, the spoken disclosure, the campaign switch, the preview, the worker's two calls) and the one reports API
        'public.voice_settings_get', 'public.voice_settings_set', 'public.voice_voices_list', 'public.voice_choice_set', 'public.voice_disclosure_get', 'public.voice_usage_get', 'public.campaign_voice_get', 'public.campaign_voice_set', 'public.voice_preview_plan', 'public.voice_preview_record', 'public.scheduler_voice_plan', 'public.scheduler_voice_record', 'public.report_catalogue', 'public.report_run', 'public.construction_report',
        -- job DP part 3: paying again after a lapse (the Owner with a second factor)
        'public.billing_resume',
        -- job DI (ADR 0092): plans and billing. The catalogue and the Owner's and Admin's reads need a signed-in member; the Owner (second factor) starts a trial and cancels; the CHANNEL account records call seconds and applies provider events
        'public.billing_plans', 'public.billing_get', 'public.billing_usage_get', 'public.billing_check_usage', 'public.billing_start_trial', 'public.billing_subscription_ref', 'public.billing_cancel', 'public.billing_record_usage', 'public.billing_apply_event', 'public.billing_access', 'public.scheduler_billing_reminders_due', 'public.scheduler_billing_reminder_mark', 'public.outcome_record', 'public.outcome_correct', 'public.outcomes_list', 'public.outcomes_totals', 'public.outcomes_for_lead', 'public.assistant_settings_get', 'public.assistant_settings_save', 'public.assistant_voices', 'public.scheduler_billing_trial_clocks_due', 'public.scheduler_billing_trial_clock_mark', 'public.scheduler_billing_pending_due', 'public.scheduler_billing_pending_mark',
        -- job DP part 5: the Owner's own voice (the Owner with a second factor makes and deletes it)
        'public.own_voice_sentence', 'public.own_voice_get', 'public.own_voice_private', 'public.own_voice_ensure_bucket', 'public.own_voice_begin', 'public.own_voice_ready', 'public.own_voice_failed', 'public.own_voice_deleted',
        -- job DQ part 3: every member reads the assistant's name
        'public.assistant_name_get',
        'app.edu_terms_valid',  -- a CHECK on institution_profiles.terms runs with the writer's rights
        -- the proof-photo bucket's storage rules are evaluated as the caller, who must be able to run this one
        'app.pod_bucket_tenant',
        -- the archive guard runs as the caller and asks whether an erasure of the workspace is executing (job DQ part 4)
        'app.erasure_door_open',
        -- Today runs as the caller and asks for the usage notices of the caller's own workspace (job DS part E2)
        'app.today_usage_items',
        -- the own-voice bucket's storage rules are evaluated as the caller, who must be able to run this one (job DP part 5)
        'app.ovc_bucket_tenant')),
  '', 'authenticated can execute only the allow-listed functions');
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where nspname = 'public' and prosecdef
      and fq not in ('public.create_tenant', 'public.record_consent', 'public.suppress_contact', 'public.lift_suppression',
                     'public.import_lead_rows',
                     'public.start_agent_run', 'public.agent_write_evidence', 'public.agent_write_claim', 'public.agent_record_step',
                     'public.agent_record_usage', 'public.finish_agent_run', 'public.cancel_agent_run',
                     'public.set_tenant_agents_enabled', 'public.review_claim',
                     'public.agent_reserve_cost', 'public.set_tenant_daily_cost_cap', 'public.agent_release_cost', 'public.agent_ai_mode', 'public.agent_cost_summary',
                     'public.request_erasure', 'public.execute_erasure', 'public.cancel_erasure',
                     'public.agent_write_requirement_field', 'public.decide_requirement_field', 'public.confirm_requirement', 'public.discard_requirement',
                     'public.add_requirement_field',
                     'public.create_price_list_version', 'public.create_quote_policy_version', 'public.create_mapper_config_version', 'public.save_item_type', 'public.create_manual_quote_draft',
                     'public.pick_requirement_line_product', 'public.create_quote_draft', 'public.approve_quote', 'public.reject_quote',
                     'public.withdraw_approved_quote',
                     'public.record_contact_keys', 'public.check_suppression', 'public.unkeyed_contact_count', 'public.unkeyed_contacts', 'public.backfill_contact_keys',
                     'public.allow_erasure_without_key',
                     'public.create_order_policy_version', 'public.create_order_from_quote', 'public.record_order_event',
                     'public.create_followup_policy_version', 'public.followup_gate', 'public.followup_due_candidates', 'public.record_touch', 'public.create_followup_draft', 'public.approve_followup_draft',
                     'public.discard_followup_draft', 'public.record_draft_sent', 'public.persist_question_drafts', 'public.decide_question_draft',
                     'public.get_account_setup', 'public.complete_setup', 'public.ai_usage_today', 'public.ai_usage', 'public.ai_paused_until',
                     'public.assistant_begin_message', 'public.assistant_save_reply', 'public.assistant_save_reply_draft', 'public.assistant_mark_reply', 'public.assistant_conversations_list', 'public.assistant_conversation_archive',
                     'public.outbox_submit', 'public.outbox_edit', 'public.outbox_decide', 'public.outbox_claim_due', 'public.outbox_mark', 'public.outbox_set_settings', 'public.outbox_settings_get', 'public.call_request_create', 'public.call_request_decide',
                     'public.visit_settings_get', 'public.visit_settings_set', 'public.visit_slots', 'public.visit_book', 'public.visit_change', 'public.visit_step', 'public.visit_complete', 'public.visit_send_message',
                     'public.call_request_offer_visit', 'public.visit_list', 'public.ai_usage_week',
                     'public.scheduler_settings_get', 'public.scheduler_settings_set', 'public.scheduler_tenants', 'public.scheduler_heartbeat', 'public.scheduler_claim_due', 'public.scheduler_mark',
                     'public.scheduler_due_reminders', 'public.scheduler_queue_reminder', 'public.scheduler_mark_no_shows', 'public.scheduler_record', 'public.scheduler_status',
                     'public.catalogue_ensure_bucket', 'public.catalogue_item_save', 'public.catalogue_photo_add', 'public.catalogue_photo_remove', 'public.catalogue_photos_reorder',
                     'public.outbox_list', 'public.outbox_summary',
                     'public.export_accounting_data', 'public.import_job_preview_save', 'public.import_job_get', 'public.import_job_list', 'public.import_job_begin', 'public.import_job_finish',
                     'public.catalogue_stock_list', 'public.catalogue_stock_apply', 'public.calendar_feed_create', 'public.calendar_feed_status', 'public.calendar_feed_revoke', 'public.calendar_feed_read',
                     'public.policy_accept', 'public.policy_acceptances_mine',
                     'public.find_contact_by_phone',
        -- job BN (ADR 0075): download my data, deletion with a cooling-off, retention, grievances, and the worker's three steps
        'public.data_export_ensure_bucket', 'public.data_export_request', 'public.data_export_get', 'public.data_export_list', 'public.data_export_begin', 'public.data_export_finish', 'public.data_export_link', 'public.data_export_person_data',
        'public.deletion_request', 'public.deletion_cancel', 'public.deletion_list', 'public.deletion_execute_workspace',
        'public.retention_get', 'public.retention_set', 'public.retention_preview', 'public.grievance_submit', 'public.grievance_list', 'public.grievance_get', 'public.grievance_update',
        'public.privacy_worker_execute_account_deletions', 'public.privacy_worker_expired_exports', 'public.privacy_worker_export_cleaned', 'public.privacy_worker_run_retention',
        -- job BR (ADR 0076): WhatsApp. The business's own calls (role first), the inbox, and the three calls that only the registered channel account may make
                     'public.whatsapp_account_get', 'public.whatsapp_account_save', 'public.whatsapp_account_set_status', 'public.wa_template_save', 'public.wa_template_list', 'public.wa_template_set_status',
                     'public.conversation_list', 'public.conversation_thread', 'public.conversation_mark_read', 'public.wa_account_for', 'public.wa_ingest_inbound', 'public.wa_ingest_status',
                     -- job BY (ADR 0077): the team, the shop's basics, the weekly report, the feed and web-push. Role first in every one; the worker's three (push_worker_*) accept only the registered scheduler account
                     'public.create_invitation', 'public.accept_invitation', 'public.revoke_invitation', 'public.list_invitations', 'public.change_member_role', 'public.remove_member', 'public.team_members',
                     'public.workspace_profile_get', 'public.workspace_profile_save', 'public.weekly_report',
                     -- job DT (ADR 0115): the business profile, the members' own profiles and the sign-in status
                     'public.workspace_business_get', 'public.workspace_business_set', 'public.workspace_images_ensure_bucket', 'public.workspace_logo_set', 'public.my_profile_get', 'public.my_profile_set', 'public.people_profiles', 'public.account_security_get',
                     -- job DT (ADR 0116): the opening line and the AI-mention switch
                     'public.opening_get', 'public.opening_set_line', 'public.opening_set_mention',
                     -- job voice-picker: the workspace's chosen voice per language
                     'public.call_voice_get', 'public.call_voice_set',
                     'public.browser_voice_usage_get', 'public.browser_voice_usage_add',
                     'public.auto_reply_get', 'public.auto_reply_set', 'public.scheduler_auto_reply_pending', 'public.scheduler_auto_reply_submit', 'public.scheduler_auto_reply_skip', 'public.assistant_context_get', 'public.assistant_context_versions_list', 'public.assistant_context_version_get', 'public.assistant_context_save', 'public.scheduler_assistant_context', 'public.lead_inbound_address_get', 'public.lead_inbound_address_set', 'public.lead_source_cards_stats',
                     'public.notifications_list', 'public.notifications_mark_seen', 'public.push_subscribe', 'public.push_unsubscribe', 'public.push_prefs_get', 'public.push_prefs_set',
                     'public.push_worker_pending', 'public.push_worker_mark', 'public.push_worker_report',
                     'public.web_quota_take', 'public.web_usage_today', 'public.web_query_check',
                     'public.indiamart_pull_begin', 'public.indiamart_pull_finish', 'public.payment_link_begin', 'public.payment_link_attach', 'public.payment_link_fail', 'public.payment_link_list', 'public.payment_link_get', 'public.payment_link_mark_recorded', 'public.scheduler_payment_event', 'public.scheduler_missed_call', 'public.missed_call_list', 'public.missed_call_handle', 'public.call_bridge_prepare', 'public.call_bridge_finish', 'public.scheduler_call_status', 'public.connectors_status',
                     'public.business_profile_set',
        -- job CK (ADR 0084 parts 1 and 2): the pack a business runs and its modules (every member reads), the packs a person may choose, custom fields (Owner / Admin with a second factor to define; the roles that may edit the
        -- entity to fill in), and the example data (Owner / Admin). Each proves the role first; the pack tables themselves have no client grant.
        'public.workspace_pack_get', 'public.workspace_modules', 'public.pack_catalogue',
        'public.custom_field_defs_list', 'public.custom_field_def_create', 'public.custom_field_def_update', 'public.custom_values_get', 'public.custom_values_set', 'public.custom_values_set_many',
        'public.example_data_status', 'public.example_data_load', 'public.example_data_remove',
        -- job DR B1: "Ask Vijaya to do it" (Owner/Admin/Sales plan, the Owner approves with a second factor, Owner/Admin run)
        'public.task_context', 'public.task_save', 'public.task_get', 'public.tasks_list', 'public.task_contacts_list', 'public.task_report', 'public.task_exclude', 'public.task_approve', 'public.task_set_cap', 'public.task_set_state', 'public.task_claim', 'public.task_contact_result',
                     -- job DP part 5: the Owner's own voice
                     'public.own_voice_sentence', 'public.own_voice_get', 'public.own_voice_private', 'public.own_voice_ensure_bucket', 'public.own_voice_begin', 'public.own_voice_ready', 'public.own_voice_failed', 'public.own_voice_deleted',
                     -- job DQ part 3: every member reads the assistant's name
                     'public.assistant_name_get',
                     'public.catalogue_material_save', 'public.site_save', 'public.site_get', 'public.sites_list', 'public.invoice_record', 'public.invoices_import', 'public.invoice_void', 'public.payment_record', 'public.payment_void', 'public.credit_limit_set', 'public.dues_statement', 'public.dues_summary', 'public.credit_check', 'public.dues_ledger', 'public.material_item_inputs', 'public.material_policy_create', 'public.material_policy_get', 'public.material_quote_build', 'public.material_quote_draft', 'public.material_quote_approve', 'public.material_quote_reject', 'public.material_quote_get', 'public.material_quotes_list', 'public.create_order_from_material_quote', 'public.trip_plan', 'public.trip_update', 'public.trip_set_status', 'public.trip_deliver', 'public.pod_ensure_bucket', 'public.trip_get', 'public.trips_list', 'public.delivery_challan_get', 'public.trip_update_submit',
                     -- job RESEND: the trial reminder e-mails
                     'public.scheduler_billing_trial_due', 'public.scheduler_billing_trial_mark',
        -- job DR A3: speed to lead and approve once (the Owner approves a plan once; staff report results; the worker scans, takes due calls and reminds)
        'public.outreach_batch_approve', 'public.outreach_batch_exclude', 'public.outreach_batch_get', 'public.outreach_batch_plan', 'public.outreach_batch_state', 'public.outreach_batches_list', 'public.outreach_caps_set', 'public.outreach_handoff_acted', 'public.outreach_handoffs_list', 'public.outreach_item_result', 'public.outreach_items_list',
        'public.outreach_policy_get', 'public.outreach_policy_set', 'public.outreach_report', 'public.outreach_rule_save', 'public.outreach_rule_state', 'public.outreach_rules_list', 'public.outreach_source_costs_get', 'public.outreach_source_costs_set', 'public.scheduler_outreach_reminders', 'public.scheduler_outreach_run', 'public.scheduler_outreach_scan',
        -- job DS part E2: running out before the month ends (the Owner reads and buys; the worker closes periods and sends alerts)
        'public.billing_topups_get', 'public.billing_topup_buy', 'public.billing_topup_settings_set', 'public.billing_invoices_list', 'public.billing_invoice_get', 'public.billing_upgrade_preview', 'public.billing_upgrade', 'public.scheduler_billing_topup_tick', 'public.scheduler_usage_alerts_due', 'public.scheduler_usage_alert_mark',
        -- job DQ part 4 (DPDP): consent, profile, the public grievance and waitlist doors (open to the public key, with their own caps), the worker's intake, lapse and purge calls
        'public.consents_mine', 'public.consent_set_marketing', 'public.profile_get', 'public.profile_set', 'public.public_grievance_submit', 'public.waitlist_join',
        'public.scheduler_public_intake_due', 'public.scheduler_public_intake_mark', 'public.scheduler_lapse_due', 'public.scheduler_lapse_warned', 'public.scheduler_lapse_erase', 'public.lapse_erasure_status', 'public.privacy_worker_purge_logs',
        -- job DS: how the assistant talks (every member reads, the Owner with a second factor sets)
        'public.speaking_style_get', 'public.speaking_style_set',
        -- job DR / A1: the lead playbook (any member reads, the Owner with a second factor saves) and the knowledge base (Owner/Admin manage, every member reads the approved facts)
        'public.lead_playbook_get', 'public.lead_playbook_save', 'public.lead_playbook_reset', 'public.knowledge_source_add', 'public.knowledge_sources_list', 'public.knowledge_source_text', 'public.knowledge_source_discard',
        'public.knowledge_facts_draft_replace', 'public.knowledge_fact_add', 'public.knowledge_fact_edit', 'public.knowledge_fact_decide', 'public.knowledge_facts_list', 'public.knowledge_facts_approved',
        -- job DR / A2: lead sources and imports (a person imports; Owner/Admin manage sources; the worker account is the door for the public arrivals and the sheets)
        'public.lead_consent_confirm', 'public.lead_intake_apply', 'public.lead_intakes_list', 'public.lead_source_create', 'public.lead_sources_list', 'public.lead_source_rotate', 'public.lead_source_set_status',
        'public.scheduler_lead_intake_live', 'public.scheduler_lead_unparsed_add', 'public.lead_unparsed_list', 'public.lead_unparsed_discard', 'public.lead_arrivals_list', 'public.lead_desk_page', 'public.lead_desk_get', 'public.lead_profile_unseeded', 'public.lead_profile_seed', 'public.lead_profile_apply_ai', 'public.lead_profile_fix', 'public.lead_profile_open',
        'public.lead_sheet_link_create', 'public.lead_sheet_links_list', 'public.lead_sheet_link_action', 'public.scheduler_sheet_links_due', 'public.scheduler_lead_sheet_apply', 'public.scheduler_lead_sheet_failed',
                     -- job CP: the shared ledger
                     'public.ledger_entry_record', 'public.ledger_entry_void', 'public.ledger_charges_import', 'public.ledger_statement', 'public.ledger_summary', 'public.ledger_entries_list', 'public.ledger_receipt_get',
                     'public.campaign_save', 'public.campaign_get', 'public.campaigns_list', 'public.campaign_recipients_add', 'public.campaign_recipients_from_ledger', 'public.campaign_recipient_remove', 'public.campaign_recipients_list', 'public.campaign_preview', 'public.campaign_approve', 'public.campaign_set_state', 'public.scheduler_campaign_run', 'public.call_list', 'public.call_list_outcome', 'public.campaign_results',
                     -- job DP part 4: call settings
                     'public.call_settings_get', 'public.call_settings_save', 'public.call_settings_campaign_get', 'public.call_settings_campaign_save', 'public.call_settings_campaign_clear',
                     -- job CR: the education pack
                     'public.institution_profile_get', 'public.institution_profile_set', 'public.programme_save', 'public.programme_group_save', 'public.programmes_list', 'public.student_save', 'public.student_set_status', 'public.student_get', 'public.students_list', 'public.student_erase', 'public.scheduler_students_retention', 'public.admission_create', 'public.admission_stage_set', 'public.admission_get', 'public.admissions_list', 'public.admission_admit', 'public.fee_plan_save', 'public.fee_plan_get', 'public.fee_plans_list', 'public.fee_assign', 'public.fee_assignment_void', 'public.fee_payment_record', 'public.fee_concession_apply', 'public.fee_adjustment_record', 'public.fee_late_fees_preview', 'public.fee_late_fees_post', 'public.fee_statement', 'public.fee_entries_list', 'public.fee_receipt_get', 'public.fee_guardian_statement', 'public.fee_pending_list', 'public.campaign_recipients_from_students', 'public.students_import', 'public.education_report',
                     -- job DP part 2: marks messages to guardians
                     'public.marks_send_resolve', 'public.marks_send_begin', 'public.marks_send_finish', 'public.marks_send_batches', 'public.marks_send_batch',
                     -- job CV: voice notes and the one reports API
                     'public.voice_settings_get', 'public.voice_settings_set', 'public.voice_voices_list', 'public.voice_choice_set', 'public.voice_disclosure_get', 'public.voice_usage_get', 'public.campaign_voice_get', 'public.campaign_voice_set', 'public.voice_preview_plan', 'public.voice_preview_record', 'public.scheduler_voice_plan', 'public.scheduler_voice_record', 'public.report_catalogue', 'public.report_run', 'public.construction_report',
                     -- job DP part 3: paying again after a lapse
                     'public.billing_resume',
                     -- job DI: plans and billing
                     'public.billing_plans', 'public.billing_get', 'public.billing_usage_get', 'public.billing_check_usage', 'public.billing_start_trial', 'public.billing_subscription_ref', 'public.billing_cancel', 'public.billing_record_usage', 'public.billing_apply_event', 'public.billing_access', 'public.scheduler_billing_reminders_due', 'public.scheduler_billing_reminder_mark', 'public.outcome_record', 'public.outcome_correct', 'public.outcomes_list', 'public.outcomes_totals', 'public.outcomes_for_lead', 'public.assistant_settings_get', 'public.assistant_settings_save', 'public.assistant_voices', 'public.scheduler_billing_trial_clocks_due', 'public.scheduler_billing_trial_clock_mark', 'public.scheduler_billing_pending_due', 'public.scheduler_billing_pending_mark')),
  '', 'the only SECURITY DEFINER functions in the API schema are create_tenant, the three consent functions, import_lead_rows, the thirteen agent functions (ADR 0013, T007), the five requirement functions (T008), the three quote reference-data functions and the four quote functions (T009) the three erasure functions (ADR 0014) and the two open sign-up functions (job AD / D2) and the fourteen integration functions (job BI)');
-- Nothing in the private schema that is operator-only may be callable by a client.
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where fq in ('app.operator_enable_selftest', 'app.agent_open_run', 'app.agent_assert_enabled', 'app.agent_args_sha',
                 'app.agent_derived_id', 'app.agent_step_replay',
                 'app.agent_utc_today', 'app.agent_cost_micros', 'app.agent_daily_cap', 'app.agent_day_spend', 'app.agent_cost_lock',
                 'app.erase_column', 'app.erasure_sweep', 'app.erase_contact', 'app.erase_company', 'app.erase_tenant',
                 'app.erasure_running', 'app.erasure_columns', 'app.guard_consent_update', 'app.guard_audit_update',
                 'app.operator_open_real_data_gate', 'app.operator_close_real_data_gate', 'app.operator_add_member',
                 'app.operator_add_owner_exception', 'app.real_data_gate_open', 'app.guard_real_data',
                 'app.operator_reset_mfa', 'app.require_aal2', 'app.guard_aal2_client_write',
                 -- job CK: the module checks, the pack applier, the default-pack trigger and the custom-field writers are callable by no client role
                 'app.module_enabled', 'app.require_module', 'app.module_guard', 'app.module_guard_agent', 'app.assign_default_pack', 'app.apply_pack_fields',
                 'app.cf_put_value', 'app.cf_check_entity', 'app.cf_values_json', 'app.account_email_verified',
                 'app.operator_enable_requirement', 'app.requirement_deny', 'app.requirement_error', 'app.requirement_ws',
                 'app.requirement_confirmable', 'app.enquiry_set_context')
      and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute'))),
  '', 'the agent helpers and the operator function are callable by no client role');

-- Functions the API schema exposes to clients and that are NOT SECURITY DEFINER run with the
-- caller's rights; they must still pin search_path (no hijack through a caller-controlled path).
select is(
  (select coalesce(string_agg(sig, ', '), '') from our_functions
    where nspname = 'public' and not prosecdef
      and has_function_privilege('authenticated', oid, 'execute')
      and not coalesce('search_path=""' = any (proconfig), false)),
  '', 'every SECURITY INVOKER function in the API schema pins search_path to empty');

-- ---- RLS policy pattern (performance AND correctness; see ADR 0004)
-- Per-row helpers take the row's tenant_id, so Postgres evaluates them once per ROW OF THE TABLE
-- (all tenants' rows). They remain for one-row checks inside functions, never for policies.
select is(
  (select coalesce(string_agg(p.tablename || '.' || p.policyname, ', '), '') from pg_policies p
    where p.schemaname = 'public'
      and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
          ~* '(is_tenant_member|has_tenant_role|shares_tenant_with)'),
  '', 'no policy calls a per-row membership helper');
select is(
  (select coalesce(string_agg(t.relname || '.' || p.polname, ', '), '')
     from tenant_tables t
     join pg_policy p on p.polrelid = t.relid
    where (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) !~ 'my_tenant_ids'),
  '', 'every policy on a tenant-owned table uses app.my_tenant_ids / my_tenant_ids_with_role');

-- Plan-level proof, for every public table with RLS: the caller's tenant list is an InitPlan
-- (once per statement) and there is no per-row SubPlan.
select is(
  (select coalesce(string_agg(c.relname, ', '), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      -- operator-managed tables (agent limits, flags, definitions) grant clients nothing: there is no client plan to inspect
      and has_table_privilege('authenticated', c.oid, 'select')
      and tests.explain_as(tests.uid('a_owner'), format('select * from public.%I', c.relname)) ~ 'SubPlan'),
  '', 'no public table plans a per-row SubPlan for its RLS filter');
select is(
  (select coalesce(string_agg(c.relname, ', '), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      -- operator-managed tables (agent limits, flags, definitions) grant clients nothing: there is no client plan to inspect
      and has_table_privilege('authenticated', c.oid, 'select')
      and tests.explain_as(tests.uid('a_owner'), format('select * from public.%I', c.relname)) !~ 'InitPlan'),
  '', 'every public table plans its RLS filter as an InitPlan');

-- ---- T003 guards: composite keys, audit/PII classification, registry coverage, grants vs matrix
-- Every FK from a tenant-owned table to another tenant-owned table must be COMPOSITE, start with
-- tenant_id on both sides, and never cascade (a SET NULL must name its columns, never tenant_id).
select is(
  (select coalesce(string_agg(c.conname, ', '), '')
     from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.conrelid in (select relid from tenant_tables)
      and c.confrelid in (select relid from tenant_tables)
      and not (
            cardinality(c.conkey) >= 2
        and (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) = 'tenant_id'
        and (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) = 'tenant_id'
      )),
  '', 'every FK between tenant-owned tables is composite and starts with tenant_id');
select cmp_ok(
  (select count(*) from pg_constraint c
    where c.contype = 'f' and c.conrelid in (select relid from tenant_tables) and c.confrelid in (select relid from tenant_tables)),
  '>=', 10::bigint, 'the composite-FK guard is not vacuous');
select is(
  (select coalesce(string_agg(c.conname, ', '), '')
     from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.conrelid in (select relid from tenant_tables)
      -- parents that are tenant-owned (or tenants itself). The one deliberate exception is
      -- memberships.user_id -> users ON DELETE CASCADE (account deletion; ADR 0001 #2).
      and (c.confrelid in (select relid from tenant_tables) or c.confrelid = 'public.tenants'::regclass)
      and (c.confdeltype in ('c', 'd')
           or c.confupdtype in ('c', 'n', 'd')
           or (c.confdeltype = 'n' and (c.confdelsetcols is null
                or (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'tenant_id') = any (c.confdelsetcols))))),
  '', 'no foreign key cascades, sets a default, or nulls tenant_id');
select is(
  (select coalesce(string_agg(c.conname, ', '), '')
     from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.conrelid in (select relid from tenant_tables)
      and not exists (
        select 1 from pg_index i
         where i.indrelid = c.conrelid
           and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)),
  '', 'the child side of every foreign key on a tenant-owned table is indexed');

-- Every tenant-owned table except the audit trail itself has an audit trigger.
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where t.relname <> 'audit_events'
      and not exists (select 1 from pg_trigger g where g.tgrelid = t.relid and not g.tgisinternal
                        and g.tgfoid = 'app.audit_row_change()'::regprocedure)),
  '', 'every tenant-owned table (except audit_events) has an audit trigger');

-- PII classification. audited = tables with app.audit_row_change; the trigger's 2nd argument is the
-- PII column list; column comments 'PII: ...' / 'SAFE: ...' are the registry.
create temp table audited as
select c.oid as relid, c.relname,
       coalesce((regexp_split_to_array(encode(g.tgargs, 'escape'), '\\000'))[2], '') as pii_csv
  from pg_trigger g join pg_class c on c.oid = g.tgrelid
 where g.tgfoid = 'app.audit_row_change()'::regprocedure and not g.tgisinternal and c.relnamespace = 'public'::regnamespace;

select cmp_ok((select count(*) from audited), '>=', 8::bigint, 'audit-trigger table list is not vacuous');
select is(
  (select coalesce(string_agg(a.relname || '.' || at.attname, ', '), '')
     from audited a join pg_attribute at on at.attrelid = a.relid and at.attnum > 0 and not at.attisdropped
    where at.atttypid in ('text'::regtype, 'varchar'::regtype, 'text[]'::regtype, 'jsonb'::regtype)
      and coalesce(col_description(a.relid, at.attnum), '') !~ '^(PII|SAFE):'),
  '', 'every text / text[] / jsonb column of an audited table is classified PII or SAFE (free text defaults to PII)');
select is(
  (select coalesce(string_agg(x.relname || '.' || x.col, ', '), '') from (
     (select a.relname, at.attname::text as col
        from audited a join pg_attribute at on at.attrelid = a.relid and at.attnum > 0 and not at.attisdropped
       where col_description(a.relid, at.attnum) like 'PII:%'
      except
      select a.relname, unnest(case when a.pii_csv = '' then '{}'::text[] else string_to_array(a.pii_csv, ',') end) from audited a)
   ) x),
  '', 'every column marked PII is on its table''s audit-trigger PII list (so it is never audited by value)');
select is(
  (select coalesce(string_agg(x.relname || '.' || x.col, ', '), '') from (
     (select a.relname, unnest(case when a.pii_csv = '' then '{}'::text[] else string_to_array(a.pii_csv, ',') end) as col from audited a
      except
      select a.relname, at.attname::text
        from audited a join pg_attribute at on at.attrelid = a.relid and at.attnum > 0 and not at.attisdropped
       where col_description(a.relid, at.attnum) like 'PII:%')
   ) x),
  '', 'the audit-trigger PII lists contain only columns that are marked PII (no stale entries)');

-- Invisible-Unicode hygiene (T004 hardening, ADR 0008): every text / text[] / jsonb column of a
-- tenant-owned table is guarded by a CHECK that calls app.text_is_clean, OR carries an explicit
-- "CLEAN-EXEMPT: <reason>" comment AND is either limited by a strict anchored pattern (a CHECK
-- `col ~ '^...'`) or cannot be written by any client at all.
select is(
  (select coalesce(string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname), '')
     from tenant_tables t
     join pg_attribute a on a.attrelid = t.relid and a.attnum > 0 and not a.attisdropped
    where a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'text[]'::regtype, 'jsonb'::regtype)
      and not exists (select 1 from pg_constraint k
                       where k.conrelid = t.relid and k.contype = 'c' and a.attnum = any (k.conkey)
                         and pg_get_constraintdef(k.oid) like '%text_is_clean(%')
      and not (
            coalesce(col_description(t.relid, a.attnum), '') ~ 'CLEAN-EXEMPT: .{10,}'
        and (
              exists (select 1 from pg_constraint k
                       where k.conrelid = t.relid and k.contype = 'c' and a.attnum = any (k.conkey)
                         and pg_get_constraintdef(k.oid) ~ '~ ''\^')
           or not (has_column_privilege('authenticated', t.relid, a.attnum, 'INSERT')
                   or has_column_privilege('authenticated', t.relid, a.attnum, 'UPDATE'))
        ))),
  '', 'every free-text column of a tenant-owned table has a text_is_clean CHECK or a documented CLEAN-EXEMPT (strict pattern or not client-writable)');
select cmp_ok(
  (select count(*) from tenant_tables t
     join pg_attribute a on a.attrelid = t.relid and a.attnum > 0 and not a.attisdropped
    where exists (select 1 from pg_constraint k
                   where k.conrelid = t.relid and k.contype = 'c' and a.attnum = any (k.conkey)
                     and pg_get_constraintdef(k.oid) like '%text_is_clean(%')),
  '>=', 24::bigint, 'the hygiene guard is not vacuous (24+ guarded columns)');
select is(
  (select coalesce(string_agg(t.relname || '.' || a.attname, ', ' order by t.relname, a.attname), '')
     from tenant_tables t
     join pg_attribute a on a.attrelid = t.relid and a.attnum > 0 and not a.attisdropped
    where col_description(t.relid, a.attnum) like '%CLEAN-EXEMPT%'
      and exists (select 1 from pg_constraint k
                   where k.conrelid = t.relid and k.contype = 'c' and a.attnum = any (k.conkey)
                     and pg_get_constraintdef(k.oid) like '%text_is_clean(%')),
  '', 'no column is both guarded and marked exempt (a stale exemption would hide a gap later)');

-- Registry coverage for the generic cross-tenant test (an unregistered table = a failing guard).
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where not exists (select 1 from tests.tenant_table_registry r where r.table_name = t.relname)),
  '', 'every tenant-owned table is registered in tests.tenant_table_registry (fixture builder)');
select is(
  (select coalesce(string_agg(r.table_name, ', '), '') from tests.tenant_table_registry r
    where (select count(*) from tests.role_matrix m where m.table_name = r.table_name) <> 4),
  '', 'every registered table has a role_matrix row for each of the four roles');
select is(
  (select coalesce(string_agg(r.table_name, ', '), '') from tests.tenant_table_registry r
    where not exists (select 1 from tenant_tables t where t.relname = r.table_name)),
  '', 'the registry lists only existing tenant-owned tables');

-- Keyset-pagination index where the registry says it is required.
select is(
  (select coalesce(string_agg(r.table_name, ', '), '') from tests.tenant_table_registry r
    where r.keyset_index_required
      and not exists (
        select 1 from pg_index i
         where i.indrelid = format('public.%I', r.table_name)::regclass
           and (select array_agg(a.attname::text order by k.ord)
                  from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
               = array['tenant_id', 'created_at', 'id'])),
  '', 'every table that needs it has an index (tenant_id, created_at, id) for keyset pagination');

-- The privileges granted to authenticated agree with the role matrix.
select is(
  (select coalesce(string_agg(r.table_name || ':' || p.priv, ', '), '') from tests.tenant_table_registry r,
     (values ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
    where (case p.priv when 'DELETE' then has_table_privilege('authenticated', format('public.%I', r.table_name)::regclass, 'DELETE')
                       else has_any_column_privilege('authenticated', format('public.%I', r.table_name)::regclass, p.priv) end)
          is distinct from (select bool_or(case p.priv when 'INSERT' then can_insert when 'UPDATE' then can_update else can_delete end)
                              from tests.role_matrix m where m.table_name = r.table_name)),
  '', 'authenticated holds INSERT / UPDATE / DELETE on exactly the tables the role matrix lets some role write');
select is(
  (select coalesce(string_agg(t.relname, ', '), '') from tenant_tables t
    where has_column_privilege('authenticated', t.relid, 'tenant_id', 'UPDATE')),
  '', 'no client can UPDATE tenant_id on any tenant-owned table');
select is(
  (select coalesce(string_agg(t.relname || '.' || a.attname || ':' || p.priv, ', '), '')
     from tenant_tables t
     join pg_attribute a on a.attrelid = t.relid and a.attname in ('created_by', 'created_via', 'created_at', 'updated_at')
    cross join (values ('INSERT'), ('UPDATE')) p(priv)
    where has_column_privilege('authenticated', t.relid, a.attname, p.priv)),
  '', 'server-owned provenance / timestamp columns are not writable by clients on any tenant-owned table');

-- Every policy on a tenant-owned table is for the authenticated role only.
select is(
  (select coalesce(string_agg(t.relname || '.' || p.polname, ', '), '')
     from tenant_tables t join pg_policy p on p.polrelid = t.relid
    where p.polroles <> array[(select oid from pg_roles where rolname = 'authenticated')]),
  '', 'every policy on a tenant-owned table is TO authenticated only');

-- ---- views bypass RLS unless security_invoker
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  '', 'every public view is security_invoker (cannot bypass RLS)');

-- ---- the private schema stays private
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon has no USAGE on schema app');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'v', 'm', 'p')),
  0::bigint, 'schema app holds functions only: no tables or views to expose');

-- ---- service_role (Supabase's key that bypasses RLS) writes nothing in public: the app never uses it (CLAUDE.md non-negotiable 2)
select is(
  (select coalesce(string_agg(c.relname || ':' || p.priv, ', ' order by c.relname, p.priv), '') from pg_class c
     cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv)
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('service_role', c.oid, p.priv)),
  '', 'service_role holds no INSERT / UPDATE / DELETE / TRUNCATE on any public table or view');
select is(has_table_privilege('service_role', 'public.tenants', 'SELECT'), true, '...it keeps SELECT (read-only operator access)');
create table public.zz_guard_probe (id int);
select is(
  (select coalesce(string_agg(p.priv, ','), '') from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv) where has_table_privilege('service_role', 'public.zz_guard_probe', p.priv)),
  '', 'a table created later does not grant service_role writes either (default privileges)');

select * from finish();
rollback;
