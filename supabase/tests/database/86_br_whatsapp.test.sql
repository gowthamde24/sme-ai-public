-- Job BR (ADR 0076): WhatsApp (migration 20261117090000). The channel principal, the business's number, templates and the send guard, inbound messages (contact, lead, opt-in, enquiry, STOP,
-- suppression keys, the real-data gate), the outbox's claim with its send context, delivery statuses (order, idempotency, the lost-answer reconcile), the conversations, erasure of a WhatsApp contact.
--   A catalog   B the channel principal   C the number   D templates   E inbound   F the 24-hour window and the claim   G marks and failure codes   H delivery statuses   I conversations   J erasure
-- THE CLOCK: app.outbox_now() is replaced for this transaction. Sections A to E, I and J use the pin below (default Monday 2026-10-05 14:00 IST; PGOPTIONS='-c tests.br_pin=2026-10-05T23:30:00+05:30'
-- to run at another instant); sections F, G and H pin their own daytime instants (the outbox holds claims in quiet hours).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.base() returns timestamptz language sql as $$ select coalesce(nullif(current_setting('tests.br_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz $$;
select pg_temp.pin(pg_temp.base());
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
-- the channel principal (x6) and the scheduler principal (x5)
create function pg_temp.ch(p_sql text) returns text language sql as $$ select pg_temp.sc('x6', p_sql) $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('x5', p_sql) $$;
-- an inbound message: (wamid, number digits, name, kind, text, optout, hmac label)
create function pg_temp.inb(p_wamid text, p_from text, p_text text default 'Hello', p_name text default 'Ravi Kumar', p_kind text default 'text', p_optout boolean default false, p_pni text default '100000000000001', p_hmac text default null) returns text language sql as $$
  select pg_temp.ch(format($q$select public.wa_ingest_inbound(%L, %L, %L, %L, %L, %L, %L, %L, 1, %L)$q$, p_pni, p_wamid, p_from, p_name, p_kind, p_text, pg_temp.base(), coalesce(p_hmac, pg_temp.h(p_from)), p_optout)) $$;
create function pg_temp.sta(p_wamid text, p_status text, p_code int default null, p_cb text default null, p_pni text default '100000000000001') returns text language sql as $$
  select pg_temp.ch(format($q$select public.wa_ingest_status(%L, %L, %L, %L, %L, %L)$q$, p_pni, p_wamid, p_status, pg_temp.base(), p_code, p_cb)) $$;
create function pg_temp.contact_of(p_lead text) returns uuid language sql as $$ select contact_id from public.leads where id = p_lead::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'integrations' and c.relname in ('channel_principals', 'whatsapp_accounts', 'wa_templates', 'wa_events', 'wa_message_status', 'wa_conversation_state') and c.relrowsecurity and c.relforcerowsecurity), 6::bigint,
          'A: the six WhatsApp tables have row-level security on and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'integrations' and table_name in ('channel_principals', 'whatsapp_accounts', 'wa_templates', 'wa_events', 'wa_message_status', 'wa_conversation_state') and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint,
          'A: no client role holds any privilege on them');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('whatsapp_account_get', 'whatsapp_account_save', 'whatsapp_account_set_status', 'wa_template_save', 'wa_template_list', 'wa_template_set_status', 'wa_account_for', 'wa_ingest_inbound', 'wa_ingest_status',
                              'conversation_list', 'conversation_thread', 'conversation_mark_read')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 12::bigint, 'A: all twelve public functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'wa\_%' or p.proname like 'whatsapp\_%' or p.proname like 'conversation\_%') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'A: anon can execute none of them');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('operator_register_channel_agent', 'operator_remove_channel_agent', 'is_channel_agent') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint,
          'A: a client cannot register a channel account or ask who is one');
select is((select string_agg(conname, ',' order by conname) from pg_constraint where conrelid = 'public.outbox_messages'::regclass and conname in ('outbox_messages_adapter_check')), 'outbox_messages_adapter_check', 'A: the outbox accepts the real adapter');

-- ---------------------------------------------------------------------------------------------
-- B. the channel principal
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.ch($$select public.wa_account_for('100000000000001')$$), 'ERR:42501', 'B: before registration the account is nobody (42501)');
select is(pg_temp.priv($$select app.operator_register_channel_agent('a_owner@test.local')$$), '42501', 'B: an account that belongs to a workspace cannot be the channel account');
select is(pg_temp.priv($$select app.operator_register_channel_agent('nobody@test.local')$$), '23503', 'B: an unknown account is refused');
select is((select app.operator_register_channel_agent('X6@test.local')), tests.uid('x6'), 'B: the operator registers the account (case does not matter)');
select is(pg_temp.priv(format($i$select tests.scalar_as(%L, 'select app.operator_register_channel_agent(''x5@test.local'')')$i$, tests.uid('a_owner'))), '42501', 'B: a signed-in caller cannot register one');
select is(pg_temp.priv(format($i$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$i$, tests.tid('a'), tests.uid('x6'))), '42501', 'B: the channel account can never join a workspace');
select is(pg_temp.sc('a_owner', $$select public.wa_account_for('100000000000001')$$), 'ERR:42501', 'B: an Owner is not the channel account');
select is(pg_temp.sc('a_owner', format($q$select public.wa_ingest_inbound('1', 'w', '0091234567801', 'n', 'text', 't', now(), %L, 1, false)$q$, pg_temp.h('x'))), 'ERR:42501', 'B: an Owner cannot hand in an inbound message');
select is(pg_temp.sc('anon', $$select public.wa_account_for('1')$$), 'ERR:42501', 'B: anon cannot');
select is(pg_temp.ch(format('select public.conversation_list(%L)', tests.tid('a'))), 'ERR:42501', 'B: the channel account cannot read a conversation');
select is(pg_temp.ch(format('select public.whatsapp_account_get(%L)', tests.tid('a'))), 'ERR:42501', 'B: ...or a business''s account');
select is(tests.scalar_as(tests.uid('x6'), 'select count(*) from public.contacts'), '0', 'B: row-level security shows the channel account no contact');
select is(pg_temp.ch($$select public.wa_account_for('100000000000001')$$), null, 'B: registered, it asks about a number nobody has set up: null');

-- ---------------------------------------------------------------------------------------------
-- C. the business's number
-- ---------------------------------------------------------------------------------------------
create function pg_temp.save(p_user text, p_tenant text, p_pni text default '100000000000001', p_aal text default 'aal2', p_ref text default 'shop_a', p_waba text default '200000000000001') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.whatsapp_account_save(%L, %L, %L, '+91 98765 43210', true, %L)$q$, tests.tid(p_tenant), p_waba, p_pni, p_ref), p_aal) $$;
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.whatsapp_account_get(%L)', tests.tid('a'))), 'configured'), 'false', 'C: nothing is set up yet');
select is(pg_temp.sc('a_sales', format('select public.whatsapp_account_get(%L)', tests.tid('a'))), 'ERR:42501', 'C: Sales cannot read the account');
select is(pg_temp.save('a_admin', 'a'), 'ERR:42501', 'C: an Admin cannot set it');
select is(pg_temp.save('a_owner', 'a', p_aal => 'aal1'), 'ERR:SM306', 'C: the Owner needs the second factor');
select is(pg_temp.save('b_owner', 'a'), 'ERR:42501', 'C: another business''s Owner cannot');
select is(pg_temp.save('a_owner', 'a', 'abc'), 'ERR:22023', 'C: a malformed phone number id is invalid');
select is(pg_temp.save('a_owner', 'a', p_ref => 'bad ref'), 'ERR:22023', 'C: a malformed token reference is invalid (and a token itself would not fit)');
select is(pg_temp.j(pg_temp.save('a_owner', 'a'), 'status'), 'pending', 'C: the Owner saves it: pending (not live)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.whatsapp_account_get(%L)', tests.tid('a'))), 'coexistence'), 'true', 'C: the coexistence flag is kept');
select is(pg_temp.save('b_owner', 'b', '100000000000001'), 'ERR:23505', 'C: a phone number id belongs to one business (23505)');
select is(pg_temp.ch($$select public.wa_account_for('100000000000001')$$), null, 'C: a pending number receives nothing (the webhook is ignored until the Owner switches it on)');
select is(pg_temp.sc('a_admin', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a'))), 'ERR:42501', 'C: an Admin cannot switch it on');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a'))), 'status'), 'active', 'C: the Owner switches it on');
select is(pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'pending')$q$, tests.tid('a'))), 'ERR:22023', 'C: only active or disabled can be set');
select is(pg_temp.j(pg_temp.ch($$select public.wa_account_for('100000000000001')$$), 'tenant_id'), tests.tid('a')::text, 'C: the channel account now finds the business by the number id');
select is(pg_temp.ch($$select public.wa_account_for('999999999999')$$), null, 'C: an unknown number id finds nothing');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action in ('whatsapp.account_saved', 'whatsapp.account_active')), 2::bigint, 'C: audited');
select is((select bool_and(new_values::text !~* '(shop_a|token|98765)') from public.audit_events where tenant_id = tests.tid('a') and action like 'whatsapp.%'), true, 'C: the audit holds neither the token reference nor the phone number');
select is(pg_temp.j(pg_temp.save('a_owner', 'a', '100000000000002'), 'status'), 'pending', 'C: a changed number is not live until switched on again');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a'))), 'status'), 'active', 'C: ...and the Owner does that');
select is(pg_temp.j(pg_temp.save('a_owner', 'a', '100000000000001'), 'status'), 'pending', 'C: back to the first number: pending again');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a'))), 'status'), 'active', 'C: ...active');

-- ---------------------------------------------------------------------------------------------
-- D. templates
-- ---------------------------------------------------------------------------------------------
create function pg_temp.tpl(p_user text, p_id text, p_name text default 'shop_update', p_lang text default 'en', p_purpose text default 'followup', p_body text default 'An update from our shop: {{1}} Reply STOP to stop.') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.wa_template_save(%L, %L, %L, %L, 'utility', %L, %L)$q$, tests.rid(p_id), tests.tid('a'), p_name, p_lang, p_purpose, p_body)) $$;
select is(pg_temp.tpl('a_sales', 't1'), 'ERR:42501', 'D: Sales cannot make a template');
select is(pg_temp.j(pg_temp.tpl('a_admin', 't1'), 'status'), 'draft', 'D: an Admin makes a draft');
select is(pg_temp.tpl('a_admin', 't2', p_body => '{{1}} is first and that is not allowed'), 'ERR:22023', 'D: a template that begins with its variable is refused (Meta would)');
select is(pg_temp.tpl('a_admin', 't2', p_body => 'The variable is last and that is not allowed {{1}}'), 'ERR:22023', 'D: ...or ends with it');
select is(pg_temp.tpl('a_admin', 't2', p_body => 'Two variables {{1}} and {{2}} are not allowed here'), 'ERR:22023', 'D: ...or has a second variable');
select is(pg_temp.tpl('a_admin', 't2', p_body => 'There is no variable in this template at all'), 'ERR:22023', 'D: ...or none');
select is(pg_temp.tpl('a_admin', 't2', 'Bad Name'), 'ERR:22023', 'D: a name is lower-case letters, digits and underscores');
select is(pg_temp.tpl('a_admin', 't2', p_lang => 'fr'), 'ERR:22023', 'D: only our five languages');
select is(pg_temp.tpl('a_admin', 't2', p_purpose => 'marketing'), 'ERR:22023', 'D: only the four purposes');
select is(pg_temp.tpl('a_admin', 't2'), 'ERR:23505', 'D: the same name in the same language is one template (23505)');
select is(pg_temp.j(pg_temp.tpl('a_admin', 't2', p_lang => 'te', p_body => 'మా షాప్ నుండి వార్త: {{1}} ఆపడానికి STOP అని పంపండి.'), 'language'), 'te', 'D: the same name in another language is another template');
create function pg_temp.tst(p_user text, p_id text, p_status text) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.wa_template_set_status(%L, %L, %L)$q$, tests.tid('a'), tests.rid(p_id), p_status)) $$;
select is(pg_temp.tst('a_admin', 't1', 'approved'), 'ERR:SM621', 'D: a draft goes to review before it can be approved (SM621)');
select is(pg_temp.j(pg_temp.tst('a_admin', 't1', 'submitted'), 'status'), 'submitted', 'D: submitted');
select is(pg_temp.tpl('a_admin', 't1', p_body => 'Changed words {{1}} are not allowed now.'), 'ERR:SM621', 'D: a template under review is not edited');
select is(pg_temp.tst('a_sales', 't1', 'approved'), 'ERR:42501', 'D: Sales cannot set the status');
select is(pg_temp.tst('a_admin', 't1', 'draft'), 'ERR:22023', 'D: ...and no one sets it back to draft');
select is(pg_temp.tst('b_owner', 't1', 'approved'), 'ERR:42501', 'D: another business cannot');
select is(pg_temp.j(pg_temp.tst('a_admin', 't1', 'approved'), 'status'), 'approved', 'D: approved (what Meta decided)');
select is(jsonb_array_length(pg_temp.sc('a_owner', format('select public.wa_template_list(%L)', tests.tid('a')))::jsonb), 2, 'D: the Owner lists the business''s templates');
select is(pg_temp.sc('a_sales', format('select public.wa_template_list(%L)', tests.tid('a'))), 'ERR:42501', 'D: Sales cannot');
select is(jsonb_array_length(pg_temp.sc('b_owner', format('select public.wa_template_list(%L)', tests.tid('b'))) ::jsonb), 0, 'D: another business sees none of them');

-- ---------------------------------------------------------------------------------------------
-- E. inbound messages
-- ---------------------------------------------------------------------------------------------
create temp table br_first as select pg_temp.inb('wamid.A1', '0091234567801', 'Do you have kanjivaram sarees?')::jsonb as r;
select is((select r ->> 'outcome' from br_first), 'stored', 'E: a first message from a new number is stored');
select is((select (r ->> 'new_contact')::boolean from br_first), true, 'E: ...it made a contact');
select is((select phone from public.contacts where id = (select (r ->> 'contact_id')::uuid from br_first)), '+0091234567801', 'E: the number is kept in the form WhatsApp gave it, with a plus');
select is((select full_name from public.contacts where id = (select (r ->> 'contact_id')::uuid from br_first)), 'Ravi Kumar', 'E: named from the WhatsApp profile');
select is((select co.name like 'WhatsApp customer %' and co.name !~* 'ravi' from public.contacts c join public.companies co on co.id = c.company_id where c.id = (select (r ->> 'contact_id')::uuid from br_first)), true, 'E: with a generic company named after nothing personal (a lead needs one; the profile name stays on the contact)');
select is((select whatsapp_consent::text from public.contacts where id = (select (r ->> 'contact_id')::uuid from br_first)), 'granted', 'E: the customer''s first message is their opt-in');
select is((select count(*) from public.consent_events where contact_id = (select (r ->> 'contact_id')::uuid from br_first) and event_type = 'granted' and channel = 'whatsapp' and evidence_ref like 'whatsapp:in#%'), 1::bigint, 'E: ...with a ledger row naming the message (a hash, not the text)');
select is((select body from public.enquiries where id = (select (r ->> 'enquiry_id')::uuid from br_first)), 'Do you have kanjivaram sarees?', 'E: the message is an enquiry on WhatsApp');
select is((select channel::text from public.enquiries where id = (select (r ->> 'enquiry_id')::uuid from br_first)), 'whatsapp', 'E: ...channel whatsapp');
select is((select source from public.leads where id = (select (r ->> 'lead_id')::uuid from br_first)), 'whatsapp', 'E: a lead was made for it, sourced whatsapp');
select is((select count(*) from suppression.contact_keys where contact_id = (select (r ->> 'contact_id')::uuid from br_first) and phone_hmac = pg_temp.h('0091234567801')), 1::bigint, 'E: the number''s suppression key is on record');
select is(pg_temp.inb('wamid.A1', '0091234567801', 'Do you have kanjivaram sarees?')::jsonb ->> 'outcome', 'duplicate', 'E: the same message again (Meta retries) changes nothing');
select is((select count(*) from public.enquiries where tenant_id = tests.tid('a') and channel = 'whatsapp'), 1::bigint, 'E: ...one enquiry');
select is(pg_temp.inb('wamid.A2', '0091234567801', 'And the price?', 'Ravi K')::jsonb ->> 'new_contact', 'false', 'E: a second message from the same number finds the same contact');
select is((select count(*) from public.contacts where tenant_id = tests.tid('a') and phone = '+0091234567801'), 1::bigint, 'E: ...one contact');
select is((select count(*) from public.leads where tenant_id = tests.tid('a') and contact_id = (select (r ->> 'contact_id')::uuid from br_first)), 1::bigint, 'E: ...one lead');
select is((select full_name from public.contacts where id = (select (r ->> 'contact_id')::uuid from br_first)), 'Ravi Kumar', 'E: a changed WhatsApp profile name does not rename the contact');
select is(pg_temp.inb('wamid.A3', '0091234567802', null, null, 'image')::jsonb ->> 'outcome', 'stored', 'E: a photo from a customer is stored (as "[image]")');
select is((select e.body from public.enquiries e join public.contacts c on c.id = e.contact_id where c.phone = '+0091234567802'), '[image]', 'E: ...the enquiry reads [image]; the photo itself is not downloaded');
select is((select full_name from public.contacts where phone = '+0091234567802'), 'WhatsApp 7802', 'E: no profile name: "WhatsApp" and the last four digits');
select is(pg_temp.inb('wamid.A4', '0091234567803', E'a​b')::jsonb ->> 'outcome', 'stored', 'E: a text with an invisible character is still stored');
select is((select e.body from public.enquiries e join public.contacts c on c.id = e.contact_id where c.phone = '+0091234567803'), '[message not shown]', 'E: ...but not shown (the database refuses unclean text; the API removes such characters first)');
-- an existing contact is found by the number whatever its stored form
insert into public.contacts (id, tenant_id, full_name, phone) values (tests.rid('e_old'), tests.tid('a'), 'Old Customer', '+00 9123 4567 804');
select is(pg_temp.inb('wamid.A5', '0091234567804')::jsonb ->> 'new_contact', 'false', 'E: a contact written "+00 9123 4567 804" is found by the number 0091234567804');
select is((select count(*) from suppression.contact_keys where contact_id = tests.rid('e_old')), 1::bigint, 'E: ...and a contact that had no key gets its key now');
select is((select count(*) from public.leads where contact_id = tests.rid('e_old')), 1::bigint, 'E: ...and a lead');
-- the other business is never touched
select is(pg_temp.inb('wamid.B1', '0091234567805', p_pni => '999999999999')::jsonb ->> 'outcome', 'unknown_account', 'E: a number id nobody set up: nothing stored');
select is((select count(*) from public.contacts where phone = '+0091234567805'), 0::bigint, 'E: ...no contact');
select is(pg_temp.j(pg_temp.save('b_owner', 'b', '100000000000077', p_ref => 'shop_b', p_waba => '200000000000002'), 'status'), 'pending', 'E: business B sets up its own number');
select is(pg_temp.sc('b_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('b')))::jsonb ->> 'status', 'active', 'E: ...and switches it on');
select is(pg_temp.inb('wamid.B2', '0091234567801', 'Hello from B', p_pni => '100000000000077')::jsonb ->> 'new_contact', 'true', 'E: the same number writing to B is a different contact there');
select is((select count(*) from public.contacts where phone = '+0091234567801'), 2::bigint, 'E: ...one in each business');
select is((select count(*) from public.enquiries where tenant_id = tests.tid('b') and channel = 'whatsapp'), 1::bigint, 'E: B''s enquiry is B''s');
-- invalid input
select is(pg_temp.inb('wamid.X1', '12345'), 'ERR:22023', 'E: a number that is too short is invalid');
select is(pg_temp.inb('wamid.X2', '00912345678a1'), 'ERR:22023', 'E: ...or has a letter');
select is(pg_temp.ch(format($q$select public.wa_ingest_inbound('100000000000001', 'wamid.X3', '0091234567806', 'n', 'text', 't', now(), 'not-hex', 1, false)$q$)), 'ERR:22023', 'E: a malformed suppression key is invalid');
select is(pg_temp.ch(format($q$select public.wa_ingest_inbound('100000000000001', 'wamid.X4', '0091234567806', 'n', 'text', %L, now(), %L, 1, false)$q$, repeat('x', 4097), pg_temp.h('x'))), 'ERR:22023', 'E: a text over 4,096 characters is invalid');
-- STOP
select is(pg_temp.inb('wamid.S1', '0091234567801', 'STOP', p_optout => true)::jsonb ->> 'optout', 'true', 'E: a STOP message is stored and suppresses');
select is((select suppression_reason::text || '/' || whatsapp_consent::text from public.contacts where id = (select (r ->> 'contact_id')::uuid from br_first)), 'opted_out/withdrawn', 'E: the contact is opted out and the WhatsApp consent withdrawn');
select is((select count(*) from public.consent_events where contact_id = (select (r ->> 'contact_id')::uuid from br_first) and event_type in ('suppressed', 'withdrawn')), 2::bigint, 'E: ...two ledger rows (suppressed, withdrawn)');
select is(pg_temp.inb('wamid.S1', '0091234567801', 'STOP', p_optout => true)::jsonb ->> 'outcome', 'duplicate', 'E: the same STOP again is a duplicate');
select is(pg_temp.inb('wamid.S2', '0091234567801', 'Actually yes, send me the catalogue')::jsonb ->> 'new_contact', 'false', 'E: a later message from a stopped number is still kept');
select is((select suppression_reason::text || '/' || whatsapp_consent::text from public.contacts where id = (select (r ->> 'contact_id')::uuid from br_first)), 'opted_out/withdrawn', 'E: ...but it does not re-grant consent (the Owner lifts a suppression, not a message)');
select is((select count(*) from public.consent_events where contact_id = (select (r ->> 'contact_id')::uuid from br_first) and event_type = 'granted'), 1::bigint, 'E: ...no second grant');
-- a number that is already on the suppression list arrives as a NEW contact: created flagged
select app.suppression_key_add(tests.tid('a'), 'phone', pg_temp.h('0091234567810'), 1::smallint, 'opted_out', null, null);
select is(pg_temp.inb('wamid.F1', '0091234567810', 'Hi again')::jsonb ->> 'flagged', 'true', 'E: a number on the suppression list is created flagged');
select is((select suppressed_at is not null and whatsapp_consent::text = 'unknown' from public.contacts where phone = '+0091234567810'), true, 'E: ...suppressed, and never granted consent');
-- the real-data gate: a real number is refused while it is closed
select is(pg_temp.inb('wamid.G1', '919876543299')::jsonb ->> 'outcome', 'gate_closed', 'E: a real number while the real-data gate is closed: nothing stored');
select is((select count(*) from public.contacts where phone = '+919876543299'), 0::bigint, 'E: ...no contact');
select is((select count(*) from integrations.wa_events where external_id = 'wamid.G1'), 0::bigint, 'E: ...and the event is not marked handled, so it is accepted when the gate opens');
select tests.open_gate('a');
select is(pg_temp.inb('wamid.G1', '919876543299', 'Hello')::jsonb ->> 'outcome', 'stored', 'E: with the gate open the same event is stored');
select is((select phone from public.contacts where phone = '+919876543299'), '+919876543299', 'E: ...as +91 and ten digits');
select is(pg_temp.inb('wamid.G2', '919876543299')::jsonb ->> 'new_contact', 'false', 'E: and found again by the number');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'whatsapp.inbound'), 10::bigint, 'E: every stored message is audited');
select is((select bool_and(new_values::text !~* '(kanjivaram|98765|91234|Ravi)') from public.audit_events where action = 'whatsapp.inbound'), true, 'E: ...with no text, number or name');

-- ---------------------------------------------------------------------------------------------
-- F. the 24-hour window and the claim
-- ---------------------------------------------------------------------------------------------
select app.operator_register_scheduler('x5@test.local');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a')));
-- a customer who wrote just now (pinned 14:00 IST on the 5th): a lead with consent and a key
select pg_temp.pin('2026-10-05T14:00:00+05:30');
create temp table br_w as select pg_temp.inb('wamid.W1', '0091234567820', 'Can I visit tomorrow?')::jsonb as r;
create function pg_temp.sub(p_msg text, p_lead uuid, p_text text, p_cat text) returns text language sql as $$
  select pg_temp.sc('a_owner', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', %L, 'en', %L, 'owner')$q$, tests.rid(p_msg), tests.tid('a'), p_lead, p_text, p_cat)) $$;
select is(pg_temp.j(pg_temp.sub('m1', (select (r ->> 'lead_id')::uuid from br_w), 'Yes, we are open tomorrow from ten.', 'reply_to_inbound'), 'reason'), 'auto_allowed', 'F: a reply inside the window to a customer who opted in goes by itself (the policy is the outbox''s, as before)');
create temp table br_c1 as select pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')))::jsonb as r;
select is((select jsonb_array_length(r) from br_c1), 1, 'F: the worker claims it');
select is((select r -> 0 -> 'wa' ->> 'phone_number_id' from br_c1), '100000000000001', 'F: the claim names the number to send from');
select is((select r -> 0 -> 'wa' ->> 'window_open' from br_c1), 'true', 'F: ...says the window is open');
select is((select r -> 0 ->> 'attempts' from br_c1), '1', 'F: ...and the attempt number');
select is((select r -> 0 -> 'wa' ->> 'token_ref' from br_c1), 'shop_a', 'F: ...and the NAME of the secret (never the token)');
select is((select r -> 0 -> 'wa' -> 'template' from br_c1), 'null'::jsonb, 'F: a reply needs no template');
-- the claim lapses and is offered again: attempts 2
select pg_temp.pin('2026-10-05T14:03:00+05:30');
select is((select pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')))::jsonb -> 0 ->> 'attempts'), '2', 'F: a claim that lapsed is offered again with attempts 2');
-- the window closes after 24 hours: a follow-up needs the approved template of its kind and language
select pg_temp.pin('2026-10-06T15:30:00+05:30');
select is(pg_temp.j(pg_temp.sub('m2', (select (r ->> 'lead_id')::uuid from br_w), 'We have new silk sarees this week.', 'followup'), 'reason'), 'auto_allowed', 'F: a follow-up without a price is allowed by the policy');
create temp table br_c2 as select pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')))::jsonb as r;
select is((select jsonb_array_length(r) from br_c2), 2, 'F: the worker claims it (and the first message again, still unmarked)');
select is((select x -> 'wa' ->> 'window_open' from br_c2, jsonb_array_elements(r) x where x ->> 'id' = tests.rid('m2')::text), 'false', 'F: the window is closed 25 hours after the customer''s message');
select is((select x -> 'wa' -> 'template' ->> 'name' from br_c2, jsonb_array_elements(r) x where x ->> 'id' = tests.rid('m2')::text), 'shop_update', 'F: the approved template of the kind "followup" in English is named');
select is((select x -> 'wa' -> 'template' ->> 'language' from br_c2, jsonb_array_elements(r) x where x ->> 'id' = tests.rid('m2')::text), 'en', 'F: ...with its language');
select is(pg_temp.j(pg_temp.sub('m3', (select (r ->> 'lead_id')::uuid from br_w), 'Your order is on its way.', 'order_status'), 'status'), 'queued', 'F: an order-status message');
select pg_temp.pin('2026-10-06T15:34:00+05:30');
select is((select x -> 'wa' -> 'template' from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')))::jsonb) x where x ->> 'id' = tests.rid('m3')::text), 'null'::jsonb, 'F: no approved template for its kind: none is named (the adapter will refuse with template_required)');
select pg_temp.tst('a_admin', 't2', 'submitted');
select pg_temp.tst('a_admin', 't2', 'approved');
select pg_temp.pin('2026-10-06T15:38:00+05:30');
select is((select x -> 'wa' -> 'template' from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')))::jsonb) x where x ->> 'id' = tests.rid('m2')::text) ->> 'language', 'en', 'F: an approved template in ANOTHER language (te) is not used for an English message');
select is(pg_temp.tst('a_admin', 't1', 'paused')::jsonb ->> 'status', 'paused', 'F: Meta pauses the template');
select pg_temp.pin('2026-10-06T15:42:00+05:30');
select is((select x -> 'wa' -> 'template' from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')))::jsonb) x where x ->> 'id' = tests.rid('m2')::text), 'null'::jsonb, 'F: a paused template is never named');
select pg_temp.tst('a_admin', 't1', 'approved');
select pg_temp.pin('2026-10-06T15:46:00+05:30');
-- a business with no active number: no context (the fake adapter does not need one)
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'disabled')$q$, tests.tid('a')));
select is((select x -> 'wa' from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')))::jsonb) x where x ->> 'id' = tests.rid('m2')::text), 'null'::jsonb, 'F: with the number disabled the claim carries no WhatsApp context');
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));

-- ---------------------------------------------------------------------------------------------
-- G. marking, with the real adapter and the new closed failure codes
-- ---------------------------------------------------------------------------------------------
create function pg_temp.mark(p_msg text, p_outcome text, p_adapter text, p_id text default null, p_code text default null) returns text language sql as $$
  select pg_temp.sch(format($q$select public.scheduler_mark(%L, %L, %L, %L, %L, %L)$q$, tests.tid('a'), tests.rid(p_msg), p_outcome, p_adapter, p_id, p_code)) $$;
select is(pg_temp.j(pg_temp.mark('m1', 'sent', 'whatsapp', 'wamid.OUT1'), 'status'), 'sent', 'G: the worker marks a message sent by the whatsapp adapter');
select is((select adapter || '/' || adapter_message_id from public.outbox_messages where id = tests.rid('m1')), 'whatsapp/wamid.OUT1', 'G: the adapter and the WhatsApp message id are kept');
select is(pg_temp.mark('m2', 'sent', 'carrier_pigeon', 'x'), 'ERR:22023', 'G: an unknown adapter is invalid');
select is(pg_temp.mark('m2', 'failed', 'whatsapp', null, 'banana'), 'ERR:22023', 'G: an unknown failure code is invalid');
select is(pg_temp.j(pg_temp.mark('m2', 'failed', 'whatsapp', null, 'template_required'), 'status'), 'failed', 'G: template_required is a failure code');
select is((select failure_code from public.outbox_messages where id = tests.rid('m2')), 'template_required', 'G: ...kept');
select is(pg_temp.j(pg_temp.mark('m3', 'failed', 'whatsapp', null, 'window_closed'), 'status'), 'failed', 'G: so is window_closed');
select is((select count(*) from unnest(array['recipient_unreachable', 'rate_limited', 'not_configured', 'rejected', 'timeout', 'adapter_error']) c where exists (select 1 from pg_constraint where conname = 'outbox_messages_failure_code_check' and pg_get_constraintdef(oid) like '%' || c || '%')), 6::bigint, 'G: the other closed codes are in the list');

-- ---------------------------------------------------------------------------------------------
-- H. delivery statuses
-- ---------------------------------------------------------------------------------------------
select pg_temp.pin('2026-10-06T15:40:00+05:30');
select is(pg_temp.sta('wamid.OUT1', 'read')::jsonb ->> 'outcome', 'recorded', 'H: a "read" status is recorded');
select is(pg_temp.sta('wamid.OUT1', 'delivered')::jsonb ->> 'outcome', 'recorded', 'H: ...a late "delivered" after it');
select is((select status from integrations.wa_message_status where message_id = tests.rid('m1')), 'read', 'H: the furthest step wins when statuses arrive out of order');
select is((select delivered_at is not null and read_at is not null from integrations.wa_message_status where message_id = tests.rid('m1')), true, 'H: ...and both times are kept');
select is(pg_temp.sta('wamid.OUT1', 'read')::jsonb ->> 'outcome', 'duplicate', 'H: the same status again is a duplicate');
select is((select string_agg(kind, ',' order by seq) from public.outbox_events where message_id = tests.rid('m1') and kind in ('delivered', 'read')), 'read,delivered', 'H: each step is an event of the message');
select is((select actor_kind from public.outbox_events where message_id = tests.rid('m1') and kind = 'read'), 'system', 'H: ...by the system');
select is(pg_temp.sta('wamid.NOPE', 'delivered')::jsonb ->> 'outcome', 'unknown_message', 'H: a status for a message we never sent is ignored');
select is(pg_temp.sta('wamid.OUT1', 'delivered', p_pni => '100000000000077')::jsonb ->> 'outcome', 'unknown_message', 'H: ...and another business''s number cannot touch our message');
select is(pg_temp.sta('wamid.OUT1', 'failed', 131047)::jsonb ->> 'outcome', 'recorded', 'H: a failure status (131047) is recorded');
select is((select status || '/' || error_word || '/' || error_code from integrations.wa_message_status where message_id = tests.rid('m1')), 'failed/window_closed/131047', 'H: failed wins over a good step, with its closed error word');
select is((select reason from public.outbox_events where message_id = tests.rid('m1') and kind = 'delivery_failed'), 'window_closed', 'H: ...and the event carries the word, not a number');
select is((select status from public.outbox_messages where id = tests.rid('m1')), 'sent', 'H: the outbox row stays "sent" (a closed state); the delivery failure is a step');
select is(pg_temp.sta('wamid.OUT1', 'sent')::jsonb ->> 'outcome', 'recorded', 'H: a "sent" status is recorded without an event');
select is(pg_temp.sta('wamid.OUT1', 'exploded'), 'ERR:22023', 'H: an unknown status is invalid');
-- the lost answer: a message still claimed is recorded as SENT when its status arrives carrying our message id
select pg_temp.pin('2026-10-06T16:00:00+05:30');
select pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')));
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a')));
select pg_temp.sub('m4', (select (r ->> 'lead_id')::uuid from br_w), 'We have a new catalogue for you.', 'info');
select is((select status from public.outbox_messages where id = tests.rid('m4')), 'queued', 'H: a new message is queued');
select pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')));
select is((select claimed_at is not null from public.outbox_messages where id = tests.rid('m4')), true, 'H: the worker claimed it and (pretend) lost the answer');
select is(pg_temp.sta('wamid.LOST4', 'sent', null, tests.rid('m4')::text || ':1')::jsonb ->> 'outcome', 'recorded', 'H: the status carries the message id as callback data (with a photo number after it)');
select is((select status || '/' || adapter || '/' || adapter_message_id from public.outbox_messages where id = tests.rid('m4')), 'sent/whatsapp/wamid.LOST4', 'H: the message is now recorded as sent, so its lapsed claim cannot send it again');
select is((select count(*) from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_claim_due(%L, 10)', tests.tid('a')))::jsonb) x where x ->> 'id' = tests.rid('m4')::text), 0::bigint, 'H: ...and it is no longer offered');
select is(pg_temp.sta('wamid.OTHER', 'sent', null, tests.rid('m1')::text)::jsonb ->> 'outcome', 'unknown_message', 'H: a callback id of a message that was sent as something else changes nothing');

-- ---------------------------------------------------------------------------------------------
-- I. conversations
-- ---------------------------------------------------------------------------------------------
select pg_temp.pin(pg_temp.base() + interval '40 days');
create function pg_temp.cl(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.conversation_list(%L, 50)', tests.tid(p_tenant))) $$;
select is(pg_temp.cl('a_viewer'), 'ERR:42501', 'I: a Viewer cannot read the inbox');
select is(pg_temp.cl('b_owner', 'a'), 'ERR:42501', 'I: another business''s Owner cannot');
select is(pg_temp.cl('x6'), 'ERR:42501', 'I: nor the channel account');
select is(jsonb_array_length(pg_temp.cl('a_sales')::jsonb) >= 4, true, 'I: Sales read the inbox: one row per customer who wrote');
select is((select x ->> 'name' from jsonb_array_elements(pg_temp.cl('a_owner')::jsonb) x where x ->> 'lead_id' = (select r ->> 'lead_id' from br_first)), 'Ravi Kumar', 'I: a row names the customer');
select is((select (x ->> 'stopped')::boolean from jsonb_array_elements(pg_temp.cl('a_owner')::jsonb) x where x ->> 'lead_id' = (select r ->> 'lead_id' from br_first)), true, 'I: ...and says that they asked us to stop');
select is((select (x ->> 'unread')::boolean from jsonb_array_elements(pg_temp.cl('a_owner')::jsonb) x where x ->> 'lead_id' = (select r ->> 'lead_id' from br_w)), true, 'I: a conversation with a message not yet looked at is unread');
select is((select (x ->> 'window_open')::boolean from jsonb_array_elements(pg_temp.cl('a_owner')::jsonb) x where x ->> 'lead_id' = (select r ->> 'lead_id' from br_w)), false, 'I: ...and its window closed long ago');
select is(pg_temp.sc('a_viewer', format('select public.conversation_mark_read(%L, %L)', tests.tid('a'), (select (r ->> 'lead_id')::uuid from br_w))), 'ERR:42501', 'I: a Viewer cannot mark one read');
select is(pg_temp.sc('a_sales', format('select public.conversation_mark_read(%L, %L)', tests.tid('a'), (select (r ->> 'lead_id')::uuid from br_w))), '', 'I: Sales mark it read');
select is((select (x ->> 'unread')::boolean from jsonb_array_elements(pg_temp.cl('a_owner')::jsonb) x where x ->> 'lead_id' = (select r ->> 'lead_id' from br_w)), false, 'I: it is read now');
select is(pg_temp.sc('a_sales', format('select public.conversation_mark_read(%L, %L)', tests.tid('a'), (select (r ->> 'lead_id')::uuid from br_first))), '', 'I: (and the other)');
create temp table br_t as select pg_temp.sc('a_owner', format('select public.conversation_thread(%L, %L, 50)', tests.tid('a'), (select (r ->> 'lead_id')::uuid from br_w)))::jsonb as r;
select is((select jsonb_array_length(r -> 'items') from br_t), 5, 'I: the thread holds what the customer wrote (1) and what we sent or tried to (4)');
select is((select r -> 'items' -> 0 ->> 'direction' from br_t), 'out', 'I: newest first');
select is((select string_agg(x ->> 'direction', '' order by x ->> 'at') from br_t, jsonb_array_elements(r -> 'items') x), 'inoutoutoutout', 'I: in time order: the customer first, then our four messages');
select is((select x ->> 'delivery' from br_t, jsonb_array_elements(r -> 'items') x where x ->> 'id' = tests.rid('m1')::text), 'failed', 'I: an outgoing message carries its delivery state');
select is((select x ->> 'delivery_error' from br_t, jsonb_array_elements(r -> 'items') x where x ->> 'id' = tests.rid('m1')::text), 'window_closed', 'I: ...and its closed error word');
select is((select x ->> 'failure_code' from br_t, jsonb_array_elements(r -> 'items') x where x ->> 'id' = tests.rid('m2')::text), 'template_required', 'I: a message the channel refused shows why');
select is((select (r ->> 'window_open')::boolean from br_t), false, 'I: the thread says the window is closed');
select is(pg_temp.sc('b_owner', format('select public.conversation_thread(%L, %L, 50)', tests.tid('b'), (select (r ->> 'lead_id')::uuid from br_w))), 'ERR:23503', 'I: another business cannot read our thread by guessing the lead id (23503)');
select is(pg_temp.sc('a_owner', format('select public.conversation_thread(%L, %L, 0)', tests.tid('a'), (select (r ->> 'lead_id')::uuid from br_w))), 'ERR:22023', 'I: a page size of 0 is invalid');
select is(jsonb_array_length(pg_temp.sc('a_owner', format('select public.conversation_thread(%L, %L, 2)', tests.tid('a'), (select (r ->> 'lead_id')::uuid from br_w)))::jsonb -> 'items'), 2, 'I: a thread is paged');

-- ---------------------------------------------------------------------------------------------
-- J. erasure still works for a contact made by WhatsApp
-- ---------------------------------------------------------------------------------------------
create temp table br_e as select pg_temp.inb('wamid.E1', '0091234567830', 'Hello, I am Lakshmi on 0091234567830')::jsonb as r;
select is(pg_temp.sc('a_owner', format($q$select public.request_erasure(%L, %L, 'contact', %L)$q$, tests.rid('er1'), tests.tid('a'), (select (r ->> 'contact_id')::uuid from br_e))) like 'ERR:%', false, 'J: an erasure of the WhatsApp contact can be requested');
select is(pg_temp.sc('a_owner', format('select public.execute_erasure(%L, false)', tests.rid('er1'))) like 'ERR:%', false, 'J: ...and executed');
select is((select phone is null and erased_at is not null from public.contacts where id = (select (r ->> 'contact_id')::uuid from br_e)), true, 'J: the number is gone from the contact');
select is((select body from public.enquiries where id = (select (r ->> 'enquiry_id')::uuid from br_e)) like '%0091234567830%', false, 'J: ...and the number in the customer''s message was swept');
select is((select count(*) from suppression.key_events where tenant_id = tests.tid('a') and kind = 'phone' and key_hmac = pg_temp.h('0091234567830') and event = 'suppressed'), 1::bigint, 'J: the number''s key is suppressed (the erased person is recognised if they write again)');
select is(pg_temp.inb('wamid.E2', '0091234567830', 'Hello again')::jsonb ->> 'flagged', 'true', 'J: ...and when they write again the new contact is created flagged');

select * from finish();
rollback;
