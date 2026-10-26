-- Job DI (ADR 0092 addendum, owner decision 25 Oct 2026; migration 20261127090300): a workspace whose trial ENDS UNPAID becomes READ-ONLY. Behind the platform switch `billing_enforced`: with the switch off every
-- workspace is `full`. Read-only holds all sending (the outbox claim hands nothing out), answers every Owner the dates, and the worker's reminders (day 1, 30, 60, 83) are due for it, once each.
--   A the switch   B the state of a workspace with no subscription   C exemption   D the hold on sending   E the reminders   F the days after 90   G every state of a subscription   H doors and guards
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
  execute format('create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select app.agent_cost_day(timestamptz %L) $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);
-- workspace a began its trial on 1 September (30 days: it ended on 1 October); workspace b began on 10 October
update public.tenants set trial_started_at = '2026-09-01T09:00:00+05:30' where id = tests.tid('a');
update public.tenants set trial_started_at = '2026-10-10T09:00:00+05:30' where id = tests.tid('b');
select app.operator_register_scheduler('x5@test.local');
select app.operator_register_channel_agent('x6@test.local');

create function pg_temp.q(p_value anyelement) returns void language plpgsql as $$ begin end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.acc(p_user text, p_key text, p_tenant text default 'a') returns text language sql as $$
  select case when r like 'ERR:%' then r else (r::jsonb ->> p_key) end from (select pg_temp.val(p_user, format($q$select public.billing_access(%L)::text$q$, tests.tid(p_tenant))) r) x $$;
create function pg_temp.due(p_tenant text default 'a') returns jsonb language sql as $$
  select coalesce((select x from jsonb_array_elements(pg_temp.val('x5', 'select public.scheduler_billing_reminders_due()::text')::jsonb) x where x ->> 'tenant_id' = tests.tid(p_tenant)::text), '{}'::jsonb) $$;
create function pg_temp.msg(p_name text, p_category text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by)
  select tests.rid(p_name), tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), tests.rid(p_tenant || '_contact'), 'whatsapp', 'Synthetic message ' || p_name, 'en', p_category, 'queued', 'auto_allowed', md5(p_name) || md5(p_name || 'x'), tests.uid(p_tenant || '_owner');
end $$;

-- ============================================================================ A. the switch
select is(pg_temp.acc('a_owner', 'access'), 'full', 'A1 the switch is OFF: a workspace whose trial ended a fortnight ago is still full');
select is(pg_temp.val('x5', 'select public.scheduler_billing_reminders_due()::text'), '[]', 'A2 ...no reminder is due');
select is((select app.billing_deletion_due()), '[]'::jsonb, 'A3 ...and nothing is due for deletion');
select is(pg_temp.val('a_owner', format($q$select (public.billing_get(%L) ->> 'access')$q$, tests.tid('a'))), 'full', 'A5 the plan screen answer carries `access`: full');

-- ============================================================================ B. no subscription: the trial of 30 days
select app.operator_set_billing_enforced(true);
select is(pg_temp.acc('a_owner', 'access'), 'read_only', 'B1 SWITCH ON: the trial of workspace a ended on 1 October: read-only');
select is(pg_temp.acc('a_owner', 'read_only_since') || ' -> ' || pg_temp.acc('a_owner', 'delete_on') || ' (' || pg_temp.acc('a_owner', 'data_days_left') || ' days left)', '2026-10-01 -> 2026-12-30 (77 days left)', 'B2 read-only since 1 October; the data is kept 90 days: to 30 December; 77 days left on the 14th');
select is(pg_temp.acc('b_owner', 'access', 'b'), 'full', 'B3 workspace b is in its 30 days: full');
select is(pg_temp.acc('a_viewer', 'access'), 'read_only', 'B4 any member can read the state (a Viewer too)');
select is(pg_temp.acc('b_owner', 'access', 'a'), 'ERR:42501', 'B5 DENY: another business');
select is(pg_temp.acc('anon', 'state'), 'ERR:42501', 'B6 DENY: anon');
select is(pg_temp.val('a_owner', format($q$select (public.billing_get(%L) ->> 'access')$q$, tests.tid('a'))), 'read_only', 'B7 the plan screen answer says so too');
select is(pg_temp.val('a_owner', format($q$select (public.billing_get(%L) ->> 'delete_on')$q$, tests.tid('a'))), '2026-12-30', 'B8 ...with the day of deletion');
select is(pg_temp.val('a_owner', format($q$select public.billing_check_usage(%L, 'call_minutes') ->> 'allowed'$q$, tests.tid('a'))), 'true', 'B9 (a call start still asks the meter; read-only stops calls through the API gate, not through the meter)');

-- ============================================================================ C. exemption
select is(pg_temp.val('a_owner', format($q$select app.operator_billing_exempt(%L, true)$q$, tests.tid('a'))), 'ERR:42501', 'C1 DENY: a client cannot exempt a workspace');
select is(pg_temp.val('a_owner', format($q$update public.tenants set billing_exempt = true where id = %L$q$, tests.tid('a'))), 'ERR:42501', 'C2 DENY: nor write the flag');
select app.operator_billing_exempt(tests.tid('a'), true);
select is(pg_temp.acc('a_owner', 'access'), 'full', 'C3 an exempt workspace (Customer Zero, a demo) never lapses');
select is(pg_temp.due(), '{}'::jsonb, 'C4 ...and is sent no reminder');
select app.operator_billing_exempt(tests.tid('a'), false);

-- ============================================================================ D. sending is held
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select pg_temp.pin('2026-10-14T14:00:00+05:30'::timestamptz);
select pg_temp.msg('r1', 'followup');
select pg_temp.msg('r2', 'reply_to_inbound');
select pg_temp.q(app.outbox_claim_due_core(tests.tid('a'), 10, false));
select is((select string_agg(id::text || ':' || status || '/' || attempts::text, ',' order by body) from public.outbox_messages where id in (tests.rid('r1'), tests.rid('r2'))), tests.rid('r1')::text || ':queued/0,' || tests.rid('r2')::text || ':queued/0', 'D1 READ-ONLY: nothing is handed out, not even a reply: both messages wait, untouched');
select is(jsonb_array_length(app.outbox_claim_due_core(tests.tid('a'), 10, false)), 0, 'D2 the claim answers an empty list');
select pg_temp.msg('r3', 'followup', 'b');
select pg_temp.q(app.outbox_claim_due_core(tests.tid('b'), 10, false));
select isnt((select status || '/' || attempts::text from public.outbox_messages where id = tests.rid('r3')), 'queued/0', 'D3 a workspace in its trial is served as before');
select app.operator_set_billing_enforced(false);
select pg_temp.q(app.outbox_claim_due_core(tests.tid('a'), 10, false));
select isnt((select status || '/' || attempts::text from public.outbox_messages where id = tests.rid('r1')), 'queued/0', 'D4 with the switch OFF the held message is served at the next claim: nothing was lost');
select app.operator_set_billing_enforced(true);
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosrc like '%billing\_read\_only(%' and p.proname <> 'billing_read_only'), 'billing_access,outbox_claim_due_core,scheduler_tenants', 'D5 only the outbox claim, the worker''s tenant list and the access answer consult the read-only state in the database (the API gate reads it through public.billing_access)');

-- ============================================================================ E. the reminders (14 October: day 13 of read-only)
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);
select is(pg_temp.due() ->> 'day', '1', 'E1 on day 13 the day-1 reminder is due');
select is((pg_temp.due() -> 'emails') @> '["a_owner@test.local"]'::jsonb and not ((pg_temp.due() -> 'emails')::text ~ '(admin|sales|viewer)'), true, 'E2 it goes to the Owners'' addresses (an Admin, Sales or a Viewer are not written to)');
select is(pg_temp.due() ->> 'delete_on', '2026-12-30', 'E3 with the day of deletion');
select is(pg_temp.due('b'), '{}'::jsonb, 'E4 workspace b (in its trial) has none');
select is(pg_temp.val('a_owner', 'select public.scheduler_billing_reminders_due()::text'), 'ERR:42501', 'E5 DENY: an Owner cannot ask');
select is(pg_temp.val('x6', 'select public.scheduler_billing_reminders_due()::text'), 'ERR:42501', 'E6 DENY: nor the channel account');
select is(pg_temp.val('x5', format($q$select public.scheduler_billing_reminder_mark(%L, 45)::text$q$, tests.tid('a'))), 'ERR:22023', 'E7 only days 1, 30, 60 and 83 exist');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_billing_reminder_mark(%L, 1)::text$q$, tests.tid('a'))), 'ERR:42501', 'E8 DENY: an Owner cannot mark one');
select is(pg_temp.val('x5', format($q$select public.scheduler_billing_reminder_mark(%L, 1)::text$q$, tests.tid('a'))), '{"marked": 1}', 'E9 the worker marks day 1');
select is(pg_temp.due(), '{}'::jsonb, 'E10 it is not due again');
select pg_temp.pin('2026-11-05T11:00:00+05:30'::timestamptz);
select is(pg_temp.due() ->> 'day', '30', 'E11 on day 35 the day-30 reminder is due');
select pg_temp.q(pg_temp.val('x5', format($q$select public.scheduler_billing_reminder_mark(%L, 30)::text$q$, tests.tid('a'))));
select pg_temp.pin('2026-12-24T11:00:00+05:30'::timestamptz);
select is(pg_temp.due() ->> 'day', '83', 'E12 the worker was away for weeks: only the LATEST due reminder (day 83) is offered, not 60 and 83');
select is(pg_temp.due() ->> 'read_only_since', '2026-10-01', 'E13 ...with the day it began');
select pg_temp.q(pg_temp.val('x5', format($q$select public.scheduler_billing_reminder_mark(%L, 83)::text$q$, tests.tid('a'))));
select is((select string_agg(day::text, ',' order by day) from public.billing_lapse_reminders where tenant_id = tests.tid('a')), '1,30,60,83', 'E14 marking day 83 closed the days before it (60 is no longer due)');
select is(pg_temp.due(), '{}'::jsonb, 'E15 nothing more is due');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'billing_lapse_reminder'), 4::bigint, 'E16 every reminder is in the audit trail');

-- ============================================================================ F. after the 90 days
select is((select app.billing_deletion_due() @> jsonb_build_array(jsonb_build_object('tenant_id', tests.tid('a'), 'read_only_since', '2026-10-01'))), false, 'F1 on 24 December the data is still kept (day 84)');
select pg_temp.pin('2026-12-30T12:00:00+05:30'::timestamptz);
select is((select jsonb_path_exists(app.billing_deletion_due(), format('$[*] ? (@.tenant_id == "%s")', tests.tid('a'))::jsonpath)), true, 'F2 on day 90 the workspace is DUE FOR DELETION (it is listed; nothing deletes by itself)');
select is(pg_temp.due(), '{}'::jsonb, 'F3 and no reminder is offered any more');
select is(pg_temp.acc('a_owner', 'data_days_left'), '0', 'F4 days left: 0');
select is((select count(*) from public.tenants where id = tests.tid('a')), 1::bigint, 'F5 the workspace itself is untouched');
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);

-- ============================================================================ G. every state of a subscription (workspace b)
-- trialing: full until a day after the trial ends (the first charge is expected then)
insert into integrations.whatsapp_accounts (tenant_id, waba_id, phone_number_id, display_phone, token_ref, status) values (tests.tid('b'), '1234567890', '555000413', '+910000000000', 'SYNTHETIC_TOKEN_REF', 'active');   -- job DM: the 14 days count from here
select pg_temp.q(pg_temp.val('b_owner', format($q$select public.billing_start_trial(%L, 'growth', 'fake', 'sub_fake_ro1')::text$q$, tests.tid('b'))));
select is(pg_temp.acc('b_owner', 'access', 'b'), 'full', 'G1 trialing: full');
select pg_temp.pin('2026-10-28T11:00:00+05:30'::timestamptz);
select is(pg_temp.acc('b_owner', 'access', 'b'), 'full', 'G2 the day the trial ends, the first charge is awaited: still full');
select pg_temp.pin('2026-10-29T12:00:00+05:30'::timestamptz);
select is(pg_temp.acc('b_owner', 'access', 'b'), 'read_only', 'G3 a day later with no charge: read-only');
-- the charge arrives late: active again
select pg_temp.q(pg_temp.val('x6', format($q$select public.billing_apply_event(%L, 'ro_ev_1', 'charge_succeeded', 0, '2026-11-14T12:00:00+05:30')::text$q$, tests.tid('b'))));
select is(pg_temp.acc('b_owner', 'access', 'b'), 'full', 'G4 paid: full');
-- a cancel at the end of the paid period: full until it ends
select pg_temp.q(pg_temp.val('b_owner', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('b'))));
select is(pg_temp.acc('b_owner', 'access', 'b'), 'full', 'G5 cancelled but paid: full until the period ends');
select pg_temp.pin('2026-12-20T12:00:00+05:30'::timestamptz);
select is(pg_temp.acc('b_owner', 'access', 'b') || ' since ' || pg_temp.acc('b_owner', 'read_only_since', 'b'), 'read_only since 2026-12-14', 'G6 after the paid period (a month after 14 November): read-only');
-- past due: the grace period
select pg_temp.pin('2026-12-14T09:00:00+05:30'::timestamptz);
select app.billing_edit(true);
update public.billing_subscriptions set status = 'past_due', cancel_at_period_end = false, cancelled_at = null, grace_until = '2026-12-20T11:00:00+05:30' where tenant_id = tests.tid('b');
select app.billing_edit(false);
select is(pg_temp.acc('b_owner', 'access', 'b'), 'full', 'G7 past due, inside the grace period: full');
select pg_temp.pin('2026-12-21T09:00:00+05:30'::timestamptz);
select is(pg_temp.acc('b_owner', 'access', 'b') || ' since ' || pg_temp.acc('b_owner', 'read_only_since', 'b'), 'read_only since 2026-12-20', 'G8 past due after the grace period: read-only');
-- cancelled during the trial keeps the rest of the trial
select app.billing_edit(true);
update public.billing_subscriptions set status = 'cancelled', cancelled_at = '2026-10-12T10:00:00+05:30', trial_ends_at = '2026-11-10T09:00:00+05:30', current_period_end = null, grace_until = null where tenant_id = tests.tid('b');
select app.billing_edit(false);
select pg_temp.pin('2026-10-20T09:00:00+05:30'::timestamptz);
select is(pg_temp.acc('b_owner', 'access', 'b'), 'full', 'G9 cancelled during the trial: the rest of the trial is kept');
select pg_temp.pin('2026-11-10T10:00:00+05:30'::timestamptz);
select is(pg_temp.acc('b_owner', 'access', 'b'), 'read_only', 'G10 ...and the workspace is read-only when the trial would have ended');

-- ============================================================================ H. doors and guards
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('billing_access', 'scheduler_billing_reminders_due', 'scheduler_billing_reminder_mark') and p.prosecdef and p.proconfig @> array['search_path=""']), 3::bigint, 'H1 the three new public functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('billing_access', 'scheduler_billing_reminders_due', 'scheduler_billing_reminder_mark') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'H2 anon can run none of them');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('billing_access_until', 'billing_lapse', 'billing_read_only', 'billing_deletion_due', 'operator_billing_exempt') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint, 'H3 the state functions are not callable by a client');
select is(pg_temp.sc($$update public.billing_lapse_reminders set day = 60$$), '42501', 'H4 a reminder record is never changed');
select is(pg_temp.sc($$delete from public.billing_lapse_reminders$$), '42501', 'H5 nor deleted');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'billing_lapse_reminders' and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'H6 a client can only read it');
select is(tests.scalar_as(tests.uid('a_sales'), format($q$select count(*) from public.billing_lapse_reminders where tenant_id = %L$q$, tests.tid('a'))), '0', 'H7 and Sales see none');
select * from finish();
rollback;
