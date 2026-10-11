-- Job AS: the weekly AI figure, public.ai_usage_week (migration 20261108090000): a percentage only, never an amount. The week is Monday to Sunday (India time); the allowance of a week is an even share
-- of the month's allowance (monthly x 7 / the days of the billing month). The clock is frozen the way pgTAP 73 and 75 do it (app.agent_utc_today is replaced through the REAL day rule
-- app.agent_cost_day), so the test is the same at any hour of the real day; it pins an ordinary day, the last second of a week and the first second of the next.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.plan_ai_allowances set daily_paise = 1000, monthly_paise = 3000 where plan = 'free_trial';

create function pg_temp.sc(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(p_uid, p_sql);
exception when others then
  return 'ERR:' || sqlstate;
end $$;
create function pg_temp.at(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select app.agent_cost_day(timestamptz %L) $b$', p_instant::text);
end $fn$;
create function pg_temp.week(p_user text default 'a_owner') returns text language sql as $$ select pg_temp.sc(tests.uid(p_user), format('select public.ai_usage_week(%L)', tests.tid('a'))) $$;
create function pg_temp.pct(p_user text default 'a_owner') returns text language sql as $$ select (pg_temp.week(p_user)::jsonb ->> 'week_percent') $$;
-- a settled call of p_micros on cost day p_day, written straight into the ledger as the trusted role
create function pg_temp.spend(p_key text, p_day date, p_micros bigint) returns void language sql as $$
  insert into public.agent_cost_reservations (id, tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, settled_micros, args_sha256, settled_at, outcome)
  values (gen_random_uuid(), tests.tid('a'), tests.rid('a_run_sales'), p_key, p_day, 1, 1, p_micros, p_micros, repeat('c', 64), now(), 'used') $$;
-- the week's allowance in micros, from the database's own month window
create function pg_temp.week_allowance() returns numeric language sql as $$
  select app.ai_monthly_allowance(tests.tid('a')) * 7 / greatest(1, (select win_end - win_start from app.ai_month_window(tests.tid('a')))) $$;

-- Wednesday 7 October 2026, 14:00 India time
select pg_temp.at('2026-10-07 14:00:00+05:30');
select is(pg_temp.week('a_sales'), 'ERR:42501', 'DENY: Sales cannot read it');
select is(pg_temp.week('a_viewer'), 'ERR:42501', 'DENY: a Viewer cannot read it');
select is(pg_temp.week('b_owner'), 'ERR:42501', 'DENY: another business cannot read it');
select is(tests.sqlstate_as(null, format('select public.ai_usage_week(%L)', tests.tid('a'))), '42501', 'DENY: anon cannot');
select is(pg_temp.pct('a_admin'), '0', 'an Admin can read it: nothing spent, 0 percent');
select is(pg_temp.pct(), '0', 'the Owner too');
select is((pg_temp.week()::jsonb ->> 'resets_at_week')::timestamptz, '2026-10-12 00:00:00+05:30'::timestamptz, 'the week resets at Monday 00:00 India time (Monday 12 October)');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.week()::jsonb) k), array['resets_at_week', 'week_percent'], 'the answer holds a percentage and a reset time: no amount, no count');
select ok(pg_temp.week_allowance() > 0, 'the weekly allowance is a share of the month''s');
-- half of the weekly allowance spent on Monday the 5th (inside the week)
select pg_temp.spend('w1', date '2026-10-05', (pg_temp.week_allowance() / 2)::bigint);
select is(pg_temp.pct()::int, floor((select sum(settled_micros) from public.agent_cost_reservations where step_key = 'w1') * 100 / pg_temp.week_allowance())::int, 'half the allowance spent this week is about half');
select ok(pg_temp.pct()::int between 49 and 50, '...49 or 50 percent (rounded down)');
-- a spend on Sunday the 4th belongs to the week before
select pg_temp.spend('w0', date '2026-10-04', (pg_temp.week_allowance())::bigint);
select ok(pg_temp.pct()::int between 49 and 50, 'the Sunday before is not counted');
-- a spend today counts too, and the figure is capped at 100
select pg_temp.spend('w2', date '2026-10-07', (pg_temp.week_allowance() * 3)::bigint);
select is(pg_temp.pct(), '100', 'overspending is shown as 100, not more');
-- another business sees none of it
select is((select count(*) from public.agent_cost_reservations where tenant_id = tests.tid('b') and step_key in ('w0', 'w1', 'w2')), 0::bigint, 'the spend is the business''s own');

-- the last second of the week: Sunday 11 October 23:59:59 India time is still the week of the 5th
select pg_temp.at('2026-10-11 23:59:59+05:30');
select is((pg_temp.week()::jsonb ->> 'resets_at_week')::timestamptz, '2026-10-12 00:00:00+05:30'::timestamptz, 'SUNDAY NIGHT 23:59:59: the week still resets at midnight');
select is(pg_temp.pct(), '100', '...and still counts the week''s spend');
-- the first second of the next week: Monday 12 October 00:00:01 India time
select pg_temp.at('2026-10-12 00:00:01+05:30');
select is((pg_temp.week()::jsonb ->> 'resets_at_week')::timestamptz, '2026-10-19 00:00:00+05:30'::timestamptz, 'MONDAY 00:00:01: a new week, the next reset is the 19th');
select is(pg_temp.pct(), '0', '...and it starts at 0 percent');
-- the same instant by the UTC clock is still Sunday (18:30:01 UTC): the week follows India
select is((timestamptz '2026-10-12 00:00:01+05:30' at time zone 'UTC')::date, date '2026-10-11', 'the UTC date of that instant is still Sunday: the week follows the India date');

select * from finish();
rollback;
