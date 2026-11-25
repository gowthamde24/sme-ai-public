-- Calls charged to the wallet (migration 20261231991700): tests are free, an unanswered call costs nothing, an inbound call past an empty wallet leaves a small debt that a top-up pays first,
-- the floor stops inbound AI calls, an outbound call needs a minute of balance, exempt workspaces are never charged, the reconcile list finds calls without a charge.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.chg(p_tenant text, p_id text, p_seconds integer, p_answered boolean) returns text language plpgsql as $$
begin return pg_temp.sc('outsider', format('select public.pricing_charge_call(%L, %L, %s, %L)::text', tests.tid(p_tenant), tests.rid(p_id), p_seconds, p_answered)); end $$;
create function pg_temp.gate(p_tenant text, p_key text) returns text language sql as $$ select (app.wallet_gate(tests.tid(p_tenant))) ->> p_key $$;

insert into public.phone_calls (id, tenant_id, direction, state, purpose, language, provider, created_by, answered_at, ended_at, duration_s, sandbox, simulated) values
  (tests.rid('cc_in'),  tests.tid('a'), 'inbound',  'completed', 'inbound', 'te', 'plivo', tests.uid('a_owner'), now() - interval '10 min', now() - interval '5 min', 70, false, false),
  (tests.rid('cc_in2'), tests.tid('a'), 'inbound',  'completed', 'inbound', 'te', 'plivo', tests.uid('a_owner'), now() - interval '10 min', now() - interval '5 min', 70, false, false),
  (tests.rid('cc_sbx'), tests.tid('a'), 'outbound', 'completed', 'sales_followup', 'te', 'sandbox', tests.uid('a_owner'), now() - interval '10 min', now() - interval '5 min', 60, true, true),
  (tests.rid('cc_out'), tests.tid('a'), 'outbound', 'completed', 'sales_followup', 'te', 'plivo', tests.uid('a_owner'), now() - interval '10 min', now() - interval '5 min', 45, false, false),
  (tests.rid('cc_bx'),  tests.tid('b'), 'inbound',  'completed', 'inbound', 'te', 'plivo', tests.uid('b_owner'), now() - interval '10 min', now() - interval '5 min', 120, false, false);
update public.tenants set billing_exempt = true where id = tests.tid('b');

-- A. the gate with an empty wallet: no outbound call, inbound until the floor
select is(pg_temp.gate('a', 'outbound_ok'), 'false', 'A1: no balance, no included minutes: an outbound call may not start');
select is(pg_temp.gate('a', 'inbound_ok'), 'true', 'A2: but an inbound call is still answered');
select is(pg_temp.gate('b', 'outbound_ok') || pg_temp.gate('b', 'inbound_ok') || pg_temp.gate('b', 'exempt'), 'truetruetrue', 'A3: an exempt workspace is never blocked');

-- B. charging
select is(pg_temp.j(pg_temp.chg('a', 'cc_sbx', 60, true), 'skipped'), 'test_call', 'B1: a sandbox or simulated call is free, with no usage row');
select is((select count(*) from pricing.usage where ref = tests.rid('cc_sbx')), 0::bigint, 'B2: and leaves nothing to reconcile');
select is(pg_temp.j(pg_temp.chg('a', 'cc_out', 45, false), 'charged_paise'), '0', 'B3: an unanswered call costs nothing');
select is(pg_temp.j(pg_temp.chg('b', 'cc_bx', 120, true), 'skipped'), 'exempt', 'B4: an exempt workspace is not charged');
select is(pg_temp.j(pg_temp.chg('a', 'cc_in', 70, true), 'half_minutes'), '3', 'B5: 70 seconds are three 30-second blocks');
select is(pg_temp.j(pg_temp.chg('a', 'cc_in', 70, true), 'replayed'), 'true', 'B6: the same call again is a replay, not a second charge');
select is((select count(*) from pricing.usage where ref = tests.rid('cc_in')), 1::bigint, 'B7: one row per call');
select is((select owed_paise from pricing.debts where tenant_id = tests.tid('a')), 750::bigint, 'B8: an inbound call past an empty wallet leaves its price as a debt (3 blocks at Rs 2.50)');
select is(pg_temp.gate('a', 'inbound_ok'), 'true', 'B9: Rs 7.50 owed is under the Rs 50 floor');
update pricing.settings set inbound_floor_paise = 1000;
select is(pg_temp.j(pg_temp.chg('a', 'cc_in2', 70, true), 'shortfall_paise'), '750', 'B10: a second call: the shortfall again');
select is(pg_temp.gate('a', 'inbound_ok'), 'false', 'B11: past the floor the assistant stops answering inbound calls');

-- C. a top-up pays the debt first, then the wallet is whole again
select pricing.credit(tests.tid('a'), 'topup', 'pay_cc_1', 10000);
select is((select coalesce(owed_paise, 0) from pricing.debts where tenant_id = tests.tid('a')), 0::bigint, 'C1: the debt is paid first');
select is(pricing.balance_of(tests.tid('a')), 8500::bigint, 'C2: the rest (Rs 100 less Rs 15) is the balance');
select is(pg_temp.gate('a', 'inbound_ok') || pg_temp.gate('a', 'outbound_ok'), 'truetrue', 'C3: both directions are open again');
select pricing.credit(tests.tid('a'), 'free_start', 'fs_cc', 3000);
select is((select coalesce(owed_paise, 0) from pricing.debts where tenant_id = tests.tid('a')), 0::bigint, 'C4: a free start never pays a debt (and there is none)');

-- D. the lot that expires first is spent first (the trial credit before the later top-up)
update pricing.wallet_lots set expires_at = now() + interval '10 days' where tenant_id = tests.tid('a') and source = 'free_start';
update pricing.wallet_lots set expires_at = now() + interval '80 days' where tenant_id = tests.tid('a') and source = 'topup';
select pricing.spend(tests.tid('a'), 1000);
select is((select remaining_paise from pricing.wallet_lots where tenant_id = tests.tid('a') and source = 'free_start'), 2000::bigint, 'D1: the trial credit is used first');
select is((select remaining_paise from pricing.wallet_lots where tenant_id = tests.tid('a') and source = 'topup'), 8500::bigint, 'D2: the top-up is untouched');

-- E. who may, and the reconcile list
select is(pg_temp.sc('a_owner', format($q$select public.pricing_charge_call(%L, %L, 60, true)::text$q$, tests.tid('a'), tests.rid('cc_in'))), 'ERR:42501', 'E1: a member cannot charge a call');
select is(pg_temp.sc('a_owner', 'select public.pricing_uncharged_calls(10)::text'), 'ERR:42501', 'E2: nor read the reconcile list');
insert into public.phone_calls (id, tenant_id, direction, state, purpose, language, provider, created_by, answered_at, ended_at, duration_s, sandbox, simulated) values
  (tests.rid('cc_late'), tests.tid('a'), 'outbound', 'completed', 'sales_followup', 'te', 'plivo', tests.uid('a_owner'), now() - interval '10 min', now() - interval '5 min', 33, false, false);
select is((select jsonb_array_length(pg_temp.sc('outsider', 'select public.pricing_uncharged_calls(10)::text')::jsonb)), 1, 'E3: exactly the answered call without a charge is listed (not tests, not exempt, not charged ones)');
select is(pg_temp.j(pg_temp.chg('a', 'cc_late', 33, true), 'half_minutes'), '2', 'E4: charging it');
select is((select jsonb_array_length(pg_temp.sc('outsider', 'select public.pricing_uncharged_calls(10)::text')::jsonb)), 0, 'E5: and the list is empty');
select is(has_table_privilege('authenticated', 'pricing.debts', 'select'), false, 'E6: the debts table is closed to members');
select * from finish();
rollback;
