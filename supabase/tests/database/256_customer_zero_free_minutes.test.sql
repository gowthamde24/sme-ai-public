-- Customer Zero's free minutes (migration 20261231986200; owner and planner decision, 19 Nov 2026): one number on ONE business (set by the operator, never by a client or a migration) replaces the plan's call minutes, the month is
-- the India calendar month, the existing meter and ledger count against it, and at the limit the line lookups tell the call path (the shop's own phone for an incoming call, the plain sentence for an outgoing one).
begin;
select no_plan();
select tests.seed_two_tenants();
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.meter(p_key text) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.billing_check_usage(%L, 'call_minutes') -> 'meter' ->> %L)$q$, tests.tid('a'), p_key))
$$;
create function pg_temp.line(p_path text) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.phone_line_for_tenant(%L, 'plivo') %s)$q$, tests.tid('a'), p_path))
$$;
update public.tenants set plan = 'early_access' where id = tests.tid('a');
insert into public.phone_numbers (id, tenant_id, number, provider, inbound_on) values (tests.rid('line'), tests.tid('a'), '+918044440001', 'plivo', true);
select app.operator_register_scheduler('Outsider@test.local');

-- A. the number: the plan's until the operator sets one; only the operator; only that business
select is(pg_temp.meter('allowance'), '60', 'A1 the plan''s own number: 60 minutes');
select is(pg_temp.val('a_owner', format($q$select app.operator_set_call_minutes(%L, 500)::text$q$, tests.tid('a'))), 'ERR:42501', 'A2 a signed-in person cannot set it');
select is(pg_temp.val('outsider', format($q$select app.operator_set_call_minutes(%L, 500)::text$q$, tests.tid('a'))), 'ERR:42501', 'A3 not even the scheduler account');
select is((select call_minutes_override from public.tenants where id = tests.tid('a')), null, 'A4 nothing changed');
select is((select app.operator_set_call_minutes(tests.tid('a'), 500))::text, '', 'A5 the operator sets 500 for this business');
select is(pg_temp.meter('allowance'), '500', 'A6 the meter says 500 minutes (the plan''s 60 is replaced)');
select is(coalesce(app.billing_allowance(tests.tid('b'), 'call_minutes') = 500 * 60, false), false, 'A7 another business is untouched');
select is((select call_minutes_override from public.tenants where id = tests.tid('b')), null, 'A8 and carries no number');
select throws_ok(format($q$select app.operator_set_call_minutes(%L, 100001)$q$, tests.tid('a')), '23514', null, 'A9 a number out of range is refused');
select throws_ok($q$select app.operator_set_call_minutes(gen_random_uuid(), 5)$q$, '23503', null, 'A10 an unknown business is refused');
select app.operator_set_call_minutes(tests.tid('a'), null);
select is(pg_temp.meter('allowance'), '60', 'A11 taking it away goes back to the plan''s number');
select app.operator_set_call_minutes(tests.tid('a'), 500);

-- B. the month is the India calendar month; the existing ledger counts against it
select is((select o_start from app.billing_period(tests.tid('a'))), (app.agent_utc_today() - (extract(day from app.agent_utc_today())::integer - 1)), 'B1 the period starts on the 1st (India date)');
select ok((select o_end = (o_start + interval '1 month')::date from app.billing_period(tests.tid('a'))), 'B2 and ends on the 1st of the next month');
select is((select o_start from app.billing_period(tests.tid('b'))), (select win_start from app.ai_month_window(tests.tid('b'))), 'B3 another business keeps the window anchored on its own start day');
insert into public.billing_usage_events (tenant_id, kind, ref_id, units, at)
select tests.tid('a'), 'call_minutes', gen_random_uuid(), 600, ((p.o_start)::timestamp + interval '1 minute') at time zone 'Asia/Kolkata' from app.billing_period(tests.tid('a')) p;
insert into public.billing_usage_events (tenant_id, kind, ref_id, units, at)
select tests.tid('a'), 'call_minutes', gen_random_uuid(), 3600, ((p.o_start - 1)::timestamp + interval '12 hours') at time zone 'Asia/Kolkata' from app.billing_period(tests.tid('a')) p;
select is(pg_temp.meter('used'), '10.0', 'B4 a call of this month counts (10 minutes) and one of last month does not');

-- C. the limit, while the platform switch is on: the call path is told, for this business only
select app.operator_set_billing_enforced(true);
select is(pg_temp.line('->> ''billing_blocked'''), 'false', 'C1 500 minutes, 10 used: not blocked');
select is(pg_temp.line('-> ''free_minutes'' ->> ''minutes'''), '500', 'C2 the line lookup carries the number');
select is(pg_temp.line('-> ''free_minutes'' ->> ''restarts_on'''), (select o_end::text from app.billing_period(tests.tid('a'))), 'C3 and the day the minutes start again (the 1st of next month)');
select is(pg_temp.line('->> ''forward_to'''), null, 'C4 nothing to forward while the minutes are not used up');
do $$ begin perform app.billing_record(tests.tid('a'), 'call_minutes', gen_random_uuid(), 29400); end $$;
select is(pg_temp.meter('state'), 'stopped', 'C5 500 minutes used: the meter says stopped');
select is(pg_temp.line('->> ''billing_blocked'''), 'true', 'C6 the outbound path is told');
select is(pg_temp.val('outsider', $q$select public.phone_line_find('+918044440001') ->> 'billing_blocked'$q$), 'true', 'C7 the inbound path is told too');
select is(pg_temp.line('->> ''forward_to'''), null, 'C8 no business phone on the profile yet: nothing to ring (the caller is hung up on, as before)');
insert into workspace.profiles (tenant_id, phone) values (tests.tid('a'), '98480 12345') on conflict (tenant_id) do update set phone = excluded.phone;
select is(pg_temp.line('->> ''forward_to'''), '919848012345', 'C9 the business phone of the profile, as digits with the country code');
select is(pg_temp.val('outsider', $q$select public.phone_line_find('+918044440001') ->> 'forward_to'$q$), '919848012345', 'C10 the incoming call path gets it');
select is(pg_temp.val('outsider', $q$select public.phone_line_find('+918044440001') -> 'free_minutes' ->> 'minutes'$q$), '500', 'C11 with the number');
update workspace.profiles set phone = '040 2345 6789' where tenant_id = tests.tid('a');
select is(pg_temp.line('->> ''forward_to'''), null, 'C12 a landline without a country code is not guessed');
update workspace.profiles set phone = '98480 12345' where tenant_id = tests.tid('a');
select app.operator_set_call_minutes(tests.tid('a'), 1000);
select is(pg_temp.line('->> ''billing_blocked'''), 'false', 'C13 the operator raises the number: open again');
select is(pg_temp.line('->> ''forward_to'''), null, 'C14 and nothing is forwarded');

-- D. every other business is unchanged: used up means blocked and hung up on, never forwarded
select app.operator_set_call_minutes(tests.tid('a'), null);
select is(pg_temp.line('->> ''billing_blocked'''), 'true', 'D1 on the plan''s 60 minutes it is used up (500 used)');
select is(pg_temp.line('->> ''forward_to'''), null, 'D2 a business without its own number is never forwarded');
select is(pg_temp.line('->> ''free_minutes'''), null, 'D3 and carries no free-minutes note');

-- E. the number counts only while the platform switch is on, like the plan's own minutes
select app.operator_set_call_minutes(tests.tid('a'), 500);
select app.operator_set_billing_enforced(false);
select is(pg_temp.line('->> ''billing_blocked'''), 'false', 'E1 switch off: the meter stops nothing');
select is(pg_temp.line('->> ''forward_to'''), null, 'E2 and nothing is forwarded');

-- F. no client can read around it: the column is the operator's
select is(pg_temp.val('a_owner', format($q$update public.tenants set call_minutes_override = 5000 where id = %L$q$, tests.tid('a'))), 'ERR:42501', 'F1 a client cannot write the column');
select is(has_function_privilege('authenticated', 'app.operator_set_call_minutes(uuid, integer)', 'execute'), false, 'F2 the operator function is closed to clients');
select is(has_function_privilege('authenticated', 'app.free_minutes_forward(uuid)', 'execute') or has_function_privilege('authenticated', 'app.free_minutes_json(uuid)', 'execute') or has_function_privilege('authenticated', 'app.billing_plan_row(uuid)', 'execute'), false, 'F3 so are the helpers');

select * from finish();
rollback;
