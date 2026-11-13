-- Billing v2 P1 (13 Nov 2026, the owner's final pricing): the catalogue, per-30-second billing, unanswered = 0, included minutes then the rate after them, the free start once, top-ups and GST, searches,
-- the order credits are spent in, shortfall, who may. The numbers are the owner's.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.bal(p_tenant text) returns text language sql as $$ select pricing.balance_of(tests.tid(p_tenant))::text $$;
create function pg_temp.chg(p_tenant text, p_id text, p_seconds integer, p_answered boolean) returns text language plpgsql as $$
declare
  v_sql text := format('select public.pricing_charge_call(%L, %L, %s, %L)::text', tests.tid(p_tenant), tests.rid(p_id), p_seconds, p_answered);
begin
  return pg_temp.sc('outsider', v_sql);
end $$;

-- A. the catalogue: the owner's numbers
select is((select monthly_paise::text || '/' || rate_paise_per_minute || '/' || included_minutes || '/' || numbers_included from pricing.plans where id = 'payg'), '49900/500/0/1', 'A1: pay as you go: Rs 499 a month, Rs 5 a minute');
select is((select monthly_paise::text || '/' || rate_paise_per_minute || '/' || included_minutes || '/' || numbers_included from pricing.plans where id = 'sales_assistant'), '199900/450/500/1', 'A2: Sales Assistant: Rs 1,999, 500 minutes, then Rs 4.50, number included');
select is((select monthly_paise::text || '/' || rate_paise_per_minute || '/' || included_minutes || '/' || numbers_included || '/' || lead_finder from pricing.plans where id = 'sales_lead_finder'), '599900/400/1500/3/true', 'A3: Sales Assistant + Lead Finder: Rs 5,999, 1,500 minutes, then Rs 4, up to 3 numbers');
select is((select count(*) from pricing.plans where yearly_paise = monthly_paise * 10), 3::bigint, 'A4: yearly is ten months'' price (two months free) on every plan');
select is(pg_temp.j(public.pricing_catalogue()::text, 'gst_percent'), '18.00', 'A5: GST is 18 percent');
select is((select free_start_paise from pricing.settings), 5000::bigint, 'A6: the free start is Rs 50');
select is(pg_temp.sc('a_viewer', $q$select public.pricing_catalogue()::text$q$) like '{%', true, 'A7: any signed-in user reads the catalogue');
select is(pg_temp.sc('anon', $q$select public.pricing_catalogue()::text$q$), 'ERR:42501', 'A7b: nobody signed out does');
select throws_ok($q$insert into pricing.plans values ('bad', 1, 'Bad', 1000, 9999, 0, 500, 1, false, 1, 4900, false)$q$, '23514', null, 'A8: a yearly price that is not ten months is refused');
select throws_ok($q$insert into pricing.plans values ('odd', 1, 'Odd', 1000, 10000, 0, 451, 1, false, 1, 4900, false)$q$, '23514', null, 'A9: a per-minute rate that cannot be split in two 30-second halves is refused');

-- B. the rules in pure form
select is(pricing.half_minutes_of(1, true) || '/' || pricing.half_minutes_of(30, true) || '/' || pricing.half_minutes_of(31, true) || '/' || pricing.half_minutes_of(60, true) || '/' || pricing.half_minutes_of(61, true), '1/1/2/2/3', 'B1: per 30 seconds: 1-30 s one unit, 31-60 s two, 61 s three');
select is(pricing.half_minutes_of(120, false) || '/' || pricing.half_minutes_of(0, true) || '/' || coalesce(pricing.half_minutes_of(null, true)::text, 'x'), '0/0/0', 'B2: an unanswered call, no seconds, no value: nothing to bill');
select is(pricing.gst_of(49900) || '/' || pricing.gst_of(199900) || '/' || pricing.gst_of(599900) || '/' || pricing.gst_of(125), '8982/35982/107982/23', 'B3: GST 18 percent rounded half up to the paisa (the three plans and 1.25)');
select is(pricing.prorate(199900, 599900, 15, 30) || '/' || pricing.prorate(599900, 199900, 15, 30) || '/' || pricing.prorate(199900, 599900, 0, 30), '200000/-200000/0', 'B4: changing plan mid-period: an upgrade charges the share left, a downgrade credits it, nothing on the last day');

-- C. the free start: once per workspace and once per verified phone
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_free_start_grant(%L, %L)::text$q$, tests.tid('a'), repeat('a', 64))), 'granted'), 'true', 'C1: the Owner gets the free Rs 50');
select is(pg_temp.bal('a'), '5000', 'C2: it is in the balance');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.pricing_free_start_grant(%L, %L)::text$q$, tests.tid('a'), repeat('a', 64))), 'reason'), 'already_granted', 'C3: only once per workspace');
select is(pg_temp.bal('a'), '5000', 'C4: and the balance did not grow');
select is(pg_temp.j(pg_temp.sc('b_owner', format($q$select public.pricing_free_start_grant(%L, %L)::text$q$, tests.tid('b'), repeat('a', 64))), 'reason'), 'phone_used', 'C5: the same verified phone cannot collect it for a second workspace');
select is(pg_temp.sc('a_sales', format($q$select public.pricing_free_start_grant(%L, null)::text$q$, tests.tid('a'))), 'ERR:42501', 'C6: only the Owner');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_free_start_grant(%L, 'not-a-hash')::text$q$, tests.tid('a'))), 'ERR:22023', 'C7: a hash that is not a hash is refused');
select is(pg_temp.j(pg_temp.sc('b_owner', format($q$select public.pricing_free_start_grant(%L, null)::text$q$, tests.tid('b'))), 'granted'), 'true', 'C8: a workspace with no phone to check still gets its one start');

-- D. top-ups and GST
select is(pg_temp.sc('a_owner', format($q$select public.pricing_topup_credit(%L, 'pay_TEST000000001', 100000)::text$q$, tests.tid('a'))), 'ERR:42501', 'D1: a top-up is credited by the system, never by the Owner');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_topup_credit(%L, 'pay_TEST000000001', 100000)::text$q$, tests.tid('a'))), 'credited'), 'true', 'D2: the payment provider''s signed event credits Rs 1,000');
select is(pg_temp.bal('a'), '105000', 'D3: balance Rs 1,050 (free Rs 50 + Rs 1,000)');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_topup_credit(%L, 'pay_TEST000000001', 100000)::text$q$, tests.tid('a'))), 'credited'), 'false', 'D4: WEBHOOK REPLAY: the same payment credits nothing twice');
select is(pg_temp.bal('a'), '105000', 'D5: balance unchanged');
select is((select subtotal_paise || '/' || gst_paise || '/' || total_paise from pricing.invoices where tenant_id = tests.tid('a') and ref = 'pay_TEST000000001'), '100000/18000/118000', 'D6: the invoice: Rs 1,000 + Rs 180 GST = Rs 1,180');
select is((select count(*) from pricing.invoices where tenant_id = tests.tid('a')), 1::bigint, 'D7: one invoice per payment, also on a replay');
select is((select number ~ '^S19-[0-9]{4}-[0-9]{6}$' from pricing.invoices where tenant_id = tests.tid('a')), true, 'D8: numbered');
select is(pg_temp.sc('outsider', format($q$select public.pricing_topup_credit(%L, 'x', 5)::text$q$, tests.tid('a'))), 'ERR:22023', 'D9: a payment ref or an amount that makes no sense is refused');

-- E. calls on pay as you go (no subscription): Rs 5 a minute, per 30 seconds
select is(pg_temp.j(pg_temp.chg('a', 'c1', 100, true), 'charged_paise'), '1000', 'E1: 100 s answered = 4 units of 30 s = Rs 10 at Rs 5 a minute');
select is(pg_temp.bal('a'), '104000', 'E2: taken from the balance');
select is(pg_temp.j(pg_temp.chg('a', 'c1', 100, true), 'replayed'), 'true', 'E3: the same call reported twice is charged once');
select is(pg_temp.bal('a'), '104000', 'E4: balance unchanged');
select is(pg_temp.j(pg_temp.chg('a', 'c2', 30, true), 'charged_paise'), '250', 'E5: 30 s = one unit = Rs 2.50');
select is(pg_temp.j(pg_temp.chg('a', 'c3', 31, true), 'charged_paise'), '500', 'E6: 31 s = two units = Rs 5');
select is(pg_temp.j(pg_temp.chg('a', 'c4', 300, false), 'charged_paise'), '0', 'E7: UNANSWERED CALLS ARE FREE');
select is(pg_temp.bal('a'), '103250', 'E8: balance after Rs 10 + 2.50 + 5 = Rs 17.50 taken');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_charge_call(%L, %L, 60, true)::text$q$, tests.tid('a'), tests.rid('c9'))), 'ERR:42501', 'E9: only the system reports a call');
select is(pg_temp.sc('outsider', format($q$select public.pricing_can_start_call(%L)::text$q$, tests.tid('a')))::jsonb ->> 'allowed', 'true', 'E10: with a balance a call may start');

-- F. included minutes first, then the plan''s rate
insert into pricing.subscriptions (tenant_id, plan_id, interval, status, provider, provider_ref, period_start, period_end) values (tests.tid('a'), 'sales_assistant', 'monthly', 'active', 'fake', 'sub_fake_1', now() - interval '2 days', now() + interval '28 days');
select is(pg_temp.j(pg_temp.chg('a', 'c10', 600, true), 'charged_paise'), '0', 'F1: Sales Assistant: 10 minutes are inside the 500 included, Rs 0');
select is(pg_temp.j(pg_temp.chg('a', 'c10', 600, true), 'included_half'), '20', 'F2: and they are counted as 20 half-minutes of the included');
insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise) values (tests.tid('a'), 'call', tests.rid('filler'), 979, 979, 0);   -- 999 of 1,000 half-minutes used
select is(pg_temp.j(pg_temp.chg('a', 'c11', 90, true), 'included_half'), '1', 'F3: 3 units with 1 half-minute of the included left: 1 included');
select is(pg_temp.j(pg_temp.chg('a', 'c12', 90, true), 'charged_paise'), '675', 'F4: then 3 units at half of Rs 4.50 = Rs 2.25 each = Rs 6.75');
select is(pg_temp.bal('a'), (103250 - 450 - 675)::text, 'F5: only the paid units left the balance (c11: 2 paid units = Rs 4.50, c12: 3 = Rs 6.75)');
update pricing.subscriptions set plan_id = 'sales_lead_finder' where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.chg('a', 'c13', 3000, true), 'charged_paise'), '0', 'F6: Sales Assistant + Lead Finder: 1,500 included minutes cover a 50-minute call');
update pricing.subscriptions set plan_id = 'payg' where tenant_id = tests.tid('a');

-- G. shortfall and the order credits are spent in
insert into public.tenants (id, name, slug) values (tests.rid('g_tenant'), 'G Shop', 'g-shop-test');
insert into pricing.wallet_lots (tenant_id, source, ref, amount_paise, remaining_paise, created_at, expires_at) values
  (tests.rid('g_tenant'), 'topup', 'later_lot', 1000, 1000, now(), now() + interval '60 days'),
  (tests.rid('g_tenant'), 'topup', 'sooner_lot', 1000, 1000, now(), now() + interval '10 days'),
  (tests.rid('g_tenant'), 'topup', 'gone_lot', 5000, 5000, now() - interval '100 days', now() - interval '10 days');
select is(pricing.balance_of(tests.rid('g_tenant'))::text, '2000', 'G1: an expired lot is not in the balance');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_charge_call(%L, %L, 60, true)::text$q$, tests.rid('g_tenant'), tests.rid('g1'))), 'charged_paise'), '500', 'G2: a one-minute call on pay as you go');
select is((select remaining_paise::text from pricing.wallet_lots where ref = 'sooner_lot' and tenant_id = tests.rid('g_tenant')) || '/' || (select remaining_paise::text from pricing.wallet_lots where ref = 'later_lot' and tenant_id = tests.rid('g_tenant')), '500/1000', 'G3: the credit that expires first is spent first');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_charge_call(%L, %L, 1800, true)::text$q$, tests.rid('g_tenant'), tests.rid('g2'))), 'shortfall_paise'), '13500', 'G4: a 30-minute call (Rs 150) with Rs 15 left: the Rs 15 is spent and the other Rs 135 is the shortfall');
select is(pricing.balance_of(tests.rid('g_tenant'))::text, '0', 'G5: the balance floors at zero, never below');
select is(pg_temp.sc('outsider', format($q$select public.pricing_can_start_call(%L)::text$q$, tests.rid('g_tenant')))::jsonb ->> 'allowed', 'false', 'G6: with nothing left a call may not start (the lead is queued by the caller, not lost)');

-- H. Lead Finder searches
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_charge_search(%L, %L)::text$q$, tests.tid('a'), tests.rid('s1'))), 'free'), 'true', 'H1: the first search of the month is free');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_charge_search(%L, %L)::text$q$, tests.tid('a'), tests.rid('s2'))), 'charged_paise'), '4900', 'H2: the second costs Rs 49 on pay as you go');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_charge_search(%L, %L)::text$q$, tests.tid('a'), tests.rid('s2'))), 'replayed'), 'true', 'H3: the same search twice is charged once');
update pricing.subscriptions set plan_id = 'sales_lead_finder' where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.pricing_charge_search(%L, %L)::text$q$, tests.tid('a'), tests.rid('s3'))), 'charged_paise'), '0', 'H4: with Lead Finder searches are unlimited (fair use)');
insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise) select tests.tid('a'), 'search', gen_random_uuid(), 0, 0, 0 from generate_series(1, 300);
select is(pg_temp.sc('outsider', format($q$select public.pricing_charge_search(%L, %L)::text$q$, tests.tid('a'), tests.rid('s4'))), 'ERR:SM992', 'H5: beyond the fair-use number it stops (SM992), it does not silently charge');

-- I. who may read
select is(pg_temp.j(pg_temp.sc('a_viewer', format($q$select public.pricing_balance(%L)::text$q$, tests.tid('a'))), 'plan_id'), 'sales_lead_finder', 'I1: any member reads the balance and plan');
select is(pg_temp.sc('b_owner', format($q$select public.pricing_balance(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'I2: another business cannot');
select is(pg_temp.sc('anon', format($q$select public.pricing_balance(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'I3: nor anyone signed out');
select is((select count(*) from information_schema.table_privileges where table_schema = 'pricing' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'I4: no client role touches a pricing table');
select is(has_schema_privilege('authenticated', 'pricing', 'usage'), false, 'I5: nor the schema');

select * from finish();
rollback;
