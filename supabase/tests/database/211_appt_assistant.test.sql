-- Appointment booking, slices 2 and 3 (migration 20261231710000): the assistant offers free times, books the customer's choice, moves and cancels THEIR visit, and a booked visit is confirmed by message.
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

select pg_temp.pin('2026-11-02T11:00:00+05:30');   -- a Monday, 11:00 India time

select app.operator_register_scheduler('outsider@test.local');
select tests.open_gate('a');
-- the scheduler's door: the account the worker runs as
create function pg_temp.w(p_sql text, p_user text default 'outsider') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
select pg_temp.mk('c1'); select pg_temp.mk('c2');
insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media,
                                      may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute)
values (tests.tid('a'), 'Lakshmi', 'female_warm', 'te', true, true, 'warm', 1.0, false, true, false, false, 0, true, true, array[1, 2, 3, 4, 5, 6]::smallint[], 600, 1140);
update public.platform_flags set enabled = true where key = 'outbox_enabled';
insert into public.outbox_settings (tenant_id, auto_send_enabled, per_customer_daily_limit, quiet_start_hour, quiet_end_hour, updated_by) values (tests.tid('a'), true, 5, 21, 9, tests.uid('a_owner'))
  on conflict (tenant_id) do update set auto_send_enabled = true;

-- A. who may
select is(pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'en')::text$q$, tests.tid('a'), tests.rid('c1')), 'a_owner'), 'ERR:42501', 'A1: a person does not use the assistant''s door');
select is(pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'xx')::text$q$, tests.tid('a'), tests.rid('c1'))), 'ERR:22023', 'A2: the language is a known one');
select is(pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'en')::text$q$, tests.tid('a'), tests.rid('nobody'))), 'ERR:23503', 'A3: the customer must be this business''s');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'en')::text$q$, tests.tid('b'), tests.rid('c1'))), 'reason'), 'off', 'A4: when the owner does not let the assistant book, nothing is offered');

-- B. an offer and a choice
create temp table t_offer (j jsonb);
grant all on t_offer to public;
insert into t_offer select pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'te', 3)::text$q$, tests.tid('a'), tests.rid('c1')))::jsonb;
select is(jsonb_array_length((select j -> 'offered' from t_offer)), 3, 'B1: three free times are offered');
select is((select j #>> '{offered,0,n}' from t_offer), '1', 'B2: numbered from 1');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 9, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('bk1'))), 'status'), 'bad_choice', 'B3: a number that was not offered');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 2, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('bk1'))), 'status'), 'booked', 'B4: choice 2 books that time');
select is((select starts_at from public.store_visits where id = tests.rid('bk1')), ((select j #>> '{offered,1,starts_at}' from t_offer))::timestamptz, 'B5: exactly the offered time');
select is((select source || '/' || status || '/' || language from public.store_visits where id = tests.rid('bk1')), 'assistant/booked/te', 'B6: booked by the assistant, in the customer''s language, not yet confirmed');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 2, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('bk1'))), 'replayed'), 'true', 'B7: the same booking again replays');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 1, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('bk2'))), 'status'), 'no_offer', 'B8: an offer is used once');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 1, %L)::text$q$, tests.tid('a'), tests.rid('c2'), tests.rid('bk3'))), 'status'), 'no_offer', 'B9: another customer has no offer of their own');
select is(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 1, %L)::text$q$, tests.tid('a'), tests.rid('c2'), tests.rid('bk1'))), 'ERR:23505', 'B10: and another customer cannot take over a booking id');

-- C. the slot is taken before the customer answers
insert into t_offer select pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'en', 2)::text$q$, tests.tid('a'), tests.rid('c2')))::jsonb;
insert into public.store_settings (tenant_id, weekly_hours, max_parallel) values (tests.tid('a'), app.visit_default_hours(), 1) on conflict (tenant_id) do update set max_parallel = 1;
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 1, %L)::text$q$, tests.tid('a'), tests.rid('c2'), tests.rid('bk4'))), 'status'), 'booked', 'C1: with one place a second customer books the first offered time');
insert into t_offer select pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'en', 2)::text$q$, tests.tid('a'), tests.rid('c1')))::jsonb;
update public.store_visits set status = 'cancelled', closed_at = now(), cancel_reason = 'x' where id = tests.rid('bk4');
-- now take the first offered slot of c1's offer with a direct visit of c2 (the "somebody got it first" case)
insert into public.store_visits (id, tenant_id, lead_id, contact_id, visit_date, starts_at, ends_at, request_sha256, created_by, source)
select tests.rid('bk5'), tests.tid('a'), l.id, l.contact_id, ((o.j #>> '{offered,0,date}'))::date, ((o.j #>> '{offered,0,starts_at}'))::timestamptz, ((o.j #>> '{offered,0,starts_at}'))::timestamptz + interval '30 minutes', repeat('5', 64), tests.uid('a_owner'), 'staff'
  from public.leads l, (select j from t_offer order by ctid desc limit 1) o where l.id = tests.rid('c2');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 1, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('bk6'))), 'status'), 'taken', 'C2: somebody got it first: "taken", nothing booked');
select is((select count(*) from public.store_visits where id = tests.rid('bk6')), 0::bigint, 'C3: and no visit was made');

-- D. confirmation on booking
select pg_temp.pin('2026-11-02T11:05:00+05:30');
select is(jsonb_array_length(pg_temp.w(format($q$select public.scheduler_due_confirmations(%L)::text$q$, tests.tid('a')))::jsonb), 1, 'D1: the visit the assistant booked is due a confirmation (bk1)');
select is(pg_temp.j(pg_temp.w(format($q$select public.scheduler_confirm_booking(%L, %L, %L, 'Your visit is booked', 'en')::text$q$, tests.tid('a'), tests.rid('bk1'), tests.rid('m1'))), 'status'), 'queued', 'D2: confirmed and its message queued');
select is((select status from public.store_visits where id = tests.rid('bk1')), 'confirmed', 'D3: the visit is confirmed');
select is((select confirmation_message_id from public.store_visits where id = tests.rid('bk1')), tests.rid('m1'), 'D4: and linked to its message');
select is(jsonb_array_length(pg_temp.w(format($q$select public.scheduler_due_confirmations(%L)::text$q$, tests.tid('a')))::jsonb), 0, 'D5: not due again');
select is(pg_temp.j(pg_temp.w(format($q$select public.scheduler_confirm_booking(%L, %L, %L, 'again', 'en')::text$q$, tests.tid('a'), tests.rid('bk1'), tests.rid('m2'))), 'reason'), 'not_due', 'D6: a second confirmation is skipped');
select pg_temp.pin('2026-11-02T22:00:00+05:30');
insert into t_offer select pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'en', 2)::text$q$, tests.tid('a'), tests.rid('c2')))::jsonb;
select is(pg_temp.w(format($q$select public.scheduler_due_confirmations(%L)::text$q$, tests.tid('a'))), '[]', 'D7: at night (quiet hours) nothing is sent');
select pg_temp.pin('2026-11-02T11:05:00+05:30');

-- E. moving and cancelling their own visit
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_next_for_customer(%L, %L)::text$q$, tests.tid('a'), tests.rid('c1'))), 'visit_id'), tests.rid('bk1')::text, 'E1: the customer''s next visit is found');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'en', 2, 5, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('bk1'))), 'reason'), null, 'E2: new times are offered to move it');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_choice(%L, %L, 2, %L)::text$q$, tests.tid('a'), tests.rid('c1'), tests.rid('bk7'))), 'moved'), 'true', 'E3: the choice MOVES their visit');
select is((select status from public.store_visits where id = tests.rid('bk1')), 'booked', 'E4: it needs confirming again for the new time');
select is(jsonb_array_length(pg_temp.w(format($q$select public.scheduler_due_confirmations(%L)::text$q$, tests.tid('a')))::jsonb), 1, 'E5: and is due a new confirmation');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_offer_slots(%L, %L, 'en', 2, 5, %L)::text$q$, tests.tid('a'), tests.rid('c2'), tests.rid('bk1'))), 'reason'), 'no_visit', 'E6: another customer cannot move it');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_cancel_for_customer(%L, %L)::text$q$, tests.tid('a'), tests.rid('c2'))), 'visit_id') <> tests.rid('bk1')::text, true, 'E7: cancelling touches only their own');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_cancel_for_customer(%L, %L)::text$q$, tests.tid('a'), tests.rid('c1'))), 'status'), 'cancelled', 'E8: they cancel their own');
select is((select cancel_reason from public.store_visits where id = tests.rid('bk1')), 'cancelled by the customer', 'E9: with the reason');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_cancel_for_customer(%L, %L)::text$q$, tests.tid('a'), tests.rid('c1'))), 'status'), 'no_visit', 'E10: nothing left to cancel');


-- F. the phone: the time the caller agreed to is booked when the call is a customer's
insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, end_reason, answered_at, ended_at, captured, lead_id, contact_id)
select tests.rid('call1'), tests.tid('a'), 'outbound', 'exotel', true, 'sales_followup', 'te', true, 'completed', 'goodbye', now() - interval '3 minutes', now() - interval '2 minutes',
       jsonb_build_object('visit_at', to_char(timestamptz '2026-11-03 15:00+05:30' at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') || '+05:30'), l.id, l.contact_id from public.leads l where l.id = tests.rid('c1');
insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, end_reason, answered_at, ended_at, captured)
values (tests.rid('call2'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'completed', 'goodbye', now() - interval '3 minutes', now() - interval '2 minutes', '{"visit_at": "2026-11-03T16:00:00+05:30"}');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_from_call(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('call1'), tests.rid('bk8'))), 'status'), 'booked', 'F1: a call with a lead books the agreed time');
select is((select source || '/' || language from public.store_visits where id = tests.rid('bk8')), 'assistant/te', 'F2: by the assistant, in the caller''s language');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_from_call(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('call1'), tests.rid('bk8'))), 'replayed'), 'true', 'F3: the same call again replays');
select is(pg_temp.j(pg_temp.w(format($q$select public.appointment_book_from_call(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('call2'), tests.rid('bk9'))), 'status'), 'no_lead', 'F4: a caller nobody knows stays for a person');
select is(pg_temp.w(format($q$select public.appointment_book_from_call(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('call1'), tests.rid('bk10')), 'a_owner'), 'ERR:42501', 'F5: a person does not use this door');

select * from finish();
rollback;
