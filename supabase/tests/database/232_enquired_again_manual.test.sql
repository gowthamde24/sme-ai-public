-- "Enquired again" leaves Today only when a PERSON handles it (migration 20261231982200; owner, 18 Nov 2026): a typed reply, a call a person placed, Done, or opening the lead.
-- Automated sends (the standing rule's first-message template, an auto-reply) and a call the rule placed do not clear it.
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
create function pg_temp.tid(p text) returns text language sql as $$ select quote_literal(tests.tid(p)) $$;
create function pg_temp.today_has() returns boolean language sql as $$
  select (pg_temp.val('a_owner', format($q$select jsonb_path_exists(public.today_summary(%s) -> 'needs_you', '$[*] ? (@.kind == "enquired_again")')::text$q$, pg_temp.tid('a')))) = 'true' $$;
-- a new enquiry again at 11:00 on the lead
create function pg_temp.enquire(p_at text) returns void language plpgsql as $$
begin
  update public.lead_arrivals set handled_at = null, handled_by = null where lead_id = tests.rid('l1');
  insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, received_at) values (tests.tid('a'), tests.rid('l1'), tests.rid('k1'), 'website_form', 'again', p_at::timestamptz);
end $$;
create function pg_temp.msg(p_source text, p_at text) returns void language plpgsql as $$
begin
  insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, source, status, reason, request_sha256, created_by, created_at)
  values (gen_random_uuid(), tests.tid('a'), tests.rid('l1'), tests.rid('k1'), 'whatsapp', 'Hello', 'en', 'info', p_source, 'needs_approval', 'category_other', repeat('1', 64), tests.uid('a_owner'), p_at::timestamptz);
end $$;

insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Manual Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent) values
  (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Kiran One', '+91 98333 00001', 'granted', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('k1'), 'website_form', '2026-10-20T10:00:00+05:30');

select pg_temp.enquire('2026-11-02T10:55:00+05:30');
select is(pg_temp.today_has(), true, 'M1 an enquiry again is on Today');

-- automated: nothing clears it
select pg_temp.msg('system', '2026-11-02T10:55:30+05:30');
select is(pg_temp.today_has(), true, 'M2 the standing rule''s first-message template (source system) does not clear it');
select pg_temp.msg('assistant', '2026-11-02T10:56:00+05:30');
select is(pg_temp.today_has(), true, 'M3 an auto-reply (source assistant) does not clear it');
insert into public.phone_calls (tenant_id, direction, state, lead_id, contact_id, provider, created_by, created_at, ended_at, outreach_item_id)
values (tests.tid('a'), 'outbound', 'no_answer', tests.rid('l1'), tests.rid('k1'), 'sandbox', tests.uid('a_owner'), '2026-11-02T10:57:00+05:30', '2026-11-02T10:57:30+05:30', gen_random_uuid());
select is(pg_temp.today_has(), true, 'M4 a call placed by a standing rule (it carries an outreach item) does not clear it');

-- a person: a typed reply
select pg_temp.msg('owner', '2026-11-02T10:58:00+05:30');
select is(pg_temp.today_has(), false, 'M5 a message from the owner clears it');

-- a person: a call
select pg_temp.enquire('2026-11-02T11:10:00+05:30');
select pg_temp.pin('2026-11-02T11:20:00+05:30');
select is(pg_temp.today_has(), true, 'M6 a new enquiry shows again');
insert into public.phone_calls (tenant_id, direction, state, refuse_reason, lead_id, contact_id, provider, created_by, created_at, ended_at)
values (tests.tid('a'), 'outbound', 'refused', 'outside_hours', tests.rid('l1'), tests.rid('k1'), 'sandbox', tests.uid('a_owner'), '2026-11-02T11:12:00+05:30', '2026-11-02T11:12:01+05:30');
select is(pg_temp.today_has(), true, 'M7 a call that was refused (never placed) does not clear it');
insert into public.phone_calls (tenant_id, direction, state, lead_id, contact_id, provider, created_by, created_at, ended_at)
values (tests.tid('a'), 'outbound', 'completed', tests.rid('l1'), tests.rid('k1'), 'sandbox', tests.uid('a_owner'), '2026-11-02T11:15:00+05:30', '2026-11-02T11:16:00+05:30');
select is(pg_temp.today_has(), false, 'M8 a call a person placed clears it');

-- opening the lead
select pg_temp.enquire('2026-11-02T11:30:00+05:30');
select pg_temp.pin('2026-11-02T11:40:00+05:30');
select is(pg_temp.today_has(), true, 'M9 a new enquiry shows again');
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_open(%s, %L)::text$q$, pg_temp.tid('a'), tests.rid('l1'))), 'true', 'M10 the owner opens the lead');
select is(pg_temp.today_has(), false, 'M11 opening the lead clears it');
select is((select count(*) from public.lead_arrivals where lead_id = tests.rid('l1') and handled_at is not null and handled_by = tests.uid('a_owner')), 3::bigint, 'M12 ... and writes down who did it (all the lead''s enquiries so far)');

-- Done
select pg_temp.enquire('2026-11-02T11:45:00+05:30');
select is(pg_temp.today_has(), true, 'M13 a new enquiry shows again');
select is(pg_temp.val('a_owner', format($q$select public.today_enquired_again_done(%s, %L)::text$q$, pg_temp.tid('a'), tests.rid('l1'))), '4', 'M14 Done marks the lead''s open enquiries handled');
select is(pg_temp.today_has(), false, 'M15 Done clears it');
select is(pg_temp.val('a_owner', format($q$select public.today_enquired_again_done(%s, %L)::text$q$, pg_temp.tid('a'), tests.rid('l1'))), '0', 'M16 a second Done changes nothing');

-- others
select pg_temp.enquire('2026-11-02T11:50:00+05:30');
select is(pg_temp.val('b_owner', format($q$select public.today_enquired_again_done(%s, %L)::text$q$, pg_temp.tid('a'), tests.rid('l1'))), 'ERR:SM090' , 'M17 another workspace''s Owner cannot mark it');
select is(pg_temp.val('anon', format($q$select public.today_enquired_again_done(%s, %L)::text$q$, pg_temp.tid('a'), tests.rid('l1'))) like 'ERR:%', true, 'M18 nobody signed in cannot either');
select is(pg_temp.today_has(), true, 'M19 ... and it is still on Today');
select pg_temp.pin('2026-11-06T11:50:00+05:30');
select is(pg_temp.today_has(), false, 'M20 after three days it leaves by itself');

select * from finish();
rollback;
