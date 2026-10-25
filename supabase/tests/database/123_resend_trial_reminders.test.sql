-- Job RESEND (migration 20261130100000): the trial reminders on day 11 and day 13 of the 14-day trial, and the language of the reminder e-mails. Behind the platform switch `billing_enforced`.
--   A day 11   B day 13   C once   D what is not reminded   E the language   F doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-01T12:00:00+05:30'::timestamptz);
select app.operator_register_scheduler('x5@test.local');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.due() returns jsonb language sql as $$ select pg_temp.val('x5', 'select public.scheduler_billing_trial_due()::text')::jsonb $$;
create function pg_temp.mark(p_tenant text, p_day int) returns text language sql as $$ select pg_temp.val('x5', format($q$select public.scheduler_billing_trial_mark(%L, %s)::text$q$, tests.tid(p_tenant), p_day)) $$;

-- tenant a: a 14-day trial that began 2026-11-01 12:00 IST (so it ends 2026-11-15 12:00)
select app.billing_edit(true);
insert into public.billing_subscriptions (tenant_id, plan_id, catalogue_version, status, provider, provider_ref, payment_method_on_file, trial_started_at, trial_ends_at, updated_by)
select tests.tid('a'), 'growth', (select max(version) from billing.catalogue_versions), 'trialing', 'fake', 'sub_fake_t1', true, '2026-11-01T12:00:00+05:30', '2026-11-15T12:00:00+05:30', tests.uid('a_owner');
select app.billing_edit(false);
select app.operator_set_billing_enforced(true);

-- ============================================================================ A. day 11
select pg_temp.pin('2026-11-11T11:59:00+05:30'::timestamptz);
select is(jsonb_array_length(pg_temp.due()), 0, 'A1 just before day 11: none due');
select pg_temp.pin('2026-11-12T12:00:01+05:30'::timestamptz);
select is(pg_temp.due() -> 0 ->> 'day', '11', 'A2 day 11 (3 days left): the first reminder is due');
select is(jsonb_array_length(pg_temp.due() -> 0 -> 'emails') >= 1, true, 'A3 ...for the Owners'' addresses');
select is(pg_temp.due() -> 0 ->> 'tenant_name', (select name from public.tenants where id = tests.tid('a')), 'A4 ...with the business name');

-- ============================================================================ C. once
select is(pg_temp.mark('a', 11), '{"marked": 11}', 'C1 the worker marks it');
select is(jsonb_array_length(pg_temp.due()), 0, 'C2 once marked, not due again');
select is(pg_temp.mark('a', 11), '{"marked": 11}', 'C3 marking twice changes nothing');
select is((select count(*)::int from public.billing_trial_reminders where tenant_id = tests.tid('a')), 1, 'C4 one row');

-- ============================================================================ B. day 13
select pg_temp.pin('2026-11-14T12:00:01+05:30'::timestamptz);
select is(pg_temp.due() -> 0 ->> 'day', '13', 'B1 day 13 (1 day left): the second reminder is due');
select is(pg_temp.mark('a', 13), '{"marked": 13}', 'B2 marked');
select is(jsonb_array_length(pg_temp.due()), 0, 'B3 none left');

-- ============================================================================ D. what is not reminded
select pg_temp.pin('2026-11-12T12:00:01+05:30'::timestamptz);
select app.billing_edit(true);
delete from public.billing_trial_reminders;
select app.billing_edit(false);
select is(jsonb_array_length(pg_temp.due()), 1, 'D1 (sanity) due again after the marks are cleared');
select pg_temp.pin('2026-11-15T12:00:01+05:30'::timestamptz);
select is(jsonb_array_length(pg_temp.due()), 0, 'D2 after the trial ended nothing is sent (the e-mail would be wrong)');
select pg_temp.pin('2026-11-12T12:00:01+05:30'::timestamptz);
update public.tenants set billing_exempt = true where id = tests.tid('a');
select is(jsonb_array_length(pg_temp.due()), 0, 'D3 an exempt workspace is never reminded');
update public.tenants set billing_exempt = false where id = tests.tid('a');
select app.operator_set_billing_enforced(false);
select is(jsonb_array_length(pg_temp.due()), 0, 'D4 with the billing switch off nothing is due');
select app.operator_set_billing_enforced(true);
select app.billing_edit(true);
update public.billing_subscriptions set status = 'cancelled' where tenant_id = tests.tid('a');
select app.billing_edit(false);
select is(jsonb_array_length(pg_temp.due()), 0, 'D5 a cancelled trial is not reminded');
select is(pg_temp.mark('a', 11), 'ERR:22023', 'D6 marking a workspace that is not trialing is invalid');

-- ============================================================================ E. the language
select app.billing_edit(true);
update public.billing_subscriptions set status = 'trialing' where tenant_id = tests.tid('a');
select app.billing_edit(false);
select is(pg_temp.due() -> 0 ->> 'language', 'en', 'E1 no assistant settings saved: English');
select is(pg_temp.val('x5', 'select public.scheduler_billing_pending_due()::text') like 'ERR%', false, 'E2 the pending reminders still answer (with the language too)');

-- ============================================================================ F. doors
select is(pg_temp.val('a_owner', 'select public.scheduler_billing_trial_due()::text'), 'ERR:42501', 'F1 DENY: an Owner cannot ask (the scheduler account only)');
select is(pg_temp.val('anon', 'select public.scheduler_billing_trial_due()::text'), 'ERR:42501', 'F2 DENY: anon');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_billing_trial_mark(%L, 11)::text$q$, tests.tid('a'))), 'ERR:42501', 'F3 DENY: an Owner cannot mark');
select is(pg_temp.mark('a', 12), 'ERR:22023', 'F4 only days 11 and 13 exist');
select is(pg_temp.val('x5', 'select public.scheduler_billing_trial_due(0)::text'), 'ERR:22023', 'F5 a limit of 0 is invalid');

select * from finish();
rollback;
