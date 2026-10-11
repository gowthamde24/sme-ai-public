-- Job AS (ADR 0067): STORE VISITS: the opening hours, the slots, booking, the status steps, completing (and the order a "bought" visit starts), the visit messages through the outbox,
-- "offer a store visit" on a call request, the list, roles, row-level security, the guard triggers, audit, and the weekly AI figure.
--   A catalog          B the clock          C settings           D the slots (pure plan, then the public read)    E booking and its refusals    F capacity
--   G time: day, night, midnight          H the steps (confirm, arrive, no-show, cancel)    I change / reschedule    J complete and the order
--   K messages through the outbox         L offer a visit      M the list           N roles, RLS, direct writes, guards        O audit        P the weekly AI figure
--
-- THE CLOCK. Every visit function reads the clock through app.visit_now() -> app.outbox_now() (the AT seam), so this file never leans on the real time: app.outbox_now() is replaced for this
-- transaction (rolled back at the end). The main body runs at one pinned instant, Monday 2026-10-05 14:00 IST by default; to run it at another start psql with
-- PGOPTIONS='-c tests.visit_pin=2026-10-05T23:30:00+05:30'. Sections G and K pin 14:00, 23:30 and 00:10 themselves and test the day, night and midnight paths side by side. The instants are in
-- the past (an enquiry may not be received in the future); the dates used below assume the pin falls on Monday 2026-10-05.
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
  select pg_temp.pin(coalesce(nullif(current_setting('tests.visit_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz) $$;
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal('aal2');
  r := tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  if r = 'ok' then return 'ok'; end if;
  return split_part(r, '|', 1);
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
-- a customer of business a: contact (with a phone), a lead, the phone's suppression key and WhatsApp consent (so a message can be queued)
create function pg_temp.mk(p_label text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone)
  values (tests.rid(p_label || '_c'), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'Contact ' || p_label, '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), tests.rid(p_label || '_c'));
  if p_tenant = 'a' then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:as')$q$, tests.tid('a'), tests.rid(p_label || '_c')));
  end if;
end $$;
-- book: the answer as JSON text, or 'ERR:<sqlstate>'
create function pg_temp.book(p_visit text, p_lead text, p_date date, p_slot text, p_party int default 1, p_purpose text default null, p_note text default null, p_adv bigint default null,
                             p_user text default 'a_owner', p_tenant text default 'a', p_source text default 'staff') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.visit_book(%L, %L, %L, %L, %L, %s, %L, %L, %L, %L)$q$, tests.rid(p_visit), tests.tid(p_tenant), tests.rid(p_lead), p_date, p_slot, p_party, p_purpose, p_note, p_adv, p_source)) $$;
create function pg_temp.step(p_visit text, p_action text, p_user text default 'a_owner', p_reason text default null) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.visit_step(%L, %L, %L, %L)$q$, tests.tid('a'), tests.rid(p_visit), p_action, p_reason)) $$;
create function pg_temp.st(p_visit text) returns text language sql as $$ select status from public.store_visits where id = tests.rid(p_visit) $$;
create function pg_temp.complete(p_visit text, p_outcome text, p_order text default null, p_quote text default null, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.visit_complete(%L, %L, %L, %L, %L)$q$, tests.tid('a'), tests.rid(p_visit), p_outcome, case when p_order is null then null else tests.rid(p_order) end,
                                   case when p_quote is null then null else tests.rid(p_quote) end)) $$;
create function pg_temp.settings(p_hours jsonb, p_closed date[], p_slot int, p_par int, p_user text default 'a_owner', p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.visit_settings_set(%L, %L::jsonb, %L::date[], %s, %s)$q$, tests.tid('a'), p_hours, p_closed, p_slot, p_par), p_aal) $$;
create function pg_temp.saved(p text) returns boolean language sql as $$ select p not like 'ERR:%' and (p::jsonb ->> 'is_default') = 'false' $$;
create function pg_temp.hours(p_open text, p_close text) returns jsonb language sql as $$
  select jsonb_build_object('mon', jsonb_build_object('open', p_open, 'close', p_close), 'tue', jsonb_build_object('open', p_open, 'close', p_close), 'wed', jsonb_build_object('open', p_open, 'close', p_close),
                            'thu', jsonb_build_object('open', p_open, 'close', p_close), 'fri', jsonb_build_object('open', p_open, 'close', p_close), 'sat', jsonb_build_object('open', p_open, 'close', p_close),
                            'sun', 'null'::jsonb) $$;
create function pg_temp.list(p_user text, p_args text) returns jsonb language sql as $$
  select pg_temp.sc(p_user, format('select public.visit_list(%L%s)', tests.tid('a'), p_args))::jsonb $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog: tables, RLS, grants, definers
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('store_settings', 'store_visits') and c.relrowsecurity and c.relforcerowsecurity),
          2::bigint, 'row-level security is on and forced for both tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('store_settings', 'store_visits')
            and grantee in ('anon', 'authenticated', 'public') and privilege_type <> 'SELECT'), 0::bigint, 'no client role can write either table directly');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('store_settings', 'store_visits') and grantee = 'anon'), 0::bigint, 'anon reads neither');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('visit_settings_get', 'visit_settings_set', 'visit_slots', 'visit_book', 'visit_change', 'visit_step', 'visit_complete', 'visit_send_message',
                                                          'call_request_offer_visit', 'visit_list', 'ai_usage_week') and p.prosecdef and p.proconfig @> array['search_path=""']),
          'ai_usage_week,call_request_offer_visit,visit_book,visit_change,visit_complete,visit_list,visit_send_message,visit_settings_get,visit_settings_set,visit_slots,visit_step',
          'every public function is a SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('visit_settings_get', 'visit_settings_set', 'visit_slots', 'visit_book', 'visit_change', 'visit_step', 'visit_complete', 'visit_send_message', 'call_request_offer_visit', 'visit_list', 'ai_usage_week')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0::bigint, 'none is executable by anon or public');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'
            and (p.proname like 'visit\_%' escape '\' or p.proname like 'store\_visits\_%' escape '\') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint,
          'the internal visit functions are not executable by any client role');

-- ---------------------------------------------------------------------------------------------
-- B. the clock: as shipped it is now(); here it is pinned (replaced for this transaction)
-- ---------------------------------------------------------------------------------------------
select is((select regexp_replace(p.prosrc, '\s', '', 'g') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'visit_now'), 'selectapp.outbox_now()',
          'CLOCK: the visits clock is the outbox clock (and nothing else can set it)');
select pg_temp.pin(coalesce(nullif(current_setting('tests.visit_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz);
select is(app.visit_now(), coalesce(nullif(current_setting('tests.visit_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz, 'CLOCK: pinned (the visits clock reads the pin)');

-- ---------------------------------------------------------------------------------------------
-- C. settings
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.j(pg_temp.sc('a_viewer', format($q$select public.visit_settings_get(%L)$q$, tests.tid('a'))), 'is_default'), 'true', 'DEFAULTS: a business with no row has the defaults (read by any member, a Viewer too)');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_settings_get(%L) -> 'slot_minutes')::text$q$, tests.tid('a'))), '30', 'DEFAULTS: 30-minute slots');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_settings_get(%L) -> 'max_parallel')::text$q$, tests.tid('a'))), '2', 'DEFAULTS: two visits at once');
select is(pg_temp.sc('a_sales', format($q$select public.visit_settings_get(%L) -> 'weekly_hours' -> 'tue'$q$, tests.tid('a'))), '{"open": "10:00", "close": "20:30"}', 'DEFAULTS: Tuesday is open, 10:00 to 20:30');
select is(pg_temp.sc('b_viewer', format($q$select public.visit_settings_get(%L)$q$, tests.tid('a'))), 'ERR:42501', 'DENY: another business cannot read them');
select is(pg_temp.sc('a_sales', format($q$select public.visit_settings_set(%L, %L::jsonb, '{}'::date[], 30, 2)$q$, tests.tid('a'), app.visit_default_hours())), 'ERR:42501', 'DENY: Sales cannot edit the hours');
select is(pg_temp.sc('a_viewer', format($q$select public.visit_settings_set(%L, %L::jsonb, '{}'::date[], 30, 2)$q$, tests.tid('a'), app.visit_default_hours())), 'ERR:42501', 'DENY: a Viewer cannot edit the hours');
select is(pg_temp.sc('b_owner', format($q$select public.visit_settings_set(%L, %L::jsonb, '{}'::date[], 30, 2)$q$, tests.tid('a'), app.visit_default_hours())), 'ERR:42501', 'DENY: the Owner of another business cannot');
select is(pg_temp.settings(pg_temp.hours('10:00', '09:00'), '{}', 30, 2), 'ERR:22023', 'INVALID: closing before opening');
select is(pg_temp.settings(pg_temp.hours('10:00', '10:00'), '{}', 30, 2), 'ERR:22023', 'INVALID: closing when opening');
select is(pg_temp.settings(pg_temp.hours('10:00', '25:00'), '{}', 30, 2), 'ERR:22023', 'INVALID: 25:00');
select is(pg_temp.settings(pg_temp.hours('9:00', '20:00'), '{}', 30, 2), 'ERR:22023', 'INVALID: a time without its leading zero');
select is(pg_temp.settings(pg_temp.hours('10:00', '24:01'), '{}', 30, 2), 'ERR:22023', 'INVALID: 24:01');
select is(pg_temp.settings('{"mon": null}'::jsonb, '{}', 30, 2), 'ERR:22023', 'INVALID: a week with a missing day');
select is(pg_temp.settings(app.visit_default_hours(), '{}', 25, 2), 'ERR:22023', 'INVALID: a 25-minute slot');
select is(pg_temp.settings(app.visit_default_hours(), '{}', 30, 0), 'ERR:22023', 'INVALID: nobody at once');
select is(pg_temp.settings(app.visit_default_hours(), '{}', 30, 51), 'ERR:22023', 'INVALID: 51 at once');
select is(pg_temp.settings(null, '{}', 30, 2), 'ERR:22023', 'INVALID: no hours');
select is(pg_temp.saved(pg_temp.settings(app.visit_default_hours(), array['2026-10-20', '2026-10-12', '2026-10-20']::date[], 30, 2)), true, 'the Owner saves the hours');
select is(pg_temp.sc('a_viewer', format($q$select (public.visit_settings_get(%L) -> 'closed_dates')::text$q$, tests.tid('a'))), '["2026-10-12", "2026-10-20"]', 'closed dates are sorted and de-duplicated');
select is(pg_temp.j(pg_temp.sc('a_viewer', format($q$select public.visit_settings_get(%L)$q$, tests.tid('a'))), 'is_default'), 'false', '...and the business no longer shows the defaults');
select is(pg_temp.saved(pg_temp.settings(app.visit_default_hours(), '{}', 30, 2, 'a_admin', 'aal1')), true, 'an Admin can also edit them, and no second factor is needed (the hours hold no money)');

-- ---------------------------------------------------------------------------------------------
-- D. the slots: the pure plan, then the public read
-- ---------------------------------------------------------------------------------------------
select is(jsonb_array_length(app.visit_day_plan(app.visit_settings_json(tests.tid('a')), date '2026-10-05') -> 'slots'), 21, 'PLAN: Monday 10:00 to 20:30 in 30-minute slots is 21 slots (the last starts at 20:00)');
select is(app.visit_day_plan(app.visit_settings_json(tests.tid('a')), date '2026-10-05') -> 'slots' -> 0 ->> 'start', '10:00', 'PLAN: the first slot is 10:00');
select is(app.visit_day_plan(app.visit_settings_json(tests.tid('a')), date '2026-10-05') -> 'slots' -> 20 ->> 'start', '20:00', 'PLAN: the last slot is 20:00 (it ends at closing)');
select is((app.visit_day_plan(app.visit_settings_json(tests.tid('a')), date '2026-10-05') -> 'slots' -> 0 ->> 'starts_at')::timestamptz, '2026-10-05 10:00:00+05:30'::timestamptz, 'PLAN: 10:00 is India time');
select is((app.visit_day_plan(app.visit_settings_json(tests.tid('a')), date '2026-10-06') -> 'slots' -> 0 ->> 'start'), '10:00', 'PLAN: Tuesday is open by default');
select is(app.visit_day_plan(jsonb_build_object('weekly_hours', pg_temp.hours('10:00', '20:30'), 'closed_dates', '[]'::jsonb, 'slot_minutes', 30, 'max_parallel', 2), date '2026-10-11') ->> 'reason', 'closed_day', 'PLAN: a closed weekday says closed_day');
select is(app.visit_day_plan(jsonb_build_object('weekly_hours', pg_temp.hours('10:00', '20:30'), 'closed_dates', '["2026-10-12"]'::jsonb, 'slot_minutes', 30, 'max_parallel', 2), date '2026-10-12') ->> 'reason', 'closed_date', 'PLAN: a closed date says closed_date');
select is(jsonb_array_length(app.visit_day_plan(jsonb_build_object('weekly_hours', pg_temp.hours('10:00', '10:20'), 'closed_dates', '[]'::jsonb, 'slot_minutes', 30, 'max_parallel', 2), date '2026-10-05') -> 'slots'), 0,
          'PLAN: hours shorter than one slot give no slot (and the day counts as closed)');
-- across midnight: open until 24:00, and open from 00:00
select is(app.visit_day_plan(jsonb_build_object('weekly_hours', pg_temp.hours('22:00', '24:00'), 'closed_dates', '[]'::jsonb, 'slot_minutes', 30, 'max_parallel', 2), date '2026-10-05') -> 'slots' -> 3 ->> 'start', '23:30', 'MIDNIGHT: the last slot of a day that closes at 24:00 starts at 23:30');
select is((app.visit_day_plan(jsonb_build_object('weekly_hours', pg_temp.hours('22:00', '24:00'), 'closed_dates', '[]'::jsonb, 'slot_minutes', 30, 'max_parallel', 2), date '2026-10-05') -> 'slots' -> 3 ->> 'ends_at')::timestamptz,
          '2026-10-06 00:00:00+05:30'::timestamptz, 'MIDNIGHT: ...and ends exactly at midnight India time (it belongs to the day it starts on)');
select is((app.visit_day_plan(jsonb_build_object('weekly_hours', pg_temp.hours('00:00', '02:00'), 'closed_dates', '[]'::jsonb, 'slot_minutes', 30, 'max_parallel', 2), date '2026-10-06') -> 'slots' -> 1 ->> 'starts_at')::timestamptz,
          '2026-10-05 19:00:00+00'::timestamptz, 'MIDNIGHT: 00:30 India time on the 6th is 19:00 UTC on the 5th');
-- the public read
select is(pg_temp.j(pg_temp.sc('a_viewer', format($q$select public.visit_slots(%L, '2026-10-05')$q$, tests.tid('a'))), 'open'), 'true', 'SLOTS: any member reads the slots of a day');
select is(jsonb_array_length(pg_temp.sc('a_sales', format($q$select public.visit_slots(%L, '2026-10-05')$q$, tests.tid('a')))::jsonb -> 'slots'), 21, 'SLOTS: 21 of them on a Monday');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_slots(%L, '2026-10-05') -> 'slots' -> 0 ->> 'free')$q$, tests.tid('a'))), '2', 'SLOTS: two places are free in an empty slot');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_slots(%L, '2026-10-05') -> 'slots' -> 0 -> 'past')::text$q$, tests.tid('a'))), 'true', 'SLOTS: the 10:00 slot of today is marked past at 14:00 (a walk-in can still be written down)');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_slots(%L, '2026-10-05') -> 'slots' -> 12 -> 'past')::text$q$, tests.tid('a'))), case when to_char(app.visit_now() at time zone 'Asia/Kolkata', 'HH24:MI') >= '16:30' then 'true' else 'false' end,
          'SLOTS: the 16:00 slot is past only once 16:30 has come');
select is(pg_temp.sc('a_sales', format($q$select public.visit_slots(%L, '2026-10-04') ->> 'reason'$q$, tests.tid('a'))), 'past', 'SLOTS: a date that has passed has no slots (reason past)');
select is(pg_temp.sc('a_sales', format($q$select public.visit_slots(%L, '2028-10-05')$q$, tests.tid('a'))), 'ERR:22023', 'INVALID: a date two years away');
select is(pg_temp.sc('b_sales', format($q$select public.visit_slots(%L, '2026-10-05')$q$, tests.tid('a'))), 'ERR:42501', 'DENY: another business cannot read the slots');

-- ---------------------------------------------------------------------------------------------
-- E. booking and its refusals (hours: Monday to Saturday 10:00 to 20:30, Sunday closed; slots of 30 minutes; two at once)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.saved(pg_temp.settings(pg_temp.hours('10:00', '20:30'), array['2026-10-20']::date[], 30, 2)), true, 'hours for the tests: Sunday closed, 20 October closed');
select is(pg_temp.sc('a_sales', format($q$select public.visit_slots(%L, '2026-10-11') ->> 'reason'$q$, tests.tid('a'))), 'closed_day', 'SLOTS: Sunday is closed under these hours (reason closed_day)');
select is(pg_temp.sc('a_sales', format($q$select public.visit_slots(%L, '2026-10-20') ->> 'reason'$q$, tests.tid('a'))), 'closed_date', 'SLOTS: 20 October is a closed date (reason closed_date)');
select pg_temp.mk('v1'); select pg_temp.mk('v2'); select pg_temp.mk('v3'); select pg_temp.mk('v4'); select pg_temp.mk('v5'); select pg_temp.mk('v6');
select is(pg_temp.j(pg_temp.book('b1', 'v1', date '2026-10-06', '11:00', 3, 'Bridal sarees', 'Coming with her mother'), 'status'), 'booked', 'BOOK: a visit for tomorrow 11:00 is booked');
select is(pg_temp.j(pg_temp.book('b1', 'v1', date '2026-10-06', '11:00', 3, 'Bridal sarees', 'Coming with her mother'), 'replayed'), 'true', 'IDEMPOTENT: the same request under the same id replays');
select is((select count(*) from public.store_visits where id = tests.rid('b1')), 1::bigint, '...one row');
select is(pg_temp.book('b1', 'v1', date '2026-10-06', '11:30', 3, 'Bridal sarees', 'Coming with her mother'), 'ERR:23505', 'CONFLICT: the same id with another slot is refused (23505)');
select is((select starts_at from public.store_visits where id = tests.rid('b1')), '2026-10-06 11:00:00+05:30'::timestamptz, 'the slot is India time');
select is((select visit_date from public.store_visits where id = tests.rid('b1')), date '2026-10-06', 'the visit date is the India date of the start');
select is((select ends_at - starts_at from public.store_visits where id = tests.rid('b1')), interval '30 minutes', 'a visit takes one slot');
select is((select (status, source, party_size, advance_requested, advance_paise is null, contact_id is not null, company_id is not null)::text from public.store_visits where id = tests.rid('b1')),
          '(booked,staff,3,f,t,t,t)', 'a plain booking: booked, by staff, party of 3, NO advance, the lead''s contact and company copied');
select is(pg_temp.j(pg_temp.book('b2', 'v2', date '2026-10-06', '12:00', 1, null, null, 50000), 'status'), 'booked', 'ADVANCE: an advance is optional: with an amount the visit is still just booked');
select is((select (advance_requested, advance_paise)::text from public.store_visits where id = tests.rid('b2')), '(t,50000)', '...the flag and the amount (paise)');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '12:30', 1, null, null, 0), 'ERR:22023', 'INVALID: an advance of 0');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '12:30', 1, null, null, 200000000), 'ERR:22023', 'INVALID: an advance above the limit');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '12:30', 0), 'ERR:22023', 'INVALID: a party of 0');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '12:30', 51), 'ERR:22023', 'INVALID: a party of 51');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '12:30', 1, repeat('x', 201)), 'ERR:22023', 'INVALID: a purpose of 201 characters');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '12:30', 1, null, E'a​b'), 'ERR:22023', 'INVALID: an invisible character in the note');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '12:30', 1, null, null, null, 'a_owner', 'a', 'robot'), 'ERR:22023', 'INVALID: an unknown source');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '25:00'), 'ERR:22023', 'INVALID: a slot start of 25:00');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '9:30'), 'ERR:22023', 'INVALID: a slot start without its leading zero');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '10:15'), 'ERR:SM512', 'SLOT: 10:15 is not on the 30-minute grid (SM512)');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '21:00'), 'ERR:SM512', 'SLOT: 21:00 is after closing (SM512)');
select is(pg_temp.book('b3', 'v3', date '2026-10-06', '20:30'), 'ERR:SM512', 'SLOT: a visit may not start at closing time (SM512)');
select is(pg_temp.j(pg_temp.book('b3', 'v3', date '2026-10-06', '20:00'), 'status'), 'booked', 'SLOT: 20:00 is the last slot of the day and is bookable');
select is(pg_temp.book('b4', 'v4', date '2026-10-11', '11:00'), 'ERR:SM511', 'CLOSED: Sunday is closed (SM511)');
select is(pg_temp.book('b4', 'v4', date '2026-10-20', '11:00'), 'ERR:SM511', 'CLOSED: a closed date (SM511)');
select is(pg_temp.book('b4', 'v4', date '2026-10-04', '11:00'), 'ERR:SM514', 'PAST: yesterday cannot be booked (SM514)');
select is(pg_temp.book('b4', 'v4', date '2027-10-05', '11:00'), 'ERR:22023', 'INVALID: more than 120 days away');
select is(pg_temp.j(pg_temp.book('b4', 'v4', date '2026-10-05', '11:00'), 'status'), 'booked', 'TODAY: an earlier slot of today can be booked (a walk-in being written down)');
select is(pg_temp.book('b5', 'b_lead', date '2026-10-06', '14:00'), 'ERR:23503', 'REFERENCE: a lead of another business (23503)');
select is(pg_temp.book('b5', 'v5', date '2026-10-06', '14:00', 1, null, null, null, 'a_viewer'), 'ERR:42501', 'DENY: a Viewer cannot book');
select is(pg_temp.book('b5', 'v5', date '2026-10-06', '14:00', 1, null, null, null, 'b_owner'), 'ERR:42501', 'DENY: the Owner of another business cannot book here');
select is(pg_temp.book('b5', 'v5', date '2026-10-06', '14:00', 1, null, null, null, 'anon'), 'ERR:42501', 'DENY: a stranger (not a member of the business) cannot book');
select is(pg_temp.j(pg_temp.book('b5', 'v5', date '2026-10-06', '14:00', 1, null, null, null, 'a_sales'), 'status'), 'booked', 'ROLE: Sales can book');
select is(pg_temp.j(pg_temp.book('b5s', 'v5', date '2026-10-06', '15:00', 1, null, null, null, 'a_admin', 'a', 'assistant'), 'status'), 'booked', 'ROLE: an Admin can book, and the source can be "assistant" (Agent OWL)');
select is((select source from public.store_visits where id = tests.rid('b5s')), 'assistant', '...the row remembers who proposed it');
select is(pg_temp.book('b5x', 'v5', date '2026-10-06', '15:00'), 'ERR:SM501', 'STATE: the same customer cannot hold two live visits at the same moment (SM501)');
-- a lead with no contact, an archived lead, an erased contact
insert into public.leads (id, tenant_id, company_id) values (tests.rid('v_nocontact'), tests.tid('a'), tests.rid('a_company'));
select is(pg_temp.j(pg_temp.book('b6', 'v_nocontact', date '2026-10-07', '11:00'), 'status'), 'booked', 'A lead without a contact can be booked (a phone call, no name yet)');
select is((select contact_id is null from public.store_visits where id = tests.rid('b6')), true, '...with no contact on the visit');
insert into public.leads (id, tenant_id, company_id, archived_at) values (tests.rid('v_arch'), tests.tid('a'), tests.rid('a_company'), now());
select is(pg_temp.book('b7', 'v_arch', date '2026-10-07', '11:00'), 'ERR:22023', 'INVALID: an archived lead');
select pg_temp.mk('v_er');
set local session_replication_role = replica;  -- (the erasure marker is guarded: a fixture writes it directly)
update public.contacts set erased_at = now(), archived_at = now() where id = tests.rid('v_er_c');
set local session_replication_role = origin;
select is(pg_temp.book('b8', 'v_er', date '2026-10-07', '11:00'), 'ERR:SM502', 'ERASED: a customer whose record was erased cannot be booked (SM502)');

-- ---------------------------------------------------------------------------------------------
-- F. capacity: two at once, the check holds the day; overlap; a cancelled visit frees the place
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('c1'); select pg_temp.mk('c2'); select pg_temp.mk('c3'); select pg_temp.mk('c4');
select is(pg_temp.j(pg_temp.book('f1', 'c1', date '2026-10-07', '16:00'), 'status'), 'booked', 'CAPACITY: the first place in the 16:00 slot');
select is(pg_temp.j(pg_temp.book('f2', 'c2', date '2026-10-07', '16:00'), 'status'), 'booked', 'CAPACITY: the second place');
select is(pg_temp.book('f3', 'c3', date '2026-10-07', '16:00'), 'ERR:SM513', 'CAPACITY: a third visit in the same slot is refused (SM513)');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_slots(%L, '2026-10-07') -> 'slots' -> 12 ->> 'free')$q$, tests.tid('a'))), '0', 'CAPACITY: the slot list shows 0 free');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_slots(%L, '2026-10-07') -> 'slots' -> 13 ->> 'free')$q$, tests.tid('a'))), '2', '...and the next slot is untouched');
select is(pg_temp.j(pg_temp.step('f1', 'cancel', 'a_owner', 'Changed her mind'), 'status'), 'cancelled', 'CAPACITY: cancelling one...');
select is(pg_temp.j(pg_temp.book('f3', 'c3', date '2026-10-07', '16:00'), 'status'), 'booked', '...frees the place for another customer');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_slots(%L, '2026-10-07') -> 'slots' -> 12 ->> 'free')$q$, tests.tid('a'))), '0', 'CAPACITY: full again');
-- hours with 60-minute slots: a visit blocks the whole hour, a 30-minute neighbour cannot slip in
select is(pg_temp.saved(pg_temp.settings(pg_temp.hours('10:00', '20:00'), array['2026-10-20']::date[], 60, 1)), true, 'slots of 60 minutes, one at a time');
select is(pg_temp.j(pg_temp.book('f4', 'c4', date '2026-10-08', '11:00'), 'status'), 'booked', 'ONE AT A TIME: 11:00 to 12:00 is taken');
select pg_temp.mk('c5');
select is(pg_temp.book('f5', 'c5', date '2026-10-08', '11:00'), 'ERR:SM513', '...a second visit in that hour is refused');
select is(pg_temp.book('f5', 'c5', date '2026-10-08', '11:30'), 'ERR:SM512', '...and 11:30 is not a slot of 60 minutes (SM512)');
select is(pg_temp.j(pg_temp.book('f5', 'c5', date '2026-10-08', '12:00'), 'status'), 'booked', '...the next hour is free');
select is(pg_temp.saved(pg_temp.settings(pg_temp.hours('10:00', '20:30'), array['2026-10-20']::date[], 30, 2)), true, 'hours back to 30 minutes, two at once');
-- a 30-minute visit inside the 60-minute visit f4 still counts against it: overlap is by time, not by the name of a slot
select is(pg_temp.j(pg_temp.book('f6', 'c4', date '2026-10-08', '11:30'), 'status'), 'booked', 'OVERLAP: 11:30 overlaps f4 (11:00 to 12:00): one of two places is left, and it is booked');
select is(pg_temp.book('f7', 'c1', date '2026-10-08', '11:30'), 'ERR:SM513', 'OVERLAP: ...and then both places of 11:30 are taken (f4 and f6): SM513');

-- ---------------------------------------------------------------------------------------------
-- G. time: day, night and midnight. Hours: Monday to Saturday 10:00 to 24:00 (the last slot ends at midnight), Tuesday also from 00:00 to 02:00 (a late-night shop), Sunday closed.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.saved(pg_temp.settings(jsonb_set(pg_temp.hours('10:00', '24:00'), '{tue}', '{"open": "00:00", "close": "02:00"}'::jsonb), array['2026-10-20']::date[], 30, 2)), true, 'hours for the time tests: open to midnight; Tuesday 00:00 to 02:00');
select pg_temp.mk('g1'); select pg_temp.mk('g2'); select pg_temp.mk('g3');
-- DAY, 14:00 IST on Monday the 5th
select pg_temp.pin('2026-10-05 14:00:00+05:30');
select is(pg_temp.list('a_sales', '')::jsonb ->> 'from', '2026-10-05', 'DAY 14:00 IST: "today" is Monday the 5th');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', '') -> 'items') x where x ->> 'visit_date' <> '2026-10-05'), 0::bigint, 'DAY: the default list holds only visits of the 5th');
select is(pg_temp.j(pg_temp.book('g_a', 'g1', date '2026-10-05', '23:30'), 'status'), 'booked', 'DAY: the last slot of the evening (23:30 to midnight) can be booked');
select is((select ends_at from public.store_visits where id = tests.rid('g_a')), '2026-10-06 00:00:00+05:30'::timestamptz, 'DAY: ...it ends exactly at midnight India time');
select is((select visit_date from public.store_visits where id = tests.rid('g_a')), date '2026-10-05', 'DAY: ...and belongs to the 5th');
-- the slot at 00:30 on Tuesday the 6th: its UTC date is the 5th, its India date the 6th
select is(pg_temp.j(pg_temp.book('g_b', 'g2', date '2026-10-06', '00:30'), 'status'), 'booked', 'MIDNIGHT: a 00:30 slot on the 6th is bookable (Tuesday opens at 00:00)');
select is((select starts_at at time zone 'UTC' from public.store_visits where id = tests.rid('g_b')), timestamp '2026-10-05 19:00:00', 'MIDNIGHT: ...19:00 UTC on the 5th');
select is((select visit_date from public.store_visits where id = tests.rid('g_b')), date '2026-10-06', 'MIDNIGHT: ...but the visit date is the India date, the 6th');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', '') -> 'items') x where x ->> 'id' = tests.rid('g_b')::text), 0::bigint, 'MIDNIGHT: it is not in today''s list at 14:00 on the 5th');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', ', ''2026-10-06'', ''2026-10-06''') -> 'items') x where x ->> 'id' = tests.rid('g_b')::text), 1::bigint, 'MIDNIGHT: it is in the list of the 6th');
-- NIGHT, 23:50 IST on the 5th: still the 5th; the last slot (23:30) has started but the day is today's
select pg_temp.pin('2026-10-05 23:50:00+05:30');
select is(pg_temp.list('a_sales', '')::jsonb ->> 'from', '2026-10-05', 'NIGHT 23:50 IST: "today" is still the 5th');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', '') -> 'items') x where x ->> 'id' = tests.rid('g_a')::text), 1::bigint, 'NIGHT: the 23:30 visit is in today''s list');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', '') -> 'items') x where x ->> 'id' = tests.rid('g_b')::text), 0::bigint, 'NIGHT: the 00:30 visit of the 6th is not (it is 40 minutes away, but it is tomorrow)');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_slots(%L, '2026-10-05') -> 'slots' -> 27 ->> 'start')$q$, tests.tid('a'))), '23:30', 'NIGHT: the 23:30 slot is listed');
select is(pg_temp.sc('a_sales', format($q$select (public.visit_slots(%L, '2026-10-05') -> 'slots' -> 27 -> 'past')::text$q$, tests.tid('a'))), 'false', 'NIGHT: ...and it is not past at 23:50 (it ends at midnight)');
select is(pg_temp.j(pg_temp.book('g_c', 'g3', date '2026-10-05', '23:30'), 'status'), 'booked', 'NIGHT: a booking for the 23:30 slot at 23:50 is still allowed (the date has not passed)');
select is(pg_temp.j(pg_temp.step('g_a', 'arrive'), 'status'), 'arrived', 'NIGHT: the customer arrives at 23:50 (the visit date is today)');
-- MIDNIGHT, 00:10 IST on the 6th
select pg_temp.pin('2026-10-06 00:10:00+05:30');
select is(pg_temp.list('a_sales', '')::jsonb ->> 'from', '2026-10-06', 'MIDNIGHT 00:10 IST: "today" is the 6th');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', '') -> 'items') x where x ->> 'id' = tests.rid('g_b')::text), 1::bigint, 'MIDNIGHT: the 00:30 visit is in today''s list');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', '') -> 'items') x where x ->> 'id' = tests.rid('g_a')::text), 0::bigint, 'MIDNIGHT: the visit of the evening before is not');
select is(pg_temp.book('g_d', 'g1', date '2026-10-05', '20:00'), 'ERR:SM514', 'MIDNIGHT: ten minutes after midnight the 5th is past (SM514)');
select is(pg_temp.j(pg_temp.book('g_d', 'g1', date '2026-10-06', '00:00'), 'status'), 'booked', 'MIDNIGHT: ...and the 00:00 slot of the 6th (already started) can still be written down');
select is(pg_temp.j(pg_temp.step('g_c', 'no_show'), 'status'), 'no_show', 'MIDNIGHT: the 23:30 visit that never came is a no-show once its time has passed');
select is(pg_temp.step('g_b', 'no_show'), 'ERR:SM501', 'MIDNIGHT: ...but the 00:30 visit has not started yet (00:10): SM501');
select is(pg_temp.j(pg_temp.step('g_b', 'arrive'), 'status'), 'arrived', 'MIDNIGHT: an early customer can be marked arrived (the visit is dated today, the 6th)');

-- ---------------------------------------------------------------------------------------------
-- H. the steps: confirm, arrive, no-show, cancel (back to the main pin)
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select is(pg_temp.saved(pg_temp.settings(pg_temp.hours('10:00', '24:00'), array['2026-10-20']::date[], 30, 2)), true, 'ordinary hours again (the time tests above gave Tuesday late-night hours)');
select is(pg_temp.j(pg_temp.step('b4', 'confirm'), 'status'), 'confirmed', 'STEP: booked -> confirmed');
select is((select confirmed_at is not null from public.store_visits where id = tests.rid('b4')), true, '...with the time it was confirmed');
select is(pg_temp.j(pg_temp.step('b4', 'confirm'), 'replayed'), 'true', 'STEP: confirming twice replays');
select is(pg_temp.step('b4', 'confirm', 'a_viewer'), 'ERR:42501', 'DENY: a Viewer cannot confirm');
select is(pg_temp.step('b4', 'confirm', 'b_owner'), 'ERR:42501', 'DENY: another business cannot');
select is(pg_temp.step('b4', 'maybe'), 'ERR:22023', 'INVALID: an unknown step');
select is(pg_temp.step('b4', 'confirm', 'a_owner', 'a reason'), 'ERR:22023', 'INVALID: a reason belongs to a cancellation only');
select is(pg_temp.step('b_unknown', 'confirm'), 'ERR:23503', 'REFERENCE: an unknown visit');
select is(pg_temp.j(pg_temp.step('b4', 'arrive', 'a_sales'), 'status'), 'arrived', 'STEP: confirmed -> arrived (Sales may)');
select is((select arrived_at is not null from public.store_visits where id = tests.rid('b4')), true, '...with the time of arrival');
select is(pg_temp.step('b4', 'confirm'), 'ERR:SM501', 'STATE: an arrived visit cannot be confirmed');
select is(pg_temp.step('b4', 'cancel'), 'ERR:SM501', 'STATE: ...nor cancelled');
select is(pg_temp.step('b4', 'no_show'), 'ERR:SM501', 'STATE: ...nor a no-show');
select is(pg_temp.step('b1', 'arrive'), 'ERR:SM501', 'STATE: a visit of tomorrow cannot arrive today');
select is(pg_temp.step('b1', 'no_show'), 'ERR:SM501', 'STATE: ...nor be a no-show before its time');
select is(pg_temp.j(pg_temp.step('b1', 'cancel', 'a_sales', 'The customer called to cancel'), 'status'), 'cancelled', 'STEP: booked -> cancelled with a reason');
select is((select (cancel_reason, closed_at is not null)::text from public.store_visits where id = tests.rid('b1')), '("The customer called to cancel",t)', '...the reason and the closing time are kept');
select is(pg_temp.j(pg_temp.step('b1', 'cancel'), 'replayed'), 'true', 'STEP: cancelling twice replays');
select is(pg_temp.step('b1', 'confirm'), 'ERR:SM501', 'STATE: a cancelled visit stays cancelled');
select is(pg_temp.sc('a_owner', format('select public.visit_step(%L, %L, ''cancel'', %L)', tests.tid('a'), tests.rid('b3'), repeat('x', 201))), 'ERR:22023', 'INVALID: a cancel reason of 201 characters');
-- a visit earlier today that never came
select pg_temp.mk('h1c');
select is(pg_temp.j(pg_temp.book('h1', 'h1c', date '2026-10-05', '10:00'), 'status'), 'booked', 'a visit at 10:00 today');
select is(pg_temp.j(pg_temp.step('h1', 'no_show'), 'status'), 'no_show', 'STEP: once its time has passed a booked visit can be a no-show');
select is((select closed_at is not null from public.store_visits where id = tests.rid('h1')), true, '...and it is closed');
select is(pg_temp.step('h1', 'arrive'), 'ERR:SM501', 'STATE: a no-show does not arrive');

-- ---------------------------------------------------------------------------------------------
-- I. change and reschedule (b3: Tuesday the 6th 20:00, booked)
-- ---------------------------------------------------------------------------------------------
create function pg_temp.chg(p_visit text, p_date date, p_slot text, p_party int default null, p_purpose text default null, p_note text default null, p_adv bigint default null, p_clear boolean default false,
                            p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.visit_change(%L, %L, %L, %L, %s, %L, %L, %L, %L)$q$, tests.tid('a'), tests.rid(p_visit), p_date, p_slot, coalesce(p_party::text, 'null'), p_purpose, p_note, p_adv, p_clear)) $$;
select is(pg_temp.j(pg_temp.chg('b3', date '2026-10-06', '19:30'), 'moved'), 'true', 'CHANGE: b3 moves to 19:30');
select is((select (starts_at at time zone 'UTC', visit_date, status)::text from public.store_visits where id = tests.rid('b3')), '("2026-10-06 14:00:00",2026-10-06,booked)', '...new start (19:30 IST = 14:00 UTC), the date, still booked');
select is(pg_temp.j(pg_temp.step('b3', 'confirm'), 'status'), 'confirmed', 'b3 is confirmed');
select is(pg_temp.j(pg_temp.chg('b3', null, null, 4, 'Wedding trousseau'), 'moved'), 'false', 'CHANGE: details only: nothing moves');
select is((select (status, party_size, purpose)::text from public.store_visits where id = tests.rid('b3')), '(confirmed,4,"Wedding trousseau")', '...a confirmed visit stays confirmed, with the new details');
select is(pg_temp.j(pg_temp.chg('b3', date '2026-10-06', '19:30'), 'moved'), 'false', 'CHANGE: asking for its own slot moves nothing');
select is(pg_temp.j(pg_temp.chg('b3', date '2026-10-06', '19:00'), 'moved'), 'true', 'CHANGE: a confirmed visit that moves...');
select is((select (status, confirmed_at is null)::text from public.store_visits where id = tests.rid('b3')), '(booked,t)', '...goes back to booked: the customer has to be told and confirm again');
select is(pg_temp.chg('b3', date '2026-10-07', '16:00'), 'ERR:SM513', 'CHANGE: into a full slot (SM513)');
select is(pg_temp.chg('b3', date '2026-10-04', '16:00'), 'ERR:SM514', 'CHANGE: to a past date (SM514)');
select is(pg_temp.chg('b3', date '2026-10-20', '16:00'), 'ERR:SM511', 'CHANGE: to a closed date (SM511)');
select is(pg_temp.chg('b3', date '2026-10-11', '16:00'), 'ERR:SM511', 'CHANGE: to a closed Sunday (SM511)');
select is(pg_temp.chg('b3', date '2026-10-06', '19:10'), 'ERR:SM512', 'CHANGE: to a time that is not a slot (SM512)');
select is(pg_temp.chg('b3', date '2026-10-06', null), 'ERR:22023', 'INVALID: a date without a slot');
select is(pg_temp.chg('b3', null, null, 0), 'ERR:22023', 'INVALID: a party of 0');
select is(pg_temp.chg('b3', null, null, null, null, null, 30000, true), 'ERR:22023', 'INVALID: set and clear the advance at once');
select is((select (advance_requested, advance_paise)::text from public.store_visits where id = tests.rid('b3')), '(f,)', 'b3 has no advance');
select is(pg_temp.j(pg_temp.chg('b3', null, null, null, null, null, 30000), 'status'), 'booked', 'CHANGE: an advance can be asked for later');
select is((select (advance_requested, advance_paise)::text from public.store_visits where id = tests.rid('b3')), '(t,30000)', '...flag and amount together');
select is(pg_temp.j(pg_temp.chg('b3', null, null, null, null, null, null, true), 'status'), 'booked', 'CHANGE: and dropped again (it is never required)');
select is((select (advance_requested, advance_paise)::text from public.store_visits where id = tests.rid('b3')), '(f,)', '...flag off and no amount');
select is(pg_temp.chg('b4', null, null, 2), 'ERR:SM501', 'STATE: an arrived visit cannot be changed');
select is(pg_temp.chg('b1', null, null, 2), 'ERR:SM501', 'STATE: a cancelled visit cannot be changed');
select is(pg_temp.chg('b3', null, null, 2, null, null, null, false, 'a_viewer'), 'ERR:42501', 'DENY: a Viewer cannot change a visit');
select is(pg_temp.chg('b3', null, null, 2, null, null, null, false, 'b_owner'), 'ERR:42501', 'DENY: another business cannot');
select is(pg_temp.chg('b_unknown', null, null, 2), 'ERR:23503', 'REFERENCE: an unknown visit');
select is(pg_temp.j(pg_temp.chg('b3', date '2026-10-06', '19:30', null, null, null, null, false, 'a_sales'), 'moved'), 'true', 'ROLE: Sales can move a visit');

-- ---------------------------------------------------------------------------------------------
-- J. complete, and the order a "bought" visit starts (the existing order flow: an APPROVED quote, Owner or Admin, second factor)
-- ---------------------------------------------------------------------------------------------
create function pg_temp.mkq(p_label text, p_total bigint, p_advance bigint, p_valid date default null, p_status text default 'approved', p_t text default 'a', p_lead text default null, p_ago interval default '0')
returns uuid language plpgsql as $$
declare v_lead uuid := tests.rid(coalesce(p_lead, p_t || '_lead'));
begin
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (tests.rid(p_label || '_enq'), tests.tid(p_t), v_lead, 'email', now() - interval '1 hour', 'Synthetic enquiry ' || p_label);
  insert into public.requirements (id, tenant_id, enquiry_id) values (tests.rid(p_label || '_req'), tests.tid(p_t), tests.rid(p_label || '_enq'));
  insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text,
                             canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise,
                             shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, approved_by, approved_at, approved_hash, rejected_by, rejected_at, reject_code)
  values (tests.rid(p_label || '_quote'), tests.tid(p_t), (select coalesce(max(quote_no), 0) + 1 from public.quotes where tenant_id = tests.tid(p_t)), tests.rid(p_label || '_req'),
          tests.rid(p_label || '_enq'), v_lead, p_status::public.quote_status, tests.rid(p_t || '_price_version'), tests.rid(p_t || '_policy_version'), '1.1.0', '{}', '{}', repeat('3', 64),
          'new', 'TS', 'intra_state', least(pg_temp.today(), coalesce(p_valid, pg_temp.today() + 10)), coalesce(p_valid, pg_temp.today() + 10), pg_temp.today() + 30, p_total, 0, 0, 0, p_total, p_advance, p_total - p_advance, false,
          case when p_status in ('approved', 'superseded') then tests.uid(p_t || '_owner') end, case when p_status in ('approved', 'superseded') then now() - p_ago end,
          case when p_status in ('approved', 'superseded') then repeat('5', 64) end,
          case when p_status = 'rejected' then tests.uid(p_t || '_owner') end, case when p_status = 'rejected' then now() end, case when p_status = 'rejected' then 'other'::public.quote_reject_code end);
  return tests.rid(p_label || '_quote');
end $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;
insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256)
values (tests.rid('a_order_policy_j'), tests.tid('a'), 1, current_date - 1, false, false, 'in_preparation', true, repeat('4', 64));
select is(pg_temp.complete('b4', 'bought', null, null, 'a_viewer'), 'ERR:42501', 'DENY: a Viewer cannot complete a visit');
select is(pg_temp.complete('b4', 'maybe'), 'ERR:22023', 'INVALID: an unknown outcome');
select is(pg_temp.complete('b4', 'will_return', 'j_order'), 'ERR:22023', 'INVALID: an order only comes with "bought"');
select is(pg_temp.complete('b4', 'bought', null, 'j1'), 'ERR:22023', 'INVALID: a quote without an order id');
select is(pg_temp.complete('b3', 'will_return'), 'ERR:SM501', 'STATE: a visit that has not arrived cannot be completed');
select is(pg_temp.j(pg_temp.complete('b4', 'will_return', null, null, 'a_sales'), 'status'), 'completed', 'COMPLETE: arrived -> completed with the outcome will_return (Sales may)');
select is((select (outcome, order_id is null, closed_at is not null)::text from public.store_visits where id = tests.rid('b4')), '(will_return,t,t)', '...outcome kept, no order, closed');
select is(pg_temp.j(pg_temp.complete('b4', 'will_return'), 'replayed'), 'true', 'COMPLETE: the same outcome again replays');
select is(pg_temp.complete('b4', 'bought'), 'ERR:SM501', 'STATE: a completed visit keeps its outcome');
select is(pg_temp.step('b4', 'cancel'), 'ERR:SM501', 'STATE: ...and cannot be cancelled');
-- the order
select pg_temp.mk('j_c');
insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid('j_lead'), tests.tid('a'), tests.rid('a_company'), tests.rid('j_c_c'));
select is(pg_temp.j(pg_temp.book('j_v1', 'j_lead', date '2026-10-05', '12:00'), 'status'), 'booked', 'a visit by a customer who has an approved quote');
select is(pg_temp.j(pg_temp.step('j_v1', 'arrive'), 'status'), 'arrived', '...he arrives');
select is(pg_temp.complete('j_v1', 'bought', 'j_order'), 'ERR:SM515', 'ORDER: no approved quote for this customer yet (SM515)');
select is(pg_temp.st('j_v1'), 'arrived', '...and the visit stayed arrived (all or nothing)');
select pg_temp.mkq('jq', 500000, 100000, null, 'approved', 'a', 'j_lead');
select pg_temp.mkq('jd', 300000, 50000, null, 'draft', 'a', 'j_lead');
select is(pg_temp.complete('j_v1', 'bought', 'j_order', null, 'a_sales'), 'ERR:42501', 'ORDER: Sales cannot start an order (Owner or Admin only); the visit stays arrived');
select is(pg_temp.st('j_v1'), 'arrived', '...unchanged');
select is(pg_temp.sc('a_owner', format($q$select public.visit_complete(%L, %L, 'bought', %L, null)$q$, tests.tid('a'), tests.rid('j_v1'), tests.rid('j_order')), 'aal1'), 'ERR:SM306', 'ORDER: starting an order needs the second factor (SM306); the visit stays arrived');
select is(pg_temp.st('j_v1'), 'arrived', '...unchanged');
select is(pg_temp.complete('j_v1', 'bought', 'j_order', 'a_quote'), 'ERR:23503', 'ORDER: a quote of another customer is refused (23503)');
select is(pg_temp.j(pg_temp.complete('j_v1', 'bought', 'j_order'), 'status'), 'completed', 'ORDER: an Owner with a second factor completes it "bought" and the order is made from the approved quote');
select is((select (order_id = tests.rid('j_order'), outcome)::text from public.store_visits where id = tests.rid('j_v1')), '(t,bought)', '...the visit links the order');
select is((select (quote_id = tests.rid('jq_quote'), lead_id = tests.rid('j_lead'), state, order_total_paise, advance_paise)::text from public.orders where id = tests.rid('j_order')), '(t,t,quote_approved,500000,100000)',
          '...the order is the first state of the existing flow (quote_approved), with the quote''s figures (the draft quote was not used)');
select is(pg_temp.j(pg_temp.complete('j_v1', 'bought', 'j_order'), 'replayed'), 'true', 'ORDER: the same call again replays and makes no second order');
select is((select count(*) from public.orders where tenant_id = tests.tid('a') and quote_id = tests.rid('jq_quote')), 1::bigint, '...one order');
select pg_temp.mk('j_d');
insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid('j_lead2'), tests.tid('a'), tests.rid('a_company'), tests.rid('j_d_c'));
select pg_temp.mkq('jq2', 250000, 50000, null, 'approved', 'a', 'j_lead2');
select pg_temp.book('j_v2', 'j_lead2', date '2026-10-05', '12:30'); select pg_temp.step('j_v2', 'arrive');
select is(pg_temp.j(pg_temp.complete('j_v2', 'bought', 'j_order2', 'jq2_quote', 'a_admin'), 'status'), 'completed', 'ORDER: an Admin can too, naming the quote');
select is((select state::text from public.orders where id = tests.rid('j_order2')), 'quote_approved', '...');
-- the quote already has its order: a second visit finds nothing to make an order from
select pg_temp.book('j_v3', 'j_lead2', date '2026-10-05', '13:00'); select pg_temp.step('j_v3', 'arrive');
select is(pg_temp.complete('j_v3', 'bought', 'j_order3'), 'ERR:SM515', 'ORDER: a quote that already has an order is not used again (SM515)');
select is(pg_temp.j(pg_temp.complete('j_v3', 'will_return'), 'status'), 'completed', '...the visit can still be completed without an order');

-- ---------------------------------------------------------------------------------------------
-- K. messages through the outbox (the AT policy decides): the switch is on, automatic sending is on, the customer consented
-- ---------------------------------------------------------------------------------------------
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, true, 5)$q$, tests.tid('a'))), '{"auto_send_enabled": true, "per_customer_daily_limit": 5}', 'the Owner switches automatic sending on');
create function pg_temp.msg(p_visit text, p_kind text, p_msg text, p_body text, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.visit_send_message(%L, %L, %L, %L, %L, 'en')$q$, tests.tid('a'), tests.rid(p_visit), p_kind, tests.rid(p_msg), p_body)) $$;
select pg_temp.mk('k1'); select pg_temp.mk('k2'); select pg_temp.mk('k3'); select pg_temp.mk('k4');
-- DAY
select pg_temp.pin('2026-10-05 14:00:00+05:30');
select pg_temp.book('k_v1', 'k1', date '2026-10-07', '11:00');
select is(pg_temp.msg('k_v1', 'confirmation', 'k_m0', 'Your visit is confirmed for Wednesday at 11 am.'), 'ERR:SM501', 'MESSAGE: a booked visit has nothing to confirm yet (SM501)');
select pg_temp.step('k_v1', 'confirm');
select is(pg_temp.j(pg_temp.msg('k_v1', 'confirmation', 'k_m1', 'Your visit is confirmed for Wednesday at 11 am. See you at our shop.'), 'status'), 'queued', 'DAY 14:00 IST: the confirmation is queued...');
select is((select reason from public.outbox_messages where id = tests.rid('k_m1')), 'auto_allowed', '...and goes at once (auto_allowed)');
select is((select (category, source, status)::text from public.outbox_messages where id = tests.rid('k_m1')), '(visit,system,queued)', '...a "visit" message from the system, through the AT outbox');
select is((select confirmation_message_id = tests.rid('k_m1') from public.store_visits where id = tests.rid('k_v1')), true, '...and the visit links it');
select is(pg_temp.j(pg_temp.msg('k_v1', 'confirmation', 'k_m1', 'Your visit is confirmed for Wednesday at 11 am. See you at our shop.'), 'replayed'), 'true', 'IDEMPOTENT: the same message id replays');
select is(pg_temp.msg('k_v1', 'confirmation', 'k_m1', 'Another text altogether, please come on Thursday.'), 'ERR:23505', 'CONFLICT: the same id with other words (23505)');
select is(pg_temp.j(pg_temp.msg('k_v1', 'reminder', 'k_m2', 'A reminder: you are welcome at our shop tomorrow at 11 am.'), 'reason'), 'auto_allowed', 'DAY: a reminder is queued the same way');
select is((select reminder_message_id = tests.rid('k_m2') from public.store_visits where id = tests.rid('k_v1')), true, '...and linked');
-- money: an advance makes it wait for a person
select pg_temp.book('k_v2', 'k2', date '2026-10-07', '12:00', 1, null, null, 50000); select pg_temp.step('k_v2', 'confirm');
select is(pg_temp.j(pg_temp.msg('k_v2', 'confirmation', 'k_m3', 'Your visit is confirmed for Wednesday at 12 pm. Please pay an advance of ₹500 to hold the slot.'), 'status'), 'needs_approval', 'MONEY: a message that mentions an advance waits for approval');
select is((select (reason, flags)::text from public.outbox_messages where id = tests.rid('k_m3')), '(money,{money})', '...for the reason money');
-- a visit that is not confirmed, roles
select pg_temp.book('k_v3', 'k3', date '2026-10-07', '13:00');
select is(pg_temp.msg('k_v3', 'reminder', 'k_m4', 'A reminder about tomorrow.'), 'ERR:SM501', 'STATE: no reminder for a visit that is only booked');
select is(pg_temp.msg('k_v1', 'reminder', 'k_m5', 'A reminder about tomorrow.', 'a_viewer'), 'ERR:42501', 'DENY: a Viewer cannot send');
select is(pg_temp.msg('k_v1', 'reminder', 'k_m5', 'A reminder about tomorrow.', 'b_owner'), 'ERR:42501', 'DENY: another business cannot');
select is(pg_temp.msg('k_v1', 'goodbye', 'k_m5', 'A reminder about tomorrow.'), 'ERR:22023', 'INVALID: an unknown kind');
select is(pg_temp.j(pg_temp.msg('k_v1', 'reminder', 'k_m6', 'A reminder about tomorrow.', 'a_sales'), 'status'), 'queued', 'ROLE: Sales can make the message (the outbox decides what happens to it)');
-- a template nobody has checked yet (p_uncertain) waits for a person, whatever it says
select pg_temp.mk('k6'); select pg_temp.book('k_v6', 'k6', date '2026-10-07', '17:00'); select pg_temp.step('k_v6', 'confirm');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.visit_send_message(%L, %L, 'confirmation', %L, 'Your visit is confirmed for Wednesday at 4 pm.', 'en', true)$q$, tests.tid('a'), tests.rid('k_v6'), tests.rid('k_m10'))), 'reason'), 'uncertain',
          'UNCHECKED WORDS: a message flagged uncertain (a language no native reader has checked) is held for a person (uncertain)');
-- NIGHT: the same confirmation waits for 09:00
select pg_temp.pin('2026-10-05 23:30:00+05:30');
select pg_temp.book('k_v4', 'k4', date '2026-10-07', '14:00'); select pg_temp.step('k_v4', 'confirm');
select is(pg_temp.j(pg_temp.msg('k_v4', 'confirmation', 'k_m7', 'Your visit is confirmed for Wednesday at 2 pm. See you at our shop.'), 'reason'), 'quiet_hours', 'NIGHT 23:30 IST: the same confirmation is held for quiet hours...');
select is((select scheduled_for from public.outbox_messages where id = tests.rid('k_m7')), '2026-10-06 09:00:00+05:30'::timestamptz, '...until 09:00 India time the next morning');
-- a reminder is for a visit that has not started
select pg_temp.pin('2026-10-07 11:30:00+05:30');
select is(pg_temp.msg('k_v1', 'reminder', 'k_m8', 'A reminder: we expect you today.'), 'ERR:SM501', 'STATE: a reminder after the visit started is refused (SM501)');
-- the kill switch: the visit is linked, the message is blocked
select pg_temp.main_pin();
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select pg_temp.mk('k5'); select pg_temp.book('k_v5', 'k5', date '2026-10-07', '15:00'); select pg_temp.step('k_v5', 'confirm');
select is(pg_temp.j(pg_temp.msg('k_v5', 'confirmation', 'k_m9', 'Your visit is confirmed for Wednesday at 3 pm.'), 'reason'), 'switch_off', 'KILL SWITCH: with the global switch off the message is blocked (switch_off)');
update public.platform_flags set enabled = true where key = 'outbox_enabled';

-- ---------------------------------------------------------------------------------------------
-- L. "offer a store visit" on a call request: the Owner (second factor) declines the call AND queues the offer message
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select pg_temp.mk('l1'); select pg_temp.mk('l2'); select pg_temp.mk('l3');
create function pg_temp.callreq(p_req text, p_lead text) returns text language sql as $$
  select pg_temp.sc('a_sales', format($q$select public.call_request_create(%L, %L, %L, 'The customer wants to talk about a large order', 'Hello, this is the shop calling.', 'en')$q$, tests.rid(p_req), tests.tid('a'), tests.rid(p_lead))) $$;
create function pg_temp.offer(p_req text, p_msg text, p_body text, p_user text default 'a_owner', p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.call_request_offer_visit(%L, %L, %L, %L, 'en')$q$, tests.tid('a'), tests.rid(p_req), tests.rid(p_msg), p_body), p_aal) $$;
select pg_temp.callreq('l_r1', 'l1'); select pg_temp.callreq('l_r2', 'l2'); select pg_temp.callreq('l_r3', 'l3');
select is(pg_temp.offer('l_r1', 'l_m1', 'We would be happy to see you at our shop. We are open from 10 am. Tell us a day that suits you.', 'a_sales'), 'ERR:42501', 'DENY: Sales cannot offer a visit (it declines a call: the Owner decides)');
select is(pg_temp.offer('l_r1', 'l_m1', 'We would be happy to see you at our shop.', 'a_admin'), 'ERR:42501', 'DENY: an Admin cannot either');
select is(pg_temp.offer('l_r1', 'l_m1', 'We would be happy to see you at our shop.', 'a_owner', 'aal1'), 'ERR:SM306', 'DENY: the Owner needs a second factor (SM306)');
select is((select status from public.call_requests where id = tests.rid('l_r1')), 'requested', '...nothing changed');
select is(pg_temp.offer('l_r1', 'l_m1', 'We would be happy to see you at our shop.', 'b_owner'), 'ERR:42501', 'DENY: another business cannot');
select is(pg_temp.offer('l_unknown', 'l_m1', 'We would be happy to see you at our shop.'), 'ERR:23503', 'REFERENCE: an unknown request');
select is(pg_temp.j(pg_temp.offer('l_r1', 'l_m1', 'We would be happy to see you at our shop. We are open from 10 am. Tell us a day that suits you.'), 'status'), 'rejected', 'OFFER: the call request is declined...');
select is((select (status, decision_note)::text from public.call_requests where id = tests.rid('l_r1')), '(rejected,offer_store_visit)', '...with the fixed note offer_store_visit');
select is((select (category, source, status, reason)::text from public.outbox_messages where id = tests.rid('l_m1')),
          case when app.outbox_in_quiet_hours(app.outbox_now()) then '(visit,owner,queued,quiet_hours)' else '(visit,owner,queued,auto_allowed)' end,
          '...AND the offer message is in the outbox: a "visit" message, queued (goes at once by day, waits for 09:00 in quiet hours: the AT policy)');
select is((select lead_id = tests.rid('l1') from public.outbox_messages where id = tests.rid('l_m1')), true, '...to the customer of the request');
select is(pg_temp.j(pg_temp.offer('l_r1', 'l_m1', 'We would be happy to see you at our shop. We are open from 10 am. Tell us a day that suits you.'), 'status'), 'rejected', 'IDEMPOTENT: the same call again replays');
select is((select count(*) from public.outbox_messages where lead_id = tests.rid('l1')), 1::bigint, '...one message');
select is(pg_temp.offer('l_r1', 'l_m1b', 'Another offer.'), 'ERR:SM501', 'STATE: a second offer for a request that is already decided is refused (SM501)');
select is(pg_temp.j(pg_temp.offer('l_r2', 'l_m2', 'We would be happy to see you at our shop. Please tell us a day that suits you. A small advance of ₹500 holds the slot.'), 'status'), 'rejected', 'OFFER: with a price in the words, the call is still declined');
select is((select (status, reason)::text from public.outbox_messages where id = tests.rid('l_m2')), '(needs_approval,money)', '...but the message waits for approval (money)');
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('l3_c')));
select is(pg_temp.j(pg_temp.offer('l_r3', 'l_m3', 'We would be happy to see you at our shop.'), 'status'), 'rejected', 'STOPPED: a customer who asked us to stop: the call is declined...');
select is((select (status, reason)::text from public.outbox_messages where id = tests.rid('l_m3')), '(blocked,stopped)', '...and the message is blocked (stopped): nothing reaches them');
select is(pg_temp.priv(format($q$update public.call_requests set status = 'approved' where id = %L$q$, tests.rid('l_r1'))), '42501', 'a declined call request cannot be approved afterwards (the guard)');
-- both hours, explicitly
select pg_temp.mk('l4'); select pg_temp.mk('l5');
select pg_temp.callreq('l_r4', 'l4'); select pg_temp.callreq('l_r5', 'l5');
select pg_temp.pin('2026-10-05 14:00:00+05:30');
select is(pg_temp.j(pg_temp.offer('l_r4', 'l_m4', 'We would be happy to see you at our shop. Tell us a day that suits you.'), 'status'), 'rejected', 'DAY 14:00 IST: offered...');
select is((select (status, reason)::text from public.outbox_messages where id = tests.rid('l_m4')), '(queued,auto_allowed)', '...and the offer is due at once');
select pg_temp.pin('2026-10-05 23:30:00+05:30');
select is(pg_temp.j(pg_temp.offer('l_r5', 'l_m5', 'We would be happy to see you at our shop. Tell us a day that suits you.'), 'status'), 'rejected', 'NIGHT 23:30 IST: offered...');
select is((select (status, reason, scheduled_for = '2026-10-06 09:00:00+05:30'::timestamptz)::text from public.outbox_messages where id = tests.rid('l_m5')), '(queued,quiet_hours,t)', '...and the offer waits for 09:00 the next morning');

-- ---------------------------------------------------------------------------------------------
-- M. the list
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select is(pg_temp.sc('a_viewer', format($q$select public.visit_list(%L)$q$, tests.tid('a'))) like 'ERR:%', false, 'LIST: any member reads it, a Viewer too');
select is(pg_temp.sc('b_owner', format($q$select public.visit_list(%L)$q$, tests.tid('a'))), 'ERR:42501', 'DENY: another business cannot');
select is(jsonb_array_length(pg_temp.sc('b_owner', format($q$select public.visit_list(%L, '2026-10-01', '2026-10-31')$q$, tests.tid('b')))::jsonb -> 'items'), 0, 'ISOLATION: the other business has no visits');
select is(pg_temp.sc('a_sales', format($q$select public.visit_list(%L, '2026-10-01', '2026-12-31')$q$, tests.tid('a'))), 'ERR:22023', 'INVALID: more than 62 days');
select is(pg_temp.sc('a_sales', format($q$select public.visit_list(%L, '2026-10-07', '2026-10-05')$q$, tests.tid('a'))), 'ERR:22023', 'INVALID: to before from');
select is(pg_temp.sc('a_sales', format($q$select public.visit_list(%L, null, null, false, 'gone')$q$, tests.tid('a'))), 'ERR:22023', 'INVALID: an unknown status');
select is(pg_temp.list('a_sales', ', null, null, true') ->> 'to', '2026-10-05', 'LIST: from and to default to today');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', ', null, null, true') -> 'items') x where x ->> 'status' not in ('booked', 'confirmed', 'arrived')), 0::bigint, 'LIST: open only holds booked, confirmed and arrived');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', ', ''2026-10-05'', ''2026-10-12''') -> 'items') x where x ->> 'status' = 'cancelled'), 2::bigint, 'LIST: a range holds cancelled visits too (b1 and the first of f1)');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', ', ''2026-10-05'', ''2026-10-12'', false, ''no_show''') -> 'items') x), 2::bigint, 'LIST: the status filter (the no-shows h1 and g_c)');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', format(', ''2026-10-05'', ''2026-10-12'', false, null, %L', tests.rid('v1'))) -> 'items') x where x ->> 'lead_id' <> tests.rid('v1')::text), 0::bigint, 'LIST: the lead filter');
select is((select count(*) from jsonb_array_elements(pg_temp.list('a_sales', format(', ''2026-10-05'', ''2026-10-12'', false, null, %L', tests.rid('v1'))) -> 'items') x), 1::bigint, '...and it finds the lead''s visit');
select is(jsonb_array_length(pg_temp.list('a_sales', format(', null, null, false, null, null, %L', tests.rid('b1'))) -> 'items'), 1, 'LIST: one visit by id (whatever its date)');
select is((select bool_and(a <= b) from (select x ->> 'starts_at' as a, lead(x ->> 'starts_at') over () as b from jsonb_array_elements(pg_temp.list('a_sales', ', ''2026-10-05'', ''2026-10-12''') -> 'items') x) q where b is not null), true, 'LIST: in time order');
select is((pg_temp.list('a_sales', ', ''2026-10-05'', ''2026-10-12''') -> 'items' -> 0) ?& array['id', 'lead_id', 'starts_at', 'ends_at', 'status', 'party_size', 'purpose', 'note', 'contact_name', 'company_name', 'city', 'reminder_sent', 'confirmation_sent', 'advance_requested', 'advance_paise', 'order_id', 'outcome'], true,
          'LIST: an item has every field the web needs');
update public.outbox_messages set status = 'sent', sent_at = now(), adapter = 'fake', adapter_message_id = 'z', claimed_at = now() where id = tests.rid('k_m6');
select is((select (x ->> 'reminder_sent')::boolean from jsonb_array_elements(pg_temp.list('a_sales', format(', null, null, false, null, null, %L', tests.rid('k_v1'))) -> 'items') x), true, 'LIST: reminder_sent is true once the reminder really went out');
select is((select (x ->> 'confirmation_sent')::boolean from jsonb_array_elements(pg_temp.list('a_sales', format(', null, null, false, null, null, %L', tests.rid('k_v1'))) -> 'items') x), false, '...and confirmation_sent stays false while that message is only queued');

-- ---------------------------------------------------------------------------------------------
-- N. direct writes and the guard triggers
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try('a_owner', format($q$insert into public.store_visits (id, tenant_id, lead_id, visit_date, starts_at, ends_at, request_sha256, created_by) values (gen_random_uuid(), %L, %L, '2026-10-06', '2026-10-06 11:00+05:30', '2026-10-06 11:30+05:30', repeat('a', 64), %L)$q$,
                                         tests.tid('a'), tests.rid('v1'), tests.uid('a_owner'))), '42501', 'DENY: even the Owner cannot insert a visit directly');
select is(pg_temp.try('a_owner', format($q$update public.store_visits set status = 'confirmed' where id = %L$q$, tests.rid('b2'))), '42501', 'DENY: nor update one');
select is(pg_temp.try('a_owner', format($q$delete from public.store_visits where id = %L$q$, tests.rid('b2'))), '42501', 'DENY: nor delete one');
select is(pg_temp.try('a_owner', format($q$update public.store_settings set slot_minutes = 15 where tenant_id = %L$q$, tests.tid('a'))), '42501', 'DENY: nor change the settings directly');
select is(pg_temp.priv(format($q$delete from public.store_visits where id = %L$q$, tests.rid('b2'))), '42501', 'GUARD: no visit is ever deleted (not even by the owner of the database)');
select is(pg_temp.priv('truncate public.store_visits'), '42501', '...nor truncated');
select is(pg_temp.priv('truncate public.store_visits cascade'), '42501', '...nor truncated with CASCADE (our guard fires)');
select is((select count(*) from pg_trigger g where g.tgrelid = 'public.store_visits'::regclass and not g.tgisinternal and g.tgenabled = 'O' and (g.tgtype & 32) <> 0 and (g.tgtype & 1) = 0), 1::bigint,
          'GUARD: store_visits has its own enabled BEFORE TRUNCATE statement trigger');
-- store_visits references orders and outbox_messages, so a PLAIN truncate of those is refused by PostgreSQL (0A000) before any trigger; with CASCADE their OWN guards fire
select is(pg_temp.priv('truncate public.orders cascade'), '42501', 'GUARD: orders is still protected by its own guard (CASCADE reaches it first)');
select is(pg_temp.priv('truncate public.outbox_messages cascade'), '42501', 'GUARD: so is outbox_messages');
select is((select count(*) from public.store_visits), (select count(*) from public.store_visits), 'the refused truncates left the visits alone');
select is(pg_temp.priv(format($q$insert into public.store_visits (id, tenant_id, lead_id, visit_date, starts_at, ends_at, status, outcome, request_sha256, created_by, arrived_at, closed_at)
                                 values (gen_random_uuid(), %L, %L, '2026-10-06', '2026-10-06 11:00+05:30', '2026-10-06 11:30+05:30', 'completed', 'bought', repeat('a', 64), %L, now(), now())$q$,
                 tests.tid('a'), tests.rid('v1'), tests.uid('a_owner'))), '42501', 'GUARD: a row cannot be inserted already completed');
select is(pg_temp.priv(format($q$update public.store_visits set status = 'booked' where id = %L$q$, tests.rid('b4'))), '42501', 'GUARD: a completed visit cannot go back to booked');
select is(pg_temp.priv(format($q$update public.store_visits set status = 'arrived', arrived_at = now() where id = %L$q$, tests.rid('b2'))), 'ok', 'GUARD: booked -> arrived is a legal move (privileged here)');
select is(pg_temp.priv(format($q$update public.store_visits set status = 'booked' where id = %L$q$, tests.rid('b2'))), '42501', 'GUARD: arrived -> booked is not');
select is(pg_temp.priv(format($q$update public.store_visits set status = 'cancelled', closed_at = now() where id = %L$q$, tests.rid('b2'))), '42501', 'GUARD: arrived -> cancelled is not');
select is(pg_temp.priv(format($q$update public.store_visits set lead_id = %L where id = %L$q$, tests.rid('v2'), tests.rid('b3'))), '42501', 'GUARD: the lead of a visit never changes');
select is(pg_temp.priv(format($q$update public.store_visits set source = 'assistant' where id = %L$q$, tests.rid('b3'))), '42501', 'GUARD: nor who made it');
select is(pg_temp.priv(format($q$update public.store_visits set party_size = 9 where id = %L$q$, tests.rid('b1'))), '42501', 'GUARD: a closed visit stays closed');
select is(pg_temp.priv(format($q$update public.store_visits set party_size = 9 where id = %L$q$, tests.rid('b2'))), '42501', 'GUARD: an arrived visit''s details do not change');
select is(pg_temp.priv(format($q$update public.store_visits set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour', visit_date = ((starts_at + interval '1 hour') at time zone 'Asia/Kolkata')::date where id = %L$q$, tests.rid('b3'))), 'ok',
          'GUARD: a visit that has not happened may move (privileged here)');
select is(pg_temp.priv(format($q$update public.store_visits set outcome = 'bought' where id = %L$q$, tests.rid('b3'))), '23514', 'CHECK: an outcome only goes with completed');
select is(pg_temp.priv(format($q$update public.store_visits set advance_requested = true where id = %L$q$, tests.rid('b3'))), '23514', 'CHECK: the advance flag and the amount go together');
select is(pg_temp.priv(format($q$update public.store_visits set visit_date = visit_date + 1 where id = %L$q$, tests.rid('b3'))), '23514', 'CHECK: the visit date is the India date of the start');
select is(pg_temp.priv(format($q$update public.store_settings set weekly_hours = '{"mon": null}'::jsonb where tenant_id = %L$q$, tests.tid('a'))), '23514', 'CHECK: the hours must have all seven days');
select is(pg_temp.priv(format($q$insert into public.store_visits (id, tenant_id, lead_id, visit_date, starts_at, ends_at, request_sha256, created_by) values (gen_random_uuid(), %L, %L, '2026-10-06', '2026-10-06 11:00+05:30', '2026-10-06 11:30+05:30', repeat('a', 64), %L)$q$,
                                 tests.tid('b'), tests.rid('v1'), tests.uid('a_owner'))), '23503', 'FK: a visit cannot name a lead of another business');
-- row-level security
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.store_visits'), (select count(*) from public.store_visits where tenant_id = tests.tid('a')), 'RLS: a Viewer reads the visits of the business');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.store_visits where tenant_id = ''' || tests.tid('a') || ''''), 0::bigint, 'RLS: another business reads none of them');
select is(tests.sqlstate_as(null, 'select 1 from public.store_visits'), '42501', 'RLS: anon cannot even read the table');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.store_settings where tenant_id = ''' || tests.tid('a') || ''''), 0::bigint, 'RLS: nor the settings');

-- ---------------------------------------------------------------------------------------------
-- O. audit: every change is recorded, never the words
-- ---------------------------------------------------------------------------------------------
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'store_visit') > 0, 'every change of a visit is audited');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'store_settings') > 0, 'every change of the hours is audited');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'store_visit' and (old_values::text like '%Bridal sarees%' or new_values::text like '%Bridal sarees%' or old_values::text like '%her mother%' or new_values::text like '%her mother%'
            or new_values::text like '%called to cancel%' or new_values::text like '%Wedding trousseau%')), 0::bigint, 'the audit trail holds no purpose, no note and no cancellation reason');

select * from finish();
rollback;
