-- Campaigns S2a (migration 20261231978000; owner decisions 16 Nov 2026): the {{3}} label rule, marketing templates with the opt-out button, what the sender is told about the button,
-- and the tap on "Stop promotions" (marketing consent withdrawn, nothing else, in the same transaction as the message).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.ch(p_sql text) returns text language sql as $$ select pg_temp.sc('x6', p_sql) $$;
select app.operator_register_channel_agent('x6@test.local');

-- A. the {{3}} label
select is(app.offer_label_problem('Silk sarees'), null, 'A1 a collection is fine');
select is(app.offer_label_problem('Diwali'), null, 'A2 an occasion is fine');
select is(app.offer_label_problem('దీపావళి'), null, 'A3 a Telugu word is fine');
select is(app.offer_label_problem('Silk'), null, 'A4 four letters are fine');
select is(app.offer_label_problem('A'), 'length', 'A5 one character is too short');
select is(app.offer_label_problem(repeat('a', 31)), 'length', 'A6 31 characters are too long');
select is(app.offer_label_problem(repeat('a', 30)), null, 'A7 30 characters fit');
select is(app.offer_label_problem(' Diwali'), 'length', 'A8 no space at the start');
select is(app.offer_label_problem(null), 'length', 'A9 nothing is not a label');
select is(app.offer_label_problem(E'Silk\nsarees'), 'text', 'A10 a new line is refused');
select is(app.offer_label_problem('Silk  sarees'), 'text', 'A11 a run of spaces is refused');
select is(app.offer_label_problem('www.shop.in'), 'link', 'A12 a link is refused');
select is(app.offer_label_problem('https://x.in'), 'link', 'A13 ... with its scheme');
select is(app.offer_label_problem('shop.com'), 'link', 'A14 ... a bare domain');
select is(app.offer_label_problem('call@me'), 'link', 'A15 ... an address');
select is(app.offer_label_problem('Sarees ₹999'), 'price', 'A16 a rupee sign with digits is a price');
select is(app.offer_label_problem('Sarees Rs 999'), 'price', 'A17 Rs with digits is a price');
select is(app.offer_label_problem('Rs.500 sarees'), 'price', 'A18 Rs. with digits is a price');
select is(app.offer_label_problem('999 rupees'), 'price', 'A19 digits and rupees is a price');
select is(app.offer_label_problem('50% sarees'), 'price', 'A20 digits next to % is a price');
select is(app.offer_label_problem('percent'), 'price', 'A21 the word percent is refused');
select is(app.offer_label_problem('50 off'), 'discount', 'A22 "off" is a discount');
select is(app.offer_label_problem('Flat 20 OFF'), 'discount', 'A23 ... in capitals');
select is(app.offer_label_problem('Big discount'), 'discount', 'A24 "discount" is refused');
select is(app.offer_label_problem('Cashback sarees'), 'discount', 'A25 "cashback" is refused');
select is(app.offer_label_problem('తగ్గింపు'), 'discount', 'A26 the Telugu word for a discount is refused');
select is(app.offer_label_problem('छूट साड़ी'), 'discount', 'A27 ... the Hindi');
select is(app.offer_label_problem('Office wear'), null, 'A28 "off" inside a word is fine');
select is(app.offer_label_problem('Silk 5 sarees'), null, 'A29 a number that is not next to a price mark is fine');

-- B. marketing templates: the third variable, the purpose, the button
create function pg_temp.tpl(p_user text, p_id text, p_name text, p_purpose text, p_body text, p_button text default null, p_category text default 'marketing', p_lang text default 'en') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.wa_template_save(%L, %L, %L, %L, %L, %L, %L, %L)$q$, tests.rid(p_id), tests.tid('a'), p_name, p_lang, p_category, p_purpose, p_body, p_button)) $$;
select is(pg_temp.j(pg_temp.tpl('a_owner', 't1', 'new_collection_offer', 'offer', 'Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'Stop promotions'), 'opt_out_label'), 'Stop promotions', 'B1 an offer template with its button is saved (three variables)');
select is(pg_temp.j(pg_temp.tpl('a_owner', 't1', 'new_collection_offer', 'offer', 'Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'Stop promotions'), 'status'), 'draft', 'B2 ... as a draft');
select is(pg_temp.tpl('a_owner', 't2', 'offer_no_button', 'offer', 'Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here.'), 'ERR:22023', 'B3 an offer without the opt-out button is refused');
select is(pg_temp.tpl('a_owner', 't2', 'offer_utility', 'offer', 'Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here.', 'Stop promotions', 'utility'), 'ERR:22023', 'B4 an offer is a marketing template, never utility');
select is(pg_temp.tpl('a_owner', 't2', 'offer_long_button', 'offer', 'Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here.', 'Stop all the promotions now'), 'ERR:22023', 'B5 the button words fit Meta''s 25 characters');
select is(pg_temp.tpl('a_owner', 't2', 'offer_four', 'offer', 'Hello {{1}}, {{2}} {{3}} and {{4}} here for you to read.', 'Stop promotions'), 'ERR:22023', 'B6 no fourth variable');
select is(pg_temp.tpl('a_owner', 't2', 'offer_gap', 'offer', 'Hello {{1}}, here is {{3}} for you from our whole team.', 'Stop promotions'), 'ERR:22023', 'B7 {{3}} comes with {{2}}');
select is(pg_temp.tpl('a_owner', 't2', 'offer_end', 'offer', 'Hello {{1}}, {{2}} has new arrivals for you: {{3}}', 'Stop promotions'), 'ERR:22023', 'B8 a variable is never the last word');
select is(pg_temp.tpl('a_owner', 't2', 'offer_side', 'offer', 'Hello {{1}}, {{2}} has {{3}}{{3}} new arrivals for you today.', 'Stop promotions'), 'ERR:22023', 'B9 never two variables side by side');
select is(pg_temp.j(pg_temp.tpl('a_owner', 't3', 'plain_note', 'info', 'Hello {{1}}, this is {{2}} with a short note for you.', null, 'utility'), 'opt_out_label'), null, 'B10 a template without a button has no button words');
select is(pg_temp.tpl('a_sales', 't2', 'sales_try', 'offer', 'Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here.', 'Stop promotions'), 'ERR:42501', 'B11 Sales cannot make a template');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'wa_template_save'), 1::bigint, 'B12 there is one wa_template_save (the old signature is gone)');

-- C. what the sender is told: a template with a button says so
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'submitted')$q$, tests.tid('a'), tests.rid('t1')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'approved')$q$, tests.tid('a'), tests.rid('t1')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_save(%L, %L, 'info_with_button', 'en', 'marketing', 'info', 'Hello {{1}}, this is {{2}} with a short note for you.', 'Stop promotions')$q$, tests.rid('t4'), tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'submitted')$q$, tests.tid('a'), tests.rid('t4')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'approved')$q$, tests.tid('a'), tests.rid('t4')));
create function pg_temp.ctx(p_category text) returns jsonb language sql as $$
  select app.wa_send_context(jsonb_populate_record(null::public.outbox_messages, jsonb_build_object('id', gen_random_uuid(), 'tenant_id', tests.tid('a'), 'lead_id', tests.rid('a_lead'), 'contact_id', tests.rid('a_contact'), 'category', p_category, 'language', 'en')), now()) $$;
select is(pg_temp.ctx('info') -> 'template' ->> 'opt_out', 'true', 'C1 the message of a template with a button is sent with the button');
select is(pg_temp.ctx('info') -> 'template' ->> 'name', 'info_with_button', 'C2 ... and names the template');
select is(jsonb_array_length(pg_temp.ctx('info') -> 'template' -> 'variables'), 2, 'C3 ... with the same two structured values as before');
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'disabled')$q$, tests.tid('a'), tests.rid('t4')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_save(%L, %L, 'info_plain', 'en', 'utility', 'info', 'Hello {{1}}, this is {{2}} with a short note for you.')$q$, tests.rid('t5'), tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'submitted')$q$, tests.tid('a'), tests.rid('t5')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'approved')$q$, tests.tid('a'), tests.rid('t5')));
select is(pg_temp.ctx('info') -> 'template' ->> 'opt_out', null, 'C4 a template without a button does not say so');

-- D. a tap on "Stop promotions"
create function pg_temp.inb(p_wamid text, p_from text, p_kind text, p_text text, p_optout boolean default false) returns text language sql as $$
  select pg_temp.ch(format($q$select public.wa_ingest_inbound('100000000000001', %L, %L, 'Ravi Kumar', %L, %L, now(), %L, 1, %L)$q$, p_wamid, p_from, p_kind, p_text, pg_temp.h(p_from), p_optout)) $$;
create temp table mt_first as select pg_temp.inb('wamid.M1', '0091234567811', 'text', 'Do you have silk sarees?')::jsonb as r;
select is((select r ->> 'outcome' from mt_first), 'stored', 'D1 the customer writes first');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.marketing_consent_set(%L, %L, 'said yes in shop')$q$, tests.tid('a'), (select r ->> 'contact_id' from mt_first))), 'state'), 'granted', 'D2 the owner records marketing consent');
select is(pg_temp.inb('wamid.M2', '0091234567811', 'button_marketing_stop', 'Stop promotions')::jsonb ->> 'outcome', 'stored', 'D3 the tap is stored as a message');
select is((select marketing_consent from public.contacts where id = (select (r ->> 'contact_id')::uuid from mt_first)), 'withdrawn', 'D4 marketing consent is withdrawn');
select is((select marketing_consent_via from public.contacts where id = (select (r ->> 'contact_id')::uuid from mt_first)), 'stop_button', 'D5 ... by the button');
select is((select marketing_consent_note from public.contacts where id = (select (r ->> 'contact_id')::uuid from mt_first)), null, 'D6 ... and the note is gone');
select is((select suppressed_at is null and whatsapp_consent = 'granted' from public.contacts where id = (select (r ->> 'contact_id')::uuid from mt_first)), true, 'D7 service messages are NOT stopped: the contact is not suppressed and keeps its WhatsApp consent');
select is((select count(*) from public.enquiries where tenant_id = tests.tid('a') and lead_id = (select (r ->> 'lead_id')::uuid from mt_first) and body = 'Stop promotions'), 1::bigint, 'D8 the message is kept with its words');
select ok((select count(*) from public.audit_events where entity_type = 'contact' and entity_id = (select (r ->> 'contact_id')::uuid from mt_first) and new_values ->> 'marketing_consent' = 'withdrawn') >= 1, 'D9 the withdrawal is in the audit trail');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'whatsapp.inbound' and new_values ->> 'kind' = 'button_marketing_stop') >= 1, 'D10 ... and the message says it was the button');
select is(pg_temp.inb('wamid.M2', '0091234567811', 'button_marketing_stop', 'Stop promotions')::jsonb ->> 'outcome', 'duplicate', 'D11 Meta sending the tap twice changes nothing');
select is(pg_temp.inb('wamid.M3', '0091234567812', 'button_marketing_stop', 'Stop promotions')::jsonb ->> 'outcome', 'stored', 'D12 a tap from someone with no marketing consent is just a message');
select is((select marketing_consent from public.contacts where tenant_id = tests.tid('a') and phone = '+0091234567812' or tenant_id = tests.tid('a') and app.phone_norm(phone) = app.phone_norm('+0091234567812') limit 1), 'unknown', 'D13 ... and consent stays unknown (a tap never grants anything)');
select is(pg_temp.inb('wamid.M4', '0091234567811', 'text', 'STOP', true)::jsonb ->> 'flagged', 'true', 'D14 typing STOP still stops everything');
select is((select marketing_consent_via from public.contacts where id = (select (r ->> 'contact_id')::uuid from mt_first)), 'stop_button', 'D15 ... and the first withdrawal is not rewritten');

select * from finish();
rollback;
