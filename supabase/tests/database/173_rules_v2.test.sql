-- SPEED-TO-LEAD RULES v2 (migration 20261231975000; owner, 15 Nov 2026): WhatsApp from a rule is an approved TEMPLATE by name (never free text); the retry ladder 10 minutes, 2 hours, next morning 09:30,
-- then the missed-call template and stop; language "auto"; the weekly cap does not count the item's own ladder. The clock is pinned: Monday 2 November 2026, 11:00 India time.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-02T11:00:00+05:30'::timestamptz);
select app.operator_register_scheduler('x5@test.local');
create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_json text, p_path text) returns text language sql as $$ select (p_json::jsonb #>> string_to_array(p_path, '.')) $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.val('x5', p_sql) $$;

select tests.cn_guards_off();
select tests.open_gate('a');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Rules V2 Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent) values
  (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Kiran One', '+91 98333 00001', 'granted', 'granted'),
  (tests.rid('k2'), tests.tid('a'), tests.rid('co'), 'Kiran Two', '+91 98333 00002', 'granted', 'granted'),
  (tests.rid('k3'), tests.tid('a'), tests.rid('co'), 'Kiran Three', '+91 98333 00003', 'granted', 'unknown'),
  (tests.rid('k4'), tests.tid('a'), tests.rid('co'), 'Kiran Four', '+91 98333 00004', 'granted', 'granted'),
  (tests.rid('k5'), tests.tid('a'), tests.rid('co'), 'రవి కుమార్', '+91 98333 00005', 'granted', 'granted'),
  (tests.rid('k6'), tests.tid('a'), tests.rid('co'), 'Kiran Six', '+91 98333 00006', 'granted', 'granted');
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
-- the messages go out only for a number whose suppression key is on record
select tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(k), jsonb_build_object('version', 1, 'phone', pg_temp.h(k || '_p'))::text)) from unnest(array['k1', 'k2', 'k3', 'k4', 'k5', 'k6']) k;
create function pg_temp.lead(p_k text, p_source text, p_at text) returns void language sql as $$
  insert into public.leads (id, tenant_id, company_id, contact_id, source, created_at) values (tests.rid('l' || right(p_k, 1)), tests.tid('a'), tests.rid('co'), tests.rid(p_k), p_source, p_at::timestamptz) $$;

create function pg_temp.rule(p_id text, p_source text, p_extra text default '', p_channel text default 'both') returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select public.outreach_rule_save(%L, %L::jsonb)::text$q$, tests.tid('a'),
    format('{"rule_id": "%s", "source": "%s", "action": "call_within_minutes", "within_minutes": 0, "goal": "general", "channel": "%s", "language": "auto", "questions": []%s}', tests.rid(p_id), p_source, p_channel, p_extra))) $$;
create function pg_temp.item(p_rule text, p_lead text) returns uuid language sql as $$ select id from public.outreach_items where rule_id = tests.rid(p_rule) and lead_id = tests.rid(p_lead) $$;
create function pg_temp.res(p_item uuid, p_result text) returns text language sql as $$
  select pg_temp.sch(format($q$select public.outreach_item_result(%L, %L, %L, null, 0, false)::text$q$, tests.tid('a'), p_item, p_result)) $$;
create function pg_temp.due(p_item uuid) returns text language sql as $$ select next_action || '@' || (next_at at time zone 'Asia/Kolkata')::text from public.outreach_items where id = p_item $$;

-- A. saving a rule: template names, language auto, no free text
select is(pg_temp.j(pg_temp.rule('r1', 'src1'), 'language'), 'auto', 'A1 a rule may say language auto');
select is(pg_temp.rule('r9', 'srcx', ', "message_text": "Hello {name}"'), 'ERR:22023', 'A2 message text is not accepted on a rule: WhatsApp is a template picked by name');
select is(pg_temp.rule('r9', 'srcx', ', "wa_first_template": "Lead Ack!"'), 'ERR:22023', 'A3 a template name is a plain name');
select is(pg_temp.j(pg_temp.rule('r2', 'src2', ', "wa_first_template": "lead_ack", "wa_missed_template": "missed_call_followup"'), 'wa_missed_template'), 'missed_call_followup', 'A4 the two names are kept');
select is((select (pg_temp.val('a_owner', format($q$select (public.outreach_rules_list(%L) -> 0 -> 'warnings')::text$q$, tests.tid('a'))))), '["template_not_approved"]', 'A5 no approved template yet: the rule warns');
select is(pg_temp.val('a_owner', format($q$select (public.outreach_rules_list(%L) -> 0 ? 'message_text')::text$q$, tests.tid('a'))), 'false', 'A6 a rule shows no message text');

-- B. the policy: the retry steps
select is(pg_temp.val('a_owner', format($q$select (public.outreach_policy_get(%L) -> 'retry_steps')::text$q$, tests.tid('a'))), '[{"after_minutes": 10}, {"after_minutes": 120}, {"next_morning_minute": 600}]', 'B1 the default ladder: 10 minutes, 2 hours, next morning 10:00');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"retry_steps": [{"after_minutes": 0}]}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:22023', 'B2 a step of zero minutes is invalid');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"retry_steps": [{"after_minutes": 5, "next_morning_minute": 570}]}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:22023', 'B3 a step is one thing or the other');
select is(pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"retry_steps": []}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:22023', 'B4 at least one step');
select is(pg_temp.val('a_owner', format($q$select (public.outreach_policy_set(%L, '{"retry_steps": [{"after_minutes": 30}, {"next_morning_minute": 600}]}'::jsonb) -> 'retry_steps' -> 1 ->> 'next_morning_minute')$q$, tests.tid('a'))), '600', 'B5 the Owner changes the ladder');
select is(pg_temp.val('a_admin', format($q$select public.outreach_policy_set(%L, '{"retry_steps": [{"after_minutes": 30}]}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:42501', 'B6 an Admin cannot');
select pg_temp.val('a_owner', format($q$select public.outreach_policy_set(%L, '{"retry_steps": [{"after_minutes": 10}, {"after_minutes": 120}, {"next_morning_minute": 570}]}'::jsonb)::text$q$, tests.tid('a')));

-- C. language auto
select is(app.outreach_lang(tests.tid('a'), tests.rid('k1'), 'te'), 'te', 'C1 a chosen language stays');
select is(app.outreach_lang(tests.tid('a'), tests.rid('k5'), 'auto'), 'te', 'C2 auto: a name in Telugu script is a Telugu speaker');
select is(app.outreach_lang(tests.tid('a'), tests.rid('k1'), 'auto'), 'en', 'C3 auto with nothing to go on: the business language (English by default)');
update public.assistant_settings set main_language = 'hi' where tenant_id = tests.tid('a');
select is(app.outreach_lang(tests.tid('a'), tests.rid('k1'), 'auto'), case when exists (select 1 from public.assistant_settings where tenant_id = tests.tid('a')) then 'hi' else 'en' end, 'C4 auto: the business language when the lead''s own is unknown');

-- D. the ladder of a lead rule: the call, 10 minutes, 2 hours, next morning 09:30, the missed-call template, stop
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) values
  (tests.rid('t1'), tests.tid('a'), 'lead_ack', 'en', 'utility', 'lead', 'Hello {{1}}, thank you for contacting {{2}}. We will call you shortly.', 'approved'),
  (tests.rid('t2'), tests.tid('a'), 'missed_call_followup', 'en', 'utility', 'info', 'Hello {{1}}, we tried to call you from {{2}}. Tell us a good time and we will call you back.', 'approved');
insert into integrations.whatsapp_accounts (tenant_id, waba_id, phone_number_id, token_ref, status) values (tests.tid('a'), '1234567890', '9876543210', 'WA_TOKEN_A', 'active');
update public.assistant_settings set main_language = 'en' where tenant_id = tests.tid('a');
select is((pg_temp.val('a_owner', format($q$select (public.outreach_rules_list(%L) -> 0 -> 'warnings')::text$q$, tests.tid('a')))), '[]', 'D0 with both templates approved the rule has no warning');
select pg_temp.pin('2026-11-02T11:05:00+05:30'::timestamptz);
select pg_temp.lead('k1', 'src1', '2026-11-02T11:05:00+05:30');
select is(pg_temp.sch('select public.scheduler_outreach_scan(100)::text'), '{"added": 1}', 'D1 the scan takes the lead of the rule');
select is(pg_temp.due(pg_temp.item('r1', 'l1')), 'call@2026-11-02 11:05:00', 'D2 "immediately": the call is due the moment the lead is stored');
select is(pg_temp.sch('select (public.scheduler_outreach_run(10) -> ''calls'' -> 0 ->> ''language'')'), 'en', 'D3 the dialer is handed the call, in the lead''s language (auto: the business language)');
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_run(10) -> ''calls'')::text'), '0', 'D3b (a claimed call is not handed twice)');
select is((pg_temp.res(pg_temp.item('r1', 'l1'), 'no_answer')::jsonb ->> 'next_at')::timestamptz, '2026-11-02T11:15:00+05:30'::timestamptz, 'D4 no answer: the next call in 10 minutes');
select pg_temp.pin('2026-11-02T11:15:00+05:30'::timestamptz);
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is((pg_temp.res(pg_temp.item('r1', 'l1'), 'no_answer')::jsonb ->> 'next_at')::timestamptz, '2026-11-02T13:15:00+05:30'::timestamptz, 'D5 no answer again: the next call in 2 hours');
select pg_temp.pin('2026-11-02T13:15:00+05:30'::timestamptz);
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is((pg_temp.res(pg_temp.item('r1', 'l1'), 'busy')::jsonb ->> 'next_at')::timestamptz, '2026-11-03T10:00:00+05:30'::timestamptz, 'D6 and again: the next morning at 10:00');
select pg_temp.pin('2026-11-03T10:00:00+05:30'::timestamptz);
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is(pg_temp.res(pg_temp.item('r1', 'l1'), 'no_answer')::jsonb ->> 'whatsapp', 'missed', 'D7 the fourth call is not answered: the missed-call template comes next');
select is(pg_temp.due(pg_temp.item('r1', 'l1')), 'whatsapp@2026-11-03 10:00:00', 'D8 ... now');
select is((select (pg_temp.sch('select (public.scheduler_outreach_run(10) ->> ''whatsapp'')'))), '1', 'D9 one WhatsApp is sent');
select is((select a.result || ':' || a.template from public.outreach_attempts a where a.item_id = pg_temp.item('r1', 'l1') and a.channel = 'whatsapp'), 'sent:missed_call_followup', 'D10 it is the missed-call template');
select is((select i.status from public.outreach_items i where i.id = pg_temp.item('r1', 'l1')), 'done', 'D11 and the lead is done: four calls and one template');
select is((select count(*)::int from public.outreach_attempts a where a.item_id = pg_temp.item('r1', 'l1') and a.channel = 'call'), 4, 'D12 four calls at most');
select is((select app.wa_send_context(m, now()) -> 'template' ->> 'name' from public.outbox_messages m where m.lead_id = tests.rid('l1') limit 1), 'missed_call_followup', 'D13 the send path names the template the rule chose');
select is((select app.wa_send_context(m, now()) -> 'template' -> 'variables' ->> 0 from public.outbox_messages m where m.lead_id = tests.rid('l1') limit 1), 'Kiran', 'D14 with the lead''s first name as the variable');
select is((select count(*)::int from public.outbox_messages m where m.lead_id = tests.rid('l1')), 1, 'D15 exactly one message');

-- E. a rule that is "call only" never sends WhatsApp
select pg_temp.pin('2026-11-03T10:00:00+05:30'::timestamptz);
select is(pg_temp.j(pg_temp.rule('r3', 'src4', '', 'call'), 'channel'), 'call', 'E0 a call-only rule');
select pg_temp.lead('k4', 'src4', '2026-11-03T10:00:00+05:30');
select pg_temp.sch('select public.scheduler_outreach_scan(100)::text');
select is(pg_temp.due(pg_temp.item('r3', 'l4')), 'call@2026-11-03 10:00:00', 'E1 the call');
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select pg_temp.res(pg_temp.item('r3', 'l4'), 'no_answer');
select pg_temp.pin('2026-11-03T10:10:00+05:30'::timestamptz); select pg_temp.sch('select public.scheduler_outreach_run(10)::text'); select pg_temp.res(pg_temp.item('r3', 'l4'), 'no_answer');
select pg_temp.pin('2026-11-03T12:10:00+05:30'::timestamptz); select pg_temp.sch('select public.scheduler_outreach_run(10)::text'); select pg_temp.res(pg_temp.item('r3', 'l4'), 'no_answer');
select pg_temp.pin('2026-11-04T09:30:00+05:30'::timestamptz); select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is(pg_temp.res(pg_temp.item('r3', 'l4'), 'no_answer')::jsonb ->> 'reason', 'attempts_used', 'E2 the ladder is used up: stopped, no WhatsApp');
select is((select count(*)::int from public.outreach_attempts a where a.item_id = pg_temp.item('r3', 'l4') and a.channel = 'whatsapp'), 0, 'E3 nothing was sent');

-- F. the first call could not even start: the first template (passed over without WhatsApp consent), then the ladder goes on
select pg_temp.pin('2026-11-04T10:00:00+05:30'::timestamptz);
select pg_temp.rule('r4', 'src3');
select pg_temp.lead('k3', 'src3', '2026-11-04T10:00:00+05:30');
select pg_temp.sch('select public.scheduler_outreach_scan(100)::text');
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is(pg_temp.res(pg_temp.item('r4', 'l3'), 'failed')::jsonb ->> 'whatsapp', 'first', 'F1 the first call failed: the first template is next');
select is(pg_temp.sch('select (public.scheduler_outreach_run(10) ->> ''whatsapp'')'), '0', 'F2 this person gave no WhatsApp consent: nothing is sent');
select is((select a.result || ':' || a.template from public.outreach_attempts a where a.item_id = pg_temp.item('r4', 'l3') and a.channel = 'whatsapp'), 'blocked:lead_ack', 'F3 it is written down as blocked');
select is(pg_temp.due(pg_temp.item('r4', 'l3')), 'call@2026-11-04 10:10:00', 'F4 and the call comes again in 10 minutes');
select pg_temp.pin('2026-11-04T10:30:00+05:30'::timestamptz);
select pg_temp.rule('r6', 'src6');
select pg_temp.lead('k6', 'src6', '2026-11-04T10:30:00+05:30');
select pg_temp.sch('select public.scheduler_outreach_scan(100)::text');
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select pg_temp.res(pg_temp.item('r6', 'l6'), 'failed');
select is(pg_temp.sch('select (public.scheduler_outreach_run(10) ->> ''whatsapp'')'), '1', 'F5 with consent the first template is sent');
select is((select a.result || ':' || a.template from public.outreach_attempts a where a.item_id = pg_temp.item('r6', 'l6') and a.channel = 'whatsapp'), 'sent:lead_ack', 'F6 it is lead_ack');
select is((select app.wa_send_context(m, now()) -> 'template' ->> 'name' from public.outbox_messages m where m.lead_id = tests.rid('l6') limit 1), 'lead_ack', 'F6b and the send path names it');

-- F7. a Telugu name: language auto picks Telugu; no approved Telugu template exists, so nothing goes out (never as free text)
select pg_temp.rule('r7', 'src5');
select pg_temp.lead('k5', 'src5', '2026-11-04T10:30:00+05:30');
select pg_temp.sch('select public.scheduler_outreach_scan(100)::text');
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select pg_temp.res(pg_temp.item('r7', 'l5'), 'failed');
select is(pg_temp.sch('select (public.scheduler_outreach_run(10) ->> ''whatsapp'')'), '0', 'F7 a Telugu lead and no approved Telugu template: nothing is sent');
select is((select a.result || ':' || a.template from public.outreach_attempts a where a.item_id = pg_temp.item('r7', 'l5') and a.channel = 'whatsapp'), 'blocked:lead_ack', 'F8 it is written down as blocked');

-- G. a person who said STOP stops at once
select pg_temp.pin('2026-11-04T11:00:00+05:30'::timestamptz);
select pg_temp.lead('k2', 'src2', '2026-11-04T11:00:00+05:30');
select pg_temp.sch('select public.scheduler_outreach_scan(100)::text');
select pg_temp.sch('select public.scheduler_outreach_run(10)::text');
select is(pg_temp.j(pg_temp.sch(format($q$select public.outreach_item_result(%L, %L, 'no_answer', null, 0, true)::text$q$, tests.tid('a'), pg_temp.item('r2', 'l2'))), 'reason'), 'stopped', 'G1 "stop" stops it at once');

select * from finish();
rollback;
