-- Launch support gaps (migration 20261231992300): staff find by e-mail, read a statement, take credits back (audited, never below zero), see failing webhooks and the computed alerts; members see none of it.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A. members are not staff: every function refuses them
select is(pg_temp.sc('a_owner', format($q$select public.admin_statement(%L)::text$q$, tests.tid('a'))) like 'ERR:%', true, 'A1: a workspace Owner cannot read a statement as staff');
select is(pg_temp.sc('a_owner', $q$select public.admin_find_by_email('a_owner@test.local')::text$q$) like 'ERR:%', true, 'A2: nor find a business by e-mail');
select is(pg_temp.sc('a_owner', format($q$select public.admin_wallet_debit(%L, 500, 500, 'other', 'test reason', 'key-abcdef12')::text$q$, tests.tid('a'))) like 'ERR:%', true, 'A3: nor take credits back');
select is(pg_temp.sc('a_owner', 'select public.admin_webhook_failures(10)::text') like 'ERR:%', true, 'A4: nor see failing webhooks');
select is(has_function_privilege('anon', 'public.admin_wallet_debit(uuid, bigint, bigint, text, text, text)', 'execute'), false, 'A5: a stranger has no door');

-- B. the statement behind the staff door equals what the Owner sees, and a debit shows on it
select pricing.credit(tests.tid('a'), 'topup', 'pay_adm_1', 50000);
select is((pricing.statement_internal(tests.tid('a'), null, null, 100, null) ->> 'balance_paise')::bigint, 50000::bigint, 'B1: the staff statement carries the balance');
select is((select jsonb_array_length(pricing.statement_internal(tests.tid('a'), null, null, 100, null) -> 'items')), 1, 'B2: one line, the top-up');

-- C. taking credits back (the function body needs a staff identity; its rules are checked by calling the internals the same way)
insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (tests.tid('a'), 'adjustment', md5('debit:test')::uuid, 0, 0, 10000, 0);
select pricing.spend(tests.tid('a'), 10000);
select is((pricing.statement_internal(tests.tid('a'), null, null, 100, null) ->> 'balance_paise')::bigint, 40000::bigint, 'C1: the balance fell by the debit');
select is((select string_agg(x ->> 'label', ',' order by x ->> 'kind') from jsonb_array_elements(pricing.statement_internal(tests.tid('a'), null, null, 100, null) -> 'items') x), 'Top-up,Taken back by Stack19', 'C2: the statement says "Taken back by Stack19"');
select is((pricing.statement_internal(tests.tid('a'), null, null, 100, null) -> 'items' -> 0 ->> 'balance_after_paise')::bigint, 40000::bigint, 'C3: and the running balance adds up');
select is((select count(*) from pg_constraint where conrelid = 'pricing.usage'::regclass and pg_get_constraintdef(oid) like '%adjustment%'), 1::bigint, 'C4: the usage kinds allow an adjustment');

-- D. computed alerts (counted by their own numbers, so rows already in the database do not matter)
create function pg_temp.n(p_kind text) returns integer language sql as $$ select coalesce((select (regexp_match(x ->> 'detail', '^(\d+)'))[1]::int from jsonb_array_elements(admin.computed_alerts('owner')) x where x ->> 'kind' = p_kind), 0) $$;
create temp table before_n as select pg_temp.n('wallet_low') as wallet, pg_temp.n('kyc_pending') as kyc, pg_temp.n('webhook_failing') as hook;
insert into public.phone_numbers (tenant_id, number, provider, inbound_on, label) values (tests.tid('b'), '+919876500001', 'voicelink', true, 'smoke');
select is(pg_temp.n('wallet_low') - (select wallet from before_n), 1, 'D1: a business with a live number and under four minutes adds to the low-wallet alert');
select is((select count(*) from jsonb_array_elements(admin.computed_alerts('finance')) x where x ->> 'kind' in ('kyc_pending', 'webhook_failing')), 0::bigint, 'D2: KYC and webhook alerts are for owner and support only');
insert into telephony.business_clients (tenant_id, client_id, account_type, state, created_by, created_at) values (tests.tid('a'), 701, 'business', 'in_progress', tests.uid('a_owner'), now() - interval '4 days');
select is(pg_temp.n('kyc_pending') - (select kyc from before_n), 1, 'D3: a business waiting more than three days adds to the verification alert');
insert into public.webhook_endpoints (tenant_id, url, events, secret_last4, failing_since, created_by) values (tests.tid('a'), 'https://example.test/hook', array['lead.created'], 'abcd', now() - interval '2 hours', tests.uid('a_owner'));
select is(pg_temp.n('webhook_failing') - (select hook from before_n), 1, 'D4: an endpoint failing for two hours adds to the webhook alert');

-- E. staff (owner, support, finance) with a fresh second factor
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@staff.test', now(), jsonb_build_object('display_name', n), now(), now() from unnest(array['s_support', 's_finance']) n;
select app.operator_register_staff('s_support@staff.test', 'Anu Support', 'support');
select app.operator_register_staff('s_finance@staff.test', 'Fay Finance', 'finance');
create function pg_temp.staff(p_user text, p_age integer, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid(p_user), 'role', 'authenticated', 'aal', 'aal2', 'session_id', 'sess-' || p_user || '-0001',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 9000), json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_age)))::text, true);
  perform set_config('request.jwt.claim.sub', tests.uid(p_user)::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return v;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return 'ERR:' || sqlstate;
end $$;
select is(pg_temp.staff('s_support', 10, format($q$select (public.admin_find_by_email('a_owner@test.local') -> 'businesses' -> 0 ->> 'tenant_id')$q$)), tests.tid('a')::text, 'E1: support finds a business by its Owner''s e-mail');
select is(pg_temp.staff('s_support', 10, $q$select jsonb_array_length(public.admin_find_by_email('nobody@nowhere.test') -> 'businesses')::text$q$), '0', 'E2: and an unknown e-mail finds nothing');
select is(pg_temp.staff('s_support', 10, $q$select public.admin_find_by_email('no spaces allowed')::text$q$), 'ERR:22023', 'E3: a malformed e-mail is refused');
select is(pg_temp.staff('s_support', 10, format($q$select (public.admin_statement(%L) ->> 'balance_paise')$q$, tests.tid('a'))), '40000', 'E4: support reads the statement');
select is(pg_temp.staff('s_support', 10, format($q$select public.admin_wallet_debit(%L, 1000, 1000, 'other', 'a reason', 'key-debit-001')::text$q$, tests.tid('a'))) like 'ERR:%', true, 'E5: support cannot take credits back');
select is(pg_temp.staff('s_finance', 10, format($q$select public.admin_wallet_debit(%L, 1000, 999, 'other', 'a reason', 'key-debit-001')::text$q$, tests.tid('a'))), 'ERR:22023', 'E6: the amount must be typed twice');
select is(pg_temp.staff('s_finance', 10, format($q$select public.admin_wallet_debit(%L, 1000, 1000, 'other', 'ab', 'key-debit-001')::text$q$, tests.tid('a'))), 'ERR:SM946', 'E7: a reason in words is needed');
select is(pg_temp.staff('s_finance', 99999, format($q$select public.admin_wallet_debit(%L, 1000, 1000, 'other', 'a reason', 'key-debit-001')::text$q$, tests.tid('a'))) like 'ERR:%', true, 'E8: a stale second factor is refused');
select is(pg_temp.staff('s_finance', 10, format($q$select (public.admin_wallet_debit(%L, 1000, 1000, 'billing_dispute', 'agreed on the call', 'key-debit-001')) ->> 'balance_paise'$q$, tests.tid('a'))), '39000', 'E9: finance takes Rs 10 back');
select is(pg_temp.staff('s_finance', 10, format($q$select (public.admin_wallet_debit(%L, 1000, 1000, 'billing_dispute', 'agreed on the call', 'key-debit-001')) ->> 'replayed'$q$, tests.tid('a'))), 'true', 'E10: the same key again changes nothing');
select is(pricing.balance_of(tests.tid('a')), 39000::bigint, 'E11: the balance fell once');
select is(pg_temp.staff('s_finance', 10, format($q$select public.admin_wallet_debit(%L, 100000, 100000, 'other', 'too much', 'key-debit-002')::text$q$, tests.tid('a'))), 'ERR:22023', 'E12: never below zero');
select is(pg_temp.staff('s_finance', 10, format($q$select (jsonb_path_query_first(public.admin_statement(%L) -> 'items', '$[*] ? (@.label == "Taken back by Stack19")') ->> 'amount_paise')$q$, tests.tid('a'))), '-1000', 'E13: the statement shows the taking back');
select is(pg_temp.staff('s_support', 10, $q$select jsonb_array_length(public.admin_webhook_failures(10) -> 'items')::text$q$) >= '1', true, 'E14: support sees the failing webhook');
select is(pg_temp.staff('s_finance', 10, $q$select public.admin_webhook_failures(10)::text$q$) like 'ERR:%', true, 'E15: finance does not (support and owner only)');
select * from finish();
rollback;
