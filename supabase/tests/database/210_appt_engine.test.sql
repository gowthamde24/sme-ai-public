-- Appointment booking, slice 1 (migration 20261231700000): the buffer, staff, the exclusion constraint that makes double-booking a person impossible, moving, busy time from a calendar.
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
create function pg_temp.slot(p_date date, p_start text, p_staff text default null) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  j := (pg_temp.sc('a_owner', format($q$select public.visit_slots(%L, %L, %L)$q$, tests.tid('a'), p_date, case when p_staff is null then null else tests.rid(p_staff)::text end)))::jsonb;
  return (select s from jsonb_array_elements(j -> 'slots') s where s ->> 'start' = p_start);
end $$;
create function pg_temp.bookst(p_visit text, p_lead text, p_date date, p_slot text, p_staff text default null, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.visit_book(%L, %L, %L, %L, %L, 1, null, null, null, 'staff', %L)$q$, tests.rid(p_visit), tests.tid('a'), tests.rid(p_lead), p_date, p_slot, case when p_staff is null then null else tests.rid(p_staff)::text end)) $$;
select pg_temp.main_pin();
select pg_temp.mk('c1'); select pg_temp.mk('c2'); select pg_temp.mk('c3'); select pg_temp.mk('c4');

-- A. the buffer: one place, 30 minutes of buffer after every booking
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.visit_settings_set(%L, %L::jsonb, '{}'::date[], 30, 1, 30)$q$, tests.tid('a'), app.visit_default_hours()::text)), 'buffer_minutes'), '30', 'A1: the buffer is saved and read back');
select is(pg_temp.sc('a_owner', format($q$select public.visit_settings_set(%L, %L::jsonb, '{}'::date[], 30, 1, 61)$q$, tests.tid('a'), app.visit_default_hours()::text)), 'ERR:22023', 'A2: a buffer over 60 minutes is refused');
select is(pg_temp.j(pg_temp.bookst('v1', 'c1', date '2026-10-06', '11:00'), 'status'), 'booked', 'A3: a visit is booked at 11:00');
select is((pg_temp.slot(date '2026-10-06', '11:00') ->> 'free')::int, 0, 'A4: 11:00 is now full');
select is((pg_temp.slot(date '2026-10-06', '11:30') ->> 'free')::int, 0, 'A5: 11:30 is blocked by the buffer');
select is((pg_temp.slot(date '2026-10-06', '12:00') ->> 'free')::int, 1, 'A6: 12:00 is free again');
select is(pg_temp.bookst('v2', 'c2', date '2026-10-06', '11:30'), 'ERR:SM513', 'A7: booking inside the buffer is refused (the slot is full)');
select is((select buffer_minutes from public.store_visits where id = tests.rid('v1')), 30::smallint, 'A8: the visit keeps the buffer that applied when it was booked');
select is(pg_temp.j(pg_temp.step('v1', 'cancel'), 'status'), 'cancelled', 'A9: the first visit is cancelled');
select is((pg_temp.slot(date '2026-10-06', '11:30') ->> 'free')::int, 1, 'A10: a cancelled visit frees its slot and its buffer');

-- B. staff: two people, one place each
select is(pg_temp.sc('a_sales', format($q$select public.store_staff_save(%L, %L, 'Asha', null, true)$q$, tests.tid('a'), tests.rid('st_asha'))), 'ERR:42501', 'B1: Sales cannot add staff');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.store_staff_save(%L, %L, 'Asha', null, true)$q$, tests.tid('a'), tests.rid('st_asha'))), 'name'), 'Asha', 'B2: the owner adds Asha');
select is(pg_temp.j(pg_temp.sc('a_admin', format($q$select public.store_staff_save(%L, %L, 'Ravi', null, true)$q$, tests.tid('a'), tests.rid('st_ravi'))), 'name'), 'Ravi', 'B3: an Admin adds Ravi');
select is(pg_temp.sc('a_owner', format($q$select public.store_staff_save(%L, %L, '  ', null, true)$q$, tests.tid('a'), tests.rid('st_x'))), 'ERR:22023', 'B4: a name is required');
select is(pg_temp.sc('a_owner', format($q$select public.store_staff_save(%L, %L, 'Mallory', null, true)$q$, tests.tid('b'), tests.rid('st_m'))), 'ERR:42501', 'B5: nobody adds staff to another business');
select is((pg_temp.slot(date '2026-10-06', '14:00') ->> 'capacity')::int, 2, 'B6: with two staff a slot has two places (max_parallel no longer counts)');
select is(jsonb_array_length(pg_temp.slot(date '2026-10-06', '14:00') -> 'staff'), 2, 'B7: and says who is free');
select is(pg_temp.j(pg_temp.bookst('v3', 'c1', date '2026-10-06', '14:00'), 'staff_id'), tests.rid('st_asha')::text, 'B8: "any" is given to the first free person (by name)');
select is(pg_temp.j(pg_temp.bookst('v4', 'c2', date '2026-10-06', '14:00'), 'staff_id'), tests.rid('st_ravi')::text, 'B9: the next one to the next');
select is(pg_temp.bookst('v5', 'c3', date '2026-10-06', '14:00'), 'ERR:SM513', 'B10: a third booking at 14:00 finds nobody free');
select is((pg_temp.slot(date '2026-10-06', '14:00') ->> 'free')::int, 0, 'B11: and the slot says so');
select is(pg_temp.bookst('v6', 'c3', date '2026-10-06', '15:00', 'st_ravi') ::jsonb ->> 'staff_id', tests.rid('st_ravi')::text, 'B12: a named person is booked');
select is(pg_temp.bookst('v7', 'c4', date '2026-10-06', '15:00', 'st_ravi'), 'ERR:SM513', 'B13: the same person twice at that time is refused');
select is(pg_temp.j(pg_temp.bookst('v7', 'c4', date '2026-10-06', '15:00'), 'staff_id'), tests.rid('st_asha')::text, 'B14: but "any" finds the other person');
select is(jsonb_array_length(pg_temp.slot(date '2026-10-06', '15:00', 'st_ravi') -> 'staff'), 0, 'B15: asking for one person alone shows them busy');
select is(pg_temp.bookst('v8', 'c1', date '2026-10-07', '10:00', 'st_nobody'), 'ERR:22023', 'B16: a person who is not on the staff list is refused');

-- C. the DATABASE says no, whatever the path: the same person cannot overlap themselves
select is(pg_temp.priv(format($q$insert into public.store_visits (id, tenant_id, lead_id, contact_id, visit_date, starts_at, ends_at, request_sha256, created_by, staff_id)
  select gen_random_uuid(), %L, l.id, l.contact_id, date '2026-10-06', timestamptz '2026-10-06 14:00+05:30', timestamptz '2026-10-06 14:30+05:30', repeat('7', 64), %L, %L
    from (select id, contact_id from public.leads where tenant_id = %L order by id limit 1) l$q$, tests.tid('a'), tests.uid('a_owner'), tests.rid('st_asha'), tests.tid('a'))), '23P01', 'C1: a direct insert that double-books a person violates the exclusion constraint');
select is(pg_temp.priv(format($q$insert into public.store_visits (id, tenant_id, lead_id, contact_id, visit_date, starts_at, ends_at, request_sha256, created_by, staff_id, status, cancel_reason, closed_at)
  select gen_random_uuid(), %L, l.id, l.contact_id, date '2026-10-06', timestamptz '2026-10-06 14:00+05:30', timestamptz '2026-10-06 14:30+05:30', repeat('8', 64), %L, %L, 'booked', null, null
    from (select id, contact_id from public.leads where tenant_id = %L order by id limit 1) l$q$, tests.tid('a'), tests.uid('a_owner'), tests.rid('st_ravi'), tests.tid('a'))), '23P01', 'C2: and so does the other person');

-- D. moving a visit
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.visit_change(%L, %L, date '2026-10-06', '16:00', null, null, null, null, false, null)$q$, tests.tid('a'), tests.rid('v3'))), 'staff_id'), tests.rid('st_asha')::text, 'D1: a visit moved to a free slot keeps its person');
select is(pg_temp.sc('a_owner', format($q$select public.visit_change(%L, %L, date '2026-10-06', '15:00', null, null, null, null, false, null)$q$, tests.tid('a'), tests.rid('v3'))), 'ERR:SM513', 'D2b: nobody is free at 15:00: refused, the visit stays where it was');
select is((select starts_at from public.store_visits where id = tests.rid('v3')), timestamptz '2026-10-06 16:00+05:30', 'D3: it stayed at 16:00');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.visit_change(%L, %L, null, null, null, null, null, null, false, %L)$q$, tests.tid('a'), tests.rid('v3'), tests.rid('st_ravi'))), 'staff_id'), tests.rid('st_ravi')::text, 'D4: only the person can be changed (Ravi is free at 16:00)');
select is(pg_temp.sc('a_owner', format($q$select public.visit_change(%L, %L, null, null, null, null, null, null, false, %L)$q$, tests.tid('a'), tests.rid('v6'), tests.rid('st_asha'))), 'ERR:SM513', 'D5: or refused when that person is taken then (Asha has v7 at 15:00)');

-- E. a cancelled visit lets its person go
select is(pg_temp.step('v7', 'cancel') like '%cancelled%', true, 'E1: Asha''s 15:00 visit is cancelled');
select is(pg_temp.j(pg_temp.bookst('v9', 'c2', date '2026-10-06', '15:00', 'st_asha'), 'staff_id'), tests.rid('st_asha')::text, 'E2: and Asha can be booked at 15:00 again');

-- F. a person with their own hours
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.store_staff_save(%L, %L, 'Ravi', %L::jsonb, true)$q$, tests.tid('a'), tests.rid('st_ravi'), '{"mon": {"open": "10:00", "close": "13:00"}, "tue": null, "wed": null, "thu": null, "fri": null, "sat": null, "sun": null}')), 'name'), 'Ravi', 'F1: Ravi works Mondays 10:00 to 13:00 only');
select is((pg_temp.slot(date '2026-10-06', '12:00') ->> 'capacity')::int, 1, 'F2: on a Tuesday only Asha is there (capacity 1)');
select is((pg_temp.slot(date '2026-10-12', '12:00') ->> 'capacity')::int, 2, 'F3: on a Monday both are, at 12:00');
select is((pg_temp.slot(date '2026-10-12', '14:00') ->> 'capacity')::int, 1, 'F4: but Ravi is gone by 14:00');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.store_staff_save(%L, %L, 'Ravi', null, false)$q$, tests.tid('a'), tests.rid('st_ravi'))), 'active'), 'false', 'F5: a person who left is made inactive, not deleted');
select is((pg_temp.slot(date '2026-10-12', '12:00') ->> 'capacity')::int, 1, 'F6: and no longer counts');

-- G. busy time from a connected calendar blocks the slot (the stub is replaced the way the Google migration does)
create or replace function app.calendar_busy_overlaps(p_tenant uuid, p_from timestamptz, p_to timestamptz) returns boolean language sql stable as $$ select p_from = timestamptz '2026-10-07 11:00+05:30' $$;
select is((pg_temp.slot(date '2026-10-07', '11:00') ->> 'free')::int, 0, 'G1: a busy time makes the slot full');
select is((pg_temp.slot(date '2026-10-07', '11:00') ->> 'blocked')::boolean, true, 'G2: and says it is blocked');
select is(pg_temp.bookst('v10', 'c3', date '2026-10-07', '11:00'), 'ERR:SM513', 'G3: nobody can book it');
select is((pg_temp.slot(date '2026-10-07', '11:30') ->> 'free')::int, 1, 'G4: the next slot is fine');

-- H. who has it
select is((select (x ->> 'staff_name') from jsonb_array_elements(pg_temp.sc('a_owner', format($q$select public.visit_list(%L, date '2026-10-06', date '2026-10-06')$q$, tests.tid('a')))::jsonb -> 'items') x where x ->> 'id' = tests.rid('v9')::text), 'Asha', 'H1: the visit list says who has each visit');
select is(jsonb_array_length(pg_temp.sc('a_viewer', format($q$select public.store_staff_list(%L)$q$, tests.tid('a')))::jsonb -> 'items'), 2, 'H2: every member reads the staff list');
select is(pg_temp.sc('b_owner', format($q$select public.store_staff_list(%L)$q$, tests.tid('a'))), 'ERR:42501', 'H3: but only their own business''s');

select * from finish();
rollback;
