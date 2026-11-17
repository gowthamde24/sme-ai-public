-- Campaigns S3 (migration 20261231979800): the consent list by name, the offer's list built from the customers who said yes, and the estimated cost on the approval screen.
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

create function pg_temp.lst(p_user text, p_args text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.marketing_consent_list(%L, %s)::text$q$, tests.tid('a'), p_args))
$$;
create function pg_temp.addc(p_camp text, p_due text, p_q text default null) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select public.campaign_recipients_add_consented(%L, %L, %L, %L)::text$q$, tests.tid('a'), tests.rid(p_camp), p_due, p_q))
$$;

-- L. the consent list
select is((pg_temp.j(pg_temp.lst('a_owner', $$'ravi'$$), 'counts')::jsonb) ->> 'granted', '2', 'L1 the counts cover the whole book: two said yes (Ravi, Mohan)');
select is((pg_temp.j(pg_temp.lst('a_owner', $$'ravi'$$), 'items')::jsonb) -> 0 ->> 'name', 'Ravi Kumar', 'L2 a name (any case, any part) finds the customer');
select is((pg_temp.j(pg_temp.lst('a_owner', $$'RAVI'$$), 'items')::jsonb) -> 0 ->> 'state', 'granted', 'L3 ... with the consent state');
select is((pg_temp.j(pg_temp.lst('a_owner', $$'latha'$$), 'items')::jsonb) -> 0 ->> 'state', 'withdrawn', 'L4 Latha''s STOP withdrew it');
select is((pg_temp.j(pg_temp.lst('a_owner', $$'latha'$$), 'items')::jsonb) -> 0 ->> 'stopped', 'true', 'L5 ... and she is marked as stopped (staff cannot record a yes for her)');
select is((pg_temp.j(pg_temp.lst('a_owner', $$'sita'$$), 'items')::jsonb) -> 0 ->> 'state', 'unknown', 'L6 Sita was never asked');
select is(jsonb_array_length(pg_temp.j(pg_temp.lst('a_owner', $$'ravi', 'unknown'$$), 'items')::jsonb), 0, 'L7 the state filter applies');
select is((pg_temp.j(pg_temp.lst('a_owner', $$null, 'granted', 1$$), 'items')::jsonb) -> 0 ->> 'name', 'Mohan', 'L8 the list is in name order, a page at a time');
select is(pg_temp.j(pg_temp.lst('a_owner', $$null, 'granted', 1$$), 'has_more'), 'true', 'L9 ... and says there is more');
select is((pg_temp.j(pg_temp.lst('a_owner', format($q$null, 'granted', 1, 'mohan', %L$q$, tests.rid('o5'))), 'items')::jsonb) -> 0 ->> 'name', 'Ravi Kumar', 'L10 the next page starts after the last name');
select is(pg_temp.j(pg_temp.lst('a_owner', format($q$null, 'granted', 1, 'mohan', %L$q$, tests.rid('o5'))), 'has_more'), 'false', 'L11 ... and is the last');
select is(pg_temp.lst('a_viewer', $$null$$), 'ERR:42501', 'L12 a viewer cannot read it');
select is(pg_temp.lst('b_owner', $$null$$), 'ERR:42501', 'L13 nor can another business''s owner');
select is(pg_temp.lst('a_owner', $$null, 'maybe'$$), 'ERR:22023', 'L14 a state that does not exist is refused');
select is(pg_temp.lst('a_owner', $$null, null, 500$$), 'ERR:22023', 'L15 so is a page of 500');
select is(pg_temp.lst('a_sales', $$'ravi'$$) like '%Ravi Kumar%', true, 'L16 Sales can read it');

-- M. an offer's list from the customers who said yes
select is(pg_temp.osave('c1', 'Hello {{name}}, {{business}} has new arrivals: {{label}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'tpl_offer'), 'ok', 'M1 (setup) an offer campaign');
select is(pg_temp.j(pg_temp.addc('c1', '2026-11-20'), 'added'), '2', 'M2 everyone who said yes is added (Ravi, Mohan), nobody else');
select is(pg_temp.j(pg_temp.addc('c1', '2026-11-20'), 'added'), '0', 'M3 adding again adds nobody');
select is(jsonb_array_length(pg_temp.j(pg_temp.addc('c1', '2026-11-20'), 'skipped')::jsonb), 2, 'M4 ... and says the two were already there');
select is((select count(*)::int from public.campaign_recipients where campaign_id = tests.rid('c1') and due_date = date '2026-11-20'), 2, 'M5 the date is the occasion''s day');
select is(pg_temp.addc('c1', '2026-11-20', 'x' || repeat('y', 70)), 'ERR:22023', 'M6 a name search longer than 60 characters is refused');
select is(pg_temp.addc('c1', null), 'ERR:22023', 'M7 a date is needed');
select is(pg_temp.val('a_viewer', format($q$select public.campaign_recipients_add_consented(%L, %L, '2026-11-20', null)$q$, tests.tid('a'), tests.rid('c1'))), 'ERR:42501', 'M8 a viewer cannot');
select is(pg_temp.osave('c6', 'Hello {{name}}, {{business}} has new arrivals: {{label}}. Visit us or reply here to know more. Reply STOP to unsubscribe.', 'tpl_offer', 'Name search'), 'ok', 'M9 (setup) a second offer');
select is(pg_temp.j(pg_temp.addc('c6', '2026-11-21', 'ravi'), 'added'), '1', 'M10 a name search narrows the list (Ravi only)');

-- N. the estimated cost on the approval screen
create temp table pv2 as select (pg_temp.val('a_owner', format($q$select public.campaign_preview(%L, %L)::text$q$, tests.tid('a'), tests.rid('c1'))))::jsonb as r;
select is((select r -> 'offer' ->> 'will_receive' from pv2), '2', 'N1 two customers will receive it');
select is((select r -> 'offer' -> 'cost' ->> 'messages_at_most' from pv2), '2', 'N2 at most two messages (one step each)');
select is((select r -> 'offer' -> 'cost' ->> 'paise_each' from pv2), '60', 'N3 the rate card''s marketing message rate: 60 paise');
select is((select r -> 'offer' -> 'cost' ->> 'paise_at_most' from pv2), '120', 'N4 so at most 120 paise');
select is((select r -> 'offer' -> 'cost' ->> 'rate_source' from pv2), 'estimate', 'N5 and it says it is an estimate');
select is((select r -> 'offer' -> 'cost' ->> 'before_gst' from pv2), 'true', 'N6 ... before GST');

-- R. a customer who said STOP cannot be recorded as a yes (the contact-suppressed code)
select is(pg_temp.val('a_owner', format($q$select public.marketing_consent_set(%L, %L, 'said yes in shop')::text$q$, tests.tid('a'), tests.rid('o4'))), 'ERR:SM002', 'R1 the refusal is the contact-suppressed code, not a generic one');

select * from finish();
rollback;

