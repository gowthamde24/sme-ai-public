-- A repeat enquiry is a new enquiry (migration 20261231980500; owner, 17 Nov 2026): a known contact enquiring again through a LIVE source is an arrival `again`, reopens a lost lead, fires the standing rule,
-- shows on Today, and is silent only as a true duplicate (same words, same source, 10 minutes). A pasted or uploaded list is none of that.
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

-- a known customer with a lead from the website, and a live Website source with its consent confirmation
insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Repeat Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent) values
  (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Kiran One', '+91 98333 00001', 'granted', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('k1'), 'website_form', '2026-10-20T10:00:00+05:30');
select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%s, %s, 'website_form', 'website_form', 'Website form', %L, 'wxyz', %s, '{"list_name": "Website", "purpose": "Reply to enquiries", "basis": "legitimate_use", "how_collected": "They filled our form"}'::jsonb, 2500) -> 'source' ->> 'id')$q$,
  pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.h('token-one'), pg_temp.rid('c2'))), tests.rid('s1')::text, 'S1 (setup) a live Website source');
select is(pg_temp.j(pg_temp.val('a_owner', format($q$select public.outreach_rule_save(%s, %L::jsonb)::text$q$, pg_temp.tid('a'),
  format('{"rule_id": "%s", "source": "website_form", "action": "call_within_minutes", "within_minutes": 0, "goal": "general", "channel": "call", "language": "auto", "questions": []}', tests.rid('r1')))), 'active'), 'true', 'S2 (setup) the standing rule on the Website form is on');

create function pg_temp.live(p_msg text, p_phone text default '+919833300001') returns text language sql as $$
  select pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, jsonb_build_array(jsonb_build_object('name', 'Kiran One', 'phone', %L, 'message', %L)))::text$q$, pg_temp.h('token-one'), p_phone, p_msg)) $$;
create function pg_temp.arrivals(p_kind text) returns bigint language sql as $$ select count(*) from public.lead_arrivals where lead_id = tests.rid('l1') and kind = p_kind $$;
create function pg_temp.scan() returns text language sql as $$ select pg_temp.j(pg_temp.w('select public.scheduler_outreach_scan(200)::text'), 'added') $$;

-- A. a known contact enquires again
select pg_temp.pin('2026-11-02T11:05:00+05:30');
select is(pg_temp.j(pg_temp.live('Need price for bridal sarees'), 'status'), 'received', 'A1 the form is accepted');
select is(pg_temp.j(pg_temp.live('Do you have red sarees today?'), 'again'), '1', 'A2 the intake says one enquiry was AGAIN');
select is(pg_temp.arrivals('again'), 2::bigint, 'A3 two different enquiries are two arrivals on the known lead');
select is((select count(*) from public.leads where contact_id = tests.rid('k1')), 1::bigint, 'A4 still one lead: the customer is not duplicated');
select is((select count(*) from public.contacts where tenant_id = tests.tid('a') and full_name = 'Kiran One'), 1::bigint, 'A5 ... nor the contact');

-- B. only a true duplicate is silent
select is(pg_temp.j(pg_temp.live('Need price for bridal sarees!'), 'counts.already_imported'), '1', 'B1 the same words (punctuation aside) within 10 minutes is a double submit: counted as already received');
select is(pg_temp.j(pg_temp.live('NEED  price for bridal sarees'), 'problems') like '%duplicate_within_10_min%', true, 'B2 ... with the closed reason duplicate_within_10_min');
select is(pg_temp.arrivals('again'), 2::bigint, 'B3 ... and nothing more is stored');
select pg_temp.pin('2026-11-02T11:20:00+05:30');
select is(pg_temp.j(pg_temp.live('Need price for bridal sarees'), 'again'), '1', 'B4 the same words 15 minutes later are a new enquiry');
select is(pg_temp.arrivals('again'), 3::bigint, 'B5 ... stored');
select is(pg_temp.j(pg_temp.live(''), 'again'), '1', 'B6 an empty message is a different enquiry from one with words');
select is(pg_temp.j(pg_temp.live(''), 'counts.already_imported'), '1', 'B7 ... but two empty ones within 10 minutes are a double submit');

-- C. a lost lead comes back
update public.leads set status = 'disqualified', disqualified_reason = 'too expensive' where id = tests.rid('l1');
select pg_temp.pin('2026-11-02T12:00:00+05:30');
select pg_temp.live('I would like to order after all');
select is((select status from public.leads where id = tests.rid('l1')), 'new', 'C1 a lead the shop had closed is reopened by the customer enquiring again');
update public.leads set status = 'in_review' where id = tests.rid('l1');
select pg_temp.pin('2026-11-02T12:30:00+05:30');
select pg_temp.live('Please call me');
select is((select status from public.leads where id = tests.rid('l1')), 'in_review', 'C2 a lead in progress is not moved');

-- D. the standing rule takes the arrival
update public.leads set status = 'new' where id = tests.rid('l1');
select is(pg_temp.scan(), '1', 'D1 the rule scan makes ONE item for the lead (the arrivals before it are one open item, not several)');
select is((select status from public.outreach_items where lead_id = tests.rid('l1') and rule_id = tests.rid('r1')), 'waiting', 'D2 it waits for the call');
select pg_temp.pin('2026-11-02T13:00:00+05:30');
select pg_temp.live('Another question about the saree border');
select is(pg_temp.scan(), '0', 'D3 a new arrival while the item is still open starts no second ladder');
update public.outreach_items set status = 'done', next_action = null, next_at = null, then_action = null, then_at = null where lead_id = tests.rid('l1');
select pg_temp.pin('2026-11-02T14:00:00+05:30');
select pg_temp.live('Back again with a new question');
select is(pg_temp.scan(), '1', 'D4 once the first item is done, the next enquiry gets its own');
select is((select count(*) from public.outreach_items where lead_id = tests.rid('l1') and rule_id = tests.rid('r1')), 2::bigint, 'D5 two items for the lead, each for its own arrival');
select is(pg_temp.scan(), '0', 'D6 a second pass adds nothing');

-- E. Today
create function pg_temp.today_has() returns boolean language sql as $$
  select (pg_temp.val('a_owner', format($q$select jsonb_path_exists(public.today_summary(%s) -> 'needs_you', '$[*] ? (@.kind == "enquired_again")')::text$q$, pg_temp.tid('a')))) = 'true' $$;
select is(pg_temp.today_has(), true, 'E1 an enquiry again is on Today for the Owner');
select is(pg_temp.val('a_owner', format($q$select (select count(*) from jsonb_array_elements(public.today_summary(%s) -> 'needs_you') e where e ->> 'kind' = 'enquired_again')::text$q$, pg_temp.tid('a'))), '1', 'E2 once per customer, not once per message');
update public.leads set status = 'in_review' where id = tests.rid('l1');
select is(pg_temp.today_has(), true, 'E3 it stays on Today when the lead is already in progress: the enquiry is new information');
update public.leads set status = 'new' where id = tests.rid('l1');
select pg_temp.pin('2026-11-06T14:00:00+05:30');
select is(pg_temp.today_has(), false, 'E4 ... and after three days');

-- F. a pasted or uploaded list is not an enquiry
select pg_temp.pin('2026-11-02T15:00:00+05:30');
select is(pg_temp.val('a_owner', format($q$select public.lead_intake_apply(%s, %s, %s, 1, 'paste', 'pasted_list', null, jsonb_build_array(jsonb_build_object('name', 'Kiran One', 'phone', '+919833300001')), null, false) #>> '{counts,duplicates_merged}'$q$,
  pg_temp.tid('a'), pg_temp.rid('i9'), pg_temp.rid('imp9'))), '1', 'F1 a list that holds a known customer merges them');
select is((select count(*) from public.lead_arrivals where lead_id = tests.rid('l1') and kind = 'repeat'), 1::bigint, 'F2 ... as a quiet repeat, not an enquiry');
select is((select count(*) from public.lead_arrivals where lead_id = tests.rid('l1') and kind = 'again'), 8::bigint, 'F3 (the enquiries stay as they were)');

select * from finish();
rollback;
