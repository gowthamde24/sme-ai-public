-- Credits top-up through Razorpay (migrations 20261231992200 and 20261231992210): whole-rupee amounts, GST on top, a payment settles once (replay, a different payment, an amount that does not match), a failed or closed
-- payment is recorded and the order stays payable, invoices numbered per financial year without gaps (credit notes too), the buyer's and seller's details copied onto the invoice, CGST+SGST or IGST, top-up balance never
-- expires, the statement adds up, the staff refund of what is unused (reason, second factor, idempotent, restores on a provider refusal), and the low-balance item on Today.
begin;
select no_plan();
select tests.seed_two_tenants();
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@system.test', now(), jsonb_build_object('display_name', n), now(), now()
  from unnest(array['hook', 's_support', 's_finance']) n;
select app.operator_register_billing_webhook('hook@system.test');
select app.operator_register_staff('s_support@system.test', 'Anu Support', 'support');
select app.operator_register_staff('s_finance@system.test', 'Fay Finance', 'finance');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.oc(p_user text, p_tenant text, p_order text, p_amount bigint) returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.pricing_order_create(%L, %L, ''topup'', %s, null, null)::text', tests.tid(p_tenant), p_order, p_amount)) $$;
create function pg_temp.os(p_user text, p_tenant text, p_order text, p_pay text, p_paid text default 'null') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.pricing_order_settle(%L, %L, %L, %s)::text', tests.tid(p_tenant), p_order, p_pay, p_paid)) $$;
create function pg_temp.of(p_user text, p_order text, p_code text) returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.pricing_order_failed(%L, %L)::text', p_order, p_code)) $$;
-- a staff member's call: a token with the sign-in steps (a code entered p_age seconds ago)
create function pg_temp.st(p_user text, p_age integer, p_sql text) returns text language plpgsql as $$
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

-- A. the amount of a top-up: whole rupees between the minimum and the maximum; the GST is added on top
select is(pg_temp.oc('a_owner', 'a', 'order_RZP0000001', 100050), 'ERR:22023', 'A1: a top-up is a whole number of rupees (a credit is a rupee)');
select is(pg_temp.oc('a_owner', 'a', 'order_RZP0000001', 9900), 'ERR:22023', 'A2: under Rs 100 is refused');
select is(pg_temp.oc('a_owner', 'a', 'order_RZP0000001', 10000100), 'ERR:22023', 'A3: over Rs 1,00,000 is refused');
select is(pg_temp.oc('a_owner', 'a', 'order_RZP0000001', 0), 'ERR:22023', 'A4: nothing is refused');
select is(pg_temp.oc('a_admin', 'a', 'order_RZP0000001', 50000), 'ERR:42501', 'A5: only the Owner makes an order');
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_RZP0000001', 50000), 'total_paise'), '59000', 'A6: Rs 500 + 18 % GST = Rs 590');
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_RZP0000002', 100000), 'gst_paise'), '18000', 'A7: Rs 1,000: GST Rs 180, shown separately');
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_RZP0000003', 200000), 'total_paise'), '236000', 'A8: Rs 2,000 = Rs 2,360');
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_RZP0000004', 500000), 'total_paise'), '590000', 'A9: Rs 5,000 = Rs 5,900');
select is(pg_temp.j(pg_temp.oc('a_owner', 'a', 'order_RZP0000005', 33300), 'gst_paise'), '5994', 'A10: a custom Rs 333: GST Rs 59.94');

-- B. settling: the amount the provider says was paid must equal the order's total
select is(pg_temp.os('hook', 'a', 'order_RZP0000001', 'pay_RZP0000001', '58999'), pg_temp.os('hook', 'a', 'order_RZP0000001', 'pay_RZP0000001', '58999'), 'B0: the same refused call twice answers the same');
select is(pg_temp.j(pg_temp.os('hook', 'a', 'order_RZP0000001', 'pay_RZP0000001', '58999'), 'reason'), 'amount_mismatch', 'B1: Rs 589.99 was paid for a Rs 590 order: nothing is credited');
select is(pricing.balance_of(tests.tid('a')), 0::bigint, 'B2: the balance did not move');
select is((select failure_code from pricing.orders where order_id = 'order_RZP0000001'), 'amount_mismatch', 'B3: the order says why');
select is(pg_temp.j(pg_temp.os('hook', 'a', 'order_RZP0000001', 'pay_RZP0000001', '59000'), 'settled'), 'true', 'B4: the right amount settles it (the order stays payable)');
select is(pricing.balance_of(tests.tid('a')), 50000::bigint, 'B5: the BASE amount (Rs 500) is added, not the Rs 590');
select is((select count(*) from pricing.invoices where tenant_id = tests.tid('a')), 1::bigint, 'B6: one invoice');
select is((select total_paise from pricing.invoices where tenant_id = tests.tid('a') and kind = 'topup'), 59000::bigint, 'B7: the invoice is Rs 590 with the GST');
select is(pg_temp.os('a_sales', 'a', 'order_RZP0000002', 'pay_RZP0000002'), 'ERR:42501', 'B8: sales cannot settle');
select is(pg_temp.os('a_admin', 'a', 'order_RZP0000002', 'pay_RZP0000002'), 'ERR:42501', 'B9: nor an admin');
select is(pg_temp.os('hook', 'a', 'order_RZP0000002', 'pay_RZP0000002', '0'), 'ERR:22023', 'B10: an amount of nothing makes no sense');

-- C. replays and races: the same payment, another payment for a paid order, one payment for two orders
select is(pg_temp.j(pg_temp.os('hook', 'a', 'order_RZP0000001', 'pay_RZP0000001', '59000'), 'replayed'), 'true', 'C1: the same payment again (webhook after the browser): a replay');
select is(pg_temp.j(pg_temp.os('a_owner', 'a', 'order_RZP0000001', 'pay_RZP0000001'), 'replayed'), 'true', 'C2: and the browser after the webhook');
select is(pg_temp.j(pg_temp.os('hook', 'a', 'order_RZP0000001', 'pay_RZP0000009', '59000'), 'same_payment'), 'false', 'C3: a DIFFERENT payment for a paid order is not credited again (and is reported)');
select is((select count(*) from pricing.wallet_lots where tenant_id = tests.tid('a') and source = 'topup'), 1::bigint, 'C4: one lot, whatever the replays');
select is(pricing.balance_of(tests.tid('a')), 50000::bigint, 'C5: the balance is still Rs 500');
select is((select count(*) from pricing.invoices where tenant_id = tests.tid('a')), 1::bigint, 'C6: and still one invoice');
select is(pg_temp.os('hook', 'a', 'order_RZP0000002', 'pay_RZP0000001', '118000'), 'ERR:22023', 'C7: one payment id cannot settle a second order');
select is(pg_temp.os('hook', 'a', 'order_NOPE000001', 'pay_RZP0000010', '100'), 'ERR:23503', 'C8: an order we never made cannot be settled');
select is(pg_temp.os('hook', 'b', 'order_RZP0000002', 'pay_RZP0000011', '118000'), 'ERR:23503', 'C9: and not by naming another business');

-- D. a payment that failed or was closed
select is(pg_temp.j(pg_temp.of('a_owner', 'order_RZP0000002', 'dismissed'), 'recorded'), 'true', 'D1: the Owner records that the checkout was closed');
select is((select status || '/' || failure_code from pricing.orders where order_id = 'order_RZP0000002'), 'failed/dismissed', 'D2: the order says failed and why');
select is(pg_temp.j(pg_temp.of('hook', 'order_RZP0000002', 'bank_declined'), 'recorded'), 'true', 'D3: the webhook records a decline by order id alone');
select is(pg_temp.j(pg_temp.of('hook', 'order_NOPE000001', 'payment_failed'), 'reason'), 'unknown_order', 'D4: an unknown order is answered and ignored (no retry storm)');
select is(pg_temp.j(pg_temp.of('b_owner', 'order_RZP0000002', 'payment_failed'), 'reason'), 'unknown_order', 'D5: another business''s Owner learns nothing about it');
select is(pg_temp.j(pg_temp.of('a_sales', 'order_RZP0000002', 'payment_failed'), 'reason'), 'unknown_order', 'D6: nor can sales record it');
select is(pg_temp.of('a_owner', 'order_RZP0000002', 'Bad Code!'), 'ERR:22023', 'D7: the code is a plain word');
select is(pg_temp.j(pg_temp.of('hook', 'order_RZP0000001', 'payment_failed'), 'reason'), 'already_paid', 'D8: a paid order is never marked failed');
select is(pg_temp.j(pg_temp.os('hook', 'a', 'order_RZP0000002', 'pay_RZP0000002', '118000'), 'settled'), 'true', 'D9: a failed order can still be paid later (the customer retried in the same checkout)');
select is((select status || '/' || coalesce(failure_code, 'none') from pricing.orders where order_id = 'order_RZP0000002'), 'paid/none', 'D10: paid, the failure word is gone');
select is(pricing.balance_of(tests.tid('a')), 150000::bigint, 'D11: Rs 500 + Rs 1,000');
select is(jsonb_array_length(pg_temp.sc('a_owner', format('select public.pricing_topup_orders(%L, 20)::text', tests.tid('a')))::jsonb)::bigint, 5::bigint, 'D12: the top-up list shows every order');
select is(pg_temp.sc('a_owner', format('select (public.pricing_topup_orders(%L, 20) -> 0 ->> ''state'')', tests.tid('a'))), 'pending', 'D13: an order made a moment ago and not paid is pending');
select is(pg_temp.sc('a_sales', format('select public.pricing_topup_orders(%L, 20)::text', tests.tid('a'))), 'ERR:42501', 'D14: sales does not see top-ups');
update pricing.orders set created_at = now() - interval '3 hours' where order_id = 'order_RZP0000003';
select is((select e ->> 'state' from jsonb_array_elements(pg_temp.sc('a_owner', format('select public.pricing_topup_orders(%L, 20)::text', tests.tid('a')))::jsonb) e where e ->> 'order_id' = 'order_RZP0000003'), 'abandoned', 'D15: an unpaid order older than an hour is abandoned');

-- E. invoices: per financial year, gapless, details copied, GST split
select is(pricing.fy_of('2027-03-31 10:00:00+00'), '2627', 'E1: 31 March 2027 (India) is in 2026-27');
select is(pricing.fy_of('2027-03-31 20:00:00+00'), '2728', 'E2: 1 April 2027 01:30 India is the first moment of 2027-28');
select is(pricing.fy_of('2026-01-15 00:00:00+00'), '2526', 'E3: January 2026 is in 2025-26');
select is((select array_agg(number order by issued_at, number) from pricing.invoices where tenant_id = tests.tid('a')), array['S19-' || pricing.fy_of(now()) || '-000001', 'S19-' || pricing.fy_of(now()) || '-000002'], 'E4: numbered one after the other in the year');
select is((select length(number) <= 16 from pricing.invoices limit 1), true, 'E5: at most 16 characters (GST rule 46)');
select pricing.invoice(tests.tid('b'), 'topup', 'pay_OTHERFY0001', 100000);
select is((select number from pricing.invoices where ref = 'pay_OTHERFY0001'), 'S19-' || pricing.fy_of(now()) || '-000003', 'E6: one series for all businesses, no number twice');
select is((select last_no from pricing.invoice_counters where series = 'INV' and fy = pricing.fy_of(now())), 3, 'E7: the counter counts the invoices written');
select pricing.invoice(tests.tid('b'), 'topup', 'pay_OTHERFY0001', 100000);
select is((select last_no from pricing.invoice_counters where series = 'INV' and fy = pricing.fy_of(now())), 3, 'E8: asking again for the same payment writes and counts nothing');
do $$ begin
  begin
    perform pricing.invoice(tests.tid('b'), 'topup', 'pay_ROLLED0001', 100000);
    raise exception 'the payment failed after the invoice';
  exception when raise_exception then null;
  end;
end $$;
select is((select last_no from pricing.invoice_counters where series = 'INV' and fy = pricing.fy_of(now())), 3, 'E9: a payment that rolled back leaves no hole in the numbers');
select pricing.invoice(tests.tid('b'), 'topup', 'pay_ROLLED0002', 100000);
select is((select number from pricing.invoices where ref = 'pay_ROLLED0002'), 'S19-' || pricing.fy_of(now()) || '-000004', 'E10: the next number follows without a gap');
-- the buyer's and the seller's details; the tax split
select is((select buyer_name from pricing.invoices where ref = 'pay_RZP0000001'), (select name from public.tenants where id = tests.tid('a')), 'E11: the workspace name is copied onto the invoice');
select is((select seller_gstin is null and tax_split is null and cgst_paise + sgst_paise + igst_paise = 0 from pricing.invoices where ref = 'pay_RZP0000001'), true, 'E12: no seller GSTIN set yet: no tax split is made up');
update pricing.settings set seller_name = 'Stack19 Test Pvt Ltd', seller_gstin = '27AAPFU0939F1ZV', seller_address = '1 Test Road, Mumbai 400001', seller_sac = '998439';
insert into public.business_profile (tenant_id, gstin) values (tests.tid('a'), '29AAGCB7383J1Z4');
select pricing.invoice(tests.tid('a'), 'topup', 'pay_SPLIT0000001', 100000);
select is((select tax_split || '/' || igst_paise || '/' || cgst_paise from pricing.invoices where ref = 'pay_SPLIT0000001'), 'igst/18000/0', 'E13: a Karnataka buyer from a Maharashtra seller: IGST 18 %');
select is((select buyer_gstin || '/' || buyer_state_code || '/' || seller_gstin || '/' || seller_sac from pricing.invoices where ref = 'pay_SPLIT0000001'), '29AAGCB7383J1Z4/29/27AAPFU0939F1ZV/998439', 'E14: the GSTINs and the SAC are copied');
update public.business_profile set gstin = '27AAPFU0939F1ZV' where tenant_id = tests.tid('a');
select pricing.invoice(tests.tid('a'), 'topup', 'pay_SPLIT0000002', 33300);
select is((select tax_split || '/' || cgst_paise || '/' || sgst_paise || '/' || igst_paise from pricing.invoices where ref = 'pay_SPLIT0000002'), 'cgst_sgst/2997/2997/0', 'E15: the same state: CGST 9 % + SGST 9 % (Rs 59.94 = 29.97 + 29.97)');
select pricing.invoice(tests.tid('b'), 'topup', 'pay_SPLIT0000003', 100000);
select is((select tax_split || '/' || igst_paise from pricing.invoices where tenant_id = tests.tid('b') and ref = 'pay_SPLIT0000003'), 'cgst_sgst/0', 'E16: a buyer with no GSTIN is taken to be in the seller''s state (CGST + SGST)');
select is((select cgst_paise || '/' || sgst_paise from pricing.invoices where tenant_id = tests.tid('b') and ref = 'pay_SPLIT0000003'), '9000/9000', 'E17: Rs 1,000: CGST Rs 90 + SGST Rs 90');
select is(pg_temp.sc('a_owner', format($q$select (public.pricing_invoice_detail(%L, 'S19-%s-000001') ->> 'total_paise')$q$, tests.tid('a'), pricing.fy_of(now()))), '59000', 'E18: the Owner reads one invoice in full');
select is(pg_temp.sc('a_sales', format($q$select public.pricing_invoice_detail(%L, 'S19-%s-000001')::text$q$, tests.tid('a'), pricing.fy_of(now()))), 'ERR:42501', 'E19: sales does not');
select is(pg_temp.sc('b_owner', format($q$select public.pricing_invoice_detail(%L, 'S19-%s-000001')::text$q$, tests.tid('b'), pricing.fy_of(now()))), 'ERR:23503', 'E20: another business''s invoice is not found');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_invoice_detail(%L, 'x')::text$q$, tests.tid('a'))), 'ERR:22023', 'E21: a malformed number is refused');

-- F. top-up balance never expires; the free start still carries its days
select is((select min(expires_at) > now() + interval '30000 days' from pricing.wallet_lots where tenant_id = tests.tid('a') and source = 'topup'), true, 'F1: a top-up never expires');
select pricing.credit(tests.tid('b'), 'free_start', 'free_start', 5000);
select is((select expires_at < now() + interval '100 days' from pricing.wallet_lots where tenant_id = tests.tid('b') and source = 'free_start'), true, 'F2: the free start still expires');

-- G. the statement adds up
update pricing.wallet_lots set expires_at = now() + interval '36000 days' where tenant_id = tests.tid('a') and ref = 'pay_RZP0000001';   -- drawn first
select pricing.spend(tests.tid('a'), 30000);
insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (tests.tid('a'), 'call', tests.rid('a_call1'), 120, 0, 30000, 0);
select is((pg_temp.sc('a_owner', format('select public.pricing_statement(%L)::text', tests.tid('a')))::jsonb ->> 'closing_paise'), pricing.balance_of(tests.tid('a'))::text, 'G1: the statement closes at the balance');
select is((pg_temp.sc('a_owner', format('select public.pricing_statement(%L)::text', tests.tid('a')))::jsonb -> 'items' -> 0 ->> 'balance_after_paise'), pricing.balance_of(tests.tid('a'))::text, 'G2: the newest line carries the balance after it');
select is(jsonb_array_length(pg_temp.sc('a_owner', format('select (public.pricing_statement(%L)::jsonb -> ''items'')::text', tests.tid('a')))::jsonb)::bigint, 3::bigint, 'G3: two top-ups and one call: three lines');
select is(pg_temp.sc('a_owner', format('select (public.pricing_statement(%L, null, null, 2) ->> ''has_more'')', tests.tid('a'))), 'true', 'G4: paged: more lines to come');
select is(pg_temp.sc('a_owner', format('select jsonb_array_length(public.pricing_statement(%L, null, null, 2) -> ''items'')::text', tests.tid('a'))), '2', 'G5: the page holds its limit');
select is(pg_temp.sc('a_owner', format('select (public.pricing_statement(%L, current_date + 2, current_date + 3) ->> ''opening_paise'')', tests.tid('a'))), pricing.balance_of(tests.tid('a'))::text, 'G6: a later range opens at the balance and has no lines');
select is(pg_temp.sc('a_sales', format('select public.pricing_statement(%L)::text', tests.tid('a'))), 'ERR:42501', 'G7: sales does not see the statement');
select is(pg_temp.sc('a_owner', format('select public.pricing_statement(%L, current_date, current_date - 1)::text', tests.tid('a'))), 'ERR:22023', 'G8: the end before the start is refused');
select is((select e ->> 'invoice_number' from jsonb_array_elements((pg_temp.sc('a_owner', format('select public.pricing_statement(%L)::text', tests.tid('a')))::jsonb) -> 'items') e where e ->> 'ref' = 'pay_RZP0000001'), 'S19-' || pricing.fy_of(now()) || '-000001', 'G9: a top-up line names its invoice');

-- H. the refund of what is unused (staff: owner and finance; a reason; a fresh second factor; idempotent)
create function pg_temp.rb(p_user text, p_age integer, p_order text, p_reason text, p_text text, p_key text) returns text language sql as $$
  select pg_temp.st(p_user, p_age, format('select public.admin_topup_refund_begin(%L, %L, %L, %L, %L)::text', tests.tid('a'), p_order, p_reason, p_text, p_key)) $$;
select is(pg_temp.rb('a_owner', 10, 'order_RZP0000002', 'customer_asked', 'asked for it', 'refund-key-0001'), 'ERR:SM941', 'H1: a shop owner is not staff');
select is(pg_temp.rb('s_support', 10, 'order_RZP0000002', 'customer_asked', 'asked for it', 'refund-key-0001'), 'ERR:42501', 'H2: support refunds nothing');
select is(pg_temp.rb('s_finance', 10, 'order_RZP0000002', 'customer_asked', '', 'refund-key-0001'), 'ERR:SM946', 'H3: money needs a reason in words');
select is(pg_temp.rb('s_finance', 900, 'order_RZP0000002', 'customer_asked', 'asked for it', 'refund-key-0001'), 'ERR:SM948', 'H4: a fresh authenticator code is needed');
select is(pg_temp.rb('s_finance', 10, 'order_RZP0000002', 'customer_asked', 'asked for it', 'short'), 'ERR:22023', 'H5: the idempotency key has a shape');
select is(pg_temp.rb('s_finance', 10, 'order_NOPE000001', 'customer_asked', 'asked for it', 'refund-key-0002'), 'ERR:SM938', 'H6: an order that is not a paid top-up of that business');
-- order 2 (Rs 1,000 + GST) is partly used? no: the spend of Rs 300 went to the oldest-expiring lot; both top-ups never expire, so the older lot was drawn first
select is(pg_temp.j(pg_temp.rb('s_finance', 10, 'order_RZP0000002', 'customer_asked', 'asked for it', 'refund-key-0003'), 'credits_reversed_paise'), '100000', 'H7: nothing of the Rs 1,000 top-up was used: all of it is refundable');
select is(pg_temp.j(pg_temp.rb('s_finance', 10, 'order_RZP0000002', 'customer_asked', 'asked for it', 'refund-key-0003'), 'refund_paise'), '118000', 'H8: with its GST: Rs 1,180 goes back');
select is(pg_temp.j(pg_temp.rb('s_finance', 10, 'order_RZP0000002', 'customer_asked', 'asked for it', 'refund-key-0003'), 'replayed'), 'true', 'H9: the same key again answers the same refund');
select is(pg_temp.rb('s_finance', 10, 'order_RZP0000002', 'customer_asked', 'asked for it', 'refund-key-0004'), 'ERR:SM937', 'H10: a second refund of the same top-up is refused');
select is(pricing.balance_of(tests.tid('a')), 120000::bigint - 100000, 'H11: the refunded balance is out of the wallet at once (Rs 1,500 - Rs 300 used - Rs 1,000 refunded)');
select is((select status from pricing.refunds where idem_key = 'refund-key-0003'), 'pending', 'H12: pending until the provider answers');
create function pg_temp.rf(p_user text, p_id uuid, p_ok boolean, p_ref text) returns text language sql as $$
  select pg_temp.st(p_user, 10, format('select public.admin_topup_refund_finish(%L, %L, %L)::text', p_id, p_ok, p_ref)) $$;
select is(pg_temp.rf('s_support', (select id from pricing.refunds where idem_key = 'refund-key-0003'), true, 'rfnd_RZP0000001'), 'ERR:42501', 'H13: support cannot finish a refund');
select is(pg_temp.j(pg_temp.rf('s_finance', (select id from pricing.refunds where idem_key = 'refund-key-0003'), true, 'rfnd_RZP0000001'), 'status'), 'done', 'H14: the provider refunded: done');
select is((select credit_note_number from pricing.refunds where idem_key = 'refund-key-0003'), 'C19-' || pricing.fy_of(now()) || '-000001', 'H15: a credit note, numbered in its own series');
select is((select against_number || '/' || total_paise || '/' || subtotal_paise from pricing.invoices where kind = 'credit_note'), (select number from pricing.invoices where ref = 'pay_RZP0000002' and kind = 'topup') || '/118000/100000', 'H16: it reduces the invoice of that top-up: Rs 1,000 + Rs 180');
select is(pg_temp.j(pg_temp.rf('s_finance', (select id from pricing.refunds where idem_key = 'refund-key-0003'), true, 'rfnd_RZP0000001'), 'replayed'), 'true', 'H17: finishing again changes nothing');
select is(pg_temp.rb('s_finance', 10, 'order_RZP0000001', 'customer_asked', 'asked for it', 'refund-key-0005') like '%"credits_reversed_paise": 20000%', true, 'H18: Rs 300 of the Rs 500 top-up was used: the unused Rs 200 goes back (the earlier lot is drawn first)');
select is(pg_temp.j(pg_temp.rb('s_finance', 10, 'order_RZP0000001', 'customer_asked', 'asked for it', 'refund-key-0005'), 'refund_paise'), '23600', 'H19: Rs 200 + Rs 36 GST = Rs 236');
select is(pg_temp.j(pg_temp.rf('s_finance', (select id from pricing.refunds where idem_key = 'refund-key-0005'), false, null), 'status'), 'failed', 'H20: the provider refused: failed');
select is(pricing.balance_of(tests.tid('a')), 20000::bigint, 'H21: and the unused Rs 200 is back in the wallet');
select is((select count(*) from pricing.invoices where kind = 'credit_note'), 1::bigint, 'H22: a refused refund writes no credit note');
select is(pg_temp.j(pg_temp.rb('s_finance', 10, 'order_RZP0000001', 'customer_asked', 'asked for it', 'refund-key-0006'), 'status'), 'pending', 'H23: after a refusal the order can be tried again');
select is((select count(*) from admin.audit where action = 'refund'), 3::bigint, 'H24: every attempt is in the staff audit (a replay is not a new attempt)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action like 'billing.topup_refund%'), 5::bigint, 'H25: and in the workspace''s audit trail (three starts, one refunded, one failed)');
select is((select count(*) from jsonb_array_elements(pg_temp.sc('a_owner', format('select (public.pricing_statement(%L)::jsonb -> ''items'')::text', tests.tid('a')))::jsonb) e where e ->> 'kind' = 'refund'), 2::bigint, 'H26: the refunds are lines of the statement');
select is((pg_temp.sc('a_owner', format('select public.pricing_statement(%L)::text', tests.tid('a')))::jsonb ->> 'closing_paise'), pricing.balance_of(tests.tid('a'))::text, 'H27: and the statement still closes at the balance');

-- I. Today "Needs you": the balance is almost used up
create function pg_temp.low(p_user text, p_tenant text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format($q$select exists (select 1 from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') e where e ->> 'kind' = 'credits_low' and e -> 'target' ->> 'type' = 'billing')::text$q$, tests.tid(p_tenant)));
exception when others then return 'ERR:' || sqlstate;
end $$;
select is(pg_temp.low('b_owner', 'b'), 'false', 'I1: Rs 50 of free start is 10 minutes: not low');
update pricing.wallet_lots set remaining_paise = 1999 where tenant_id = tests.tid('b') and source = 'free_start';
update pricing.wallet_lots set remaining_paise = 0 where tenant_id = tests.tid('b') and source = 'topup';
select is(pg_temp.low('b_owner', 'b'), 'true', 'I2: under 4 minutes (Rs 19.99 at Rs 5 a minute): the Owner sees it');
select is(pg_temp.low('a_sales', 'a'), 'false', 'I3: sales does not');
select is(pg_temp.low('b_owner', 'a'), 'ERR:42501', 'I4: and nobody asks about another business');
update pricing.wallet_lots set remaining_paise = 2000 where tenant_id = tests.tid('b') and source = 'free_start';
select is(pg_temp.low('b_owner', 'b'), 'false', 'I5: exactly 4 minutes is not low');
update pricing.wallet_lots set remaining_paise = 1000 where tenant_id = tests.tid('b') and source = 'free_start';
select is(pg_temp.low('b_owner', 'b'), 'true', 'I6: low again');
select pricing.credit(tests.tid('b'), 'topup', 'pay_LOW0000001', 50000);
select is(pg_temp.low('b_owner', 'b'), 'false', 'I7: a top-up makes it go by itself');
update pricing.wallet_lots set remaining_paise = 0 where tenant_id = tests.tid('b');
insert into pricing.subscriptions (tenant_id, plan_id, interval, status, provider, period_start, period_end) values (tests.tid('b'), 'sales_assistant', 'monthly', 'active', 'fake', now() - interval '1 day', now() + interval '29 days');
select is(pg_temp.low('b_owner', 'b'), 'false', 'I8: included minutes left: calls are covered, not low');

-- J. nothing is open to the wrong people
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('pricing_order_failed', 'pricing_topup_orders', 'pricing_invoice_detail', 'pricing_statement', 'pricing_order_settle', 'admin_topup_refund_begin', 'admin_topup_refund_finish')
   and p.prosecdef and p.proconfig @> array['search_path=""']), 7::bigint, 'J1: seven new or changed functions, all security definer with an empty search path');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('pricing_order_failed', 'pricing_topup_orders', 'pricing_invoice_detail', 'pricing_statement', 'pricing_order_settle', 'admin_topup_refund_begin', 'admin_topup_refund_finish')
   and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'J2: anonymous callers can run none of them');
select is((select count(*) from information_schema.table_privileges where table_schema = 'pricing' and table_name in ('refunds', 'invoice_counters') and grantee in ('anon', 'authenticated', 'service_role', 'public')), 0::bigint, 'J3: no client role has any privilege on the new tables');
select is((select count(*) from pg_class c where c.relnamespace = 'pricing'::regnamespace and c.relname in ('refunds', 'invoice_counters') and c.relrowsecurity and c.relforcerowsecurity), 2::bigint, 'J4: both new tables force row-level security');

select * from finish();
rollback;
