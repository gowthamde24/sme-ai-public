-- Pricing v3: the business numbers. One is included on every plan; each extra is Rs 299 a month from the wallet, any count; a number the business gives back is held 30 days and can be taken back;
-- an extra number whose month is up is renewed from the wallet or put on hold; a held number whose 30 days are over is let go. Who may.
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
create function pg_temp.take(p_user text, p_tenant text, p_number text) returns text language sql as
$$ select pg_temp.sc(p_user, format($q$select public.pricing_v3_number_taken(%L, %L)::text$q$, tests.tid(p_tenant), p_number)) $$;
create function pg_temp.rel(p_user text, p_tenant text, p_number text) returns text language sql as
$$ select pg_temp.sc(p_user, format($q$select public.pricing_v3_number_released(%L, %L)::text$q$, tests.tid(p_tenant), p_number)) $$;
create function pg_temp.back(p_user text, p_tenant text, p_number text) returns text language sql as
$$ select pg_temp.sc(p_user, format($q$select public.pricing_v3_number_reclaim(%L, %L)::text$q$, tests.tid(p_tenant), p_number)) $$;
create function pg_temp.renew(p_tenant text) returns text language sql as
$$ select pg_temp.sc('outsider', format($q$select public.pricing_v3_numbers_renew(%L)::text$q$, tests.tid(p_tenant))) $$;
create temp table orig_plan as select plan from public.tenants where id = tests.tid('a');

select pricing.credit(tests.tid('a'), 'topup', 'pay_V3NUM000001', 100000);   -- Rs 1,000

-- A. one included, the rest Rs 299 a month
select is(pg_temp.j(pg_temp.take('a_owner', 'a', '+918012345601'), 'extra') || '/' || pg_temp.j(pg_temp.take('a_owner', 'a', '+918012345601'), 'charged_paise'), 'false/0', 'A1: the first number is included on the plan: Rs 0');
select is(pg_temp.j(pg_temp.take('a_owner', 'a', '+918012345601'), 'replayed'), 'true', 'A2: recording it twice changes nothing');
select is(pg_temp.j(pg_temp.take('a_owner', 'a', '+918012345602'), 'extra') || '/' || pg_temp.j(pg_temp.take('a_owner', 'a', '+918012345602'), 'charged_paise'), 'true/0', 'A3: the second is an extra number (its first month is taken once: the repeat is a replay)');
select is(pg_temp.bal('a'), '70100', 'A4: Rs 299 left the wallet once (Rs 1,000 - Rs 299 = Rs 701)');
select is((select charged_paise from pricing.usage where tenant_id = tests.tid('a') and kind = 'number'), 29900::bigint, 'A5: recorded as a usage line of the numbers');
select is(pg_temp.j(pg_temp.take('a_owner', 'a', '+918012345603'), 'charged_paise'), '29900', 'A6: a third: Rs 299 again (any count)');
select is((pg_temp.sc('a_owner', format($q$select public.pricing_v3_wallet(%L)::text$q$, tests.tid('a')))::jsonb #>> '{lines,numbers,extra}') || '/' || (pg_temp.sc('a_owner', format($q$select public.pricing_v3_wallet(%L)::text$q$, tests.tid('a')))::jsonb #>> '{lines,numbers,active}'), '2/3', 'A7: the wallet counts three numbers, two of them extra');
select is(pg_temp.take('a_owner', 'a', 'not-a-number'), 'ERR:22023', 'A8: a number that is not a number is refused');
select is(pg_temp.take('a_sales', 'a', '+918012345604'), 'ERR:42501', 'A9: only the Owner');
select is(pg_temp.take('b_owner', 'a', '+918012345604'), 'ERR:42501', 'A10: not another business''s Owner');

-- B. the wallet must pay, and the Owner's limit holds
select is(pg_temp.take('b_owner', 'b', '+918012345611') like '%"extra": false%', true, 'B1: another business: its first number is included');
select is(pg_temp.take('b_owner', 'b', '+918012345612'), 'ERR:SM994', 'B2: an extra number with an empty wallet is refused (SM994): the business is never in debt for a number');
select is((select count(*) from pricing.number_rentals where tenant_id = tests.tid('b')), 1::bigint, 'B3: and nothing was recorded');
select pricing.credit(tests.tid('b'), 'topup', 'pay_V3NUM000002', 100000);
select pg_temp.sc('b_owner', format($q$select public.pricing_v3_limit_set(%L, 'numbers', 20000)::text$q$, tests.tid('b')));
select is(pg_temp.take('b_owner', 'b', '+918012345612'), 'ERR:SM993', 'B4: a Rs 200 limit on numbers refuses a Rs 299 number (SM993)');
delete from pricing.feature_limits where tenant_id = tests.tid('b');

-- C. released: held 30 days, nothing more charged, taken back for free while the month is paid
select is(pg_temp.j(pg_temp.rel('a_owner', 'a', '+918012345602'), 'hold_until')::timestamptz between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour', true, 'C1: a released number is held for 30 days');
select is(pg_temp.j(pg_temp.rel('a_owner', 'a', '+918012345602'), 'replayed'), 'true', 'C2: releasing twice changes nothing');
select is((pg_temp.sc('a_owner', format($q$select public.pricing_v3_wallet(%L)::text$q$, tests.tid('a')))::jsonb #>> '{lines,numbers,active}'), '2', 'C3: it no longer counts as a number the business has');
select is(jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.pricing_v3_wallet(%L)::text$q$, tests.tid('a')))::jsonb #> '{lines,numbers,held}')::text, '1', 'C4: but the wallet lists it as held');
select is(pg_temp.rel('a_owner', 'a', '+918099999999'), 'ERR:23503', 'C5: a number that was never taken is not found');
select is(pg_temp.rel('a_viewer', 'a', '+918012345603'), 'ERR:42501', 'C6: only the Owner releases');
select is(pg_temp.j(pg_temp.back('a_owner', 'a', '+918012345602'), 'charged_paise'), '0', 'C7: taken back within the hold: the month it paid has not run out, so Rs 0');
select is(pg_temp.j(pg_temp.back('a_owner', 'a', '+918012345602'), 'replayed'), 'true', 'C8: taking it back twice changes nothing');
select pg_temp.rel('a_owner', 'a', '+918012345603');
update pricing.number_rentals set paid_until = now() - interval '1 day' where tenant_id = tests.tid('a') and number = '+918012345603';
select is(pg_temp.j(pg_temp.back('a_owner', 'a', '+918012345603'), 'charged_paise'), '29900', 'C9: a number whose paid month has run out is paid for again when taken back');
select pg_temp.rel('a_owner', 'a', '+918012345603');
update pricing.number_rentals set hold_until = now() - interval '1 hour' where tenant_id = tests.tid('a') and number = '+918012345603';
select is(pg_temp.back('a_owner', 'a', '+918012345603'), 'ERR:23503', 'C10: after the 30 days it can no longer be taken back');
select is(pg_temp.take('a_owner', 'a', '+918012345601') like '%"replayed": true%', true, 'C11: the included number is still there');

-- D. the month's tick
delete from pricing.number_rentals where tenant_id = tests.tid('a') and number = '+918012345603';
update pricing.number_rentals set paid_until = now() - interval '1 hour' where tenant_id = tests.tid('a') and number = '+918012345602';
select is(pg_temp.renew('a')::jsonb -> 'renewed' ->> 0, '+918012345602', 'D1: an extra number whose month is up takes Rs 299 again');
select is((select paid_until > now() + interval '27 days' from pricing.number_rentals where tenant_id = tests.tid('a') and number = '+918012345602'), true, 'D2: and is paid for another month');
select is(pg_temp.renew('a')::jsonb -> 'renewed', '[]'::jsonb, 'D3: nothing is due twice');
update pricing.number_rentals set paid_until = now() - interval '1 hour' where tenant_id = tests.tid('a') and number = '+918012345602';
update pricing.wallet_lots set remaining_paise = 100 where tenant_id = tests.tid('a');
select is(pg_temp.renew('a')::jsonb -> 'lapsed' ->> 0, '+918012345602', 'D4: a wallet that cannot pay puts the number on hold (it is not charged into debt)');
select is((select status from pricing.number_rentals where tenant_id = tests.tid('a') and number = '+918012345602'), 'held', 'D5: held for 30 days');
select is((select status from pricing.number_rentals where tenant_id = tests.tid('a') and number = '+918012345601'), 'active', 'D6: the included number is never touched');
update pricing.number_rentals set hold_until = now() - interval '1 minute' where tenant_id = tests.tid('a') and number = '+918012345602';
select is(pg_temp.renew('a')::jsonb -> 'let_go' ->> 0, '+918012345602', 'D7: a number whose hold has run out is let go (the caller gives it back at the provider)');
select is((select status from pricing.number_rentals where tenant_id = tests.tid('a') and number = '+918012345602'), 'gone', 'D8: and its row says gone');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_numbers_renew(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D9: only the system runs the tick');
select pricing.credit(tests.tid('a'), 'topup', 'pay_V3NUM000003', 100000);
select is(pg_temp.take('a_owner', 'a', '+918012345602') like '%"replayed": false%', true, 'D10: a number that was let go can be taken as a new one later');

-- E. free early access
update public.tenants set plan = 'early_access' where id = tests.tid('b');
select is(pg_temp.j(pg_temp.take('b_owner', 'b', '+918012345613'), 'charged_paise'), '0', 'E1: on free early access no number is charged (the number cap is the phone-line route''s)');
update public.tenants set plan = (select plan from orig_plan) where id = tests.tid('b');

select * from finish();
rollback;
