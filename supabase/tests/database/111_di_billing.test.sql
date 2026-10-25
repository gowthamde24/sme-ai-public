-- Job DI (ADR 0092): plans and billing groundwork (migrations 20261127090000, 090100, 090200).
-- The plans catalogue as data; the meters of AI call minutes and business-initiated WhatsApp messages (India time, per period); the notices at 80 and 100 percent; the enforcement hooks (a platform switch, OFF by default);
-- the subscription state of the FAKE provider: a trial with a payment method, a failed payment, a cancel before the end of the trial (no charge), a late event after a cancel.
--   A structure, grants, RLS    B the catalogue    C the meter at the start    D call minutes: notices, enforcement, top-up, the next period    E messages: the outbox counts them and holds them
--   F the trial, cancel, charges    G guards, audit, what never stops
begin;
select no_plan();
-- setup calls that return a value are wrapped in q() so no row of theirs reaches the TAP stream
create function pg_temp.q(p_value anyelement) returns void language plpgsql as $$ begin end $$;
select tests.seed_two_tenants();
select tests.seed_crm();

-- the clock: usage is stamped with app.outbox_now(); the period is decided by app.agent_utc_today() (the AI window's own day rule)
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
  execute format('create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select app.agent_cost_day(timestamptz %L) $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);
-- workspace a began its trial on 1 October (its month window runs the 1st to the 1st); workspace b on the 10th
update public.tenants set trial_started_at = '2026-10-01T09:00:00+05:30' where id = tests.tid('a');
update public.tenants set trial_started_at = '2026-10-10T09:00:00+05:30' where id = tests.tid('b');
select app.operator_register_channel_agent('x6@test.local');

create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.v(p_user text, p_sql text) returns text language sql as $$ select pg_temp.val('aal2', p_user, p_sql) $$;
-- a path into a JSON answer: v('a_owner', 'select public.billing_get(...)', 'usage,call_minutes,percent')
create function pg_temp.path(p_user text, p_sql text, p_path text) returns text language sql as $$
  select case when r like 'ERR:%' then r else (r::jsonb #>> string_to_array(p_path, ',')) end from (select pg_temp.v(p_user, p_sql) r) x $$;
create function pg_temp.get(p_user text, p_path text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.path(p_user, format($q$select public.billing_get(%L)::text$q$, tests.tid(p_tenant)), p_path) $$;
create function pg_temp.ts(p_user text, p_path text, p_tenant text default 'a') returns text language sql as $$
  select case when t is null or t like 'ERR:%' then t else to_char(t::timestamptz at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') end from (select pg_temp.get(p_user, p_path, p_tenant) t) x $$;
create function pg_temp.callrec(p_user text, p_ref text, p_seconds int, p_tenant text default 'a', p_kind text default 'call_minutes') returns text language sql as $$
  select pg_temp.v(p_user, format($q$select public.billing_record_usage(%L, %L, %L, %L)::text$q$, tests.tid(p_tenant), p_kind, tests.rid(p_ref), p_seconds)) $$;
create function pg_temp.check(p_user text, p_kind text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.path(p_user, format($q$select public.billing_check_usage(%L, %L)::text$q$, tests.tid(p_tenant), p_kind), 'allowed') $$;
create function pg_temp.notices(p_kind text, p_tenant text default 'a') returns bigint language sql as $$
  select count(*) from public.billing_notices where tenant_id = tests.tid(p_tenant) and kind = p_kind $$;

-- ============================================================================ A. structure, grants, RLS
select is((select count(*) from pg_class where relname in ('billing_subscriptions', 'billing_events', 'billing_usage_events', 'billing_topups', 'billing_notices') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 5::bigint, 'A1 RLS is enabled and forced on the five billing tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('billing_subscriptions', 'billing_events', 'billing_usage_events', 'billing_topups', 'billing_notices') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'A2 a signed-in client can only SELECT them (nobody writes directly)');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('billing_subscriptions', 'billing_events', 'billing_usage_events', 'billing_topups', 'billing_notices') and grantee in ('anon', 'public', 'service_role')), 0::bigint, 'A3 anon, public and service_role have nothing');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'billing' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A4 the catalogue tables (schema billing) have no client grant');
select is((select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'billing', 'usage')), 0::bigint, 'A5 no client role has USAGE on schema billing');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('billing_plans', 'billing_get', 'billing_usage_get', 'billing_check_usage', 'billing_start_trial', 'billing_subscription_ref', 'billing_cancel', 'billing_record_usage', 'billing_apply_event')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 9::bigint, 'A6 all nine public functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'billing\_%' and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'A7 anon can run none of them');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and (p.proname like 'billing\_%' or p.proname like 'operator\_%billing%') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'A8 no app.billing_* or operator function is callable by a client');
select is((select count(*) from pg_constraint where conrelid = 'public.tenants'::regclass and conname = 'tenants_plan_fkey'), 1::bigint, 'A9 a workspace''s plan is a reference to the catalogue, not a list in a CHECK');
select is((select enabled from public.platform_flags where key = 'billing_enforced'), false, 'A10 enforcement is OFF until the owner of the product turns it on');

-- ============================================================================ B. the catalogue
select is(pg_temp.path('a_owner', 'select public.billing_plans()::text', 'catalogue_version'), '1', 'B1 the catalogue is version 1');
select is(pg_temp.v('a_viewer', 'select jsonb_array_length(public.billing_plans() -> ''plans'')::text'), '7', 'B2 seven plans, readable by any signed-in user');
select is(pg_temp.v('anon', 'select public.billing_plans()::text'), 'ERR:42501', 'B3 anon reads nothing');
select is(pg_temp.v('a_owner', 'select (select string_agg(p ->> ''id'', '','' order by (p ->> ''sort'')::int) from jsonb_array_elements(public.billing_plans() -> ''plans'') p)'), 'free_trial,starter,growth,business,calls_payg,calls_300,calls_1000', 'B4 the plans, in order');
select is(pg_temp.v('a_owner', 'select (select count(*) from jsonb_array_elements(public.billing_plans() -> ''plans'') p where (p ->> ''price_set'')::boolean or p ->> ''price_paise_monthly'' is not null)::text'), '0', 'B5 no price is set: every price is null until the owner decides');
select is(pg_temp.path('a_owner', 'select public.billing_plans()::text', 'trial,days'), '30', 'B6 the trial is 30 days...');
select is(pg_temp.path('a_owner', 'select public.billing_plans()::text', 'trial,payment_method_at_start'), 'true', 'B7 ...with a payment method at the start');
select is(pg_temp.v('a_owner', 'select (select (p -> ''allowances'' ->> ''call_minutes'') || ''/'' || (p -> ''allowances'' ->> ''whatsapp_messages'') from jsonb_array_elements(public.billing_plans() -> ''plans'') p where p ->> ''id'' = ''growth'')'), '100/1000', 'B8 Growth: 100 minutes, 1,000 messages');
select is(pg_temp.v('a_owner', 'select (select coalesce(p -> ''allowances'' ->> ''call_minutes'', ''none'') from jsonb_array_elements(public.billing_plans() -> ''plans'') p where p ->> ''id'' = ''calls_payg'')'), 'none', 'B9 pay as you go has no included minutes and no ceiling');
select is(pg_temp.sc($$update billing.plan_versions set whatsapp_messages = 1$$), '42501', 'B10 a synced catalogue is never edited (update)');
select is(pg_temp.sc($$delete from billing.catalogue_versions$$), '42501', 'B11 ...or deleted');
select is(pg_temp.sc($$truncate billing.plan_versions$$), '42501', 'B12 ...or truncated');
select is((select manifest_sha256 from billing.catalogue_versions where version = 1) ~ '^[0-9a-f]{64}$', true, 'B13 its manifest has a SHA-256 (the repository test compares it byte for byte)');
select is(pg_temp.sc(format($q$update public.tenants set plan = 'platinum' where id = %L$q$, tests.tid('b'))), '23503', 'B14 a plan that is not in the catalogue cannot be given to a workspace');

-- ============================================================================ C. the meter at the start (workspace a, on the free trial)
select is(pg_temp.get('a_owner', 'plan,id'), 'free_trial', 'C1 a workspace without a subscription is on the free trial');
select is(pg_temp.get('a_owner', 'subscription'), null, 'C2 no subscription yet');
select is(pg_temp.get('a_owner', 'can_start_trial'), 'true', 'C3 it can start a trial');
select is(pg_temp.get('a_owner', 'usage,call_minutes,allowance') || '/' || pg_temp.get('a_owner', 'usage,whatsapp_messages,allowance'), '30/100', 'C4 30 minutes and 100 messages');
select is(pg_temp.get('a_owner', 'usage,call_minutes,used') || '/' || pg_temp.get('a_owner', 'usage,call_minutes,percent') || '/' || pg_temp.get('a_owner', 'usage,call_minutes,state'), '0.0/0/ok', 'C5 nothing used: 0 percent, ok');
select is(pg_temp.get('a_owner', 'period,start') || ' to ' || pg_temp.get('a_owner', 'period,end') || ' ' || pg_temp.get('a_owner', 'period,timezone'), '2026-10-01 to 2026-10-31 Asia/Kolkata', 'C6 the period is India days: the 1st to the 31st');
select is(pg_temp.get('a_owner', 'period,days_left'), '18', 'C7 eighteen days left on the 14th (today counts)');
select is(pg_temp.get('a_admin', 'plan,id'), 'free_trial', 'C8 an Admin reads it');
select is(pg_temp.get('a_sales', 'plan,id'), 'ERR:42501', 'C9 DENY: Sales');
select is(pg_temp.get('a_viewer', 'plan,id'), 'ERR:42501', 'C10 DENY: a Viewer');
select is(pg_temp.get('b_owner', 'plan,id', 'a'), 'ERR:42501', 'C11 DENY: another business''s Owner');
select is(pg_temp.get('anon', 'plan,id'), 'ERR:42501', 'C12 DENY: anon');
select is(pg_temp.v('a_owner', format($q$select (public.billing_get(%L)::text ~* '(token|micro|cost|rupee|spend|ledger)')::text$q$, tests.tid('a'))), 'false', 'C13 nothing about AI money, tokens or the ledger is in the answer');

-- ============================================================================ D. call minutes: notices at 80 and 100, enforcement, top-up, the next period
select is(pg_temp.callrec('a_owner', 'call1', 60), 'ERR:42501', 'D1 DENY: an Owner cannot record call seconds (the channel account does)');
select is(pg_temp.callrec('anon', 'call1', 60), 'ERR:42501', 'D2 DENY: anon');
select is(pg_temp.callrec('x6', 'call1', 0), 'ERR:22023', 'D3 zero seconds is invalid');
select is(pg_temp.callrec('x6', 'call1', 90000), 'ERR:22023', 'D4 more than a day of seconds is invalid');
select is(pg_temp.callrec('x6', 'call1', 60, 'a', 'whatsapp_messages'), 'ERR:22023', 'D5 a message is counted by the outbox when it is sent, never handed in');
select is(pg_temp.v('x6', format($q$select public.billing_record_usage(%L, 'call_minutes', %L, 60)::text$q$, gen_random_uuid(), tests.rid('nobody'))), 'ERR:22023', 'D6 an unknown workspace is invalid');
select is(pg_temp.path('x6', format($q$select public.billing_record_usage(%L, 'call_minutes', %L, 1380)::text$q$, tests.tid('a'), tests.rid('call1')), 'percent'), '76', 'D7 the channel account records 23 minutes: 76 percent');
select is(pg_temp.get('a_owner', 'usage,call_minutes,state') || '/' || pg_temp.notices('call_minutes'), 'ok/0', 'D8 under 80 percent: ok, no notice');
select is(pg_temp.path('x6', format($q$select public.billing_record_usage(%L, 'call_minutes', %L, 60)::text$q$, tests.tid('a'), tests.rid('call2')), 'state'), 'notice', 'D9 one more minute reaches 24 of 30 = 80 percent: notice');
select is(pg_temp.notices('call_minutes'), 1::bigint, 'D10 ONE notice event was made');
select is((select level from public.billing_notices where tenant_id = tests.tid('a') and kind = 'call_minutes'), 80::smallint, 'D11 at level 80');
select pg_temp.q(pg_temp.callrec('x6', 'call2', 60));
select is(pg_temp.notices('call_minutes'), 1::bigint, 'D12 the same call again changes nothing...');
select is(pg_temp.get('a_owner', 'usage,call_minutes,used'), '24.0', 'D13 ...it counts once (24.0 minutes)');
select pg_temp.q(pg_temp.callrec('x6', 'call3', 30));
select is(pg_temp.notices('call_minutes'), 1::bigint, 'D14 further use above 80 percent makes no second notice');
select is(pg_temp.check('a_owner', 'call_minutes'), 'true', 'D15 enforcement is off: a call may begin even at 80 percent');
select pg_temp.q(pg_temp.callrec('x6', 'call4', 330));
select is(pg_temp.get('a_owner', 'usage,call_minutes,state') || '/' || pg_temp.get('a_owner', 'usage,call_minutes,percent') || '/' || pg_temp.get('a_owner', 'usage,call_minutes,remaining'), 'stopped/100/0.0', 'D16 30 of 30 minutes: stopped, 100 percent, nothing remaining');
select is(pg_temp.notices('call_minutes'), 2::bigint, 'D17 the second notice (level 100) was made, once');
select is((select string_agg(level::text, ',' order by level) from public.billing_notices where tenant_id = tests.tid('a') and kind = 'call_minutes'), '80,100', 'D18 levels 80 and 100');
select is(pg_temp.check('a_owner', 'call_minutes'), 'true', 'D19 still allowed while the platform switch is off (the meter and the notices run either way)');
select is(pg_temp.sc($$select app.operator_set_billing_enforced(true)$$), 'ok', 'D20 the operator turns enforcement on');
select is(pg_temp.check('a_owner', 'call_minutes'), 'false', 'D21 STOP: no call may begin at 100 percent');
select is(pg_temp.check('a_sales', 'call_minutes'), 'false', 'D22 Sales are told the same');
select is(pg_temp.check('a_viewer', 'call_minutes'), 'ERR:42501', 'D23 a Viewer is not asked');
select is(pg_temp.check('a_owner', 'whatsapp_messages'), 'true', 'D24 the other kind is unaffected (messages are at 0 of 100)');
select is(pg_temp.check('a_owner', 'sms'), 'ERR:22023', 'D25 an unknown kind is invalid');
select is(pg_temp.check('b_owner', 'call_minutes', 'a'), 'ERR:42501', 'D26 DENY: another business');
select is(pg_temp.sc(format($q$select app.operator_billing_topup(%L, %L, 'call_minutes', 10)$q$, tests.tid('a'), tests.rid('top1'))), 'ok', 'D27 the operator adds a 10-minute top-up');
select is(pg_temp.sc(format($q$select app.operator_billing_topup(%L, %L, 'call_minutes', 10)$q$, tests.tid('a'), tests.rid('top1'))), 'ok', 'D28 the same top-up again adds nothing (idempotent)');
select is(pg_temp.get('a_owner', 'usage,call_minutes,allowance') || '/' || pg_temp.get('a_owner', 'usage,call_minutes,topup') || '/' || pg_temp.get('a_owner', 'usage,call_minutes,state'), '40/10/ok', 'D29 the allowance is 40 (the top-up is inside it), 30 of 40 = 75 percent: ok');
select is(pg_temp.check('a_owner', 'call_minutes'), 'true', 'D30 after the top-up a call may begin again');
select is(pg_temp.sc(format($q$select app.operator_billing_topup(%L, %L, 'call_minutes', 5)$q$, tests.tid('a'), tests.rid('top2'))) || pg_temp.sc(format($q$select app.operator_billing_topup(%L, %L, 'sms', 5)$q$, tests.tid('a'), tests.rid('top3'))), 'ok22023', 'D31 a top-up of an unknown kind is invalid');
select is(pg_temp.v('a_owner', format($q$select app.operator_billing_topup(%L, %L, 'call_minutes', 5)::text$q$, tests.tid('a'), tests.rid('top4'))), 'ERR:42501', 'D32 a signed-in client cannot add a top-up');
-- the next period: 2 November. The October use, notices and top-up belong to October.
select pg_temp.pin('2026-11-02T11:00:00+05:30'::timestamptz);
select is(pg_temp.get('a_owner', 'period,start') || ' ' || pg_temp.get('a_owner', 'usage,call_minutes,used') || ' ' || pg_temp.get('a_owner', 'usage,call_minutes,allowance') || ' ' || pg_temp.get('a_owner', 'usage,call_minutes,state'), '2026-11-01 0.0 30 ok', 'D33 NEXT PERIOD: used 0, the allowance back to 30, ok');
select is(pg_temp.get('a_owner', 'notices'), '[]', 'D34 ...and no notice in the new period');
select is(pg_temp.check('a_owner', 'call_minutes'), 'true', 'D35 ...calls may begin');
select is(pg_temp.notices('call_minutes'), 2::bigint, 'D36 October''s two notices are kept as history');
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);
select app.operator_set_billing_enforced(false);

-- ============================================================================ E. messages: counted when SENT, replies inside the window are free, the claim holds them
update public.platform_flags set enabled = true where key = 'outbox_enabled';
create function pg_temp.msg(p_name text, p_category text, p_status text default 'queued', p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by)
  select tests.rid(p_name), tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), tests.rid(p_tenant || '_contact'), 'whatsapp', 'Synthetic message ' || p_name, 'en', p_category, p_status,
         case when p_status = 'queued' then 'auto_allowed' else 'owner_approved' end, md5(p_name) || md5(p_name || 'x'), tests.uid(p_tenant || '_owner');
end $$;
select pg_temp.msg('m1', 'followup');
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,used'), '0.0', 'E1 a queued message is not counted');
update public.outbox_messages set status = 'sent', sent_at = now(), adapter = 'fake', adapter_message_id = 'x-1' where id = tests.rid('m1');
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,used'), '1.0', 'E2 a business-initiated message counts when it is SENT');
update public.outbox_messages set status = 'sent' where id = tests.rid('m1');
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,used'), '1.0', 'E3 marking a sent message sent again counts nothing more');
select pg_temp.msg('m2', 'reply_to_inbound');
update public.outbox_messages set status = 'sent', sent_at = now(), adapter = 'fake', adapter_message_id = 'x-2' where id = tests.rid('m2');
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,used'), '1.0', 'E4 a reply inside the customer''s 24-hour window is not business-initiated: not counted');
select pg_temp.msg('m3', 'info');
select pg_temp.msg('m4', 'visit');
select pg_temp.msg('m5', 'order_status');
select pg_temp.msg('m6', 'other');
update public.outbox_messages set status = 'sent', sent_at = now(), adapter = 'fake', adapter_message_id = 'x-' || id where id in (tests.rid('m3'), tests.rid('m4'), tests.rid('m5'), tests.rid('m6'));
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,used'), '5.0', 'E5 follow-ups, info, visit, order-status and other messages are all counted');
select is(pg_temp.get('b_owner', 'usage,whatsapp_messages,used', 'b'), '0.0', 'E6 another business''s meter is its own');
-- to 80 of 100
select pg_temp.q(app.billing_record(tests.tid('a'), 'whatsapp_messages', gen_random_uuid(), 1)) from generate_series(1, 74);
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,used') || '/' || pg_temp.get('a_owner', 'usage,whatsapp_messages,state') || '/' || pg_temp.notices('whatsapp_messages'), '79.0/ok/0', 'E7 79 of 100: ok, no notice');
select pg_temp.msg('m7', 'followup');
update public.outbox_messages set status = 'sent', sent_at = now(), adapter = 'fake', adapter_message_id = 'x-7' where id = tests.rid('m7');
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,state') || '/' || pg_temp.notices('whatsapp_messages'), 'notice/1', 'E8 the 80th message: one notice event');
select pg_temp.q(app.billing_record(tests.tid('a'), 'whatsapp_messages', gen_random_uuid(), 1)) from generate_series(1, 19);
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,state') || '/' || pg_temp.notices('whatsapp_messages'), 'notice/1', 'E9 99 of 100: still one notice');
select pg_temp.msg('m8', 'followup');
update public.outbox_messages set status = 'sent', sent_at = now(), adapter = 'fake', adapter_message_id = 'x-8' where id = tests.rid('m8');
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,state') || '/' || pg_temp.get('a_owner', 'usage,whatsapp_messages,percent') || '/' || pg_temp.notices('whatsapp_messages'), 'stopped/100/2', 'E10 the 100th: stopped, and the second notice');
-- the hold: two messages wait; the claim is the outbox's own (the worker's)
select pg_temp.pin('2026-10-14T14:00:00+05:30'::timestamptz);
select pg_temp.msg('h1', 'followup');
select pg_temp.msg('h2', 'reply_to_inbound');
select pg_temp.msg('h3', 'followup');
select pg_temp.q(app.outbox_claim_due_core(tests.tid('a'), 10, false));
select isnt((select status || '/' || attempts::text from public.outbox_messages where id = tests.rid('h1')), 'queued/0', 'E11 with enforcement OFF a meter at 100 percent holds nothing back: the claim handles the message as before');
select pg_temp.msg('h4', 'followup');
select pg_temp.msg('h5', 'reply_to_inbound');
select app.operator_set_billing_enforced(true);
select pg_temp.q(app.outbox_claim_due_core(tests.tid('a'), 10, false));
select is((select status || '/' || attempts::text from public.outbox_messages where id = tests.rid('h4')), 'queued/0', 'E12 STOP: with the messages at 100 percent, the business-initiated message is NOT handed out: still queued, untouched, nothing lost');
select isnt((select status || '/' || attempts::text from public.outbox_messages where id = tests.rid('h5')), 'queued/0', 'E13 ...while a reply inside the 24-hour window is processed as before');
select is(pg_temp.check('a_owner', 'whatsapp_messages'), 'false', 'E14 the check says the same');
select app.operator_billing_topup(tests.tid('a'), tests.rid('top5'), 'whatsapp_messages', 50);
select is(pg_temp.get('a_owner', 'usage,whatsapp_messages,allowance') || '/' || pg_temp.get('a_owner', 'usage,whatsapp_messages,state'), '150/ok', 'E15 a top-up of 50 messages: allowance 150, ok');
select pg_temp.q(app.outbox_claim_due_core(tests.tid('a'), 10, false));
select isnt((select status || '/' || attempts::text from public.outbox_messages where id = tests.rid('h4')), 'queued/0', 'E16 and the held message is handed out at the next claim');
select app.operator_set_billing_enforced(false);
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosrc like '%billing\_stopped(%' and p.proname <> 'billing_stopped'), 'billing_check_usage,outbox_claim_due_core',
          'E17 ONLY the call start check and the outbox claim ask the meter: quotes, orders, follow-ups and customers never consult it, so they never stop');
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);

-- ============================================================================ F. the trial, the charges, the cancel (the fake provider's events)
select is(pg_temp.val('aal1', 'a_owner', format($q$select public.billing_start_trial(%L, 'growth', 'fake', 'sub_fake_a1')::text$q$, tests.tid('a'))), 'ERR:SM306', 'F1 a second factor is needed to start a trial');
select is(pg_temp.v('a_admin', format($q$select public.billing_start_trial(%L, 'growth', 'fake', 'sub_fake_a1')::text$q$, tests.tid('a'))), 'ERR:42501', 'F2 DENY: an Admin cannot (the Owner''s)');
select is(pg_temp.v('a_owner', format($q$select public.billing_start_trial(%L, 'platinum', 'fake', 'sub_fake_a1')::text$q$, tests.tid('a'))), 'ERR:SM821', 'F3 an unknown plan is refused (SM821)');
select is(pg_temp.v('a_owner', format($q$select public.billing_start_trial(%L, 'free_trial', 'fake', 'sub_fake_a1')::text$q$, tests.tid('a'))), 'ERR:SM821', 'F4 the trial plan itself is not a plan to subscribe to');
select is(pg_temp.v('a_owner', format($q$select public.billing_start_trial(%L, 'growth', 'razorpay', 'sub_fake_a1')::text$q$, tests.tid('a'))), 'ERR:22023', 'F5 only the fake provider exists (a real one arrives with a new migration)');
select is(pg_temp.v('a_owner', format($q$select public.billing_start_trial(%L, 'growth', 'fake', 'x y')::text$q$, tests.tid('a'))), 'ERR:22023', 'F6 the provider reference is a plain token');
select is(pg_temp.path('a_owner', format($q$select public.billing_start_trial(%L, 'growth', 'fake', 'sub_fake_a1')::text$q$, tests.tid('a')), 'subscription,status'), 'trialing', 'F7 ALLOW: the Owner starts a Growth trial');
select is(pg_temp.ts('a_owner', 'subscription,trial_ends_at'), '2026-11-13 11:00', 'F8 it ends 30 days later (the 13th of November, 11:00 India time)');
select is(pg_temp.get('a_owner', 'plan,id') || '/' || pg_temp.get('a_owner', 'can_start_trial') || '/' || pg_temp.get('a_owner', 'subscription,payment_method_on_file'), 'free_trial/false/true', 'F9 while trialing the TRIAL plan''s allowances apply; a payment method is on file; no second trial');
select is(pg_temp.path('a_owner', format($q$select public.billing_subscription_ref(%L)::text$q$, tests.tid('a')), 'provider_ref') || '/' || pg_temp.path('a_owner', format($q$select public.billing_subscription_ref(%L)::text$q$, tests.tid('a')), 'status'), 'sub_fake_a1/trialing', 'F9b the Owner can read the provider''s reference of the subscription (to cancel it at the provider first)');
select is(pg_temp.v('a_admin', format($q$select public.billing_subscription_ref(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'F9c DENY: an Admin cannot');
select is(pg_temp.v('a_owner', format($q$select public.billing_subscription_ref(%L)::text$q$, tests.tid('b'))), 'ERR:42501', 'F9d DENY: another business');
select is(pg_temp.v('a_owner', format($q$select public.billing_start_trial(%L, 'business', 'fake', 'sub_fake_a2')::text$q$, tests.tid('a'))), 'ERR:SM822', 'F10 a trial is started once (SM822)');
select is((select count(*) from public.billing_events where tenant_id = tests.tid('a') and kind like 'charge%'), 0::bigint, 'F11 nothing has been charged');
select is(pg_temp.v('a_owner', format($q$select public.billing_apply_event(%L, 'ev_a_1', 'charge_failed', null, now())::text$q$, tests.tid('a'))), 'ERR:42501', 'F12 DENY: an Owner cannot apply a provider event (it could give itself a plan)');
select is(pg_temp.v('x6', format($q$select public.billing_apply_event(%L, 'ev_a_1', 'refund', null, now())::text$q$, tests.tid('a'))), 'ERR:22023', 'F13 an unknown event kind is invalid');
select is(pg_temp.v('x6', format($q$select public.billing_apply_event(%L, 'ev_a_1', 'charge_succeeded', null, now())::text$q$, tests.tid('a'))), 'ERR:22023', 'F14 a charge without its amount is invalid');
select is(pg_temp.v('x6', format($q$select public.billing_apply_event(%L, 'ev_a_1', 'charge_failed', null, now())::text$q$, tests.tid('b'))), 'ERR:23503', 'F15 an event for a workspace without a subscription is not found');
-- the first charge fails at the end of the trial
select is(pg_temp.path('x6', format($q$select public.billing_apply_event(%L, 'ev_a_1', 'charge_failed', null, '2026-11-13T11:00:00+05:30')::text$q$, tests.tid('a')), 'status'), 'past_due', 'F16 FAILED PAYMENT: past due');
select is(pg_temp.ts('a_owner', 'subscription,grace_until'), '2026-11-20 11:00', 'F17 with a 7-day grace period');
select is(pg_temp.get('a_owner', 'plan,id'), 'free_trial', 'F18 the plan in force has not changed');
select pg_temp.q(pg_temp.v('x6', format($q$select public.billing_apply_event(%L, 'ev_a_1', 'charge_failed', null, '2026-11-14T11:00:00+05:30')::text$q$, tests.tid('a'))));
select is(pg_temp.ts('a_owner', 'subscription,grace_until'), '2026-11-20 11:00', 'F19 the same event again changes nothing (idempotent by event id)');
select is((select count(*) from public.billing_events where tenant_id = tests.tid('a') and event_id = 'ev_a_1'), 1::bigint, 'F20 it is recorded once');
-- the retry succeeds: the plan chosen starts
select is(pg_temp.path('x6', format($q$select public.billing_apply_event(%L, 'ev_a_2', 'charge_succeeded', 0, '2026-11-15T11:00:00+05:30')::text$q$, tests.tid('a')), 'status'), 'active', 'F21 a successful charge: active');
select is(pg_temp.get('a_owner', 'plan,id') || '/' || pg_temp.get('a_owner', 'usage,call_minutes,allowance') || '/' || pg_temp.get('a_owner', 'usage,whatsapp_messages,allowance'), 'growth/100/1000', 'F22 Growth''s allowances now apply: 100 minutes, 1,000 messages');
select is((select plan || ' ' || (billing_anchor_at at time zone 'Asia/Kolkata')::date::text from public.tenants where id = tests.tid('a')), 'growth 2026-11-15', 'F23 the workspace''s plan and the billing anchor (the AI month window starts there) follow');
select is(app.ai_day_allowance(tests.tid('a')), 40000000::bigint, 'F24 AI fair use is unchanged: Growth''s own internal daily allowance (4,000 paise) applies, never shown');
select is((select grace_until from public.billing_subscriptions where tenant_id = tests.tid('a')), null, 'F25 the grace period is over');
select is(pg_temp.path('a_owner', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('a')), 'subscription,cancel_at_period_end') || '/' || pg_temp.get('a_owner', 'subscription,status'), 'true/active', 'F26 cancel on an active plan: ends at the end of the paid period, still active');
select is(pg_temp.path('x6', format($q$select public.billing_apply_event(%L, 'ev_a_3', 'cancelled', null, '2026-12-15T11:00:00+05:30')::text$q$, tests.tid('a')), 'status'), 'cancelled', 'F27 the provider confirms the end: cancelled');
select is(pg_temp.get('a_owner', 'plan,id'), 'free_trial', 'F28 the workspace is back on the base plan');
select is(pg_temp.path('x6', format($q$select public.billing_apply_event(%L, 'ev_a_4', 'charge_succeeded', 0, '2026-12-16T11:00:00+05:30')::text$q$, tests.tid('a')), 'status') || '/' || pg_temp.get('a_owner', 'plan,id'), 'cancelled/free_trial', 'F29 a late charge after a cancel never revives the subscription');
-- a payment that failed: cancelling ends it at once (nothing was paid for, nothing to wait for)
update public.tenants set plan = 'free_trial' where id = tests.tid('a');
select app.billing_edit(true);
update public.billing_subscriptions set status = 'past_due', cancelled_at = null, cancel_at_period_end = false, payment_method_on_file = true, grace_until = now() + interval '5 days' where tenant_id = tests.tid('a');
select app.billing_edit(false);
update public.tenants set plan = 'growth' where id = tests.tid('a');
select is(pg_temp.path('a_owner', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('a')), 'subscription,status') || '/' || pg_temp.get('a_owner', 'plan,id') || '/' || coalesce(pg_temp.get('a_owner', 'subscription,grace_until'), 'no grace'), 'cancelled/free_trial/no grace', 'F29b CANCEL AFTER A FAILED PAYMENT: ends at once, back to the base plan, no grace period left');
-- workspace b: the cancel before day 30 means no charge at all
select is(pg_temp.path('b_owner', format($q$select public.billing_start_trial(%L, 'business', 'fake', 'sub_fake_b1')::text$q$, tests.tid('b')), 'subscription,status'), 'trialing', 'F30 workspace b starts a Business trial');
select is(pg_temp.v('b_sales', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('b'))), 'ERR:42501', 'F31 DENY: Sales cannot cancel');
select is(pg_temp.val('aal1', 'b_owner', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('b'))), 'ERR:SM306', 'F32 a second factor is needed to cancel');
select is(pg_temp.path('b_owner', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('b')), 'subscription,status') , 'cancelled', 'F33 CANCEL BEFORE DAY 30: cancelled at once');
select is(pg_temp.get('b_owner', 'subscription,payment_method_on_file', 'b') || '/' || (select count(*) from public.billing_events where tenant_id = tests.tid('b') and kind like 'charge%')::text, 'false/0', 'F34 no payment method on file, and not one charge, ever');
select is(pg_temp.v('b_owner', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('b'))), 'ERR:SM823', 'F35 cancelling again: nothing to cancel (SM823)');
select is(pg_temp.v('b_owner', format($q$select public.billing_start_trial(%L, 'business', 'fake', 'sub_fake_b2')::text$q$, tests.tid('b'))), 'ERR:SM822', 'F36 and no second trial after a cancelled one');
select is(pg_temp.v('a_owner', format($q$select public.billing_cancel(%L)::text$q$, tests.tid('b'))), 'ERR:42501', 'F37 DENY: another business''s Owner');

-- the calls-only plans and pay as you go
update public.tenants set plan = 'calls_300' where id = tests.tid('b');
select is(pg_temp.get('b_owner', 'usage,call_minutes,allowance', 'b') || '/' || pg_temp.get('b_owner', 'usage,whatsapp_messages,included', 'b') || '/' || pg_temp.get('b_owner', 'usage,whatsapp_messages,state', 'b'), '300/false/stopped', 'F38 Calls 300: 300 minutes; no business messages included (shown as not included, stopped)');
update public.tenants set plan = 'calls_payg' where id = tests.tid('b');
select is(coalesce(pg_temp.get('b_owner', 'usage,call_minutes,allowance', 'b'), '') || '/' || coalesce(pg_temp.get('b_owner', 'usage,call_minutes,percent', 'b'), 'null') || '/' || pg_temp.get('b_owner', 'usage,call_minutes,state', 'b') || '/' || pg_temp.get('b_owner', 'usage,call_minutes,included', 'b'), '/null/ok/true', 'F39 pay as you go: no ceiling (no allowance, no percent), never stopped');
update public.tenants set plan = 'free_trial' where id = tests.tid('b');

-- ============================================================================ G. guards, audit
select is(pg_temp.sc($$update public.billing_usage_events set units = 2$$), '42501', 'G1 the usage ledger is never changed');
select is(pg_temp.sc($$delete from public.billing_notices$$), '42501', 'G2 notices are never deleted');
select is(pg_temp.sc($$truncate public.billing_events$$), '42501', 'G3 nor the provider events truncated');
select is(pg_temp.sc($$update public.billing_subscriptions set status = 'active'$$), '42501', 'G4 a subscription changes only through its functions (even for the owner of the table)');
select is(pg_temp.sc($$delete from public.billing_subscriptions$$), '42501', 'G5 and is never deleted');
select is(pg_temp.v('a_owner', format($q$update public.billing_subscriptions set status = 'active' where tenant_id = %L$q$, tests.tid('a'))), 'ERR:42501', 'G6 DENY: a client cannot write it');
select is(pg_temp.v('a_owner', format($q$insert into public.billing_usage_events (tenant_id, kind, ref_id, units) values (%L, 'call_minutes', gen_random_uuid(), 1)$q$, tests.tid('a'))), 'ERR:42501', 'G7 DENY: nor insert usage');
select is(tests.scalar_as(tests.uid('a_owner'), format($q$select count(*) from public.billing_usage_events where tenant_id = %L$q$, tests.tid('b'))), '0', 'G8 row-level security: an Owner sees no other business''s usage');
select is(tests.scalar_as(tests.uid('a_sales'), format($q$select count(*) from public.billing_usage_events where tenant_id = %L$q$, tests.tid('a'))), '0', 'G9 ...and Sales see none at all');
select cmp_ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'billing_subscription'), '>=', 3::bigint, 'G10 subscription changes are in the audit trail');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'billing_event'), (select count(*) from public.billing_events where tenant_id = tests.tid('a')), 'G11 every provider event is audited');
select is((select count(*) from pg_attribute where attrelid = 'public.billing_subscriptions'::regclass and attname ~* '(card|upi|vpa|account|token|secret|pan)' and not attisdropped), 0::bigint, 'G12 no card, UPI or account detail has a column: only an opaque provider reference');

select * from finish();
rollback;
