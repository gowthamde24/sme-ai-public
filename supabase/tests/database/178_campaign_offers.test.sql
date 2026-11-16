-- Campaigns S2 (migration 20261231979500; owner decisions 15-16 Nov 2026): the campaign kind `offer`. A fixed approved MARKETING template with structured values, sent only to customers who said yes to marketing,
-- at most `weekly_cap` times in 7 days, never as free text, with the approval's counts of who is in and who is left out and why.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');

create function pg_temp.pin(p_instant text) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant);
end $fn$;
select pg_temp.pin('2026-11-01T11:00:00+05:30');

create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.sqlstate_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  return r;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
-- a person: contact + lead + (optionally) a suppression key and the WhatsApp consent
create function pg_temp.mk(p_label text, p_name text, p_phone text, p_key boolean default true, p_consent boolean default true) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), p_name, p_phone);
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label || '_l'), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label));
  if p_key then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
  end if;
  if p_consent then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:cp')$q$, tests.tid('a'), tests.rid(p_label)));
  end if;
end $$;
create function pg_temp.add(p_camp text, p_rows jsonb) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.campaign_recipients_add(%L, %L, %L::jsonb)->>'added')$q$, tests.tid('a'), tests.rid(p_camp), p_rows::text))
$$;
create function pg_temp.approve(p_camp text) returns text language sql as $$
  select pg_temp.try('a_owner', format($q$select public.campaign_approve(%L, %L, (public.campaign_preview(%L, %L)->>'samples_sha256'))$q$, tests.tid('a'), tests.rid(p_camp), tests.tid('a'), tests.rid(p_camp)))
$$;
-- the worker: every call is made as the registered principal (the unaffiliated fixture user "outsider")
create function pg_temp.sch(p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid('outsider'), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
-- one pass: 'queued/held/blocked/skipped/errors'
create function pg_temp.run(p_tenant text default 'a', p_limit int default 50) returns text language sql as $$
  select coalesce((select (j->>'queued') || '/' || (j->>'held') || '/' || (j->>'blocked') || '/' || (j->>'skipped') || '/' || (j->>'errors') from (select pg_temp.sch(format('select public.scheduler_campaign_run(%L, %s)::text', tests.tid(p_tenant), p_limit))::jsonb j) x where 1 = 1), 'x')
$$;

create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.row(p_contact text, p_due text) returns jsonb language sql as $$ select jsonb_build_object('contact_id', tests.rid(p_contact), 'due_date', p_due) $$;
create function pg_temp.osave(p_id text, p_text text, p_tpl text, p_name text default 'Diwali offer') returns text language sql as $$
  select pg_temp.try('a_owner', format($q$select public.campaign_save(%L, %L, %L, 'offer', 'en', %L, %L, '[{"offset_days": 0, "time": "11:00"}]'::jsonb, null, 24)$q$, tests.rid(p_id), tests.tid('a'), p_name, tests.rid(p_tpl), p_text))
$$;
create function pg_temp.oset(p_id text, p_label text, p_cap int default 1) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select public.campaign_offer_set(%L, %L, %L, %s)::text$q$, tests.tid('a'), tests.rid(p_id), p_label, p_cap))
$$;
create function pg_temp.issues(p_id text) returns text language sql as $$ select coalesce(array_to_string(app.campaign_issues(tests.tid('a'), tests.rid(p_id)), ','), '') $$;
create function pg_temp.mc(p_contact text, p_how text) returns text language sql as $$
  select pg_temp.val('a_owner', case p_how when 'yes' then format($q$select public.marketing_consent_set(%L, %L, 'said yes in shop')::text$q$, tests.tid('a'), tests.rid(p_contact))
                                            else format($q$select public.marketing_consent_withdraw(%L, %L)::text$q$, tests.tid('a'), tests.rid(p_contact)) end) $$;
create function pg_temp.sst(p_camp text, p_contact text) returns text language sql as $$
  select coalesce((select s.status || coalesce('/' || s.reason, '') from public.campaign_steps s join public.campaign_recipients r on r.id = s.recipient_id where s.campaign_id = tests.rid(p_camp) and r.contact_id = tests.rid(p_contact) and s.step_no = 1), 'none')
$$;
create function pg_temp.msgof(p_camp text, p_contact text) returns uuid language sql as $$
  select s.outbox_message_id from public.campaign_steps s join public.campaign_recipients r on r.id = s.recipient_id where s.campaign_id = tests.rid(p_camp) and r.contact_id = tests.rid(p_contact) and s.step_no = 1
$$;

select pg_temp.pin('2026-11-12T10:00:00+05:30');   -- a Thursday
insert into integrations.whatsapp_accounts (tenant_id, waba_id, phone_number_id, display_phone, token_ref, status)
select tests.tid('a'), '200000000000001', '100000000000001', '+91 98765 43210', 'shop_a', 'active' where not exists (select 1 from integrations.whatsapp_accounts where tenant_id = tests.tid('a'));
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, opt_out_label, status) values
  (tests.rid('tpl_offer'), tests.tid('a'), 'new_collection_offer', 'en', 'marketing', 'offer', 'Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'Stop promotions', 'approved'),
  (tests.rid('tpl_draft'), tests.tid('a'), 'festival_offer', 'en', 'marketing', 'offer', 'Hello {{1}}, {{2}} wishes you a happy {{3}}! Our festive collection is ready. Visit us or reply here.', 'Stop promotions', 'draft'),
  (tests.rid('tpl_rem'), tests.tid('a'), 'dues_reminder', 'en', 'utility', 'reminder', 'Hello, a reminder from the shop: {{1}} Thank you.', null, 'approved');

-- the people: Ravi said yes to marketing, Sita did not say anything, Anil said yes and later no, Latha said yes and then STOP, Mohan said yes but has no WhatsApp consent
select pg_temp.mk('o1', 'Ravi Kumar', '+00 90002 00001');
select pg_temp.mk('o2', 'Sita Devi', '+00 90002 00002');
select pg_temp.mk('o3', 'Anil Rao', '+00 90002 00003');
select pg_temp.mk('o4', 'Latha Kumari', '+00 90002 00004');
select pg_temp.mk('o5', 'Mohan', '+00 90002 00005', true, false);
select is(pg_temp.j(pg_temp.mc('o1', 'yes'), 'state'), 'granted', 'S1 (setup) Ravi said yes to marketing');
select is(pg_temp.j(pg_temp.mc('o3', 'yes'), 'state'), 'granted', 'S2 (setup) Anil said yes ...');
select is(pg_temp.j(pg_temp.mc('o3', 'no'), 'state'), 'withdrawn', 'S3 (setup) ... and later no');
select is(pg_temp.j(pg_temp.mc('o4', 'yes'), 'state'), 'granted', 'S4 (setup) Latha said yes ...');
select is(pg_temp.try('a_owner', format($$select public.suppress_contact(%L, %L, 'opted_out')$$, tests.tid('a'), tests.rid('o4'))), 'ok', 'S5 (setup) ... then STOP');
select is(pg_temp.j(pg_temp.mc('o5', 'yes'), 'state'), 'granted', 'S6 (setup) Mohan said yes to marketing');

-- A. the campaign and what blocks it
select is(pg_temp.osave('c1', 'Hello {{name}}, {{business}} has new arrivals: {{label}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'tpl_offer'), 'ok', 'A1 an offer campaign is saved (kind offer needs the campaigns module only)');
select is(pg_temp.add('c1', jsonb_build_array(pg_temp.row('o1', '2026-11-12'), pg_temp.row('o2', '2026-11-12'), pg_temp.row('o3', '2026-11-12'), pg_temp.row('o4', '2026-11-12'), pg_temp.row('o5', '2026-11-12'))), '5', 'A2 five people are added (an amount is not allowed on an offer)');
select is(pg_temp.issues('c1'), 'offer_label', 'A3 without a label it cannot be approved');
select ok(pg_temp.oset('c1', '50% off') like 'ERR:%', 'A5 a label with a price or discount is refused');
select ok(pg_temp.oset('c1', 'www.shop.in') like 'ERR:%', 'A6 ... or a link');
select ok(pg_temp.oset('c1', 'Silk sarees', 4) like 'ERR:%', 'A7 a cap above 3 a week is refused');
select is(pg_temp.j(pg_temp.j(pg_temp.oset('c1', '  Silk   sarees '), 'campaign'), 'offer_label'), 'Silk sarees', 'A8 the label is tidied and kept');
select is(pg_temp.issues('c1'), '', 'A9 nothing blocks it now');
select is(pg_temp.osave('c2', 'Hello {{name}}, we have something new for you: {{label}}. Come and see. Reply STOP to unsubscribe.', 'tpl_offer'), 'ok', 'A10 another offer whose words are not the template''s ...');
select is((select 'text_not_template' = any (app.campaign_issues(tests.tid('a'), tests.rid('c2')))), true, 'A11 ... is told so (the words that go out are the approved template''s)');
select is(pg_temp.osave('c3', 'Hello {{name}}, {{business}} wishes you a happy {{label}}! Our festive collection is ready. Visit us or reply here.', 'tpl_draft'), 'ok', 'A12 an offer on a draft template ...');
select is((select 'template_not_approved' = any (app.campaign_issues(tests.tid('a'), tests.rid('c3')))), true, 'A13 ... waits for Meta''s yes');
select is(pg_temp.osave('c4', 'Hello {{name}}, a reminder from the shop: {{label}} Thank you.', 'tpl_rem'), 'ok', 'A14 an offer on a reminder template ...');
select is((select 'template_purpose' = any (app.campaign_issues(tests.tid('a'), tests.rid('c4')))), true, 'A15 ... is refused (an offer template is needed)');
select is(pg_temp.osave('c5', 'Hello {{name}}, {{amount}} for {{label}}. Reply STOP to unsubscribe.', 'tpl_offer'), 'ok', 'A16 an amount in an offer ...');
select is((select 'amount_not_allowed' = any (app.campaign_issues(tests.tid('a'), tests.rid('c5')))), true, 'A17 ... is refused');

-- B. who is in, who is left out, and why (the approval screen)
create temp table pv as select (pg_temp.val('a_owner', format($q$select public.campaign_preview(%L, %L)::text$q$, tests.tid('a'), tests.rid('c1'))))::jsonb as r;
select is((select r -> 'offer' ->> 'will_receive' from pv), '2', 'B1 two customers are counted as receiving it (Ravi and Mohan)');
select is((select r -> 'offer' -> 'left_out' ->> 'stopped' from pv), '1', 'B2 one is left out because they said STOP');
select is((select r -> 'offer' -> 'left_out' ->> 'marketing_withdrawn' from pv), '1', 'B3 one because they withdrew marketing');
select is((select r -> 'offer' -> 'left_out' ->> 'no_marketing_consent' from pv), '1', 'B4 one because they never said yes to marketing');
select is((select jsonb_array_length(r -> 'samples') from pv) > 0, true, 'B6 the approval shows samples');
select is((select r -> 'samples' -> 0 ->> 'body' from pv), 'Hello Ravi, ' || (select name from public.tenants where id = tests.tid('a')) || ' has new arrivals: Silk sarees. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'B7 a sample is exactly what goes out: the first name, the business, the label');

-- C. approval, then the run
select is(pg_temp.approve('c1'), 'ok', 'C1 the Owner approves it (second factor)');
select is(app.operator_register_scheduler('Outsider@test.local'), tests.uid('outsider'), 'C2 (setup) the worker account');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.try('a_owner', format($$select public.outbox_set_settings(%L, true, 3)$$, tests.tid('a'))), 'ok', 'C3 (setup) automatic sending on');
select pg_temp.pin('2026-11-12T11:30:00+05:30');
select is(pg_temp.run(), '1/0/1/3/0', 'C4 11:30: one queued (Ravi), one blocked by the outbox''s own rule (Mohan has no WhatsApp consent), three skipped by the offer checks');
select is(pg_temp.sst('c1', 'o1'), 'submitted', 'C5 Ravi (said yes) gets it');
select is(pg_temp.sst('c1', 'o5') || ' ' || (select status || '/' || reason from public.outbox_messages where id = pg_temp.msgof('c1', 'o5')), 'submitted blocked/no_opt_in', 'C6 Mohan said yes to marketing but never agreed to WhatsApp: the outbox blocks it (marketing consent adds a rule, it never removes one)');
select is(pg_temp.sst('c1', 'o2'), 'skipped/no_marketing_consent', 'C7 Sita, who never said yes to marketing, is skipped and counted');
select is(pg_temp.sst('c1', 'o3'), 'skipped/no_marketing_consent', 'C8 Anil, who withdrew, is skipped');
select is(pg_temp.sst('c1', 'o4'), 'skipped/no_marketing_consent', 'C9 Latha, whose STOP withdrew marketing, is skipped');
select is((select status from public.outbox_messages where id = pg_temp.msgof('c1', 'o1')), 'queued', 'C10 Ravi''s message is queued in the outbox as an ordinary message');
select is((select category from public.outbox_messages where id = pg_temp.msgof('c1', 'o1')), 'campaign_reminder', 'C11 ... of the campaign category');

-- D. what the sender is told: the template, three values, never free text
create function pg_temp.ctx(p_msg uuid, p_at text) returns jsonb language sql as $$ select app.wa_send_context((select m from public.outbox_messages m where m.id = p_msg), p_at::timestamptz) $$;
select is(pg_temp.ctx(pg_temp.msgof('c1', 'o1'), '2026-11-12T12:00:00+05:30') -> 'template' ->> 'name', 'new_collection_offer', 'D1 the message is sent as the approved template');
select is((pg_temp.ctx(pg_temp.msgof('c1', 'o1'), '2026-11-12T12:00:00+05:30') -> 'template' -> 'variables') ->> 2, 'Silk sarees', 'D2 its third value is the campaign''s label');
select is((pg_temp.ctx(pg_temp.msgof('c1', 'o1'), '2026-11-12T12:00:00+05:30') -> 'template' -> 'variables') ->> 0, 'Ravi', 'D3 the first is the customer''s first name');
select is(pg_temp.ctx(pg_temp.msgof('c1', 'o1'), '2026-11-12T12:00:00+05:30') -> 'template' ->> 'opt_out', 'true', 'D4 it carries the opt-out button');
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, body_sha256, created_via)
values (gen_random_uuid(), tests.tid('a'), tests.rid('o1_l'), 'whatsapp', '2026-11-12T11:45:00+05:30', 'Hello', repeat('b', 64), 'agent');
select is(pg_temp.ctx(pg_temp.msgof('c1', 'o1'), '2026-11-12T12:00:00+05:30') ->> 'window_open', 'false', 'D5 even when the customer wrote an hour ago, an offer goes as the template, never as free text');

-- E. the weekly cap
select is(pg_temp.osave('d1', 'Hello {{name}}, {{business}} has new arrivals: {{label}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'tpl_offer', 'Second offer'), 'ok', 'E1 (setup) a second offer, two days later');
select is(pg_temp.j(pg_temp.j(pg_temp.oset('d1', 'Cotton sarees'), 'campaign'), 'weekly_cap'), '1', 'E2 the cap is 1 a week by default');
select is(pg_temp.add('d1', jsonb_build_array(pg_temp.row('o1', '2026-11-14'))), '1', 'E3 (setup) Ravi again');
select is(pg_temp.approve('d1'), 'ok', 'E4 (setup) approved');
select pg_temp.pin('2026-11-14T11:30:00+05:30');
select is(pg_temp.run(), '0/0/0/1/0', 'E5 two days later nothing is sent: Ravi already had an offer this week');
select is(pg_temp.sst('d1', 'o1'), 'skipped/frequency_cap', 'E6 the step says why');
select is(pg_temp.osave('d2', 'Hello {{name}}, {{business}} has new arrivals: {{label}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'tpl_offer', 'Third offer'), 'ok', 'E7 (setup) a third offer with the cap raised to 2');
select is(pg_temp.j(pg_temp.j(pg_temp.oset('d2', 'Linen sarees', 2), 'campaign'), 'weekly_cap'), '2', 'E8 two a week is allowed');
select is(pg_temp.add('d2', jsonb_build_array(pg_temp.row('o1', '2026-11-15'))), '1', 'E9 (setup) Ravi again, on the 15th');
select is(pg_temp.approve('d2'), 'ok', 'E10 (setup) approved');
select pg_temp.pin('2026-11-15T11:30:00+05:30');
select is(pg_temp.run(), '1/0/0/0/0', 'E11 with a cap of two he gets the second one (he had one on the 12th)');
select pg_temp.pin('2026-11-23T10:00:00+05:30');
select is(pg_temp.osave('d3', 'Hello {{name}}, {{business}} has new arrivals: {{label}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'tpl_offer', 'Fourth offer'), 'ok', 'E12 (setup) a fourth offer a week later');
select is(pg_temp.j(pg_temp.j(pg_temp.oset('d3', 'Kids wear'), 'campaign'), 'offer_label'), 'Kids wear', 'E13 (setup) label');
select is(pg_temp.add('d3', jsonb_build_array(pg_temp.row('o1', '2026-11-23'))), '1', 'E14 (setup) Ravi once more');
select is(pg_temp.approve('d3'), 'ok', 'E15 (setup) approved');
select pg_temp.pin('2026-11-23T11:30:00+05:30');
select is(pg_temp.run(), '1/0/0/0/0', 'E16 more than seven days after his last offer: it goes');

-- F. changing the label or the cap of an approved campaign sends it back to draft; nothing edits it behind the approval's back
select is(pg_temp.osave('f1', 'Hello {{name}}, {{business}} has new arrivals: {{label}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'tpl_offer', 'Fifth offer'), 'ok', 'F1 (setup) another offer');
select is(pg_temp.j(pg_temp.j(pg_temp.oset('f1', 'Wedding silks'), 'campaign'), 'offer_label'), 'Wedding silks', 'F2 (setup) its label');
select is(pg_temp.add('f1', jsonb_build_array(pg_temp.row('o1', '2026-11-30'))), '1', 'F3 (setup) Ravi');
select is(pg_temp.approve('f1'), 'ok', 'F4 (setup) approved');
select is(pg_temp.try('a_owner', format($$update public.campaigns set offer_label = 'Other' where id = %L$$, tests.rid('f1'))), '42501', 'F5 nobody edits the label of an approved offer behind the approval''s back');
select is(pg_temp.try('a_owner', format($$update public.campaigns set weekly_cap = 3 where id = %L$$, tests.rid('f1'))), '42501', 'F6 nor its cap');
select is(pg_temp.j(pg_temp.oset('f1', 'Bridal silks'), 'back_to_draft'), 'true', 'F7 through the function, a new label sends it back to draft: it must be approved again');
select is((select status from public.campaigns where id = tests.rid('f1')), 'draft', 'F8 ... as a draft');
select is(pg_temp.j(pg_temp.oset('f1', 'Bridal silks'), 'back_to_draft'), 'false', 'F9 saving the same words again changes nothing');
select is(pg_temp.try('a_sales', format($q$select public.campaign_offer_set(%L, %L, 'Bridal silks', 1)$q$, tests.tid('a'), tests.rid('f1'))), 'ok', 'F10 Sales may set it (as they may save a campaign)');
select is(pg_temp.try('a_viewer', format($q$select public.campaign_offer_set(%L, %L, 'Bridal silks', 1)$q$, tests.tid('a'), tests.rid('f1'))), '42501', 'F11 a viewer may not');
select is(pg_temp.try('b_owner', format($q$select public.campaign_offer_set(%L, %L, 'Bridal silks', 1)$q$, tests.tid('a'), tests.rid('f1'))), '42501', 'F12 nor another business');

-- G. whatever suppresses a customer withdraws marketing consent too
select is(pg_temp.j(pg_temp.mc('o2', 'yes'), 'state'), 'granted', 'G1 (setup) Sita now says yes');
select is(pg_temp.try('a_owner', format($$select public.suppress_contact(%L, %L, 'opted_out')$$, tests.tid('a'), tests.rid('o2'))), 'ok', 'G2 the staff stop messaging her');
select is((select marketing_consent || '/' || marketing_consent_via from public.contacts where id = tests.rid('o2')), 'withdrawn/stop_reply', 'G3 her marketing consent is withdrawn as well, whichever route stopped her');

select * from finish();
rollback;
