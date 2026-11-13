-- ONE dedicated account for the billing webhook: only it (and the business's Owner) settles an order; scheduler and channel accounts cannot, and cannot credit a wallet from a payment either.
begin;
select no_plan();
select tests.seed_two_tenants();

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@system.test', now(), '{}'::jsonb, now(), now()
  from unnest(array['hook', 'hook2', 'sched', 'chan', 'staffer']) n;
select app.operator_register_scheduler('sched@system.test');
select app.operator_register_channel_agent('chan@system.test');
select app.operator_register_staff('staffer@system.test', 'Some Staffer', 'support');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.mk(p_order text) returns text language sql as $$ select pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_order_create(%L, %L, 'topup', 100000, null, null)::text$q$, tests.tid('a'), p_order)), 'status') $$;
create function pg_temp.settle(p_user text, p_order text, p_pay text) returns text language sql as $$ select pg_temp.sc(p_user, format($q$select public.pricing_order_settle(%L, %L, %L)::text$q$, tests.tid('a'), p_order, p_pay)) $$;

-- A. registering the account (operator only; no other kind of account)
select is(app.operator_register_billing_webhook('hook@system.test'), tests.uid('hook'), 'A1: the operator registers the billing webhook account');
select is(app.operator_register_billing_webhook('hook@system.test'), tests.uid('hook'), 'A2: again changes nothing');
select throws_ok($$select app.operator_register_billing_webhook('a_owner@test.local')$$, '42501', null, 'A3: a shop member cannot be it');
select throws_ok($$select app.operator_register_billing_webhook('staffer@system.test')$$, '42501', null, 'A4: nor a staff account');
select throws_ok($$select app.operator_register_billing_webhook('sched@system.test')$$, '42501', null, 'A5: nor the scheduler');
select throws_ok($$select app.operator_register_billing_webhook('chan@system.test')$$, '42501', null, 'A6: nor a channel agent');
select throws_ok($$select app.operator_register_billing_webhook('nobody@system.test')$$, '23503', null, 'A7: the account must exist');
select is(pg_temp.sc('hook', $q$select app.operator_register_billing_webhook('hook2@system.test')::text$q$), 'ERR:42501', 'A8: nobody registers it through the API');
select is(pg_temp.sc('a_owner', $q$select app.is_billing_webhook()::text$q$), 'ERR:42501', 'A9: the check itself is not callable by a client');

-- B. settling an order
select is(pg_temp.mk('order_HOOK000001'), 'created', 'B0: an order of business A, waiting to be paid');
select is(pg_temp.settle('sched', 'order_HOOK000001', 'pay_HOOK000001'), 'ERR:42501', 'B1: the scheduler account cannot settle an order');
select is(pg_temp.settle('chan', 'order_HOOK000001', 'pay_HOOK000001'), 'ERR:42501', 'B2: nor a channel agent');
select is(pg_temp.settle('b_owner', 'order_HOOK000001', 'pay_HOOK000001'), 'ERR:42501', 'B3: nor another business''s Owner');
select is(pg_temp.settle('a_admin', 'order_HOOK000001', 'pay_HOOK000001'), 'ERR:42501', 'B4: nor an Admin of the same business');
select is(pg_temp.settle('anon', 'order_HOOK000001', 'pay_HOOK000001'), 'ERR:42501', 'B5: nor an anonymous caller');
select is(pg_temp.settle('staffer', 'order_HOOK000001', 'pay_HOOK000001'), 'ERR:42501', 'B6: nor staff');
select is(pg_temp.settle('hook2', 'order_HOOK000001', 'pay_HOOK000001'), 'ERR:42501', 'B7: nor an account that is not registered as the webhook');
select is((select status from pricing.orders where order_id = 'order_HOOK000001'), 'created', 'B8: after all the refusals the order is unpaid');
select is(pg_temp.j(pg_temp.settle('hook', 'order_HOOK000001', 'pay_HOOK000001'), 'settled'), 'true', 'B9: the billing webhook account settles it');
select is(pricing.balance_of(tests.tid('a')), 100000::bigint, 'B10: the wallet got the base amount');
select is(pg_temp.j(pg_temp.settle('hook', 'order_HOOK000001', 'pay_HOOK000001'), 'replayed'), 'true', 'B11: the same event again changes nothing');
select is(pg_temp.mk('order_HOOK000002'), 'created', 'B12: another order');
select is(pg_temp.j(pg_temp.settle('a_owner', 'order_HOOK000002', 'pay_HOOK000002'), 'settled'), 'true', 'B13: the business''s own Owner may still settle (the browser path, after the signature is checked)');

-- C. crediting a wallet from a payment, and the renewal events
select is(pg_temp.sc('sched', format($q$select public.pricing_topup_credit(%L, 'pay_HOOK000003', 5000)::text$q$, tests.tid('a'))), 'ERR:42501', 'C1: the scheduler account cannot credit a wallet from a payment');
select is(pg_temp.sc('chan', format($q$select public.pricing_topup_credit(%L, 'pay_HOOK000003', 5000)::text$q$, tests.tid('a'))), 'ERR:42501', 'C2: nor a channel agent');
select is(pg_temp.j(pg_temp.sc('hook', format($q$select public.pricing_topup_credit(%L, 'pay_HOOK000003', 5000)::text$q$, tests.tid('a'))), 'credited'), 'true', 'C3: the billing webhook account can');
select is(pg_temp.sc('hook', format($q$select public.pricing_provider_event(%L, 'evt_HOOK0001', 'charge_succeeded', 199900)::text$q$, tests.tid('a'))) like 'ERR:%', false, 'C4: and it applies the provider''s renewal events');
select is(pg_temp.sc('sched', format($q$select public.pricing_provider_event(%L, 'evt_HOOK0002', 'charge_succeeded', 199900)::text$q$, tests.tid('a'))) like 'ERR:%', false, 'C5: the scheduler may still apply renewal events (they move no money by themselves)');
select is(pg_temp.sc('b_owner', format($q$select public.pricing_provider_event(%L, 'evt_HOOK0003', 'charge_succeeded', 199900)::text$q$, tests.tid('a'))), 'ERR:42501', 'C6: a business''s Owner cannot');

-- D. privileges
select is((select count(*) from information_schema.table_privileges where table_schema = 'pricing' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'D1: no client role touches a pricing table (the new one included)');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('pricing_order_settle', 'pricing_topup_credit', 'pricing_provider_event') and p.prosecdef and p.proconfig @> array['search_path=""']), 3::bigint, 'D2: the three functions are security definer with a fixed, empty search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('pricing_order_settle', 'pricing_topup_credit', 'pricing_provider_event') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'D3: anon can execute none of them');

select * from finish();
rollback;
