-- Job CP (ADR 0086), part 4: THE CALL LIST AND THE RESULTS. After step N, a person who did not reply and has not paid becomes a call request (approved with the campaign) and an item on the call list; staff call through
-- the bridge and record the outcome (paid, promised, call later, wrong number, stop); the rest of that person's reminders follow the outcome. The results are counted from the outbox and the WhatsApp status table.
--   A the people and the timeline    B who gets a call and who does not    C the list    D outcomes and what they do to the rest of the reminders    E the bridge    F results    G gates and row-level security
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
create function pg_temp.mk(p_label text, p_name text, p_phone text) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), p_name, p_phone);
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label || '_l'), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label));
  perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
  perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:cp')$q$, tests.tid('a'), tests.rid(p_label)));
end $$;
create function pg_temp.sch(p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid('outsider'), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.runj(p_tenant text default 'a') returns jsonb language sql as $$ select pg_temp.sch(format('select public.scheduler_campaign_run(%L, 50)::text', tests.tid(p_tenant)))::jsonb $$;
create function pg_temp.run() returns text language sql as $$
  select (j->>'queued') || '/' || (j->>'held') || '/' || (j->>'blocked') || '/' || (j->>'skipped') || '/' || (j->>'errors') || '/' || (j->>'calls') || '/' || (j->>'done') from (select pg_temp.runj() j) x
$$;
-- the channel said "sent" for everything queued (the adapter's job, simulated here)
create function pg_temp.sendall(p_at text) returns void language sql as $$
  update public.outbox_messages set status = 'sent', sent_at = p_at::timestamptz, adapter = 'fake', adapter_message_id = 'tok-' || left(id::text, 8), attempts = 1, claimed_at = p_at::timestamptz
   where category = 'campaign_reminder' and status = 'queued' and tenant_id = tests.tid('a')
$$;
create function pg_temp.row(p_contact text, p_due text, p_amount bigint) returns jsonb language sql as $$
  select jsonb_build_object('contact_id', tests.rid(p_contact), 'due_date', p_due, 'amount_paise', p_amount)
$$;
create function pg_temp.item(p_contact text) returns uuid language sql as $$
  select i.id from public.call_list_items i where i.contact_id = tests.rid(p_contact) and i.tenant_id = tests.tid('a')
$$;
create function pg_temp.outcome(p_user text, p_contact text, p_outcome text, p_promised text default null, p_after text default null) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.call_list_outcome(%L, %L, %L, %s, %s)$q$, tests.tid('a'), pg_temp.item(p_contact), p_outcome,
                                    case when p_promised is null then 'null' else format('date %L', p_promised) end, case when p_after is null then 'null' else format('timestamptz %L', p_after) end))
$$;
create function pg_temp.sst(p_contact text, p_step int) returns text language sql as $$
  select coalesce((select s.status || coalesce('/' || s.reason, '') from public.campaign_steps s join public.campaign_recipients r on r.id = s.recipient_id where s.campaign_id = tests.rid('cm') and r.contact_id = tests.rid(p_contact) and s.step_no = p_step), 'none')
$$;

insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status)
values (tests.rid('tpl'), tests.tid('a'), 'dues_reminder', 'en', 'utility', 'reminder', 'Hello, a reminder from the shop: {{1}} Thank you.', 'approved');

-- ============================================================================ A. the people and the timeline
select pg_temp.mk('k1', 'Pays after the call', '+00 90007 00001');
select pg_temp.mk('k2', 'Gives a date', '+00 90007 00002');
select pg_temp.mk('k3', 'Call later', '+00 90007 00003');
select pg_temp.mk('k4', 'Other number', '+00 90007 00004');
select pg_temp.mk('k5', 'Says stop', '+00 90007 00005');
select pg_temp.mk('k6', 'Replies', '+00 90007 00006');
select pg_temp.mk('k7', 'Pays by the ledger', '+00 90007 00007');
select pg_temp.mk('k8', 'Stopped by message', '+00 90007 00008');
select pg_temp.mk('k9', 'Gives an early date', '+00 90007 00009');
select is(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'charge', null, %L, date '2026-09-01', 700000, date '2026-11-10', null, null, 'Fee K7')$q$, tests.rid('l7'), tests.tid('a'), tests.rid('k7'))), 'ok', 'A1 (setup) the ledger knows one of them owes Rs 7,000, due 10 Nov');
select is(pg_temp.try('a_owner', format($q$select public.campaign_save(%L, %L, 'Dues with a call', 'payment_due', 'en', %L, 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}. Thank you, {{business}}.',
                                          '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]'::jsonb, 2, 24)$q$, tests.rid('cm'), tests.tid('a'), tests.rid('tpl'))), 'ok', 'A2 (setup) a campaign with a call plan: after step 2, wait 24 hours');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_add(%L, %L, %L::jsonb)->>'added')$q$, tests.tid('a'), tests.rid('cm'), jsonb_build_array(
  pg_temp.row('k1', '2026-11-10', 100000), pg_temp.row('k2', '2026-11-10', 200000), pg_temp.row('k3', '2026-11-10', 300000), pg_temp.row('k4', '2026-11-10', 400000),
  pg_temp.row('k5', '2026-11-10', 500000), pg_temp.row('k6', '2026-11-10', 600000), pg_temp.row('k8', '2026-11-10', 800000), pg_temp.row('k9', '2026-11-10', 900000))::text)), '8', 'A3 (setup) eight people by import ...');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_ledger(%L, %L, '{"due_from": "2026-11-10", "due_to": "2026-11-10"}'::jsonb)->>'added')$q$, tests.tid('a'), tests.rid('cm'))), '1', 'A4 (setup) ... and one from the ledger (so the runner can tell when they have paid)');
select is(pg_temp.try('a_owner', format($q$select public.campaign_approve(%L, %L, (public.campaign_preview(%L, %L)->>'samples_sha256'))$q$, tests.tid('a'), tests.rid('cm'), tests.tid('a'), tests.rid('cm'))), 'ok', 'A5 (setup) approved by the Owner');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(app.operator_register_scheduler('outsider@test.local'), tests.uid('outsider'), 'A6 (setup) the worker account');
select is(pg_temp.try('a_owner', format($$select public.outbox_set_settings(%L, true, 3)$$, tests.tid('a'))), 'ok', 'A7 (setup) automatic sending on');
select pg_temp.pin('2026-11-07T10:30:00+05:30');
select is(pg_temp.run(), '9/0/0/0/0/0/0', 'A8 7 Nov: step 1 goes to all nine');
select pg_temp.sendall('2026-11-07T10:35:00+05:30');
insert into integrations.wa_message_status (message_id, tenant_id, wamid, status, sent_at, delivered_at) select m.id, m.tenant_id, 'wamid.' || left(m.id::text, 8), 'delivered', m.sent_at, m.sent_at + interval '1 minute' from public.outbox_messages m where m.contact_id = tests.rid('k1');
insert into integrations.wa_message_status (message_id, tenant_id, wamid, status, sent_at, delivered_at, read_at) select m.id, m.tenant_id, 'wamid.' || left(m.id::text, 8), 'read', m.sent_at, m.sent_at + interval '1 minute', m.sent_at + interval '5 minutes' from public.outbox_messages m where m.contact_id = tests.rid('k2');
select pg_temp.pin('2026-11-10T10:30:00+05:30');
select is(pg_temp.run(), '9/0/0/0/0/0/0', 'A9 10 Nov: step 2 (the one the call plan waits for) goes to all nine');
select pg_temp.sendall('2026-11-10T10:35:00+05:30');
-- after the second message: k6 writes back, k7 pays, k8 says STOP by message
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at) values (tests.rid('reply6'), tests.tid('a'), tests.rid('k6_l'), tests.rid('k6'), 'in', 'whatsapp', '2026-11-10T12:00:00+05:30', '2026-11-10T12:00:00+05:30');
select is(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'payment', null, %L, date '2026-10-13', 700000, null, null, null, null, 'upi')$q$, tests.rid('pay7'), tests.tid('a'), tests.rid('k7'))), 'ok', 'A10 k7 pays the Rs 7,000 in the ledger');
select is(pg_temp.try('a_owner', format($$select public.suppress_contact(%L, %L, 'opted_out')$$, tests.tid('a'), tests.rid('k8'))), 'ok', 'A11 k8 says STOP');

-- ============================================================================ B. who gets a call and who does not
select pg_temp.pin('2026-11-11T10:00:00+05:30');
select is(pg_temp.run(), '0/0/0/0/0/0/0', 'B1 11 Nov, 10:00: only 23.5 hours since the second message: no call yet (the plan waits 24 hours)');
select pg_temp.pin('2026-11-11T11:00:00+05:30');
select is(pg_temp.run(), '0/0/0/0/0/6/0', 'B2 11 Nov, 11:00: six calls are asked for');
select is((select string_agg(ct.full_name, ', ' order by ct.full_name) from public.call_list_items i join public.contacts ct on ct.id = i.contact_id where i.tenant_id = tests.tid('a')),
          'Call later, Gives a date, Gives an early date, Other number, Pays after the call, Says stop', 'B3 they are the six who did not reply, have not paid and can still be called');
select is((select count(*) from public.call_list_items where contact_id = tests.rid('k6')), 0::bigint, 'B4 not k6: they replied after the message');
select is((select count(*) from public.call_list_items where contact_id = tests.rid('k7')), 0::bigint, 'B5 not k7: the ledger shows they paid ...');
select is(pg_temp.sst('k7', 3) || ' ' || (select closed_reason from public.campaign_recipients where contact_id = tests.rid('k7') and campaign_id = tests.rid('cm')), 'skipped/paid paid', 'B6 ... so they are closed as paid and their next reminder is skipped');
select is((select count(*) from public.call_list_items where contact_id = tests.rid('k8')), 0::bigint, 'B7 not k8: a person who said STOP is never called');
select is(pg_temp.run(), '0/0/0/0/0/0/0', 'B8 asking again makes no second call for anyone (one item per person)');
select is((select count(*) from public.call_requests where tenant_id = tests.tid('a')), 6::bigint, 'B9 six call requests on record');
select is((select status || '/' || (decided_by = tests.uid('a_owner'))::text || '/' || decision_note || '/' || (requested_by = tests.uid('outsider'))::text from public.call_requests where contact_id = tests.rid('k1')), 'approved/true/approved with the campaign/true',
          'B10 each is approved WITH the campaign by the Owner who approved it, and asked for by the worker account');
select is((select language || '/' || (script_draft like 'Dear Pays after the call, ₹1,000.00 is pending, due on 10 Nov 2026.%') from public.call_requests where contact_id = tests.rid('k1')), 'en/true', 'B11 the script is the same words the person was sent');
select is((select reason from public.call_requests where contact_id = tests.rid('k1')), 'Reminder campaign: no reply, and not marked as paid, after step 2', 'B12 and the reason says why');

-- ============================================================================ C. the list
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.call_list(%L))::text$q$, tests.tid('a'))), '6', 'C1 Sales read the call list: six open items');
select is(pg_temp.val('a_sales', format($q$select (public.call_list(%L) -> 0 ->> 'step_no') || '/' || (public.call_list(%L) -> 0 ->> 'status')$q$, tests.tid('a'), tests.tid('a'))), '2/open', 'C2 each says which step it follows and that it is open');
select is(pg_temp.val('a_sales', format($q$select (select count(*) from jsonb_array_elements(public.call_list(%L)) e where e::text ~ '(phone|90007)')::text$q$, tests.tid('a'))), '0', 'C3 and the NUMBER is never shown: the call goes through the bridge');
select is(pg_temp.val('a_sales', format($q$select (e->>'contact_name') || ' | ' || (e->>'amount_paise') || ' | ' || (e->>'due_date') || ' | ' || (e->>'campaign_name') from jsonb_array_elements(public.call_list(%L)) e where e->>'contact_name' = 'Gives a date'$q$, tests.tid('a'))), 'Gives a date | 200000 | 2026-11-10 | Dues with a call', 'C4 with the name, the amount and date from the list, and the campaign');
select is(pg_temp.val('a_viewer', format($q$select public.call_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C5 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.call_list(%L)::text$q$, tests.tid('b'))), '[]', 'C6 a textiles business has a call list too (module call_list), with nothing on it');
select is(pg_temp.val('b_owner', format($q$select public.call_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C7 DENY: another business''s Owner');
select is(pg_temp.val('a_owner', format($q$select public.call_list(%L, 'maybe')::text$q$, tests.tid('a'))), 'ERR:22023', 'C8 an unknown status is invalid');

-- ============================================================================ D. outcomes, and what they do to the rest of the reminders
select is(pg_temp.outcome('a_viewer', 'k1', 'paid'), '42501', 'D1 DENY: a Viewer cannot record an outcome');
select is(pg_temp.outcome('a_owner', 'k1', 'maybe'), '22023', 'D2 an outcome outside the five is invalid');
select is(pg_temp.outcome('a_owner', 'k2', 'promised'), '22023', 'D3 a promise needs its date');
select is(pg_temp.outcome('a_owner', 'k2', 'promised', '2026-11-01'), '22023', 'D4 ... not in the past');
select is(pg_temp.outcome('a_owner', 'k2', 'promised', '2027-06-01'), '22023', 'D5 ... nor beyond 60 days');
select is(pg_temp.outcome('a_owner', 'k3', 'call_later'), '22023', 'D6 "call later" needs a time');
select is(pg_temp.outcome('a_owner', 'k3', 'call_later', null, '2026-11-10T09:00:00+05:30'), '22023', 'D7 ... in the future');
select is(pg_temp.outcome('a_owner', 'k1', 'paid', '2026-11-20'), '22023', 'D8 a date belongs only to a promise');
select is(pg_temp.try('a_owner', format($$select public.call_list_outcome(%L, %L, 'paid')$$, tests.tid('a'), gen_random_uuid())), '23503', 'D9 an item that is not on the list is not found');
select is(pg_temp.try('b_owner', format($$select public.call_list_outcome(%L, %L, 'paid')$$, tests.tid('b'), pg_temp.item('k1'))), '23503', 'D10 another business cannot see it (not found)');
select is(pg_temp.outcome('a_sales', 'k1', 'paid'), 'ok', 'D11 ALLOW: Sales records "paid"');
select is(pg_temp.sst('k1', 3), 'skipped/paid', 'D12 the rest of k1''s reminders are skipped (paid)');
select is((select closed_reason from public.campaign_recipients where contact_id = tests.rid('k1') and campaign_id = tests.rid('cm')), 'paid', 'D13 k1 is closed as paid');
select is(pg_temp.outcome('a_sales', 'k1', 'paid'), 'ok', 'D14 recording the same outcome again replays');
select is(pg_temp.outcome('a_sales', 'k1', 'wrong_number'), 'SM801', 'D15 another outcome on a finished item is refused (SM801)');
select is(pg_temp.outcome('a_owner', 'k2', 'promised', '2026-11-20'), 'ok', 'D16 k2 promises to pay on 20 Nov');
select is(pg_temp.sst('k2', 3), 'skipped/promised', 'D17 the reminder due before the day after the promise (17 Nov) is skipped');
select is((select closed_reason || '/' || promised_on from public.campaign_recipients where contact_id = tests.rid('k2') and campaign_id = tests.rid('cm')), 'promised/2026-11-20', 'D18 and the promise is on record');
select is(pg_temp.outcome('a_owner', 'k9', 'promised', '2026-11-14'), 'ok', 'D19 k9 promises 14 Nov');
select is(pg_temp.sst('k9', 3), 'planned', 'D20 the reminder of 17 Nov is AFTER the promise: it stays planned');
select is(pg_temp.outcome('a_owner', 'k3', 'call_later', null, '2026-11-12T10:00:00+05:30'), 'ok', 'D21 k3 asks for a call tomorrow');
select is((select status || '/' || outcome || '/' || attempts from public.call_list_items where contact_id = tests.rid('k3')), 'open/call_later/1', 'D22 the item stays OPEN, with the time and one attempt counted');
select is((select closed_at is null from public.campaign_recipients where contact_id = tests.rid('k3') and campaign_id = tests.rid('cm')), true, 'D23 and the person is not closed');
select is(pg_temp.outcome('a_owner', 'k4', 'wrong_number'), 'ok', 'D24 k4: wrong number');
select is(pg_temp.sst('k4', 3) || ' ' || (select closed_reason from public.campaign_recipients where contact_id = tests.rid('k4') and campaign_id = tests.rid('cm')), 'skipped/recipient_closed wrong_number', 'D25 closed, the rest skipped');
select is(pg_temp.outcome('a_owner', 'k5', 'stop'), 'ok', 'D26 k5 says stop on the call');
select is((select (suppressed_at is not null)::text || '/' || suppression_reason from public.contacts where id = tests.rid('k5')), 'true/opted_out', 'D27 they are on the do-not-contact list, for every campaign and every message');
select is((select count(*) from public.consent_events where contact_id = tests.rid('k5') and event_type = 'suppressed'), 1::bigint, 'D28 in the consent ledger');
select is(pg_temp.sst('k5', 3), 'skipped/recipient_closed', 'D29 and their next reminder is skipped');
select is((select count(*) from public.call_list_items where status = 'open'), 1::bigint, 'D30 one item is still open (k3)');

-- ============================================================================ E. the bridge
select is(pg_temp.try('a_admin', format($$select public.call_bridge_prepare(%L, %L, 'fake')$$, tests.tid('a'), (select call_request_id from public.call_list_items where contact_id = tests.rid('k3')))), 'ok', 'E1 ALLOW: the Admin places the call through the existing bridge (the request is approved, 11:00 India time)');
select is(pg_temp.try('a_sales', format($$select public.call_bridge_prepare(%L, %L, 'fake')$$, tests.tid('a'), (select call_request_id from public.call_list_items where contact_id = tests.rid('k9')))), '42501', 'E2 DENY: Sales records outcomes but the bridge stays with the Owner and the Admin');
select ok(pg_temp.try('a_admin', format($$select public.call_bridge_prepare(%L, %L, 'fake')$$, tests.tid('a'), (select call_request_id from public.call_list_items where contact_id = tests.rid('k5')))) <> 'ok', 'E3 a person who has since said stop cannot be called: the bridge refuses');
select pg_temp.pin('2026-11-11T21:30:00+05:30');
select ok(pg_temp.try('a_admin', format($$select public.call_bridge_prepare(%L, %L, 'fake')$$, tests.tid('a'), (select call_request_id from public.call_list_items where contact_id = tests.rid('k9')))) <> 'ok', 'E4 after 21:00 India time the bridge refuses (the calling hours are the bridge''s rule)');

-- ============================================================================ F. results
select pg_temp.pin('2026-11-17T10:30:00+05:30');
select is(pg_temp.run(), '3/0/1/0/0/0/0', 'F1 17 Nov: the last reminders: k3, k6 and k9 are queued; k8 (said STOP by message) is blocked; the closed people get none');
select is(pg_temp.outcome('a_owner', 'k3', 'paid'), 'ok', 'F2 k3 pays after the second call');
select pg_temp.pin('2026-11-20T10:30:00+05:30');
select is(pg_temp.run(), '0/0/0/0/0/0/1', 'F3 20 Nov: nothing is left to do and no call is open: the campaign is done');
select is((select status from public.campaigns where id = tests.rid('cm')), 'done', 'F4 (done)');
create function pg_temp.res(p_path text[]) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select public.campaign_results(%L, %L) #>> %L$q$, tests.tid('a'), tests.rid('cm'), p_path))
$$;
select is(pg_temp.res(array['recipients']), '9', 'F5 results: nine people');
select is(pg_temp.res(array['by_state']), '{"read": 1, "sent": 16, "blocked": 1, "skipped": 5, "waiting": 3, "delivered": 1}', 'F6 by state: 16 sent, 1 delivered, 1 read, 3 waiting for the channel, 1 blocked, 5 skipped (27 steps in all)');
select is(pg_temp.res(array['by_reason']), '{"paid": 2, "stopped": 1, "promised": 1, "recipient_closed": 2}', 'F7 by reason: skipped because paid (2), promised (1), the person was closed (2); blocked because stopped (1)');
select is(pg_temp.res(array['delivered_total']), '2', 'F8 delivered or read: two');
select is(pg_temp.res(array['by_day']), '[{"day": "2026-11-07", "states": {"read": 1, "sent": 7, "delivered": 1}}, {"day": "2026-11-10", "states": {"sent": 9}}, {"day": "2026-11-17", "states": {"blocked": 1, "skipped": 5, "waiting": 3}}]', 'F9 by day');
select is(pg_temp.res(array['replied']), '1', 'F10 one person wrote back (k6)');
select is(pg_temp.res(array['paid_after_reminder', 'recipients']) || '/' || pg_temp.res(array['paid_after_reminder', 'amount_paise']), '3/1100000', 'F11 paid after a reminder: three people (k1, k3 on the call; k7 in the ledger), Rs 11,000 of the amounts');
select is(pg_temp.res(array['closed']), '{"paid": 3, "stopped": 1, "promised": 2, "wrong_number": 1}', 'F12 closed: paid 3, promised 2, wrong number 1, stopped 1');
select is(pg_temp.res(array['calls']), '{"done": 6, "open": 0, "outcomes": {"paid": 2, "stop": 1, "promised": 2, "wrong_number": 1}}', 'F13 the call list: six done (paid 2, promised 2, wrong number 1, stop 1)');
select is(pg_temp.val('a_viewer', format($q$select public.campaign_results(%L, %L)::text$q$, tests.tid('a'), tests.rid('cm'))), 'ERR:42501', 'F14 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.campaign_results(%L, %L)::text$q$, tests.tid('b'), tests.rid('cm'))), 'ERR:SM701', 'F15 textiles: campaigns are not on');
select is(pg_temp.val('a_owner', format($q$select public.campaign_results(%L, %L)::text$q$, tests.tid('a'), gen_random_uuid())), 'ERR:23503', 'F16 an unknown campaign is not found');
select is(pg_temp.res(array['campaign_id']), tests.rid('cm')::text, 'F17 (the answer is for this campaign)');
select is((select count(*) from public.outbox_messages where category = 'campaign_reminder' and tenant_id = tests.tid('a')), 22::bigint, 'F18 the results are derived from the outbox: 22 messages for the 22 steps that were handed over (27 steps less the 5 skipped)');

-- ============================================================================ G. gates and row-level security
select is(pg_temp.sc(format($$update public.call_list_items set outcome = 'paid', status = 'done' where id = %L$$, pg_temp.item('k3'))), '42501', 'G1 a finished item never changes again');
select is(pg_temp.sc(format($$update public.call_list_items set contact_id = %L where id = %L$$, tests.rid('k1'), pg_temp.item('k9'))), '42501', 'G2 an item''s person never changes');
select is(pg_temp.sc(format($$delete from public.call_list_items where id = %L$$, pg_temp.item('k9'))), '42501', 'G3 nor is an item deleted');
select is(pg_temp.val('a_viewer', format($$select count(*)::text from public.call_list_items where tenant_id = %L$$, tests.tid('a'))), '0', 'G4 a Viewer reads none');
select is(pg_temp.val('a_sales', format($$select count(*)::text from public.call_list_items where tenant_id = %L$$, tests.tid('a'))), '6', 'G5 Sales read the six');
select is(pg_temp.val('b_owner', format($$select count(*)::text from public.call_list_items where tenant_id = %L$$, tests.tid('a'))), '0', 'G6 another business sees none');
select is(pg_temp.try('a_owner', format($$update public.call_list_items set attempts = 9 where id = %L$$, pg_temp.item('k9'))), '42501', 'G7 DENY: a client cannot write the list directly');
select is(pg_temp.sc(format($$update public.campaign_recipients set closed_at = null, closed_reason = null where contact_id = %L$$, tests.rid('k1'))), '42501', 'G8 a closed person stays closed');

select * from finish();
rollback;
