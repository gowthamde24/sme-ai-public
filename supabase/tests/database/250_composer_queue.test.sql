-- The Chats composer queue (migration 20261231985700; owner, 19 Nov 2026): what the owner types while a chat's 24-hour window is CLOSED waits for the customer's reply and is then released into the outbox
-- as an owner-typed reply, which goes AT ONCE (the night rule). The assistant does NOT also answer that reply.
--   A who may use it   B refusals (window open, no WhatsApp, no consent, hello not approved: nothing is queued)   C create, retry, one waiting per chat   D cancel
--   E it runs out after 7 days   F the customer's reply releases it (at night too)   G the assistant does not answer a released reply
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select app.operator_set_outbox(true);
select app.operator_register_scheduler('outsider@test.local');
select app.operator_enable_assistant((select slug from public.tenants where id = tests.tid('a')));

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
-- a customer: contact + lead + the suppression key + (optionally) the WhatsApp consent
create function pg_temp.mk(p_label text, p_tenant text default 'a', p_consent boolean default true) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone)
  values (tests.rid(p_label || '_c'), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'Contact ' || p_label, '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), tests.rid(p_label || '_c'));
  if p_tenant = 'a' then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
    if p_consent then
      perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:cq')$q$, tests.tid(p_tenant), tests.rid(p_label || '_c')));
    end if;
  end if;
end $$;
create function pg_temp.inbound(p_lead text, p_at text, p_body text default 'Is the green saree in stock?') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, created_via) values (v, tests.tid('a'), tests.rid(p_lead), 'whatsapp', p_at::timestamptz, p_body, 'manual');
  return v;
end $$;
create function pg_temp.q(p_lead text, p_text text, p_client text, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.queued_reply_create(%L, %L, %L, %L)::text$q$, tests.tid('a'), tests.rid(p_lead), p_text, tests.rid(p_client)))
$$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.pending() returns jsonb language plpgsql as $$
declare r text;
begin r := pg_temp.sch('select public.scheduler_auto_reply_pending(10)::text'); return case when r like 'ERR:%' then jsonb_build_array(r) else r::jsonb end; end $$;
create function pg_temp.has(p_enq uuid) returns boolean language sql as $$ select exists (select 1 from jsonb_array_elements(pg_temp.pending()) e where e ->> 'enquiry_id' = p_enq::text) $$;
create function pg_temp.mkt(p_id text, p_name text, p_body text) returns void language plpgsql as $$
begin
  perform pg_temp.sc('a_owner', format($q$select public.wa_template_save(%L, %L, %L, 'en', 'utility', 'followup', %L, null)$q$, tests.rid(p_id), tests.tid('a'), p_name, p_body));
  perform pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'submitted')$q$, tests.tid('a'), tests.rid(p_id)));
  perform pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'approved')$q$, tests.tid('a'), tests.rid(p_id)));
end $$;

update public.platform_flags set enabled = true where key = 'outbox_enabled';
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.auto_reply_set(%L, true)::text$q$, tests.tid('a')));

-- the customers: each wrote once, long ago (the window is closed unless a test says otherwise)
select pg_temp.pin(timestamptz '2026-10-30 14:00:00+05:30');
select pg_temp.mk('cq1'); select pg_temp.mk('cq2'); select pg_temp.mk('cq3'); select pg_temp.mk('cq4'); select pg_temp.mk('cq5'); select pg_temp.mk('cq6', 'a', false); select pg_temp.mk('cqb', 'b');
select pg_temp.inbound('cq1', '2026-10-30 13:00:00+05:30', 'Hello');
select pg_temp.inbound('cq2', '2026-10-30 13:00:00+05:30', 'Hello');
select pg_temp.inbound('cq3', '2026-10-30 13:00:00+05:30', 'Hello');
select pg_temp.inbound('cq4', '2026-10-30 13:00:00+05:30', 'Hello');
select pg_temp.inbound('cq5', '2026-10-30 13:00:00+05:30', 'Hello');

-- A. who may use it
select pg_temp.pin(timestamptz '2026-11-01 14:00:00+05:30');
select is(pg_temp.q('cq1', 'We have it in stock.', 'cq_c0', 'a_viewer'), 'ERR:42501', 'A1 a viewer cannot queue a message');
select is(pg_temp.q('cq1', 'We have it in stock.', 'cq_c0', 'b_owner'), 'ERR:42501', 'A2 nor another business');
select is(pg_temp.sc('a_viewer', format($q$select public.queued_reply_attention(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A3 a viewer does not read what needs the owner');
select is(pg_temp.sc('a_sales', format($q$select public.queued_reply_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('cq1')))::jsonb, '{"queued": null}'::jsonb, 'A4 Sales reads the chat: nothing queued yet');
select is(pg_temp.q('cq1', '', 'cq_c0'), 'ERR:22023', 'A5 an empty message is refused');

-- B. refusals: nothing is queued
select is(pg_temp.q('cq1', 'We have it in stock.', 'cq_c1'), 'ERR:SM997', 'B1 the "continue chat" hello is not approved yet: refused at once');
select is((select count(*)::int from public.queued_replies where tenant_id = tests.tid('a')), 0, 'B2 ... and nothing was queued');
select pg_temp.mkt('cq_tpl', 'continue_chat', 'Hi {{1}}, you contacted {{2}} about {{3}}. Reply here if you would like to continue.');
select is(pg_temp.q('cq6', 'We have it in stock.', 'cq_c2'), 'ERR:SM992', 'B3 a customer who never wrote and never agreed to WhatsApp: refused');
select is(pg_temp.sc('b_owner', format($q$select public.queued_reply_create(%L, %L, 'We have it.', %L)::text$q$, tests.tid('b'), tests.rid('cqb'), tests.rid('cq_c3'))), 'ERR:SM994', 'B4 a business without a connected WhatsApp: refused');
select pg_temp.pin(timestamptz '2026-10-30 14:30:00+05:30');
select is(pg_temp.q('cq1', 'We have it in stock.', 'cq_c4'), 'ERR:SM990', 'B5 the customer wrote 30 minutes ago: the window is open, so the owner just sends it');
select pg_temp.pin(timestamptz '2026-11-01 14:00:00+05:30');
select is((select count(*)::int from public.queued_replies where tenant_id = tests.tid('a')), 0, 'B6 still nothing queued');

-- C. create, retry, one waiting per chat
select is(pg_temp.q('cq1', 'We have it in stock.', 'cq_c5')::jsonb ->> 'status', 'waiting_for_reply', 'C1 a message is queued: waiting for the reply');
select is((select continue_chat from public.queued_replies where client_id = tests.rid('cq_c5')), 'sent', 'C2 the hello went with it');
select is((select count(*)::int from public.outbox_messages where id = (select template_message_id from public.queued_replies where client_id = tests.rid('cq_c5'))), 1, 'C3 ... as a message in the outbox');
select is(pg_temp.q('cq1', 'We have it in stock.', 'cq_c5')::jsonb ->> 'id', (select id::text from public.queued_replies where client_id = tests.rid('cq_c5')), 'C4 the same client id is the same message');
select is((select count(*)::int from public.queued_replies where lead_id = tests.rid('cq1')), 1, 'C5 ... not a second row');
select is(pg_temp.q('cq1', 'Something else.', 'cq_c6'), 'ERR:SM995', 'C6 only ONE message can wait in a chat');
select is(pg_temp.sc('a_sales', format($q$select public.queued_reply_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('cq1')))::jsonb -> 'queued' ->> 'text', 'We have it in stock.', 'C7 the chat shows the waiting message');
select is((select expires_at from public.queued_replies where client_id = tests.rid('cq_c5')), timestamptz '2026-11-08 14:00:00+05:30', 'C8 it runs out in 7 days');

-- D. cancel
select is(pg_temp.q('cq2', 'Ready on Friday.', 'cq_d1')::jsonb ->> 'status', 'waiting_for_reply', 'D1 another chat has one waiting');
select is(pg_temp.sc('a_owner', format($q$select public.queued_reply_cancel(%L, %L)::text$q$, tests.tid('a'), (select id from public.queued_replies where client_id = tests.rid('cq_d1'))))::jsonb ->> 'status', 'cancelled', 'D2 the owner cancels it');
select is(pg_temp.sc('a_owner', format($q$select public.queued_reply_cancel(%L, %L)::text$q$, tests.tid('a'), (select id from public.queued_replies where client_id = tests.rid('cq_d1')))), 'ERR:SM996', 'D3 cancelling twice: it is not waiting');
select is(pg_temp.q('cq2', 'Ready on Friday, sorry.', 'cq_d2')::jsonb ->> 'continue_chat', 'already', 'D4 a NEW message may follow at once; the hello already went in the last 24 hours');
select pg_temp.sc('a_owner', format($q$select public.queued_reply_cancel(%L, %L)::text$q$, tests.tid('a'), (select id from public.queued_replies where client_id = tests.rid('cq_d2'))));

-- E. it runs out after 7 days
select is(pg_temp.q('cq4', 'Your order is ready.', 'cq_e1')::jsonb ->> 'status', 'waiting_for_reply', 'E1 a message waits in another chat');
select pg_temp.pin(timestamptz '2026-11-10 09:00:00+05:30');
select is(pg_temp.sc('a_owner', format($q$select public.queued_reply_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('cq4')))::jsonb -> 'queued' ->> 'status', 'expired', 'E2 9 days later it shows as expired');
select is((select count(*)::int from jsonb_array_elements(pg_temp.sc('a_owner', format($q$select public.queued_reply_attention(%L)::text$q$, tests.tid('a')))::jsonb) x where x ->> 'status' = 'expired'), 2, 'E3 and "Needs you" lists it, and the other one that ran out (Call instead)');
select pg_temp.inbound('cq4', '2026-11-10 08:55:00+05:30', 'Hello?');
select is((select status || '/' || failure_code from public.queued_replies where client_id = tests.rid('cq_e1')), 'failed/expired', 'E4 a reply that comes too late releases nothing');
select is((select count(*)::int from public.outbox_messages where id = (select outbox_message_id from public.queued_replies where client_id = tests.rid('cq_e1'))), 0, 'E5 ... nothing went to the customer');

-- F. the customer's reply releases it, at night too
select pg_temp.pin(timestamptz '2026-11-14 14:00:00+05:30');
select is(pg_temp.q('cq3', 'The blue one is in stock.', 'cq_f1')::jsonb ->> 'status', 'waiting_for_reply', 'F1 a message waits in a third chat (the clock is Saturday 14:00)');
select pg_temp.pin(timestamptz '2026-11-14 23:00:00+05:30');
create temp table qf as select pg_temp.inbound('cq3', '2026-11-14 22:55:00+05:30', 'Yes please') as e;
select is((select status from public.queued_replies where client_id = tests.rid('cq_f1')), 'released', 'F2 the customer wrote back at night: the message is released');
select is((select m.category || '/' || m.source from public.outbox_messages m where m.id = (select outbox_message_id from public.queued_replies where client_id = tests.rid('cq_f1'))), 'reply_to_inbound/owner', 'F3 it is an owner-typed REPLY in the outbox');
select is((select m.scheduled_for from public.outbox_messages m where m.id = (select outbox_message_id from public.queued_replies where client_id = tests.rid('cq_f1'))), timestamptz '2026-11-14 23:00:00+05:30', 'F4 it goes AT ONCE (23:00), not at 09:00 (the night rule), although the workspace''s automatic sending is off: the owner typed it');
select is((select m.status || '/' || m.reason from public.outbox_messages m where m.id = (select outbox_message_id from public.queued_replies where client_id = tests.rid('cq_f1'))), 'queued/owner_approved', 'F4b it is queued as approved by the owner');
select is(pg_temp.sc('a_owner', format($q$select public.queued_reply_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('cq3')))::jsonb -> 'queued' ->> 'status', 'sending', 'F5 the chat shows it as sending');
select is(pg_temp.q('cq3', 'And the red one too.', 'cq_f2'), 'ERR:SM990', 'F6 right after the reply the window is open again: the owner just sends it, nothing is queued');

-- G. the assistant does not also answer the released reply (the hello went before the reply: its row is put back in time so only the released message can hold the assistant back)
update public.outbox_messages set created_at = timestamptz '2026-11-14 14:00:00+05:30' where id = (select template_message_id from public.queued_replies where client_id = tests.rid('cq_f1'));
select is(pg_temp.has((select e from qf)), false, 'G1 the assistant does NOT answer the customer''s reply that released the owner''s message');
create temp table qg as select pg_temp.inbound('cq5', '2026-11-14 22:56:00+05:30', 'Is it still there?') as e;
select is(pg_temp.has((select e from qg)), true, 'G2 (control) a reply in a chat with nothing queued is answered by the assistant');

select * from finish();
rollback;
