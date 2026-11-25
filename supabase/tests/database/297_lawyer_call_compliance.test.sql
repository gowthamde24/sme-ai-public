-- The lawyer's written opinion (migrations 20261231992600 to 992630): the 10:00 call window in the stored bounds, the number-usage statement (Owner only, dated), where a consent came from, complaints (counts, the
-- 3 and 5 marks, never another workspace's call), abandoned calls, the AI mention default ON and its undertaking, the monitored flag, and a number attached with calls ON only for a verified client.
begin;
select no_plan();
select tests.seed_two_tenants();
create function pg_temp.sc(p_user text, p_aal text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A. the 10:00 window in what is stored
select is((select count(*) from pg_constraint where conrelid = 'public.assistant_settings'::regclass and pg_get_constraintdef(oid) like '%call_from_minute >= 600%'), 1::bigint, 'A1: assistant call hours start at 10:00 at the earliest');
select is((select count(*) from pg_constraint where conrelid = 'public.outreach_policy'::regclass and pg_get_constraintdef(oid) like '%night_call_minute >= 600%'), 1::bigint, 'A2: the Lead Desk''s morning call is 10:00 at the earliest');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'outreach_policy' and column_name = 'night_call_minute'), '600', 'A3: and defaults to 10:00');

-- B. the usage statement: Owner only, with a second factor, dated, one per workspace
select is(pg_temp.sc('a_owner', 'aal1', format($q$select public.number_usage_ack_accept(%L, '2026-11')::text$q$, tests.tid('a'))) like 'ERR:%', true, 'B1: without a fresh second factor it is refused');
select is(pg_temp.sc('a_admin', 'aal2', format($q$select public.number_usage_ack_accept(%L, '2026-11')::text$q$, tests.tid('a'))), 'ERR:42501', 'B2: an Admin cannot accept for the Owner');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.number_usage_ack_accept(%L, 'Not A Version')::text$q$, tests.tid('a'))), 'ERR:22023', 'B3: the version is a plain label');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.number_usage_ack_accept(%L, '2026-11') ->> 'accepted'$q$, tests.tid('a'))), 'true', 'B4: the Owner accepts');
select is(pg_temp.sc('a_admin', 'aal2', format($q$select (public.number_usage_ack_get(%L) ->> 'version')$q$, tests.tid('a'))), '2026-11', 'B5: an Admin can read it');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select public.number_usage_ack_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B6: another workspace cannot');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.number_usage_ack_get(%L) ->> 'accepted')$q$, tests.tid('b'))), 'ERR:42501', 'B7: nor can this Owner read the other one''s');
select is((select count(*) from telephony.number_usage_acks where tenant_id = tests.tid('a') and accepted_by = tests.uid('a_owner')), 1::bigint, 'B8: the date and who are kept');
select is(has_table_privilege('authenticated', 'telephony.number_usage_acks', 'select'), false, 'B9: the table is closed to every client role');

-- C. where a consent came from
insert into public.companies (id, tenant_id, name) values (tests.rid('lc_company'), tests.tid('a'), 'Lawyer test company');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, email) values (tests.rid('lc_c1'), tests.tid('a'), tests.rid('lc_company'), 'Consent Source', '+009876543210', 'consent@example.test');
insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by) values (tests.tid('a'), tests.rid('lc_c1'), 'granted', 'phone', 'explicit_consent', 'verbal', 'note:said-on-phone', tests.uid('a_owner'));
select is(app.phone_consent_source(tests.tid('a'), tests.rid('lc_c1')), 'business_statement', 'C1: a verbal statement is a business statement');
insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by, created_at) values (tests.tid('a'), tests.rid('lc_c1'), 'granted', 'phone', 'explicit_consent', 'web_form', 'form:contact-page', tests.uid('a_owner'), now() + interval '1 second');
select is(app.phone_consent_source(tests.tid('a'), tests.rid('lc_c1')), 'digital_enquiry', 'C2: the newest one wins: a web form is a digital enquiry');
insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by, created_at) values (tests.tid('a'), tests.rid('lc_c1'), 'granted', 'phone', 'explicit_consent', 'other', 'registrar:REG-2026-000123', tests.uid('a_owner'), now() + interval '2 seconds');
select is(app.phone_consent_source(tests.tid('a'), tests.rid('lc_c1')), 'registered_consent', 'C3: a Consent Registrar id is a registered consent');
insert into public.consent_events (tenant_id, contact_id, event_type, channel, recorded_by, created_at) values (tests.tid('a'), tests.rid('lc_c1'), 'withdrawn', 'phone', tests.uid('a_owner'), now() + interval '3 seconds');
select is(app.phone_consent_source(tests.tid('a'), tests.rid('lc_c1')) is null, true, 'C4: after a withdrawal no grant before it counts');

-- D. the age of an enquiry
select is(app.digital_enquiry_age_days(tests.tid('a'), tests.rid('lc_c1')), null::numeric, 'D1: no written enquiry, no age');

-- E. complaints
select is(pg_temp.sc('a_sales', 'aal2', format($q$select public.call_complaint_record(%L, 'to_business')::text$q$, tests.tid('a'))), 'ERR:42501', 'E1: only an Owner or Admin records one');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select public.call_complaint_record(%L, 'to_business')::text$q$, tests.tid('a'))), 'ERR:42501', 'E2: not for another workspace');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.call_complaint_record(%L, 'gossip')::text$q$, tests.tid('a'))), 'ERR:22023', 'E3: a closed kind');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.call_complaint_record(%L, 'regulator', gen_random_uuid())::text$q$, tests.tid('a'))), 'ERR:23503', 'E4: a call that is not this workspace''s is not found');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.call_complaint_record(%L, 'to_business') ->> 'warn')$q$, tests.tid('a'))), 'false', 'E5: one is no warning');
select pg_temp.sc('a_owner', 'aal2', format($q$select public.call_complaint_record(%L, 'telecom_provider')::text$q$, tests.tid('a')));
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.call_complaint_record(%L, 'regulator') ->> 'warn')$q$, tests.tid('a'))), 'true', 'E6: the third warns');
select pg_temp.sc('a_owner', 'aal2', format($q$select public.call_complaint_record(%L, 'regulator')::text$q$, tests.tid('a')));
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.call_complaint_record(%L, 'regulator') ->> 'paused')$q$, tests.tid('a'))), 'true', 'E7: the fifth pauses');
select is(app.call_complaints_count(tests.tid('a'), 10), 5, 'E8: five counted');
select is(app.call_complaints_count(tests.tid('b'), 10), 0, 'E9: none for the other workspace');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select count(*)::text from public.call_complaints where tenant_id = %L$q$, tests.tid('a'))), '0', 'E10: and it cannot read them');

-- F. abandoned calls
select is((app.abandoned_call_stats(tests.tid('b'), 24) ->> 'answered')::int, 0, 'F1: no calls, no answered');
select is(pg_temp.sc('a_owner', 'aal2', 'select public.admin_abandoned_calls(24)::text') like 'ERR:%', true, 'F2: a workspace Owner is not staff');

-- G. the AI mention
insert into public.talk_training (tenant_id, doc, updated_by) values (tests.tid('a'), '{"say_ai_when_greeting": false}'::jsonb, tests.uid('a_owner'));
select is(app.outbox_mention_ai(tests.tid('a')), true, 'G1: an off without the undertaking is on');
select is(app.outbox_mention_ai(tests.tid('b')), true, 'G2: nothing saved: on (the default)');
update public.talk_training set doc = '{"say_ai_when_greeting": false, "ai_off_undertaking": {"at": "2026-11-26T09:00:00+00:00", "by": "u1", "version": "2026-11"}}'::jsonb where tenant_id = tests.tid('a');
select is(app.outbox_mention_ai(tests.tid('a')), false, 'G3: off with the stored undertaking is off');
update public.talk_training set doc = '{"say_ai_when_greeting": true, "say_ai_by_job": {"followups": "off"}}'::jsonb where tenant_id = tests.tid('a');
select is(app.outbox_mention_ai(tests.tid('a'), 'followup'), true, 'G4: a job''s off without the undertaking is on');
update public.talk_training set doc = '{"say_ai_when_greeting": true, "say_ai_by_job": {"followups": "off"}, "ai_off_undertaking": {"at": "2026-11-26T09:00:00+00:00", "by": "u1"}}'::jsonb where tenant_id = tests.tid('a');
select is(app.outbox_mention_ai(tests.tid('a'), 'followup'), false, 'G5: with it the job is off');

-- H. the monitored flag: the scheduler account only
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.phone_monitored_for_call(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'H1: a member cannot ask');
select is(has_function_privilege('anon', 'public.phone_monitored_for_call(uuid)', 'execute'), false, 'H2: a stranger has no door');

-- I. the new refusal words fit on a call row
select is((select count(*) from pg_constraint where conrelid = 'public.phone_calls'::regclass and pg_get_constraintdef(oid) like '%enquiry_too_old%' and pg_get_constraintdef(oid) like '%usage_not_accepted%'), 1::bigint, 'I1: the call row may hold the new refusal words');
-- J. a business waiting for a free VoiceLink channel (migration 992640)
select is(pg_temp.sc('a_sales', 'aal2', format($q$select public.business_line_wait_put(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'J1: only the Owner marks a wait');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select public.business_line_wait_put(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'J2: not for another workspace');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.business_line_wait_put(%L) ->> 'tries')$q$, tests.tid('a'))), '1', 'J3: the Owner marks it');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.business_line_wait_put(%L) ->> 'tries')$q$, tests.tid('a'))), '2', 'J4: and a retry counts');
select is(pg_temp.sc('a_admin', 'aal2', format($q$select (public.business_line_wait_get(%L) ->> 'waiting')$q$, tests.tid('a'))), 'true', 'J5: an Admin can read it');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select (public.business_line_wait_get(%L) ->> 'waiting')$q$, tests.tid('b'))), 'false', 'J6: the other workspace is not waiting');
select is((select count(*) from jsonb_array_elements(admin.computed_alerts('support')) x where x ->> 'kind' = 'no_free_channels'), 1::bigint, 'J7: staff see the alert while anyone waits');
select is((select count(*) from jsonb_array_elements(admin.computed_alerts('finance')) x where x ->> 'kind' = 'no_free_channels'), 0::bigint, 'J8: finance does not (owner and support only)');
select pg_temp.sc('a_owner', 'aal2', format($q$select public.business_line_wait_clear(%L)::text$q$, tests.tid('a')));
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.business_line_wait_get(%L) ->> 'waiting')$q$, tests.tid('a'))), 'false', 'J9: cleared once the client exists');
select is(has_table_privilege('authenticated', 'telephony.line_waits', 'select'), false, 'J10: the table is closed to every client role');
-- K. the first month of a number, held on the wallet (migration 992650)
select is((select extra_number_paise from pricing.settings), 49900::bigint, 'K1: a phone number with its first line is Rs 499 (config)');
select is(pg_temp.sc('a_sales', 'aal2', format($q$select public.line_reserve_place(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'K2: only the Owner places it');
select is(pg_temp.sc('a_owner', 'aal1', format($q$select public.line_reserve_place(%L)::text$q$, tests.tid('a'))) like 'ERR:%', true, 'K3: with a second factor');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_place(%L) ->> 'reason')$q$, tests.tid('a'))), 'credits_needed', 'K4: too little credit: nothing is placed and it says so');
select is((select count(*) from telephony.line_reserves where tenant_id = tests.tid('a')), 0::bigint, 'K5: and nothing was created');
select pricing.credit(tests.tid('a'), 'topup', 'pay_res_k1', 100000);
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_place(%L) ->> 'placed')$q$, tests.tid('a'))), 'true', 'K6: with credit it is placed');
select is(pricing.balance_of(tests.tid('a')), 100000::bigint - 49900, 'K7: the first month left the balance');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_place(%L) ->> 'replayed')$q$, tests.tid('a'))), 'true', 'K8: a second call debits nothing more');
select is(pricing.balance_of(tests.tid('a')), 100000::bigint - 49900, 'K9: the balance did not move');
select is((select count(*) from pricing.usage where tenant_id = tests.tid('a') and kind = 'number_reserved'), 1::bigint, 'K10: one usage row of the new kind');
select is((select string_agg(x ->> 'label', ',') from jsonb_array_elements(pricing.statement_internal(tests.tid('a'), null, null, 100, null) -> 'items') x where x ->> 'label' like 'Held%'), 'Held for your phone number', 'K11: the statement says it in plain words');
select is(pg_temp.sc('a_admin', 'aal2', format($q$select public.line_reserve_close(%L, 'refunded')::text$q$, tests.tid('a'))), 'ERR:42501', 'K12: an Admin cannot cancel it');
select is(pg_temp.sc('b_owner', 'aal2', format($q$select public.line_reserve_close(%L, 'refunded')::text$q$, tests.tid('a'))), 'ERR:42501', 'K13: nor another workspace');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_close(%L, 'refunded') ->> 'closed')$q$, tests.tid('a'))), 'true', 'K14: the Owner cancels: refunded');
select is(pricing.balance_of(tests.tid('a')), 100000::bigint, 'K15: the whole amount is back');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_close(%L, 'refunded') ->> 'closed')$q$, tests.tid('a'))), 'false', 'K16: a second cancel refunds nothing');
select is(pricing.balance_of(tests.tid('a')), 100000::bigint, 'K17: the balance did not move again');
select is((select string_agg(x ->> 'label', ',') from jsonb_array_elements(pricing.statement_internal(tests.tid('a'), null, null, 100, null) -> 'items') x where x ->> 'label' like 'Refund%'), 'Refund to your balance', 'K18: the refund shows on the statement');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_place(%L) ->> 'replayed')$q$, tests.tid('a'))), 'false', 'K19: after a refund it can be placed again');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_close(%L, 'applied') ->> 'closed')$q$, tests.tid('a'))), 'true', 'K20: a bought number applies it: no money moves');
select is(pricing.balance_of(tests.tid('a')), 100000::bigint - 49900, 'K21: the number fee stays paid');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_close(%L, 'refunded') ->> 'closed')$q$, tests.tid('a'))), 'false', 'K22: an applied one cannot be refunded');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.line_reserve_close(%L, 'gift')::text$q$, tests.tid('a'))), 'ERR:22023', 'K23: closed outcomes only');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select (public.line_reserve_get(%L) ->> 'state')$q$, tests.tid('a'))), 'applied', 'K24: the state can be read');
select is(has_table_privilege('authenticated', 'telephony.line_reserves', 'select'), false, 'K25: the table is closed to every client role');
select is(has_function_privilege('anon', 'public.scheduler_line_reserves_due(integer)', 'execute'), false, 'K26: a stranger cannot list due reserves');
select is(pg_temp.sc('a_owner', 'aal2', 'select public.scheduler_line_reserves_due(10)::text'), 'ERR:42501', 'K27: nor a member (the worker only)');
select is(pg_temp.sc('a_owner', 'aal2', format($q$select public.scheduler_line_reserve_refund(%L, 'expired')::text$q$, tests.tid('a'))), 'ERR:42501', 'K28: nor refund');

-- L. lines included in a number
insert into public.phone_numbers (tenant_id, number, provider, inbound_on, label) values (tests.tid('b'), '+009876500001', 'voicelink', true, 'old');
insert into public.phone_numbers (tenant_id, number, provider, inbound_on, label, included_lines) values (tests.tid('b'), '+009876500002', 'voicelink', true, 'new', 1);
select is(app.included_lines(tests.tid('b')), 3, 'L1: an older number keeps 2 lines and a new one has 1');
select is(app.workspace_lines(tests.tid('b')), 3, 'L2: the workspace total follows');

-- M. channel stock for the staff alert
select is(has_function_privilege('anon', 'public.scheduler_channel_stock_put(integer)', 'execute'), false, 'M1: a stranger cannot report the stock');
select is(pg_temp.sc('a_owner', 'aal2', 'select public.scheduler_channel_stock_put(1)::text'), 'ERR:42501', 'M2: nor a member');
insert into ops.channel_stock (free_channels) values (1) on conflict (only_row) do update set free_channels = 1, seen_at = now();
select is((select count(*) from jsonb_array_elements(admin.computed_alerts('support')) x where x ->> 'kind' = 'channels_low'), 1::bigint, 'M3: one free channel raises the low-stock alert');
update ops.channel_stock set free_channels = 4;
select is((select count(*) from jsonb_array_elements(admin.computed_alerts('support')) x where x ->> 'kind' = 'channels_low'), 0::bigint, 'M4: four do not');
update ops.channel_stock set free_channels = 0, seen_at = now() - interval '3 days';
select is((select count(*) from jsonb_array_elements(admin.computed_alerts('support')) x where x ->> 'kind' = 'channels_low'), 0::bigint, 'M5: a figure older than two days is not trusted');
select * from finish();
rollback;
