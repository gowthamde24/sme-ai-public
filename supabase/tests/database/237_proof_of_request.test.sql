-- Proof of request for a call-back (migration 20261231982700; owner, 18 Nov 2026): found by the database, written/digital sources only, at most 7 days since 21 Nov 2026 (TRAI Third Amendment, migration 20261231987300), never a list.
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
create function pg_temp.proof(p_lead text) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select coalesce(public.call_back_proof(%L, %L)::text, 'null')$q$, tests.tid('a'), tests.rid(p_lead))) $$;
create function pg_temp.src(p_lead text) returns text language sql as $$ select (pg_temp.proof(p_lead)::jsonb) ->> 'source' $$;

insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Proof Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent) values
  (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Web Person', '+91 98333 10001', 'granted'),
  (tests.rid('k2'), tests.tid('a'), tests.rid('co'), 'Imported Person', '+91 98333 10002', 'granted'),
  (tests.rid('k3'), tests.tid('a'), tests.rid('co'), 'Old Request', '+91 98333 10003', 'granted'),
  (tests.rid('k4'), tests.tid('a'), tests.rid('co'), 'Owner Typed', '+91 98333 10004', 'granted'),
  (tests.rid('k5'), tests.tid('a'), tests.rid('co'), 'Whatsapper', '+91 98333 10005', 'granted'),
  (tests.rid('k6'), tests.tid('a'), tests.rid('co'), 'Caller', '+91 98333 10006', 'granted'),
  (tests.rid('k7'), tests.tid('a'), tests.rid('co'), 'Prospect', '+91 98333 10007', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values
  (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('k1'), 'website_form', '2026-11-14T10:00:00+05:30'),
  (tests.rid('l2'), tests.tid('a'), tests.rid('co'), tests.rid('k2'), 'excel_upload', '2026-11-15T10:00:00+05:30'),
  (tests.rid('l3'), tests.tid('a'), tests.rid('co'), tests.rid('k3'), 'website_form', '2026-10-04T10:00:00+05:30'),
  (tests.rid('l4'), tests.tid('a'), tests.rid('co'), tests.rid('k4'), 'manual', '2026-11-16T10:00:00+05:30'),
  (tests.rid('l5'), tests.tid('a'), tests.rid('co'), tests.rid('k5'), 'manual', '2026-11-16T10:00:00+05:30'),
  (tests.rid('l6'), tests.tid('a'), tests.rid('co'), tests.rid('k6'), 'manual', '2026-11-16T10:00:00+05:30'),
  (tests.rid('l7'), tests.tid('a'), tests.rid('co'), tests.rid('k7'), 'lead_finder', '2026-11-16T10:00:00+05:30');

-- A. what counts
select is(pg_temp.src('l1'), 'website_form', 'P1 a website form enquiry 4 days ago is a proof');
select is((pg_temp.proof('l1')::jsonb ->> 'lead_id'), tests.rid('l1')::text, 'P2 ... for that lead');
select is(pg_temp.proof('l2'), 'null', 'P3 an imported list never counts, even with consent granted');
select is(pg_temp.proof('l4'), 'null', 'P4 a lead the owner typed in does not count');
select is(pg_temp.proof('l7'), 'null', 'P5 a Lead Finder prospect does not count');
select is(pg_temp.proof('l3'), 'null', 'P6 a website enquiry from 45 days ago is too old (the window is 7 days)');

-- B. an arrival through a live source, a WhatsApp message and a call the person made
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, received_at) values (tests.tid('a'), tests.rid('l3'), tests.rid('k3'), 'meta_lead_ads', 'again', '2026-11-12T10:00:00+05:30');
select is(pg_temp.src('l3'), 'meta_lead_ads', 'P7 the same person enquires again through a Meta lead ad 6 days ago: a proof');
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, received_at) values (tests.tid('a'), tests.rid('l2'), tests.rid('k2'), 'pasted_list', 'repeat', '2026-11-17T10:00:00+05:30');
select is(pg_temp.proof('l2'), 'null', 'P8 an arrival from a pasted list (kind repeat) does not count');
insert into public.enquiries (id, tenant_id, lead_id, company_id, contact_id, channel, received_at, body, body_sha256, retain_until, created_via)
values (gen_random_uuid(), tests.tid('a'), tests.rid('l5'), tests.rid('co'), tests.rid('k5'), 'whatsapp', '2026-11-17T09:00:00+05:30', 'Price please', repeat('a', 64), '2027-11-17', 'agent');
select is(pg_temp.src('l5'), 'whatsapp', 'P9 a WhatsApp message the person sent is a proof');
insert into public.phone_calls (id, tenant_id, direction, state, provider, sandbox, contact_id, lead_id, created_at, ended_at)
values (gen_random_uuid(), tests.tid('a'), 'inbound', 'completed', 'plivo', false, tests.rid('k6'), tests.rid('l6'), '2026-11-17T11:00:00+05:30', '2026-11-17T11:02:00+05:30');
select is(pg_temp.proof('l6'), 'null', 'P10 a call the person made to the business is NOT a proof (phone only: not written or digital)');
select pg_temp.pin('2026-12-20T12:00:00+05:30');
select is(pg_temp.proof('l5'), 'null', 'P11 a month later the same WhatsApp message is too old');
select pg_temp.pin('2026-11-18T12:00:00+05:30');

-- C. the call row keeps it; who may ask
insert into public.phone_calls (id, tenant_id, direction, state, provider, sandbox, contact_id, lead_id) values (tests.rid('c1'), tests.tid('a'), 'outbound', 'queued', 'plivo', true, tests.rid('k1'), tests.rid('l1'));
select is(pg_temp.val('outsider', format($q$select public.phone_call_set_proof(%L, %L)::jsonb ->> 'source'$q$, tests.tid('a'), tests.rid('c1'))), 'website_form', 'P12 the phone server keeps the proof on the call row');
select is((select request_source || '/' || (request_lead_id = tests.rid('l1'))::text from public.phone_calls where id = tests.rid('c1')), 'website_form/true', 'P13 the row has the lead and the source');
select is((select request_at from public.phone_calls where id = tests.rid('c1')), '2026-11-14T10:00:00+05:30'::timestamptz, 'P14 ... and when the person asked');
select is(pg_temp.val('b_owner', format($q$select public.call_back_proof(%L, %L)::text$q$, tests.tid('a'), tests.rid('l1'))), 'ERR:42501', 'P15 another workspace''s Owner is refused');
select is(pg_temp.val('a_sales', format($q$select public.call_back_proof(%L, %L)::text$q$, tests.tid('a'), tests.rid('l1'))), 'ERR:42501', 'P16 Sales is not the one who decides a call-back');
select lives_ok($q$insert into public.phone_calls (id, tenant_id, direction, state, refuse_reason, provider, sandbox, ended_at) values (gen_random_uuid(), tests.tid('a'), 'outbound', 'refused', 'no_proof_of_request', 'plivo', false, now())$q$, 'P17 the closed word no_proof_of_request is a legal refusal');

select * from finish();
rollback;
