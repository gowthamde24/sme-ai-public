-- Calendars in (migration 20261231992360; docs/contracts/commerce-notify.md section D): the tables hold no key and no client can reach them; who may do what (any member reads the cards; the Owner or an Admin
-- connects with the second factor, changes the settings and disconnects; only the Owner starts Outlook; only the scheduler account serves the vendors' door and the worker); a booking becomes a visit through
-- the slot engine once, a booking that does not fit is kept for a person and never forced in, a cancel cancels once, a moved booking replaces the old visit; the booking link only when shared; Outlook's
-- authorization, appointments due, busy blocks (their own source) and disconnect.
--   A catalog   B who may   C bookings   D the booking link   E Outlook   F disconnect
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.a() returns uuid language sql as $$ select tests.tid('a') $$;

-- A: the catalog
select has_table('integrations', 'calendar_connections', 'A: the connections');
select has_table('integrations', 'calendar_bookings', 'A: the bookings');
select has_table('integrations', 'calendar_event_links', 'A: the Outlook event links');
select has_table('integrations', 'calendar_states', 'A: the authorizations in flight');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'integrations' and c.relname in ('calendar_connections', 'calendar_bookings', 'calendar_event_links', 'calendar_states')
            and c.relrowsecurity and c.relforcerowsecurity), 4::bigint, 'A: RLS is enabled and FORCED on all four');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'integrations' and table_name like 'calendar_%' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
          0::bigint, 'A: no client role holds anything on them');
select is((select count(*) from information_schema.columns where table_schema = 'integrations' and table_name in ('calendar_connections', 'calendar_bookings', 'calendar_event_links', 'calendar_states')
            and column_name !~ 'last4$' and column_name ~ '(^|_)(token|secret|refresh_token|access_token|signing_key|password)($|_)'), 0::bigint, 'A: no column could hold a key (secret_last4 is the last four characters, a label)');
select ok((select pg_get_constraintdef(oid) like '%outlook%' from pg_constraint where conname = 'calendar_busy_source_check'), 'A: a busy block may come from Outlook');

-- B: who may
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_save(%L, 'calcom', 'Cal.com', 'wxyz', 'https://cal.com/shop/visit', %L)::jsonb ->> 'kind'$q$, pg_temp.a(), repeat('a', 64))), 'calcom', 'B: the Owner connects Cal.com');
select is(pg_temp.sc('a_admin', format($q$select public.calendar_connection_save(%L, 'calendly', 'Calendly', 'abcd', null, %L, 'https://api.calendly.com/webhook_subscriptions/SUB-1234')::jsonb ->> 'kind'$q$, pg_temp.a(), repeat('b', 64))), 'calendly', 'B: an Admin connects Calendly');
select is(pg_temp.sc('a_sales', format($q$select public.calendar_connection_save(%L, 'calcom', 'x', 'abcd', null, %L)::text$q$, pg_temp.a(), repeat('c', 64))), 'ERR:42501', 'B: Sales may not');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_save(%L, 'calcom', 'x', 'abcd', 'http://cal.com/x', %L)::text$q$, pg_temp.a(), repeat('c', 64))), 'ERR:22023', 'B: an address that is not https is refused');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_save(%L, 'outlook', 'x', 'abcd', null, %L)::text$q$, pg_temp.a(), repeat('d', 64))), 'ERR:22023', 'B: outlook is not connected this way');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_save(%L, 'calcom', 'x', 'abcd', null, %L)::text$q$, pg_temp.a(), repeat('b', 64))), 'ERR:22023', 'B: a door address already used by another connector is refused');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_save(%L, 'calcom', 'x', 'abcd', null, %L)::text$q$, pg_temp.a(), repeat('c', 64)), 'aal1'), 'ERR:SM306', 'B: connecting asks for the second factor');
select is(pg_temp.sc('a_viewer', format($q$select jsonb_array_length(public.calendar_connections_list(%L))::text$q$, pg_temp.a())), '2', 'B: any member reads the cards');
select is(pg_temp.sc('b_owner', format($q$select public.calendar_connections_list(%L)::text$q$, pg_temp.a())), 'ERR:42501', 'B: another workspace reads nothing');
select is(pg_temp.sc('a_owner', format($q$select (public.calendar_connections_list(%L) -> 0)::text ~ 'hook_hash|hook_ref'$q$, pg_temp.a())), 'false', 'B: the list never shows the door or the subscription');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_ref(%L, 'calendly') ->> 'hook_ref'$q$, pg_temp.a())), 'https://api.calendly.com/webhook_subscriptions/SUB-1234', 'B: the Owner reads the subscription to take it down');
select is(pg_temp.sc('a_sales', format($q$select public.calendar_connection_ref(%L, 'calendly')::text$q$, pg_temp.a())), 'ERR:42501', 'B: Sales may not');
select is(pg_temp.sc('a_admin', format($q$select public.calendar_outlook_start(%L)::text$q$, pg_temp.a())), 'ERR:42501', 'B: only the Owner starts Outlook');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_settings(%L, 'calcom', null, true)::jsonb ->> 'share_link'$q$, pg_temp.a())), 'true', 'B: share my booking link');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_settings(%L, 'calendly', null, true)::text$q$, pg_temp.a())), 'ERR:22023', 'B: nothing to share without an address');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_settings(%L, 'calcom', null, null, true)::text$q$, pg_temp.a())), 'ERR:22023', 'B: write events is an Outlook setting');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_connection_settings(%L, 'outlook', null, true)::text$q$, pg_temp.a())), 'ERR:SM891', 'B: a connector that is not connected');
select is(pg_temp.sch(format($q$select public.scheduler_calendar_hook(%L)::jsonb ->> 'kind'$q$, repeat('a', 64))), 'calcom', 'B: the scheduler account finds the connector by the door''s hash');
select is(pg_temp.sch(format($q$select coalesce(public.scheduler_calendar_hook(%L)::text, 'none')$q$, repeat('f', 64))), 'none', 'B: an unknown door is nothing');
select is(pg_temp.sc('a_owner', format($q$select coalesce(public.scheduler_calendar_hook(%L)::text, 'none')$q$, repeat('a', 64))), 'ERR:42501', 'B: a person is not the scheduler account');

-- C: bookings (all seven days 10:00 to 20:00, so a time three days ahead at 11:00 India time is a real slot)
select pg_temp.sc('a_owner', format($q$select public.visit_settings_set(%L, '{"mon":{"open":"10:00","close":"20:00"},"tue":{"open":"10:00","close":"20:00"},"wed":{"open":"10:00","close":"20:00"},"thu":{"open":"10:00","close":"20:00"},"fri":{"open":"10:00","close":"20:00"},"sat":{"open":"10:00","close":"20:00"},"sun":{"open":"10:00","close":"20:00"}}'::jsonb, '{}'::date[], 30, 2, 0)::text$q$, pg_temp.a()));
create temp table fx as select ((((now() at time zone 'Asia/Kolkata')::date + 3)::text || ' 11:00:00+05:30')::timestamptz) as t0, (select c.phone from public.leads l join public.contacts c on c.id = l.contact_id where l.id = tests.rid('a_lead')) as phone;
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_apply(%L, 'calcom', 'bk1', %L, null, %L, %L, 'Showroom visit')::text$q$, pg_temp.a(), (select phone from fx), (select t0 from fx), (select t0 + interval '30 minutes' from fx))), 'state'),
          'booked', 'C: a booking becomes a visit through the slot engine');
select is((select count(*) from public.store_visits v join integrations.calendar_bookings b on b.visit_id = v.id where b.tenant_id = pg_temp.a() and b.external_id = 'bk1' and v.status = 'booked'), 1::bigint, 'C: the visit is booked and linked to the booking');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_apply(%L, 'calcom', 'bk1', %L, null, %L, %L, 'Showroom visit')::text$q$, pg_temp.a(), (select phone from fx), (select t0 from fx), (select t0 + interval '30 minutes' from fx))), 'replayed'),
          'true', 'C: the same booking again is a replay');
select is((select count(*) from public.store_visits where tenant_id = pg_temp.a() and purpose = 'Showroom visit'), 1::bigint, 'C: one visit');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_apply(%L, 'calcom', 'bk2', '+919000000099', null, %L, %L, null)::text$q$, pg_temp.a(), (select t0 from fx), (select t0 + interval '30 minutes' from fx))), 'reason'),
          'no_lead', 'C: no lead for the number: kept for a person, no visit');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_apply(%L, 'calcom', 'bk3', %L, null, %L, %L, null)::text$q$, pg_temp.a(), (select phone from fx), (select t0 + interval '7 minutes' from fx), (select t0 + interval '37 minutes' from fx))), 'reason'),
          'slot', 'C: a time off the slot grid is kept for a person, never forced in');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_apply(%L, 'calcom', 'bk4', %L, null, %L, %L, null)::text$q$, pg_temp.a(), (select phone from fx), (select t0 - interval '20 days' from fx), (select t0 - interval '20 days' + interval '30 minutes' from fx))), 'reason'),
          'past', 'C: a time in the past is kept for a person');
select is(pg_temp.sc('a_viewer', format($q$select jsonb_array_length(public.calendar_bookings_list(%L))::text$q$, pg_temp.a())), '3', 'C: a member sees the three that need a person');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_cancel(%L, 'calcom', 'bk1')::text$q$, pg_temp.a())), 'state'), 'cancelled', 'C: a cancel');
select is((select status from public.store_visits where tenant_id = pg_temp.a() and purpose = 'Showroom visit'), 'cancelled', 'C: cancels the visit that came from it');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_cancel(%L, 'calcom', 'bk1')::text$q$, pg_temp.a())), 'replayed'), 'true', 'C: and only once');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_apply(%L, 'calcom', 'bk1', %L, null, %L, %L, 'Showroom visit')::text$q$, pg_temp.a(), (select phone from fx), (select t0 from fx), (select t0 + interval '30 minutes' from fx))), 'state'),
          'cancelled', 'C: a late "created" cannot book a cancelled booking again');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_apply(%L, 'calcom', 'bk5', %L, null, %L, %L, 'Moved visit')::text$q$, pg_temp.a(), (select phone from fx), (select t0 + interval '1 day' from fx), (select t0 + interval '1 day 30 minutes' from fx))), 'state'),
          'booked', 'C: a new booking');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_calendar_booking_apply(%L, 'calcom', 'bk5', %L, null, %L, %L, 'Moved visit')::text$q$, pg_temp.a(), (select phone from fx), (select t0 + interval '2 days' from fx), (select t0 + interval '2 days 30 minutes' from fx))), 'replayed'),
          'false', 'C: the same booking at another time is a move');
select is((select count(*) from public.store_visits where tenant_id = pg_temp.a() and purpose = 'Moved visit' and status = 'booked'), 1::bigint, 'C: one live visit after a move');
select is((select count(*) from public.store_visits where tenant_id = pg_temp.a() and purpose = 'Moved visit' and status = 'cancelled'), 1::bigint, 'C: the old one is cancelled');
select is(pg_temp.sc('a_owner', format($q$select public.scheduler_calendar_booking_cancel(%L, 'calcom', 'x')::text$q$, pg_temp.a())), 'ERR:42501', 'C: a person is not the scheduler account');
select is(pg_temp.sc('a_owner', format($q$select count(*)::text from integrations.calendar_bookings where tenant_id = %L$q$, pg_temp.a())), 'ERR:42501', 'C: the table itself is out of reach');

-- D: the booking link
select is(pg_temp.sch(format($q$select public.scheduler_calendar_booking_link(%L)::jsonb ->> 'url'$q$, pg_temp.a())), 'https://cal.com/shop/visit', 'D: said when shared');
select pg_temp.sc('a_owner', format($q$select public.calendar_connection_settings(%L, 'calcom', null, false)::text$q$, pg_temp.a()));
select is(pg_temp.sch(format($q$select coalesce(public.scheduler_calendar_booking_link(%L)::text, 'none')$q$, pg_temp.a())), 'none', 'D: nothing when the owner switched it off');

-- E: Outlook
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.calendar_outlook_start(%L)::text$q$, pg_temp.a())), 'member_id'), tests.uid('a_owner')::text, 'E: the Owner starts an authorization');
select is(pg_temp.sch(format($q$select public.scheduler_cal_state_use(%L, %L, %L)::text$q$, gen_random_uuid(), pg_temp.a(), tests.uid('a_owner'))), 'ERR:SM892', 'E: an unknown nonce is refused');
select is(pg_temp.sch(format($q$select public.scheduler_cal_outlook_connected(%L, %L, 'wxyz')::jsonb ->> 'kind'$q$, pg_temp.a(), tests.uid('a_owner'))), 'outlook', 'E: connected (the scheduler account, after the Owner consented)');
select is(pg_temp.sch(format($q$select public.scheduler_cal_outlook_connected(%L, %L, 'wxyz')::text$q$, pg_temp.a(), tests.uid('a_sales'))), 'ERR:42501', 'E: only an Owner can have connected it');
select is(pg_temp.sch(format($q$select jsonb_array_length(public.scheduler_cal_outlook_links(10))::text$q$)), '1', 'E: the worker lists the link');
select is(pg_temp.sch(format($q$select jsonb_array_length(public.scheduler_cal_visits_due(%L, 25))::text$q$, pg_temp.a())), '1', 'E: the appointments due (write events is on by default): the live moved visit');
select is(pg_temp.sch(format($q$select public.scheduler_cal_event_done(%L, %L, 'AAMkEXAMPLE1234', 'written', %L, now())::jsonb ->> 'state'$q$, pg_temp.a(), (select v.id from public.store_visits v where v.tenant_id = pg_temp.a() and v.status = 'booked' and v.purpose = 'Moved visit'), repeat('e', 64))), 'written', 'E: a push went through');
select is(pg_temp.sch(format($q$select jsonb_array_length(public.scheduler_cal_own_events(%L))::text$q$, pg_temp.a())), '1', 'E: our own event ids are known (left out of the busy times)');
select pg_temp.sc('a_owner', format($q$select public.calendar_connection_settings(%L, 'outlook', null, null, null, true)::text$q$, pg_temp.a()));
select is(pg_temp.sch(format($q$select public.scheduler_cal_busy_replace(%L, '[{"start": "2031-01-01T05:00:00Z", "end": "2031-01-01T06:00:00Z"}]'::jsonb)::jsonb ->> 'added'$q$, pg_temp.a())), '1', 'E: busy blocks are kept as a set when block busy is on');
select is((select count(*) from public.calendar_busy where tenant_id = pg_temp.a() and source = 'outlook'), 1::bigint, 'E: with their own source');
select is(pg_temp.sch(format($q$select public.scheduler_cal_busy_replace(%L, '[{"start": "2031-01-01T06:00:00Z", "end": "2031-01-01T05:00:00Z"}]'::jsonb)::text$q$, pg_temp.a())), 'ERR:22023', 'E: a block that ends before it starts is refused');
select is(pg_temp.sch(format($q$select public.scheduler_cal_link_failed(%L, 'token', 'revoked', true)::jsonb ->> 'status'$q$, pg_temp.a())), 'needs_reconnect', 'E: a revoked grant stops the link');
select is(pg_temp.sch(format($q$select (public.scheduler_cal_outlook_links(10) -> 0 ->> 'busy_due') || (public.scheduler_cal_outlook_links(10) -> 0 ->> 'events_due')$q$)), 'falsefalse', 'E: and nothing is due while it needs the owner');
select pg_temp.sc('a_owner', format($q$select public.calendar_connection_settings(%L, 'outlook', null, null, null, false)::text$q$, pg_temp.a()));
select is((select count(*) from public.calendar_busy where tenant_id = pg_temp.a() and source = 'outlook'), 0::bigint, 'E: switching block busy off drops the blocks at once');

-- F: disconnect
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.calendar_connection_disconnect(%L, 'outlook')::text$q$, pg_temp.a())), 'disconnected'), 'true', 'F: Outlook disconnected');
select is((select count(*) from integrations.calendar_event_links where tenant_id = pg_temp.a()), 0::bigint, 'F: our copy of the event links is gone');
select is(pg_temp.j(pg_temp.sc('a_admin', format($q$select public.calendar_connection_disconnect(%L, 'calcom')::text$q$, pg_temp.a())), 'disconnected'), 'true', 'F: an Admin disconnects Cal.com');
select is(pg_temp.sch(format($q$select coalesce(public.scheduler_calendar_hook(%L)::text, 'none')$q$, repeat('a', 64))), 'none', 'F: the door stops answering at once');
select is(pg_temp.sc('a_sales', format($q$select public.calendar_connection_disconnect(%L, 'calendly')::text$q$, pg_temp.a())), 'ERR:42501', 'F: Sales may not');
select is((select count(*) from integrations.calendar_bookings where tenant_id = pg_temp.a()), 5::bigint, 'F: the booking history stays');

select * from finish();
rollback;
