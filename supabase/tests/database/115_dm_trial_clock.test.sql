-- Job DM (C1 part; migrations 20261129090100 and 20261129090200): THE TRIAL IS 14 DAYS, COUNTED FROM THE DAY WHATSAPP IS CONNECTED.
--   A the catalogue   B the day WhatsApp was connected   C no subscription yet   D starting the trial   E a trial that waits   F connecting WhatsApp starts the 14 days   G the worker tells the provider   H what the screens are told   I doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.sub(p_tenant text, p_key text) returns text language sql as $$ select to_jsonb(s) ->> p_key from public.billing_subscriptions s where s.tenant_id = tests.tid(p_tenant) $$;
create function pg_temp.start(p_user text, p_tenant text, p_ref text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.billing_start_trial(%L, 'growth', 'fake', %L)::text$q$, tests.tid(p_tenant), p_ref)) $$;
create function pg_temp.wa(p_tenant text, p_phone text, p_status text) returns void language sql as $$
  insert into integrations.whatsapp_accounts (tenant_id, waba_id, phone_number_id, display_phone, token_ref, status) values (tests.tid(p_tenant), '1234567890', p_phone, '+910000000000', 'SYNTHETIC_TOKEN_REF', p_status) $$;
create function pg_temp.access(p_tenant text) returns text language sql as $$ select app.billing_lapse(tests.tid(p_tenant)) ->> 'access' $$;
create function pg_temp.until(p_tenant text) returns timestamptz language sql as $$ select app.billing_access_until(tests.tid(p_tenant)) $$;
create function pg_temp.due() returns jsonb language sql as $$ select pg_temp.val('x5', 'select public.scheduler_billing_trial_clocks_due()::text')::jsonb $$;

-- ============================================================================ A. the catalogue
select is((select trial_days || '/' || trial_starts_on || '/' || setup_days from billing.catalogue_versions where version = 2), '14/whatsapp_connected/30', 'A1 catalogue version 2: 14 days from the day WhatsApp is connected, 30 days of setup without it');
select is((select trial_days || '/' || trial_starts_on || '/' || setup_days from billing.catalogue_versions where version = 1), '30/sign_up/30', 'A2 version 1 is as it was (30 days from the start): a synced version is never edited');
select is((select count(*)::int from billing.plan_versions where catalogue_version = 2), 7, 'A3 version 2 carries the seven plans');
select is((select manifest -> 'trial' ->> 'starts_on' from billing.catalogue_versions where version = 2), 'whatsapp_connected', 'A4 the manifest in the database says so too');
select is((select count(*)::int from billing.plan_versions p join billing.plan_versions q on q.plan_id = p.plan_id and q.catalogue_version = 1
            where p.catalogue_version = 2 and (p.call_minutes is distinct from q.call_minutes or p.whatsapp_messages is distinct from q.whatsapp_messages or p.price_paise_monthly is distinct from q.price_paise_monthly)), 0, 'A5 only the trial changed: every allowance and price is the same as in version 1');
select is(pg_temp.sc($$update billing.catalogue_versions set trial_days = 7 where version = 2$$), '42501', 'A6 a synced version is never edited (the guard)');

-- ============================================================================ B. the day WhatsApp was connected
select pg_temp.wa('b', '555000111', 'pending');
select is((select connected_at from integrations.whatsapp_accounts where tenant_id = tests.tid('b')), null, 'B1 a number that is only pending has no connected day');
update integrations.whatsapp_accounts set status = 'active' where tenant_id = tests.tid('b');
select is((select connected_at from integrations.whatsapp_accounts where tenant_id = tests.tid('b')), '2026-10-26T12:00:00+05:30'::timestamptz, 'B2 the day it first became active');
select pg_temp.pin('2026-11-02T12:00:00+05:30'::timestamptz);
update integrations.whatsapp_accounts set status = 'disabled' where tenant_id = tests.tid('b');
update integrations.whatsapp_accounts set status = 'active' where tenant_id = tests.tid('b');
select is((select connected_at from integrations.whatsapp_accounts where tenant_id = tests.tid('b')), '2026-10-26T12:00:00+05:30'::timestamptz, 'B3 switched off and on again, it keeps its FIRST day');
update integrations.whatsapp_accounts set connected_at = now() where tenant_id = tests.tid('b');
select is((select connected_at from integrations.whatsapp_accounts where tenant_id = tests.tid('b')), '2026-10-26T12:00:00+05:30'::timestamptz, 'B4 an update that tries to move it is kept as it was');
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);
select is(pg_temp.val('b_owner', format($q$select count(*)::text from integrations.whatsapp_accounts where tenant_id = %L$q$, tests.tid('b'))), 'ERR:42501', 'B5 DENY: the table is not readable by a client at all');

-- ============================================================================ C. no subscription yet (switch ON)
select app.operator_set_billing_enforced(true);
update public.tenants set trial_started_at = '2026-09-20T09:00:00+05:30' where id = tests.tid('a');   -- made on 20 September, WhatsApp never connected
select is(pg_temp.until('a'), '2026-10-20T09:00:00+05:30'::timestamptz, 'C1 never connected: the 30 setup days from the day it was made');
select is(pg_temp.access('a'), 'read_only', 'C2 ...and they have passed on 26 October: read-only');
select is(pg_temp.until('b'), '2026-11-09T12:00:00+05:30'::timestamptz, 'C3 connected on 26 October: the 14 days end on 9 November');
select is(pg_temp.access('b'), 'full', 'C4 ...so on 26 October it is full');
select pg_temp.pin('2026-11-10T12:00:01+05:30'::timestamptz);
select is(pg_temp.access('b'), 'read_only', 'C5 after the 14 days with no subscription: read-only');
select is(pg_temp.val('b_owner', format($q$select public.billing_get(%L) ->> 'read_only_since'$q$, tests.tid('b'))), '2026-11-09', 'C6 read-only since the day the 14 days ended');
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);
select app.operator_set_billing_enforced(false);
select is(pg_temp.access('a'), 'full', 'C7 with the switch OFF everything is full whatever the dates say');

-- ============================================================================ D. starting the trial
select is(pg_temp.start('a_owner', 'a', 'sub_fake_a1') like '%"trial_waiting_for": "whatsapp"%', true, 'D1 a plan chosen before WhatsApp is connected WAITS: trial_waiting_for = whatsapp');
select is(pg_temp.sub('a', 'trial_ends_at'), null, 'D2 ...with no end date');
select is(pg_temp.sub('a', 'status') || '/' || pg_temp.sub('a', 'payment_method_on_file'), 'trial_pending/true', 'D3 ...status trial_pending, a payment method on file');
select is(pg_temp.sub('a', 'catalogue_version'), '3', 'D4 it started under version 3 (the current catalogue)');
select is(pg_temp.start('b_owner', 'b', 'sub_fake_b1') like '%"trial_waiting_for": null%' and pg_temp.sub('b', 'status') = 'trialing', true, 'D5 with WhatsApp connected already the trial does not wait: trialing');
select is(pg_temp.sub('b', 'trial_ends_at')::timestamptz, '2026-11-09T12:00:00+05:30'::timestamptz, 'D6 ...and ends 14 days after the connected day (26 October + 14 = 9 November)');
select is((select count(*)::int from public.billing_events where tenant_id = tests.tid('a') and kind = 'trial_started'), 1, 'D7 one trial_started event');

-- ============================================================================ E. a trial that waits
select app.operator_set_billing_enforced(true);
select is(pg_temp.until('a'), null, 'E1 a plan that waits for WhatsApp never lapses by waiting (it is reminded instead)');
select pg_temp.pin('2027-03-01T12:00:01+05:30'::timestamptz);
select is(pg_temp.access('a'), 'full', 'E2 ...not even months later: full');
select pg_temp.pin('2026-11-10T11:00:00+05:30'::timestamptz);
select is(pg_temp.until('b'), '2026-11-10T12:00:00+05:30'::timestamptz, 'E3 a trial with its end: access runs one day past the end (the first charge is expected then)');
select is(pg_temp.access('b'), 'full', 'E4 ...so on 10 November at 11:00 it is still full');
select pg_temp.pin('2026-11-10T12:00:01+05:30'::timestamptz);
select is(pg_temp.access('b'), 'read_only', 'E5 ...and read-only once that day has passed with no charge');
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);
select is(pg_temp.val('x5', 'select public.scheduler_billing_trial_clocks_due()::text')::jsonb -> 0 ->> 'provider_ref', 'sub_fake_b1', 'E6 the worker is asked to pass on only the trial whose end is known (b), not the one that waits (a)');
select is(jsonb_array_length(pg_temp.due()), 1, 'E7 ...one row');
select app.operator_set_billing_enforced(false);

-- ============================================================================ F. connecting WhatsApp starts the 14 days
select pg_temp.pin('2026-11-01T12:00:00+05:30'::timestamptz);
select pg_temp.wa('a', '555000222', 'pending');
select is(pg_temp.sub('a', 'trial_ends_at'), null, 'F1 a pending number does not start the clock');
update integrations.whatsapp_accounts set status = 'active' where tenant_id = tests.tid('a');
select is(pg_temp.sub('a', 'trial_ends_at')::timestamptz, '2026-11-15T12:00:00+05:30'::timestamptz, 'F2 the day the number becomes active the 14 days start (1 November + 14 = 15 November)');
select is((select count(*)::int from public.billing_events where tenant_id = tests.tid('a') and kind = 'trial_clock_started'), 1, 'F3 one trial_clock_started event');
select pg_temp.pin('2026-11-05T12:00:00+05:30'::timestamptz);
update integrations.whatsapp_accounts set status = 'disabled' where tenant_id = tests.tid('a');
update integrations.whatsapp_accounts set status = 'active' where tenant_id = tests.tid('a');
select is(pg_temp.sub('a', 'trial_ends_at')::timestamptz, '2026-11-15T12:00:00+05:30'::timestamptz, 'F4 switching the number off and on does not restart the trial');
select is((select count(*)::int from public.billing_events where tenant_id = tests.tid('a') and kind = 'trial_clock_started'), 1, 'F5 ...and makes no second event');
select is(pg_temp.sub('a', 'status'), 'trialing', 'F6 the status turned from trial_pending to trialing');

-- ============================================================================ G. the worker tells the provider
select pg_temp.pin('2026-11-05T13:00:00+05:30'::timestamptz);
select is(jsonb_array_length(pg_temp.due()), 2, 'G1 both trials now have an end date and none has been passed on');
select is(pg_temp.val('x5', format($q$select public.scheduler_billing_trial_clock_mark(%L)::text$q$, tests.tid('a'))), '{"marked": true}', 'G2 the worker marks a done');
select is(jsonb_array_length(pg_temp.due()), 1, 'G3 only b is left');
select is(pg_temp.sub('a', 'provider_clock_set_at')::timestamptz, '2026-11-05T13:00:00+05:30'::timestamptz, 'G4 the mark carries the time');
select is(pg_temp.val('x5', format($q$select public.scheduler_billing_trial_clock_mark(%L)::text$q$, tests.tid('a'))), '{"marked": true}', 'G5 marking again is harmless');
select is(pg_temp.sub('a', 'provider_clock_set_at')::timestamptz, '2026-11-05T13:00:00+05:30'::timestamptz, 'G6 ...and does not move the time');
select is(pg_temp.val('x5', format($q$select public.scheduler_billing_trial_clock_mark(%L)::text$q$, gen_random_uuid())), 'ERR:22023', 'G7 an unknown workspace is refused');
select is(pg_temp.val('a_owner', 'select public.scheduler_billing_trial_clocks_due()::text'), 'ERR:42501', 'G8 DENY: an Owner cannot ask (the scheduler account only)');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_billing_trial_clock_mark(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'G9 DENY: nor mark');
select is(pg_temp.val('anon', 'select public.scheduler_billing_trial_clocks_due()::text'), 'ERR:42501', 'G10 DENY: anon');
select is(pg_temp.val('x5', 'select public.scheduler_billing_trial_clocks_due(0)::text'), 'ERR:22023', 'G11 a limit of 0 is refused');

-- ============================================================================ H. what the screens are told
select is(pg_temp.val('a_owner', format($q$select coalesce(public.billing_get(%L) -> 'subscription' ->> 'trial_waiting_for', 'none')$q$, tests.tid('a'))), 'none', 'H1 billing_get: the trial no longer waits once WhatsApp is connected');
select is(pg_temp.val('a_owner', format($q$select (public.billing_get(%L) ->> 'whatsapp_connected_at')::timestamptz::text$q$, tests.tid('a'))), (select '2026-11-01 12:00:00+05:30'::timestamptz::text), 'H2 ...and says the day it was connected');
select is(pg_temp.val('a_owner', 'select public.billing_plans() -> ''trial'' ->> ''starts_on'''), 'whatsapp_connected', 'H3 billing_plans: the rule is in the catalogue answer');
select is(pg_temp.val('a_owner', 'select public.billing_plans() -> ''trial'' ->> ''days'''), '14', 'H4 ...14 days');
select is(pg_temp.val('a_owner', 'select public.billing_plans() -> ''trial'' ->> ''setup_days_without_whatsapp'''), '30', 'H5 ...and the setup days');
select is(pg_temp.val('a_owner', format($q$select (public.billing_get(%L) ->> 'access')$q$, tests.tid('a'))), 'full', 'H6 the access keys are still there (full while the switch is off)');

-- ============================================================================ I. doors
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('scheduler_billing_trial_clocks_due', 'scheduler_billing_trial_clock_mark')
              and p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute')), 2, 'I1 both worker functions are SECURITY DEFINER, with an empty search_path, closed to anon');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('billing_trial_clock', 'wa_connected_billing', 'wa_connected_at_set')
              and has_function_privilege('authenticated', p.oid, 'execute')), 0, 'I2 the trigger functions are not callable by a client');
select is(pg_temp.val('a_owner', format($q$select app.billing_trial_clock(%L, now())::text$q$, tests.tid('a'))), 'ERR:42501', 'I3 DENY: nobody can start a trial clock by hand');

select * from finish();
rollback;
