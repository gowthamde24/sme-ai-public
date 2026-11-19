-- Pricing v3: charging from the ONE rupee wallet: calls (per 30 seconds, unanswered free, included minutes, Rs 5 extra minutes), Lead Finder searches (2 / 10 / 100 free, then Rs 49 / 39 / 29), WhatsApp at
-- Meta's cost, free early access, the Owner's spending limits, the queue for calls, warnings at 80 % and 100 %, the automatic top-up. Who may do each.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (tests.uid('hook'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hook@test.local', now(), '{}'::jsonb, now(), now());
select app.operator_register_billing_webhook('hook@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.bal(p_tenant text) returns text language sql as $$ select pricing.balance_of(tests.tid(p_tenant))::text $$;
create function pg_temp.sys(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.chg(p_tenant text, p_id text, p_seconds integer, p_answered boolean) returns text language sql as
$$ select pg_temp.sys(format('select public.pricing_v3_charge_call(%L, %L, %s, %L)::text', tests.tid(p_tenant), tests.rid(p_id), p_seconds, p_answered)) $$;
create function pg_temp.srch(p_tenant text, p_id text) returns text language sql as
$$ select pg_temp.sys(format('select public.pricing_v3_charge_search(%L, %L)::text', tests.tid(p_tenant), tests.rid(p_id))) $$;
create function pg_temp.plan(p_tenant text, p_plan text) returns void language plpgsql as $$
begin
  insert into pricing.subscriptions (tenant_id, plan_id, interval, status, provider, provider_ref, period_start, period_end) values (tests.tid(p_tenant), p_plan, 'monthly', 'active', 'fake', 'sub_fake_' || p_tenant, now() - interval '2 days', now() + interval '28 days')
  on conflict (tenant_id) do update set plan_id = excluded.plan_id, interval = 'monthly', status = 'active', period_start = excluded.period_start, period_end = excluded.period_end, cancel_at_period_end = false;
end $$;
create temp table orig_plan as select plan from public.tenants where id = tests.tid('a');

-- A. calls on Pay as you go: Rs 5 a minute, per 30 seconds
select pricing.credit(tests.tid('a'), 'topup', 'pay_V3CHG000001', 200000);
select is(pg_temp.j(pg_temp.chg('a', 'c1', 100, true), 'charged_paise'), '1000', 'A1: 100 s answered = 4 units of 30 s = Rs 10 at Rs 5 a minute');
select is(pg_temp.bal('a'), '199000', 'A2: taken from the one wallet');
select is(pg_temp.j(pg_temp.chg('a', 'c1', 100, true), 'replayed'), 'true', 'A3: the same call reported twice is charged once');
select is(pg_temp.bal('a'), '199000', 'A4: the balance did not move again');
select is(pg_temp.j(pg_temp.chg('a', 'c2', 30, true), 'charged_paise') || '/' || pg_temp.j(pg_temp.chg('a', 'c3', 31, true), 'charged_paise'), '250/500', 'A5: 30 s = Rs 2.50, 31 s = Rs 5 (billed per 30 seconds)');
select is(pg_temp.j(pg_temp.chg('a', 'c4', 600, false), 'charged_paise'), '0', 'A6: UNANSWERED CALLS ARE FREE');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_charge_call(%L, %L, 60, true)::text$q$, tests.tid('a'), tests.rid('c9'))), 'ERR:42501', 'A7: only the system reports a call');
select is(pg_temp.sc('hook', format($q$select public.pricing_v3_charge_call(%L, %L, 60, true)::text$q$, tests.tid('a'), tests.rid('c9'))), 'ERR:42501', 'A8: the billing webhook account does not report calls');
select is(pg_temp.sys(format($q$select public.pricing_v3_charge_call(%L, null, 60, true)::text$q$, tests.tid('a'))), 'ERR:22023', 'A9: a call without an id is refused');

-- B. Pro: 500 included minutes, then Rs 5 a minute
select pg_temp.plan('a', 'sales_assistant');
select is(pg_temp.j(pg_temp.chg('a', 'p1', 600, true), 'charged_paise') || '/' || pg_temp.j(pg_temp.chg('a', 'p1', 600, true), 'included_half'), '0/20', 'B1: 10 minutes are inside the 500 included: Rs 0');
insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise) values (tests.tid('a'), 'call', tests.rid('filler'), 979, 979, 0);   -- 999 of 1,000 included half-minutes used
select is(pg_temp.j(pg_temp.chg('a', 'p2', 90, true), 'included_half') || '/' || pg_temp.j(pg_temp.chg('a', 'p2', 90, true), 'charged_paise'), '1/500', 'B2: 3 units with 1 included left: 2 paid at Rs 2.50 = Rs 5');
select is(pg_temp.j(pg_temp.chg('a', 'p3', 120, true), 'charged_paise'), '1000', 'B3: after the included minutes the extra minute is Rs 5 (4 units = Rs 10)');
select pg_temp.plan('a', 'sales_lead_finder');
select is(pg_temp.j(pg_temp.chg('a', 'p4', 6000, true), 'charged_paise'), '0', 'B4: Business has 1,500 included minutes: a 100-minute call is inside them');

-- C. shortfall: a call that happened is recorded even if the wallet cannot pay it all
insert into public.tenants (id, name, slug) values (tests.rid('c_tenant'), 'C Shop', 'c-shop-test');
select pricing.credit(tests.rid('c_tenant'), 'topup', 'pay_V3CHG000003', 1000);
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_charge_call(%L, %L, 1800, true)::text$q$, tests.rid('c_tenant'), tests.rid('cc1'))), 'shortfall_paise'), '14000', 'C1: a 30-minute call (Rs 150) with Rs 10 in the wallet: Rs 10 taken, Rs 140 unpaid and recorded');
select is(pricing.balance_of(tests.rid('c_tenant'))::text, '0', 'C2: the wallet floors at zero');

-- D. Lead Finder searches: free first, then the plan's price from the wallet
delete from pricing.subscriptions where tenant_id = tests.tid('a');
delete from pricing.usage where tenant_id = tests.tid('a') and kind = 'search';
select is(pg_temp.j(pg_temp.srch('a', 's1'), 'free') || '/' || pg_temp.j(pg_temp.srch('a', 's2'), 'free'), 'true/true', 'D1: Pay as you go: two free searches a month');
select is(pg_temp.j(pg_temp.srch('a', 's3'), 'charged_paise'), '4900', 'D2: the third costs Rs 49');
select is(pg_temp.j(pg_temp.srch('a', 's3'), 'replayed'), 'true', 'D3: the same search twice is charged once');
select pg_temp.plan('a', 'sales_assistant');
delete from pricing.usage where tenant_id = tests.tid('a') and kind = 'search';
insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise) select tests.tid('a'), 'search', gen_random_uuid(), 0, 0, 0 from generate_series(1, 10);
select is(pg_temp.j(pg_temp.srch('a', 's4'), 'charged_paise'), '3900', 'D4: Pro: ten free, the eleventh costs Rs 39');
select pg_temp.plan('a', 'sales_lead_finder');
delete from pricing.usage where tenant_id = tests.tid('a') and kind = 'search';
insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise) select tests.tid('a'), 'search', gen_random_uuid(), 0, 0, 0 from generate_series(1, 100);
select is(pg_temp.j(pg_temp.srch('a', 's5'), 'charged_paise'), '2900', 'D5: Business: a hundred free, the next costs Rs 29');
select is(pg_temp.srch('c', 'sx1'), 'ERR:23503', 'D6: a workspace that does not exist is refused') where false;
select is(pg_temp.sys(format($q$select public.pricing_v3_charge_search(%L, %L)::text$q$, tests.rid('c_tenant'), tests.rid('sc1'))) like '%"free": true%', true, 'D7: a free search never needs money (an empty wallet, the first search)');
select pg_temp.sys(format($q$select public.pricing_v3_charge_search(%L, %L)::text$q$, tests.rid('c_tenant'), tests.rid('sc2')));
select is(pg_temp.sys(format($q$select public.pricing_v3_charge_search(%L, %L)::text$q$, tests.rid('c_tenant'), tests.rid('sc3'))), 'ERR:SM994', 'D8: a paid search with an empty wallet is refused (SM994), never run on credit');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_charge_search(%L, %L)::text$q$, tests.tid('a'), tests.rid('sx'))), 'ERR:42501', 'D9: only the system charges a search');

-- E. WhatsApp at Meta's cost, no mark-up
delete from pricing.subscriptions where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_charge_whatsapp(%L, %L, 85)::text$q$, tests.tid('a'), tests.rid('w1'))), 'charged_paise'), '85', 'E1: a message that cost Meta 85 paise costs the business 85 paise');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_charge_whatsapp(%L, %L, 85)::text$q$, tests.tid('a'), tests.rid('w1'))), 'replayed'), 'true', 'E2: once per message');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_charge_whatsapp(%L, %L, 0)::text$q$, tests.tid('a'), tests.rid('w2'))), 'charged_paise'), '0', 'E3: a reply in the 24-hour window costs nothing');
select is(pg_temp.sys(format($q$select public.pricing_v3_charge_whatsapp(%L, %L, -1)::text$q$, tests.tid('a'), tests.rid('w3'))), 'ERR:22023', 'E4: a negative cost is refused');
select is((select charged_paise from pricing.usage where tenant_id = tests.tid('a') and kind = 'whatsapp' and ref = tests.rid('w1')), 85::bigint, 'E5: recorded as it was reported');

-- F. free early access: counted, never charged
create temp table before_bal as select pricing.balance_of(tests.tid('b')) as paise;
update public.tenants set plan = 'early_access' where id = tests.tid('b');
select is(pg_temp.j(pg_temp.chg('b', 'e1', 600, true), 'charged_paise'), '0', 'F1: a call on early access is free');
select is(pg_temp.j(pg_temp.srch('b', 'es1'), 'charged_paise') || '/' || pg_temp.j(pg_temp.srch('b', 'es2'), 'charged_paise') || '/' || pg_temp.j(pg_temp.srch('b', 'es3'), 'charged_paise'), '0/0/0', 'F2: and so are its searches (the early-access meter counts them, not this wallet)');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_charge_whatsapp(%L, %L, 85)::text$q$, tests.tid('b'), tests.rid('ew1'))), 'charged_paise'), '0', 'F3: and its WhatsApp messages');
select is((select count(*) from pricing.usage where tenant_id = tests.tid('b')), 5::bigint, 'F4: all five are still recorded');
update public.tenants set plan = (select plan from orig_plan) where id = tests.tid('b');

-- G. the spending limit per feature
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_limit_set(%L, 'calls', 50000)::text$q$, tests.tid('a'))) like '%50000%', true, 'G1: the Owner sets a Rs 500 limit on calls');
select is(pg_temp.sc('a_admin', format($q$select public.pricing_v3_limit_set(%L, 'calls', 50000)::text$q$, tests.tid('a'))), 'ERR:42501', 'G2: only the Owner');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_limit_set(%L, 'ai_actions', 50000)::text$q$, tests.tid('a'))), 'ERR:22023', 'G3: a feature that is not charged has no limit');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_limit_set(%L, 'calls', 5)::text$q$, tests.tid('a'))), 'ERR:22023', 'G4: a limit under Rs 100 is refused');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_limit_set(%L, 'calls', 50000)::text$q$, tests.tid('b'))), 'ERR:42501', 'G5: not another business''s');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_feature_gate(%L, 'calls')::text$q$, tests.tid('a'))), 'allowed'), 'true', 'G6: under the limit a call may start');
delete from pricing.usage where tenant_id = tests.tid('a') and kind = 'call';
select pg_temp.chg('a', 'g1', 6000, true);   -- 100 minutes = Rs 500 on Pay as you go
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_feature_gate(%L, 'calls')::text$q$, tests.tid('a'))), 'reason'), 'limit_reached', 'G7: at the limit calls stop (the money is still in the wallet)');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_feature_gate(%L, 'lead_finder')::text$q$, tests.tid('a'))), 'allowed'), 'true', 'G8: the other features are not affected');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_limit_set(%L, 'calls', null)::text$q$, tests.tid('a'))) like '%null%', true, 'G9: null takes the limit away');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_feature_gate(%L, 'calls')::text$q$, tests.tid('a'))), 'allowed'), 'true', 'G10: and calls run again');
select pg_temp.sc('a_owner', format($q$select public.pricing_v3_limit_set(%L, 'lead_finder', 10000)::text$q$, tests.tid('a')));
delete from pricing.usage where tenant_id = tests.tid('a') and kind = 'search';
insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise) select tests.tid('a'), 'search', gen_random_uuid(), 0, 0, 0 from generate_series(1, 2);
select pg_temp.srch('a', 'lim1');
select is(pg_temp.srch('a', 'lim2'), 'ERR:SM993', 'G11: a paid search that would pass the Rs 100 limit is refused (SM993)');
delete from pricing.feature_limits where tenant_id = tests.tid('a');

-- H. the queue: a call that cannot start waits, it is not lost
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_call_gate(%L, %L)::text$q$, tests.tid('a'), tests.rid('q0'))), 'allowed'), 'true', 'H1: with money the call starts');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_call_gate(%L, %L)::text$q$, tests.rid('c_tenant'), tests.rid('q1'))), 'queued'), 'true', 'H2: an empty wallet: the call is QUEUED');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_call_gate(%L, %L)::text$q$, tests.rid('c_tenant'), tests.rid('q1'))), 'reason'), 'wallet_empty', 'H3: with the reason');
select pg_temp.sys(format($q$select public.pricing_v3_call_gate(%L, %L)::text$q$, tests.rid('c_tenant'), tests.rid('q2')));
select is((select count(*) from pricing.queued_calls where tenant_id = tests.rid('c_tenant') and status = 'queued'), 2::bigint, 'H4: asking again for the same call keeps one row (two calls waiting)');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_v3_wallet(%L)::text$q$, tests.tid('a'))), 'queued_calls'), '0', 'H5: the wallet of a business with nothing waiting says 0');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_queue_release(%L)::text$q$, tests.rid('c_tenant'))), 'released'), '[]', 'H6: still empty: nothing is released');
select pricing.credit(tests.rid('c_tenant'), 'topup', 'pay_V3CHG000004', 500);   -- one minute of calling
select is(jsonb_array_length(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_queue_release(%L)::text$q$, tests.rid('c_tenant'))), 'released')::jsonb)::text, '1', 'H7: after a top-up the wallet can start one minute: ONE queued call is released (the oldest)');
select is((select ref from pricing.queued_calls where tenant_id = tests.rid('c_tenant') and status = 'released'), tests.rid('q1'), 'H8: the oldest first');
update pricing.queued_calls set created_at = now() - interval '8 days' where tenant_id = tests.rid('c_tenant') and status = 'queued';
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_queue_release(%L)::text$q$, tests.rid('c_tenant'))), 'expired'), '1', 'H9: a call waiting more than 7 days is let go');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_call_gate(%L, %L)::text$q$, tests.tid('a'), tests.rid('q9'))), 'ERR:42501', 'H10: only the system asks the call gate');
update public.tenants set plan = 'early_access' where id = tests.rid('c_tenant');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_call_gate(%L, %L)::text$q$, tests.rid('c_tenant'), tests.rid('q3'))), 'allowed'), 'true', 'H11: early access is never queued');
update public.tenants set plan = (select plan from orig_plan) where id = tests.rid('c_tenant');

-- I. warnings at 80 % and 100 %, given once
insert into public.tenants (id, name, slug) values (tests.rid('w_tenant'), 'W Shop', 'w-shop-test');
select pricing.credit(tests.rid('w_tenant'), 'topup', 'pay_V3CHG000005', 100000);
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_warnings_take(%L)::text$q$, tests.rid('w_tenant'))), 'new'), '[]', 'I1: nothing used, nothing to warn about');
update pricing.wallet_lots set remaining_paise = 20000 where tenant_id = tests.rid('w_tenant');   -- 80 % used
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_warnings_take(%L)::text$q$, tests.rid('w_tenant'))), 'new')::jsonb -> 0 ->> 'level', '80', 'I2: at 80 % of the wallet: the 80 % warning');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_warnings_take(%L)::text$q$, tests.rid('w_tenant'))), 'new'), '[]', 'I3: given once');
update pricing.wallet_lots set remaining_paise = 0 where tenant_id = tests.rid('w_tenant');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_warnings_take(%L)::text$q$, tests.rid('w_tenant'))), 'new')::jsonb -> 0 ->> 'level', '100', 'I4: empty: the 100 % warning');
select pricing.credit(tests.rid('w_tenant'), 'topup', 'pay_V3CHG000006', 100000);
update pricing.wallet_lots set remaining_paise = 10000 where tenant_id = tests.rid('w_tenant') and ref = 'pay_V3CHG000006';
select is(jsonb_array_length(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_warnings_take(%L)::text$q$, tests.rid('w_tenant'))), 'new')::jsonb)::text, '1', 'I5: after a new top-up the warnings start afresh');
select pg_temp.sc('a_owner', format($q$select public.pricing_v3_limit_set(%L, 'whatsapp', 1000)::text$q$, tests.tid('a')));
select pg_temp.sys(format($q$select public.pricing_v3_charge_whatsapp(%L, %L, 850)::text$q$, tests.tid('a'), tests.rid('w5')));
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_warnings_take(%L)::text$q$, tests.tid('a'))), 'new')::jsonb @> '[{"scope": "whatsapp", "level": 80}]', true, 'I6: a feature with a limit warns at 80 % of the limit (Rs 8.50 of Rs 10)');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_v3_wallet(%L)::text$q$, tests.tid('a'))), 'warnings')::jsonb @> '[{"scope": "whatsapp"}]', true, 'I7: the wallet shows the warnings that are in force');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_warnings_take(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'I8: only the system marks them given');
delete from pricing.feature_limits where tenant_id = tests.tid('a');

-- J. the automatic top-up
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_auto_topup_set(%L, true, 100000, 20000, 300000)::text$q$, tests.tid('a'))) like '%300000%', true, 'J1: the Owner switches it on: Rs 1,000 whenever the wallet is under Rs 200, at most Rs 3,000 a month');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_auto_topup_set(%L, true, 100000, 20000, 50000)::text$q$, tests.tid('a'))), 'ERR:22023', 'J2: a monthly limit under the amount is refused');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_auto_topup_set(%L, true, 500, 20000, 300000)::text$q$, tests.tid('a'))), 'ERR:22023', 'J3: an amount under Rs 100 is refused');
select is(pg_temp.sc('a_sales', format($q$select public.pricing_v3_auto_topup_set(%L, true, 100000, 20000, 300000)::text$q$, tests.tid('a'))), 'ERR:42501', 'J4: only the Owner');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_auto_topup_due(%L)::text$q$, tests.tid('a'))), 'reason'), 'balance_ok', 'J5: the wallet is above the line: not due');
update pricing.wallet_lots set remaining_paise = 100 where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_auto_topup_due(%L)::text$q$, tests.tid('a'))), 'due') || '/' || pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_auto_topup_due(%L)::text$q$, tests.tid('a'))), 'amount_paise'), 'true/100000', 'J6: under the line: due, Rs 1,000');
select is(pg_temp.j(pg_temp.sc('hook', format($q$select public.pricing_v3_auto_topup_record(%L, 'pay_AUTO00000001', 100000)::text$q$, tests.tid('a'))), 'credited'), 'true', 'J7: the paid top-up (the signed event) credits the wallet');
select is(pg_temp.j(pg_temp.sc('hook', format($q$select public.pricing_v3_auto_topup_record(%L, 'pay_AUTO00000001', 100000)::text$q$, tests.tid('a'))), 'replayed'), 'true', 'J8: the same payment twice changes nothing');
select is((select subtotal_paise || '/' || gst_paise from pricing.invoices where tenant_id = tests.tid('a') and ref = 'pay_AUTO00000001'), '100000/18000', 'J9: invoiced with 18 % GST on top');
select pg_temp.sc('hook', format($q$select public.pricing_v3_auto_topup_record(%L, 'pay_AUTO00000002', 100000)::text$q$, tests.tid('a')));
select pg_temp.sc('hook', format($q$select public.pricing_v3_auto_topup_record(%L, 'pay_AUTO00000003', 100000)::text$q$, tests.tid('a')));
update pricing.wallet_lots set remaining_paise = 100 where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_auto_topup_due(%L)::text$q$, tests.tid('a'))), 'reason'), 'monthly_limit', 'J10: Rs 3,000 already topped up this month: not due again');
select is(pg_temp.sc('hook', format($q$select public.pricing_v3_auto_topup_record(%L, 'pay_AUTO00000004', 100000)::text$q$, tests.tid('a'))), 'ERR:SM993', 'J11: and a payment that would pass the monthly limit is refused');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_auto_topup_record(%L, 'pay_AUTO00000005', 100000)::text$q$, tests.tid('a'))), 'ERR:42501', 'J12: the Owner does not record a payment: only the system');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_v3_wallet(%L)::text$q$, tests.tid('a'))), 'auto_topup')::jsonb ->> 'used_this_month_paise', '300000', 'J13: the wallet shows what it did this month');
select pg_temp.sc('a_owner', format($q$select public.pricing_v3_auto_topup_set(%L, false, 100000, 20000, 300000)::text$q$, tests.tid('a')));
select is(pg_temp.j(pg_temp.sys(format($q$select public.pricing_v3_auto_topup_due(%L)::text$q$, tests.tid('a'))), 'reason'), 'off', 'J14: switched off: never due');

select * from finish();
rollback;
