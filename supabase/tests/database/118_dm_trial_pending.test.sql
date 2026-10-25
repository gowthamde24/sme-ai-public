-- Job DM (migration 20261129090400, owner decision 25 Oct 2026): a workspace that chose a plan but has not connected WhatsApp is `trial_pending`: nothing is charged, it can set up everything, but sending, AI calls and
-- campaign sends stay off until WhatsApp is connected; it never goes read-only for waiting; it is reminded by e-mail after 30, 60 and 90 days. All behind the platform switch `billing_enforced`.
--   A the status   B the hold (switch ON)   C the switch OFF   D the reminders   E connecting   F cancelling   G doors
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
create function pg_temp.sub(p_tenant text, p_key text) returns text language sql as $$ select to_jsonb(s) ->> p_key from public.billing_subscriptions s where s.tenant_id = tests.tid(p_tenant) $$;
create function pg_temp.msg(p_name text, p_category text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by)
  select tests.rid(p_name), tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), tests.rid(p_tenant || '_contact'), 'whatsapp', 'Synthetic message ' || p_name, 'en', p_category, 'queued', 'auto_allowed', md5(p_name) || md5(p_name), tests.uid(p_tenant || '_owner');
end $$;
create function pg_temp.q(p_value anyelement) returns void language plpgsql as $$ begin end $$;
create function pg_temp.due() returns jsonb language sql as $$ select pg_temp.val('x5', 'select public.scheduler_billing_pending_due()::text')::jsonb $$;

-- workspace a chose a plan with no WhatsApp: trial_pending
select pg_temp.val('a_owner', format($q$select public.billing_start_trial(%L, 'growth', 'fake', 'sub_fake_p1')::text$q$, tests.tid('a')));
-- ============================================================================ A. the status
select is(pg_temp.sub('a', 'status') || '/' || coalesce(pg_temp.sub('a', 'trial_ends_at'), 'no end'), 'trial_pending/no end', 'A1 the plan is chosen, the 14 days have not begun');
select is(pg_temp.val('a_owner', format($q$select public.billing_get(%L) -> 'subscription' ->> 'trial_waiting_for'$q$, tests.tid('a'))), 'whatsapp', 'A2 the answer says it is waiting for whatsapp');
select is(pg_temp.val('a_owner', format($q$select public.billing_get(%L) ->> 'access'$q$, tests.tid('a'))), 'full', 'A3 it can set everything up: access is full');
select is((select count(*)::int from public.billing_events where tenant_id = tests.tid('a') and kind like 'charge%'), 0, 'A4 nothing is charged');
select is(app.billing_access_until(tests.tid('a')), null, 'A5 waiting never lapses it');

-- ============================================================================ B. the hold (switch ON)
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select app.operator_set_billing_enforced(true);
select pg_temp.msg('p1', 'followup');
select pg_temp.msg('p2', 'reply_to_inbound');
select is(jsonb_array_length(app.outbox_claim_due_core(tests.tid('a'), 10, false)), 0, 'B1 SENDING is off: the claim hands out nothing, not even a reply');
select is((select string_agg(status || '/' || attempts::text, ',' order by body) from public.outbox_messages where id in (tests.rid('p1'), tests.rid('p2'))), 'queued/0,queued/0', 'B2 ...the messages stay queued, untouched: nothing is lost');
select is(app.billing_pending(tests.tid('a')), true, 'B3 the hold is the pending status');
select is(pg_temp.val('a_owner', format($q$select public.billing_check_usage(%L, 'call_minutes') ->> 'allowed'$q$, tests.tid('a'))), 'false', 'B4 AI CALLS are off: the call start is refused');
select is(pg_temp.val('a_owner', format($q$select public.billing_check_usage(%L, 'whatsapp_messages') ->> 'allowed'$q$, tests.tid('a'))), 'false', 'B5 business-initiated messages are stopped too');
select is(pg_temp.val('a_owner', format($q$select public.billing_access(%L) ->> 'access'$q$, tests.tid('a'))), 'full', 'B6 yet the workspace is not read-only: everything else can be set up');
select pg_temp.msg('p3', 'followup', 'b');
select pg_temp.q(app.outbox_claim_due_core(tests.tid('b'), 10, false));
select isnt((select status || '/' || attempts::text from public.outbox_messages where id = tests.rid('p3')), 'queued/0', 'B7 another workspace is served as before');
update public.tenants set billing_exempt = true where id = tests.tid('a');
select is(app.billing_pending(tests.tid('a')), false, 'B8 an exempt workspace (Customer Zero, a demo) is never held');
update public.tenants set billing_exempt = false where id = tests.tid('a');

-- ============================================================================ C. the switch OFF
select app.operator_set_billing_enforced(false);
select is(app.billing_pending(tests.tid('a')), false, 'C1 with the switch OFF nothing is held');
select is(jsonb_array_length(pg_temp.due()), 0, 'C2 ...and no reminder is due');
select pg_temp.q(app.outbox_claim_due_core(tests.tid('a'), 10, false));
select isnt((select status || '/' || attempts::text from public.outbox_messages where id = tests.rid('p1')), 'queued/0', 'C3 the held message is served (handled) at the next claim: nothing was lost');

-- ============================================================================ D. the reminders (switch ON)
select app.operator_set_billing_enforced(true);
select is(jsonb_array_length(pg_temp.due()), 0, 'D1 day 0: none due');
select pg_temp.pin('2026-11-24T12:00:00+05:30'::timestamptz);   -- 29 days
select is(jsonb_array_length(pg_temp.due()), 0, 'D2 day 29: none due');
select pg_temp.pin('2026-11-25T12:00:01+05:30'::timestamptz);   -- 30 days
select is(pg_temp.due() -> 0 ->> 'day', '30', 'D3 day 30: the first reminder is due');
select is(jsonb_array_length(pg_temp.due() -> 0 -> 'emails') >= 1, true, 'D4 ...for the Owners'' addresses');
select is(pg_temp.due() -> 0 ->> 'tenant_name', (select name from public.tenants where id = tests.tid('a')), 'D5 ...with the business name');
select is(pg_temp.val('x5', format($q$select public.scheduler_billing_pending_mark(%L, 30)::text$q$, tests.tid('a'))), '{"marked": 30}', 'D6 the worker marks it');
select is(jsonb_array_length(pg_temp.due()), 0, 'D7 once marked it is not due again');
select pg_temp.pin('2027-01-10T12:00:00+05:30'::timestamptz);   -- 76 days: day 60 is the latest that has come
select is(pg_temp.due() -> 0 ->> 'day', '60', 'D8 day 76: the latest reminder that has come (60) is due, not a pile of them');
select pg_temp.val('x5', format($q$select public.scheduler_billing_pending_mark(%L, 60)::text$q$, tests.tid('a')));
select pg_temp.pin('2027-02-01T12:00:00+05:30'::timestamptz);   -- 98 days
select is(pg_temp.due() -> 0 ->> 'day', '90', 'D9 day 98: the third and last');
select pg_temp.val('x5', format($q$select public.scheduler_billing_pending_mark(%L, 90)::text$q$, tests.tid('a')));
select pg_temp.pin('2027-03-01T12:00:00+05:30'::timestamptz);
select is(jsonb_array_length(pg_temp.due()), 0, 'D10 after the third there is none');
select is(pg_temp.val('x5', format($q$select public.scheduler_billing_pending_mark(%L, 45)::text$q$, tests.tid('a'))), 'ERR:22023', 'D11 a day other than 30, 60, 90 is refused');
select is(pg_temp.val('a_owner', 'select public.scheduler_billing_pending_due()::text'), 'ERR:42501', 'D12 DENY: an Owner cannot ask (the scheduler account only)');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_billing_pending_mark(%L, 30)::text$q$, tests.tid('a'))), 'ERR:42501', 'D13 DENY: nor mark');
select is(pg_temp.val('anon', 'select public.scheduler_billing_pending_due()::text'), 'ERR:42501', 'D14 DENY: anon');

-- ============================================================================ E. connecting WhatsApp
select pg_temp.pin('2026-12-01T12:00:00+05:30'::timestamptz);
insert into integrations.whatsapp_accounts (tenant_id, waba_id, phone_number_id, display_phone, token_ref, status) values (tests.tid('a'), '1234567890', '555000333', '+910000000000', 'SYNTHETIC_TOKEN_REF', 'active');
select is(pg_temp.sub('a', 'status'), 'trialing', 'E1 WhatsApp connected: trialing');
select is(pg_temp.sub('a', 'trial_ends_at')::timestamptz, '2026-12-15T12:00:00+05:30'::timestamptz, 'E2 ...the 14 days begin on the connected day');
select is(app.billing_pending(tests.tid('a')), false, 'E3 sending and calls are on again');
select is(jsonb_array_length(app.outbox_claim_due_core(tests.tid('a'), 10, false)) >= 0, true, 'E4 the claim serves the workspace');
select is(pg_temp.val('a_owner', format($q$select public.billing_check_usage(%L, 'call_minutes') ->> 'allowed'$q$, tests.tid('a'))), 'true', 'E5 a call may begin (within the trial allowance)');
select is(jsonb_array_length(pg_temp.due()), 0, 'E6 no more reminders');

-- ============================================================================ F. cancelling
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);
select pg_temp.val('b_owner', format($q$select public.billing_start_trial(%L, 'starter', 'fake', 'sub_fake_p2')::text$q$, tests.tid('b')));
select is(pg_temp.sub('b', 'status'), 'trial_pending', 'F1 workspace b chose a plan too');
select is(pg_temp.val('b_owner', format($q$select public.billing_cancel(%L) -> 'subscription' ->> 'status'$q$, tests.tid('b'))), 'cancelled', 'F2 cancelling a pending trial ends it at once');
select is((select count(*)::int from public.billing_events where tenant_id = tests.tid('b') and kind like 'charge%'), 0, 'F3 nothing was ever charged');
select is(app.billing_pending(tests.tid('b')), false, 'F4 and nothing is held any more');

-- ============================================================================ G. doors
select is((select count(*)::int from pg_policies where tablename = 'billing_pending_reminders' and cmd <> 'SELECT'), 0, 'G1 the reminders table has no write policy');
select is((select has_table_privilege('authenticated', 'public.billing_pending_reminders', 'insert') or has_table_privilege('authenticated', 'public.billing_pending_reminders', 'update')), false, 'G2 a client cannot write it');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('scheduler_billing_pending_due', 'scheduler_billing_pending_mark')
              and p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute')), 2, 'G3 both worker functions are SECURITY DEFINER with an empty search_path, closed to anon');
select is((select count(*)::int from pg_constraint where conrelid = 'public.billing_subscriptions'::regclass and pg_get_constraintdef(oid) like '%trial_pending%'), 1, 'G4 the status list knows trial_pending');

select * from finish();
rollback;
