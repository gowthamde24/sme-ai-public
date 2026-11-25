-- Migration 20261231972000: the assistant's name is optional and has its own small function (Owner and Admin, no second factor).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal1') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.setname(p_user text, p_tenant text, p_name text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select coalesce(public.assistant_name_set(%L, %L), 'NULL')$q$, tests.tid(p_tenant), p_name)) $$;
create function pg_temp.nameof(p_tenant text) returns text language sql as $$ select coalesce((select a.assistant_name from public.assistant_settings a where a.tenant_id = tests.tid(p_tenant)), 'NULL') $$;

-- before the first full save there is no row: a name cannot be invented, and removing nothing is a no-op
select is(pg_temp.setname('a_owner', 'a', 'Vani'), 'ERR:SM801', 'A1 no setup yet: a name alone is refused (SM801), the row needs the whole setup');
select is(pg_temp.setname('a_owner', 'a', null), 'NULL', 'A2 removing a name that was never saved is a no-op');
select is((select count(*)::int from public.assistant_settings), 0, 'A3 nothing was written');

-- one full save (Owner, second factor) creates the row
select is(pg_temp.val('a_owner', format($q$select public.assistant_settings_save(%L, %L::jsonb)::text is not null$q$, tests.tid('a'), jsonb_build_object('name', 'Meera', 'voice_persona', 'female_warm', 'main_language', 'te',
  'auto_switch_language', true, 'allow_english_mixing', true, 'style', 'warm', 'speed', 1.0, 'may_answer_prices', true, 'may_book_visits', true, 'may_send_media', true, 'may_talk_dues', false,
  'max_discount_percent', 5, 'handover_owner_asked', true, 'handover_upset', true, 'handover_order_above_paise', 5000000, 'call_days', jsonb_build_array(1, 2, 3, 4, 5, 6), 'call_from_minute', 600,
  'call_to_minute', 1140)::text), 'aal2'), 'true', 'B1 the full save still works with a name');
select is(pg_temp.nameof('a'), 'Meera', 'B2 the name is Meera');

select is(pg_temp.setname('a_owner', 'a', 'Vani'), 'Vani', 'C1 the Owner renames, without a second factor (aal1)');
select is(pg_temp.nameof('a'), 'Vani', 'C2 stored');
select is(pg_temp.setname('a_admin', 'a', '  Asha  '), 'Asha', 'C3 an Admin renames; spaces are trimmed');
select is(pg_temp.setname('a_owner', 'a', ''), 'NULL', 'C4 a blank name removes it');
select is(pg_temp.nameof('a'), 'NULL', 'C5 the name is null: no name is made up');
select is(pg_temp.val('a_owner', format($q$select coalesce(public.assistant_name_get(%L), 'NULL')$q$, tests.tid('a'))), 'NULL', 'C7 any member reads "no name" as null');

select is(pg_temp.setname('a_owner', 'a', repeat('x', 25)), 'ERR:22023', 'D1 REFUSED: over 24 characters');
select is(pg_temp.setname('a_owner', 'a', '<b>x</b>'), 'ERR:22023', 'D2 REFUSED: markup characters');
select is(pg_temp.setname('a_sales', 'a', 'Z'), 'ERR:42501', 'D3 DENY: a Sales person');
select is(pg_temp.setname('a_viewer', 'a', 'Z'), 'ERR:42501', 'D4 DENY: a Viewer');
select is(pg_temp.setname('b_owner', 'a', 'Z'), 'ERR:42501', 'D5 DENY: another business''s Owner');
select is(pg_temp.setname('anon', 'a', 'Z'), 'ERR:42501', 'D6 DENY: anon');
select is(pg_temp.nameof('a'), 'NULL', 'D7 nothing refused changed the name');

select * from finish();
rollback;
