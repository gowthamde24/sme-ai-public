-- TRAI Third Amendment hardening (migration 20261231987300; 21 Nov 2026): the 7-day relationship, phone-only requests are no proof, the complaint pause and its Needs-you item.
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
select pg_temp.pin('2026-11-18T12:00:00+05:30');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.proof_src(p_lead text) returns text language sql as $$
  select coalesce((pg_temp.val('a_owner', format($q$select coalesce(public.call_back_proof(%L, %L)::text, 'null')$q$, tests.tid('a'), tests.rid(p_lead)))::jsonb) ->> 'source', 'null') $$;

insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Trai Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent) values
  (tests.rid('t1'), tests.tid('a'), tests.rid('co'), 'Six Days', '+91 98333 20001', 'granted'),
  (tests.rid('t2'), tests.tid('a'), tests.rid('co'), 'Eight Days', '+91 98333 20002', 'granted'),
  (tests.rid('t3'), tests.tid('a'), tests.rid('co'), 'Missed Call', '+91 98333 20003', 'granted'),
  (tests.rid('t4'), tests.tid('a'), tests.rid('co'), 'Caller', '+91 98333 20004', 'granted'),
  (tests.rid('s1'), tests.tid('a'), tests.rid('co'), 'Stop One', '+91 98333 20011', 'granted'),
  (tests.rid('s2'), tests.tid('a'), tests.rid('co'), 'Stop Two', '+91 98333 20012', 'granted'),
  (tests.rid('s3'), tests.tid('a'), tests.rid('co'), 'Owner Added', '+91 98333 20013', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values
  (tests.rid('lt1'), tests.tid('a'), tests.rid('co'), tests.rid('t1'), 'website_form', '2026-11-12T12:00:00+05:30'),
  (tests.rid('lt2'), tests.tid('a'), tests.rid('co'), tests.rid('t2'), 'website_form', '2026-11-10T11:00:00+05:30'),
  (tests.rid('lt3'), tests.tid('a'), tests.rid('co'), tests.rid('t3'), 'missed_calls', '2026-11-17T10:00:00+05:30'),
  (tests.rid('lt4'), tests.tid('a'), tests.rid('co'), tests.rid('t4'), 'manual', '2026-11-16T10:00:00+05:30');

-- A. the window and the sources
select is(pg_temp.proof_src('lt1'), 'website_form', 'A1 a website form 6 days ago (a written enquiry) is a proof');
select is(pg_temp.proof_src('lt2'), 'null', 'A2 the same 8 days ago is not: the relationship lasts 7 days');
select is(pg_temp.proof_src('lt3'), 'null', 'A3 a missed call is no proof (phone only)');
insert into public.phone_calls (id, tenant_id, direction, state, provider, sandbox, contact_id, lead_id, created_at, ended_at)
values (gen_random_uuid(), tests.tid('a'), 'inbound', 'completed', 'plivo', false, tests.rid('t4'), tests.rid('lt4'), '2026-11-17T11:00:00+05:30', '2026-11-17T11:02:00+05:30');
select is(pg_temp.proof_src('lt4'), 'null', 'A4 a call the person made is no proof (the reply to our WhatsApp is)');
insert into public.enquiries (id, tenant_id, lead_id, company_id, contact_id, channel, received_at, body, body_sha256, retain_until, created_via)
values (gen_random_uuid(), tests.tid('a'), tests.rid('lt4'), tests.rid('co'), tests.rid('t4'), 'whatsapp', '2026-11-17T12:00:00+05:30', 'Please call me back', repeat('b', 64), '2027-11-17', 'agent');
select is(pg_temp.proof_src('lt4'), 'whatsapp', 'A5 their written reply on WhatsApp makes the call-back allowed');
select is((select app.call_back_proof(tests.tid('a'), tests.rid('t2'), 30)::text), null, 'A6 asking the database for 30 days still gives 7 for an enquiry');

-- B. the complaint count (customers who asked us to stop on or after a call or WhatsApp, or complained), last 10 days
create function pg_temp.complaints() returns text language sql as $$ select app.outbound_complaints(tests.tid('a'), 10)::text $$;
select is(pg_temp.complaints(), '0', 'B1 nobody asked us to stop yet');
select is(pg_temp.val('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'verbal', 'call:1') is not null$q$, tests.tid('a'), tests.rid('s1'))), 'true', 'B2 a customer asks to stop on a call');
select is(pg_temp.complaints(), '1', 'B3 one');
select is(pg_temp.val('a_sales', format($q$select public.suppress_contact(%L, %L, 'manual', null, null) is not null$q$, tests.tid('a'), tests.rid('s3'))), 'true', 'B4 the owner adds a number (manual)');
select is(pg_temp.complaints(), '1', 'B5 ... which is not a complaint');
select is(pg_temp.val('a_owner', format($q$select (public.call_facts(%L, %L, '+91 98333 20004') ->> 'complaints_10d')$q$, tests.tid('a'), tests.rid('lt4'))), '1', 'B6 the call facts carry the count');
select is(pg_temp.val('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'verbal', 'whatsapp:wamid.1') is not null$q$, tests.tid('a'), tests.rid('s2'))), 'true', 'B7 a second customer writes STOP on WhatsApp');
select is(pg_temp.complaints(), '2', 'B8 two in 10 days: the pause line');
select is((select app.outbound_complaints(tests.tid('b'), 10))::text, '0', 'B9 another business is untouched');

-- C. Today: the Owner and Admin see the pause; Sales does not; it lifts after 10 days
create function pg_temp.today_has_pause(p_user text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select exists (select 1 from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') e where e ->> 'kind' = 'outreach_paused' and e -> 'target' ->> 'type' = 'calls')::text$q$, tests.tid('a'))) $$;
select is(pg_temp.today_has_pause('a_owner'), 'true', 'C1 the Owner sees "calls are paused" on Today');
select is(pg_temp.today_has_pause('a_admin'), 'true', 'C2 the Admin too');
select is(pg_temp.today_has_pause('a_sales'), 'false', 'C3 Sales does not');
select pg_temp.pin((now() + interval '11 days')::text);   -- the events carry the real clock

select is(pg_temp.complaints(), '0', 'C4 eleven days later the count is zero: the pause lifts by itself');
select is(pg_temp.today_has_pause('a_owner'), 'false', 'C5 ... and the item is gone');

select * from finish();
rollback;
