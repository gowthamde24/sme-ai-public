-- The developer API, D1 (migration 20261231210000; ADR 0121): keys (Owner or Admin, second factor; the hash only), the worker's key check (scope, IP allow-list, 60 a minute), the TEST sandbox
-- leads (idempotency, dedupe, consent, this key's workspace only) and the clean-up.
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

-- ---- keys
select is(pg_temp.q('a_owner', format($q$select public.developer_key_create(%%L, 'Website', array['leads:write', 'leads:read', 'usage:read'], array[]::text[], %L, 'sk_test_ab12', 'wxyz') ->> 'prefix'$q$, pg_temp.h('k1'))),
          'sk_test_ab12', 'A1 the Owner makes a key');
select is(pg_temp.q('a_owner', format($q$select public.developer_key_create(%%L, 'X', array['leads:write'], array[]::text[], %L, 'sk_test_cd34', 'wxyz') ->> 'id'$q$, pg_temp.h('k2')), 'aal1'), 'ERR:SM306', 'A2 ... only with the second factor');
select is(pg_temp.q('a_admin', format($q$select public.developer_key_create(%%L, 'Read only', array['leads:read'], array['203.0.113.4'], %L, 'sk_test_ef56', 'abcd') ->> 'ip_allow'$q$, pg_temp.h('k3'))),
          '["203.0.113.4"]', 'A3 an Admin makes one, with an IP allow-list');
select is(pg_temp.q('a_sales', format($q$select public.developer_key_create(%%L, 'X', array['leads:write'], array[]::text[], %L, 'sk_test_gh78', 'wxyz') ->> 'id'$q$, pg_temp.h('k4'))), 'ERR:42501', 'A4 Sales does not');
select is(pg_temp.q('a_owner', format($q$select public.developer_key_create(%%L, 'X', array['delete:everything'], array[]::text[], %L, 'sk_test_gh78', 'wxyz') ->> 'id'$q$, pg_temp.h('k4'))), 'ERR:22023', 'A5 an unknown scope: refused');
select is(pg_temp.q('a_owner', format($q$select public.developer_key_create(%%L, 'X', array['leads:write'], array['not an ip'], %L, 'sk_test_gh78', 'wxyz') ->> 'id'$q$, pg_temp.h('k4'))), 'ERR:22023', 'A6 a bad IP: refused');
select is(pg_temp.q('a_owner', $q$select jsonb_array_length(public.developer_keys_list(%L))::text$q$), '2', 'A7 the list');
select is(pg_temp.q('a_owner', $q$select (public.developer_keys_list(%L) -> 0) ? 'key_hash'$q$::text), 'false', 'A8 ... never with the hash');
select is(pg_temp.q('b_owner', format($q$select jsonb_array_length(public.developer_keys_list(%L))::text$q$, tests.tid('a'))), 'ERR:42501', 'A9 another workspace''s Owner sees nothing');
select is((select count(*)::text from public.developer_api_keys where key_hash = pg_temp.h('k1') and tenant_id = tests.tid('a')), '1', 'A10 stored: the hash');
select is(pg_temp.q('a_owner', $q$select count(*)::text from (select id, tenant_id, name, mode, prefix, last4, scopes, ip_allow, created_by, created_at, rotated_at, revoked_at from public.developer_api_keys where tenant_id = %L) x$q$),
          '2', 'A11 the Owner reads the keys (the privacy export''s column list, app/privacy/repository.py SELECT_OF)');
select is(pg_temp.q('a_owner', $q$select count(key_hash)::text from public.developer_api_keys where tenant_id = %L$q$), 'ERR:42501', 'A12 ... never the hash');
select is(pg_temp.q('a_sales', $q$select count(*)::text from (select id from public.developer_api_keys where tenant_id = %L) x$q$), '0', 'A13 Sales sees no key');

-- ---- the worker's key check
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'ok'$q$, pg_temp.h('k1'))), 'true', 'B1 a good key with the scope');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'tenant_id'$q$, pg_temp.h('k1'))), tests.tid('a')::text, 'B2 ... its workspace comes from the key');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'code'$q$, pg_temp.h('nope'))), 'invalid_key', 'B3 an unknown key');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'calls:read', null) ->> 'code'$q$, pg_temp.h('k1'))), 'missing_scope', 'B4 a scope it lacks');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:read', '198.51.100.9') ->> 'code'$q$, pg_temp.h('k3'))), 'ip_not_allowed', 'B5 outside the allow-list');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:read', '203.0.113.4') ->> 'ok'$q$, pg_temp.h('k3'))), 'true', 'B6 inside it');
select is(pg_temp.q('a_owner', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'ok'$q$, pg_temp.h('k1'))), 'ERR:42501', 'B7 a person does not use the program door');
update integrations.developer_api_usage set n = 60 where key_id = (select id from public.developer_api_keys where key_hash = pg_temp.h('k1')) and minute = date_trunc('minute', now());
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'code'$q$, pg_temp.h('k1'))), 'rate_limited', 'B8 the 61st request in a minute');
select ok(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'retry_after'$q$, pg_temp.h('k1')))::integer between 1 and 60, 'B9 ... with when to retry');
delete from integrations.developer_api_usage;

-- ---- the sandbox leads
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'idem-1', %L, %L) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('body1'), pg_temp.lead('Ravi', '+919800000001'))), 'created', 'C1 a lead');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'idem-1', %L, %L) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('body1'), pg_temp.lead('Ravi', '+919800000001'))), 'replayed', 'C2 the same key and body: the first answer');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'idem-1', %L, %L) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('body2'), pg_temp.lead('Sita', '+919800000002'))), 'conflict', 'C3 the same key, another body: conflict');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'idem-2', %L, %L) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('body3'), pg_temp.lead('Ravi K', '+919800000001'))), 'duplicate', 'C4 the same phone: the existing lead');
select is((select count(*)::text from public.developer_sandbox_leads), '1', 'C5 ... one lead');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'idem-3', %L, %L) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('body4'),
          pg_temp.lead('Sita', '+919800000002', '{"consent": {"given": false}}'))), 'ERR:22023', 'C6 no consent: refused');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'idem-4', %L, %L) ->> 'status'$q$, pg_temp.h('k1'), pg_temp.h('body5'), pg_temp.lead('Sita', '12345'))), 'ERR:22023', 'C7 a bad phone: refused');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_create(%L, 'idem-5', %L, %L) ->> 'status'$q$, pg_temp.h('k3'), pg_temp.h('body6'), pg_temp.lead('Sita', '+919800000002'))), 'ERR:42501', 'C8 a read-only key does not write');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_get(%L, %L) ->> 'name'$q$, pg_temp.h('k1'), (select id from public.developer_sandbox_leads limit 1))), 'Ravi', 'C9 read back by id');
select is(pg_temp.q('x5', format($q$select jsonb_array_length(public.developer_sandbox_leads_list(%L, null, null, null, 100))::text$q$, pg_temp.h('k3'))), '1', 'C10 the list (a read key)');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_get(%L, %L)::text$q$, pg_temp.h('nope'), (select id from public.developer_sandbox_leads limit 1))), 'ERR:42501', 'C11 an unknown key reads nothing');
select is((select count(*)::text from public.contacts where tenant_id = tests.tid('a') and phone = '+919800000001'), '0', 'C12 nothing went into the real contacts or leads');

-- ---- another workspace's key sees only its own sandbox
select is(pg_temp.q('b_owner', format($q$select public.developer_key_create(%L, 'B', array['leads:read'], array[]::text[], %L, 'sk_test_zz99', 'zzzz') ->> 'prefix'$q$, tests.tid('b'), pg_temp.h('kb'))), 'sk_test_zz99', 'D1 workspace B''s key');
select is(pg_temp.q('x5', format($q$select public.developer_sandbox_lead_get(%L, %L)::text$q$, pg_temp.h('kb'), (select id from public.developer_sandbox_leads limit 1))), null, 'D2 ... cannot read A''s lead');
select is(pg_temp.q('x5', format($q$select jsonb_array_length(public.developer_sandbox_leads_list(%L, null, null, null, 100))::text$q$, pg_temp.h('kb'))), '0', 'D3 ... nor list it');

-- ---- rotate and revoke
select is(pg_temp.q('a_owner', format($q$select public.developer_key_rotate(%%L, (select id from public.developer_api_keys where key_hash = %L), %L, 'sk_test_new1', 'nnnn') ->> 'prefix'$q$, pg_temp.h('k1'), pg_temp.h('k1b'))),
          'ERR:42501', 'E1 a person reads no key row directly (the id comes from the list)');
select is(tests.scalar_as(tests.uid('a_owner'), format($q$select public.developer_key_rotate(%L, %L, %L, 'sk_test_new1', 'nnnn') ->> 'prefix'$q$, tests.tid('a'),
          (select id from public.developer_api_keys where key_hash = pg_temp.h('k1')), pg_temp.h('k1b'))), 'sk_test_new1', 'E2 rotated');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'code'$q$, pg_temp.h('k1'))), 'invalid_key', 'E3 the old secret stops at once');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'ok'$q$, pg_temp.h('k1b'))), 'true', 'E4 the new one works');
select is(tests.scalar_as(tests.uid('a_owner'), format($q$select (public.developer_key_revoke(%L, %L) ->> 'revoked_at') is not null$q$, tests.tid('a'),
          (select id from public.developer_api_keys where key_hash = pg_temp.h('k1b'))))::text, 'true', 'E5 revoked');
select is(pg_temp.q('x5', format($q$select public.developer_api_auth(%L, 'leads:write', null) ->> 'code'$q$, pg_temp.h('k1b'))), 'invalid_key', 'E6 a revoked key does nothing');
select is(tests.scalar_as(tests.uid('b_owner'), format($q$select public.developer_key_revoke(%L, %L)::text$q$, tests.tid('b'),
          (select id from public.developer_api_keys where key_hash = pg_temp.h('k3')))), null, 'E7 another workspace''s key is not found');

-- ---- usage and the clean-up
select is(pg_temp.q('a_owner', $q$select public.developer_usage(%L) -> 'month' ->> 'leads'$q$), '1', 'F1 usage counts the sandbox leads');
select is(pg_temp.q('a_sales', $q$select public.developer_usage(%L)::text$q$), 'ERR:42501', 'F2 Sales does not see usage');
update public.developer_sandbox_leads set created_at = now() - interval '31 days';
select is(pg_temp.q('x5', $q$select public.scheduler_developer_purge() ->> 'leads'$q$), '1', 'F3 sandbox leads go after 30 days');
select is(pg_temp.q('a_owner', $q$select public.scheduler_developer_purge()::text$q$), 'ERR:42501', 'F4 only the worker cleans up');

select * from finish();
rollback;
