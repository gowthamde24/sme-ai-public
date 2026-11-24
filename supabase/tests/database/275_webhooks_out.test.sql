-- Outbound webhooks (migration 20261231992000; docs/contracts/webhooks-out.md): endpoints (Owner or Admin, second factor; at most 5; https only), the queueing triggers (leads, calls, missed calls, outcomes: only for
-- an active endpoint that asked for the event), what an event says (the lead's own contact; the transcript only when opted in), the worker's claim / record (leases, retries, dead letters, "failing"), the log,
-- isolation between workspaces and the 30-day clean-up.
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

-- ---- endpoints
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000001', 'https://hooks.example.com/in', array['lead.created', 'call.completed', 'call.missed', 'job.outcome'], false, 'abcd') ->> 'secret_last4'$q$),
          'abcd', 'A1 the Owner makes an endpoint');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000002', 'https://hooks.example.com/x', array['lead.created'], false, 'abcd') ->> 'id'$q$, 'aal1'), 'ERR:SM306', 'A2 ... only with the second factor');
select is(pg_temp.q('a_admin', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000003', 'https://other.example.com/in', array['lead.updated'], true, 'wxyz') ->> 'send_transcript'$q$), 'true', 'A3 an Admin makes one, with the transcript on');
select is(pg_temp.q('a_sales', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000004', 'https://hooks.example.com/x', array['lead.created'], false, 'abcd') ->> 'id'$q$), 'ERR:42501', 'A4 Sales does not');
select is(pg_temp.q('a_viewer', $q$select public.webhook_endpoints_list(%L)::text$q$), 'ERR:42501', 'A4b ... nor does a Viewer read them');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000004', 'http://hooks.example.com/x', array['lead.created'], false, 'abcd') ->> 'id'$q$), 'ERR:22023', 'A5 http is refused');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000004', 'https://user:pw@hooks.example.com/x', array['lead.created'], false, 'abcd') ->> 'id'$q$), 'ERR:22023', 'A6 a user name in the address is refused');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000004', 'https://hooks.example.com/x', array['lead.deleted'], false, 'abcd') ->> 'id'$q$), 'ERR:22023', 'A7 an unknown event is refused');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000004', 'https://hooks.example.com/x', array[]::text[], false, 'abcd') ->> 'id'$q$), 'ERR:22023', 'A8 no event is refused');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_create(%L, '00000000-0000-4000-8000-000000000004', 'https://hooks.example.com/x', array['lead.created'], false, 'ab') ->> 'id'$q$), 'ERR:22023', 'A9 a bad last four is refused');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.webhook_endpoints_list(%L))::text$q$), '2', 'A10 the list');
select is(pg_temp.q('a_owner', $q$select (public.webhook_endpoints_list(%L) -> 0 ->> 'health')::jsonb ->> 'status'$q$), 'ok', 'A11 each endpoint shows its health');
select is(pg_temp.q('b_owner', format($q$select public.webhook_endpoints_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A12 another workspace''s Owner sees nothing');
select is(pg_temp.q('a_owner', $q$select count(*)::text from public.webhook_endpoints where tenant_id = %L$q$), '2', 'A13 the Owner reads the rows (RLS)');
select is(pg_temp.q('a_sales', $q$select count(*)::text from public.webhook_endpoints where tenant_id = %L$q$), '0', 'A14 Sales sees no row');
select is(pg_temp.q('a_owner', $q$insert into public.webhook_endpoints (tenant_id, url, events, secret_last4, created_by) values (%L, 'https://hooks.example.com/x', array['lead.created'], 'abcd', auth.uid())$q$), 'ERR:42501', 'A15 no direct write: only the functions');
select is(pg_temp.q('a_owner', $q$select pg_get_functiondef('public.webhook_endpoint_create'::regproc) ~ 'whsec'$q$), 'false', 'A16 no secret is stored or made by the database');
select is((select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'webhook_endpoints' and column_name ~ 'secret$|^secret$|hash'), '0', 'A17 no column holds a secret or its hash');
do $$ begin
  for i in 5..7 loop
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.webhook_endpoint_create(%L, gen_random_uuid(), 'https://hooks.example.com/n%s', array['lead.created'], false, 'abcd')::text$q$, tests.tid('a'), i));
  end loop;
end $$;
select is(pg_temp.q('a_owner', $q$select coalesce(public.webhook_endpoint_create(%L, gen_random_uuid(), 'https://hooks.example.com/n9', array['lead.created'], false, 'abcd')::text, 'none')$q$), 'none', 'A18 at most five endpoints (the sixth: nothing)');
-- keep the two first; drop the extra three
delete from public.webhook_endpoints where tenant_id = tests.tid('a') and url ~ '/n[0-9]$';
select is((select count(*)::text from public.webhook_endpoints where tenant_id = tests.tid('a')), '2', 'A19 back to the two');

-- ---- queueing: a lead
create temp table fx as select gen_random_uuid() as contact_id, gen_random_uuid() as lead_id, gen_random_uuid() as other_contact;
insert into public.contacts (id, tenant_id, full_name, phone, email) select contact_id, tests.tid('a'), 'Ravi Kumar', '+919800000001', 'ravi@example.test' from fx;
insert into public.contacts (id, tenant_id, full_name, phone) select other_contact, tests.tid('a'), 'Someone Else', '+919800000999' from fx;
insert into public.companies (id, tenant_id, name) values ('00000000-0000-4000-8000-0000000000c1', tests.tid('a'), 'Ravi Stores');
update public.contacts set company_id = '00000000-0000-4000-8000-0000000000c1' where id = (select contact_id from fx);
insert into public.leads (id, tenant_id, company_id, contact_id, source) select lead_id, tests.tid('a'), '00000000-0000-4000-8000-0000000000c1', contact_id, 'website' from fx;
select is((select count(*)::text from public.webhook_deliveries where event = 'lead.created'), '1', 'B1 a new lead is queued once: only the endpoint that asked for lead.created (the Admin''s asked for lead.updated)');
select is((select e.url from public.webhook_deliveries d join public.webhook_endpoints e on e.id = d.endpoint_id where d.event = 'lead.created'), 'https://hooks.example.com/in', 'B2 ... for the right endpoint');
update public.leads set status = 'in_review' where id = (select lead_id from fx);
select is((select count(*)::text from public.webhook_deliveries where event = 'lead.updated'), '1', 'B3 a status change is lead.updated, for the endpoint that asked');
update public.leads set updated_at = now() + interval '1 second' where id = (select lead_id from fx);
select is((select count(*)::text from public.webhook_deliveries where event = 'lead.updated'), '1', 'B4 a touch of updated_at alone queues nothing');
update public.webhook_endpoints set active = false where tenant_id = tests.tid('a') and url = 'https://other.example.com/in';
update public.leads set status = 'qualified' where id = (select lead_id from fx);
select is((select count(*)::text from public.webhook_deliveries where event = 'lead.updated'), '1', 'B5 an inactive endpoint gets nothing');
update public.webhook_endpoints set active = true where tenant_id = tests.tid('a') and url = 'https://other.example.com/in';
select is((select count(*)::text from public.webhook_deliveries where tenant_id = tests.tid('b')), '0', 'B6 another workspace queues nothing');

-- ---- queueing: calls, missed calls, outcomes
insert into public.phone_calls (id, tenant_id, direction, provider, state, lead_id, contact_id, purpose)
  select '00000000-0000-4000-8000-0000000000d1', tests.tid('a'), 'outbound', 'sandbox', 'in_progress', lead_id, contact_id, 'sales_followup' from fx;
update public.phone_calls set state = 'completed', ended_at = now(), answered_at = now() - interval '42 seconds', duration_s = 42, outcome = 'positive', category = 'interested', summary = 'Wants forty sarees',
       captured = '{"budget": "50000"}'::jsonb, transcript = '[{"speaker": "caller", "text": "hello"}]'::jsonb, cost_paise = 50 where id = '00000000-0000-4000-8000-0000000000d1';
select is((select count(*)::text from public.webhook_deliveries where event = 'call.completed'), '1', 'C1 a finished call is call.completed');
insert into public.phone_calls (id, tenant_id, direction, provider, state, lead_id, contact_id, purpose)
  select '00000000-0000-4000-8000-0000000000d2', tests.tid('a'), 'outbound', 'sandbox', 'ringing', lead_id, contact_id, 'sales_followup' from fx;
update public.phone_calls set state = 'no_answer', ended_at = now() where id = '00000000-0000-4000-8000-0000000000d2';
select is((select count(*)::text from public.webhook_deliveries where event = 'call.missed'), '1', 'C3 no answer is call.missed');
insert into integrations.missed_calls (id, tenant_id, provider, provider_call_id, caller_last4, received_at, outcome) values ('00000000-0000-4000-8000-0000000000d3', tests.tid('a'), 'fake', 'missed-1', '4321', now(), 'needs_owner');
select is((select count(*)::text from public.webhook_deliveries where event = 'call.missed'), '2', 'C4 a missed incoming call is call.missed too');
insert into public.outcomes (id, tenant_id, contact_id, lead_id, kind, source_id, outcome, category, recorded_by_kind, ai_outcome, ai_category, occurred_at)
  select '00000000-0000-4000-8000-0000000000e1', tests.tid('a'), contact_id, lead_id, 'call', '00000000-0000-4000-8000-0000000000d1', 'positive', 'interested', 'ai', 'positive', 'interested', now() from fx;
select is((select count(*)::text from public.webhook_deliveries where event = 'job.outcome'), '1', 'C5 a recorded outcome is job.outcome');
update public.outcomes set corrected_by = tests.uid('a_owner'), corrected_at = now(), outcome = 'negative', category = 'not_interested' where id = '00000000-0000-4000-8000-0000000000e1';
select is((select count(*)::text from public.webhook_deliveries where event = 'job.outcome'), '2', 'C6 a correction is another job.outcome');
select is((select count(distinct event_id)::text from public.webhook_deliveries), (select count(*)::text from public.webhook_deliveries), 'C7 each event has its own id (one endpoint each here)');

-- ---- what an event says
select is(pg_temp.q('x5', $q$select (select e ->> 'event' from jsonb_array_elements(public.webhook_deliveries_claim(50)) e where e ->> 'event' = 'lead.created')$q$), 'lead.created', 'D1 the worker claims due deliveries');
update public.webhook_deliveries set claimed_until = null;
create temp table claimed as select e as j from jsonb_array_elements((select tests.scalar_as(tests.uid('x5'), 'select public.webhook_deliveries_claim(50)::text')::jsonb)) e;
select is((select j -> 'data' -> 'lead' -> 'contact' ->> 'name' from claimed where j ->> 'event' = 'lead.created'), 'Ravi Kumar', 'D2 a lead event carries the lead''s own contact');
select is((select j -> 'data' -> 'lead' -> 'contact' ->> 'phone' from claimed where j ->> 'event' = 'lead.created'), '+919800000001', 'D3 ... with the lead''s own number');
select is((select count(*)::text from claimed where j::text like '%919800000999%' or j::text like '%Someone Else%'), '0', 'D4 never another person''s number or name');
select is((select j -> 'data' -> 'call' ->> 'summary' from claimed where j ->> 'event' = 'call.completed'), 'Wants forty sarees', 'D5 a call event carries the summary');
select is((select (j -> 'data' -> 'call' ->> 'duration_seconds') || '/' || (j -> 'data' -> 'call' ->> 'cost_paise') || '/' || (j -> 'data' -> 'call' -> 'captured' ->> 'budget') from claimed where j ->> 'event' = 'call.completed'),
          '42/50/50000', 'D6 ... the duration, the cost and what was captured');
select is((select (j -> 'data' -> 'call' -> 'transcript')::text from claimed where j ->> 'event' = 'call.completed'), 'null', 'D7 no transcript unless the endpoint opted in');
select is((select (j -> 'data' -> 'call' ->> 'caller_last4') || '/' || coalesce(j -> 'data' -> 'lead' ->> 'name', 'nobody') from claimed where j ->> 'event' = 'call.missed' and j -> 'data' -> 'call' ? 'caller_last4'), '4321/nobody', 'D8 a missed caller who is nobody we know: only the last four digits');
select is((select j -> 'data' -> 'outcome' ->> 'category' from claimed where j ->> 'event' = 'job.outcome' order by j ->> 'created_at' desc limit 1), 'not_interested', 'D9 an outcome event carries the outcome as it is now');
update public.webhook_endpoints set send_transcript = true where url = 'https://hooks.example.com/in';
update public.webhook_deliveries set claimed_until = null where event = 'call.completed';
select is(pg_temp.q('x5', $q$select (select e -> 'data' -> 'call' -> 'transcript' -> 0 ->> 'text' from jsonb_array_elements(public.webhook_deliveries_claim(50)) e where e ->> 'event' = 'call.completed')$q$), 'hello', 'D10 the transcript comes when the Owner opted in');
select is(pg_temp.q('a_owner', $q$select public.webhook_deliveries_claim(10)::text$q$), 'ERR:42501', 'D11 a person does not use the worker door');
select is(pg_temp.q('x5', $q$select public.webhook_deliveries_claim(0)::text$q$), 'ERR:22023', 'D12 a bad limit');
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.webhook_deliveries_claim(50))::text$q$), '0', 'D13 leased rows are not handed out twice');
select is((select count(*)::text from claimed where j ? 'secret' or j::text like '%whsec%'), '0', 'D14 no secret anywhere in what the worker gets');
update public.leads set archived_at = now() where id = (select lead_id from fx);
delete from public.contacts where false;

-- ---- recording results
create temp table one as select id from public.webhook_deliveries where event = 'lead.created';
update public.webhook_deliveries set claimed_until = null;
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, true, 200, null, null) ->> 'state'$q$, (select id from one))), 'delivered', 'E1 delivered');
select is((select status || '/' || attempts || '/' || last_status_code from public.webhook_deliveries where id = (select id from one)), 'delivered/1/200', 'E2 ... one attempt, the code kept');
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, true, 200, null, null) ->> 'state'$q$, (select id from one))), 'gone', 'E3 a second record of the same delivery changes nothing');
create temp table two as select id, endpoint_id from public.webhook_deliveries where event = 'call.completed';
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, false, 503, 'status', 60) ->> 'state'$q$, (select id from two))), 'retrying', 'E4 a failure with a retry time');
select is((select status || '/' || attempts || '/' || last_error || '/' || (next_attempt_at > now() + interval '59 seconds' and next_attempt_at < now() + interval '61 seconds')::text from public.webhook_deliveries where id = (select id from two)),
          'retrying/1/status/true', 'E5 ... waits the 60 seconds');
select is(pg_temp.q('x5', format($q$select (select count(*) from jsonb_array_elements(public.webhook_deliveries_claim(50)) e where e ->> 'id' = %L)::text$q$, (select id from two))), '0', 'E6 a retrying row is not due yet');
update public.webhook_deliveries set claimed_until = null, next_attempt_at = now() - interval '1 second' where id = (select id from two);
select is(pg_temp.q('x5', $q$select (select count(*) from jsonb_array_elements(public.webhook_deliveries_claim(50)) e where e ->> 'event' = 'call.completed' and (e ->> 'attempts')::int = 1)::text$q$), '1', 'E7 ... due again, with its attempt count');
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, false, 500, 'status', null) ->> 'state'$q$, (select id from two))), 'dead', 'E8 no retry time: a dead letter');
select is((select failing_since is not null from public.webhook_endpoints where id = (select endpoint_id from two)), true, 'E9 the endpoint is failing');
select is(pg_temp.q('a_owner', $q$select ((select e from jsonb_array_elements(public.webhook_endpoints_list(%L)) e where e ->> 'url' = 'https://hooks.example.com/in') -> 'health' ->> 'status')$q$), 'failing', 'E10 ... and says so to the Owner');
select is(pg_temp.q('a_owner', $q$select ((select e from jsonb_array_elements(public.webhook_endpoints_list(%L)) e where e ->> 'url' = 'https://hooks.example.com/in') -> 'health' ->> 'dead_letters_7d')$q$), '1', 'E11 ... with the number of dead letters');
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, false, 500, 'status', null) ->> 'state'$q$, (select id from two))), 'gone', 'E12 a dead letter is final');
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, false, 500, 'secret text', null) ->> 'state'$q$, (select id from one))), 'ERR:22023', 'E13 only the closed error words');
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, false, 500, 'status', 99999999) ->> 'state'$q$, (select id from one))), 'ERR:22023', 'E14 a retry time between one second and a day');
select is(pg_temp.q('a_owner', format($q$select public.webhook_delivery_record(%L, true, 200, null, null) ->> 'state'$q$, (select id from one))), 'ERR:42501', 'E15 a person does not record results');
update public.webhook_deliveries set claimed_until = null where status in ('pending', 'retrying');
create temp table three as select id from public.webhook_deliveries where event = 'job.outcome' order by created_at, id limit 1;
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, true, 204, null, null) ->> 'state'$q$, (select id from three))), 'delivered', 'E16 a later success');
select is((select failing_since is null from public.webhook_endpoints where id = (select endpoint_id from two)), true, 'E17 ... clears "failing"');

-- ---- a test event
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_test(%L, '00000000-0000-4000-8000-000000000001') ? 'delivery_id'$q$), 'true', 'F1 a test event is queued');
select is(pg_temp.q('a_sales', $q$select public.webhook_endpoint_test(%L, '00000000-0000-4000-8000-000000000001')::text$q$), 'ERR:42501', 'F2 Sales cannot');
select is(pg_temp.q('a_owner', $q$select coalesce(public.webhook_endpoint_test(%L, '00000000-0000-4000-8000-0000000000ff')::text, 'none')$q$), 'none', 'F3 an unknown endpoint: nothing');
select is(pg_temp.q('b_owner', format($q$select coalesce(public.webhook_endpoint_test(%L, '00000000-0000-4000-8000-000000000001')::text, 'none')$q$, tests.tid('b'))), 'none', 'F4 another workspace''s endpoint: nothing');
create temp table t as select id from public.webhook_deliveries where event = 'test.ping';
select is((select data from (select pg_temp.q('x5', $q$select (select e -> 'data' ->> 'message' from jsonb_array_elements(public.webhook_deliveries_claim(50)) e where e ->> 'event' = 'test.ping')$q$) as data) x), 'This is a test event from Stack19.', 'F5 the worker sends it');
select is(pg_temp.q('x5', format($q$select public.webhook_delivery_record(%L, false, 500, 'status', null) ->> 'state'$q$, (select id from t))), 'dead', 'F6 a failed test event is dead at once');
select is((select failing_since is null from public.webhook_endpoints where id = '00000000-0000-4000-8000-000000000001'), true, 'F7 ... and does not mark the endpoint failing');

-- ---- the log
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.webhook_deliveries_list(%L, null, null, null, 100))::text$q$), (select count(*)::text from public.webhook_deliveries where tenant_id = tests.tid('a')), 'G1 the log lists the workspace''s deliveries');
select is(pg_temp.q('a_owner', $q$select (public.webhook_deliveries_list(%L, null, null, null, 100) -> 0) ?| array['url', 'data', 'body', 'payload']$q$), 'false', 'G2 ... never a body or an address');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.webhook_deliveries_list(%L, '00000000-0000-4000-8000-000000000003', null, null, 100))::text$q$), '2', 'G3 one endpoint''s log (the Admin''s: the status change and the archive)');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.webhook_deliveries_list(%L, null, null, null, 2))::text$q$), '2', 'G4 paged');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.webhook_deliveries_list(%L, null, null, null, 0))::text$q$), 'ERR:22023', 'G5 a bad limit');
select is(pg_temp.q('a_sales', $q$select jsonb_array_length(public.webhook_deliveries_list(%L, null, null, null, 10))::text$q$), 'ERR:42501', 'G6 Sales does not read it');
select is(pg_temp.q('b_owner', format($q$select jsonb_array_length(public.webhook_deliveries_list(%L, null, null, null, 10))::text$q$, tests.tid('a'))), 'ERR:42501', 'G7 nor another workspace');
select is(pg_temp.q('a_owner', $q$select count(*)::text from public.webhook_deliveries where tenant_id = %L$q$), (select count(*)::text from public.webhook_deliveries where tenant_id = tests.tid('a')), 'G8 the Owner reads the rows (RLS)');
select is(pg_temp.q('a_sales', $q$select count(*)::text from public.webhook_deliveries where tenant_id = %L$q$), '0', 'G9 Sales sees none');

-- ---- update, rotate, delete
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_update(%L, '00000000-0000-4000-8000-000000000003', null, array['call.completed'], false, null) ->> 'events'$q$), '["call.completed"]', 'H1 update the events');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_update(%L, '00000000-0000-4000-8000-000000000003', 'http://nope.example.com/x', null, null, null) ->> 'id'$q$), 'ERR:22023', 'H2 update to a bad address is refused');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_update(%L, '00000000-0000-4000-8000-000000000003', 'https://new.example.com/x', null, true, null) ->> 'url'$q$), 'https://new.example.com/x', 'H3 a new address');
select is(pg_temp.q('a_owner', $q$select coalesce(public.webhook_endpoint_update(%L, '00000000-0000-4000-8000-0000000000ff', null, null, false, null)::text, 'none')$q$), 'none', 'H4 an unknown endpoint: nothing');
select is(pg_temp.q('a_sales', $q$select public.webhook_endpoint_update(%L, '00000000-0000-4000-8000-000000000003', null, null, false, null)::text$q$), 'ERR:42501', 'H5 Sales cannot');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_rotate(%L, '00000000-0000-4000-8000-000000000003', 'rrrr') ->> 'secret_version'$q$), '2', 'H6 a rotation bumps the version');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_rotate(%L, '00000000-0000-4000-8000-000000000003', 'rrrr') ->> 'secret_last4'$q$, 'aal1'), 'ERR:SM306', 'H7 ... with the second factor');
select is(pg_temp.q('b_owner', format($q$select coalesce(public.webhook_endpoint_rotate(%L, '00000000-0000-4000-8000-000000000003', 'rrrr')::text, 'none')$q$, tests.tid('b'))), 'none', 'H8 another workspace cannot rotate it');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_delete(%L, '00000000-0000-4000-8000-000000000003')::text$q$), 'true', 'H9 delete');
select is((select count(*)::text from public.webhook_deliveries where endpoint_id = '00000000-0000-4000-8000-000000000003'), '0', 'H10 ... and its log goes with it');
select is(pg_temp.q('a_owner', $q$select public.webhook_endpoint_delete(%L, '00000000-0000-4000-8000-000000000003')::text$q$), 'false', 'H11 a second delete: false');
select is(pg_temp.q('a_sales', $q$select public.webhook_endpoint_delete(%L, '00000000-0000-4000-8000-000000000001')::text$q$), 'ERR:42501', 'H12 Sales cannot delete');

-- ---- the audit trail records changes (never a secret: there is none)
select cmp_ok((select count(*) from public.audit_events where entity_type = 'webhook_endpoint' and tenant_id = tests.tid('a')), '>=', 3::bigint, 'I1 endpoint changes are audited');

-- ---- the staff's alert
update public.webhook_endpoints set failing_since = now() where id = '00000000-0000-4000-8000-000000000001';
select is(admin.webhook_alerts('owner') -> 0 ->> 'kind', 'webhooks_failing', 'J1 the staff see a failing-endpoints alert');
select is(admin.webhook_alerts('owner') -> 0 ->> 'detail' ~ 'hooks.example.com', false, 'J2 ... with a count only, never an address');
select is(admin.webhook_alerts('finance')::text, '[]', 'J3 only owner and support see it');
update public.webhook_endpoints set failing_since = null;
select is(admin.webhook_alerts('owner')::text, '[]', 'J4 it clears with the facts');

-- ---- the clean-up
update public.webhook_deliveries set created_at = now() - interval '31 days' where id = (select id from one);
select is(pg_temp.q('x5', $q$select public.webhook_purge() ->> 'deliveries'$q$), '1', 'K1 deliveries go after 30 days');
select is(pg_temp.q('a_owner', $q$select public.webhook_purge()::text$q$), 'ERR:42501', 'K2 only the worker cleans up');

select * from finish();
rollback;
