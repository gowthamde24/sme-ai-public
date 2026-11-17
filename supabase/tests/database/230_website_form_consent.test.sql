-- The Website form carries consent per lead (migration 20261231982100; owner, 17 Nov 2026): a submission that ticked the required checkbox is stored with its consent and the wording the form showed; one without a tick stays ask-first.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');

create function pg_temp.pin(p_instant text) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant);
end $fn$;
select pg_temp.pin('2026-11-02T11:00:00+05:30');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.w(p_sql text) returns text language sql as $$ select pg_temp.val('outsider', p_sql) $$;
create function pg_temp.tid(p text) returns text language sql as $$ select quote_literal(tests.tid(p)) $$;
create function pg_temp.rid(p text) returns text language sql as $$ select quote_literal(tests.rid(p)) $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.j(p_json text, p_path text) returns text language sql as $$ select (p_json::jsonb #>> string_to_array(p_path, '.')) $$;


insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Consent Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent) values
  (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Kiran One', '+91 98333 00001', 'unknown', 'unknown');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('k1'), 'website_form', '2026-10-20T10:00:00+05:30');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%s, %s, 'website_form', 'website_form', 'Website form', %L, 'wxyz', null, null, null) -> 'source' ->> 'id')$q$,
  pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.h('token-one'))), tests.rid('s1')::text, 'S1 (setup) a live Website source with no consent confirmation of its own (as the card makes it)');

create function pg_temp.live(p_phone text, p_name text, p_consent text default null) returns text language sql as $$
  select pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('name', %L, 'phone', %L, 'message', 'Need a saree', 'consent', %L::jsonb))))::text$q$, pg_temp.h('token-one'), p_name, p_phone, p_consent)) $$;
create function pg_temp.contact(p_phone text) returns public.contacts language sql as $$ select c from public.contacts c where c.tenant_id = tests.tid('a') and regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g') limit 1 $$;
create function pg_temp.wcons(p_phone text) returns text language sql as $$ select (pg_temp.contact(p_phone)).whatsapp_consent::text $$;

-- A. the business name for the wording
select is(pg_temp.j(pg_temp.w(format($q$select public.scheduler_lead_form_info(%L)::text$q$, pg_temp.h('token-one'))), 'business'), (select name from public.tenants where id = tests.tid('a')), 'A1 the worker is told the business name of an active website form');
select is(pg_temp.w(format($q$select public.scheduler_lead_form_info(%L)::text$q$, pg_temp.h('no-such-token'))), '{}', 'A2 an unknown address answers nothing');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_lead_form_info(%L)::text$q$, pg_temp.h('token-one'))), 'ERR:42501', 'A3 only the worker asks');
select is(pg_temp.w($q$select public.scheduler_lead_form_info('abc')::text$q$), 'ERR:22023', 'A4 a malformed token is refused');

-- B. a ticked submission is stored with its consent
select pg_temp.pin('2026-11-02T11:05:00+05:30');
select pg_temp.live('+919833300002', 'Meena Ticked', '{"checkbox_key": "consent", "ticked": true, "disclaimer": "I agree that Shop may call or WhatsApp me about my enquiry"}');
select is(pg_temp.wcons('+919833300002'), 'granted', 'B1 a ticked submission grants WhatsApp consent');
select is((pg_temp.contact('+919833300002')).phone_consent::text, 'granted', 'B2 ... and phone consent');
select is((select count(*) from public.lead_consent_evidence e where e.tenant_id = tests.tid('a') and e.source_tag = 'website_form' and e.ticked is true and e.disclaimer_text = 'I agree that Shop may call or WhatsApp me about my enquiry' and e.checkbox_key = 'consent'), 1::bigint, 'B3 the evidence keeps the wording, the checkbox and the tick, with the time');
select is((select count(*) from public.consent_events ev where ev.contact_id = (pg_temp.contact('+919833300002')).id and ev.evidence_type = 'web_form' and ev.event_type = 'granted'), 2::bigint, 'B4 two consent events (phone, WhatsApp) with the web form as evidence');

-- C. no tick, no consent
select is(pg_temp.j(pg_temp.live('+919833300003', 'Latha NoTick'), 'counts.no_consent'), '1', 'C1 a submission that carries no consent is "ask first"');
select is(pg_temp.wcons('+919833300003'), 'unknown', 'C2 ... nothing is granted');
select is((select count(*) from public.lead_consent_evidence where tenant_id = tests.tid('a') and source_tag = 'website_form'), 1::bigint, 'C3 ... and no evidence is made up');

-- D. an unticked box is evidence of a no, not of a yes
select pg_temp.live('+919833300004', 'Ravi Unticked', '{"checkbox_key": "consent", "ticked": false, "disclaimer": "I agree that Shop may call or WhatsApp me about my enquiry"}');
select is(pg_temp.wcons('+919833300004'), 'unknown', 'D1 an unticked box grants nothing');
select is((select count(*) from public.lead_consent_evidence where tenant_id = tests.tid('a') and ticked is false), 1::bigint, 'D2 ... and is recorded as an unticked box');

-- E. a known customer who ticks the box on a repeat enquiry is consented; one who said STOP is not
select pg_temp.pin('2026-11-02T11:30:00+05:30');
select pg_temp.live('+919833300001', 'Kiran One', '{"checkbox_key": "consent", "ticked": true, "disclaimer": "I agree that Shop may call or WhatsApp me about my enquiry"}');
select is(pg_temp.wcons('+919833300001'), 'granted', 'E1 a known customer who ticks the box on a new enquiry is consented');
update public.contacts set suppressed_at = now(), suppression_reason = 'opted_out', whatsapp_consent = 'withdrawn' where id = tests.rid('k1');
select pg_temp.pin('2026-11-02T12:30:00+05:30');
select pg_temp.live('+919833300001', 'Kiran One', '{"checkbox_key": "consent", "ticked": true, "disclaimer": "I agree that Shop may call or WhatsApp me about my enquiry"}');
select is(pg_temp.wcons('+919833300001'), 'withdrawn', 'E2 a customer who said STOP is never re-consented by a tick on a form');

-- F. the sender cannot choose the wording or the checkbox name
select pg_temp.pin('2026-11-02T13:30:00+05:30');
select pg_temp.live('+919833300005', 'Odd Key', '{"checkbox_key": "bad key!", "ticked": true, "disclaimer": "x"}');
select is((select checkbox_key from public.lead_consent_evidence where tenant_id = tests.tid('a') and disclaimer_text = 'x'), null, 'F1 a checkbox name that is not a plain word is not kept');

select * from finish();
rollback;
