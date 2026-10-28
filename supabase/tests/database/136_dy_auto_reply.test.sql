-- Job DY (28 Oct 2026): the assistant answers a customer's WhatsApp message on its own (the Owner's standing rule). The switch, the worker's reads and writes, the outbox rules that still apply.
--   A catalog   B the switch (roles, second factor, audit)   C what waits for an answer   D what does NOT   E the reply goes through the outbox   F once only
-- THE CLOCK is pinned (app.outbox_now) to Monday 2026-10-05 14:00 IST.
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
create function pg_temp.mk(p_label text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone)
  values (tests.rid(p_label || '_c'), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'Contact ' || p_label, '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), tests.rid(p_label || '_c'));
  if p_tenant = 'a' then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:bb')$q$, tests.tid(p_tenant), tests.rid(p_label || '_c')));
  end if;
end $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.inbound(p_lead text, p_at text, p_body text default 'Is the green saree in stock?', p_tenant text default 'a') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, created_via) values (v, tests.tid(p_tenant), tests.rid(p_lead), 'whatsapp', p_at::timestamptz, p_body, 'manual');
  return v;
end $$;
create function pg_temp.pending() returns jsonb language plpgsql as $$
declare r text;
begin r := pg_temp.sch('select public.scheduler_auto_reply_pending(10)::text'); return case when r like 'ERR:%' then jsonb_build_array(r) else r::jsonb end; end $$;
create function pg_temp.has(p_enq uuid) returns boolean language sql as $$ select exists (select 1 from jsonb_array_elements(pg_temp.pending()) e where e ->> 'enquiry_id' = p_enq::text) $$;
create function pg_temp.sub(p_enq uuid, p_text text, p_hold boolean default false) returns text language sql as $$
  select pg_temp.sch(format($q$select public.scheduler_auto_reply_submit(%L, %L, 'en', 'gloss', %L)::text$q$, p_enq, p_text, p_hold)) $$;

select pg_temp.pin(timestamptz '2026-10-05 14:00:00+05:30');

-- A. catalog
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('auto_reply_get', 'auto_reply_set', 'scheduler_auto_reply_pending', 'scheduler_auto_reply_submit', 'scheduler_auto_reply_skip')
  and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 5::bigint, 'A1: five security-definer functions, authenticated only, search_path fixed');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and table_name in ('auto_reply', 'auto_reply_done') and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A2: both tables are closed to every client role');

-- B. the switch
select is(pg_temp.sc('a_viewer', format($q$select public.auto_reply_get(%L)::text$q$, tests.tid('a')))::jsonb -> 'enabled', 'false'::jsonb, 'B1: every member reads it; it starts OFF');
select is((pg_temp.sc('a_viewer', format($q$select public.auto_reply_get(%L)::text$q$, tests.tid('a')))::jsonb -> 'rules'), '["answers_within_24_hours", "asks_you_before_prices_and_promises", "hands_over_when_unsure_or_asked_for_a_person"]'::jsonb, 'B2: ...with the standing rules in words the screen can show');
select is(pg_temp.sc('b_owner', format($q$select public.auto_reply_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B3: another business reads nothing of ours');
select is(pg_temp.sc('a_admin', format($q$select public.auto_reply_set(%L, true)::text$q$, tests.tid('a'))), 'ERR:42501', 'B4: an Admin cannot switch it');
select is(pg_temp.sc('a_sales', format($q$select public.auto_reply_set(%L, true)::text$q$, tests.tid('a'))), 'ERR:42501', 'B5: nor Sales');
select isnt(pg_temp.sc('a_owner', format($q$select public.auto_reply_set(%L, true)::text$q$, tests.tid('a')), 'aal1'), 'ERR:00000', 'B6: the Owner needs the second factor');
select ok(pg_temp.sc('a_owner', format($q$select public.auto_reply_set(%L, true)::text$q$, tests.tid('a')), 'aal1') like 'ERR:%', 'B7: ...and without it is refused');
select is(pg_temp.sc('a_owner', format($q$select public.auto_reply_set(%L, true)::text$q$, tests.tid('a')))::jsonb -> 'enabled', 'true'::jsonb, 'B8: the Owner (second factor) switches it on');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.auto_reply_changed'), 1::bigint, 'B9: the change is audited');
select ok(pg_temp.sc('a_owner', format($q$select public.auto_reply_set(%L, null)::text$q$, tests.tid('a'))) like 'ERR:%', 'B10: a missing value is refused');
select is(pg_temp.sc('b_owner', format($q$select public.auto_reply_get(%L)::text$q$, tests.tid('b')))::jsonb -> 'enabled', 'false'::jsonb, 'B11: the other business is unaffected');

-- C. what waits for an answer
select pg_temp.mk('ar1');
select pg_temp.mk('ar2');
select pg_temp.mk('ar3');
select pg_temp.mk('ar4');
select pg_temp.mk('ar5');
select pg_temp.mk('ar6');
insert into public.knowledge_facts (id, tenant_id, kind, text, status, created_by, decided_by, decided_at) values
  (gen_random_uuid(), tests.tid('a'), 'hours', 'We are open from 10 am to 8 pm every day.', 'approved', tests.uid('a_owner'), tests.uid('a_owner'), now()),
  (gen_random_uuid(), tests.tid('a'), 'faq', 'A DRAFT FACT THE OWNER HAS NOT APPROVED.', 'draft', tests.uid('a_owner'), null, null);
select pg_temp.inbound('ar1', '2026-10-05 13:50:00+05:30', 'Hello');                       -- an earlier message of the same customer
create temp table ar_e (k text primary key, id uuid) on commit drop;
insert into ar_e values ('ar1', pg_temp.inbound('ar1', '2026-10-05 13:55:00+05:30', 'Is the green saree in stock?'));
select is(pg_temp.has((select id from ar_e where k = 'ar1')), true, 'C1: the newest WhatsApp message of a customer waits for an answer');
select is((select e -> 'business' from jsonb_array_elements(pg_temp.pending()) e where e ->> 'enquiry_id' = (select id::text from ar_e where k = 'ar1')), to_jsonb((select name from public.tenants where id = tests.tid('a'))), 'C2: with the business name');
select is((select jsonb_array_length(e -> 'history') from jsonb_array_elements(pg_temp.pending()) e where e ->> 'enquiry_id' = (select id::text from ar_e where k = 'ar1')), 1, 'C3: the earlier message is in the history');
select is((select jsonb_array_length(e -> 'facts') from jsonb_array_elements(pg_temp.pending()) e where e ->> 'enquiry_id' = (select id::text from ar_e where k = 'ar1')), 1, 'C4: only the APPROVED fact is shown to the model');
select is((select e ->> 'customer_name' from jsonb_array_elements(pg_temp.pending()) e where e ->> 'enquiry_id' = (select id::text from ar_e where k = 'ar1')), 'Contact', 'C5: the customer''s first name');
select is(pg_temp.sch('select public.scheduler_auto_reply_pending(0)::text'), 'ERR:22023', 'C6: a limit of zero is refused') ;

-- D. what does not
select is(pg_temp.sc('a_owner', 'select public.scheduler_auto_reply_pending(5)::text'), 'ERR:42501', 'D1: an Owner is not the worker');
insert into ar_e values ('ar2', pg_temp.inbound('ar2', '2026-10-04 13:00:00+05:30'));
select is(pg_temp.has((select id from ar_e where k = 'ar2')), false, 'D2: a message older than 24 hours is not answered');
insert into ar_e values ('ar3', pg_temp.inbound('ar3', '2026-10-05 13:40:00+05:30'));
select app.outbox_submit_core(tests.uid('a_owner'), gen_random_uuid(), tests.tid('a'), tests.rid('ar3'), 'whatsapp', 'A person already wrote back', 'en', 'reply_to_inbound', 'owner', false, false, '{}'::uuid[], false, null);
select is(pg_temp.has((select id from ar_e where k = 'ar3')), false, 'D3: a message somebody already answered is not answered again');
insert into ar_e values ('ar4', pg_temp.inbound('ar4', '2026-10-05 13:30:00+05:30', 'first'));
insert into ar_e values ('ar4b', pg_temp.inbound('ar4', '2026-10-05 13:35:00+05:30', 'second'));
select is(pg_temp.has((select id from ar_e where k = 'ar4')), false, 'D4: ...and the older of two unanswered messages is left (only the newest is)');
select is(pg_temp.has((select id from ar_e where k = 'ar4b')), true, 'D5: ...the newest is');
insert into ar_e values ('ar5', pg_temp.inbound('ar5', '2026-10-05 13:50:00+05:30', '[image]'));
select is(pg_temp.has((select id from ar_e where k = 'ar5')), false, 'D6: a picture or a voice note (no words) is left to a person');
select pg_temp.mk('arb', 'b');
insert into ar_e values ('arb', pg_temp.inbound('arb', '2026-10-05 13:56:00+05:30', 'business b?', 'b'));  -- a customer of business b, whose switch is off
select is(pg_temp.has((select id from ar_e where k = 'arb')), false, 'D7: another business, with its switch off, is not touched');
select ok(pg_temp.sc('a_owner', format($q$select public.auto_reply_set(%L, false)::text$q$, tests.tid('a')))::jsonb -> 'enabled' = 'false'::jsonb, 'D8: the Owner switches it off');
select is(pg_temp.has((select id from ar_e where k = 'ar1')), false, 'D9: switched off: nothing waits');
select ok(pg_temp.sc('a_owner', format($q$select public.auto_reply_set(%L, true)::text$q$, tests.tid('a')))::jsonb -> 'enabled' = 'true'::jsonb, 'D10: ...and on again');
update public.platform_flags set enabled = false where key = 'assistant_enabled';
select is(pg_temp.has((select id from ar_e where k = 'ar1')), false, 'D11: with the assistant switched off for the whole system, nothing waits');
update public.platform_flags set enabled = true where key = 'assistant_enabled';
select app.operator_set_outbox(false);
select is(pg_temp.has((select id from ar_e where k = 'ar1')), false, 'D12: with sending stopped for the whole system, nothing waits');
select app.operator_set_outbox(true);

-- E. the reply goes through the outbox
insert into public.outbox_settings (tenant_id, auto_send_enabled, per_customer_daily_limit) values (tests.tid('a'), true, 5) on conflict (tenant_id) do update set auto_send_enabled = true;
select is(pg_temp.sch(format($q$select public.scheduler_auto_reply_submit(%L, 'x', 'en', null, false)::text$q$, (select id from ar_e where k = 'ar1')))::jsonb ->> 'outcome', 'skipped', 'E0: a reply of one character is refused by the outbox and recorded as skipped');
insert into ar_e values ('ar6', pg_temp.inbound('ar6', '2026-10-05 13:58:00+05:30', 'Do you have this saree in blue?'));
select is(pg_temp.sub((select id from ar_e where k = 'ar6'), 'Yes, we do. We are open from 10 am to 8 pm.')::jsonb ->> 'outcome', 'submitted', 'E1: the reply is submitted');
select is((select source || '/' || category || '/' || status || '/' || reason from public.outbox_messages where lead_id = tests.rid('ar6')), 'assistant/reply_to_inbound/queued/auto_allowed', 'E2: an assistant message, a reply, queued to go (automatic sending is on)');
select is((select disclosure_added from public.outbox_messages where lead_id = tests.rid('ar6')), true, 'E3: the first message the assistant writes to a customer carries the AI line');
select is((select result from workspace.auto_reply_done where enquiry_id = (select id from ar_e where k = 'ar6')), 'answered', 'E4: recorded as answered');
select is(pg_temp.has((select id from ar_e where k = 'ar6')), false, 'E5: and it is not pending any more');

-- a price waits for the Owner; a hand-over waits for the Owner
select pg_temp.mk('ar7');
select pg_temp.mk('ar8');
insert into ar_e values ('ar7', pg_temp.inbound('ar7', '2026-10-05 13:58:30+05:30', 'How much is it?'));
insert into ar_e values ('ar8', pg_temp.inbound('ar8', '2026-10-05 13:58:40+05:30', 'I want to talk to the owner'));
select pg_temp.sub((select id from ar_e where k = 'ar7'), 'The price is Rs 4500 for the green saree.');
select is((select status || '/' || reason from public.outbox_messages where lead_id = tests.rid('ar7')), 'needs_approval/money', 'E6: a message with a price WAITS FOR THE OWNER');
select is((select result from workspace.auto_reply_done where enquiry_id = (select id from ar_e where k = 'ar7')), 'held_for_owner', 'E7: recorded as held for the Owner');
select pg_temp.sub((select id from ar_e where k = 'ar8'), 'I have asked the owner to write to you personally.', true);
select is((select status || '/' || reason from public.outbox_messages where lead_id = tests.rid('ar8')), 'needs_approval/uncertain', 'E8: a hand-over (the customer asks for a person, or the model is unsure) WAITS FOR THE OWNER');

-- F. once only
select is(pg_temp.sub((select id from ar_e where k = 'ar6'), 'Another answer.')::jsonb ->> 'outcome', 'not_pending', 'F1: a message already looked at is never answered twice');
select is((select count(*) from public.outbox_messages where lead_id = tests.rid('ar6')), 1::bigint, 'F2: still one reply');
select pg_temp.mk('ar9');
insert into ar_e values ('ar9', pg_temp.inbound('ar9', '2026-10-05 13:59:00+05:30', 'ok'));
select is(pg_temp.sch(format($q$select public.scheduler_auto_reply_skip(%L, 'model unavailable')::text$q$, (select id from ar_e where k = 'ar9')))::jsonb ->> 'outcome', 'skipped', 'F3: the worker can record that nothing was sent');
select is(pg_temp.has((select id from ar_e where k = 'ar9')), false, 'F4: ...and it is not tried again');
select is(pg_temp.sc('a_owner', format($q$select public.scheduler_auto_reply_skip(%L, 'x')::text$q$, (select id from ar_e where k = 'ar9'))), 'ERR:42501', 'F5: an Owner cannot record for the worker');

select * from finish();
rollback;
