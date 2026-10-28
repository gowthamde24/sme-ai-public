-- Job DV follow-up: the browser voice's daily caps. A catalog  B reads and roles  C adding and bounds  D the day
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.get(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.browser_voice_usage_get(%L)::text', tests.tid(p_tenant))) $$;
create function pg_temp.add(p_user text, p_sec int, p_chars int, p_sessions int default 0, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.browser_voice_usage_add(%L, %s, %s, %s)::text', tests.tid(p_tenant), p_sec, p_chars, p_sessions)) $$;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('browser_voice_usage_get', 'browser_voice_usage_add')
  and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 2::bigint, 'A1: two security-definer functions, authenticated only, search_path fixed');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and table_name = 'browser_voice_days' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A2: the table is closed to every client role');

select is((pg_temp.get('a_viewer')::jsonb - 'day'), '{"seconds": 0, "tts_chars": 0, "sessions": 0}'::jsonb, 'B1: nothing used yet; every member reads it');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'B2: another business reads nothing of ours');
select is(pg_temp.get('anon'), 'ERR:42501', 'B3: anon neither');
select is(pg_temp.add('a_viewer', 10, 10), 'ERR:42501', 'B4: a viewer cannot add');
select is(pg_temp.add('b_owner', 10, 10, 0, 'a'), 'ERR:42501', 'B5: nor another business''s Owner');
select is(pg_temp.add('anon', 10, 10), 'ERR:42501', 'B6: nor anon');

select is((pg_temp.add('a_sales', 20, 100, 1)::jsonb - 'day'), '{"seconds": 20, "tts_chars": 100, "sessions": 1}'::jsonb, 'C1: Sales (who may talk) adds');
select is((pg_temp.add('a_owner', 5, 50)::jsonb - 'day'), '{"seconds": 25, "tts_chars": 150, "sessions": 1}'::jsonb, 'C2: the Owner adds to the same day');
select is((pg_temp.add('a_admin', 0, 0)::jsonb - 'day'), '{"seconds": 25, "tts_chars": 150, "sessions": 1}'::jsonb, 'C3: adding nothing is fine');
select is(pg_temp.add('a_owner', 601, 0), 'ERR:22023', 'C4: one call cannot report more than 600 seconds');
select is(pg_temp.add('a_owner', 0, 6001), 'ERR:22023', 'C5: nor more than 6,000 characters');
select is(pg_temp.add('a_owner', 0, 0, 2), 'ERR:22023', 'C6: nor two sessions');
select is(pg_temp.add('a_owner', -1, 0), 'ERR:22023', 'C7: nor a negative number');
select is(pg_temp.sc('a_owner', format('select public.browser_voice_usage_add(%L, null, 1, 0)::text', tests.tid('a'))), 'ERR:22023', 'C8: nor null');
select is((pg_temp.get('b_owner', 'b')::jsonb - 'day'), '{"seconds": 0, "tts_chars": 0, "sessions": 0}'::jsonb, 'C9: the other business used nothing');

select is((select count(*) from workspace.browser_voice_days where workspace_id = tests.tid('a')), 1::bigint, 'D1: one row for the day');
select is((select day from workspace.browser_voice_days where workspace_id = tests.tid('a')), (now() at time zone 'Asia/Kolkata')::date, 'D2: the day is India''s, decided by the database');
insert into workspace.browser_voice_days (workspace_id, day, seconds) values (tests.tid('a'), app.browser_voice_today() - 60, 99), (tests.tid('a'), app.browser_voice_today() - 10, 5);
select pg_temp.add('a_owner', 1, 1);
select is((select count(*) from workspace.browser_voice_days where workspace_id = tests.tid('a')), 2::bigint, 'D3: a row older than 40 days is removed on the next add, a recent one stays');

select * from finish();
rollback;
