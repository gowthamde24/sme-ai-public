-- Admin console phase 2, slice 3: a goodwill credit (reason, amount typed twice, fresh second factor, limits, idempotent, audited, visible to the shop).
begin;
select no_plan();
select tests.seed_two_tenants();

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@staff.test', now(), jsonb_build_object('display_name', n), now(), now()
  from unnest(array['s_owner', 's_support', 's_finance']) n;
select app.operator_register_staff('s_owner@staff.test', 'Gowtham R', 'owner');
select app.operator_register_staff('s_support@staff.test', 'Anu Support', 'support');
select app.operator_register_staff('s_finance@staff.test', 'Fay Finance', 'finance');

create function pg_temp.st(p_user text, p_aal text, p_sid text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid(p_user), 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
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



-- like st(), but the token also carries the sign-in steps: a password and a code entered `p_age` seconds ago
create function pg_temp.sc(p_user text, p_age integer, p_sql text) returns text language plpgsql as $$
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
create function pg_temp.gc(p_user text, p_age integer, p_amount bigint, p_confirm bigint, p_reason text, p_text text, p_key text) returns text language sql as $$
  select pg_temp.sc(p_user, p_age, format('select public.admin_goodwill_credit(%L, %s, %s, %L, %L, %L)::text', tests.tid('a'), p_amount, p_confirm, p_reason, p_text, p_key)) $$;
select pricing.credit(tests.tid('a'), 'topup', 'seed_topup_1', 50000);

-- A. who may
select is(pg_temp.sc('a_owner', 10, format($q$select public.admin_goodwill_credit(%L, 500, 500, 'incident', 'sorry', 'key-0000001')::text$q$, tests.tid('a'))), 'ERR:SM941', 'A1: a shop owner is not staff');
select is(pg_temp.gc('s_support', 10, 500, 500, 'incident', 'sorry for the missed calls', 'key-0000001'), 'ERR:42501', 'A2: support gives no money');
select is(pg_temp.st('s_finance', 'aal1', 'sess-s_finance-0001', format($q$select public.admin_goodwill_credit(%L, 500, 500, 'incident', 'sorry', 'key-0000001')::text$q$, tests.tid('a'))), 'ERR:SM942', 'A3: the second factor is always needed');

-- B. the checks
select is(pg_temp.gc('s_finance', 10, 500, 400, 'incident', 'sorry for the missed calls', 'key-0000002'), 'ERR:22023', 'B1: the amount must be typed twice, the same');
select is(pg_temp.gc('s_finance', 10, 50, 50, 'incident', 'sorry for the missed calls', 'key-0000002'), 'ERR:22023', 'B2: at least Rs 1');
select is(pg_temp.gc('s_finance', 10, 100001, 100001, 'incident', 'sorry for the missed calls', 'key-0000002'), 'ERR:22023', 'B3: at most Rs 1,000 a time');
select is(pg_temp.gc('s_finance', 10, 500, 500, 'whim', 'sorry for the missed calls', 'key-0000002'), 'ERR:22023', 'B4: the reason code is from the list');
select is(pg_temp.gc('s_finance', 10, 500, 500, 'incident', 'sorry for the missed calls', 'short'), 'ERR:22023', 'B5: an idempotency key is needed');
select is(pg_temp.gc('s_finance', 10, 500, 500, 'incident', '  ', 'key-0000002'), 'ERR:SM946', 'B6: money always needs words');
select is(pg_temp.gc('s_finance', 10, 500, 500, 'incident', 'ab', 'key-0000002'), 'ERR:SM946', 'B7: at least 3 characters');
select is(pg_temp.gc('s_finance', 600, 500, 500, 'incident', 'sorry for the missed calls', 'key-0000002'), 'ERR:SM948', 'B8: a code entered 10 minutes ago is not fresh');
select is(pg_temp.sc('s_finance', 10, format($q$select public.admin_goodwill_credit(%L, 500, 500, 'incident', 'sorry for the missed calls', 'key-0000002')::text$q$, gen_random_uuid())), 'ERR:23503', 'B9: the business must exist');
select is(pg_temp.st('s_finance', 'aal2', 'sess-s_finance-0001', format($q$select public.admin_goodwill_credit(%L, 500, 500, 'incident', 'sorry for the missed calls', 'key-0000002')::text$q$, tests.tid('a'))), 'ERR:SM948', 'B10: no sign-in steps in the token at all: not fresh');
select is(pricing.balance_of(tests.tid('a')), 50000::bigint, 'B11: nothing was credited by any of those');

-- C. the credit
select is(pg_temp.gc('s_finance', 10, 500, 500, 'incident', 'sorry for the missed calls', 'key-0000002')::jsonb ->> 'balance_paise', '50500', 'C1: Rs 5 is added to the balance');
select is((select count(*) from pricing.wallet_lots where tenant_id = tests.tid('a') and source = 'adjustment'), 1::bigint, 'C2: as one wallet lot (an adjustment)');
select is(pg_temp.gc('s_finance', 10, 500, 500, 'incident', 'sorry for the missed calls', 'key-0000002')::jsonb ->> 'replayed', 'true', 'C3: the same key again changes nothing');
select is(pricing.balance_of(tests.tid('a')), 50500::bigint, 'C4: the balance is the same');
select is((select count(*) from admin.audit where action = 'credit' and tenant_id = tests.tid('a')), 1::bigint, 'C5: and there is one audit row, not two');
select is(pg_temp.gc('s_owner', 10, 100000, 100000, 'billing_dispute', 'agreed on the call with the shop', 'key-0000003')::jsonb ->> 'credited_paise', '100000', 'C6: the owner can credit too (Rs 1,000, the most at a time)');
select is(pg_temp.gc('s_owner', 10, 100000, 100000, 'billing_dispute', 'agreed on the call with the shop', 'key-0000004')::jsonb ->> 'credited_paise', '100000', 'C7: a second one');
select is(pg_temp.gc('s_owner', 10, 100000, 100000, 'billing_dispute', 'agreed on the call with the shop', 'key-0000005'), 'ERR:SM949', 'C8: Rs 3,000 per business per 30 days is the limit (Rs 2,005 so far, Rs 1,000 more is over)');

-- D. the shop owner sees it, and the money is in their balance
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select (public.activity_log(%L, 10, null, null, 'support') -> 'items' -> 0 ->> 'summary')$q$, tests.tid('a'))), 'Stack19 added a goodwill credit to your balance', 'D1: in plain words in the activity log');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select (public.activity_log(%L, 10, null, null, 'support') -> 'items' -> 0 ->> 'who')$q$, tests.tid('a'))), 'support', 'D2: never a staff name');
select is(has_function_privilege('anon', 'public.admin_goodwill_credit(uuid,bigint,bigint,text,text,text)', 'execute'), false, 'D3: anon cannot call it');

select * from finish();
rollback;
