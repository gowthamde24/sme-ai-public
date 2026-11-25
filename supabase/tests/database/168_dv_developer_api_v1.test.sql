-- The developer API v1, D2 (migration 20261231992100): GET /me's any-scope key check, the simulated test calls (idempotency, the limits, finished after 30 seconds, the lead updated once), campaigns
-- (consented contacts and a job; duplicates; idempotency; 5 a minute), the API activity log (route template only; 30 days; nothing a client can reach), usage and the clean-up.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.q(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin
  perform tests.as_aal(p_aal);
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.lead(p_name text, p_phone text, p_extra jsonb default '{}') returns text language sql as $$
  select (jsonb_build_object('name', p_name, 'phone', p_phone, 'consent', jsonb_build_object('given', true, 'text', 'I agree'), 'next_step', 'call') || p_extra)::text
$$;

-- keys: k1 everything (workspace A), k2 read-only (A), kb everything (B)
insert into public.developer_api_keys (tenant_id, name, key_hash, prefix, last4, scopes, created_by) values
  (tests.tid('a'), 'All', pg_temp.h('k1'), 'sk_test_ab12', 'wxyz', array['leads:write', 'leads:read', 'calls:write', 'calls:read', 'campaigns:write', 'campaigns:read', 'usage:read'], tests.uid('a_owner')),
  (tests.tid('a'), 'Read', pg_temp.h('k2'), 'sk_test_cd34', 'wxyz', array['leads:read'], tests.uid('a_owner')),
  (tests.tid('b'), 'B', pg_temp.h('kb'), 'sk_test_ef56', 'wxyz', array['leads:write', 'leads:read', 'calls:write', 'calls:read', 'campaigns:write', 'campaigns:read', 'usage:read'], tests.uid('b_owner'));

-- ---- the new scopes and GET /me
select is((select count(*)::text from public.developer_api_keys where tenant_id = tests.tid('a')), '2', 'A1 the new scopes are allowed by the table');
select is(pg_temp.q('a_owner', format($q$select public.developer_key_create(%%L, 'N', array['calls:write', 'campaigns:read'], array[]::text[], %L, 'sk_test_gh78', 'wxyz') ->> 'prefix'$q$, pg_temp.h('k9'))), 'sk_test_gh78', 'A2 a key may have calls:write and campaigns:read');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, null, null) ->> 'ok'$q$, pg_temp.h('k2'))), 'true', 'B1 any live key passes the check with no scope');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, null, null) ->> 'code'$q$, pg_temp.h('nope'))), 'invalid_key', 'B2 an unknown key does not');
select is(pg_temp.q('x5', format($q$select public.developer_api_me(%L) -> 'key' ->> 'name'$q$, pg_temp.h('k2'))), 'Read', 'B3 /me shows the key');
select is(pg_temp.q('x5', format($q$select position('key_hash' in public.developer_api_me(%L)::text) = 0$q$, pg_temp.h('k2'))), 'true', 'B4 ... never its hash');
select is(pg_temp.q('x5', format($q$select public.developer_api_me(%L) -> 'workspace' ->> 'id'$q$, pg_temp.h('k1'))), tests.tid('a')::text, 'B5 ... and its workspace');
select is(pg_temp.q('x5', format($q$select public.developer_api_me(%L)::text$q$, pg_temp.h('nope'))), 'ERR:42501', 'B6 an unknown key has no /me');
select is(pg_temp.q('a_owner', format($q$select public.developer_api_me(%L)::text$q$, pg_temp.h('k1'))), 'ERR:42501', 'B7 a person does not use the program door');

-- ---- calls
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'l1', %L, %L) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('b1'), pg_temp.lead('Ravi', '+919800000001'))), 'created', 'C0 a lead');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'l2', %L, %L) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('b2'), pg_temp.lead('Sita', '+919800000003'))), 'created', 'C0b another lead');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_context(%L, %L) -> 'lead' ->> 'consent_given'$q$, pg_temp.h('k1'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), 'true', 'C1 the gates see the consent');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_context(%L, %L) -> 'lead' ->> 'phone'$q$, pg_temp.h('kb'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), null, 'C2 another workspace''s key does not see the lead');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_context(%L, %L)::text$q$, pg_temp.h('k2'), gen_random_uuid())), 'ERR:42501', 'C3 a key without calls:write has no context');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c1', %L, %L, now() + interval '1 hour') ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('cb1'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), 'created', 'D1 a call is placed (simulated)');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c1', %L, %L, now() + interval '1 hour') ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('cb1'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), 'replayed', 'D2 the same key and body: the first call');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c1', %L, %L, now() + interval '1 hour') ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('cb2'), (select id from public.developer_sandbox_leads where phone = '+919800000003'))), 'conflict', 'D3 the same key, another body: conflict');
select is((select count(*)::text from integrations.developer_api_calls), '1', 'D4 one call stored');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_get(%L, %L) ->> 'status'$q$, pg_temp.h('k1'), (select id from integrations.developer_api_calls))), 'queued', 'D5 not started yet: queued');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c2', %L, %L, now()) ->> 'status'$q$, pg_temp.h('kb'), pg_temp.h('cb3'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), 'not_found', 'D6 another workspace''s lead is not on this sandbox list');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c3', %L, %L, now()) ->> 'status'$q$, pg_temp.h('k2'), pg_temp.h('cb4'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), 'ERR:42501', 'D7 a read-only key places no call');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c4', %L, %L, now() + interval '30 days') ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('cb5'), (select id from public.developer_sandbox_leads where phone = '+919800000003'))), 'ERR:22023', 'D8 a start time far away is refused');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_get(%L, %L)::text$q$, pg_temp.h('kb'), (select id from integrations.developer_api_calls))), null, 'D9 another workspace reads no call');
-- finished: the outcome of the last digit, the call's lead updated once
update integrations.developer_api_calls set scheduled_for = now() - interval '31 seconds';
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_get(%L, %L) ->> 'outcome'$q$, pg_temp.h('k1'), (select id from integrations.developer_api_calls))), 'interested', 'E1 after 30 seconds: completed, outcome by the last digit (1)');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_get(%L, %L) -> 'cost' ->> 'paise'$q$, pg_temp.h('k1'), (select id from integrations.developer_api_calls))), '0', 'E2 a test call costs nothing');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_get(%L, %L) ->> 'status'$q$, pg_temp.h('k1'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), 'interested', 'E3 the lead followed the call');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_get(%L, %L) -> 'calls' ->> 0$q$, pg_temp.h('k1'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), (select id::text from integrations.developer_api_calls), 'E4 ... and lists its call');
select isnt((select settled_at from integrations.developer_api_calls), null, 'E5 settled once');
select is(pg_temp.q('x5', format($q$select jsonb_array_length(public.developer_sandbox_calls_list(%L, %L, null, null, 100))::text$q$, pg_temp.h('k1'), (select id from public.developer_sandbox_leads where phone = '+919800000001'))), '1', 'E6 the list, by lead');
select is(pg_temp.q('x5', format($q$select jsonb_array_length(public.developer_sandbox_calls_list(%L, null, null, null, 100))::text$q$, pg_temp.h('kb'))), '0', 'E7 another workspace lists none');
-- the limits
update integrations.developer_api_calls set created_at = now() - interval '5 minutes';
insert into integrations.developer_api_calls (tenant_id, key_id, lead_id, idem_key, body_sha, scheduled_for)
  select tests.tid('a'), (select id from public.developer_api_keys where key_hash = pg_temp.h('k1')), (select id from public.developer_sandbox_leads where phone = '+919800000003'), 'open' || g, repeat('a', 64), now() + interval '1 hour'
    from generate_series(1, 10) g;
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c5', %L, %L, now()) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('cb6'), (select id from public.developer_sandbox_leads where phone = '+919800000003'))), 'too_many_calls', 'F1 ten open calls in the workspace: the eleventh waits');
update integrations.developer_api_calls set scheduled_for = now() - interval '5 minutes';   -- all finished; they were created just now
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c5', %L, %L, now()) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('cb6'), (select id from public.developer_sandbox_leads where phone = '+919800000003'))), 'rate_limited', 'F2 ten calls a minute per key');
select ok(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c5', %L, %L, now()) ->> 'retry_after'$q$, pg_temp.h('k1'), pg_temp.h('cb6'), (select id from public.developer_sandbox_leads where phone = '+919800000003')))::integer between 1 and 60, 'F3 ... with when to retry');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'open1', %L, %L, now()) ->> 'status'$q$, pg_temp.h('k1'), repeat('a', 64), (select id from public.developer_sandbox_leads where phone = '+919800000003'))), 'replayed', 'F4 a replay still answers at the limit');
delete from integrations.developer_api_calls where idem_key like 'open%';
-- consent erased: no call
update public.developer_sandbox_leads set consent = null where phone = '+919800000003';
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_call_create(%L, 'c6', %L, %L, now()) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('cb7'), (select id from public.developer_sandbox_leads where phone = '+919800000003'))), 'refused', 'F5 no consent on file: refused');

-- ---- campaigns
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_campaign_create(%L, 'camp1', %L, jsonb_build_object('name', 'Diwali', 'language', 'te', 'job_name', 'Follow up', 'job_goal', 'Ask',
          'contacts', jsonb_build_array(%L::jsonb, %L::jsonb))) -> 'campaign' ->> 'contacts'$q$, pg_temp.h('k1'), pg_temp.h('cp1'), pg_temp.lead('Anu', '+919800000011'), pg_temp.lead('Ravi again', '+919800000001'))), '2', 'G1 a campaign with two contacts');
select is((select added || '/' || duplicates from integrations.developer_api_campaigns), '1/1', 'G2 one new lead, one existing (the same number)');
select is((select count(*)::text from public.developer_sandbox_leads where tenant_id = tests.tid('a')), '3', 'G3 the new contact is a sandbox lead, nothing else');
select is((select count(*)::text from public.contacts where tenant_id = tests.tid('a') and phone = '+919800000011'), '0', 'G4 ... never a real contact');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_campaign_create(%L, 'camp1', %L, jsonb_build_object('name', 'Diwali', 'job_name', 'Follow up', 'contacts', jsonb_build_array(%L::jsonb))) ->> 'status'$q$,
          pg_temp.h('k1'), pg_temp.h('cp1'), pg_temp.lead('Anu', '+919800000011'))), 'replayed', 'G5 the same key and body: replayed');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_campaign_create(%L, 'camp1', %L, jsonb_build_object('name', 'Diwali', 'job_name', 'Follow up', 'contacts', jsonb_build_array(%L::jsonb))) ->> 'status'$q$,
          pg_temp.h('k1'), pg_temp.h('cp2'), pg_temp.lead('Anu', '+919800000011'))), 'conflict', 'G6 the same key, another body: conflict');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_campaign_create(%L, 'camp2', %L, jsonb_build_object('name', 'X', 'job_name', 'J', 'contacts', jsonb_build_array(%L::jsonb))) ->> 'status'$q$,
          pg_temp.h('k1'), pg_temp.h('cp3'), pg_temp.lead('No consent', '+919800000012', '{"consent": {"given": false}}'))), 'ERR:22023', 'G7 a contact without consent: refused, nothing saved');
select is((select count(*)::text from integrations.developer_api_campaigns), '1', 'G8 ... no campaign half made');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_campaign_create(%L, 'camp3', %L, jsonb_build_object('name', 'X', 'job_name', 'J', 'contacts', '[]'::jsonb)) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('cp4'))), 'ERR:22023', 'G9 no contacts: refused');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_campaign_create(%L, 'camp4', %L, jsonb_build_object('name', 'X', 'job_name', 'J', 'contacts', jsonb_build_array(%L::jsonb))) ->> 'status'$q$,
          pg_temp.h('k2'), pg_temp.h('cp5'), pg_temp.lead('A', '+919800000013'))), 'ERR:42501', 'G10 a key without campaigns:write');
select is(pg_temp.q('x5', format($q$select jsonb_array_length(public.developer_sandbox_campaign_get(%L, %L) -> 'lead_ids')::text$q$, pg_temp.h('k1'), (select id from integrations.developer_api_campaigns))), '2', 'G11 read back with its lead ids');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_campaign_get(%L, %L)::text$q$, pg_temp.h('kb'), (select id from integrations.developer_api_campaigns))), null, 'G12 another workspace reads none');
select is(pg_temp.q('x5', format($q$select jsonb_array_length(public.developer_sandbox_campaigns_list(%L, null, null, 100))::text$q$, pg_temp.h('k1'))), '1', 'G13 the list');
select is(pg_temp.q('x5', format($q$select (public.developer_sandbox_campaigns_list(%L, null, null, 100) -> 0) ? 'lead_ids'$q$, pg_temp.h('k1'))), 'false', 'G14 ... without the lead ids');
insert into integrations.developer_api_campaigns (tenant_id, key_id, idem_key, body_sha, name, job_name)
  select tests.tid('a'), (select id from public.developer_api_keys where key_hash = pg_temp.h('k1')), 'bulk' || g, repeat('b', 64), 'Bulk', 'J' from generate_series(1, 4) g;
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_campaign_create(%L, 'camp5', %L, jsonb_build_object('name', 'X', 'job_name', 'J', 'contacts', jsonb_build_array(%L::jsonb))) ->> 'status'$q$,
          pg_temp.h('k1'), pg_temp.h('cp6'), pg_temp.lead('A', '+919800000014'))), 'rate_limited', 'G15 five campaigns a minute per key');

-- ---- the activity log
select is(pg_temp.q('x5', format($q$select public.developer_api_activity_log(%L, 'GET', '/api/v1/leads/{lead_id}', 200, 12)::text$q$, pg_temp.h('k1'))), 'true', 'H1 a request is logged');
select is(pg_temp.q('x5', format($q$select public.developer_api_activity_log(%L, 'POST', '/api/v1/calls', 422, 5)::text$q$, pg_temp.h('k2'))), 'true', 'H2 ... with the key that made it');
select is(pg_temp.q('x5', format($q$select public.developer_api_activity_log(%L, 'GET', '/api/v1/me', 200, 5)::text$q$, pg_temp.h('nope'))), 'false', 'H3 an unknown key leaves no row');
select is(pg_temp.q('x5', format($q$select public.developer_api_activity_log(%L, 'GET', '/api/v1/leads/abc?phone=+919800000001', 200, 5)::text$q$, pg_temp.h('k1'))), 'ERR:22023', 'H4 a route with a query string or an id is refused: no personal data in the log');
select is(pg_temp.q('x5', format($q$select public.developer_api_activity_log(%L, 'GET', '/api/v1/me', 200, 5)::text$q$, pg_temp.h('k1'))), 'true', 'H5 another');
select is(pg_temp.q('x5', format($q$select jsonb_array_length(public.developer_api_activity_list(%L, null, null, 100))::text$q$, pg_temp.h('k1'))), '3', 'H6 the workspace''s requests, via a usage:read key');
update integrations.developer_api_activity set created_at = now() + interval '1 second' where route = '/api/v1/me';   -- one transaction has one clock
select is(pg_temp.q('x5', format($q$select public.developer_api_activity_list(%L, null, null, 100) -> 0 ->> 'route'$q$, pg_temp.h('k1'))), '/api/v1/me', 'H7 newest first');
select is(pg_temp.q('x5', format($q$select public.developer_api_activity_list(%L, null, null, 100)::text$q$, pg_temp.h('k2'))), 'ERR:42501', 'H8 a key without usage:read reads no log');
select is(pg_temp.q('x5', format($q$select jsonb_array_length(public.developer_api_activity_list(%L, null, null, 100))::text$q$, pg_temp.h('kb'))), '0', 'H9 another workspace sees none');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.developer_activity_list(%L, null, null, null, 100))::text$q$), '3', 'H10 the Owner reads it in Settings');
select is(pg_temp.q('a_owner', format($q$select jsonb_array_length(public.developer_activity_list(%%L, %L, null, null, 100))::text$q$, (select id from public.developer_api_keys where key_hash = pg_temp.h('k2')))), '1', 'H11 ... for one key');
select is(pg_temp.q('a_sales', $q$select public.developer_activity_list(%L, null, null, null, 100)::text$q$), 'ERR:42501', 'H12 Sales does not');
select is(pg_temp.q('b_owner', format($q$select public.developer_activity_list(%L, null, null, null, 100)::text$q$, tests.tid('a'))), 'ERR:42501', 'H13 another workspace''s Owner does not');
select is(pg_temp.q('a_owner', $q$select public.developer_activity_list(%L, null, null, null, 500)::text$q$), 'ERR:22023', 'H14 a page is at most 100');
select is((select count(*)::text from information_schema.columns where table_schema = 'integrations' and table_name = 'developer_api_activity' and column_name in ('body', 'query', 'ip', 'payload', 'headers')), '0', 'H15 the table has no place for a body, a query string, an address or headers');

-- ---- no client reaches the tables
select is(pg_temp.q('a_owner', $q$select count(*)::text from integrations.developer_api_calls$q$), 'ERR:42501', 'I1 calls: no client access');
select is(pg_temp.q('a_owner', $q$select count(*)::text from integrations.developer_api_campaigns$q$), 'ERR:42501', 'I2 campaigns: no client access');
select is(pg_temp.q('a_owner', $q$select count(*)::text from integrations.developer_api_campaign_contacts$q$), 'ERR:42501', 'I3 campaign lists: no client access');
select is(pg_temp.q('a_owner', $q$select count(*)::text from integrations.developer_api_activity$q$), 'ERR:42501', 'I4 activity: no client access');
select is((select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'integrations' and c.relname like 'developer_api_%' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity), '5',
          'I5 RLS is on and forced for all five developer tables outside the public schema');

-- ---- usage and the clean-up
select is(pg_temp.q('a_owner', $q$select public.developer_usage(%L) -> 'month' ->> 'calls_simulated'$q$), '1', 'J1 usage counts the simulated calls');
select is(pg_temp.q('a_owner', $q$select public.developer_usage(%L) -> 'month' ->> 'errors'$q$), '1', 'J2 ... and the requests that failed');
select is(pg_temp.q('a_owner', $q$select public.developer_usage(%L) -> 'limits' ->> 'calls_per_minute'$q$), '10', 'J3 ... and the limits');
update integrations.developer_api_activity set created_at = now() - interval '31 days' where route = '/api/v1/calls';
update integrations.developer_api_calls set created_at = now() - interval '31 days' where idem_key = 'c1';
update integrations.developer_api_campaigns set created_at = now() - interval '31 days' where idem_key = 'camp1';
select is(pg_temp.q('x5', $q$select public.scheduler_developer_purge() ->> 'activity_rows'$q$), '1', 'J4 the activity log keeps 30 days');
select is((select count(*)::text from integrations.developer_api_calls where idem_key = 'c1'), '0', 'J5 calls too');
select is((select count(*)::text from integrations.developer_api_campaigns where idem_key = 'camp1'), '0', 'J6 campaigns too');
select is((select count(*)::text from integrations.developer_api_campaign_contacts), '0', 'J7 and their lists with them');

select * from finish();
rollback;
