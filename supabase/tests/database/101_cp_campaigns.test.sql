-- Job CP (ADR 0086), part 2: REMINDER CAMPAIGNS. The draft, the text and its merge fields, the list (import, and from the ledger), the samples, the Owner's approval (the money rule), going back to draft on any change,
-- pause / resume / cancel, the module gates, and the guards.
--   A modules and roles    B the text and the steps    C the list by import    D the list from the ledger    E preview and samples    F the approval    G any change returns to draft    H pause, resume, cancel    I guards and RLS
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');

-- the outbox clock is pinned: Tuesday 20 Oct 2026, 11:00 India time
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-20T11:00:00+05:30'::timestamptz);

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
create function pg_temp.vala(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
-- a contact with a number, a lead, and (when asked) a key and consent
create function pg_temp.mk(p_label text, p_name text, p_phone text) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), p_name, p_phone);
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label || '_l'), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label));
end $$;

-- the approved reminder template of business a (a draft one, and an approved one in another language)
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) values
  (tests.rid('tpl'), tests.tid('a'), 'dues_reminder', 'en', 'utility', 'reminder', 'Hello, a reminder from the shop: {{1}} Thank you.', 'approved'),
  (tests.rid('tpl_draft'), tests.tid('a'), 'dues_draft', 'en', 'utility', 'reminder', 'Hello, a reminder from the shop: {{1}} Thank you.', 'draft'),
  (tests.rid('tpl_hi'), tests.tid('a'), 'dues_hi', 'hi', 'utility', 'reminder', 'Hello, a reminder from the shop: {{1}} Thank you.', 'approved'),
  (tests.rid('tpl_visit'), tests.tid('a'), 'visit_x', 'en', 'utility', 'visit', 'Hello, a visit note from the shop: {{1}} Thank you.', 'approved');

create function pg_temp.save(p_user text, p_id text, p_kind text, p_text text, p_steps text default '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]',
                             p_tpl text default 'tpl', p_lang text default 'en', p_call int default null, p_tenant text default 'a', p_name text default 'Dues reminder') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.campaign_save(%L, %L, %L, %L, %L, %L, %L, %L::jsonb, %s, 24)$q$, tests.rid(p_id), tests.tid(p_tenant), p_name, p_kind, p_lang,
                                    case when p_tpl is null then null else tests.rid(p_tpl) end, p_text, p_steps, coalesce(p_call::text, 'null')))
$$;
create function pg_temp.status(p_id text) returns text language sql as $$ select status from public.campaigns where id = tests.rid(p_id) $$;
create function pg_temp.add(p_user text, p_camp text, p_rows jsonb) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.campaign_recipients_add(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid(p_camp), p_rows::text))
$$;
create function pg_temp.issues(p_camp text) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select coalesce((select string_agg(i, ',' order by i) from jsonb_array_elements_text(public.campaign_get(%L, %L)->'issues') i), 'none')$q$, tests.tid('a'), tests.rid(p_camp)))
$$;
create function pg_temp.prev(p_camp text, p_key text) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.campaign_preview(%L, %L) ->> %L)$q$, tests.tid('a'), tests.rid(p_camp), p_key))
$$;
create function pg_temp.approve(p_user text, p_camp text, p_sha text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.at(p_aal, p_user, format($q$select public.campaign_approve(%L, %L, %L)$q$, tests.tid('a'), tests.rid(p_camp), p_sha))
$$;

-- people: seven contacts, with names and amounts that make the samples predictable
select pg_temp.mk('r1', 'Ravi', '+00 90001 00001');
select pg_temp.mk('r2', 'Sita Devi', '+00 90001 00002');
select pg_temp.mk('r3', 'Anil', '+00 90001 00003');
select pg_temp.mk('r4', 'Latha Kumari', '+00 90001 00004');
select pg_temp.mk('r5', 'Mohan', '+00 90001 00005');
select pg_temp.mk('r6', 'Prasad', '+00 90001 00006');
select pg_temp.mk('r7', 'Venkata Satyanarayana Murthy Reddy', '+00 90001 00007');
select pg_temp.mk('r8', 'Geeta', '+00 90001 00008');

-- ============================================================================ A. modules and roles
select is(pg_temp.save('a_owner', 'c1', 'payment_due', 'Dear {{name}}, payment of {{amount}} for {{reference}} is due on {{due_date}}. Thank you, {{business}}.'), 'ok', 'A1 ALLOW: the Owner makes a payment-due campaign (construction: dues)');
select is(pg_temp.save('a_sales', 'c2', 'delivery_update', 'Dear {{name}}, your delivery is planned for {{due_date}}. Thank you, {{business}}.', p_name => 'Delivery note'), 'ok', 'A2 ALLOW: Sales makes a delivery-update campaign (construction: deliveries) ...');
select is(pg_temp.save('a_owner', 'c3', 'fee_due', 'Dear {{name}}, the fee of {{amount}} is due on {{due_date}}.'), 'SM701', 'A3 ... but a FEE campaign is not for a building-materials business (module fees is off: SM701)');
select is(pg_temp.save('a_owner', 'c3', 'event', 'Dear {{name}}, the annual day is on {{due_date}}. Thank you.'), 'SM701', 'A4 ... nor an event, an exam or a holiday (programmes is off)');
select is(pg_temp.save('a_admin', 'c4', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.'), 'ok', 'A5 ALLOW: the Admin');
select is(pg_temp.save('a_viewer', 'c5', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.'), '42501', 'A6 DENY: a Viewer');
select is(pg_temp.save('b_owner', 'c5', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', p_tenant => 'b'), 'SM701', 'A7 textiles: campaigns are not on (SM701)');
select is(pg_temp.save('anon', 'c5', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.'), '42501', 'A8 DENY: anon');
select is(pg_temp.save('b_owner', 'c1', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', p_tenant => 'b'), 'SM701', 'A9 another business cannot take over an id (its module is off first)');
select is(pg_temp.val('b_owner', format($q$select public.campaigns_list(%L)::text$q$, tests.tid('b'))), 'ERR:SM701', 'A10 textiles: nor the list');
select is(pg_temp.val('b_owner', format($q$select public.campaign_get(%L, %L)::text$q$, tests.tid('b'), tests.rid('c1'))), 'ERR:SM701', 'A11 nor a read');
select is(pg_temp.val('a_viewer', format($q$select public.campaigns_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A12 DENY: a Viewer reads no campaign');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.campaigns_list(%L))::text$q$, tests.tid('a'))), '3', 'A13 Sales read the three');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.campaigns_list(%L, 'draft', 2))::text$q$, tests.tid('a'))), '2', 'A14 the list is paged and can be narrowed to a status');
select is(pg_temp.save('a_owner', 'c1', 'delivery_update', 'Dear {{name}}, your delivery is planned for {{due_date}}.'), '23505', 'A15 the kind of a campaign does not change (same id, another kind: conflict)');
select is(pg_temp.save('a_owner', 'c6', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', p_tpl => 'tpl', p_tenant => 'a', p_name => repeat('x', 101)), '22023', 'A16 a name over 100 characters is invalid');
select is(pg_temp.try('a_owner', format($q$select public.campaign_save(%L, %L, 'x', 'payment_due', 'en', %L, 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, null, 24)$q$,
                              tests.rid('c6'), tests.tid('a'), gen_random_uuid())), '23503', 'A17 a template that is not this business''s is not found');

-- ============================================================================ B. the text and the steps
select is(pg_temp.save('a_owner', 'c7', 'payment_due', 'x', '[]'), '22023', 'B1 no steps: invalid');
select is(pg_temp.save('a_owner', 'c7', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}, {"offset_days": 1, "time": "10:00"}, {"offset_days": 2, "time": "10:00"}, {"offset_days": 3, "time": "10:00"}, {"offset_days": 4, "time": "10:00"}, {"offset_days": 5, "time": "10:00"}]'), '22023', 'B2 more than five steps: invalid');
select is(pg_temp.save('a_owner', 'c7', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}]'), '22023', 'B3 steps must be in order');
select is(pg_temp.save('a_owner', 'c7', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}]'), '22023', 'B4 ... strictly (the same moment twice is invalid)');
select is(pg_temp.save('a_owner', 'c7', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}, {"offset_days": 0, "time": "15:30"}]'), 'ok', 'B5 two steps on the same day at different times are fine');
select is(pg_temp.save('a_owner', 'c8', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "25:00"}]'), '22023', 'B6 a time that is not a time is invalid');
select is(pg_temp.save('a_owner', 'c8', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 400, "time": "10:00"}]'), '22023', 'B7 an offset beyond 180 days is invalid');
select is(pg_temp.save('a_owner', 'c8', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00", "text": "Pay now"}]'), '22023', 'B8 a step holds only its offset and its time (no text of its own)');
select is(pg_temp.save('a_owner', 'c8', 'payment_due', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}]', p_call => 2), 'ok', 'B9 a call plan is saved ...');
select is(pg_temp.issues('c8'), 'call_plan_invalid,no_recipients', 'B10 ... but step 2 does not exist: that is an issue, not an error, in a draft');
select is(pg_temp.save('a_owner', 'c9', 'delivery_update', 'Dear {{name}}, your delivery is planned for {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}]', p_call => 1), 'ok', 'B11 a call plan on a delivery update is saved ...');
select is(pg_temp.issues('c9'), 'call_plan_invalid,no_recipients', 'B12 ... and is an issue (the call list is for money reminders)');
-- the text: only the five merge fields, a fixed shape, no links, no line breaks, no promise or complaint words
select is(pg_temp.save('a_owner', 'c10', 'payment_due', 'Dear {{name}}, you owe {{balance}} on {{due_date}}.'), 'ok', 'B13 an unknown merge field is saved in a draft ...');
select is(pg_temp.issues('c10'), 'bad_field,no_recipients', 'B14 ... and is an issue (bad_field)');
select is(pg_temp.save('a_owner', 'c10', 'payment_due', 'Dear {{name}}, pay {{amount}} at www.example.test by {{due_date}}.'), 'ok', 'B15 a link');
select is(pg_temp.issues('c10'), 'link_not_allowed,no_recipients', 'B16 is an issue');
select is(pg_temp.save('a_owner', 'c10', 'payment_due', E'Dear {{name}},\npay {{amount}} by {{due_date}}.'), 'ok', 'B17 a line break');
select is(pg_temp.issues('c10'), 'line_break,no_recipients', 'B18 is an issue (the template variable carries one line)');
select is(pg_temp.save('a_owner', 'c10', 'payment_due', 'Dear {{name}}, we guarantee delivery after you pay {{amount}} by {{due_date}}.'), 'ok', 'B19 a promise');
select is(pg_temp.issues('c10'), 'no_recipients,text_words', 'B20 is an issue (text_words): a campaign promises nothing');
select is(pg_temp.save('a_owner', 'c10', 'payment_due', 'Dear {{name}}, you are late: pay {{amount}} now, it was due on {{due_date}}.'), 'ok', 'B21 a complaint word ("late")');
select is(pg_temp.issues('c10'), 'no_recipients,text_words', 'B22 is an issue too');
select is(pg_temp.save('a_owner', 'c10', 'delivery_update', 'Dear {{name}}, pay {{amount}} on delivery on {{due_date}}.'), '23505', 'B23 (the kind cannot change, so a new campaign is needed for the next lines)');
select is(pg_temp.save('a_owner', 'c11', 'delivery_update', 'Dear {{name}}, pay {{amount}} on delivery on {{due_date}}.'), 'ok', 'B24 a delivery update with a money slot');
select is(pg_temp.val('a_owner', format($q$select (select string_agg(i, ',' order by i) from jsonb_array_elements_text(public.campaign_get(%L, %L)->'issues') i)$q$, tests.tid('a'), tests.rid('c11'))), 'amount_not_allowed,no_recipients', 'B25 is an issue (a delivery note has no amount)');
select is(pg_temp.save('a_owner', 'c12', 'delivery_update', 'Dear {{name}}, your delivery is planned for {{due_date}}. Free delivery for you.'), 'ok', 'B26 a delivery note that promises something');
select is(pg_temp.val('a_owner', format($q$select (select string_agg(i, ',' order by i) from jsonb_array_elements_text(public.campaign_get(%L, %L)->'issues') i)$q$, tests.tid('a'), tests.rid('c12'))), 'no_recipients,text_words', 'B27 is an issue too');
select is(pg_temp.save('a_owner', 'c13', 'payment_due', 'Dear {{name}}, payment of {{amount}} for {{reference}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "22:00"}]'), 'ok', 'B28 a step at 22:00');
select is(pg_temp.issues('c13'), 'no_recipients,step_in_quiet_hours', 'B29 is inside the quiet hours (21:00 to 09:00): an issue');
select is(pg_temp.save('a_owner', 'c14', 'payment_due', 'Hi'), '22023', 'B30 a text shorter than eight characters is invalid');

-- ============================================================================ C. the list by import
create function pg_temp.addn(p_user text, p_camp text, p_rows jsonb) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (public.campaign_recipients_add(%L, %L, %L::jsonb)->>'added')$q$, tests.tid('a'), tests.rid(p_camp), p_rows::text))
$$;
create function pg_temp.skips(p_user text, p_camp text, p_rows jsonb) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select coalesce((select string_agg((e->>'row') || '=' || (e->>'reason'), ',' order by (e->>'row')::int) from jsonb_array_elements(public.campaign_recipients_add(%L, %L, %L::jsonb)->'skipped') e), 'none')$q$,
                                    tests.tid('a'), tests.rid(p_camp), p_rows::text))
$$;
create function pg_temp.cnt(p_camp text) returns bigint language sql as $$ select count(*) from public.campaign_recipients where campaign_id = tests.rid(p_camp) $$;
select is(pg_temp.save('a_owner', 'm1', 'payment_due', 'Dear {{name}}, payment of {{amount}} for {{reference}} is due on {{due_date}}. Thank you, {{business}}.', p_name => 'October dues'), 'ok', 'C1 the working campaign');
select is(pg_temp.addn('a_sales', 'm1', jsonb_build_array(
  jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-10', 'amount_paise', 500000, 'reference', 'INV-101'),
  jsonb_build_object('phone', '+91 90001 00002', 'due_date', '2026-11-10', 'amount_paise', 250000, 'reference', 'INV-102'),
  jsonb_build_object('contact_id', tests.rid('r3'), 'due_date', '2026-11-12', 'amount_paise', 99900, 'reference', 'INV-103'),
  jsonb_build_object('contact_id', tests.rid('r4'), 'due_date', '2026-11-12', 'amount_paise', 120000, 'reference', 'INV-104'),
  jsonb_build_object('contact_id', tests.rid('r5'), 'due_date', '2026-11-15', 'amount_paise', 9000000, 'reference', 'INV-105'),
  jsonb_build_object('contact_id', tests.rid('r6'), 'due_date', '2026-11-15', 'amount_paise', 310000, 'reference', 'INV-106'),
  jsonb_build_object('contact_id', tests.rid('r7'), 'due_date', '2026-11-18', 'amount_paise', 480000, 'reference', 'INV-107'),
  jsonb_build_object('contact_id', tests.rid('r8'), 'due_date', '2026-11-18', 'amount_paise', 150000, 'reference', 'INV-108'))), '8', 'C2 ALLOW: Sales adds eight people: seven by contact id and one by phone number');
select is(pg_temp.cnt('m1'), 8::bigint, 'C3 eight rows (the number only FINDS the contact; it is not stored anywhere in the campaign)');
select is((select count(*) from public.campaign_recipients where campaign_id = tests.rid('m1') and row_hash ~ '^[0-9a-f]{64}$'), 8::bigint, 'C4 each row has its hash');
select is(pg_temp.skips('a_owner', 'm1', jsonb_build_array(
  jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-10', 'amount_paise', 500000, 'reference', 'INV-101'),
  jsonb_build_object('contact_id', gen_random_uuid(), 'due_date', '2026-11-10', 'amount_paise', 1000, 'reference', 'A'),
  jsonb_build_object('phone', '+91 99999 99999', 'due_date', '2026-11-10', 'amount_paise', 1000, 'reference', 'A'),
  jsonb_build_object('contact_id', tests.rid('b_contact'), 'due_date', '2026-11-10', 'amount_paise', 1000, 'reference', 'A'),
  jsonb_build_object('contact_id', tests.rid('r2'), 'due_date', '2026-11-20', 'reference', 'A'),
  jsonb_build_object('contact_id', tests.rid('r2'), 'due_date', '2026-11-20', 'amount_paise', 1000),
  jsonb_build_object('contact_id', tests.rid('r2'), 'amount_paise', 1000, 'reference', 'A'),
  jsonb_build_object('contact_id', tests.rid('r2'), 'due_date', '2026-11-20', 'amount_paise', 100000001, 'reference', 'A'),
  jsonb_build_object('due_date', '2026-11-20', 'amount_paise', 1000, 'reference', 'A'),
  jsonb_build_object('contact_id', tests.rid('r2'), 'due_date', '2026-11-20', 'amount_paise', 1000, 'reference', 'bad; ref'))),
  '1=duplicate,2=contact_not_found,3=contact_not_found,4=contact_not_found,5=amount_required,6=reference_required,7=invalid_row,8=invalid_row,9=invalid_row,10=invalid_row',
  'C5 each refused row is reported with a closed reason and none is fatal: a repeat, an unknown contact, an unknown number, another business''s contact, no amount, no reference, no date, over the Rs 10 lakh cap, nobody named, a label that is not a label');
select is(pg_temp.cnt('m1'), 8::bigint, 'C6 and nothing but the eight is on the list');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('dup1'), tests.tid('a'), tests.rid('a_company'), 'Twin one', '+00 90002 00001'), (tests.rid('dup2'), tests.tid('a'), tests.rid('a_company'), 'Twin two', '+00 1 90002 00001');
insert into public.contacts (id, tenant_id, full_name, phone) values (tests.rid('nocomp'), tests.tid('a'), 'No company', '+00 90002 00002');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('nolead'), tests.tid('a'), tests.rid('a_company'), 'No lead yet', '+00 90002 00003');
select is(pg_temp.skips('a_owner', 'm1', jsonb_build_array(
  jsonb_build_object('phone', '90002 00001', 'due_date', '2026-11-20', 'amount_paise', 1000, 'reference', 'A'),
  jsonb_build_object('contact_id', tests.rid('nocomp'), 'due_date', '2026-11-20', 'amount_paise', 1000, 'reference', 'A'))),
  '1=ambiguous_contact', 'C7 two contacts with the same ten digits are ambiguous (nobody is guessed); a contact with no company is NOT refused any more (job CR): a generic placeholder company stands in so that they can have a lead');
select is((select company_id is not null from public.contacts where id = tests.rid('nocomp')), true, 'C7b the contact without a company got a placeholder company, which holds no personal data');
select is((select name ~ '^Enquiry [0-9a-f]{6}$' from public.companies where id = (select company_id from public.contacts where id = tests.rid('nocomp'))), true, 'C7c named only "Enquiry" and six characters');
select is(pg_temp.addn('a_owner', 'm1', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('nolead'), 'due_date', '2026-11-20', 'amount_paise', 1000, 'reference', 'INV-109'))), '1', 'C8 a contact of a company with no lead gets one made for the campaign');
select is((select source from public.leads where contact_id = tests.rid('nolead')), 'campaign', 'C9 ... marked as made for a campaign');
select is(pg_temp.cnt('m1'), 10::bigint, 'C10 ten on the list');
select is(pg_temp.add('a_viewer', 'm1', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-10'))), 'ERR:42501', 'C11 DENY: a Viewer');
select is(pg_temp.add('b_owner', 'm1', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-10'))), 'ERR:42501', 'C12 DENY: another business');
select is(pg_temp.val('b_owner', format($q$select public.campaign_recipients_add(%L, %L, '[{"contact_id": null}]'::jsonb)::text$q$, tests.tid('b'), gen_random_uuid())), 'ERR:SM701', 'C12b textiles: not on');
select is(pg_temp.add('a_owner', 'm1', '[]'::jsonb), 'ERR:22023', 'C13 an empty file is invalid');
select is(pg_temp.skips('a_owner', 'c2', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-10', 'amount_paise', 100), jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-11'))), '1=amount_not_allowed', 'C14 a delivery campaign takes no amounts (the row is refused), only dates');
select is(pg_temp.cnt('c2'), 1::bigint, 'C15 and the row without one is added');
select is(pg_temp.skips('a_owner', 'c2', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-11'))), '1=duplicate', 'C16 one row per person and date: a retry adds nothing');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipient_remove(%L, %L, %L)->>'removed')$q$, tests.tid('a'), tests.rid('c2'), (select id from public.campaign_recipients where campaign_id = tests.rid('c2')))), '1', 'C17 a person can be removed');
select is(pg_temp.val('a_owner', format($q$select public.campaign_recipient_remove(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('c2'), gen_random_uuid())), 'ERR:23503', 'C18 one who is not on the list is not found');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.campaign_recipients_list(%L, %L, 5))::text$q$, tests.tid('a'), tests.rid('m1'))), '5', 'C19 the list is read in the order it was made, a page at a time');
select is(pg_temp.val('a_sales', format($q$select (public.campaign_recipients_list(%L, %L, 100) -> 0 ->> 'contact_name') || '/' || (public.campaign_recipients_list(%L, %L, 100) -> 9 ->> 'contact_name')$q$, tests.tid('a'), tests.rid('m1'), tests.tid('a'), tests.rid('m1'))), 'Ravi/No lead yet', 'C20 first and last');
select is(pg_temp.val('a_viewer', format($q$select public.campaign_recipients_list(%L, %L)::text$q$, tests.tid('a'), tests.rid('m1'))), 'ERR:42501', 'C21 DENY: a Viewer');

-- ============================================================================ D. the list from the LEDGER
create function pg_temp.chg(p_id text, p_company uuid, p_contact uuid, p_entry text, p_due text, p_amount bigint, p_inv text default null, p_ref text default null) returns text language sql as $$
  select pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'charge', %L, %L, date %L, %L, date %L, null, %L, %L)$q$, tests.rid(p_id), tests.tid('a'), p_company, p_contact, p_entry, p_amount, p_due, p_inv, p_ref))
$$;
create function pg_temp.fromledger(p_user text, p_camp text, p_filter jsonb) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.campaign_recipients_from_ledger(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid(p_camp), p_filter::text))
$$;
select pg_temp.mk('lc1', 'Fee payer one', '+00 90003 00001');
select pg_temp.mk('lc2', 'Fee payer two', '+00 90003 00002');
select pg_temp.mk('lc3', 'Fee payer three', '+00 90003 00003');
insert into public.contacts (id, tenant_id, company_id, full_name) values (tests.rid('lc4'), tests.tid('a'), tests.rid('a_company'), 'Fee payer four (no number)');
select is(pg_temp.chg('d1', null, tests.rid('lc1'), '2026-09-01', '2026-10-10', 500000, null, 'Fee T1'), 'ok', 'D1 (setup) a fee of Rs 5,000 due 10 Oct for a contact');
select is(pg_temp.chg('d2', null, tests.rid('lc2'), '2026-09-01', '2026-10-25', 300000, null, 'Fee T2'), 'ok', 'D2 (setup) two claims for another: Rs 3,000 due 25 Oct ...');
select is(pg_temp.chg('d3', null, tests.rid('lc2'), '2026-09-02', '2026-10-30', 200000, null, 'Fee T3'), 'ok', 'D3 ... and Rs 2,000 due 30 Oct');
select is(pg_temp.chg('d4', null, tests.rid('lc3'), '2026-09-01', '2026-10-12', 400000, null, 'Fee T4'), 'ok', 'D4 (setup) a fee that is paid in full ...');
select is(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'payment', null, %L, date '2026-09-20', 400000, null, null, null, null, 'upi')$q$, tests.rid('d5'), tests.tid('a'), tests.rid('lc3'))), 'ok', 'D5 ... by a payment');
select is(pg_temp.chg('d6', tests.rid('a_company'), null, '2026-09-15', '2026-10-15', 750000, 'INV-A1'), 'ok', 'D6 (setup) an invoice of the company, Rs 7,500 due 15 Oct');
select is(pg_temp.chg('d7', null, tests.rid('lc4'), '2026-09-01', '2026-10-20', 100000, null, 'Fee T5'), 'ok', 'D7 (setup) a fee for a contact who has no number');
select is(pg_temp.save('a_owner', 'l1', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}. Thank you, {{business}}.', p_name => 'From the ledger'), 'ok', 'D8 a campaign without a reference slot');
select is(pg_temp.fromledger('a_owner', 'l1', jsonb_build_object('due_from', '2026-10-01', 'due_to', '2026-11-30')) :: jsonb ->> 'added', '3', 'D9 the ledger list: the claims due between 1 Oct and 30 Nov that are still open: three people (the paid one is not there)');
select is((select string_agg(case when ct.full_name like 'Fee payer%' then ct.full_name else '#' end || '=' || r.amount_paise || '/' || r.due_date || '/' || coalesce(r.reference, '-'), ' | ' order by r.due_date) from public.campaign_recipients r join public.contacts ct on ct.id = r.contact_id where r.campaign_id = tests.rid('l1')),
          'Fee payer one=500000/2026-10-10/Fee T1 | #=750000/2026-10-15/INV-A1 | Fee payer two=500000/2026-10-25/-', 'D10 one row per account: the OPEN total of its claims in the range (from the ledger, never a model), the earliest due date, the claim''s own label when there is exactly one; a company''s reminder goes to its first contact with a number');
select is((select count(*) from public.campaign_recipients where campaign_id = tests.rid('l1') and account_id is not null), 3::bigint, 'D11 each is tied to its ledger account (so the runner can check it again)');
select is(pg_temp.fromledger('a_owner', 'l1', jsonb_build_object('due_from', '2026-10-01', 'due_to', '2026-11-30')) :: jsonb ->> 'added', '0', 'D12 asking again adds nothing');
select is(pg_temp.val('a_owner', format($q$select (select string_agg((e->>'reason'), ',') from jsonb_array_elements(public.campaign_recipients_from_ledger(%L, %L, %L::jsonb)->'skipped') e)$q$, tests.tid('a'), tests.rid('l1'), jsonb_build_object('due_from', '2026-10-01', 'due_to', '2026-11-30'))), 'duplicate,duplicate,no_contact,duplicate', 'D13 and says so: the three are duplicates, and the fee of the contact with no number has nobody to remind (no_contact)');
select is((select audience_kind || ':' || (audience_filter ->> 'due_to') from public.campaigns where id = tests.rid('l1')), 'filter:2026-11-30', 'D14 the campaign keeps the filter that made its list');
select is(pg_temp.save('a_owner', 'l2', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.', p_name => 'Companies only'), 'ok', 'D15 a second campaign');
select is(pg_temp.fromledger('a_owner', 'l2', jsonb_build_object('due_from', '2026-10-01', 'due_to', '2026-11-30', 'party', 'company')) :: jsonb ->> 'added', '1', 'D16 narrowed to companies');
select is(pg_temp.save('a_owner', 'l3', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.', p_name => 'Large only'), 'ok', 'D17 a third campaign');
select is(pg_temp.fromledger('a_owner', 'l3', jsonb_build_object('due_from', '2026-10-01', 'due_to', '2026-11-30', 'min_open_paise', 600000)) :: jsonb ->> 'added', '1', 'D17b and a smallest amount (Rs 6,000): only the company''s Rs 7,500 qualifies (the two Rs 5,000 parties do not)');
select is(pg_temp.fromledger('a_owner', 'l2', jsonb_build_object('due_from', '2026-11-30', 'due_to', '2026-10-01')), 'ERR:22023', 'D18 a range that ends before it starts is invalid');
select is(pg_temp.fromledger('a_owner', 'l2', jsonb_build_object('due_from', '2025-01-01', 'due_to', '2026-11-30')), 'ERR:22023', 'D19 ... or over 400 days');
select is(pg_temp.fromledger('a_owner', 'l2', jsonb_build_object('due_from', '2026-10-01', 'due_to', '2026-11-30', 'drop_table', 'x')), 'ERR:22023', 'D20 or with a key it does not know');
select is(pg_temp.fromledger('a_owner', 'c2', jsonb_build_object('due_from', '2026-10-01', 'due_to', '2026-11-30')), 'ERR:22023', 'D21 a delivery campaign has no ledger list (it is not about money)');
select is(pg_temp.fromledger('a_viewer', 'l2', jsonb_build_object('due_from', '2026-10-01', 'due_to', '2026-11-30')), 'ERR:42501', 'D22 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.campaign_recipients_from_ledger(%L, %L, '{"due_from": "2026-10-01", "due_to": "2026-11-30"}'::jsonb)::text$q$, tests.tid('b'), gen_random_uuid())), 'ERR:SM701', 'D23 textiles: not on');

-- ============================================================================ E. preview and samples
select is(pg_temp.prev('m1', 'recipients'), '10', 'E1 the preview counts the people');
select is(pg_temp.prev('m1', 'total_amount_paise'), '10911900', 'E2 ... and the total of the amounts, from the list (Rs 1,09,119.00)');
select is(pg_temp.prev('m1', 'first_due') || ' / ' || pg_temp.prev('m1', 'last_due'), '2026-11-10 / 2026-11-20', 'E3 ... the range of dates');
select is(pg_temp.prev('m1', 'disclosure'), 'This message is from the business''s AI assistant.', 'E4 and the AI-disclosure line the outbox adds to a person''s first message');
select is(pg_temp.issues('m1'), 'none', 'E5 nothing stands in the way');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.campaign_preview(%L, %L)->'samples')::text$q$, tests.tid('a'), tests.rid('m1'))), '6', 'E6 six samples: the first, the longest, the highest amount and three at random');
select is(pg_temp.val('a_owner', format($q$select (select e->>'body' from jsonb_array_elements(public.campaign_preview(%L, %L)->'samples') e where e->'labels' ? 'first')$q$, tests.tid('a'), tests.rid('m1'))),
          'Dear Ravi, payment of ₹5,000.00 for INV-101 is due on 10 Nov 2026. Thank you, ' || (select name from public.tenants where id = tests.tid('a')) || '.', 'E7 the FIRST is rendered from its own values (Indian grouping, dd Mon yyyy)');
select is(pg_temp.val('a_owner', format($q$select (select e->>'body' from jsonb_array_elements(public.campaign_preview(%L, %L)->'samples') e where e->'labels' ? 'longest') like 'Dear Venkata Satyanarayana Murthy Reddy,%%'$q$, tests.tid('a'), tests.rid('m1'))), 'true', 'E8 the LONGEST is the one with the longest name');
select is(pg_temp.val('a_owner', format($q$select (select e->>'body' from jsonb_array_elements(public.campaign_preview(%L, %L)->'samples') e where e->'labels' ? 'highest_amount') like 'Dear Mohan, payment of ₹90,000.00%%'$q$, tests.tid('a'), tests.rid('m1'))), 'true', 'E9 the HIGHEST AMOUNT is Rs 90,000');
select is(pg_temp.val('a_owner', format($q$select count(*)::text from jsonb_array_elements(public.campaign_preview(%L, %L)->'samples') e where e->'labels' ? 'random'$q$, tests.tid('a'), tests.rid('m1'))), '3', 'E10 three at random');
select is(pg_temp.val('a_owner', format($q$select count(distinct e->>'recipient_id')::text from jsonb_array_elements(public.campaign_preview(%L, %L)->'samples') e$q$, tests.tid('a'), tests.rid('m1'))), '6', 'E11 and they are six different people');
select is(pg_temp.prev('m1', 'samples_sha256'), pg_temp.prev('m1', 'samples_sha256'), 'E12 the same list shows the same samples (the hash is the same)');
select is(pg_temp.prev('m1', 'content_sha256') ~ '^[0-9a-f]{64}$', true, 'E13 the whole has a hash');
select is(pg_temp.val('a_viewer', format($q$select public.campaign_preview(%L, %L)::text$q$, tests.tid('a'), tests.rid('m1'))), 'ERR:42501', 'E14 DENY: a Viewer');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_preview(%L, %L)->>'recipients')$q$, tests.tid('a'), tests.rid('c4'))), '0', 'E15 a campaign with no list previews as empty');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.campaign_preview(%L, %L)->'samples')::text$q$, tests.tid('a'), tests.rid('c4'))), '0', 'E16 ... with no samples');

-- ============================================================================ F. the approval (the money rule)
create function pg_temp.sha() returns text language sql as $$ select pg_temp.prev('m1', 'samples_sha256') $$;
select is(pg_temp.approve('a_sales', 'm1', pg_temp.sha()), '42501', 'F1 DENY: Sales cannot approve');
select is(pg_temp.approve('a_admin', 'm1', pg_temp.sha()), '42501', 'F2 DENY: nor the Admin: only the Owner approves a campaign');
select is(pg_temp.approve('a_viewer', 'm1', pg_temp.sha()), '42501', 'F3 DENY: nor a Viewer');
select is(pg_temp.approve('b_owner', 'm1', pg_temp.sha()), '42501', 'F4 DENY: nor another business''s Owner');
select is(pg_temp.approve('a_owner', 'm1', pg_temp.sha(), 'aal1'), 'SM306', 'F5 the Owner needs the second factor (SM306)');
select is(pg_temp.approve('a_owner', 'm1', repeat('0', 64)), 'SM802', 'F6 a hash that is not of the samples the Owner saw is stale (SM802)');
select is(pg_temp.approve('a_owner', 'm1', null), 'SM802', 'F7 ... and so is none');
select is(pg_temp.approve('a_owner', 'c4', repeat('0', 64)), 'SM803', 'F8 a campaign with something wrong is not ready (SM803: no list, no template)');
select is(pg_temp.status('m1'), 'draft', 'F9 nothing has changed: still a draft');
select is((select count(*) from public.campaign_steps where campaign_id = tests.rid('m1')), 0::bigint, 'F10 and no step was planned');
select is(pg_temp.approve('a_owner', 'm1', pg_temp.sha()), 'ok', 'F11 ALLOW: the Owner approves the campaign they saw');
select is(pg_temp.status('m1'), 'approved', 'F12 it is approved');
select is((select approved_by = tests.uid('a_owner') and approved_at is not null from public.campaigns where id = tests.rid('m1')), true, 'F13 who and when are recorded');
select is((select approved_recipients || '/' || approved_total_paise from public.campaigns where id = tests.rid('m1')), '10/10911900', 'F14 and what was approved: ten people, Rs 1,09,119.00');
select is((select content_sha256 = app.campaign_content_sha(tenant_id, id) and samples_sha256 ~ '^[0-9a-f]{64}$' from public.campaigns where id = tests.rid('m1')), true, 'F15 and the hash of the whole and of the samples');
select is((select count(*) || '/' || count(*) filter (where status = 'planned') from public.campaign_steps where campaign_id = tests.rid('m1')), '30/30', 'F16 30 steps (ten people x three) are planned; the first at 10:00 on the day three days before each person''s date');
select is((select min(scheduled_for) from public.campaign_steps where campaign_id = tests.rid('m1')), '2026-11-07T10:00:00+05:30'::timestamptz, 'F17 the earliest is 7 Nov, 10:00 India time (3 days before 10 Nov)');
select is((select max(scheduled_for) from public.campaign_steps where campaign_id = tests.rid('m1')), '2026-11-27T10:00:00+05:30'::timestamptz, 'F18 the latest is 27 Nov (7 days after 20 Nov)');
select is((select count(*) from public.audit_events where action = 'campaign.approved' and entity_id = tests.rid('m1') and (new_values ->> 'recipients') = '10'), 1::bigint, 'F19 the approval is in the audit trail with the counts and the hashes');
select is(pg_temp.approve('a_owner', 'm1', pg_temp.sha()), 'SM801', 'F20 an approved campaign cannot be approved again (SM801)');
-- what stands in the way
select is(pg_temp.save('a_owner', 'p1', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.', p_tpl => 'tpl_draft'), 'ok', 'F21 (setup) a campaign whose template is only a draft');
select is(pg_temp.addn('a_owner', 'p1', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-10', 'amount_paise', 500000))), '1', 'F22 (setup) one person');
select is(pg_temp.issues('p1'), 'template_not_approved', 'F23 a template that Meta has not approved is an issue');
select is(pg_temp.save('a_owner', 'p1', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.', p_tpl => 'tpl_hi'), 'ok', 'F24 an approved template in ANOTHER language');
select is(pg_temp.issues('p1'), 'template_language', 'F25 is an issue');
select is(pg_temp.save('a_owner', 'p1', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.', p_tpl => 'tpl_visit'), 'ok', 'F26 an approved template of another PURPOSE (a visit note)');
select is(pg_temp.issues('p1'), 'template_purpose', 'F27 is an issue');
select is(pg_temp.save('a_owner', 'p1', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.', p_tpl => null), 'ok', 'F28 no template at all');
select is(pg_temp.issues('p1'), 'no_template', 'F29 is an issue');
select is(pg_temp.approve('a_owner', 'p1', pg_temp.sha()), 'SM803', 'F30 and the Owner cannot approve it (SM803, the first problem named in DETAIL)');
select is(pg_temp.save('a_owner', 'p2', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.'), 'ok', 'F31 (setup) a campaign whose people are all due in the past');
select is(pg_temp.addn('a_owner', 'p2', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-09-01', 'amount_paise', 500000))), '1', 'F32 one person, due 1 Sep');
select is(pg_temp.issues('p2'), 'no_future_step', 'F33 every step is already past: an issue (nothing would ever be sent)');
select is(pg_temp.approve('a_owner', 'p2', pg_temp.prev('p2', 'samples_sha256')), 'SM803', 'F34 not approvable');
select is(pg_temp.save('a_owner', 'p3', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.'), 'ok', 'F35 (setup) a campaign with one person due 23 Oct (steps: 20 Oct 10:00 past, 23 Oct, 30 Oct)');
select is(pg_temp.addn('a_owner', 'p3', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-10-23', 'amount_paise', 500000))), '1', 'F36 one person');
select is(pg_temp.approve('a_owner', 'p3', pg_temp.prev('p3', 'samples_sha256')), 'ok', 'F37 approvable: some steps are still ahead');
select is((select count(*) filter (where status = 'planned') || '/' || count(*) filter (where status = 'skipped' and reason = 'past') from public.campaign_steps where campaign_id = tests.rid('p3')), '2/1', 'F38 the step whose time has passed is recorded as skipped (past), never sent in a burst');
select is(pg_temp.save('a_owner', 'p4', 'payment_due', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.', p_steps => '[{"offset_days": 0, "time": "21:30"}]'), 'ok', 'F39 (setup) a step at 21:30');
select is(pg_temp.addn('a_owner', 'p4', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r1'), 'due_date', '2026-11-10', 'amount_paise', 500000))), '1', 'F40 one person');
select is(pg_temp.approve('a_owner', 'p4', pg_temp.prev('p4', 'samples_sha256')), 'SM803', 'F41 a step inside the quiet hours cannot be approved');

-- ============================================================================ G. ANY change sends an approved campaign back to draft
create function pg_temp.reapprove() returns text language sql as $$ select pg_temp.approve('a_owner', 'm1', pg_temp.prev('m1', 'samples_sha256')) $$;
create function pg_temp.msg_m1(p_text text, p_lang text default 'en', p_tpl text default 'tpl', p_steps text default '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]', p_name text default 'October dues') returns text language sql as $$
  select pg_temp.save('a_owner', 'm1', 'payment_due', p_text, p_steps, p_tpl, p_lang, null, 'a', p_name)
$$;
select pg_temp.mk('late1', 'Late joiner', '+00 90001 00009');
select is(pg_temp.addn('a_owner', 'm1', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('late1'), 'due_date', '2026-11-20', 'amount_paise', 100000, 'reference', 'INV-110'))), '1', 'G1 adding ONE person to an approved campaign ...');
select is(pg_temp.status('m1'), 'draft', 'G2 ... sends it back to draft');
select is((select (approved_by is null and approved_at is null and content_sha256 is null and samples_sha256 is null and approved_recipients is null and approved_total_paise is null)::text from public.campaigns where id = tests.rid('m1')), 'true', 'G3 and the approval is gone: who, when, the hashes, the counts');
select is((select count(*) from public.campaign_steps where campaign_id = tests.rid('m1')), 0::bigint, 'G4 and the planned steps are cancelled');
select is((select count(*) from public.audit_events where action = 'campaign.back_to_draft' and entity_id = tests.rid('m1') and (new_values ->> 'because') = 'list_changed'), 1::bigint, 'G5 the audit trail says why');
select is(pg_temp.reapprove(), 'ok', 'G6 the Owner approves what they now see (ten people)');
select is((select count(*) from public.campaign_steps where campaign_id = tests.rid('m1') and status = 'planned'), 33::bigint, 'G7 33 steps');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_save(%L, %L, 'October dues', 'payment_due', 'en', %L, %L, '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]'::jsonb, null, 24)->>'back_to_draft')$q$,
                              tests.rid('m1'), tests.tid('a'), tests.rid('tpl'), 'Dear {{name}}, payment of {{amount}} for {{reference}} is due on {{due_date}}. Thank you, {{business}}.')), 'false', 'G8 saving the SAME content again changes nothing: still approved');
select is(pg_temp.status('m1'), 'approved', 'G9 (approved)');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_save(%L, %L, 'Renamed only', 'payment_due', 'en', %L, %L, '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]'::jsonb, null, 24)->>'back_to_draft')$q$,
                              tests.rid('m1'), tests.tid('a'), tests.rid('tpl'), 'Dear {{name}}, payment of {{amount}} for {{reference}} is due on {{due_date}}. Thank you, {{business}}.')), 'false', 'G10 a new NAME is not content: still approved');
select is(pg_temp.status('m1'), 'approved', 'G11 (approved)');
select is(pg_temp.msg_m1('Dear {{name}}, payment of {{amount}} for {{reference}} falls due on {{due_date}}. Thank you, {{business}}.'), 'ok', 'G12 one changed WORD in the text ...');
select is(pg_temp.status('m1'), 'draft', 'G13 ... back to draft');
select is(pg_temp.reapprove(), 'ok', 'G14 (approved again)');
select is(pg_temp.msg_m1('Dear {{name}}, payment of {{amount}} for {{reference}} falls due on {{due_date}}. Thank you, {{business}}.', p_steps => '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 8, "time": "10:00"}]'), 'ok', 'G15 one changed STEP (day 8, not 7) ...');
select is(pg_temp.status('m1'), 'draft', 'G16 ... back to draft');
select is(pg_temp.reapprove(), 'ok', 'G17 (approved again)');
select is(pg_temp.msg_m1('Dear {{name}}, payment of {{amount}} for {{reference}} falls due on {{due_date}}. Thank you, {{business}}.', 'hi', 'tpl_hi', '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 8, "time": "10:00"}]'), 'ok', 'G18 another language and template ...');
select is(pg_temp.status('m1'), 'draft', 'G19 ... back to draft');
select is(pg_temp.reapprove(), 'ok', 'G20 (approved again)');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipient_remove(%L, %L, %L)->>'removed')$q$, tests.tid('a'), tests.rid('m1'), (select id from public.campaign_recipients where campaign_id = tests.rid('m1') and contact_id = tests.rid('late1')))), '1', 'G21 removing one person ...');
select is(pg_temp.status('m1'), 'draft', 'G22 ... back to draft');
select is(pg_temp.reapprove(), 'ok', 'G23 (approved again)');
select is(pg_temp.sc(format($$update public.campaigns set message_text = 'Pay now, {{name}}, {{amount}}' where id = %L$$, tests.rid('m1'))), '42501', 'G24 DENY: not even a privileged session can change an approved campaign''s words (only going back to draft can)');
select is(pg_temp.sc(format($$insert into public.campaign_recipients (tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, row_hash, created_by) values (%L, %L, %L, %L, date '2026-12-01', 100, repeat('a', 64), %L)$$, tests.tid('a'), tests.rid('m1'), tests.rid('r2'), tests.rid('r2_l'), tests.uid('a_owner'))), '42501', 'G25 nor add a person to its list');
select is(pg_temp.sc(format($$delete from public.campaign_recipients where campaign_id = %L$$, tests.rid('m1'))), '42501', 'G26 nor take one away');
select is(pg_temp.sc(format($$update public.campaign_recipients set amount_paise = 1 where campaign_id = %L$$, tests.rid('m1'))), '42501', 'G27 nor change an amount');

-- ============================================================================ H. pause, resume, cancel
create function pg_temp.state(p_user text, p_camp text, p_action text) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.campaign_set_state(%L, %L, %L)$q$, tests.tid('a'), tests.rid(p_camp), p_action))
$$;
select is(pg_temp.state('a_sales', 'm1', 'pause'), '42501', 'H1 DENY: Sales cannot pause');
select is(pg_temp.state('a_admin', 'm1', 'pause'), 'ok', 'H2 ALLOW: the Admin pauses');
select is(pg_temp.status('m1'), 'paused', 'H3 (paused)');
select is(pg_temp.state('a_admin', 'm1', 'pause'), 'SM801', 'H4 a paused campaign cannot be paused (SM801)');
select is(pg_temp.state('a_admin', 'm1', 'jump'), '22023', 'H5 an unknown action is invalid');
select is(pg_temp.state('b_owner', 'm1', 'resume'), '42501', 'H6 DENY: another business');
select is(pg_temp.pin('2026-11-09T12:00:00+05:30'::timestamptz)::text, '', 'H7 (the clock moves to 9 Nov, 12:00)');
select is(pg_temp.state('a_owner', 'm1', 'resume'), 'ok', 'H8 ALLOW: the Owner resumes ...');
select is(pg_temp.status('m1'), 'approved', 'H9 (approved: nothing was sent yet)');
select is((select count(*) from public.campaign_steps where campaign_id = tests.rid('m1') and status = 'skipped' and reason = 'missed'), 2::bigint, 'H10 ... and the two steps that were more than a day late (7 Nov, for the two people due 10 Nov) are skipped as missed, not sent now');
select is((select count(*) from public.campaign_steps where campaign_id = tests.rid('m1') and status = 'planned'), 28::bigint, 'H11 the rest stay planned');
select is(pg_temp.state('a_owner', 'm1', 'resume'), 'SM801', 'H12 a campaign that is not paused cannot be resumed');
select is(pg_temp.state('a_admin', 'm1', 'cancel'), 'ok', 'H13 the Admin cancels');
select is(pg_temp.status('m1'), 'cancelled', 'H14 (cancelled)');
select is((select count(*) from public.campaign_steps where campaign_id = tests.rid('m1') and status = 'skipped' and reason = 'cancelled'), 28::bigint, 'H15 the planned steps are skipped (cancelled)');
select is(pg_temp.state('a_admin', 'm1', 'cancel'), 'SM801', 'H16 a cancelled campaign stays cancelled');
select is(pg_temp.msg_m1('Dear {{name}}, another text for {{amount}} due on {{due_date}} with {{reference}}.'), 'SM801', 'H17 and cannot be edited (SM801)');
select is(pg_temp.addn('a_owner', 'm1', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('r2'), 'due_date', '2026-12-01', 'amount_paise', 100, 'reference', 'A'))), 'ERR:SM801', 'H18 nor its list');
select is(pg_temp.sc(format($$update public.campaigns set status = 'running' where id = %L$$, tests.rid('m1'))), '42501', 'H19 nor moved on by a privileged session (cancelled is final)');

-- ============================================================================ I. guards, ids and row-level security
select is(pg_temp.sc(format($$delete from public.campaigns where id = %L$$, tests.rid('c1'))), '42501', 'I1 a campaign is never deleted');
select is(pg_temp.sc($$truncate public.campaign_steps$$), '42501', 'I2 nor are the steps truncated');
select is(pg_temp.sc(format($$update public.campaigns set status = 'approved' where id = %L$$, tests.rid('c1'))), '23514', 'I3 a draft cannot be made approved without the approval record (who, when): a CHECK, even for a privileged session');
select is(pg_temp.sc(format($$update public.campaigns set kind = 'fee_due' where id = %L$$, tests.rid('c1'))), '42501', 'I4 the kind never changes');
select is(app.campaign_message_id(tests.rid('m1'), tests.rid('late1'), 1, date '2026-11-20') = app.campaign_message_id(tests.rid('m1'), tests.rid('late1'), 1, date '2026-11-20'), true, 'I5 the id of a reminder is DERIVED from (campaign, person, step, date): the same four make the same id');
select is(app.campaign_message_id(tests.rid('m1'), tests.rid('late1'), 1, date '2026-11-20') in (app.campaign_message_id(tests.rid('m1'), tests.rid('late1'), 2, date '2026-11-20'), app.campaign_message_id(tests.rid('m1'), tests.rid('late1'), 1, date '2026-11-21'),
          app.campaign_message_id(tests.rid('c1'), tests.rid('late1'), 1, date '2026-11-20'), app.campaign_message_id(tests.rid('m1'), tests.rid('r1'), 1, date '2026-11-20')), false, 'I6 and any other step, date, campaign or person makes another');
select is(pg_temp.sc(format($$insert into public.campaign_steps (tenant_id, campaign_id, recipient_id, step_no, scheduled_for) select tenant_id, campaign_id, recipient_id, 1, now() from public.campaign_steps where campaign_id = %L limit 1$$, tests.rid('p3'))), '23505', 'I7 one step per person and step number: the database refuses a second');
select is(pg_temp.sc(format($$update public.campaign_steps set status = 'planned', materialised_at = null where campaign_id = %L and status = 'skipped'$$, tests.rid('p3'))), '42501', 'I8 a step moves forward once: a skipped step is not planned again');
select is(pg_temp.val('a_sales', format($$select count(*)::text from public.campaigns where tenant_id = %L$$, tests.tid('a'))), (select count(*)::text from public.campaigns where tenant_id = tests.tid('a')), 'I9 Sales read the campaigns');
select is(pg_temp.val('a_viewer', format($$select count(*)::text from public.campaigns where tenant_id = %L$$, tests.tid('a'))), '0', 'I10 a Viewer reads none (the words can hold an amount)');
select is(pg_temp.val('a_viewer', format($$select count(*)::text from public.campaign_recipients where tenant_id = %L$$, tests.tid('a'))), '0', 'I11 nor the lists');
select is(pg_temp.val('b_owner', format($$select count(*)::text from public.campaign_steps where tenant_id = %L$$, tests.tid('a'))), '0', 'I12 another business sees none of the steps');
select is(pg_temp.try('a_owner', format($$update public.campaigns set name = 'x' where id = %L$$, tests.rid('c1'))), '42501', 'I13 DENY: a client cannot write a campaign directly');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('campaigns', 'campaign_recipients', 'campaign_steps', 'call_list_items') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'I14 a client can only read the four tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('campaigns', 'campaign_recipients', 'campaign_steps', 'call_list_items') and grantee in ('anon', 'public')), 0::bigint, 'I15 anon and PUBLIC hold nothing');

select * from finish();
rollback;
