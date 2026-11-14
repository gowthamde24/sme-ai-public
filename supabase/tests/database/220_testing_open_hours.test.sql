-- Migration 20261231870000: the platform flag `testing_open_hours` (OFF by default, set ON by hand in the STAGING project only) opens the CLOCK of quiet hours and calling hours; nothing else.
begin;
select no_plan();
select tests.seed_two_tenants();

-- 22:30 India time on a Sunday: inside the quiet hours and outside the calling hours
select is((select enabled from public.platform_flags where key = 'testing_open_hours'), false, 'A1: a new database has the flag OFF (production never has it on)');
select is(app.outbox_in_quiet_hours(timestamptz '2026-11-15 22:30:00+05:30'), true, 'A2: flag off: 22:30 is in quiet hours (one-argument helper)');
select is(app.outbox_in_quiet_hours(timestamptz '2026-11-15 22:30:00+05:30', tests.tid('a')), true, 'A3: flag off: 22:30 is in quiet hours (tenant form)');
select is(app.outbox_in_quiet_hours(timestamptz '2026-11-15 08:00:00+05:30', tests.tid('a')), true, 'A4: flag off: 08:00 is in quiet hours');
select is(app.outbox_in_quiet_hours(timestamptz '2026-11-15 12:00:00+05:30', tests.tid('a')), false, 'A5: flag off: noon is open');
select is(app.outbox_next_open(timestamptz '2026-11-15 22:30:00+05:30', tests.tid('a')), timestamptz '2026-11-16 09:00:00+05:30', 'A6: flag off: the next open moment is 09:00');
select is(app.outreach_in_hours(tests.tid('a'), timestamptz '2026-11-15 22:30:00+05:30'), false, 'A7: flag off: no calls at 22:30');
select is(app.outreach_in_hours(tests.tid('a'), timestamptz '2026-11-15 12:00:00+05:30'), false, 'A8: flag off: nor on a Sunday (the default hours are Monday to Saturday)');

update public.platform_flags set enabled = true where key = 'testing_open_hours';

select is(app.testing_open_hours(), true, 'B1: flag on');
select is(app.outbox_in_quiet_hours(timestamptz '2026-11-15 22:30:00+05:30'), false, 'B2: flag on: 22:30 is open (one-argument helper)');
select is(app.outbox_in_quiet_hours(timestamptz '2026-11-15 22:30:00+05:30', tests.tid('a')), false, 'B3: flag on: 22:30 is open (tenant form)');
select is(app.outbox_in_quiet_hours(timestamptz '2026-11-15 03:00:00+05:30', tests.tid('a')), false, 'B4: flag on: 03:00 is open');
select is(app.outbox_next_open(timestamptz '2026-11-15 22:30:00+05:30', tests.tid('a')), timestamptz '2026-11-15 22:30:00+05:30', 'B5: flag on: the next open moment is now');
select is(app.outbox_next_open(timestamptz '2026-11-15 22:30:00+05:30'), timestamptz '2026-11-15 22:30:00+05:30', 'B6: flag on: and for the one-argument form');
select is(app.outreach_in_hours(tests.tid('a'), timestamptz '2026-11-15 22:30:00+05:30'), true, 'B7: flag on: a call may go at 22:30 on a Sunday');
select is(app.outreach_slot(tests.tid('a'), timestamptz '2026-11-15 22:30:00+05:30'), timestamptz '2026-11-15 22:30:00+05:30', 'B8: flag on: the calling slot is now');

update public.platform_flags set enabled = false where key = 'testing_open_hours';

select is(app.outbox_in_quiet_hours(timestamptz '2026-11-15 22:30:00+05:30', tests.tid('a')), true, 'C1: switched off again, the quiet hours are back');
select is(app.outreach_in_hours(tests.tid('a'), timestamptz '2026-11-15 22:30:00+05:30'), false, 'C2: and the calling hours');
select ok(not has_function_privilege('authenticated', 'app.testing_open_hours()', 'execute'), 'C3: nobody signed in can read or call the flag function');
select * from finish();
rollback;
