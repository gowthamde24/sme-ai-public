-- Billing v2 P3 (orders): a top-up, the pay-as-you-go fee and an upgrade are paid by ORDERS at the provider and settled once; the stored order, not the caller, decides what it is worth.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.oc(p_user text, p_tenant text, p_order text, p_purpose text, p_amount bigint default null, p_plan text default null, p_int text default null) returns text language plpgsql as $$
begin return pg_temp.sc(p_user, format('select public.pricing_order_create(%L, %L, %L, %s, %L, %L)::text', tests.tid(p_tenant), p_order, p_purpose, coalesce(p_amount::text, 'null'), p_plan, p_int)); end $$;
create function pg_temp.os(p_user text, p_tenant text, p_order text, p_pay text) returns text language plpgsql as $$
begin return pg_temp.sc(p_user, format('select public.pricing_order_settle(%L, %L, %L)::text', tests.tid(p_tenant), p_order, p_pay)); end $$;

-- A. a top-up
select is(pg_temp.oc('a_admin', 'a', 'order_TEST000001', 'topup', 100000), 'ERR:42501', 'A1: only the Owner creates an order');
select is(pg_temp.oc('a_owner', 'a', 'order_TEST000001', 'topup', 500), 'ERR:22023', 'A2: a top-up under Rs 100 is refused');
select is(pg_temp.oc('a_owner', 'a', 'order_TEST000001', 'topup', 20000000), 'ERR:22023', 'A3: and over Rs 1,00,000');
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_TEST000001', 'topup', 100000), 'total_paise'), '118000', 'A4: Rs 1,000 + 18 % GST: the provider is asked for Rs 1,180');
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_TEST000001', 'topup', 999999), 'total_paise'), '118000', 'A5: creating the same order again changes nothing (the stored amount stands)');
select is(pg_temp.os('a_owner', 'a', 'order_TEST000001', 'pay_TEST000001') like '%"settled": true%', true, 'A6: paid: settled');
select is(pricing.balance_of(tests.tid('a')), 100000::bigint, 'A7: the wallet got the BASE Rs 1,000, not the Rs 1,180');
select is((select total_paise from pricing.invoices where tenant_id = tests.tid('a') and kind = 'topup'), 118000::bigint, 'A8: the invoice is Rs 1,180 with GST');
select is(pg_temp.j(pg_temp.os('outsider', 'a', 'order_TEST000001', 'pay_TEST000001'), 'replayed'), 'true', 'A9: the webhook after the browser: nothing happens twice');
select is(pricing.balance_of(tests.tid('a')), 100000::bigint, 'A10: balance unchanged');
select is(pg_temp.os('a_sales', 'a', 'order_TEST000001', 'pay_TEST000002'), 'ERR:42501', 'A11: only the Owner or the system settles');
select is(pg_temp.os('a_owner', 'a', 'order_UNKNOWN0001', 'pay_TEST000003'), 'ERR:23503', 'A12: an order that was never created cannot be settled (23503)');
select is(pg_temp.os('b_owner', 'b', 'order_TEST000001', 'pay_TEST000004'), 'ERR:23503', 'A13: another business cannot settle our order');

-- B. the pay-as-you-go monthly fee
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_TEST000010', 'payg_fee'), 'base_paise'), '49900', 'B1: the fee is Rs 499');
select pg_temp.os('outsider', 'a', 'order_TEST000010', 'pay_TEST000010');
select is((select plan_id || '/' || status from pricing.subscriptions where tenant_id = tests.tid('a')), 'payg/active', 'B2: paid: pay as you go is active for a month');
select is((select kind || '/' || total_paise from pricing.invoices where tenant_id = tests.tid('a') and ref = 'pay_TEST000010'), 'payg_fee/58882', 'B3: the fee invoice with GST');
select pg_temp.oc('a_owner', 'a', 'order_TEST000011', 'payg_fee');
select pg_temp.os('outsider', 'a', 'order_TEST000011', 'pay_TEST000011');
select is((select period_end > now() + interval '58 days' from pricing.subscriptions where tenant_id = tests.tid('a')), true, 'B4: the next month is added to the end of the current one');

-- C. an upgrade by order
update pricing.subscriptions set plan_id = 'sales_assistant', period_start = now() - interval '15 days', period_end = now() + interval '15 days' where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_TEST000020', 'plan_change', null, 'sales_lead_finder', 'monthly'), 'base_paise'), '200000', 'C1: halfway, the upgrade costs half the difference: Rs 2,000');
select is(pg_temp.oc('a_owner', 'a', 'order_TEST000021', 'plan_change', null, 'sales_assistant', 'monthly'), 'ERR:22023', 'C2: a change with nothing to pay does not need an order');
select is(pg_temp.oc('a_owner', 'a', 'order_TEST000022', 'plan_change', null, 'no_such_plan', 'monthly'), 'ERR:22023', 'C3: an unknown plan is refused');
select pg_temp.os('outsider', 'a', 'order_TEST000020', 'pay_TEST000020');
select is((select plan_id from pricing.subscriptions where tenant_id = tests.tid('a')), 'sales_lead_finder', 'C4: paid: the plan changed');
select is((select total_paise from pricing.invoices where tenant_id = tests.tid('a') and ref = 'pay_TEST000020'), 236000::bigint, 'C5: invoiced Rs 2,000 + GST = Rs 2,360');

-- D. the invoices list
select is(jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.pricing_invoices(%L)::text$q$, tests.tid('a')))::jsonb), 4, 'D1: the Owner reads the invoices (top-up, two fees, the upgrade)');
select is(pg_temp.sc('a_sales', format($q$select public.pricing_invoices(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D2: Sales do not');
select is(pg_temp.sc('b_owner', format($q$select public.pricing_invoices(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D3: nor another business');
select is((select count(*) from information_schema.table_privileges where table_schema = 'pricing' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'D4: no client role touches a pricing table');

select * from finish();
rollback;
