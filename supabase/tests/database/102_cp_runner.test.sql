-- Job CP (ADR 0086), part 3: THE RUNNER. The scheduler sends each approved step at its time, as an ORDINARY outbox message, under every per-message rule: consent, STOP, the suppression key, quiet hours, the daily limit,
-- the kill switch, the business's automatic-sending switch. A retry cannot send twice. A changed campaign sends nothing. A person who paid is not reminded.
--   A the worker's gates    B the timeline of one campaign (eight people, ten moments)    C one message in detail    D the switches, a pause    E the daily limit    F the ledger: paid since    G changed since approval, a template paused, late steps
--   H the WhatsApp template of a campaign message    I done
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
-- a person: contact + lead + (optionally) a suppression key and the WhatsApp consent
create function pg_temp.mk(p_label text, p_name text, p_phone text, p_key boolean default true, p_consent boolean default true) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), p_name, p_phone);
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label || '_l'), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label));
  if p_key then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
  end if;
  if p_consent then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:cp')$q$, tests.tid('a'), tests.rid(p_label)));
  end if;
end $$;
create function pg_temp.save(p_id text, p_text text, p_steps text, p_name text default 'Dues') returns text language sql as $$
  select pg_temp.try('a_owner', format($q$select public.campaign_save(%L, %L, %L, 'payment_due', 'en', %L, %L, %L::jsonb, null, 24)$q$, tests.rid(p_id), tests.tid('a'), p_name, tests.rid('tpl'), p_text, p_steps))
$$;
create function pg_temp.add(p_camp text, p_rows jsonb) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.campaign_recipients_add(%L, %L, %L::jsonb)->>'added')$q$, tests.tid('a'), tests.rid(p_camp), p_rows::text))
$$;
create function pg_temp.approve(p_camp text) returns text language sql as $$
  select pg_temp.try('a_owner', format($q$select public.campaign_approve(%L, %L, (public.campaign_preview(%L, %L)->>'samples_sha256'))$q$, tests.tid('a'), tests.rid(p_camp), tests.tid('a'), tests.rid(p_camp)))
$$;
create function pg_temp.row(p_contact text, p_due text, p_amount bigint, p_ref text) returns jsonb language sql as $$
  select jsonb_build_object('contact_id', tests.rid(p_contact), 'due_date', p_due, 'amount_paise', p_amount, 'reference', p_ref)
$$;
-- the worker: every call is made as the registered principal (the unaffiliated fixture user "outsider")
create function pg_temp.sch(p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid('outsider'), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
-- one pass: 'queued/held/blocked/skipped/errors'
create function pg_temp.run(p_tenant text default 'a', p_limit int default 50) returns text language sql as $$
  select coalesce((select (j->>'queued') || '/' || (j->>'held') || '/' || (j->>'blocked') || '/' || (j->>'skipped') || '/' || (j->>'errors') from (select pg_temp.sch(format('select public.scheduler_campaign_run(%L, %s)::text', tests.tid(p_tenant), p_limit))::jsonb j) x where 1 = 1), 'x')
$$;
create function pg_temp.msg(p_camp text, p_contact text, p_step int, p_due text) returns uuid language sql as $$
  select app.campaign_message_id(tests.rid(p_camp), (select id from public.campaign_recipients where campaign_id = tests.rid(p_camp) and contact_id = tests.rid(p_contact)), p_step, p_due::date)
$$;
create function pg_temp.mst(p_camp text, p_contact text, p_step int, p_due text) returns text language sql as $$
  select coalesce((select status || '/' || reason from public.outbox_messages where id = pg_temp.msg(p_camp, p_contact, p_step, p_due)), 'none')
$$;
create function pg_temp.sst(p_camp text, p_contact text, p_step int) returns text language sql as $$
  select coalesce((select s.status || coalesce('/' || s.reason, '') from public.campaign_steps s join public.campaign_recipients r on r.id = s.recipient_id where s.campaign_id = tests.rid(p_camp) and r.contact_id = tests.rid(p_contact) and s.step_no = p_step), 'none')
$$;

insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) values
  (tests.rid('tpl'), tests.tid('a'), 'dues_reminder', 'en', 'utility', 'reminder', 'Hello, a reminder from the shop: {{1}} Thank you.', 'approved');

-- the people of the main campaign
select pg_temp.mk('r1', 'Ravi', '+00 90001 00001');
select pg_temp.mk('r2', 'Sita Devi', '+00 90001 00002');
select pg_temp.mk('r3', 'Anil', '+00 90001 00003');
select pg_temp.mk('r4', 'Latha Kumari', '+00 90001 00004', true, false);             -- never agreed to WhatsApp
select pg_temp.mk('r5', 'Mohan', '+00 90001 00005');                                  -- will say STOP
select pg_temp.mk('r6', 'Prasad', '+00 90001 00006');
select pg_temp.mk('r7', 'Guaranteed Traders', '+00 90001 00007');                     -- a name that reads as a promise
select pg_temp.mk('r8', 'Geeta', '+00 90001 00008', false, true);                     -- no suppression key on record
select is(pg_temp.try('a_owner', format($$select public.suppress_contact(%L, %L, 'opted_out')$$, tests.tid('a'), tests.rid('r5'))), 'ok', 'S1 (setup) one person said STOP');

select is(pg_temp.save('m1', 'Dear {{name}}, payment of {{amount}} for {{reference}} is due on {{due_date}}. Thank you, {{business}}.', '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}, {"offset_days": 7, "time": "10:00"}]', 'October dues'), 'ok', 'S2 (setup) the campaign');
select is(pg_temp.add('m1', jsonb_build_array(pg_temp.row('r1', '2026-11-10', 500000, 'INV-101'), pg_temp.row('r2', '2026-11-10', 250000, 'INV-102'), pg_temp.row('r3', '2026-11-12', 99900, 'INV-103'), pg_temp.row('r4', '2026-11-12', 120000, 'INV-104'),
                                               pg_temp.row('r5', '2026-11-15', 9000000, 'INV-105'), pg_temp.row('r6', '2026-11-15', 310000, 'INV-106'), pg_temp.row('r7', '2026-11-18', 480000, 'INV-107'), pg_temp.row('r8', '2026-11-18', 150000, 'INV-108'))), '8', 'S3 (setup) eight people');
select is(pg_temp.approve('m1'), 'ok', 'S4 (setup) the Owner approves it (1 Nov, 11:00)');
select is((select count(*) from public.campaign_steps where campaign_id = tests.rid('m1') and status = 'planned'), 24::bigint, 'S5 24 steps are planned');

-- ============================================================================ A. the worker's gates
select is(pg_temp.val('a_owner', format($q$select public.scheduler_campaign_run(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A1 DENY: an Owner is not the scheduler (42501)');
select is(pg_temp.sch(format($q$select public.scheduler_campaign_run(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A2 DENY: nor is an account that was never registered');
select is(pg_temp.try('anon', format($q$select public.scheduler_campaign_run(%L)$q$, tests.tid('a'))), '42501', 'A3 DENY: nor anon');
select is(app.operator_register_scheduler('Outsider@test.local'), tests.uid('outsider'), 'A4 (setup) the operator registers the worker account');
select is(pg_temp.sch(format($q$select public.scheduler_campaign_run(%L, 0)::text$q$, tests.tid('a'))), 'ERR:22023', 'A5 a batch size of nothing is invalid');
select is(pg_temp.sch(format($q$select public.scheduler_campaign_run(%L, 500)::text$q$, tests.tid('a'))), 'ERR:22023', 'A6 ... or over 200');
select is(pg_temp.run(), '0/0/0/0/0', 'A7 the worker asks, both switches are OFF: nothing happens (the global outbox switch and the business''s automatic sending)');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.run(), '0/0/0/0/0', 'A8 the kill switch is on, the business''s automatic sending is still off: nothing happens');
select is(pg_temp.try('a_owner', format($$select public.outbox_set_settings(%L, true, 3)$$, tests.tid('a'))), 'ok', 'A9 (setup) the Owner turns automatic sending on');
select is(pg_temp.run(), '0/0/0/0/0', 'A10 both on, but 1 Nov 11:00: no step is due yet');
select is(pg_temp.run('b'), '0/0/0/0/0', 'A11 textiles (module off, no settings): nothing happens and nothing fails');

-- ============================================================================ B. the timeline: eight people, ten moments
-- T0 7 Nov 10:30: step 1 of the people due 10 Nov (r1, r2)
select pg_temp.pin('2026-11-07T10:30:00+05:30');
select is(pg_temp.run(), '2/0/0/0/0', 'B1 7 Nov 10:30: two steps are due (the 10:00 step for the two people due 10 Nov): both queued');
select is(pg_temp.mst('m1', 'r1', 1, '2026-11-10'), 'queued/campaign_approved', 'B2 each is an ordinary outbox message, queued, with the reason campaign_approved');
select is(pg_temp.run(), '0/0/0/0/0', 'B3 asking again sends nothing more (a step is handed over once)');
select is(pg_temp.sst('m1', 'r1', 1) || ' ' || pg_temp.sst('m1', 'r1', 2), 'submitted planned', 'B4 the step is recorded as submitted; the next stays planned');
select is((select status from public.campaigns where id = tests.rid('m1')), 'running', 'B5 the campaign is running');
-- T1 9 Nov: step 1 for r3 (agreed) and r4 (never agreed)
select pg_temp.pin('2026-11-09T10:30:00+05:30');
select is(pg_temp.run(), '1/0/1/0/0', 'B6 9 Nov: one queued (r3) and one blocked by the outbox''s own rule (r4 never agreed to WhatsApp)');
select is(pg_temp.mst('m1', 'r4', 1, '2026-11-12'), 'blocked/no_opt_in', 'B7 the blocked message is on record with its reason (no_opt_in)');
-- T2 10 Nov: step 2 for r1, r2
select pg_temp.pin('2026-11-10T10:30:00+05:30');
select is(pg_temp.run(), '2/0/0/0/0', 'B8 10 Nov: the "on the day" step for r1 and r2: two queued');
-- T3 12 Nov: step 1 for r5 (STOP) and r6; step 2 for r3 and r4
select pg_temp.pin('2026-11-12T10:30:00+05:30');
select is(pg_temp.run(), '2/0/2/0/0', 'B9 12 Nov: r6 and r3 queued; r5 (said STOP) and r4 (no consent) blocked');
select is(pg_temp.mst('m1', 'r5', 1, '2026-11-15'), 'blocked/stopped', 'B10 a person who said STOP is blocked (stopped), exactly as for any message');
-- T4 15 Nov 21:30: in the quiet hours; the steps of 10:00 are 11.5 hours late
select pg_temp.pin('2026-11-15T21:30:00+05:30');
select is(pg_temp.run(), '1/1/2/0/0', 'B11 15 Nov 21:30 (quiet hours): r6 queued, r7 HELD for a person (her name reads as a promise), r5 blocked, r8 blocked (no suppression key)');
select is(pg_temp.mst('m1', 'r6', 2, '2026-11-15'), 'queued/campaign_approved', 'B12 r6''s message is queued ...');
select is((select scheduled_for from public.outbox_messages where id = pg_temp.msg('m1', 'r6', 2, '2026-11-15')), '2026-11-16T09:00:00+05:30'::timestamptz, 'B13 ... for 09:00 the next morning (quiet hours are the outbox''s rule)');
select is(pg_temp.mst('m1', 'r7', 1, '2026-11-18'), 'needs_approval/commitment', 'B14 a name that reads as a promise is held for a person (the one hold a campaign keeps)');
select is(pg_temp.mst('m1', 'r8', 1, '2026-11-18'), 'blocked/no_key', 'B15 a person with no suppression key on record is not messaged (no_key)');
-- T6 17 Nov: step 3 for r1, r2 - first with the switches off
select pg_temp.pin('2026-11-17T10:30:00+05:30');
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select is(pg_temp.run(), '0/0/0/0/0', 'B16 17 Nov, the KILL SWITCH off: nothing is sent and nothing is lost');
select is(pg_temp.sst('m1', 'r1', 3), 'planned', 'B17 the step waits (planned)');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.try('a_owner', format($$select public.outbox_set_settings(%L, false, 3)$$, tests.tid('a'))), 'ok', 'B18 the Owner turns automatic sending off ...');
select is(pg_temp.run(), '0/0/0/0/0', 'B19 ... nothing is sent');
select is(pg_temp.try('a_owner', format($$select public.outbox_set_settings(%L, true, 3)$$, tests.tid('a'))), 'ok', 'B20 ... and on again');
select is(pg_temp.try('a_admin', format($$select public.campaign_set_state(%L, %L, 'pause')$$, tests.tid('a'), tests.rid('m1'))), 'ok', 'B21 the Admin PAUSES the campaign');
select is(pg_temp.run(), '0/0/0/0/0', 'B22 a paused campaign sends nothing');
select is(pg_temp.try('a_admin', format($$select public.campaign_set_state(%L, %L, 'resume')$$, tests.tid('a'), tests.rid('m1'))), 'ok', 'B23 resumed');
select is(pg_temp.run(), '2/0/0/0/0', 'B24 the two steps go (they are 30 minutes late, not a day)');
-- T7 18 Nov: day 0 for r7, r8 (the 15 Nov steps were handed over at T4)
select pg_temp.pin('2026-11-18T10:30:00+05:30');
select is(pg_temp.run(), '0/1/1/0/0', 'B25 18 Nov: r7 held again, r8 blocked again (a second message of the same kind, a different id)');
select is((select count(*) from public.outbox_messages where id in (pg_temp.msg('m1', 'r7', 1, '2026-11-18'), pg_temp.msg('m1', 'r7', 2, '2026-11-18'))), 2::bigint, 'B26 two different ids for two steps');
select pg_temp.pin('2026-11-19T10:30:00+05:30');
select is(pg_temp.run(), '1/0/1/0/0', 'B27 19 Nov: step 3 for r3 (queued) and r4 (blocked)');
select pg_temp.pin('2026-11-22T10:30:00+05:30');
select is(pg_temp.run(), '1/0/1/0/0', 'B28 22 Nov: step 3 for r6 (queued) and r5 (blocked)');
select is((select status from public.campaigns where id = tests.rid('m1')), 'running', 'B29 one step is left (day 7 for r7 and r8): still running');
select pg_temp.pin('2026-11-25T10:30:00+05:30');
select is(pg_temp.run(), '0/1/1/0/0', 'B30 25 Nov: the last two: r7 held, r8 blocked');
select is((select status from public.campaigns where id = tests.rid('m1')), 'done', 'B31 nothing is left to do: the campaign is DONE');
select is((select completed_at from public.campaigns where id = tests.rid('m1')), '2026-11-25T10:30:00+05:30'::timestamptz, 'B32 and when');
select is((select count(*) from public.campaign_steps where campaign_id = tests.rid('m1') and status = 'planned'), 0::bigint, 'B33 no step is planned');
select is((select count(*) from public.outbox_messages where category = 'campaign_reminder' and tenant_id = tests.tid('a')), 24::bigint, 'B34 24 messages on record, one per step (sent, held or blocked: none lost)');
select is((select count(distinct id) from public.outbox_messages where category = 'campaign_reminder' and tenant_id = tests.tid('a')), 24::bigint, 'B35 and no id twice');

-- ============================================================================ C. one message in detail
select is((select category || '/' || source || '/' || channel || '/' || (created_by = tests.uid('outsider'))::text from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')), 'campaign_reminder/system/whatsapp/true', 'C1 category campaign_reminder, made by the system for the worker''s account');
select is((select body from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')),
          'Dear Ravi, payment of ₹5,000.00 for INV-101 is due on 10 Nov 2026. Thank you, ' || (select name from public.tenants where id = tests.tid('a')) || '.' || E'\n\n' || 'This message is from the business''s AI assistant.',
          'C2 the words are the approved text filled from his own row, and the FIRST message to a person carries the AI-assistant line');
select is((select body from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 2, '2026-11-10')),
          'Dear Ravi, payment of ₹5,000.00 for INV-101 is due on 10 Nov 2026. Thank you, ' || (select name from public.tenants where id = tests.tid('a')) || '.', 'C3 the second one does not repeat the line');
select is((select 'money' = any (flags) from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')), true, 'C4 the money words are recognised and recorded (flags) ...');
select is((select status || '/' || reason from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')), 'queued/campaign_approved', 'C5 ... but they do not hold it: the Owner approved the whole campaign');
select is((select scheduled_for from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')), '2026-11-07T10:30:00+05:30'::timestamptz, 'C6 and it is ready at once (not in quiet hours)');
select is((select request_sha256 ~ '^[0-9a-f]{64}$' and policy_version = 'outbox-policy-1' from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')), true, 'C7 it carries the outbox''s own policy version and request hash');
select is(pg_temp.sc(format($$select app.campaign_submit(%L, %L, %L, %L, 'Dear Ravi, other words', 'en')$$, tests.uid('outsider'), pg_temp.msg('m1', 'r1', 1, '2026-11-10'), tests.tid('a'), tests.rid('r1_l'))), '23505', 'C8 the same id with OTHER words conflicts: a retry cannot change what was sent');
select is(pg_temp.sc(format($$select app.campaign_submit(%L, %L, %L, %L, %L, 'en')$$, tests.uid('outsider'), pg_temp.msg('m1', 'r1', 1, '2026-11-10'), tests.tid('a'), tests.rid('r1_l'),
                            (select regexp_replace(body, E'\\n\\nThis message.*$', '') from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')))), 'ok', 'C9 the same id with the same words replays');
select is((select count(*) from public.outbox_messages where id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')), 1::bigint, 'C10 ... and adds no row');
select is((select count(*) from public.outbox_events where message_id = pg_temp.msg('m1', 'r1', 1, '2026-11-10') and kind in ('made', 'queued')), 2::bigint, 'C11 the outbox''s own event trail records it (made, queued)');
select is((select count(*) from public.campaign_steps s join public.outbox_messages m on m.id = s.outbox_message_id where s.campaign_id = tests.rid('m1') and m.id = app.campaign_message_id(s.campaign_id, s.recipient_id, s.step_no, (select due_date from public.campaign_recipients where id = s.recipient_id))), 24::bigint, 'C12 every step points at the message whose id its four parts make');

-- ============================================================================ D. the daily limit
select pg_temp.pin('2026-12-01T09:30:00+05:30');
select pg_temp.mk('d1', 'Daily one', '+00 90004 00001');
select is(pg_temp.save('m2', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}, {"offset_days": 0, "time": "11:00"}]', 'Twice a day'), 'ok', 'D1 (setup) two steps on one day');
select is(pg_temp.add('m2', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('d1'), 'due_date', '2026-12-01', 'amount_paise', 100000))), '1', 'D2 (setup) one person');
select is(pg_temp.approve('m2'), 'ok', 'D3 (setup) approved at 09:30');
select is(pg_temp.try('a_owner', format($$select public.outbox_set_settings(%L, true, 1)$$, tests.tid('a'))), 'ok', 'D4 (setup) the business allows ONE message a day to a person');
select pg_temp.pin('2026-12-01T11:30:00+05:30');
select is(pg_temp.run(), '1/0/1/0/0', 'D5 both steps are due: the first goes, the second is blocked by the daily limit');
select is(pg_temp.mst('m2', 'd1', 1, '2026-12-01') || ' ' || pg_temp.mst('m2', 'd1', 2, '2026-12-01'), 'queued/campaign_approved blocked/daily_limit', 'D6 and the results will say so (daily_limit)');
select is(pg_temp.try('a_owner', format($$select public.outbox_set_settings(%L, true, 3)$$, tests.tid('a'))), 'ok', 'D7 (limit back to 3)');

-- ============================================================================ E. the ledger: paid since the list was made
select pg_temp.pin('2026-12-05T11:00:00+05:30');
select pg_temp.mk('lp1', 'Pays in full', '+00 90005 00001');
select pg_temp.mk('lp2', 'Pays in part', '+00 90005 00002');
select pg_temp.mk('lp3', 'Does not pay', '+00 90005 00003');
select is(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'charge', null, %L, date '2026-09-01', 500000, date '2026-12-10', null, null, 'Fee A')$q$, tests.rid('e1'), tests.tid('a'), tests.rid('lp1'))), 'ok', 'E1 (setup) three fees of Rs 5,000 due 10 Dec');
select is(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'charge', null, %L, date '2026-09-01', 500000, date '2026-12-10', null, null, 'Fee B')$q$, tests.rid('e2'), tests.tid('a'), tests.rid('lp2'))), 'ok', 'E2 ...');
select is(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'charge', null, %L, date '2026-09-01', 500000, date '2026-12-10', null, null, 'Fee C')$q$, tests.rid('e3'), tests.tid('a'), tests.rid('lp3'))), 'ok', 'E3 ...');
select is(pg_temp.save('m3', 'Dear {{name}}, {{amount}} is pending, due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}]', 'From the ledger'), 'ok', 'E4 (setup) a campaign');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_ledger(%L, %L, %L::jsonb)->>'added')$q$, tests.tid('a'), tests.rid('m3'), '{"due_from": "2026-12-01", "due_to": "2026-12-31"}')), '3', 'E5 (setup) the list comes from the ledger: three people, Rs 5,000 each');
select is(pg_temp.approve('m3'), 'ok', 'E6 (setup) approved');
select is(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'payment', null, %L, date '2026-10-13', 500000, null, null, null, null, 'upi')$q$, tests.rid('e4'), tests.tid('a'), tests.rid('lp1'))), 'ok', 'E7 then one of them pays in full ...');
select is(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(%L, %L, 'payment', null, %L, date '2026-10-13', 200000, null, null, null, null, 'cash')$q$, tests.rid('e5'), tests.tid('a'), tests.rid('lp2'))), 'ok', 'E8 ... and one pays Rs 2,000 of the Rs 5,000');
select pg_temp.pin('2026-12-10T10:30:00+05:30');
select is(pg_temp.run(), '1/0/0/2/0', 'E9 on the day: only the one who still owes the amount is reminded; the other two are skipped');
select is(pg_temp.sst('m3', 'lp1', 1), 'skipped/paid', 'E10 the one who paid is not reminded (skipped: paid)');
select is(pg_temp.sst('m3', 'lp2', 1), 'skipped/balance_changed', 'E11 the one who paid part is not told the old amount (skipped: balance_changed)');
select is(pg_temp.sst('m3', 'lp3', 1), 'submitted', 'E12 the one who owes is reminded');

-- ============================================================================ F. changed since approval, a template that stopped being approved, steps that are late
select pg_temp.pin('2026-12-20T11:00:00+05:30');
select pg_temp.mk('t1', 'Tamper one', '+00 90006 00001');
select pg_temp.mk('t2', 'Template two', '+00 90006 00002');
select pg_temp.mk('t3', 'Late three', '+00 90006 00003');
select is(pg_temp.save('m4', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}]', 'Tampered'), 'ok', 'F1 (setup) a campaign for one person');
select is(pg_temp.add('m4', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('t1'), 'due_date', '2026-12-22', 'amount_paise', 100000))), '1', 'F2 (setup) Rs 1,000');
select is(pg_temp.approve('m4'), 'ok', 'F3 (setup) approved');
alter table public.campaign_recipients disable trigger campaign_recipients_guard;
update public.campaign_recipients set amount_paise = 9900000, row_hash = repeat('f', 64) where campaign_id = tests.rid('m4');
alter table public.campaign_recipients enable trigger campaign_recipients_guard;
select pg_temp.pin('2026-12-22T10:30:00+05:30');
select is(pg_temp.run(), '0/0/0/1/0', 'F4 someone changed the amount behind the Owner''s back: the worker finds the campaign is not what was approved ...');
select is((select status from public.campaigns where id = tests.rid('m4')), 'draft', 'F5 ... sends NOTHING, and the campaign goes back to draft');
select is((select count(*) from public.outbox_messages where body like '%99,000%'), 0::bigint, 'F6 the changed amount reached no one');
select pg_temp.pin('2026-12-23T11:00:00+05:30');
select is(pg_temp.save('m5', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}]', 'Template stops'), 'ok', 'F7 (setup) a campaign');
select is(pg_temp.add('m5', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('t2'), 'due_date', '2026-12-24', 'amount_paise', 100000))), '1', 'F8 (setup) one person');
select is(pg_temp.approve('m5'), 'ok', 'F9 (setup) approved');
update integrations.wa_templates set status = 'paused' where id = tests.rid('tpl');
select pg_temp.pin('2026-12-24T10:30:00+05:30');
select is(pg_temp.run(), '0/0/0/1/0', 'F10 the template was paused after approval: the worker does not send');
select is(pg_temp.sst('m5', 't2', 1), 'skipped/template', 'F11 and says why (skipped: template)');
update integrations.wa_templates set status = 'approved' where id = tests.rid('tpl');
select pg_temp.pin('2026-12-26T11:00:00+05:30');
select is(pg_temp.save('m6', 'Dear {{name}}, payment of {{amount}} is due on {{due_date}}.', '[{"offset_days": 0, "time": "10:00"}]', 'Late'), 'ok', 'F12 (setup) a campaign');
select is(pg_temp.add('m6', jsonb_build_array(jsonb_build_object('contact_id', tests.rid('t3'), 'due_date', '2026-12-28', 'amount_paise', 100000))), '1', 'F13 (setup) one person');
select is(pg_temp.approve('m6'), 'ok', 'F14 (setup) approved');
select pg_temp.pin('2026-12-30T10:30:00+05:30');
select is(pg_temp.run(), '0/0/0/1/0', 'F15 the worker was down for two days: a step more than a day late is not sent');
select is(pg_temp.sst('m6', 't3', 1), 'skipped/missed', 'F16 (skipped: missed)');

-- ============================================================================ G. the WhatsApp template of a campaign message
insert into integrations.whatsapp_accounts (tenant_id, waba_id, phone_number_id, token_ref, status) values (tests.tid('a'), '1234567890', '9876543210', 'WA_TOKEN_A', 'active');
select is(app.wa_send_context((select m from public.outbox_messages m where m.id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')), '2026-11-07T11:00:00+05:30'::timestamptz) -> 'template' ->> 'name', 'dues_reminder',
          'G1 a campaign message is sent with the template ITS CAMPAIGN names (outside the 24-hour window the adapter needs one)');
update integrations.wa_templates set status = 'paused' where id = tests.rid('tpl');
select is(app.wa_send_context((select m from public.outbox_messages m where m.id = pg_temp.msg('m1', 'r1', 1, '2026-11-10')), '2026-11-07T11:00:00+05:30'::timestamptz) -> 'template' = 'null'::jsonb, true, 'G2 a template that is no longer approved is never named');
update integrations.wa_templates set status = 'approved' where id = tests.rid('tpl');

select * from finish();
rollback;
