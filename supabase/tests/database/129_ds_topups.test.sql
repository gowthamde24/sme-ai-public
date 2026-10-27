-- Job DS part E2 (migrations 20261210090000 / 090100 / 090200): RUNNING OUT BEFORE THE MONTH ENDS.
--   A structure, grants, RLS   B the catalogue (data)   C who may read   D buying a pack (idempotent, invoices, GST)   E plan first, then the oldest pack   F the projected run-out   G alerts, Today, enforcement
--   H calls that wait for minutes, and come back   I automatic top-up   J overage and the closing invoice   K the upgrade, pro-rata   L carry-over and the 90-day expiry   M guards
-- The clock is pinned (Monday 2 November 2026, 11:00 India time). Workspaces a and b began on 20 October, so their month window runs the 20th to the 20th (31 days; 18 days left on 2 November, today counts).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_guards_off();
select tests.open_gate('a');
select tests.open_gate('b');

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
  execute format('create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select app.agent_cost_day(timestamptz %L) $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-02T11:00:00+05:30'::timestamptz);
update public.tenants set trial_started_at = '2026-10-20T09:00:00+05:30' where id in (tests.tid('a'), tests.tid('b'));
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.j(p_json text, p_path text) returns text language sql as $$ select (p_json::jsonb #>> string_to_array(p_path, '.')) $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.val('x5', p_sql) $$;
create function pg_temp.t(p_tenant text) returns uuid language sql as $$ select tests.tid(p_tenant) $$;
-- the meter of a workspace as the doors show it (the answer of billing_get, read by the Owner)
create function pg_temp.m(p_tenant text, p_kind text, p_field text) returns text language sql as $$
  select app.billing_meter(tests.tid(p_tenant), p_kind) ->> p_field $$;
create function pg_temp.use(p_tenant text, p_kind text, p_ref text, p_units int) returns void language plpgsql as $$
begin perform app.billing_record(tests.tid(p_tenant), p_kind, tests.rid(p_ref), p_units); end $$;
create function pg_temp.buy(p_user text, p_tenant text, p_id text, p_pack text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.billing_topup_buy(%L, %L, %L)::text$q$, tests.tid(p_tenant), tests.rid(p_id), p_pack), p_aal) $$;
create function pg_temp.settings(p_user text, p_tenant text, p_doc text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.billing_topup_settings_set(%L, %L::jsonb)::text$q$, tests.tid(p_tenant), p_doc), p_aal) $$;
create function pg_temp.sdoc(p_am text, p_as text, p_cap bigint, p_om boolean, p_os boolean, p_ocap bigint) returns text language sql as $$
  select jsonb_build_object('auto_minutes_pack', p_am, 'auto_messages_pack', p_as, 'auto_monthly_cap_paise', p_cap, 'overage_minutes', p_om, 'overage_messages', p_os, 'overage_monthly_cap_paise', p_ocap)::text $$;
create function pg_temp.topups(p_user text, p_tenant text, p_path text) returns text language sql as $$
  select pg_temp.j(pg_temp.val(p_user, format($q$select public.billing_topups_get(%L)::text$q$, tests.tid(p_tenant))), p_path) $$;
create function pg_temp.draws(p_tenant text, p_pack text) returns bigint language sql as $$
  select coalesce(sum(d.units), 0) from public.billing_topup_draws d where d.purchase_id = tests.rid(p_pack) and d.tenant_id = tests.tid(p_tenant) $$;

-- the people for the calls (workspace b) and a plan with a payment method for workspace a
insert into public.companies (id, tenant_id, name) values (tests.rid('co_b'), tests.tid('b'), 'Topup Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent, created_at) values
  (tests.rid('bc1'), tests.tid('b'), tests.rid('co_b'), 'Meena Rao', '+91 98100 00001', 'granted', 'granted', '2026-10-01T01:00:00Z'),
  (tests.rid('bc2'), tests.tid('b'), tests.rid('co_b'), 'Hari Babu', '+91 98100 00002', 'granted', 'granted', '2026-10-01T02:00:00Z');
insert into public.leads (id, tenant_id, company_id, contact_id, source) values
  (tests.rid('bl1'), tests.tid('b'), tests.rid('co_b'), tests.rid('bc1'), 'excel_upload'),
  (tests.rid('bl2'), tests.tid('b'), tests.rid('co_b'), tests.rid('bc2'), 'excel_upload');
insert into public.billing_subscriptions (tenant_id, plan_id, catalogue_version, status, provider, provider_ref, payment_method_on_file, trial_started_at, trial_ends_at)
values (tests.tid('a'), 'starter', 2, 'trialing', 'fake', 'sub_fake_topup_a', true, '2026-10-20T09:00:00+05:30', '2026-11-03T09:00:00+05:30');

-- ============================================================================ A. structure, grants, RLS
select is((select count(*) from pg_class where relname in ('billing_invoices', 'billing_topup_purchases', 'billing_topup_draws', 'billing_topup_settings', 'billing_alert_sends') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 5::bigint, 'A1 the five tables have row-level security, forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('billing_invoices', 'billing_topup_purchases', 'billing_topup_draws', 'billing_topup_settings', 'billing_alert_sends') and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0::bigint, 'A2 clients hold SELECT only on them');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('billing_invoices', 'billing_topup_purchases', 'billing_topup_draws', 'billing_topup_settings', 'billing_alert_sends') and grantee = 'anon'), 0::bigint, 'A3 anon holds nothing');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'billing' and table_name in ('topup_config', 'topup_packs') and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A4 the catalogue and the configuration (schema billing) have no client grant');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('billing_topups_get', 'billing_topup_buy', 'billing_topup_settings_set', 'billing_invoices_list', 'billing_invoice_get', 'billing_upgrade_preview', 'billing_upgrade', 'scheduler_billing_topup_tick', 'scheduler_usage_alerts_due', 'scheduler_usage_alert_mark')
            and p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute')), 10::bigint, 'A5 the ten public functions are SECURITY DEFINER, empty search_path, closed to anon');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and (p.proname like 'topup\_%' or p.proname like 'invoice\_%' or p.proname in ('billing_blocked', 'billing_base_total', 'billing_plan_units', 'billing_period_at', 'billing_meter_base', 'upgrade_calc'))
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint, 'A6 none of the helpers is open to a client');
select is(has_function_privilege('authenticated', 'app.today_usage_items(uuid)', 'execute'), true, 'A7 the one helper a client may call is Today''s (it answers the caller''s own Owner/Admin workspace only)');
select is((select count(*) from pg_trigger where tgrelid = 'public.billing_invoices'::regclass and tgname in ('billing_invoices_guard', 'billing_invoices_no_truncate', 'audit_billing_invoices')), 3::bigint, 'A8 invoices are guarded against change and truncation and audited');

-- ============================================================================ B. the catalogue is data
select is((select string_agg(code || ':' || units, ',' order by sort) from billing.topup_packs), 'minutes_100:100,minutes_300:300,minutes_1000:1000,messages_100:100,messages_300:300,messages_1000:1000', 'B1 six packs: +100 / +300 / +1,000 minutes and the same for messages');
select is((select count(*) from billing.topup_config), 1::bigint, 'B2 one configuration row');
select is((select expiry_days || '/' || gst_rate_bp || '/' || price_is_placeholder from billing.topup_config), '90/1800/true', 'B3 90-day expiry, 18 percent GST, placeholder prices');
select is(pg_temp.sc($$select * from billing.topup_packs$$), 'ok', 'B4 the test role reads the catalogue (it is the owner of the schema)');
select is(pg_temp.val('a_owner', 'select count(*)::text from billing.topup_packs'), 'ERR:42501', 'B5 a signed-in client cannot read the catalogue table directly');
select is(pg_temp.topups('a_owner', 'a', 'packs.1.code'), 'minutes_300', 'B6 the door lists the packs in order');
select is(pg_temp.topups('a_owner', 'a', 'packs.1.total_paise'), '127440', 'B7 minutes_300: 108,000 + 18 percent GST (19,440) = 127,440 paise');
select is(pg_temp.topups('a_owner', 'a', 'packs.0.price_is_placeholder'), 'true', 'B8 and says the price is a placeholder');

-- ============================================================================ C. who may read
select is(pg_temp.topups('a_admin', 'a', 'packs.0.code'), 'minutes_100', 'C1 an Admin reads');
select is(pg_temp.val('a_sales', format($q$select public.billing_topups_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C2 DENY: Sales');
select is(pg_temp.val('a_viewer', format($q$select public.billing_topups_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C3 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.billing_topups_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C4 DENY: another business''s Owner');
select is(pg_temp.val('anon', format($q$select public.billing_topups_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C5 DENY: anon');
select is(pg_temp.val('a_sales', format($q$select public.billing_invoices_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C6 DENY: Sales cannot list invoices');

-- ============================================================================ D. buying a pack
select is(pg_temp.buy('b_owner', 'b', 'p0', 'minutes_100'), 'ERR:SM833', 'D1 a workspace with no plan (no subscription) has nothing to attach a pack to');
select is(pg_temp.buy('a_admin', 'a', 'p1', 'minutes_100'), 'ERR:42501', 'D2 DENY: an Admin cannot buy');
select is(pg_temp.buy('a_sales', 'a', 'p1', 'minutes_100'), 'ERR:42501', 'D3 DENY: Sales');
select is(pg_temp.buy('a_owner', 'a', 'p1', 'minutes_100', 'aal1'), 'ERR:SM306', 'D4 the Owner needs the second factor');
select is(pg_temp.buy('a_owner', 'a', 'p1', 'minutes_99'), 'ERR:SM832', 'D5 an unknown pack');
select is(pg_temp.buy('a_owner', 'a', 'p1', 'Minutes 100'), 'ERR:22023', 'D6 a malformed pack code is invalid');
select is(pg_temp.buy('b_owner', 'a', 'p1', 'minutes_100'), 'ERR:42501', 'D7 DENY: another business''s Owner');
select is(pg_temp.j(pg_temp.buy('a_owner', 'a', 'p1', 'minutes_100'), 'created'), 'true', 'D8 the Owner buys 100 minutes (a trial counts as a plan)');
select is((select count(*) from public.billing_topup_purchases where tenant_id = tests.tid('a')), 1::bigint, 'D9 one purchase');
select is(pg_temp.j(pg_temp.buy('a_owner', 'a', 'p1', 'minutes_100'), 'created'), 'false', 'D10 the same purchase id again changes nothing (answers the same purchase)');
select is((select count(*) from public.billing_invoices where tenant_id = tests.tid('a')), 1::bigint, 'D11 ... and makes no second invoice');
select is(pg_temp.buy('a_owner', 'a', 'p1', 'minutes_300'), 'ERR:SM831', 'D12 the same id for ANOTHER pack is refused');
select is((select number from public.billing_invoices where tenant_id = tests.tid('a')), 'S19-2611-000001', 'D13 the invoice number: S19, year and month, a serial');
select is((select taxable_paise || '/' || igst_paise || '/' || cgst_paise || '/' || sgst_paise || '/' || total_paise from public.billing_invoices where tenant_id = tests.tid('a')), '40000/7200/0/0/47200', 'D14 no GSTIN: IGST 18 percent of 40,000 = 7,200; total 47,200');
select is((select fake::text || '/' || payment_status from public.billing_invoices where tenant_id = tests.tid('a')), 'true/paid_fake', 'D15 the invoice says it is fake');
select is((select expires_at from public.billing_topup_purchases where id = tests.rid('p1')), '2027-01-31T11:00:00+05:30'::timestamptz, 'D16 it expires 90 days after the purchase');
select is(pg_temp.m('a', 'call_minutes', 'topup_balance'), '100.0', 'D17 the balance is 100 minutes');
select is(pg_temp.m('a', 'call_minutes', 'allowance'), '130', 'D18 the allowance is the trial''s 30 plus the pack''s 100');
select is(pg_temp.m('a', 'call_minutes', 'plan_allowance'), '30', 'D19 the plan''s own part is shown');
select is(pg_temp.m('a', 'call_minutes', 'next_topup_expiry'), '2027-01-31', 'D20 the next expiry is shown');
select is(pg_temp.topups('a_owner', 'a', 'history.0.source') || '/' || pg_temp.topups('a_owner', 'a', 'history.0.total_paise') || '/' || pg_temp.topups('a_owner', 'a', 'history.0.units_left'), 'manual/47200/100.0', 'D21 the history shows it');
select is(pg_temp.j(pg_temp.val('a_owner', format($q$select public.billing_invoices_list(%L)::text$q$, tests.tid('a'))), '0.number'), 'S19-2611-000001', 'D22 the invoice list');
select is(pg_temp.j(pg_temp.val('a_admin', format($q$select public.billing_invoice_get(%L, %L)::text$q$, tests.tid('a'), (select id from public.billing_invoices where tenant_id = tests.tid('a')))), 'buyer.state_code'), null, 'D23 an Admin reads one invoice (no buyer GSTIN: no state)');
select is(pg_temp.val('b_owner', format($q$select public.billing_invoice_get(%L, %L)::text$q$, tests.tid('b'), (select id from public.billing_invoices where tenant_id = tests.tid('a')))), 'ERR:23503', 'D24 another workspace''s invoice is not found');
select is(pg_temp.val('a_owner', 'select count(*)::text from public.billing_invoices'), '1', 'D25 row-level security: the Owner of a sees only a''s invoices');
select is(pg_temp.val('a_sales', 'select count(*)::text from public.billing_invoices'), '0', 'D26 Sales see none');

-- ============================================================================ E. the plan allowance first, then the oldest pack
select pg_temp.use('a', 'call_minutes', 'u1', 1200);
select is(pg_temp.m('a', 'call_minutes', 'used') || '/' || pg_temp.draws('a', 'p1'), '20.0/0', 'E1 20 minutes used: inside the plan''s 30, the pack is untouched');
select pg_temp.use('a', 'call_minutes', 'u2', 900);
select is(pg_temp.m('a', 'call_minutes', 'used') || '/' || pg_temp.draws('a', 'p1'), '35.0/300', 'E2 35 minutes used: the plan''s 30 first, then 5 minutes (300 seconds) from the pack');
select is(pg_temp.m('a', 'call_minutes', 'topup_balance') || '/' || pg_temp.m('a', 'call_minutes', 'allowance'), '95.0/130', 'E3 95 minutes of the pack remain; the allowance stays 130');
select pg_temp.use('a', 'call_minutes', 'u2', 900);
select is(pg_temp.draws('a', 'p1'), 300::bigint, 'E4 the same call again is not counted (idempotent)');
select pg_temp.pin('2026-11-02T11:01:00+05:30'::timestamptz);
select is(pg_temp.j(pg_temp.buy('a_owner', 'a', 'p2', 'minutes_300'), 'created'), 'true', 'E5 a second pack (300 minutes) a minute later');
select is(pg_temp.m('a', 'call_minutes', 'allowance'), '430', 'E6 the allowance is 430');
select pg_temp.use('a', 'call_minutes', 'u3', 7200);
select is(pg_temp.draws('a', 'p1') || '/' || pg_temp.draws('a', 'p2'), '6000/1500', 'E7 120 more minutes: the OLDEST pack is emptied first (6,000 seconds in all), then 1,500 from the newer');
select is(pg_temp.m('a', 'call_minutes', 'topup_balance') || '/' || pg_temp.m('a', 'call_minutes', 'used') || '/' || pg_temp.m('a', 'call_minutes', 'state'), '275.0/155.0/ok', 'E8 275 minutes remain of 430 (155 used): ok');
select is(pg_temp.topups('a_owner', 'a', 'balance.call_minutes.lots.0.purchase_id'), tests.rid('p2')::text, 'E9 only the newer pack is a lot now');
select is(pg_temp.topups('a_owner', 'a', 'balance.call_minutes.lots.0.units_left'), '275.0', 'E10 with 275 minutes left');
select is(pg_temp.m('a', 'whatsapp_messages', 'topup_balance') || '/' || pg_temp.m('a', 'whatsapp_messages', 'allowance'), '0.0/100', 'E11 messages are a separate meter with their own packs');
select is(pg_temp.j(pg_temp.buy('a_owner', 'a', 'p3', 'messages_100'), 'usage.whatsapp_messages.allowance'), '200', 'E12 a 100-message pack raises the message allowance to 200');
select is(pg_temp.j(pg_temp.buy('a_owner', 'a', 'p3', 'messages_100'), 'created'), 'false', 'E13 and buying it again changes nothing');

-- ============================================================================ F. the projected run-out (workspace b: the plan only)
select is(pg_temp.m('b', 'call_minutes', 'projected_run_out_on'), null, 'F1 nothing used yet: no projection');
select pg_temp.use('b', 'call_minutes', 'bu1', 180);
select is(coalesce(pg_temp.m('b', 'call_minutes', 'projected_run_out_on'), 'none') || '/' || pg_temp.m('b', 'call_minutes', 'runs_out_before_period_end'), 'none/false', 'F2 3 minutes in 14 days: the 30 last past the period: no date');
select pg_temp.use('b', 'call_minutes', 'bu2', 1080);
select is(pg_temp.m('b', 'call_minutes', 'used'), '21.0', 'F3 21 minutes used in 14 days (1.5 a day)');
select is(pg_temp.m('b', 'call_minutes', 'projected_run_out_on') || '/' || pg_temp.m('b', 'call_minutes', 'runs_out_before_period_end'), '2026-11-08/true', 'F4 at 1.5 minutes a day the remaining 9 last 6 days: 8 November');
select is(pg_temp.m('b', 'call_minutes', 'state') || '/' || (select count(*) from public.billing_notices where tenant_id = tests.tid('b')), 'ok/0', 'F5 21 of 30 is 70 percent: ok, no notice yet');

-- ============================================================================ G. alerts, Today, enforcement
select pg_temp.use('b', 'call_minutes', 'bu3', 420);
select is(pg_temp.m('b', 'call_minutes', 'state') || '/' || pg_temp.m('b', 'call_minutes', 'percent'), 'notice/93', 'G1 28 of 30 minutes: 93 percent: notice');
select pg_temp.use('b', 'call_minutes', 'bu4', 120);
select is(pg_temp.m('b', 'call_minutes', 'state') || '/' || pg_temp.m('b', 'call_minutes', 'blocked') || '/' || pg_temp.m('b', 'call_minutes', 'projected_run_out_on'), 'stopped/false/2026-11-02', 'G2 30 of 30: stopped (not blocked while billing is off); the run-out date is today');
select is((select string_agg(level::text, ',' order by level) from public.billing_notices where tenant_id = tests.tid('b')), '80,100', 'G3 the notices at 80 and 100 were made once each');
select is(pg_temp.sch('select public.scheduler_usage_alerts_due(10)::text'), '[]', 'G4 billing is off: no alert goes out');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.today_summary(%L) -> 'needs_you')::text$q$, tests.tid('b'))), 'ERR:42501', 'G5 DENY: another business''s Owner cannot ask');
select is(pg_temp.val('b_owner', format($q$select (public.today_summary(%L) -> 'needs_you' @> '[{"kind": "topup_empty"}]')::text$q$, tests.tid('b'))), 'false', 'G6 billing off: Today does not claim anything stopped');
select app.operator_set_billing_enforced(true);
select is(pg_temp.m('b', 'call_minutes', 'blocked'), 'true', 'G7 billing on: blocked');
select is(pg_temp.val('b_owner', format($q$select (public.billing_check_usage(%L, 'call_minutes') ->> 'allowed')$q$, tests.tid('b'))), 'false', 'G8 no new call may start');
select is(pg_temp.val('b_owner', format($q$select (select k ->> 'kind' from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') k where k ->> 'kind' like 'topup%%')$q$, tests.tid('b'))), 'topup_empty', 'G9 Today shows ONE usage item for the Owner: used up (the 80 percent one is superseded)');
select is(pg_temp.val('b_owner', format($q$select (select k -> 'target' ->> 'type' from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') k where k ->> 'kind' = 'topup_empty')$q$, tests.tid('b'))), 'billing', 'G10 its target is the billing screen');
select is(pg_temp.val('b_admin', format($q$select (public.today_summary(%L) -> 'needs_you' @> '[{"kind": "topup_empty"}]')::text$q$, tests.tid('b'))), 'true', 'G11 an Admin sees it too');
select is(pg_temp.val('b_sales', format($q$select (public.today_summary(%L) -> 'needs_you' @> '[{"kind": "topup_empty"}]')::text$q$, tests.tid('b'))), 'false', 'G12 Sales do not');
select is(pg_temp.val('a_owner', format($q$select (public.today_summary(%L) -> 'needs_you' @> '[{"kind": "topup_empty"}]')::text$q$, tests.tid('a'))), 'false', 'G13 workspace a (packs left) has none');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_usage_alerts_due(10)::text$q$, tests.tid('b'))), 'ERR:42501', 'G14 only the worker lists the alerts');
create temp table due1 as select pg_temp.sch('select public.scheduler_usage_alerts_due(10)::text')::jsonb as r;
select is((select jsonb_array_length(r) from due1), 1, 'G15 one alert is due for b: the level-100 one (level 80 is superseded)');
select is((select r -> 0 ->> 'level' || '/' || (r -> 0 ->> 'kind') || '/' || (r -> 0 -> 'channels')::text from due1), '100/call_minutes/["email", "whatsapp"]', 'G16 on both channels');
select is((select r -> 0 ->> 'projected_run_out_on' || '/' || (r -> 0 ->> 'language') from due1), '2026-11-02/en', 'G17 with the projected run-out date');
select is((select jsonb_array_length(r -> 0 -> 'emails') from due1), 1, 'G18 and the Owner''s address');
select is(pg_temp.sch(format($q$select public.scheduler_usage_alert_mark(%L, 'call_minutes', 100, date '2026-10-20', 'email')::text$q$, tests.tid('b'))), '{"marked": "email"}', 'G19 the worker marks the e-mail sent');
select is(pg_temp.sch('select (public.scheduler_usage_alerts_due(10) -> 0 -> ''channels'')::text'), '["whatsapp"]', 'G20 only the WhatsApp message to the owner is left');
select is(pg_temp.sch(format($q$select public.scheduler_usage_alert_mark(%L, 'call_minutes', 100, date '2026-10-20', 'sms')::text$q$, tests.tid('b'))), 'ERR:22023', 'G21 an unknown channel is invalid');
select is(pg_temp.sch(format($q$select public.scheduler_usage_alert_mark(%L, 'call_minutes', 100, date '2026-09-20', 'whatsapp')::text$q$, tests.tid('b'))), 'ERR:22023', 'G22 a notice that was never made cannot be marked');
select pg_temp.sch(format($q$select public.scheduler_usage_alert_mark(%L, 'call_minutes', 100, date '2026-10-20', 'whatsapp')::text$q$, tests.tid('b')));
select is(pg_temp.sch('select public.scheduler_usage_alerts_due(10)::text'), '[]', 'G23 both channels done: nothing more is due (a retry never sends twice)');
select is(pg_temp.sch(format($q$select public.scheduler_usage_alert_mark(%L, 'call_minutes', 100, date '2026-10-20', 'whatsapp')::text$q$, tests.tid('b'))), '{"marked": "whatsapp"}', 'G24 marking twice is harmless');
select is((select count(*) from public.billing_alert_sends where tenant_id = tests.tid('b')), 2::bigint, 'G25 two sends recorded');
update public.tenants set billing_exempt = true where id = tests.tid('b');
select is(pg_temp.sch('select public.scheduler_usage_alerts_due(10)::text'), '[]', 'G26 an exempt workspace (a demo) is never alerted');
update public.tenants set billing_exempt = false where id = tests.tid('b');

-- ============================================================================ H. calls that wait for minutes, and come back
insert into public.billing_subscriptions (tenant_id, plan_id, catalogue_version, status, provider, provider_ref, payment_method_on_file, trial_started_at, trial_ends_at)
values (tests.tid('b'), 'growth', 2, 'trialing', 'fake', 'sub_fake_topup_b', true, '2026-10-20T09:00:00+05:30', '2026-11-03T09:00:00+05:30');
create function pg_temp.plan_b(p_id text) returns text language sql as $$
  select pg_temp.val('b_owner', format($q$select public.outreach_batch_plan(%L, %L::jsonb)::text$q$, tests.tid('b'),
    format('{"batch_id": "%s", "name": "Queue test", "goal": "site_visit", "channel": "call", "language": "te", "who": {"contact_ids": ["%s","%s"]}}', tests.rid(p_id), tests.rid('bc1'), tests.rid('bc2')))) $$;
select is(pg_temp.j(pg_temp.plan_b('qb1'), 'plan.ready'), '2', 'H1 a batch of two people is planned');
select is(pg_temp.j(pg_temp.val('b_owner', format($q$select public.outreach_batch_approve(%L, %L, %L)::text$q$, tests.tid('b'), tests.rid('qb1'), (select plan_sha256 from public.outreach_batches where id = tests.rid('qb1')))), 'batch.status'), 'running', 'H2 approved once');
create temp table runq as select pg_temp.sch('select public.scheduler_outreach_run(10)::text')::jsonb as r;
select is((select jsonb_array_length(r -> 'calls') from runq), 0, 'H3 no minutes left: no call is handed to the dialer');
select is((select count(*) from public.outreach_items where batch_id = tests.rid('qb1') and status = 'waiting_for_minutes'), 2::bigint, 'H4 both calls WAIT FOR MINUTES (queued, not lost)');
select is((select count(*) from public.outreach_items where batch_id = tests.rid('qb1') and next_at is not null and next_action = 'call'), 2::bigint, 'H5 each keeps its next step');
select is(pg_temp.m('b', 'call_minutes', 'queued'), '2', 'H6 the meter says 2 are queued');
select is(pg_temp.j(pg_temp.val('b_owner', format($q$select public.outreach_batch_get(%L, %L)::text$q$, tests.tid('b'), tests.rid('qb1'))), 'progress.waiting') || '/' || pg_temp.j(pg_temp.val('b_owner', format($q$select public.outreach_batch_get(%L, %L)::text$q$, tests.tid('b'), tests.rid('qb1'))), 'progress.waiting_for_minutes'), '2/2', 'H7 the batch still counts them as waiting and shows how many wait for minutes');
select is(pg_temp.j(pg_temp.val('b_owner', format($q$select public.billing_usage_get(%L)::text$q$, tests.tid('b'))), 'queued_calls'), '2', 'H8 the usage view says 2 calls are queued');
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_run(10) -> ''calls'')::text'), '0', 'H9 a second run still hands out nothing');
select is(pg_temp.j(pg_temp.buy('b_owner', 'b', 'q1', 'minutes_100'), 'usage.call_minutes.queued'), '0', 'H10 a top-up and the queue comes back at once');
select is((select count(*) from public.outreach_items where batch_id = tests.rid('qb1') and status = 'waiting'), 2::bigint, 'H11 both are waiting again');
select is(pg_temp.sch('select jsonb_array_length(public.scheduler_outreach_run(10) -> ''calls'')::text'), '2', 'H12 and the worker hands both to the dialer');
-- a stopped call can also be excluded or cancelled while it waits for minutes
update public.outreach_items set status = 'waiting_for_minutes' where batch_id = tests.rid('qb1') and contact_id = tests.rid('bc1');
select is(pg_temp.j(pg_temp.val('b_owner', format($q$select public.outreach_batch_exclude(%L, %L, array[%L]::uuid[])::text$q$, tests.tid('b'), tests.rid('qb1'), tests.rid('bc1'))), 'progress.waiting_for_minutes'), '0', 'H13 excluding a person whose call waits for minutes stops it');
update public.outreach_items set status = 'waiting_for_minutes' where batch_id = tests.rid('qb1') and contact_id = tests.rid('bc2');
select is(pg_temp.j(pg_temp.val('b_owner', format($q$select public.outreach_batch_state(%L, %L, 'cancel')::text$q$, tests.tid('b'), tests.rid('qb1'))), 'progress.waiting_for_minutes'), '0', 'H14 cancelling the batch stops it too');
-- a call that connected uses minutes: the result records them on the meter
update public.outreach_items set status = 'waiting', next_action = 'call', next_at = '2026-11-02T11:00:00+05:30' where batch_id = tests.rid('qb1') and contact_id = tests.rid('bc2');
update public.outreach_batches set status = 'running', finished_at = null where id = tests.rid('qb1');
select is(pg_temp.j(pg_temp.val('b_owner', format($q$select public.outreach_item_result(%L, %L, 'connected', null, 2.5, false)::text$q$, tests.tid('b'), (select id from public.outreach_items where batch_id = tests.rid('qb1') and contact_id = tests.rid('bc2')))), 'status'), 'waiting', 'H15 a connected call of 2.5 minutes is reported');
select is((select units from public.billing_usage_events where tenant_id = tests.tid('b') and kind = 'call_minutes' and units = 150), 150, 'H16 150 seconds went onto the meter');

-- ============================================================================ I. automatic top-up (OFF by default)
select is(pg_temp.val('b_owner', format($q$select public.billing_topups_get(%L) -> 'settings' ->> 'auto_minutes_pack'$q$, tests.tid('b'))), null, 'I1 off by default');
select is(pg_temp.settings('b_admin', 'b', pg_temp.sdoc('minutes_100', null, 100000, false, false, 0)), 'ERR:42501', 'I2 DENY: an Admin cannot change the settings');
select is(pg_temp.settings('b_owner', 'b', pg_temp.sdoc('minutes_100', null, 100000, false, false, 0), 'aal1'), 'ERR:SM306', 'I3 the Owner needs the second factor');
select is(pg_temp.settings('b_owner', 'b', pg_temp.sdoc('minutes_100', null, 0, false, false, 0)), 'ERR:SM834', 'I4 an automatic top-up needs a monthly cap');
select is(pg_temp.settings('b_owner', 'b', pg_temp.sdoc('messages_100', null, 100000, false, false, 0)), 'ERR:SM832', 'I5 a messages pack cannot top up minutes');
select is(pg_temp.settings('b_owner', 'b', pg_temp.sdoc('nope_1', null, 100000, false, false, 0)), 'ERR:SM832', 'I6 an unknown pack');
select is(pg_temp.settings('b_owner', 'b', '{"auto_minutes_pack": null}'), 'ERR:22023', 'I7 all six fields are required');
select is(pg_temp.settings('b_owner', 'b', replace(pg_temp.sdoc(null, null, 0, false, false, 0), '"overage_minutes": false', '"overage_minutes": "yes"')), 'ERR:22023', 'I8 a wrong type is invalid');
select is(pg_temp.j(pg_temp.settings('b_owner', 'b', pg_temp.sdoc('minutes_100', null, 100000, false, false, 0)), 'auto_minutes_pack'), 'minutes_100', 'I9 the Owner turns automatic top-up on: minutes_100, up to 1,000 rupees a month');
select is((select count(*) from public.billing_topup_purchases where tenant_id = tests.tid('b') and source = 'auto'), 0::bigint, 'I10 nothing is bought until the kind is used up');
select pg_temp.use('b', 'call_minutes', 'bu5', 6000);
select is((select count(*) from public.billing_topup_purchases where tenant_id = tests.tid('b') and source = 'auto'), 1::bigint, 'I11 the 100 minutes of the manual pack are used up: one automatic top-up is bought');
select is((select total_paise from public.billing_invoices i join public.billing_topup_purchases p on p.invoice_id = i.id and p.tenant_id = i.tenant_id where p.tenant_id = tests.tid('b') and p.source = 'auto'), 47200::bigint, 'I12 with an invoice of 47,200 (GST included)');
select is(pg_temp.m('b', 'call_minutes', 'state') || '/' || pg_temp.m('b', 'call_minutes', 'blocked'), 'ok/false', 'I13 the meter is open again');
select pg_temp.use('b', 'call_minutes', 'bu6', 6000);
select is((select count(*) from public.billing_topup_purchases where tenant_id = tests.tid('b') and source = 'auto'), 2::bigint, 'I14 a second automatic top-up (94,400 of the 100,000 cap)');
select pg_temp.use('b', 'call_minutes', 'bu7', 6000);
select is((select count(*) from public.billing_topup_purchases where tenant_id = tests.tid('b') and source = 'auto'), 2::bigint, 'I15 a third would pass the monthly cap: not bought');
select is(pg_temp.m('b', 'call_minutes', 'state') || '/' || pg_temp.m('b', 'call_minutes', 'blocked'), 'stopped/true', 'I16 the kind stops');
select is(pg_temp.topups('b_owner', 'b', 'settings.auto_spent_paise'), '94400', 'I17 the settings show what was spent automatically this month');
select is(pg_temp.j(pg_temp.settings('b_owner', 'b', pg_temp.sdoc(null, null, 0, false, false, 0)), 'auto_minutes_pack'), null, 'I18 and it can be switched off');

-- ============================================================================ J. overage, and the closing invoice
select is(pg_temp.settings('b_owner', 'b', pg_temp.sdoc(null, null, 0, true, false, 0)), 'ERR:SM834', 'J1 overage needs a monthly cap');
select is(pg_temp.j(pg_temp.settings('b_owner', 'b', pg_temp.sdoc(null, null, 0, true, false, 50000)), 'overage_minutes'), 'true', 'J2 the Owner switches overage on with a cap of 500 rupees');
select is(pg_temp.m('b', 'call_minutes', 'state') || '/' || pg_temp.m('b', 'call_minutes', 'blocked'), 'notice/false', 'J3 the used-up meter reads notice (the overage covers it), not blocked');
select is(pg_temp.val('b_owner', format($q$select (public.billing_check_usage(%L, 'call_minutes') ->> 'allowed')$q$, tests.tid('b'))), 'true', 'J4 a call may start');
select pg_temp.use('b', 'call_minutes', 'bu8', 360);
select is(pg_temp.m('b', 'call_minutes', 'overage')::jsonb ->> 'spent_paise', '4500', 'J5 8.5 minutes over (150 s left over from the automatic top-ups + 360 s): 9 started minutes at 5 rupees = 4,500 paise');
select is(pg_temp.m('b', 'call_minutes', 'overage')::jsonb ->> 'units', '8.5', 'J6 8.5 minutes over');
select pg_temp.use('b', 'call_minutes', 'bu9', 6000);
select is(pg_temp.m('b', 'call_minutes', 'state') || '/' || pg_temp.m('b', 'call_minutes', 'blocked'), 'stopped/true', 'J7 108.5 minutes over costs 54,500: past the cap of 50,000: stopped');
select is(pg_temp.m('b', 'whatsapp_messages', 'overage'), null, 'J8 messages have no overage switched on');
-- the next period: 5 December. October 20 to November 20 is closed; one invoice, capped
select pg_temp.pin('2026-12-05T11:00:00+05:30'::timestamptz);
select is(pg_temp.sch('select public.scheduler_billing_topup_tick(10)::text'), '{"invoices": 1}', 'J9 the worker closes the period: one overage invoice');
select is((select kind || '/' || period_start || '/' || taxable_paise from public.billing_invoices where tenant_id = tests.tid('b') and kind = 'overage'), 'overage/2026-10-20/50000', 'J10 for the period that ended, capped at the Owner''s 50,000');
select is(pg_temp.sch('select public.scheduler_billing_topup_tick(10)::text'), '{"invoices": 0}', 'J11 running again makes no second one');
select is(pg_temp.val('b_owner', 'select public.scheduler_billing_topup_tick(10)::text'), 'ERR:42501', 'J12 only the worker closes periods');
select is(pg_temp.m('b', 'call_minutes', 'state') || '/' || pg_temp.m('b', 'call_minutes', 'used'), 'ok/0.0', 'J13 the new period starts clean');
select pg_temp.pin('2026-11-02T11:02:00+05:30'::timestamptz);

-- ============================================================================ K. the upgrade, pro-rata (workspace a)
select is(pg_temp.val('a_owner', format($q$select public.billing_upgrade_preview(%L, 'growth')::text$q$, tests.tid('a'))) ::jsonb ->> 'prorated_paise', '0', 'K1 on the trial nothing is charged: pro-rata 0');
select is(pg_temp.j(pg_temp.val('a_owner', format($q$select public.billing_upgrade_preview(%L, 'growth')::text$q$, tests.tid('a'))), 'effective'), 'now', 'K2 the new allowance applies now');
select is(pg_temp.val('a_owner', format($q$select public.billing_upgrade_preview(%L, 'starter')::text$q$, tests.tid('a'))), 'ERR:SM835', 'K3 the same plan is not an upgrade');
select is(pg_temp.val('a_owner', format($q$select public.billing_upgrade_preview(%L, 'free_trial')::text$q$, tests.tid('a'))), 'ERR:SM821', 'K4 the trial plan is not a plan to upgrade to');
select is(pg_temp.val('a_owner', format($q$select public.billing_upgrade_preview(%L, 'platinum')::text$q$, tests.tid('a'))), 'ERR:SM821', 'K5 an unknown plan');
select is(pg_temp.val('b_admin', format($q$select public.billing_upgrade_preview(%L, 'business')::text$q$, tests.tid('b'))) ::jsonb ->> 'to_plan_id', 'business', 'K6 an Admin may preview (workspace b is on growth, trialing)');
select is(pg_temp.val('a_sales', format($q$select public.billing_upgrade_preview(%L, 'growth')::text$q$, tests.tid('a'))), 'ERR:42501', 'K7 DENY: Sales');
select is(pg_temp.val('a_admin', format($q$select public.billing_upgrade(%L, 'growth')::text$q$, tests.tid('a'))), 'ERR:42501', 'K8 DENY: an Admin cannot upgrade');
select is(pg_temp.val('a_owner', format($q$select public.billing_upgrade(%L, 'growth')::text$q$, tests.tid('a')), 'aal1'), 'ERR:SM306', 'K9 the Owner needs the second factor');
select is(pg_temp.j(pg_temp.val('a_owner', format($q$select public.billing_upgrade(%L, 'growth')::text$q$, tests.tid('a'))), 'invoice'), null, 'K10 upgrading during the trial changes the plan chosen; no invoice');
select is((select plan_id from public.billing_subscriptions where tenant_id = tests.tid('a')), 'growth', 'K11 the chosen plan is growth');
select is(pg_temp.m('a', 'call_minutes', 'plan_allowance'), '30', 'K12 the trial''s allowance still applies until the trial ends');
-- now a paid plan: starter on an active subscription, with prices (the catalogue is edited only here, with triggers off, inside this test)
select app.billing_edit(true);
update public.billing_subscriptions set status = 'active', plan_id = 'starter', current_period_start = '2026-10-20T09:00:00+05:30', current_period_end = '2026-11-20T09:00:00+05:30' where tenant_id = tests.tid('a');
update public.tenants set plan = 'starter' where id = tests.tid('a');
select app.billing_edit(false);
set session_replication_role = replica;
update billing.plan_versions set price_paise_monthly = 100000 where plan_id = 'starter';
update billing.plan_versions set price_paise_monthly = 300000 where plan_id = 'growth';
set session_replication_role = origin;
select is(pg_temp.m('a', 'call_minutes', 'plan_allowance') || '/' || pg_temp.m('a', 'call_minutes', 'included'), '0/true', 'K13 starter includes no call minutes (the packs still serve)');
create temp table prev1 as select pg_temp.val('a_owner', format($q$select public.billing_upgrade_preview(%L, 'growth')::text$q$, tests.tid('a')))::jsonb as r;
select is((select r ->> 'days_in_period' || '/' || (r ->> 'days_left') from prev1), '31/18', 'K14 31 days in the period, 18 left');
select is((select r ->> 'prorated_paise' || '/' || (r ->> 'gst_paise') || '/' || (r ->> 'total_paise') from prev1), '116129/20903/137032', 'K15 (300,000 - 100,000) x 18 / 31 = 116,129 paise, 18 percent GST 20,903, total 137,032');
select is((select r -> 'new_allowances' ->> 'call_minutes' || '/' || (r -> 'new_allowances' ->> 'whatsapp_messages') from prev1), '100/1000', 'K16 the new allowances are shown');
select is((select r ->> 'price_set' from prev1), 'true', 'K17 prices are set');
insert into public.business_profile (tenant_id, gstin)
select tests.tid('a'), '36ABCDE1234F1Z' || c from unnest(string_to_array('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', null)) c where app.gstin_is_valid('36ABCDE1234F1Z' || c);
update public.outreach_items set status = 'waiting_for_minutes' where batch_id = tests.rid('qb1') and contact_id = tests.rid('bc2') and false;
create temp table up1 as select pg_temp.val('a_owner', format($q$select public.billing_upgrade(%L, 'growth')::text$q$, tests.tid('a')))::jsonb as r;
select is((select r -> 'billing' -> 'plan' ->> 'id' from up1), 'growth', 'K18 the plan in force is growth now');
select is(pg_temp.m('a', 'call_minutes', 'plan_allowance') || '/' || pg_temp.m('a', 'whatsapp_messages', 'plan_allowance'), '100/1000', 'K19 the new allowance applies IMMEDIATELY (100 minutes, 1,000 messages)');
select is((select r -> 'invoice' ->> 'kind' || '/' || (r -> 'invoice' ->> 'taxable_paise') from up1), 'upgrade/116129', 'K20 an upgrade invoice for the pro-rata');
select is((select r -> 'invoice' ->> 'cgst_paise' || '/' || (r -> 'invoice' ->> 'sgst_paise') || '/' || (r -> 'invoice' ->> 'igst_paise') from up1), '10451/10452/0', 'K21 buyer GSTIN in the seller''s state (36): CGST + SGST (20,903 split 10,451 + 10,452), no IGST');
select is((select r -> 'invoice' -> 'buyer' ->> 'state_code' || '/' || (r -> 'invoice' -> 'seller' ->> 'state_code') from up1), '36/36', 'K22 the buyer''s state comes from the first two digits of the GSTIN');
select is((select r -> 'invoice' ->> 'total_paise' from up1), '137032', 'K23 total 137,032');
select is((select current_period_end from public.billing_subscriptions where tenant_id = tests.tid('a')), '2026-11-20T09:00:00+05:30'::timestamptz, 'K24 the period does not move');
select is(pg_temp.m('a', 'call_minutes', 'allowance'), '500', 'K25 the allowance is the plan''s 100 + the 125 minutes the packs already gave this period + the 275 still unused');
select is(pg_temp.val('a_owner', format($q$select public.billing_upgrade(%L, 'growth')::text$q$, tests.tid('a'))), 'ERR:SM835', 'K26 upgrading to the plan you are on is refused');
select is(pg_temp.val('a_owner', format($q$select public.billing_upgrade(%L, 'starter')::text$q$, tests.tid('a'))), 'ERR:SM835', 'K27 so is a step down');
select is(pg_temp.val('a_owner', format($q$select public.billing_upgrade(%L, 'business')::text$q$, tests.tid('a'))) ::jsonb -> 'invoice' ->> 'taxable_paise', '0', 'K28 with a price missing (business) the upgrade is allowed with a zero-rupee test invoice');
set session_replication_role = replica;
update billing.plan_versions set price_paise_monthly = null where plan_id in ('starter', 'growth');
set session_replication_role = origin;

-- ============================================================================ L. carry-over and the 90-day expiry
select pg_temp.pin('2026-12-05T11:00:00+05:30'::timestamptz);
select is(pg_temp.m('a', 'call_minutes', 'topup_balance'), '275.0', 'L1 in the next period the unused 275 minutes carried over');
select is(pg_temp.m('a', 'call_minutes', 'allowance') || '/' || pg_temp.m('a', 'call_minutes', 'used'), '575/0.0', 'L2 the allowance is business''s 300 + the carried 275, nothing used yet');
select pg_temp.use('a', 'call_minutes', 'l1', 20400);
select is(pg_temp.draws('a', 'p2'), 3900::bigint, 'L3 340 minutes used in December: 300 from the plan, then 40 minutes (2,400 s) from the pack; its draws add up to 3,900 s');
select pg_temp.pin('2027-01-30T11:00:00+05:30'::timestamptz);
select is(pg_temp.m('a', 'call_minutes', 'topup_balance'), '235.0', 'L4 on 30 January the pack still has 235 minutes (it expires on 31 January at 11:01)');
select pg_temp.pin('2027-02-02T11:00:00+05:30'::timestamptz);
select is(pg_temp.m('a', 'call_minutes', 'topup_balance'), '0.0', 'L5 on 2 February it has expired: the unused minutes are gone');
select is(pg_temp.topups('a_owner', 'a', 'balance.call_minutes.lots'), '[]', 'L6 no lot is left');
select is(pg_temp.val('a_owner', format($q$select (select (h ->> 'expired') from jsonb_array_elements(public.billing_topups_get(%L) -> 'history') h where h ->> 'id' = %L)$q$, tests.tid('a'), tests.rid('p2'))), 'true', 'L7 the history says the pack expired');
select is(pg_temp.m('a', 'call_minutes', 'allowance'), '300', 'L8 the allowance is the plan''s again');
select is(pg_temp.m('a', 'call_minutes', 'next_topup_expiry'), null, 'L9 no pack is waiting to expire');

-- ============================================================================ M. guards
select pg_temp.pin('2026-11-02T11:00:00+05:30'::timestamptz);
select is(pg_temp.sc($$update public.billing_invoices set total_paise = 1$$), '42501', 'M1 an invoice is never changed');
select is(pg_temp.sc($$delete from public.billing_topup_purchases$$), '42501', 'M2 a purchase is never deleted');
select is(pg_temp.sc($$update public.billing_topup_draws set units = 1$$), '42501', 'M3 a draw is never changed');
select is(pg_temp.sc($$truncate public.billing_alert_sends$$), '42501', 'M4 the alert record is never truncated');
select is(pg_temp.val('a_owner', format($q$insert into public.billing_invoices (tenant_id, number, kind, description, taxable_paise, gst_rate_bp, total_paise, seller_name, seller_state_code, payment_status) values (%L, 'S19-2611-999999', 'topup', 'x y z', 0, 0, 0, 'abc', '36', 'paid_fake')$q$, tests.tid('a'))), 'ERR:42501', 'M5 a client cannot write an invoice');
select is(pg_temp.val('a_owner', format($q$update public.billing_topup_settings set overage_monthly_cap_paise = 1 where tenant_id = %L$q$, tests.tid('b'))), 'ERR:42501', 'M6 nor the settings');
select is(pg_temp.sc(format($q$update public.billing_topup_settings set tenant_id = %L where tenant_id = %L$q$, tests.tid('a'), tests.tid('b'))), '42501', 'M7 a settings row cannot move to another workspace');
select is((select count(*) > 0 from public.audit_events where entity_type = 'billing_topup_purchase' and tenant_id = tests.tid('a')), true, 'M8 the purchases are in the audit log under the workspace');
select is((select count(*) > 0 from public.audit_events where entity_type = 'billing_invoice' and tenant_id = tests.tid('a')), true, 'M9 so are the invoices');
select is(pg_temp.sc($$select app.today_usage_items(null)$$), 'ok', 'M10 Today''s helper answers nothing for nobody');

select * from finish();
rollback;
