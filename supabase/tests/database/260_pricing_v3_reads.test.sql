-- Pricing v3 (the owner's plans and pricing of 19 Nov 2026), the reads: the catalogue (Pay as you go / Pro / Business and their numbers), billing v2's own rows untouched, the usage window, the gate,
-- the upgrade hint (Pay as you go = Pro at 300 minutes), the read-only state after an unpaid end, the wallet and who may read it.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.wallet(p_user text, p_tenant text) returns text language sql as $$ select pg_temp.sc(p_user, format($q$select public.pricing_v3_wallet(%L)::text$q$, tests.tid(p_tenant))) $$;
create function pg_temp.plan(p_tenant text, p_plan text) returns void language plpgsql as $$
begin
  insert into pricing.subscriptions (tenant_id, plan_id, interval, status, provider, provider_ref, period_start, period_end) values (tests.tid(p_tenant), p_plan, 'monthly', 'active', 'fake', 'sub_fake_' || p_tenant, now() - interval '2 days', now() + interval '28 days')
  on conflict (tenant_id) do update set plan_id = excluded.plan_id, interval = 'monthly', status = 'active', period_start = excluded.period_start, period_end = excluded.period_end, cancel_at_period_end = false;
end $$;
create function pg_temp.use(p_tenant text, p_kind text, p_half integer, p_incl integer, p_paise bigint, p_days_ago integer default 0) returns void language sql as $$
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, at) values (tests.tid(p_tenant), p_kind, gen_random_uuid(), p_half, p_incl, p_paise, now() - make_interval(days => p_days_ago)) $$;

-- A. the catalogue: the owner's numbers, under the owner's names
select is((select string_agg(api_id || '=' || name, ', ' order by sort) from pricing.plan_terms), 'payg=Pay as you go, pro=Pro, business=Business', 'A1: the three plans and their owner-facing names');
select is((select string_agg(p.monthly_paise::text, '/' order by t.sort) from pricing.plan_terms t join pricing.plans p on p.id = t.plan_id), '49900/199900/599900', 'A2: Rs 499 / Rs 1,999 / Rs 5,999 a month');
select is((select string_agg(p.yearly_paise::text, '/' order by t.sort) from pricing.plan_terms t join pricing.plans p on p.id = t.plan_id), '499000/1999000/5999000', 'A3: yearly = two months free on every plan');
select is((select string_agg(included_minutes::text, '/' order by sort) from pricing.plan_terms), '0/500/1500', 'A4: included minutes 0 / 500 / 1,500');
select is((select string_agg(distinct minute_paise::text, '/') from pricing.plan_terms), '500', 'A5: Rs 5 a minute on every plan (and for the extra minutes)');
select is((select string_agg(free_searches_month || '@' || search_paise, '/' order by sort) from pricing.plan_terms), '2@4900/10@3900/100@2900', 'A6: Lead Finder: 2 / 10 / 100 free searches, then Rs 49 / 39 / 29');
select is((select string_agg(p.numbers_included::text, '/' order by t.sort) from pricing.plan_terms t join pricing.plans p on p.id = t.plan_id where t.api_id in ('payg', 'pro')), '1/1', 'A7: one number included (Pay as you go, Pro)');
select is((select extra_number_paise::text || '/' || number_hold_days || '/' || warn_pct from pricing.settings_v3), '29900/30/80', 'A8: an extra number is Rs 299 a month, a released number is held 30 days, warnings start at 80 %');
select is((select popular from pricing.plan_terms where api_id = 'pro'), true, 'A9: Pro is the most popular');
select is((select onboarding from pricing.plan_terms where api_id = 'business'), 'priority', 'A10: Business has priority onboarding');
select is(pg_temp.j(pg_temp.sc('a_viewer', $q$select public.pricing_v3_catalogue()::text$q$), 'payg_to_pro_minutes'), '300', 'A11: Pay as you go equals Pro at 300 minutes');
select is(pg_temp.sc('a_viewer', $q$select public.pricing_v3_catalogue()::text$q$) ~ 'sales_assistant|sales_lead_finder|Lead Desk|AI Workforce|credit', false, 'A12: the answer carries no old plan id, no old name and never the word "credit"');
select is(pg_temp.sc('anon', $q$select public.pricing_v3_catalogue()::text$q$), 'ERR:42501', 'A13: nobody signed out reads it');
select throws_ok($q$update pricing.plan_terms set minute_paise = 451 where api_id = 'pro'$q$, '23514', null, 'A14: a rate that cannot be split into two 30-second halves is refused');
select throws_ok($q$insert into pricing.plan_terms (plan_id, api_id, name, sort, included_minutes, minute_paise, free_searches_month, search_paise, onboarding) values ('payg', 'extra', 'X', 1, 0, 500, 1, 1, 'priority')$q$, '23514', null, 'A15: only the three owner-facing ids exist');

-- B. billing v2 is exactly as it was
select is((select monthly_paise::text || '/' || rate_paise_per_minute || '/' || included_minutes || '/' || free_searches_month || '/' || extra_search_paise from pricing.plans where id = 'sales_assistant'), '199900/450/500/1/4900', 'B1: the v2 rows are untouched (Sales Assistant)');
select is((select count(*) from pricing.plans), 3::bigint, 'B2: still three v2 plans');
select is(pg_temp.sc('a_viewer', $q$select public.pricing_catalogue()::text$q$) like '%sales_lead_finder%', true, 'B3: the v2 catalogue still answers with its own ids');

-- C. the window: the paid period, a yearly plan month by month, else the India calendar month
select is((select w_start = (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') from pricing.v3_window(tests.tid('a'))), true, 'C1: no subscription: the India calendar month');
select pg_temp.plan('a', 'sales_assistant');
select is((select abs(extract(epoch from w_start - (now() - interval '2 days'))) < 1 from pricing.v3_window(tests.tid('a'))), true, 'C2: a subscription: its own period');
update pricing.subscriptions set interval = 'yearly', period_start = now() - interval '75 days', period_end = now() + interval '290 days' where tenant_id = tests.tid('a');
select is((select w_end - w_start from pricing.v3_window(tests.tid('a'))) between interval '28 days' and interval '31 days', true, 'C3: a yearly plan counts month by month');
select is((select w_start <= now() and w_end > now() from pricing.v3_window(tests.tid('a'))), true, 'C4: and the month contains now');
delete from pricing.subscriptions where tenant_id = tests.tid('a');

-- D. the wallet: one balance, a line per feature
select pricing.credit(tests.tid('a'), 'topup', 'pay_V3TEST00001', 100000);
select is(pg_temp.j(pg_temp.wallet('a_viewer', 'a'), 'balance_paise'), '100000', 'D1: any member reads the wallet');
select is(pg_temp.j(pg_temp.wallet('a_owner', 'a'), 'plan_id') || '/' || pg_temp.j(pg_temp.wallet('a_owner', 'a'), 'plan_name'), 'payg/Pay as you go', 'D2: with no plan chosen the business runs on Pay as you go terms');
select is((pg_temp.wallet('a_owner', 'a')::jsonb -> 'lines') ?& array['calls', 'lead_finder', 'numbers', 'whatsapp', 'ai_actions'], true, 'D3: a usage line for calls, Lead Finder, numbers, WhatsApp and AI actions');
select is((pg_temp.wallet('a_owner', 'a')::jsonb #>> '{lines,ai_actions,charged_paise}'), '0', 'D4: no charge for AI actions');
select is((pg_temp.wallet('a_owner', 'a')::jsonb #>> '{lines,lead_finder,free_left}'), '2', 'D5: two free Lead Finder searches on Pay as you go');
select is(pg_temp.wallet('a_owner', 'a') ~ 'sales_assistant|sales_lead_finder|"credit', false, 'D6: the wallet shows no internal plan id');
select is(pg_temp.wallet('b_owner', 'a'), 'ERR:42501', 'D7: another business cannot read it');
select is(pg_temp.wallet('anon', 'a'), 'ERR:42501', 'D8: nor anyone signed out');
select pg_temp.plan('a', 'sales_assistant');
select is(pg_temp.j(pg_temp.wallet('a_owner', 'a'), 'plan_id'), 'pro', 'D9: a business on the internal id sales_assistant is shown as Pro');
select is((pg_temp.wallet('a_owner', 'a')::jsonb #>> '{lines,lead_finder,free_left}'), '10', 'D10: ten free searches on Pro');
select is((pg_temp.wallet('a_owner', 'a')::jsonb #>> '{lines,calls,included_half_left}'), '1000', 'D11: 500 included minutes = 1,000 half-minutes');
select pg_temp.plan('a', 'sales_lead_finder');
select is(pg_temp.j(pg_temp.wallet('a_owner', 'a'), 'plan_id') || '/' || (pg_temp.wallet('a_owner', 'a')::jsonb #>> '{lines,lead_finder,free_left}'), 'business/100', 'D12: Business: 100 free searches');
delete from pricing.subscriptions where tenant_id = tests.tid('a');

-- E. the gate: read-only, limit, wallet
select is(pricing.v3_gate(tests.tid('a'), 'calls') ->> 'allowed', 'true', 'E1: a balance covers a call');
select is(pricing.v3_gate(tests.tid('b'), 'calls') ->> 'reason', 'wallet_empty', 'E2: an empty wallet: wallet_empty');
select is(pricing.v3_gate(tests.tid('b'), 'lead_finder') ->> 'allowed', 'true', 'E3: a free search needs no money');
select pg_temp.use('b', 'search', 0, 0, 0);
select pg_temp.use('b', 'search', 0, 0, 0);
select is(pricing.v3_gate(tests.tid('b'), 'lead_finder') ->> 'reason', 'wallet_empty', 'E4: after the two free searches the next costs Rs 49: wallet_empty');
select is(pricing.v3_gate(tests.tid('b'), 'whatsapp') ->> 'reason', 'wallet_empty', 'E5: WhatsApp needs some balance');
insert into pricing.feature_limits (tenant_id, feature, limit_paise) values (tests.tid('a'), 'calls', 20000);
select pg_temp.use('a', 'call', 80, 0, 20000);
select is(pricing.v3_gate(tests.tid('a'), 'calls') ->> 'reason', 'limit_reached', 'E6: the Owner''s own spending limit stops the feature even with money in the wallet');
create temp table orig_plan as select plan from public.tenants where id = tests.tid('a');
update public.tenants set plan = 'early_access' where id = tests.tid('a');
select is(pricing.v3_gate(tests.tid('a'), 'calls') ->> 'allowed', 'true', 'E7: free early access is never stopped here');
update public.tenants set plan = (select plan from orig_plan) where id = tests.tid('a');
select is(pricing.v3_gate(tests.tid('a'), 'calls') ->> 'reason', 'limit_reached', 'E8: and leaving early access puts the limit back in force');
delete from pricing.feature_limits where tenant_id = tests.tid('a');
delete from pricing.usage where tenant_id = tests.tid('a');

-- F. read-only after an unpaid end of plan; data kept 90 days
select is(pricing.v3_access(tests.tid('a')) ->> 'access', 'full', 'F1: no plan chosen yet: full access (the free start)');
insert into pricing.subscriptions (tenant_id, plan_id, interval, status, provider, provider_ref, period_start, period_end) values (tests.tid('a'), 'payg', 'monthly', 'active', 'fake', 'sub_fake_f', now() - interval '31 days', now() - interval '1 day');
select is(pricing.v3_access(tests.tid('a')) ->> 'access', 'full', 'F2: the day after the period ends: still the 3-day grace');
update pricing.subscriptions set period_start = now() - interval '40 days', period_end = now() - interval '10 days' where tenant_id = tests.tid('a');
select is(pricing.v3_access(tests.tid('a')) ->> 'access', 'read_only', 'F3: unpaid, grace over: read-only');
select is(pricing.v3_access(tests.tid('a')) ->> 'data_days_left', '83', 'F4: the data is kept 90 days from the day it became read-only (10 - 3 = 7 days gone)');
select is(pricing.v3_gate(tests.tid('a'), 'calls') ->> 'reason', 'read_only', 'F5: a call does not start in a read-only workspace');
select is(pg_temp.j(pg_temp.wallet('a_owner', 'a'), 'access')::jsonb ->> 'access', 'read_only', 'F6: and the wallet says so');
update pricing.subscriptions set status = 'cancelled', period_end = now() + interval '5 days', period_start = now() - interval '25 days' where tenant_id = tests.tid('a');
select is(pricing.v3_access(tenant_id) ->> 'access', 'full', 'F7: a cancelled plan keeps its paid days') from pricing.subscriptions where tenant_id = tests.tid('a');
update pricing.subscriptions set period_end = now() - interval '1 hour', period_start = now() - interval '31 days' where tenant_id = tests.tid('a');
select is(pricing.v3_access(tests.tid('a')) ->> 'access', 'read_only', 'F8: a cancelled plan has no grace');
update public.tenants set plan = 'early_access' where id = tests.tid('a');
select is(pricing.v3_access(tests.tid('a')) ->> 'access', 'full', 'F9: early access never goes read-only');
update public.tenants set plan = (select plan from orig_plan) where id = tests.tid('a');
delete from pricing.subscriptions where tenant_id = tests.tid('a');

-- G. the upgrade hint
select is(pricing.v3_hint(tests.tid('a')) ->> 'has_hint', 'false', 'G1: no usage, no hint');
select pg_temp.use('a', 'call', 600, 600, 150000);   -- 300 minutes (600 half-minutes) in the last 30 days on Pay as you go: Rs 499 + Rs 1,500 = Rs 1,999
select is(pricing.v3_hint(tests.tid('a')) ->> 'has_hint', 'false', 'G2: at 300 minutes the two plans cost the same: no hint');
select is(pricing.v3_hint(tests.tid('a')) ->> 'current_cost_paise', '199900', 'G3: Pay as you go for 300 minutes costs Rs 1,999');
select pg_temp.use('a', 'call', 400, 400, 100000);   -- 500 minutes in all: Rs 499 + Rs 2,500 = Rs 2,999 on Pay as you go; Rs 1,999 on Pro
select is(pricing.v3_hint(tests.tid('a')) ->> 'suggested_plan', 'pro', 'G4: at 500 minutes Pro is cheaper: the hint says Pro');
select is(pricing.v3_hint(tests.tid('a')) ->> 'saving_paise', '100000', 'G5: it saves Rs 1,000 a month');
select is(pg_temp.j(pg_temp.wallet('a_owner', 'a'), 'hint')::jsonb ->> 'suggested_plan', 'pro', 'G6: the wallet carries the hint');
select pg_temp.use('a', 'call', 400, 400, 100000, 45);   -- older than 30 days: not counted
select is(pricing.v3_hint(tests.tid('a')) ->> 'billed_half_minutes', '1000', 'G7: only the last 30 days count');
select pg_temp.plan('a', 'sales_assistant');
select is(pricing.v3_hint(tests.tid('a')) ->> 'has_hint', 'false', 'G8: on Pro with 500 minutes nothing is cheaper');
delete from pricing.usage where tenant_id = tests.tid('a');
select pg_temp.use('a', 'call', 20, 0, 5000);   -- 10 minutes on Pro: Business and Pro are dearer than Pay as you go
select is(pricing.v3_hint(tests.tid('a')) ->> 'suggested_plan', 'payg', 'G9: a business that hardly calls is told Pay as you go is cheaper');
select pg_temp.plan('a', 'sales_lead_finder');
delete from pricing.usage where tenant_id = tests.tid('a');
select pg_temp.use('a', 'call', 1200, 1200, 0);   -- 600 minutes on Business: Rs 5,999; Pro would be Rs 1,999 + 100 x Rs 5 = Rs 2,499
select is(pricing.v3_hint(tests.tid('a')) ->> 'suggested_plan', 'pro', 'G10: and a Business that never uses its minutes is told Pro is cheaper');
delete from pricing.subscriptions where tenant_id = tests.tid('a');
delete from pricing.usage where tenant_id = tests.tid('a');

-- H. the ledger and who may read it
select pg_temp.use('a', 'call', 20, 0, 5000);
select is(jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.pricing_v3_ledger(%L)::text$q$, tests.tid('a')))::jsonb)::text, '1', 'H1: the Owner reads what was charged');
select is(pg_temp.sc('a_admin', format($q$select (public.pricing_v3_ledger(%L)::jsonb -> 0 ->> 'feature')$q$, tests.tid('a'))), 'calls', 'H2: Admin too, a line per feature word');
select is(pg_temp.sc('a_sales', format($q$select public.pricing_v3_ledger(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'H3: Sales does not');
select is(pg_temp.sc('a_owner', format($q$select public.pricing_v3_ledger(%L, 0)::text$q$, tests.tid('a'))), 'ERR:22023', 'H4: a limit of 0 is refused');
select is((select count(*) from information_schema.table_privileges where table_schema = 'pricing' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'H5: no client role touches a pricing table (the new ones included)');

select * from finish();
rollback;
