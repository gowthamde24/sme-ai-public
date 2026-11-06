-- The voice budget (migration 20261231280000): our own hard cap on Cartesia. A call reserves at most the per-call limit and at most what is left of the day; it gives back what it did not use,
-- once, and only its own reservation; the day's total can never pass the limit; the warnings show in ONE workspace (Owner, Admin), at 80 and 100 percent of the day and of the month.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

create function pg_temp.items(p_user text, p_tenant text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format($q$select coalesce(string_agg(x ->> 'summary_ref', ',' order by x ->> 'summary_ref'), '') from (
           select jsonb_build_object('summary_ref', x ->> 'ref') x from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'voice_credits') s$q$, tests.tid(p_tenant)));
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A: the numbers the owner set
select is((select daily_chars::text || '/' || per_call_chars || '/' || monthly_credits || '/' || period_day from public.voice_budget where engine = 'cartesia'), '20000/2000/100000/29', 'A1 20,000 a day, 2,000 a call, 100,000 a month from the 29th');
select is(pg_temp.q('a_owner', $$select count(*)::text from public.voice_budget$$), 'ERR:42501', 'A2 no client reads the budget table');
select is(pg_temp.q('a_owner', $$select app.voice_usage_add_script(current_date, 'cartesia', 10)::text$$), 'ERR:42501', 'A3 no client counts script renders in');
select is((select has_function_privilege('anon', 'public.voice_budget_reserve(text, integer, text)', 'execute'))::text, 'false', 'A4 anon cannot reserve');

-- B: reserve
select is(pg_temp.q('a_owner', $$select (public.voice_budget_reserve('cartesia', 5000, 'call') ->> 'granted')$$), '2000', 'B1 at most 2,000 for one call');
select is(pg_temp.q('a_owner', $$select (public.voice_budget_reserve('cartesia', 300, 'call') ->> 'granted')$$), '300', 'B2 less when less is asked');
select is(pg_temp.q('a_owner', $$select (public.voice_budget_reserve('cartesia', 10, 'nonsense'))::text$$), 'ERR:22023', 'B3 an unknown source');
select is(pg_temp.q('a_owner', $$select (public.voice_budget_reserve('elevenlabs', 10, 'call'))::text$$), 'ERR:22023', 'B4 an unknown engine');
select is((select chars::text from public.voice_usage_days where day = app.voice_day() and engine = 'cartesia' and source = 'call'), '2300', 'B5 reservations count as spent at once');

-- C: the day's hard limit
update public.voice_usage_days set chars = 19500 where day = app.voice_day() and engine = 'cartesia' and source = 'call';
select is(pg_temp.q('b_owner', $$select (public.voice_budget_reserve('cartesia', 2000, 'call') ->> 'granted')$$), '500', 'C1 only what is left of the day');
select is(pg_temp.q('b_owner', $$select (public.voice_budget_reserve('cartesia', 2000, 'call') ->> 'granted')$$), '0', 'C2 nothing past the limit (the call speaks with Sarvam)');
select is((select sum(chars)::text from public.voice_usage_days where day = app.voice_day() and engine = 'cartesia'), '20000', 'C3 the day never passes 20,000');

-- D: release
create temp table h as select (tests.scalar_as(tests.uid('b_owner'), $$select public.voice_budget_reserve('cartesia', 2000, 'talk') ->> 'hold'$$))::uuid as id;
update public.voice_usage_days set chars = 0 where day = app.voice_day() and engine = 'cartesia';
create temp table h2 as select (tests.scalar_as(tests.uid('b_owner'), $$select public.voice_budget_reserve('cartesia', 2000, 'call') ->> 'hold'$$))::uuid as id;
select is((select chars::text from public.voice_usage_days where day = app.voice_day() and engine = 'cartesia' and source = 'call'), '2000', 'D0 a fresh call holds 2,000');
select is(pg_temp.q('a_owner', format($$select public.voice_budget_release(%L, 10)::text$$, (select id from h2))), 'ERR:P0002', 'D1 only the principal that reserved can give back');
select is(pg_temp.q('b_owner', format($$select public.voice_budget_release(%L, 650) ->> 'used'$$, (select id from h2))), '650', 'D2 the call used 650');
select is((select chars::text from public.voice_usage_days where day = app.voice_day() and engine = 'cartesia' and source = 'call'), '650', 'D3 ... and 1,350 went back to the day');
select is(pg_temp.q('b_owner', format($$select public.voice_budget_release(%L, 0) ->> 'used'$$, (select id from h2))), '650', 'D4 giving back twice changes nothing');
select is((select chars::text from public.voice_usage_days where day = app.voice_day() and engine = 'cartesia' and source = 'call'), '650', 'D5 ... the day still counts 650');
create temp table h3 as select (tests.scalar_as(tests.uid('b_owner'), $$select public.voice_budget_reserve('cartesia', 100, 'call') ->> 'hold'$$))::uuid as id;
select is(pg_temp.q('b_owner', format($$select public.voice_budget_release(%L, 99999) ->> 'used'$$, (select id from h3))), '100', 'D6 a call cannot claim more than it was granted');

-- E: one principal holds at most 5 open reservations
select is(pg_temp.q('a_admin', $$select string_agg(public.voice_budget_reserve('cartesia', 1, 'call') ->> 'granted', ',') from generate_series(1, 6)$$), '1,1,1,1,1,0', 'E1 the sixth open reservation gets nothing');

-- F: the warnings, in the notice workspace only
update public.voice_usage_days set chars = 0 where engine = 'cartesia';
select is(pg_temp.items('a_owner', 'a'), '', 'F1 no notice workspace set: no warning anywhere');
update public.voice_budget set notice_tenant = tests.tid('a') where engine = 'cartesia';
select is(pg_temp.items('a_owner', 'a'), '', 'F2 nothing spent: no warning');
select app.voice_usage_add_script(app.voice_day(), 'cartesia', 16000);
select is(pg_temp.items('a_owner', 'a'), 'day_80', 'F3 16,000 today: the day at 80 percent');
select app.voice_usage_add_script(app.voice_day(), 'cartesia', 4000);
select is(pg_temp.items('a_admin', 'a'), 'day_100', 'F4 20,000: the day reached its limit (for an Admin too)');
select app.voice_usage_add_script(app.voice_period_start(app.voice_day(), 29::smallint), 'cartesia', 60000);
select is(pg_temp.items('a_owner', 'a'), 'day_100,month_80', 'F5 80,000 this period: the month at 80 percent (script renders count)');
select app.voice_usage_add_script(app.voice_period_start(app.voice_day(), 29::smallint), 'cartesia', 20000);
select is(pg_temp.items('a_owner', 'a'), 'day_100,month_100', 'F6 100,000: the month''s credits are used');
select is(pg_temp.items('a_sales', 'a'), '', 'F7 not for Sales');
select is(pg_temp.items('b_owner', 'b'), '', 'F8 not in any other workspace');
select app.voice_usage_add_script(app.voice_period_start(app.voice_day(), 29::smallint) - 1, 'cartesia', 500000);
select is(pg_temp.items('a_owner', 'a'), 'day_100,month_100', 'F9 the day before the period does not count (still exactly the same warnings)');

-- G: the period starts on the 29th (clamped to the month's length)
select is(app.voice_period_start('2026-11-29', 29::smallint)::text, '2026-11-29', 'G1 the 29th starts a period');
select is(app.voice_period_start('2026-11-28', 29::smallint)::text, '2026-10-29', 'G2 the 28th belongs to the period that began on 29 Oct');
select is(app.voice_period_start('2027-03-01', 29::smallint)::text, '2027-02-28', 'G3 February has no 29th in 2027: the period began on the 28th');
select is(app.voice_period_start('2026-12-05', 29::smallint)::text, '2026-11-29', 'G4 early December belongs to the period from 29 Nov');

select * from finish();
rollback;
