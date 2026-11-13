-- Billing v2 P3 (database half): subscribe, prorated plan change, cancel, the provider's events, GST on every invoice. Once per payment.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.sub(p_user text, p_tenant text, p_plan text, p_interval text, p_pay text) returns text language plpgsql as $$
declare v text := format('select public.pricing_subscribe(%L, %L, %L, %L, %L, %L)::text', tests.tid(p_tenant), p_plan, p_interval, 'razorpay', 'sub_TEST0001', p_pay);
begin return pg_temp.sc(p_user, v); end $$;

-- A. subscribe
select is(pg_temp.sub('a_admin', 'a', 'sales_assistant', 'monthly', 'pay_TEST000000a1'), 'ERR:42501', 'A1: only the Owner subscribes');
select is(pg_temp.sub('a_owner', 'a', 'no_such_plan', 'monthly', 'pay_TEST000000a1'), 'ERR:SM821', 'A2: an unknown plan is refused (SM821)');
select is(pg_temp.sub('a_owner', 'a', 'sales_assistant', 'weekly', 'pay_TEST000000a1'), 'ERR:22023', 'A3: and an interval that does not exist');
select is(pg_temp.j(pg_temp.sub('a_owner', 'a', 'sales_assistant', 'monthly', 'pay_TEST000000a1'), 'plan_id'), 'sales_assistant', 'A4: the Owner subscribes after the provider took the first payment');
select is((select subtotal_paise || '/' || gst_paise || '/' || total_paise from pricing.invoices where tenant_id = tests.tid('a') and ref = 'pay_TEST000000a1'), '199900/35982/235882', 'A5: the invoice: Rs 1,999 + Rs 359.82 GST = Rs 2,358.82');
select is(pg_temp.j(pg_temp.sub('a_owner', 'a', 'sales_assistant', 'monthly', 'pay_TEST000000a1'), 'replayed'), 'true', 'A6: the same payment twice changes nothing');
select is((select count(*) from pricing.invoices where tenant_id = tests.tid('a')), 1::bigint, 'A7: one invoice');
select is((select price_locked_until > now() + interval '11 months 28 days' from pricing.subscriptions where tenant_id = tests.tid('a')), true, 'A8: the launch price is locked for twelve months');
select is((select period_end - period_start from pricing.subscriptions where tenant_id = tests.tid('a')) between interval '28 days' and interval '31 days', true, 'A9: a month-long period');
select is(pg_temp.j(pg_temp.sub('b_owner', 'b', 'sales_lead_finder', 'yearly', 'pay_TEST000000b1'), 'plan_id'), 'sales_lead_finder', 'A10: another business subscribes yearly');
select is((select total_paise from pricing.invoices where tenant_id = tests.tid('b')), 7078820::bigint, 'A11: Rs 59,990 + 18 % GST = Rs 70,788.20 (two months free)');
select is((select period_end - period_start from pricing.subscriptions where tenant_id = tests.tid('b')) between interval '364 days' and interval '366 days', true, 'A12: a year-long period');

-- B. change plan, prorated
update pricing.subscriptions set period_start = now() - interval '15 days', period_end = now() + interval '15 days' where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_change_quote(%L, 'sales_lead_finder', 'monthly')::text$q$, tests.tid('a'))), 'amount_due_paise'), '200000', 'B1: halfway through the period an upgrade costs half the difference: Rs 2,000');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_change_quote(%L, 'sales_lead_finder', 'monthly')::text$q$, tests.tid('a'))), 'total_due_paise'), '236000', 'B2: with GST Rs 2,360');
select is(pg_temp.sc('a_sales', format($q$select public.pricing_change_quote(%L, 'payg', 'monthly')::text$q$, tests.tid('a'))), 'ERR:42501', 'B3: only the Owner reads a quote');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_change_apply(%L, 'sales_lead_finder', 'monthly', 'pay_TEST000000a2')::text$q$, tests.tid('a'))), 'plan_id'), 'sales_lead_finder', 'B4: applied after the provider took Rs 2,360');
select is((select subtotal_paise || '/' || total_paise from pricing.invoices where tenant_id = tests.tid('a') and ref = 'pay_TEST000000a2'), '200000/236000', 'B5: its invoice');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_change_apply(%L, 'sales_lead_finder', 'monthly', 'pay_TEST000000a2')::text$q$, tests.tid('a'))), 'replayed'), 'true', 'B6: the same payment twice changes nothing');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_change_quote(%L, 'sales_assistant', 'monthly')::text$q$, tests.tid('a'))), 'credit_paise'), '200000', 'B7: a downgrade halfway credits half the difference: Rs 2,000');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_change_apply(%L, 'sales_assistant', 'monthly', 'chg_TEST000000a3')::text$q$, tests.tid('a'))), 'plan_id'), 'sales_assistant', 'B8: applied, no payment needed');
select is(pricing.balance_of(tests.tid('a')), 200000::bigint, 'B9: the credit is in the wallet (a lot of its own)');
select is((select count(*) from pricing.invoices where tenant_id = tests.tid('a')), 2::bigint, 'B10: a downgrade makes no invoice');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_change_apply(%L, 'sales_assistant', 'monthly', 'chg_TEST000000a3')::text$q$, tests.tid('a'))), 'replayed'), 'true', 'B11: and applying it again credits nothing twice');
select is(pricing.balance_of(tests.tid('a')), 200000::bigint, 'B12: balance unchanged');

-- C. cancel
select is(pg_temp.sc('a_sales', format($q$select public.pricing_cancel(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C1: only the Owner cancels');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_cancel(%L)::text$q$, tests.tid('a'))), 'subscription')::jsonb ->> 'cancel_at_period_end', 'true', 'C2: cancel at the end of the paid period');

-- D. the provider's events
select is(pg_temp.sc('a_owner', format($q$select public.pricing_provider_event(%L, 'evt_TEST0001', 'charge_succeeded', 199900)::text$q$, tests.tid('a'))), 'ERR:42501', 'D1: events come from the system, not the Owner');
update pricing.subscriptions set period_start = now() - interval '29 days', period_end = now() + interval '1 day', cancel_at_period_end = false where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_provider_event(%L, 'evt_TEST0001', 'charge_succeeded', 199900)::text$q$, tests.tid('a'))), 'applied'), 'true', 'D2: a renewal charge is applied');
select is((select period_end > now() + interval '29 days' from pricing.subscriptions where tenant_id = tests.tid('a')), true, 'D3: the period now runs another month from where it ended');
select is((select total_paise from pricing.invoices where tenant_id = tests.tid('a') and ref = 'evt_TEST0001'), 235882::bigint, 'D4: invoiced with GST');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_provider_event(%L, 'evt_TEST0001', 'charge_succeeded', 199900)::text$q$, tests.tid('a'))), 'replayed'), 'true', 'D5: WEBHOOK REPLAY changes nothing');
select is((select count(*) from pricing.invoices where tenant_id = tests.tid('a') and ref = 'evt_TEST0001'), 1::bigint, 'D6: one invoice');
select pg_temp.sc('outsider', format($q$select public.pricing_provider_event(%L, 'evt_TEST0002', 'halted', null)::text$q$, tests.tid('a')));
select is((select status from pricing.subscriptions where tenant_id = tests.tid('a')), 'past_due', 'D7: halted = past due');
select pg_temp.sc('outsider', format($q$select public.pricing_provider_event(%L, 'evt_TEST0003', 'charge_succeeded', null)::text$q$, tests.tid('a')));
select is((select status from pricing.subscriptions where tenant_id = tests.tid('a')), 'active', 'D8: a later charge makes it active again');
select pg_temp.sc('outsider', format($q$select public.pricing_provider_event(%L, 'evt_TEST0004', 'cancelled', null)::text$q$, tests.tid('a')));
select is((select status from pricing.subscriptions where tenant_id = tests.tid('a')), 'cancelled', 'D9: cancelled at the provider');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_provider_event(%L, 'evt_TEST0005', 'charge_succeeded', 100)::text$q$, gen_random_uuid())), 'reason'), 'ERR:23503', 'D10: an event for no workspace is refused');
select is(pg_temp.sc('outsider', format($q$select public.pricing_provider_event(%L, 'x', 'charge_succeeded', 100)::text$q$, tests.tid('a'))), 'ERR:22023', 'D11: a bad event id is refused');

-- E. pay as you go: the monthly fee is an order, applied once
select is(pg_temp.j(pg_temp.sub('b_owner', 'b', 'payg', 'monthly', 'pay_TEST000000b2'), 'plan_id'), 'payg', 'E1: switch to pay as you go');
select pg_temp.sc('outsider', format($q$select public.pricing_provider_event(%L, 'order_TEST0001', 'payg_fee', 49900)::text$q$, tests.tid('b')));
select is((select kind || '/' || total_paise from pricing.invoices where tenant_id = tests.tid('b') and ref = 'order_TEST0001'), 'payg_fee/58882', 'E2: the monthly fee Rs 499 + GST = Rs 588.82, invoiced as the fee');

select * from finish();
rollback;
