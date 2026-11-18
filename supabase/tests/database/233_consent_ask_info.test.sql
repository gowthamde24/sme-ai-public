-- "Ask for consent" in one tap (migration 20261231982300): what the draft needs for one lead's contact. Read only; Owner and Admin.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');

create function pg_temp.pin(p_instant text) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant);
end $fn$;
select pg_temp.pin('2026-11-02T11:00:00+05:30');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.info(p_user text, p_lead text, p_path text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (public.consent_ask_info(%L, %L) #>> string_to_array(%L, '.'))$q$, tests.tid('a'), tests.rid(p_lead), p_path)) $$;

insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Ask Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, whatsapp_consent) values
  (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Kalyani Gowda', '+91 98333 00001', 'unknown'),
  (tests.rid('k2'), tests.tid('a'), tests.rid('co'), 'Agreed Person', '+91 98333 00002', 'granted'),
  (tests.rid('k3'), tests.tid('a'), tests.rid('co'), 'Stopped Person', '+91 98333 00003', 'withdrawn'),
  (tests.rid('k4'), tests.tid('a'), tests.rid('co'), 'No Number', null, 'unknown');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values
  (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('k1'), 'website_form', '2026-10-20T10:00:00+05:30'),
  (tests.rid('l2'), tests.tid('a'), tests.rid('co'), tests.rid('k2'), 'website_form', '2026-10-20T10:00:00+05:30'),
  (tests.rid('l3'), tests.tid('a'), tests.rid('co'), tests.rid('k3'), 'website_form', '2026-10-20T10:00:00+05:30'),
  (tests.rid('l4'), tests.tid('a'), tests.rid('co'), tests.rid('k4'), 'website_form', '2026-10-20T10:00:00+05:30');

select is(pg_temp.info('a_owner', 'l1', 'customer'), 'Kalyani Gowda', 'A1 the customer''s name');
select is(pg_temp.info('a_owner', 'l1', 'whatsapp_consent'), 'unknown', 'A2 consent as it is');
select is(pg_temp.info('a_owner', 'l1', 'stopped'), 'false', 'A3 not stopped');
select is(pg_temp.info('a_owner', 'l1', 'has_number'), 'true', 'A4 has a number');
select is(pg_temp.info('a_owner', 'l1', 'window_open'), 'false', 'A5 no message from the customer: the 24-hour window is closed');
select is(pg_temp.info('a_owner', 'l1', 'template_id') is null, true, 'A6 no consent_ask template yet');
select is(pg_temp.info('a_owner', 'l1', 'language') in ('en', 'te', 'hi', 'kn', 'ta'), true, 'A7 a language');

select is(pg_temp.info('a_owner', 'l2', 'whatsapp_consent'), 'granted', 'B1 already agreed');
select is(pg_temp.info('a_owner', 'l3', 'stopped'), 'true', 'B2 withdrawn counts as stopped');
select is(pg_temp.info('a_owner', 'l4', 'has_number'), 'false', 'B3 a contact with no number');

-- the window opens when the customer writes
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at)
values (tests.rid('t1'), tests.tid('a'), tests.rid('l1'), tests.rid('k1'), 'in', 'whatsapp', '2026-11-02T09:00:00+05:30');
select is(pg_temp.info('a_owner', 'l1', 'window_open'), 'true', 'C1 a WhatsApp message from the customer 2 hours ago: the window is open');
select pg_temp.pin('2026-11-04T11:00:00+05:30');
select is(pg_temp.info('a_owner', 'l1', 'window_open'), 'false', 'C2 two days later it is closed');

-- the approved template
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) values
  (tests.rid('tpl'), tests.tid('a'), 'consent_ask', 'en', 'utility', 'info', 'Hello {{1}}, {{2}} would like your OK to call you and message you on WhatsApp. Reply OK if yes.', 'approved');
select is(pg_temp.info('a_owner', 'l1', 'language'), 'en', 'D1 (setup) the customer''s language is English');
select is(pg_temp.info('a_owner', 'l1', 'template_id'), tests.rid('tpl')::text, 'D2 the approved consent_ask template in that language is named');
update integrations.wa_templates set status = 'submitted' where id = tests.rid('tpl');
select is(pg_temp.info('a_owner', 'l1', 'template_id') is null, true, 'D3 a template that is not approved is not offered');

-- who may
select is(pg_temp.info('b_owner', 'l1', 'customer'), 'ERR:42501', 'E1 another workspace''s Owner is refused');
select is(pg_temp.val('anon', format($q$select public.consent_ask_info(%L, %L)::text$q$, tests.tid('a'), tests.rid('l1'))) like 'ERR:%', true, 'E2 nobody signed in is refused');
select is(pg_temp.val('a_owner', format($q$select public.consent_ask_info(%L, gen_random_uuid())::text$q$, tests.tid('a'))) like 'ERR:%', true, 'E3 a lead that is not there is refused');
select is((select count(*) from public.outbox_messages where tenant_id = tests.tid('a')), 0::bigint, 'F1 nothing was written or sent');

select * from finish();
rollback;
