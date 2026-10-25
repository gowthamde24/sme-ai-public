-- Job DP part 3 (migration 20261130090100): READ-ONLY EVERYWHERE and PAYING AGAIN.
--   A the answers   B paying again after a lapse   C after a cancel   D who may   E what cannot resume   F no new trial after a lapse   G the worker leaves a read-only workspace alone
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);
-- workspace a began its free trial on 1 September and chose no plan (it ended long ago); workspace b began on 10 October
update public.tenants set trial_started_at = '2026-09-01T09:00:00+05:30' where id = tests.tid('a');
update public.tenants set trial_started_at = '2026-10-10T09:00:00+05:30' where id = tests.tid('b');
select app.operator_register_scheduler('x8@test.local');

create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.val1(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.get(p_user text, p_key text, p_tenant text default 'a') returns text language sql as $$
  select case when r like 'ERR:%' then r else (r::jsonb ->> p_key) end from (select pg_temp.val(p_user, format($q$select public.billing_get(%L)::text$q$, tests.tid(p_tenant))) r) x $$;
create function pg_temp.acc(p_user text, p_key text, p_tenant text default 'a') returns text language sql as $$
  select case when r like 'ERR:%' then r else (r::jsonb ->> p_key) end from (select pg_temp.val(p_user, format($q$select public.billing_access(%L)::text$q$, tests.tid(p_tenant))) r) x $$;
create function pg_temp.resume(p_user text, p_tenant text, p_plan text default 'growth', p_ref text default 'sub_fake_resume1') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.billing_resume(%L, %L, 'fake', %L)::text$q$, tests.tid(p_tenant), p_plan, p_ref)) $$;

-- ============================================================================ A. the answers
select is(pg_temp.acc('a_owner', 'can_resume'), 'false', 'A1 the switch is OFF: nothing has lapsed (every workspace is full)');
select is(pg_temp.acc('a_owner', 'sending'), 'on', 'A2 ...and sending is on');
select is(pg_temp.get('a_owner', 'can_start_trial'), 'false', 'A3 (the free trial of a ended a fortnight ago: after a lapse there is no new trial, whatever the switch says)');
select app.operator_set_billing_enforced(true);
select is(pg_temp.acc('a_owner', 'access'), 'read_only', 'A4 SWITCH ON: workspace a is read-only');
select is(pg_temp.acc('a_owner', 'can_resume'), 'true', 'A5 ...and can pay again');
select is(pg_temp.acc('a_owner', 'sending'), 'off', 'A6 sending is off');
select is(pg_temp.acc('a_owner', 'waiting_for'), null, 'A7 it is not waiting for WhatsApp');
select is(pg_temp.acc('b_owner', 'access') || '/' || pg_temp.acc('b_owner', 'can_resume') || '/' || pg_temp.acc('b_owner', 'sending'), 'full/false/on', 'A8 workspace b (inside its free trial) is full, cannot resume, sends');
select is(pg_temp.acc('a_viewer', 'can_resume'), 'true', 'A9 every member sees the access answer');
select is(pg_temp.get('a_owner', 'can_resume'), 'true', 'A10 the plan screen answer carries can_resume too');

-- ============================================================================ F. no new trial after a lapse
select is(pg_temp.val('a_owner', format($q$select public.billing_start_trial(%L, 'growth', 'fake', 'sub_fake_t1')::text$q$, tests.tid('a'))), 'ERR:SM822', 'F1 a lapsed workspace cannot start a new trial (SM822)');
select is(pg_temp.get('a_owner', 'can_start_trial'), 'false', 'F2 the plan screen says so');
select is(pg_temp.val('b_owner', format($q$select public.billing_start_trial(%L, 'growth', 'fake', 'sub_fake_t2')::text$q$, tests.tid('b'))) like 'ERR%', false, 'F3 a workspace that has not lapsed starts its trial as before');

-- ============================================================================ D. who may
select is(pg_temp.resume('a_admin', 'a'), 'ERR:42501', 'D1 DENY: an Admin');
select is(pg_temp.resume('a_sales', 'a'), 'ERR:42501', 'D2 DENY: Sales');
select is(pg_temp.resume('a_viewer', 'a'), 'ERR:42501', 'D3 DENY: a Viewer');
select is(pg_temp.resume('b_owner', 'a'), 'ERR:42501', 'D4 DENY: another business''s Owner');
select is(pg_temp.resume('anon', 'a'), 'ERR:42501', 'D5 DENY: anon');
select is(pg_temp.val1('a_owner', format($q$select public.billing_resume(%L, 'growth', 'fake', 'sub_fake_resume1')::text$q$, tests.tid('a'))), 'ERR:SM306', 'D6 the Owner needs the second factor');
select is(pg_temp.resume('a_owner', 'a', 'growth', 'x'), 'ERR:22023', 'D7 a provider reference of 3 to 100 characters');
select is(pg_temp.val('a_owner', format($q$select public.billing_resume(%L, 'growth', 'razorpay', 'sub_fake_resume1')::text$q$, tests.tid('a'))), 'ERR:22023', 'D8 only the fake provider exists');
select is(pg_temp.resume('a_owner', 'a', 'no_such_plan'), 'ERR:SM821', 'D9 an unknown plan');
select is(pg_temp.resume('a_owner', 'a', 'free_trial'), 'ERR:SM821', 'D10 the trial plan cannot be chosen');
select is((select count(*)::int from public.billing_subscriptions where tenant_id = tests.tid('a')), 0, 'D11 nothing refused created a subscription');

-- ============================================================================ B. paying again after a lapse (a never chose a plan)
select is(pg_temp.get('a_owner', 'access') , 'read_only', 'B0 still read-only');
select is((pg_temp.resume('a_owner', 'a')::jsonb -> 'subscription' ->> 'status'), 'active', 'B1 the Owner pays again: the plan is ACTIVE at once');
select is((select plan_id from public.billing_subscriptions where tenant_id = tests.tid('a')), 'growth', 'B2 on the plan chosen');
select is((select (trial_ends_at is null)::text from public.billing_subscriptions where tenant_id = tests.tid('a')), 'true', 'B3 with no trial of its own');
select is((select (current_period_end = current_period_start + interval '1 month')::text from public.billing_subscriptions where tenant_id = tests.tid('a')), 'true', 'B4 one month paid from now');
select is((select plan from public.tenants where id = tests.tid('a')), 'growth', 'B5 the workspace''s plan follows');
select is((select kind || ':' || event_id from public.billing_events where tenant_id = tests.tid('a')), 'charge_succeeded:resume:sub_fake_resume1', 'B6 the first month is recorded as paid');
select is(pg_temp.acc('a_owner', 'access'), 'full', 'B7 the workspace is full again');
select is(pg_temp.acc('a_owner', 'sending'), 'on', 'B8 ...and sends');
select is(pg_temp.acc('a_owner', 'can_resume'), 'false', 'B9 nothing left to resume');
select is(pg_temp.resume('a_owner', 'a'), 'ERR:SM824', 'B10 resuming again is refused: it has not lapsed (SM824)');
select is((select count(*)::int from public.billing_events where tenant_id = tests.tid('a')), 1, 'B11 ...and recorded nothing twice');

-- ============================================================================ C. after a cancel (b chose a plan, then cancelled)
select is((pg_temp.get('b_owner', 'subscription')::jsonb ->> 'status'), 'trial_pending', 'C0 b chose a plan and waits for WhatsApp');
select is(pg_temp.resume('b_owner', 'b', 'growth', 'sub_fake_resume2'), 'ERR:SM824', 'C1 a workspace still waiting for WhatsApp has nothing to resume');
select is(pg_temp.acc('b_owner', 'waiting_for'), 'whatsapp', 'C2 the access answer says it waits for WhatsApp');
select is(pg_temp.acc('b_owner', 'sending'), 'off', 'C3 ...and that sending is off (read-only is not the reason)');
select is(pg_temp.acc('b_owner', 'access'), 'full', 'C4 ...it can still be set up');
select pg_temp.val('b_owner', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('b')));
select is(pg_temp.acc('b_owner', 'can_resume'), 'true', 'C5 after a cancel it can start again');
select is((pg_temp.resume('b_owner', 'b', 'starter', 'sub_fake_resume2')::jsonb -> 'subscription' ->> 'status'), 'active', 'C6 a cancelled plan is started again, active at once');
select is((select (cancelled_at is null and not cancel_at_period_end and grace_until is null)::text from public.billing_subscriptions where tenant_id = tests.tid('b')), 'true', 'C7 with the cancel cleared');
select is((select plan_id from public.billing_subscriptions where tenant_id = tests.tid('b')), 'starter', 'C8 on the plan now chosen');

-- ============================================================================ E. what cannot resume
select app.operator_billing_exempt(tests.tid('a'), true);
select app.billing_edit(true);
update public.billing_subscriptions set status = 'cancelled', cancelled_at = now() where tenant_id = tests.tid('a');
select app.billing_edit(false);
select is(pg_temp.acc('a_owner', 'can_resume'), 'false', 'E1 an exempt workspace never lapses, so it has nothing to resume');
select is(pg_temp.resume('a_owner', 'a', 'growth', 'sub_fake_resume3'), 'ERR:SM824', 'E2 ...and resuming is refused');
select is(pg_temp.acc('a_owner', 'access'), 'full', 'E3 an exempt workspace is always full');
select app.operator_billing_exempt(tests.tid('a'), false);
select is(pg_temp.acc('a_owner', 'can_resume'), 'true', 'E4 not exempt any more: cancelled, so it can resume');

-- ============================================================================ G. the worker leaves a read-only workspace alone
select app.operator_set_outbox(true);
select pg_temp.val('a_owner', format($q$select public.outbox_set_settings(%L, true, 5)::text$q$, tests.tid('a')));
select pg_temp.val('b_owner', format($q$select public.outbox_set_settings(%L, true, 5)::text$q$, tests.tid('b')));
select app.billing_edit(true);
update public.billing_subscriptions set status = 'active', cancelled_at = null, current_period_start = now(), current_period_end = now() + interval '1 month' where tenant_id in (tests.tid('a'), tests.tid('b'));
select app.billing_edit(false);
select is((select jsonb_array_length(pg_temp.val('x8', 'select public.scheduler_tenants()::text')::jsonb)), 2, 'G1 both workspaces are paid: the worker runs both');
select app.billing_edit(true);
update public.billing_subscriptions set status = 'cancelled', cancelled_at = now() where tenant_id = tests.tid('a');
select app.billing_edit(false);
select is((select jsonb_array_length(pg_temp.val('x8', 'select public.scheduler_tenants()::text')::jsonb)), 1, 'G2 a is read-only (cancelled): the worker leaves it alone');
select is(pg_temp.val('x8', 'select public.scheduler_tenants()::text')::jsonb ->> 0, tests.tid('b')::text, 'G3 ...and runs b');
select app.operator_set_billing_enforced(false);
select is((select jsonb_array_length(pg_temp.val('x8', 'select public.scheduler_tenants()::text')::jsonb)), 2, 'G4 with the billing switch off nothing is held');
select is(pg_temp.val('a_owner', 'select public.scheduler_tenants()::text'), 'ERR:42501', 'G5 DENY: an Owner cannot ask (the scheduler account only)');

select * from finish();
rollback;
