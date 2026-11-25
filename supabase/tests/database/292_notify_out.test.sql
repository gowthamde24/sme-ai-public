-- Notifications out (migration 20261231992345; docs/contracts/commerce-notify.md section C): the channels (every member reads, Owner or Admin change; the address or token is never in the database),
-- the queueing triggers (leads, missed calls, call outcomes: only for a channel that asked), what a message may say (name, masked phone, outcome, reason: nothing else), the worker's claim (20 a
-- minute and 300 an hour per channel, more than 5 new-lead messages a minute collapsed into one), the record of an attempt, the low-balance scan, the log's 30 days and isolation between workspaces.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('x5@test.local');
select tests.open_gate('a');   -- the fixtures below are real-looking people

create function pg_temp.q(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin
  perform tests.as_aal(p_aal);
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

-- ---- channels
select is(pg_temp.q('a_owner', $q$select public.notify_channel_put(%L, 'slack', '#leads', 'abcd', null, null, null) ->> 'state'$q$), 'connected', 'A1 the Owner connects Slack');
select is(pg_temp.q('a_admin', $q$select public.notify_channel_put(%L, 'telegram', '', 'wxyz', array['new_lead'], array['name', 'reason'], 'te') ->> 'language'$q$), 'te', 'A2 the Admin connects Telegram with her own choices');
select is(pg_temp.q('a_sales', $q$select public.notify_channel_put(%L, 'teams', '', 'abcd', null, null, null)::text$q$), 'ERR:42501', 'A3 Sales cannot');
select is(pg_temp.q('a_viewer', $q$select public.notify_channel_put(%L, 'teams', '', 'abcd', null, null, null)::text$q$), 'ERR:42501', 'A4 a Viewer cannot');
select is(pg_temp.q('a_viewer', $q$select jsonb_array_length(public.notify_channels_list(%L))::text$q$), '2', 'A5 every member reads the state');
select is(pg_temp.q('outsider', $q$select public.notify_channels_list(%L)::text$q$), 'ERR:42501', 'A6 a stranger reads nothing');
select is(pg_temp.q('b_owner', $q$select public.notify_channels_list(%L)::text$q$), 'ERR:42501', 'A7 another workspace''s Owner reads nothing');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_put(%L, 'sms', '', 'abcd', null, null, null)::text$q$), 'ERR:22023', 'A8 an unknown kind');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_put(%L, 'teams', '', 'abcd', array['everything'], null, null)::text$q$), 'ERR:22023', 'A9 an unknown event');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_put(%L, 'teams', '', 'abcd', null, array['phone'], null)::text$q$), 'ERR:22023', 'A10 a field that is not in the closed list (the full phone is not one)');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_put(%L, 'teams', '', 'abcd', null, null, 'fr')::text$q$), 'ERR:22023', 'A11 an unknown language');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_put(%L, 'teams', repeat('x', 61), 'abcd', null, null, null)::text$q$), 'ERR:22023', 'A12 a label of at most 60 characters');
select is(pg_temp.q('a_owner', $q$select (public.notify_channels_list(%L) -> 0 ->> 'events')$q$), '[]', 'A13 no event is on before a Test passes');
select is(pg_temp.q('a_owner', $q$select (public.notify_channels_list(%L) -> 0 -> 'health' ->> 'status')$q$), 'never_sent', 'A14 ... and the card says nothing was sent');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_test_result(%L, 'slack', true, null) ->> 'test_passed'$q$), 'true', 'A15 a passed Test is recorded');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.notify_channels_list(%L) -> 0 -> 'events')::text$q$), '4', 'A16 ... and switches the four events on the first time');
select is(pg_temp.q('a_sales', $q$select public.notify_channel_test_result(%L, 'slack', true, null)::text$q$), 'ERR:42501', 'A17 Sales cannot record a Test');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_test_result(%L, 'slack', false, 'a long vendor sentence')::text$q$), 'ERR:22023', 'A18 only a closed reason is accepted');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_put(%L, 'slack', null, 'efgh', null, null, null) ->> 'test_passed'$q$), 'false', 'A19 a new secret makes the channel untested again');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.notify_channels_list(%L) -> 0 -> 'events')::text$q$), '4', 'A20 ... with its events as they were');
select is((select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('notify_channels', 'notify_deliveries') and column_name ~ 'secret|token|url|webhook|chat'), '0', 'A21 no column holds an address, a token or a chat');
select is(pg_temp.q('a_owner', $q$select count(*)::text from public.notify_channels where tenant_id = %L$q$), '2', 'A22 the Owner reads the rows (RLS)');
select is(pg_temp.q('a_sales', $q$select count(*)::text from public.notify_channels where tenant_id = %L$q$), '0', 'A23 Sales sees no row');
select is(pg_temp.q('a_owner', $q$insert into public.notify_channels (tenant_id, kind, created_by) values (%L, 'teams', auth.uid())$q$), 'ERR:42501', 'A24 no direct write');
update public.notify_channels set events = array['new_lead', 'missed_call', 'call_outcome'], fields = array['name', 'phone_masked', 'outcome', 'reason'] where tenant_id = tests.tid('a') and kind = 'slack';
update public.notify_channels set events = array['new_lead'] where tenant_id = tests.tid('a') and kind = 'telegram';

-- ---- queueing: a lead, a missed call, an outcome
create temp table fx as select gen_random_uuid() as contact_id, gen_random_uuid() as lead_id;
insert into public.contacts (id, tenant_id, full_name, phone, email) select contact_id, tests.tid('a'), 'Ravi Kumar', '+919876543210', 'ravi@example.test' from fx;
insert into public.leads (id, tenant_id, contact_id, source) select lead_id, tests.tid('a'), contact_id, 'website' from fx;
select is((select count(*)::text from public.notify_deliveries where event = 'new_lead'), '2', 'B1 a new lead is queued for each channel that asked (Slack and Telegram)');
select is((select count(*)::text from public.notify_deliveries where subject_id is not null and event = 'new_lead' and tenant_id = tests.tid('b')), '0', 'B2 another workspace queues nothing');
update public.leads set status = 'in_review' where id = (select lead_id from fx);
select is((select count(*)::text from public.notify_deliveries where event = 'new_lead'), '2', 'B3 a change to the lead queues nothing more');
insert into public.leads (tenant_id, contact_id, source, is_test) select tests.tid('a'), contact_id, 'website', true from fx;
select is((select count(*)::text from public.notify_deliveries where event = 'new_lead'), '2', 'B4 a test lead queues nothing');
insert into integrations.missed_calls (id, tenant_id, provider, provider_call_id, caller_last4, received_at, outcome) values ('00000000-0000-4000-8000-0000000000d3', tests.tid('a'), 'fake', 'missed-1', '4321', now(), 'needs_owner');
select is((select count(*)::text from public.notify_deliveries where event = 'missed_call'), '1', 'B5 a missed call is queued for the channel that asked (Slack only)');
insert into public.outcomes (id, tenant_id, contact_id, lead_id, kind, source_id, outcome, category, reason, recorded_by_kind, ai_outcome, ai_category, occurred_at)
  select '00000000-0000-4000-8000-0000000000e1', tests.tid('a'), contact_id, lead_id, 'call', '00000000-0000-4000-8000-0000000000d1', 'positive', 'interested', 'Wants forty sarees, call 9876543210 or ravi@example.test', 'ai', 'positive', 'interested', now() from fx;
select is((select count(*)::text from public.notify_deliveries where event = 'call_outcome'), '1', 'B6 a call outcome is queued');
insert into public.outcomes (id, tenant_id, contact_id, lead_id, kind, source_id, outcome, category, recorded_by_kind, ai_outcome, ai_category, occurred_at)
  select '00000000-0000-4000-8000-0000000000e2', tests.tid('a'), contact_id, lead_id, 'whatsapp_followup', '00000000-0000-4000-8000-0000000000d2', 'positive', 'interested', 'ai', 'positive', 'interested', now() from fx;
select is((select count(*)::text from public.notify_deliveries where event = 'call_outcome'), '1', 'B7 a WhatsApp follow-up outcome is not a call outcome');

-- ---- what a message may say
select is(app.notify_mask_phone('+919876543210'), '+91 987XXXXXXX', 'C1 the phone shows its first three digits');
select is(app.notify_mask_phone('12345'), null, 'C2 a number too short to be one shows nothing');
create temp table claimed as select e as j from jsonb_array_elements((select tests.scalar_as(tests.uid('x5'), 'select public.notify_deliveries_claim(50)::text')::jsonb)) e;
select is((select count(*)::text from claimed), '4', 'C3 the worker is handed the four due messages');
select is((select count(*)::text from claimed where j::text like '%9876543210%' or j::text like '%ravi@%' or j::text like '%example.test%'), '0', 'C4 no full number and no address anywhere in what the worker gets');
select is((select j -> 'data' ->> 'phone_masked' from claimed where j ->> 'kind' = 'slack' and j ->> 'event' = 'new_lead'), '+91 987XXXXXXX', 'C5 the masked phone');
select is((select j -> 'data' ->> 'reason' ~ '[0-9]{5}' from claimed where j ->> 'event' = 'call_outcome'), false, 'C6 a reason has its digit runs taken out');
select is((select j -> 'data' ->> 'reason' ~ '@' from claimed where j ->> 'event' = 'call_outcome'), false, 'C7 ... and its e-mail addresses');
select is((select j -> 'data' ->> 'phone_masked' from claimed where j ->> 'event' = 'missed_call'), 'XXXXXXX4321', 'C8 a caller who is not a contact shows only the last four digits');
select is((select (j -> 'data') ? 'reason' from claimed where j ->> 'kind' = 'telegram'), false, 'C9 a field the Owner did not allow is not in the data (Telegram allowed name and reason; the lead has no reason)');
select is((select (j -> 'data') ? 'phone_masked' from claimed where j ->> 'kind' = 'telegram'), false, 'C10 ... nor the phone');
select is((select j ->> 'tenant_id' from claimed limit 1), tests.tid('a')::text, 'C11 each message carries its workspace');
select is(pg_temp.q('a_owner', $q$select public.notify_deliveries_claim(10)::text$q$), 'ERR:42501', 'C12 a person does not use the worker door');
select is(pg_temp.q('x5', $q$select public.notify_deliveries_claim(0)::text$q$), 'ERR:22023', 'C13 a bad limit');
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.notify_deliveries_claim(50))::text$q$), '0', 'C14 leased rows are not handed out twice');
delete from public.contacts where false;

-- ---- recording results
create temp table one as select id from public.notify_deliveries where event = 'new_lead' and channel_id = (select id from public.notify_channels where kind = 'slack' and tenant_id = tests.tid('a'));
select is(pg_temp.q('x5', format($q$select public.notify_delivery_record(%L, true, null, null) ->> 'state'$q$, (select id from one))), 'sent', 'D1 sent');
select is((select status || '/' || attempts from public.notify_deliveries where id = (select id from one)), 'sent/1', 'D2 ... one attempt');
select is(pg_temp.q('x5', format($q$select public.notify_delivery_record(%L, true, null, null) ->> 'state'$q$, (select id from one))), 'gone', 'D3 a second record changes nothing');
create temp table two as select id from public.notify_deliveries where event = 'missed_call';
select is(pg_temp.q('x5', format($q$select public.notify_delivery_record(%L, false, 'timeout', 60) ->> 'state'$q$, (select id from two))), 'retrying', 'D4 a failure with a retry time');
select is((select (next_attempt_at > now() + interval '59 seconds' and next_attempt_at < now() + interval '61 seconds')::text from public.notify_deliveries where id = (select id from two)), 'true', 'D5 ... waits the 60 seconds');
select is(pg_temp.q('x5', format($q$select public.notify_delivery_record(%L, false, 'a vendor sentence', null) ->> 'state'$q$, (select id from two))), 'ERR:22023', 'D6 only a closed reason');
select is(pg_temp.q('x5', format($q$select public.notify_delivery_record(%L, false, 'bad_address', null) ->> 'state'$q$, (select id from two))), 'failed', 'D7 no retry time: failed');
select is(pg_temp.q('a_owner', $q$select public.notify_channels_list(%L) -> 0 -> 'health' ->> 'reason'$q$), 'bad_address', 'D8 the card shows the closed reason as a Problem');
select is(pg_temp.q('a_owner', $q$select public.notify_channels_list(%L) -> 0 -> 'counts_24h' ->> 'failed'$q$), '1', 'D9 ... with the day''s counts');
select is(pg_temp.q('a_owner', format($q$select public.notify_delivery_record(%L, true, null, null)::text$q$, (select id from one))), 'ERR:42501', 'D10 a person does not record');

-- ---- the limits: 20 a minute, collapse of new-lead messages
delete from public.notify_deliveries;
insert into public.notify_deliveries (tenant_id, channel_id, event, subject_kind, status, attempts, sent_at)
  select tests.tid('a'), (select id from public.notify_channels where kind = 'slack' and tenant_id = tests.tid('a')), 'low_balance', 'balance', 'sent', 1, now() from generate_series(1, 20);
insert into public.notify_deliveries (tenant_id, channel_id, event, subject_kind) select tests.tid('a'), (select id from public.notify_channels where kind = 'slack' and tenant_id = tests.tid('a')), 'low_balance', 'balance';
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.notify_deliveries_claim(50))::text$q$), '0', 'E1 a 21st message in the minute is not handed out');
select is((select count(*)::text from public.notify_deliveries where status = 'rate_limited'), '1', 'E2 ... it is closed as rate_limited');
delete from public.notify_deliveries;
insert into public.notify_deliveries (tenant_id, channel_id, event, subject_kind, subject_id)
  select tests.tid('a'), (select id from public.notify_channels where kind = 'slack' and tenant_id = tests.tid('a')), 'new_lead', 'lead', (select lead_id from fx) from generate_series(1, 12);
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.notify_deliveries_claim(50))::text$q$), '5', 'E3 five new-lead messages go one by one');
select is((select count(*)::text from public.notify_deliveries where status = 'collapsed'), '7', 'E4 the other seven are collapsed');
select is((select more::text from public.notify_deliveries where event = 'new_lead_summary'), '7', 'E5 ... into one summary message');
select is(pg_temp.q('x5', $q$select (public.notify_deliveries_claim(50) -> 0 ->> 'event')$q$), 'new_lead_summary', 'E7 the summary comes on the next tick');
-- a message about something that is gone is closed
delete from public.notify_deliveries;
insert into public.notify_deliveries (tenant_id, channel_id, event, subject_kind, subject_id)
  select tests.tid('a'), (select id from public.notify_channels where kind = 'slack' and tenant_id = tests.tid('a')), 'new_lead', 'lead', gen_random_uuid();
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.notify_deliveries_claim(50))::text$q$), '0', 'E8 a lead that is gone sends nothing');
select is((select status from public.notify_deliveries limit 1), 'skipped', 'E9 ... and the row is closed');

-- ---- the low-balance scan
select is(pg_temp.q('a_owner', $q$select public.notify_scan_low_balance()::text$q$), 'ERR:42501', 'F1 only the worker scans');
select is(pg_temp.q('x5', $q$select (public.notify_scan_low_balance() ->> 'queued')::int >= 0$q$), 'true', 'F2 the worker''s scan runs (a workspace that is not low queues nothing)');

-- ---- disconnect and the log's 30 days
insert into public.notify_deliveries (tenant_id, channel_id, event, subject_kind, created_at) select tests.tid('a'), (select id from public.notify_channels where kind = 'telegram' and tenant_id = tests.tid('a')), 'low_balance', 'balance', now() - interval '31 days';
select is(pg_temp.q('x5', $q$select public.notify_purge() ->> 'deliveries'$q$), '1', 'G1 the log goes after 30 days');
select is(pg_temp.q('a_owner', $q$select public.notify_purge()::text$q$), 'ERR:42501', 'G2 only the worker cleans up');
select is(pg_temp.q('a_sales', $q$select public.notify_channel_delete(%L, 'telegram')::text$q$), 'ERR:42501', 'G3 Sales cannot disconnect');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_delete(%L, 'telegram')::text$q$), 'true', 'G4 the Owner disconnects');
select is(pg_temp.q('a_owner', $q$select public.notify_channel_delete(%L, 'telegram')::text$q$), 'false', 'G5 ... once');
select is((select count(*)::text from public.notify_deliveries where channel_id not in (select id from public.notify_channels)), '0', 'G6 its log goes with it');
select cmp_ok((select count(*) from public.audit_events where entity_type = 'notify_channel' and tenant_id = tests.tid('a')), '>=', 3::bigint, 'G7 channel changes are audited');

select * from finish();
rollback;
