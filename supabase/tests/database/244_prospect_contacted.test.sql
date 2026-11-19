-- Lead Finder "Mark as contacted" and the outbox guard (migration 20261231984700; owner, 19 Nov 2026).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'textiles');
select tests.cp_pack('b', 'textiles');
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Prospect Co');
insert into public.prospects (id, tenant_id, name, name_key, phone, phone_key, source, source_label, place_id, status, fit)
values (tests.rid('z1'), tests.tid('a'), 'Padma Sarees', 'padma sarees', '+91 98444 30001', '919844430001', 'fixture', 'Made-up', 'place:z1', 'call_ready', 80),
       (tests.rid('z2'), tests.tid('a'), 'Gone Sarees', 'gone sarees', '+91 98444 30009', '919844430009', 'fixture', 'Made-up', 'place:z2', 'not_interested', 20);
update public.prospects set suppressed = true where id = tests.rid('z2');

create temp table before_counts as select (select count(*)::int from public.task_contacts) + (select count(*)::int from public.outreach_items) + (select count(*)::int from public.phone_calls) as n;
grant select on before_counts to public;
-- A. marking
select is(pg_temp.val('a_sales', format($q$select (public.prospect_mark_contacted(%L, %L, now() - interval '2 days', 'Spoke to the owner; visit on Saturday')) ->> 'status'$q$, tests.tid('a'), tests.rid('z1'))), 'contacted', 'A1 Sales mark a prospect as contacted');
select is((select contact_note from public.prospects where id = tests.rid('z1')), 'Spoke to the owner; visit on Saturday', 'A2 the note is kept');
select is((select contacted_by from public.prospects where id = tests.rid('z1')), tests.uid('a_sales'), 'A3 and who did it');
select ok((select last_contacted_at from public.prospects where id = tests.rid('z1')) < now() - interval '1 day', 'A4 and when (two days ago)');
select is(pg_temp.val('a_owner', format($q$select (public.prospect_mark_contacted(%L, %L))::jsonb ->> 'contact_note'$q$, tests.tid('a'), tests.rid('z1'))), 'Spoke to the owner; visit on Saturday', 'A5 again without a note: the note stays; the time is now (idempotent)');
select ok((select last_contacted_at from public.prospects where id = tests.rid('z1')) > now() - interval '1 minute', 'A6 the time was refreshed');
select is(pg_temp.val('a_owner', format($q$select public.prospect_mark_contacted(%L, %L, now() + interval '1 day')::text$q$, tests.tid('a'), tests.rid('z1'))), 'ERR:22023', 'A7 not in the future');
select is(pg_temp.val('a_owner', format($q$select public.prospect_mark_contacted(%L, %L, now() - interval '61 days')::text$q$, tests.tid('a'), tests.rid('z1'))), 'ERR:22023', 'A8 not more than 60 days back');
select is(pg_temp.val('a_owner', format($q$select public.prospect_mark_contacted(%L, %L, null, %L)::text$q$, tests.tid('a'), tests.rid('z1'), repeat('x', 501))), 'ERR:22023', 'A9 a note is at most 500 characters');
select is(pg_temp.val('a_owner', format($q$select public.prospect_mark_contacted(%L, %L)::text$q$, tests.tid('a'), tests.rid('z2'))), 'ERR:SM973', 'A10 a suppressed prospect is refused');
select is(pg_temp.val('b_owner', format($q$select public.prospect_mark_contacted(%L, %L)::text$q$, tests.tid('b'), tests.rid('z1'))), 'ERR:23503', 'A11 another workspace has no such prospect');
select is(pg_temp.val('a_viewer', format($q$select public.prospect_mark_contacted(%L, %L)::text$q$, tests.tid('a'), tests.rid('z1'))), 'ERR:42501', 'A12 a Viewer may not');
select is(pg_temp.val('anon', format($q$select public.prospect_mark_contacted(%L, %L)::text$q$, tests.tid('a'), tests.rid('z1'))), 'ERR:42501', 'A13 nor anyone signed out');
select is((select count(*)::int from public.task_contacts) + (select count(*)::int from public.outreach_items) + (select count(*)::int from public.phone_calls), (select n from pg_temp.before_counts), 'A14 marking creates no task, outreach item or call');

-- B. the outbox never carries a prospect
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Padma Sarees', '+91 98444 30001'), (tests.rid('k2'), tests.tid('a'), tests.rid('co'), 'A Customer', '+91 98444 30002');
insert into public.leads (id, tenant_id, company_id, contact_id, source) values (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('k1'), 'lead_finder'), (tests.rid('l2'), tests.tid('a'), tests.rid('co'), tests.rid('k2'), 'website_form');
insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, request_sha256, created_by)
values (tests.rid('m1'), tests.tid('a'), tests.rid('l1'), tests.rid('k1'), tests.rid('co'), 'whatsapp', 'Hello, we sell silk sarees', 'en', 'info', 'owner', 'queued', 'owner_approved', repeat('a', 64), tests.uid('a_owner')),
       (tests.rid('m2'), tests.tid('a'), tests.rid('l2'), tests.rid('k2'), tests.rid('co'), 'whatsapp', 'Hello, thanks for asking', 'en', 'info', 'owner', 'queued', 'owner_approved', repeat('b', 64), tests.uid('a_owner'));
select is((select status || '/' || reason from public.outbox_messages where id = tests.rid('m1')), 'blocked/no_opt_in', 'B1 a message to a prospect is made as blocked, nothing is sent');
select is((select status from public.outbox_messages where id = tests.rid('m2')), 'queued', 'B2 a message to a real customer is queued as before');
select throws_ok(format($q$update public.outbox_messages set status = 'needs_approval', reason = 'owner_approved' where id = %L$q$, tests.rid('m1')), null, 'an outbox message cannot move from blocked to needs_approval', 'B3 it cannot be moved back to a sendable state');
-- the prospect writes to us: a proof of request, so a reply is allowed
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, received_at) values (tests.tid('a'), tests.rid('l1'), tests.rid('k1'), 'website_form', 'first', now());
insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, request_sha256, created_by)
values (tests.rid('m3'), tests.tid('a'), tests.rid('l1'), tests.rid('k1'), tests.rid('co'), 'whatsapp', 'Yes, we have', 'en', 'reply_to_inbound', 'owner', 'queued', 'owner_approved', repeat('c', 64), tests.uid('a_owner'));
select is((select status from public.outbox_messages where id = tests.rid('m3')), 'queued', 'B4 once the person wrote to us (a proof of request) a reply is queued: a prospect who enquires is a normal lead');
select * from finish();
rollback;
