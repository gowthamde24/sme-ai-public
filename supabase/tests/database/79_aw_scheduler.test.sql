-- Job AW (ADR 0068): the SCHEDULER. The worker's principal, the two switches, releasing held messages (quiet hours), visit reminders (the evening before, a few hours before), the
-- automatic no-show, the business's settings, the tick's log, the Owner's read, row-level security, guards and audit.
--   A catalog          B the principal       C the two switches       D release (quiet hours, leases, a crashed tick, STOP)       E reminders (windows, idempotency, midnight)
--   F no-show          G settings            H the tick's record, the heartbeat, the Owner's read              I RLS and guards      J audit
--
-- THE CLOCK. Every scheduler decision reads app.outbox_now() (the AT seam), so this file never leans on the real time: the seam is replaced for this transaction (rolled back at the end).
-- Sections A, B, C, G, H, I, J run at ONE pinned instant, Monday 2026-10-05 14:00 IST by default; to run them at another start psql with
-- PGOPTIONS='-c tests.sched_pin=2026-10-05T23:30:00+05:30'. Sections D, E and F pin their own instants (08:59 / 09:00 / 20:59 / 21:00, a visit at 00:30, ...) and so do not depend on it.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();

-- ---------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.main_pin() returns void language sql as $$
  select pg_temp.pin(coalesce(nullif(current_setting('tests.sched_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz) $$;
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.mk(p_label text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone)
  values (tests.rid(p_label || '_c'), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'Contact ' || p_label, '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), tests.rid(p_label || '_c'));
  if p_tenant = 'a' then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:aw')$q$, tests.tid(p_tenant), tests.rid(p_label || '_c')));
  end if;
end $$;
-- the worker: every call is made as the registered principal (the unaffiliated fixture user "outsider")
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.len(p_json text) returns integer language sql as $$ select case when p_json like 'ERR:%' then -1 else jsonb_array_length(p_json::jsonb) end $$;
create function pg_temp.claim(p_tenant text default 'a', p_limit int default 20) returns text language sql as $$
  select pg_temp.sch(format('select public.scheduler_claim_due(%L, %s)', tests.tid(p_tenant), p_limit)) $$;
create function pg_temp.claimed(p_msg text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(pg_temp.claim()::jsonb) e where e ->> 'id' = tests.rid(p_msg)::text) $$;
create function pg_temp.due(p_visit text, p_kind text, p_tenant text default 'a') returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid(p_tenant)))::jsonb) e
                  where e ->> 'visit_id' = tests.rid(p_visit)::text and e ->> 'kind' = p_kind) $$;
create function pg_temp.q(p_visit text, p_kind text, p_msg text, p_body text default 'A reminder: your visit to our shop is coming up. We look forward to seeing you.', p_lang text default 'en',
                          p_unc boolean default false, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sch(format($q$select public.scheduler_queue_reminder(%L, %L, %L, %L, %L, %L, %L)$q$, tests.tid(p_tenant), tests.rid(p_visit), p_kind, tests.rid(p_msg), p_body, p_lang, p_unc)) $$;
create function pg_temp.sub(p_msg text, p_lead text, p_text text, p_cat text default 'info') returns text language sql as $$
  select pg_temp.sc('a_owner', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', %L, 'en', %L, 'owner')$q$, tests.rid(p_msg), tests.tid('a'), tests.rid(p_lead), p_text, p_cat)) $$;
create function pg_temp.mst(p_msg text) returns text language sql as $$ select status || '/' || reason from public.outbox_messages where id = tests.rid(p_msg) $$;
create function pg_temp.book(p_visit text, p_lead text, p_date date, p_slot text) returns text language sql as $$
  select pg_temp.sc('a_owner', format($q$select public.visit_book(%L, %L, %L, %L, %L, 2, null, null, null, 'staff')$q$, tests.rid(p_visit), tests.tid('a'), tests.rid(p_lead), p_date, p_slot)) $$;
create function pg_temp.step(p_visit text, p_action text) returns text language sql as $$
  select pg_temp.sc('a_owner', format($q$select public.visit_step(%L, %L, %L, null)$q$, tests.tid('a'), tests.rid(p_visit), p_action)) $$;
create function pg_temp.vst(p_visit text) returns text language sql as $$ select status from public.store_visits where id = tests.rid(p_visit) $$;
create function pg_temp.vmsg(p_visit text, p_kind text, p_msg text, p_lang text default 'en', p_unc boolean default false) returns text language sql as $$
  select pg_temp.sc('a_owner', format($q$select public.visit_send_message(%L, %L, %L, %L, 'Your visit is on. We look forward to seeing you at our shop.', %L, %L)$q$,
                                     tests.tid('a'), tests.rid(p_visit), p_kind, tests.rid(p_msg), p_lang, p_unc)) $$;
create function pg_temp.set_sched(p_ev boolean, p_ev_hour int, p_hu boolean, p_hu_min int, p_ns boolean, p_ns_min int, p_user text default 'a_owner', p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.scheduler_settings_set(%L, %L, %s, %L, %s, %L, %s)', tests.tid('a'), p_ev, p_ev_hour, p_hu, p_hu_min, p_ns, p_ns_min), p_aal) $$;
create function pg_temp.status(p_user text default 'a_owner', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.scheduler_status(%L)', tests.tid(p_tenant))) $$;

select pg_temp.main_pin();

-- ---------------------------------------------------------------------------------------------
-- A. catalog: tables, RLS, grants, definers
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where ((n.nspname = 'public' and c.relname in ('scheduler_settings', 'visit_reminders', 'scheduler_runs')) or (n.nspname = 'scheduler' and c.relname in ('principals', 'heartbeat')))
              and c.relrowsecurity and c.relforcerowsecurity), 5::bigint, 'row-level security is on and forced for all five tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('scheduler_settings', 'visit_reminders', 'scheduler_runs')
            and grantee in ('anon', 'authenticated', 'public') and privilege_type <> 'SELECT'), 0::bigint, 'no client role can write the public tables directly');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'scheduler' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint,
          'no client role holds any right on the worker''s own tables (principals, heartbeat)');
select is((select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'scheduler', 'usage')), 0::bigint, 'no client role can even reach schema scheduler');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'scheduler\_%' and p.prosecdef and 'search_path=""' = any (p.proconfig)), 20::bigint,
          'the eleven scheduler functions (and the three the connectors added, job BZ, the campaign run, job CP, the student retention, job CR, the two voice-note calls, job CV, and the two billing-reminder calls, job DI) are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'scheduler\_%' and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'anon cannot execute any scheduler function');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'scheduler\_%' and not has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint,
          'authenticated can call all of them (each one checks who is calling first)');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join unnest(array['anon', 'authenticated', 'service_role']) r
            where n.nspname = 'app' and (p.proname in ('is_scheduler', 'operator_register_scheduler', 'operator_remove_scheduler', 'outbox_submit_core', 'outbox_claim_due_core', 'outbox_mark_core',
                                                        'scheduler_tenant_on', 'scheduler_reminder_due', 'scheduler_settings_json', 'scheduler_error', 'memberships_refuse_scheduler')) and has_function_privilege(r, p.oid, 'execute')),
          0::bigint, 'no client role can execute the helpers, the operator functions or the three outbox cores');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('outbox_submit_core', 'outbox_claim_due_core', 'outbox_mark_core') and not p.prosecdef), 3::bigint,
          'the cores take no role decision and are not callable by clients: they are plain functions the definer wrappers call');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) from pg_attribute a
            where a.attrelid = 'public.scheduler_runs'::regclass and a.attnum > 0 and not a.attisdropped and a.attname not in ('id', 'tenant_id', 'run_at')),
          'sent:integer, failed:integer, reminders:integer, no_shows:integer, errors:integer', 'the tick''s log holds COUNTS only: no text, no phone, no name');
select is(app.scheduler_settings_json(tests.tid('a')) - 'is_default',
          '{"no_show_enabled": false, "no_show_after_minutes": 30, "reminder_evening_hour": 18, "reminder_evening_enabled": true, "reminder_heads_up_minutes": 120, "reminder_heads_up_enabled": true}'::jsonb,
          'the defaults: evening reminder at 18:00 on, heads-up 120 minutes on, automatic no-show OFF (30 minutes when switched on)');
select is((app.scheduler_settings_json(tests.tid('a')) ->> 'is_default')::boolean, true, '...and the settings say they are the defaults');

-- ---------------------------------------------------------------------------------------------
-- B. the principal
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.sch('select public.scheduler_tenants()'), 'ERR:42501', 'BEFORE registration: the account that will be the worker is nobody (42501)');
select is(pg_temp.sc('a_owner', 'select public.scheduler_tenants()'), 'ERR:42501', 'an Owner is not the scheduler (42501)');
select is(pg_temp.priv(format('select tests.scalar_as(%L, %L)', tests.uid('a_owner'), 'select app.operator_register_scheduler(''outsider@test.local'')')), '42501', 'a signed-in caller cannot register a scheduler (not executable, and operator only)');
select is(pg_temp.priv($$select app.operator_register_scheduler('a_owner@test.local')$$), '42501', 'REGISTER: an account that belongs to a workspace is refused (42501)');
select is(pg_temp.priv($$select app.operator_register_scheduler('nobody-at-all@test.local')$$), '23503', 'REGISTER: an unknown account is refused (23503)');
select is((select app.operator_register_scheduler('Outsider@test.local')), tests.uid('outsider'), 'REGISTER: the operator registers the account (case does not matter)');
select is((select app.operator_register_scheduler('outsider@test.local')), tests.uid('outsider'), '...and doing it again changes nothing');
select is((select count(*) from scheduler.principals), 1::bigint, '...exactly one principal');
select is(pg_temp.priv(format($i$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$i$, tests.tid('a'), tests.uid('outsider'))), '42501', 'the worker account can never join a workspace (42501)');
select is(pg_temp.priv(format($i$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$i$, tests.tid('a'), tests.uid('x1'))), 'ok', '...while another unaffiliated account can (the trigger is about the worker only)');
select is(pg_temp.sch('select public.scheduler_tenants()'), '[]', 'AFTER registration: the principal can call (nothing to do yet)');
select is(pg_temp.sc('x2', 'select public.scheduler_tenants()'), 'ERR:42501', 'another unaffiliated account is refused (42501)');
select is(pg_temp.priv($$select tests.scalar_as(null, 'select public.scheduler_tenants()')$$), '42501', 'anonymous is refused (42501)');
-- the principal sees nothing and cannot use the people's functions
select is(tests.scalar_as(tests.uid('outsider'), 'select count(*) from public.leads'), '0', 'ROW LEVEL SECURITY: the principal reads no lead');
select is(tests.scalar_as(tests.uid('outsider'), 'select count(*) from public.outbox_messages'), '0', '...no message');
select is(tests.scalar_as(tests.uid('outsider'), 'select count(*) from public.store_visits'), '0', '...no visit');
select is(tests.scalar_as(tests.uid('outsider'), 'select count(*) from public.contacts'), '0', '...no contact');
select is(tests.scalar_as(tests.uid('outsider'), 'select count(*) from public.scheduler_runs'), '0', '...no run');
select is(pg_temp.sch(format('select public.outbox_claim_due(%L, 5)', tests.tid('a'))), 'ERR:42501', 'PEOPLE''S FUNCTIONS: outbox_claim_due is refused to the principal (it has no workspace role)');
select is(pg_temp.sch(format('select public.outbox_mark(%L, %L, ''sent'', ''fake'', ''x'')', tests.tid('a'), tests.rid('nothing'))), 'ERR:42501', '...outbox_mark too');
select is(pg_temp.sch(format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', 'Hello there', 'en', 'info')$q$, tests.rid('nothing'), tests.tid('a'), tests.rid('nothing'))), 'ERR:42501', '...outbox_submit too');
select is(pg_temp.sch(format('select public.visit_step(%L, %L, ''confirm'')', tests.tid('a'), tests.rid('nothing'))), 'ERR:42501', '...and the visit steps');
select is(pg_temp.sch(format('select public.scheduler_status(%L)', tests.tid('a'))), 'ERR:42501', '...and the Owner''s read (the principal is not a member)');
select is(pg_temp.sch(format('select public.scheduler_settings_get(%L)', tests.tid('a'))), 'ERR:42501', '...and the settings');
-- the Owner / Admin cannot call the worker's functions
select is(pg_temp.sc('a_owner', format('select public.scheduler_claim_due(%L)', tests.tid('a'))), 'ERR:42501', 'an Owner cannot call scheduler_claim_due (42501)');
select is(pg_temp.sc('a_admin', format('select public.scheduler_queue_reminder(%L, %L, ''heads_up'', %L, ''Hello there friend'', ''en'', false)', tests.tid('a'), tests.rid('nothing'), tests.rid('nothing2'))), 'ERR:42501', 'an Admin cannot queue a reminder as the scheduler (42501)');
select is(pg_temp.sc('a_owner', 'select public.scheduler_heartbeat(60)'), 'ERR:42501', '...nor beat its heart');
select is(pg_temp.sc('a_owner', format($q$select public.scheduler_mark(%L, %L, 'sent', 'fake', 'x')$q$, tests.tid('a'), tests.rid('nothing'))), 'ERR:42501', '...nor report what the channel said (scheduler_mark)');
select is(pg_temp.sc('a_admin', format('select public.scheduler_due_reminders(%L)', tests.tid('a'))), 'ERR:42501', '...nor list the reminders that are due');
select is(pg_temp.sc('x2', format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), 'ERR:42501', '...and an unaffiliated account cannot mark no-shows');
select is(pg_temp.sc('x2', format('select public.scheduler_record(%L, 1, 0, 0, 0, 0)', tests.tid('a'))), 'ERR:42501', '...nor write the tick''s record');
select is(pg_temp.sc('x2', format($q$select public.scheduler_mark(%L, %L, 'sent', 'fake', 'x')$q$, tests.tid('a'), tests.rid('nothing'))), 'ERR:42501', '...nor mark a message');
-- removing the registration takes the power away at once
select app.operator_remove_scheduler('outsider@test.local');
select is(pg_temp.sch('select public.scheduler_tenants()'), 'ERR:42501', 'REMOVED: the account is nobody again');
select is((select app.operator_register_scheduler('outsider@test.local')), tests.uid('outsider'), 'REGISTERED again');
select is(pg_temp.priv(format($i$select tests.scalar_as(%L, $s$select app.operator_remove_scheduler('outsider@test.local')$s$)$i$, tests.uid('a_owner'))), '42501', 'a signed-in caller cannot remove the registration (42501)');

-- ---------------------------------------------------------------------------------------------
-- C. the two switches: the global one and the business's own
-- ---------------------------------------------------------------------------------------------
select is((select enabled from public.platform_flags where key = 'outbox_enabled'), false, 'the global kill switch is OFF by default');
select is(pg_temp.sch('select public.scheduler_tenants()'), '[]', 'GLOBAL OFF: no business is listed');
select is(pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a'))), '{"quiet_hours_end": 9, "auto_send_enabled": true, "quiet_hours_start": 21, "per_customer_daily_limit": 5}', 'the Owner switches automatic sending on');
select is(pg_temp.sch('select public.scheduler_tenants()'), '[]', 'GLOBAL OFF, business ON: still nobody is listed');
select is(pg_temp.claim(), '[]', '...claim answers nothing');
select is(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid('a'))), '[]', '...no reminder is due');
select is(pg_temp.j(pg_temp.q('nothing', 'heads_up', 'c_m1'), 'status'), 'skipped', '...queueing a reminder is skipped...');
select is(pg_temp.j(pg_temp.q('nothing', 'heads_up', 'c_m1'), 'reason'), 'off', '...for the reason "off"');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 0}', '...no visit is marked');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.sch('select public.scheduler_tenants()'), format('["%s"]', tests.tid('a')), 'BOTH ON: exactly the business that switched automatic sending on is listed (not business b)');
select is(pg_temp.claim('b'), '[]', 'a business that did not switch it on: claim answers nothing');
select is(pg_temp.j(pg_temp.q('nothing', 'heads_up', 'c_m2', p_tenant => 'b'), 'reason'), 'off', '...and queueing is skipped');
select is(pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, false, 5)', tests.tid('a'))), '{"quiet_hours_end": 9, "auto_send_enabled": false, "quiet_hours_start": 21, "per_customer_daily_limit": 5}', 'the Owner switches automatic sending OFF');
select is(pg_temp.sch('select public.scheduler_tenants()'), '[]', 'BUSINESS OFF: nobody is listed');
select is(pg_temp.claim(), '[]', '...claim answers nothing');
select is(pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a'))), '{"quiet_hours_end": 9, "auto_send_enabled": true, "quiet_hours_start": 21, "per_customer_daily_limit": 5}', 'and on again');
select is(pg_temp.sch('select public.scheduler_heartbeat(2)'), 'ERR:22023', 'INVALID: an interval under 5 seconds (22023)');
select is(pg_temp.sch('select public.scheduler_claim_due(null, 5)'), 'ERR:42501', 'a missing tenant is refused (42501)');
select is(pg_temp.claim('a', 0), 'ERR:22023', 'INVALID: a claim limit of 0 (22023)');
select is(pg_temp.claim('a', 51), 'ERR:22023', 'INVALID: a claim limit of 51 (22023)');

-- ---------------------------------------------------------------------------------------------
-- D. release: quiet hours, the lease, a crashed tick, the kill switch, automatic sending off, STOP
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('d1'); select pg_temp.mk('d2'); select pg_temp.mk('d3'); select pg_temp.mk('d4'); select pg_temp.mk('d5'); select pg_temp.mk('d6');
-- d1: made at night, held for 09:00
select pg_temp.pin('2026-10-05 22:00:00+05:30');
select is(pg_temp.j(pg_temp.sub('d_m1', 'd1', 'Our new silk collection has arrived at the shop.'), 'reason'), 'quiet_hours', 'NIGHT 22:00: a message is queued for the morning (quiet_hours)');
select is((select scheduled_for from public.outbox_messages where id = tests.rid('d_m1')), timestamptz '2026-10-06 09:00:00+05:30', '...scheduled for 09:00 India time');
select pg_temp.pin('2026-10-06 08:59:00+05:30');
select is(pg_temp.claim(), '[]', '08:59: nothing is released');
select is(pg_temp.mst('d_m1'), 'queued/quiet_hours', '...the message waits, untouched');
select pg_temp.pin('2026-10-06 09:00:00+05:30');
select is(pg_temp.claimed('d_m1'), true, '09:00: the held message is released (claimed for the channel)');
select is((select attempts from public.outbox_messages where id = tests.rid('d_m1')), 1::smallint, '...one attempt');
select is(pg_temp.claim(), '[]', 'a SECOND worker at 09:00 gets nothing: the message is leased for two minutes');
select pg_temp.pin('2026-10-06 09:01:00+05:30');
select is(pg_temp.claim(), '[]', '...still nothing a minute later');
select pg_temp.pin('2026-10-06 09:02:01+05:30');
select is(pg_temp.claimed('d_m1'), true, 'CRASHED TICK: the lease lapsed after two minutes; the next tick offers the message again');
select is((select attempts from public.outbox_messages where id = tests.rid('d_m1')), 2::smallint, '...the second attempt');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_mark(%L, %L, 'sent', 'fake', 'fake-1')$q$, tests.tid('a'), tests.rid('d_m1'))), 'status'), 'sent', 'the channel said "sent": the message is sent');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_mark(%L, %L, 'sent', 'fake', 'fake-1')$q$, tests.tid('a'), tests.rid('d_m1'))), 'replayed'), 'true', '...telling it twice changes nothing');
select is(pg_temp.claim(), '[]', 'a sent message is never offered again');
select is((select created_by from public.outbox_messages where id = tests.rid('d_m1')), tests.uid('a_owner'), '...(the message was the Owner''s; the worker only delivered it)');
-- d2: ready by day, failed at 20:59
select pg_temp.pin('2026-10-06 20:30:00+05:30');
select is(pg_temp.j(pg_temp.sub('d_m2', 'd2', 'Our shop is open until half past eight today.'), 'reason'), 'auto_allowed', 'EVENING 20:30: a message is allowed at once');
select pg_temp.pin('2026-10-06 20:59:00+05:30');
select is(pg_temp.claimed('d_m2'), true, '20:59: still released (the last minute before quiet hours)');
select is(pg_temp.sch(format($q$select public.scheduler_mark(%L, %L, 'failed', 'fake', null, 'adapter_error')$q$, tests.tid('a'), tests.rid('d_m2'))) like '%"status": "failed"%', true, 'the channel said "failed": the message is failed');
select is(pg_temp.mst('d_m2'), 'failed/send_failed', '...with the reason send_failed');
-- d3: allowed at 20:59, due at 21:00: pushed to the morning
select pg_temp.pin('2026-10-06 20:59:00+05:30');
select is(pg_temp.j(pg_temp.sub('d_m3', 'd3', 'We have new sarees in store this week.'), 'reason'), 'auto_allowed', 'a message made at 20:59 is allowed');
select pg_temp.pin('2026-10-06 21:00:00+05:30');
select is(pg_temp.claim(), '[]', '21:00: quiet hours begin, nothing is released');
select is((select scheduled_for from public.outbox_messages where id = tests.rid('d_m3')), timestamptz '2026-10-07 09:00:00+05:30', '...the message is pushed to the next 09:00');
select pg_temp.pin('2026-10-07 09:00:00+05:30');
select is(pg_temp.claimed('d_m3'), true, 'next day 09:00: it is released');
select pg_temp.sch(format($q$select public.scheduler_mark(%L, %L, 'sent', 'fake', 'fake-3')$q$, tests.tid('a'), tests.rid('d_m3')));
-- d4: the global kill switch
select pg_temp.pin('2026-10-07 10:00:00+05:30');
select is(pg_temp.j(pg_temp.sub('d_m4', 'd4', 'Come and see the festival collection.'), 'reason'), 'auto_allowed', 'a message is queued by day');
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select is(pg_temp.claim(), '[]', 'KILL SWITCH off: nothing is released');
select is((select claimed_at is null and status = 'queued' from public.outbox_messages where id = tests.rid('d_m4')), true, '...and the message is untouched, not claimed, not failed');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.claimed('d_m4'), true, 'switch back on: the message goes');
select pg_temp.sch(format($q$select public.scheduler_mark(%L, %L, 'sent', 'fake', 'fake-4')$q$, tests.tid('a'), tests.rid('d_m4')));
-- d5: the business turned automatic sending off after the message was queued
select pg_temp.pin('2026-10-07 10:05:00+05:30');
select is(pg_temp.j(pg_temp.sub('d_m5', 'd5', 'The new collection is on display.'), 'reason'), 'auto_allowed', 'a message is queued while automatic sending is on');
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, false, 5)', tests.tid('a')));
select is(pg_temp.claim(), '[]', 'AUTOMATIC SENDING OFF: the worker releases nothing');
select is(pg_temp.mst('d_m5'), 'queued/auto_allowed', '...the message waits');
select is(jsonb_array_length(pg_temp.sc('a_owner', format('select public.outbox_claim_due(%L, 5)', tests.tid('a')))::jsonb), 1, '...but the Owner''s own "dispatch now" still releases it (the people''s function is unchanged)');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-5')$q$, tests.tid('a'), tests.rid('d_m5'))), 'status'), 'sent', '...and the Owner''s mark works');
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a')));
-- d6: STOP after the message was queued
select pg_temp.pin('2026-10-07 10:10:00+05:30');
select is(pg_temp.j(pg_temp.sub('d_m6', 'd6', 'Visit us for the wedding season sarees.'), 'reason'), 'auto_allowed', 'a message is queued');
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('d6_c')));
select is(pg_temp.claim(), '[]', 'STOP: after the customer opted out nothing is released');
select is(pg_temp.mst('d_m6'), 'blocked/stopped', '...the message is blocked (stopped)');
-- a business-b message is never offered to a claim for a
select is(pg_temp.claim('b'), '[]', 'business b (automatic sending off) is never claimed');

-- ---------------------------------------------------------------------------------------------
-- E. reminders: the evening before, a few hours before, once per visit
-- ---------------------------------------------------------------------------------------------
select pg_temp.pin('2026-10-05 12:00:00+05:30');
select pg_temp.sc('a_owner', format($q$select public.visit_settings_set(%L, %L::jsonb, '{}'::date[], 30, 8)$q$,
                                    tests.tid('a'), jsonb_build_object('mon', jsonb_build_object('open', '00:00', 'close', '24:00'), 'tue', jsonb_build_object('open', '00:00', 'close', '24:00'),
                                                                       'wed', jsonb_build_object('open', '00:00', 'close', '24:00'), 'thu', jsonb_build_object('open', '00:00', 'close', '24:00'),
                                                                       'fri', jsonb_build_object('open', '00:00', 'close', '24:00'), 'sat', jsonb_build_object('open', '00:00', 'close', '24:00'), 'sun', null)::text));
select pg_temp.mk('e1'); select pg_temp.mk('e2'); select pg_temp.mk('e3'); select pg_temp.mk('e4'); select pg_temp.mk('e5'); select pg_temp.mk('e6');
select pg_temp.mk('e7'); select pg_temp.mk('e8'); select pg_temp.mk('e9'); select pg_temp.mk('e10'); select pg_temp.mk('e11');
select pg_temp.book('v1', 'e1', date '2026-10-06', '11:00');  select pg_temp.book('v2', 'e2', date '2026-10-06', '10:00');  select pg_temp.book('v3', 'e3', date '2026-10-06', '00:30');
select pg_temp.book('v4', 'e4', date '2026-10-06', '15:00');  select pg_temp.book('v5', 'e5', date '2026-10-06', '15:30');  select pg_temp.book('v6', 'e6', date '2026-10-06', '16:00');
select pg_temp.book('v7', 'e7', date '2026-10-06', '14:00');  select pg_temp.book('v8', 'e8', date '2026-10-06', '17:00');  select pg_temp.book('v9', 'e9', date '2026-10-06', '17:30');
select pg_temp.book('v10', 'e10', date '2026-10-06', '18:00'); select pg_temp.book('v11', 'e11', date '2026-10-06', '18:30');
select pg_temp.step(v, 'confirm') from unnest(array['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v10', 'v11']) v;
select pg_temp.step('v10', 'cancel');
select is((select count(*) from public.store_visits where tenant_id = tests.tid('a') and status = 'confirmed'), 9::bigint, 'nine confirmed visits (v9 is only booked, v10 was cancelled)');
-- v8's confirmation went out in Hindi (a language nobody has checked: it waits for a person, but it names the customer's language)
select is(pg_temp.j(pg_temp.vmsg('v8', 'confirmation', 'e_m8', 'hi', true), 'reason'), 'uncertain', 'v8: the confirmation was made in Hindi and waits for a person (uncertain)');
-- v5's confirmation went out BEFORE the evening window opens
select pg_temp.pin('2026-10-05 17:00:00+05:30');
select is(pg_temp.j(pg_temp.vmsg('v5', 'confirmation', 'e_m5'), 'reason'), 'auto_allowed', 'v5: a confirmation at 17:00');
select pg_temp.pin('2026-10-05 17:59:00+05:30');
select is(pg_temp.due('v1', 'evening_before'), false, 'EVENING 17:59: the window (from 18:00) has not opened');
select pg_temp.pin('2026-10-05 18:00:00+05:30');
select is(pg_temp.due('v1', 'evening_before'), true, 'EVENING 18:00: a confirmed visit TOMORROW is due its reminder');
select is(pg_temp.due('v1', 'heads_up'), false, '...and not yet its heads-up (tomorrow 09:00)');
select is((select string_agg(distinct e ->> 'kind', ',') from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid('a')))::jsonb) e), 'evening_before', 'only the evening kind is due at 18:00');
select is(pg_temp.due('v3', 'evening_before'), true, 'the visit at 00:30 tomorrow is due its evening reminder tonight');
select is(pg_temp.due('v9', 'evening_before'), false, 'a visit that is only BOOKED (the customer has not confirmed) gets none');
select is(pg_temp.due('v10', 'evening_before'), false, 'a CANCELLED visit gets none');
select is(pg_temp.due('v5', 'evening_before'), true, 'v5: the confirmation (17:00) came before the window, so the reminder is still due');
select is((select e ->> 'language' from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid('a')))::jsonb) e where e ->> 'visit_id' = tests.rid('v8')::text), 'hi', 'the reminder is in the language the confirmation went out in (v8: hi)');
select is((select e ->> 'language' from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid('a')))::jsonb) e where e ->> 'visit_id' = tests.rid('v1')::text), 'en', '...and English when there was none (v1)');
-- queue v1: once
select is(pg_temp.j(pg_temp.q('v1', 'evening_before', 'e_r1'), 'status'), 'queued', 'v1: the reminder is queued...');
select is(pg_temp.mst('e_r1'), 'queued/auto_allowed', '...through the outbox policy (auto allowed: automatic sending is on)');
select is((select (category, source, created_by = tests.uid('outsider'))::text from public.outbox_messages where id = tests.rid('e_r1')), '(visit,system,t)', '...a "visit" message from the system, made by the scheduler principal');
select is((select count(*) from public.visit_reminders where visit_id = tests.rid('v1')), 1::bigint, '...one reminder record');
select is((select reminder_message_id = tests.rid('e_r1') from public.store_visits where id = tests.rid('v1')), true, '...linked to the visit (Today shows "reminder sent")');
select is(pg_temp.j(pg_temp.q('v1', 'evening_before', 'e_r1'), 'status'), 'replayed', 'IDEMPOTENT: the same call again is a replay');
select is(pg_temp.j(pg_temp.q('v1', 'evening_before', 'e_r1x'), 'status'), 'replayed', 'IDEMPOTENT: another worker with another message id is a replay too...');
select is((select count(*) from public.outbox_messages where lead_id = tests.rid('e1') and category = 'visit'), 1::bigint, '...and there is exactly ONE message');
select is(pg_temp.due('v1', 'evening_before'), false, 'v1 is no longer on the due list');
select is(pg_temp.j(pg_temp.q('v9', 'evening_before', 'e_r9'), 'reason'), 'not_due', 'SKIPPED: a booked-only visit is not queued (not_due)');
select is(pg_temp.j(pg_temp.q('v10', 'evening_before', 'e_r10'), 'reason'), 'not_due', 'SKIPPED: a cancelled visit is not queued');
select is(pg_temp.q('nothing', 'evening_before', 'e_r0'), 'ERR:23503', 'an unknown visit is refused (23503)');
select is(pg_temp.q('v1', 'sometime', 'e_r0'), 'ERR:22023', 'an unknown kind is refused (22023)');
select is(pg_temp.q('v2', 'evening_before', 'e_r2', 'x'), 'ERR:22023', 'a body that is too short is refused by the outbox (22023)');
-- money in the words: queued by the outbox as "needs approval", and recorded once
select is(pg_temp.j(pg_temp.q('v11', 'evening_before', 'e_r11', 'Your advance of ₹500 is due before the visit.'), 'status'), 'queued', 'v11: a reminder that mentions an amount is still recorded...');
select is(pg_temp.mst('e_r11'), 'needs_approval/money', '...but the outbox holds it for a person (money): the worker cannot send it');
-- Hindi: unchecked words are held
select is(pg_temp.j(pg_temp.q('v8', 'evening_before', 'e_r8', 'याद दिलाना: आपकी विज़िट कल है। हमें आपका इंतज़ार रहेगा।', 'hi', true), 'status'), 'queued', 'v8: a Hindi reminder is recorded...');
select is(pg_temp.mst('e_r8'), 'needs_approval/uncertain', '...and held for a person (uncertain): unchecked words are never sent automatically');
-- v6 is queued, then moves
select is(pg_temp.j(pg_temp.q('v6', 'evening_before', 'e_r6'), 'status'), 'queued', 'v6: queued for tomorrow 16:00');
select pg_temp.pin('2026-10-05 18:05:00+05:30');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.visit_change(%L, %L, date '2026-10-07', '12:00', null, null, null, null)$q$, tests.tid('a'), tests.rid('v6'))), 'moved'), 'true', 'v6 moves to Wednesday 12:00 (back to booked)');
select is(pg_temp.due('v6', 'evening_before'), false, '...a booked visit gets no reminder until the customer confirms again');
select pg_temp.step('v6', 'confirm');
select is(pg_temp.due('v6', 'evening_before'), false, '...and when it is confirmed again it is not tomorrow yet');
-- v4: the customer was told at 19:00, after the window opened
select pg_temp.pin('2026-10-05 19:00:00+05:30');
select is(pg_temp.j(pg_temp.vmsg('v4', 'confirmation', 'e_m4'), 'reason'), 'auto_allowed', 'v4: a confirmation at 19:00');
select is(pg_temp.due('v4', 'evening_before'), false, 'v4: told a minute ago, so no evening reminder on top of it');
-- the edge of the evening
select pg_temp.pin('2026-10-05 20:59:00+05:30');
select is(pg_temp.due('v2', 'evening_before'), true, 'EVENING 20:59: still due (before 21:00)');
select pg_temp.pin('2026-10-05 21:00:00+05:30');
select is(pg_temp.due('v2', 'evening_before'), false, 'EVENING 21:00: quiet hours begin, nothing is due');
select is(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid('a'))), '[]', '...the list is empty');
select is(pg_temp.j(pg_temp.q('v2', 'evening_before', 'e_r2'), 'reason'), 'not_due', '...and queueing is refused as not due');
-- the visit at 00:30: the heads-up falls in quiet hours and is never sent
select pg_temp.pin('2026-10-05 22:30:00+05:30');
select is(pg_temp.due('v3', 'heads_up'), false, 'MIDNIGHT: the visit at 00:30 has no heads-up at 22:30 (quiet hours)');
select pg_temp.pin('2026-10-06 00:10:00+05:30');
select is(pg_temp.due('v3', 'heads_up'), false, '...nor at 00:10 (20 minutes before; and still quiet hours)');
-- the morning
select pg_temp.pin('2026-10-06 08:59:00+05:30');
select is(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid('a'))), '[]', '08:59: quiet hours, nothing is due');
select pg_temp.pin('2026-10-06 09:00:00+05:30');
select is(pg_temp.due('v2', 'heads_up'), true, '09:00: v2 (10:00) is due its heads-up');
select is(pg_temp.due('v1', 'heads_up'), true, '09:00: v1 (11:00) is due its heads-up: the 120 minutes began exactly at 09:00');
select is(pg_temp.due('v1', 'evening_before'), false, '...and the evening reminder is not (the visit is today)');
select is(pg_temp.due('v3', 'heads_up'), false, 'v3 (00:30, over) none');
select pg_temp.pin('2026-10-06 09:29:00+05:30');
select is(pg_temp.due('v2', 'heads_up'), true, '09:29: v2 (10:00) is 31 minutes away: still due');
select pg_temp.pin('2026-10-06 09:30:00+05:30');
select is(pg_temp.due('v2', 'heads_up'), false, '09:30: v2 is 30 minutes away: too late to be useful');
select pg_temp.pin('2026-10-06 09:00:00+05:30');
select is(pg_temp.j(pg_temp.q('v2', 'heads_up', 'e_h2'), 'status'), 'queued', 'v2: the heads-up is queued at 09:00...');
select is(pg_temp.mst('e_h2'), 'queued/auto_allowed', '...and goes at once (09:00 is not quiet)');
select is(pg_temp.j(pg_temp.q('v2', 'heads_up', 'e_h2'), 'status'), 'replayed', '...once');
select is((select count(*) from public.visit_reminders where visit_id = tests.rid('v2')), 1::bigint, 'v2: only the heads-up has been recorded so far (its evening reminder was never queued)');
-- a person reminded by hand inside the window
select pg_temp.pin('2026-10-06 12:30:00+05:30');
select is(pg_temp.j(pg_temp.vmsg('v7', 'reminder', 'e_m7'), 'reason'), 'auto_allowed', 'v7 (14:00): staff send a reminder by hand at 12:30');
select pg_temp.pin('2026-10-06 12:35:00+05:30');
select is(pg_temp.due('v7', 'heads_up'), false, '...so the automatic heads-up is not added on top of it');
select is(pg_temp.due('v5', 'heads_up'), false, 'v5 (15:30): the window (13:30) has not opened');
select pg_temp.pin('2026-10-06 13:30:00+05:30');
select is(pg_temp.due('v5', 'heads_up'), true, 'v5 (15:30) at 13:30: due');
-- v6 was moved to tomorrow 12:00: a NEW appointment, reminded again tomorrow evening
select pg_temp.pin('2026-10-06 18:00:00+05:30');
select is(pg_temp.due('v6', 'evening_before'), true, 'v6 moved to Wednesday: its evening reminder is due on Tuesday evening, although the old time was reminded');
select is(pg_temp.j(pg_temp.q('v6', 'evening_before', 'e_r6b'), 'status'), 'queued', '...and is queued');
select is((select count(*) from public.visit_reminders where visit_id = tests.rid('v6') and kind = 'evening_before'), 2::bigint, '...two records, one for each time (never twice for the same time)');
-- settings change what is due: another visit, its own dates
select pg_temp.pin('2026-10-12 12:00:00+05:30');
select pg_temp.mk('e12');
select pg_temp.book('v12', 'e12', date '2026-10-13', '11:00');
select pg_temp.step('v12', 'confirm');
select pg_temp.pin('2026-10-12 19:59:00+05:30');
select is(pg_temp.due('v12', 'evening_before'), true, 'default hour 18: due at 19:59');
select is(pg_temp.j(pg_temp.set_sched(true, 20, true, 120, false, 30), 'reminder_evening_hour'), '20', 'the Owner moves the evening reminder to 20:00');
select is(pg_temp.due('v12', 'evening_before'), false, 'hour 20: not due at 19:59');
select pg_temp.pin('2026-10-12 20:00:00+05:30');
select is(pg_temp.due('v12', 'evening_before'), true, 'hour 20: due at 20:00');
select pg_temp.set_sched(false, 20, true, 120, false, 30);
select is(pg_temp.due('v12', 'evening_before'), false, 'evening reminders switched off: none');
select pg_temp.pin('2026-10-13 09:00:00+05:30');
select is(pg_temp.due('v12', 'heads_up'), true, 'heads-up 120 minutes: due at 09:00 for 11:00');
select pg_temp.set_sched(false, 20, true, 60, false, 30);
select is(pg_temp.due('v12', 'heads_up'), false, 'heads-up 60 minutes: not due at 09:00 (10:00 is when the window opens)');
select pg_temp.pin('2026-10-13 10:00:00+05:30');
select is(pg_temp.due('v12', 'heads_up'), true, '...due at 10:00');
select pg_temp.set_sched(true, 18, false, 120, false, 30);
select is(pg_temp.due('v12', 'heads_up'), false, 'heads-up switched off: none');
select pg_temp.set_sched(true, 18, true, 120, false, 30);
select is(pg_temp.sc('b_owner', format('select public.outbox_set_settings(%L, true, 3)', tests.tid('b'))), '{"quiet_hours_end": 9, "auto_send_enabled": true, "quiet_hours_start": 21, "per_customer_daily_limit": 3}', 'business b switches automatic sending on');
select is(pg_temp.q('v12', 'heads_up', 'e_h12', p_tenant => 'b'), 'ERR:23503', 'a visit of business a cannot be reminded for business b (23503): the tenant comes from the call, the visit must belong to it');
select is(pg_temp.sch('select public.scheduler_tenants()') like '%' || tests.tid('b')::text || '%', true, '(business b is now listed)');
select pg_temp.sc('b_owner', format('select public.outbox_set_settings(%L, false, 3)', tests.tid('b')));
select is(pg_temp.priv(format('select public.scheduler_queue_reminder(%L, %L, ''heads_up'', %L, ''A reminder about your visit.'', ''en'', false)', tests.tid('b'), tests.rid('v12'), tests.rid('e_x'))), '42501', '(privileged postgres has no auth.uid(): refused, 42501)');

-- ---------------------------------------------------------------------------------------------
-- F. automatic no-show
-- ---------------------------------------------------------------------------------------------
select pg_temp.pin('2026-10-07 12:00:00+05:30');
select pg_temp.mk('n1'); select pg_temp.mk('n2'); select pg_temp.mk('n3'); select pg_temp.mk('n4');
select pg_temp.book('nv1', 'n1', date '2026-10-08', '10:00'); select pg_temp.book('nv2', 'n2', date '2026-10-08', '11:00'); select pg_temp.book('nv3', 'n3', date '2026-10-08', '12:00');
select pg_temp.book('nv4', 'n4', date '2026-10-08', '00:30');
select pg_temp.step(v, 'confirm') from unnest(array['nv1', 'nv3', 'nv4']) v;
select pg_temp.set_sched(true, 18, true, 120, false, 30);
select pg_temp.pin('2026-10-08 11:30:00+05:30');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 0}', 'DEFAULT OFF: nobody is marked, however late');
select is((select count(*) from public.store_visits where id = any (array[tests.rid('nv1'), tests.rid('nv4')]) and status = 'confirmed'), 2::bigint, '...both late visits are still confirmed');
select pg_temp.pin('2026-10-07 23:59:00+05:30');
select is(pg_temp.j(pg_temp.set_sched(true, 18, true, 120, true, 30), 'no_show_enabled'), 'true', 'the Owner switches the automatic no-show on (30 minutes)');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 9}', 'the first run clears the backlog: the nine confirmed visits of section E, whose slots ended long ago, are marked');
select is((select count(*) from public.store_visits where id = any (array[tests.rid('nv1'), tests.rid('nv3'), tests.rid('nv4')]) and status = 'confirmed'), 3::bigint, '...and the visits of tomorrow are untouched');
select pg_temp.pin('2026-10-08 01:29:00+05:30');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 0}', '01:29: the 00:30 slot ended at 01:00, 29 minutes ago: not yet');
select pg_temp.pin('2026-10-08 01:30:00+05:30');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 1}', '01:30: exactly 30 minutes after the slot ended: marked');
select is(pg_temp.vst('nv4'), 'no_show', '...the visit is no_show');
select is((select closed_at from public.store_visits where id = tests.rid('nv4')), timestamptz '2026-10-08 01:30:00+05:30', '...closed at the tick''s instant');
select is((select updated_by from public.store_visits where id = tests.rid('nv4')), tests.uid('outsider'), '...by the scheduler principal');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 0}', 'a second run marks nobody again');
select pg_temp.pin('2026-10-08 10:59:00+05:30');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 0}', '10:59: the 10:00 slot ended at 10:30: 29 minutes ago: not yet');
select pg_temp.pin('2026-10-08 11:00:00+05:30');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 1}', '11:00: marked');
select is(pg_temp.vst('nv1'), 'no_show', '...nv1');
select is(pg_temp.vst('nv2'), 'booked', 'a visit the customer never confirmed (booked) is NOT marked');
select is(pg_temp.vst('nv3'), 'confirmed', 'a visit whose slot has not ended is NOT marked');
select pg_temp.pin('2026-10-08 13:00:00+05:30');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 1}', '13:00: the 12:00 visit is marked');
select is(pg_temp.vst('nv2'), 'booked', '...the booked one stays booked');
select is(pg_temp.set_sched(true, 18, true, 120, true, 4), 'ERR:22023', 'INVALID: fewer than 5 minutes (22023)');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('b'))), '{"marked": 0}', 'business b (automatic sending off): nothing');
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 0}', 'KILL SWITCH off: the no-show run does nothing either');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.sc('a_owner', format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), 'ERR:42501', 'an Owner cannot call it (42501)');

-- ---------------------------------------------------------------------------------------------
-- G. settings
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.scheduler_settings_get(%L)', tests.tid('a'))), 'reminder_heads_up_minutes'), '120', 'an Admin reads the settings');
select is(pg_temp.sc('a_sales', format('select public.scheduler_settings_get(%L)', tests.tid('a'))), 'ERR:42501', 'Sales cannot (42501)');
select is(pg_temp.sc('a_viewer', format('select public.scheduler_settings_get(%L)', tests.tid('a'))), 'ERR:42501', 'a Viewer cannot (42501)');
select is(pg_temp.sc('b_owner', format('select public.scheduler_settings_get(%L)', tests.tid('a'))), 'ERR:42501', 'another business''s Owner cannot (42501)');
select is(pg_temp.set_sched(true, 18, true, 120, false, 30, 'a_admin'), 'ERR:42501', 'an Admin cannot change them (the Owner does, 42501)');
select is(pg_temp.set_sched(true, 18, true, 120, false, 30, 'a_owner', 'aal1'), 'ERR:SM306', 'the Owner needs a second factor (SM306)');
select is(pg_temp.j(pg_temp.set_sched(true, 17, false, 90, true, 45), 'is_default'), 'false', 'the Owner saves their own settings');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.scheduler_settings_get(%L)', tests.tid('a'))), 'no_show_after_minutes'), '45', '...and they read back');
select is(pg_temp.set_sched(true, 8, true, 120, false, 30), 'ERR:22023', 'INVALID: an evening hour before 09:00 (22:00 is the quiet-hours edge)');
select is(pg_temp.set_sched(true, 21, true, 120, false, 30), 'ERR:22023', 'INVALID: an evening hour at 21:00 or later');
select is(pg_temp.set_sched(true, 18, true, 59, false, 30), 'ERR:22023', 'INVALID: a heads-up under 60 minutes');
select is(pg_temp.set_sched(true, 18, true, 481, false, 30), 'ERR:22023', 'INVALID: a heads-up over 480 minutes');
select is(pg_temp.set_sched(true, 18, true, 120, false, 721), 'ERR:22023', 'INVALID: a no-show wait over 720 minutes');
select is(pg_temp.sc('a_owner', format('select public.scheduler_settings_set(%L, null, 18, true, 120, false, 30)', tests.tid('a'))), 'ERR:22023', 'INVALID: a missing switch');
select is(pg_temp.sc('b_owner', format('select public.scheduler_settings_set(%L, true, 18, true, 120, false, 30)', tests.tid('a'))), 'ERR:42501', 'another business''s Owner cannot change them (42501)');
select pg_temp.set_sched(true, 18, true, 120, false, 30);

-- ---------------------------------------------------------------------------------------------
-- H. the tick's record, the heartbeat, the Owner's read
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select is(pg_temp.j(pg_temp.status(), 'worker_running'), 'false', 'BEFORE any heartbeat: the worker is not running...');
select is(pg_temp.j(pg_temp.status(), 'next_run_at') is null, true, '...and there is no next run');
select is(pg_temp.j(pg_temp.status(), 'platform_switch_on'), 'true', 'the global switch (on)');
select is(pg_temp.j(pg_temp.status(), 'active'), 'true', '...and the business (on) make the worker active for it');
select is(pg_temp.sch('select public.scheduler_heartbeat(60, 0)'), '', 'the worker beats its heart (interval 60 seconds)');
select is(pg_temp.j(pg_temp.status(), 'worker_running'), 'true', '...the Owner sees the worker is running');
select is((pg_temp.j(pg_temp.status(), 'last_run_at'))::timestamptz, coalesce(nullif(current_setting('tests.sched_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz, '...last run is this instant');
select is((pg_temp.j(pg_temp.status(), 'next_run_at'))::timestamptz, coalesce(nullif(current_setting('tests.sched_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz + interval '60 seconds', '...next run is one interval later');
select is(pg_temp.j(pg_temp.status(), 'interval_seconds'), '60', '...with the interval');
select pg_temp.pin(coalesce(nullif(current_setting('tests.sched_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz + interval '179 seconds');
select is(pg_temp.j(pg_temp.status(), 'worker_running'), 'true', '179 seconds later (under three intervals): still running');
select pg_temp.pin(coalesce(nullif(current_setting('tests.sched_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz + interval '181 seconds');
select is(pg_temp.j(pg_temp.status(), 'worker_running'), 'false', '181 seconds later: the worker has stopped (worker_running false)');
select is(pg_temp.j(pg_temp.status(), 'next_run_at') is null, true, '...and no next run is promised');
select pg_temp.main_pin();
-- the tally
select is((select count(*) from public.scheduler_runs where tenant_id = tests.tid('a')), 0::bigint, 'no run record yet (an idle tick writes none)');
select is(pg_temp.sch(format('select public.scheduler_record(%L, 0, 0, 0, 0, 0)', tests.tid('a'))), '', 'an all-zero tick is accepted...');
select is((select count(*) from public.scheduler_runs where tenant_id = tests.tid('a')), 0::bigint, '...and writes nothing');
select pg_temp.sch(format('select public.scheduler_record(%L, 2, 1, 3, 0, 0)', tests.tid('a')));
select pg_temp.sch(format('select public.scheduler_record(%L, 1, 0, 0, 1, 1)', tests.tid('a')));
select is((select count(*) from public.scheduler_runs where tenant_id = tests.tid('a')), 2::bigint, 'two eventful ticks: two records');
select is(pg_temp.status()::jsonb -> 'today', '{"sent": 3, "failed": 1, "reminders": 3, "no_shows": 1, "errors": 1}'::jsonb, 'TODAY (India day): sent 3, failed 1, reminders 3, no-shows 1, errors 1');
select is(pg_temp.j(pg_temp.status(), 'last_activity_at') is not null, true, '...and the time of the last activity');
select pg_temp.pin(coalesce(nullif(current_setting('tests.sched_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz + interval '1 day');
select is(pg_temp.status()::jsonb -> 'today', '{"sent": 0, "failed": 0, "reminders": 0, "no_shows": 0, "errors": 0}'::jsonb, 'the next India day starts at zero');
select pg_temp.main_pin();
select is(pg_temp.sch(format('select public.scheduler_record(%L, -1, 0, 0, 0, 0)', tests.tid('a'))), 'ERR:22023', 'INVALID: a negative count (22023)');
select is(pg_temp.sch(format('select public.scheduler_record(%L, 0, 0, 0, 0, 100001)', tests.tid('a'))), 'ERR:22023', 'INVALID: an absurd count (22023)');
select is(pg_temp.sch(format('select public.scheduler_record(%L, 1, 0, 0, 0, 0)', tests.rid('no_such_tenant'))), 'ERR:23503', 'an unknown business is refused (23503)');
select is(pg_temp.sc('a_owner', format('select public.scheduler_record(%L, 1, 0, 0, 0, 0)', tests.tid('a'))), 'ERR:42501', 'an Owner cannot write the record (42501)');
select is(pg_temp.status('a_admin') like '%"today"%', true, 'an Admin reads the status');
select is(pg_temp.status('a_sales'), 'ERR:42501', 'Sales cannot (42501)');
select is(pg_temp.status('a_viewer'), 'ERR:42501', 'a Viewer cannot (42501)');
select is(pg_temp.status('b_owner', 'a'), 'ERR:42501', 'another business''s Owner cannot read business a (42501)');
select is(pg_temp.status('b_owner', 'b')::jsonb -> 'today', '{"sent": 0, "failed": 0, "reminders": 0, "no_shows": 0, "errors": 0}'::jsonb, 'business b sees only its own (zeros)');
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select is(pg_temp.j(pg_temp.status(), 'active'), 'false', 'GLOBAL OFF: the Owner''s read says the worker is not active for the business');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.j(pg_temp.status(), 'auto_send_enabled'), 'true', '...and shows the business''s own switch');

-- ---------------------------------------------------------------------------------------------
-- I. row-level security and guards
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select is(tests.scalar_as(tests.uid('a_owner'), 'select count(*) from public.scheduler_runs') <> '0', true, 'RLS: an Owner reads their business''s runs');
select is(tests.scalar_as(tests.uid('a_sales'), 'select count(*) from public.scheduler_runs'), '0', '...Sales read none');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from public.scheduler_runs'), '0', '...another business''s Owner reads none');
select is(tests.scalar_as(tests.uid('a_admin'), 'select count(*) from public.scheduler_settings') <> '0', true, '...an Admin reads the settings');
select is(tests.scalar_as(tests.uid('a_sales'), 'select count(*) from public.scheduler_settings'), '0', '...Sales do not');
select is(tests.scalar_as(tests.uid('a_sales'), 'select count(*) from public.visit_reminders') <> '0', true, '...Sales read the reminder records (they are about their visits)');
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from public.visit_reminders'), '0', '...a Viewer does not');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from public.visit_reminders'), '0', '...another business does not');
select is(tests.outcome_as(tests.uid('a_owner'), format($i$insert into public.scheduler_runs (tenant_id, run_at) values (%L, now())$i$, tests.tid('a'))), '42501', 'DIRECT WRITE: an Owner cannot insert a run (42501)');
select is(tests.outcome_as(tests.uid('a_owner'), format($i$update public.scheduler_settings set no_show_enabled = true where tenant_id = %L$i$, tests.tid('a'))), '42501', '...nor change the settings directly');
select is(tests.outcome_as(tests.uid('a_owner'), $i$delete from public.visit_reminders$i$), '42501', '...nor delete reminder records');
select is(pg_temp.priv('update public.visit_reminders set kind = ''heads_up'''), '42501', 'GUARD: a reminder record is never changed, not even by the database owner (42501)');
select is(pg_temp.priv('delete from public.visit_reminders'), '42501', '...never deleted');
select is(pg_temp.priv('truncate public.visit_reminders'), '42501', '...never truncated');
select is(pg_temp.priv('update public.scheduler_runs set sent = 5'), '42501', 'GUARD: a run record is never changed (42501)');
select is(pg_temp.priv('delete from public.scheduler_runs'), '42501', '...never deleted');
select is(pg_temp.priv('truncate public.scheduler_runs'), '42501', '...never truncated');
select is(pg_temp.priv('delete from public.scheduler_settings'), '42501', 'GUARD: settings are never deleted (42501)');
select is(pg_temp.priv('truncate public.scheduler_settings'), '42501', '...never truncated');
select is(pg_temp.priv('truncate public.store_visits cascade'), '42501', 'TRUNCATE ... CASCADE of the visits reaches the reminder records'' guard (42501)');
select is(pg_temp.priv('truncate public.outbox_messages cascade'), '42501', '...and so does a cascade from the outbox');
select is(pg_temp.priv(format('update public.scheduler_settings set tenant_id = %L where tenant_id = %L', tests.tid('b'), tests.tid('a'))), '42501', 'the business of a settings row cannot be changed (42501)');

-- ---------------------------------------------------------------------------------------------
-- J. audit
-- ---------------------------------------------------------------------------------------------
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'scheduler_settings') > 0, 'every change of the settings is audited');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'visit_reminder') > 0, 'every reminder record is audited');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'scheduler_run') > 0, 'every run record is audited (counts only)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type in ('scheduler_run', 'visit_reminder') and (new_values::text ~ '[+]00 9' or new_values::text ~* 'reminder: your visit')), 0::bigint,
          'the audit trail holds no phone number and no message text for the scheduler''s rows');

select * from finish();
rollback;
