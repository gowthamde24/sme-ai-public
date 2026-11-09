-- The morning stand-up as text (migration 20261231400000): who reads it, who writes it, the once-a-day rule for the worker, the 3-a-day limit by hand, which workspaces are due (open today, none made yet, the language).
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.save(p_user text, p_tenant text, p_text text, p_lang text default 'en', p_date date default (now() at time zone 'Asia/Kolkata')::date) returns text language plpgsql as $$
begin
  return pg_temp.q(p_user, format($q$select public.ai_team_standup_save(%L, %L, %L, %L, %L::jsonb, '[{"key": "now.waiting", "value": 2}]'::jsonb, %L)::text$q$,
                                  tests.tid(p_tenant), p_date, p_lang, p_text, jsonb_build_array(jsonb_build_object('text', p_text, 'source', 'now.needs_owner'))::text, p_lang <> 'en'));
end $$;
create function pg_temp.get(p_user text, p_tenant text, p_lang text default 'en') returns text language plpgsql as $$
begin
  return pg_temp.q(p_user, format($q$select coalesce(public.ai_team_standup_get(%L, (now() at time zone 'Asia/Kolkata')::date, %L)::text, 'none')$q$, tests.tid(p_tenant), p_lang));
end $$;
create function pg_temp.due(p_user text) returns text language plpgsql as $$
begin
  return pg_temp.q(p_user, $q$select coalesce((select string_agg(x ->> 'tenant_id' || ':' || (x ->> 'language'), ',' order by x ->> 'tenant_id') from jsonb_array_elements(public.scheduler_standup_due()) x), '')$q$);
end $$;

-- A: nothing yet; who may read
select is(pg_temp.get('a_owner', 'a'), 'none', 'A1 no stand-up yet: null');
select is(pg_temp.get('a_viewer', 'a'), 'ERR:42501', 'A2 a Viewer cannot read it');
select is(pg_temp.get('a_sales', 'a'), 'ERR:42501', 'A3 nor Sales (the stand-up is for the Owner and Admin)');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'A4 nor another workspace''s Owner');

-- B: which workspaces are due. Tenant a: an assistant in Telugu, open all day; tenant b: an assistant in Tamil (so English), closed all week
do $$
declare
  r record;
begin
  for r in select * from tests.tenant_table_registry where table_name = 'assistant_settings' loop
    execute format(r.insert_sql, tests.tid('a'), gen_random_uuid(), tests.rid('a_company'), tests.rid('a_contact'), tests.pool_uid(1));
    execute format(r.insert_sql, tests.tid('b'), gen_random_uuid(), tests.rid('b_company'), tests.rid('b_contact'), tests.pool_uid(1));
  end loop;
end $$;
set local session_replication_role = replica;
update public.assistant_settings set main_language = 'ta' where tenant_id = tests.tid('b');
reset session_replication_role;
insert into public.store_settings (tenant_id, weekly_hours)
  select tests.tid('a'), jsonb_build_object('mon', '{"open": "00:00", "close": "23:59"}'::jsonb, 'tue', '{"open": "00:00", "close": "23:59"}'::jsonb, 'wed', '{"open": "00:00", "close": "23:59"}'::jsonb,
                                            'thu', '{"open": "00:00", "close": "23:59"}'::jsonb, 'fri', '{"open": "00:00", "close": "23:59"}'::jsonb, 'sat', '{"open": "00:00", "close": "23:59"}'::jsonb,
                                            'sun', '{"open": "00:00", "close": "23:59"}'::jsonb);
insert into public.store_settings (tenant_id, weekly_hours)
  select tests.tid('b'), jsonb_build_object('mon', null, 'tue', null, 'wed', null, 'thu', null, 'fri', null, 'sat', null, 'sun', null);
select is(pg_temp.due('outsider'), tests.tid('a')::text || ':te', 'B1 due: the workspace that is open (in its own language); the one closed all week is not');
select is(pg_temp.due('a_owner'), 'ERR:42501', 'B2 a member cannot ask what is due');
set local session_replication_role = replica;
update public.assistant_settings set main_language = 'ta' where tenant_id = tests.tid('a');
reset session_replication_role;
select is(pg_temp.due('outsider'), tests.tid('a')::text || ':en', 'B3 a language without a stand-up (Tamil) is written in English');
set local session_replication_role = replica;
update public.assistant_settings set main_language = 'te' where tenant_id = tests.tid('a');
reset session_replication_role;

-- C: the worker writes it once
select is(pg_temp.save('a_owner', 'a', 'x', 'en', current_date + 5), 'ERR:22023', 'C0 only today can be written');
select is((pg_temp.save('outsider', 'a', 'Nothing is waiting for you.', 'te') :: jsonb) ->> 'by', 'schedule', 'C1 the worker makes today''s stand-up (by = schedule)');
select is(pg_temp.due('outsider'), '', 'C2 and the workspace is no longer due');
select is((pg_temp.save('outsider', 'a', 'A different text', 'te') :: jsonb) ->> 'text', 'Nothing is waiting for you.', 'C3 a second save by the worker keeps the first (once a day)');
select is((pg_temp.get('a_owner', 'a', 'te') :: jsonb) ->> 'generated_at' is not null, true, 'C4 the Owner reads it, with the time it was made');
select is((pg_temp.get('a_admin', 'a', 'te') :: jsonb) ->> 'draft', 'true', 'C5 the Admin reads it too; a Telugu text is marked draft');
select is((pg_temp.get('a_owner', 'a', 'te') :: jsonb) ->> 'left_today', '3', 'C6 three hand-made ones are left today');
select is(pg_temp.get('a_owner', 'a', 'en'), 'none', 'C7 another language is a different row');

-- D: by hand: Owner and Admin, 3 a day, identical text does not count
select is(pg_temp.save('a_sales', 'a', 'x'), 'ERR:42501', 'D1 Sales cannot make it');
select is(pg_temp.save('a_viewer', 'a', 'x'), 'ERR:42501', 'D2 nor a Viewer');
select is(pg_temp.save('b_owner', 'a', 'x'), 'ERR:42501', 'D3 nor another workspace');
select is(pg_temp.save('a_owner', 'a', 'Hand' || chr(8238) || 'x', 'hi'), 'ERR:23514', 'D3b text with a hidden direction mark is refused by the table (clean text) and uses none of the three');
select is((pg_temp.save('a_owner', 'a', 'Hand one') :: jsonb) ->> 'by', 'owner', 'D4 the Owner makes it by hand');
select is((pg_temp.save('a_owner', 'a', 'Hand one') :: jsonb) ->> 'left_today', '2', 'D5 the same text again does not count (and changes nothing)');
select is((pg_temp.save('a_admin', 'a', 'Hand two') :: jsonb) ->> 'left_today', '1', 'D6 an Admin may too');
select is((pg_temp.save('a_owner', 'a', 'Hand three', 'te') :: jsonb) ->> 'left_today', '0', 'D7 the third (in another language) uses the last one: the limit is per workspace');
select is(((pg_temp.save('a_owner', 'a', 'Hand four') :: jsonb) ->> 'reason') || ':' || (((pg_temp.save('a_owner', 'a', 'Hand four') :: jsonb) ->> 'retry_after_s')::integer > 0)::text, 'standup_limit:true', 'D8 the fourth is refused, with the seconds until India midnight');
select is((pg_temp.get('a_owner', 'a', 'en') :: jsonb) ->> 'text', 'Hand two', 'D9 and nothing was stored by the refused one');

-- E: the table itself: members read it (Owner, Admin), nobody writes it directly
select is(pg_temp.q('a_owner', $q$select count(*)::text from public.ai_team_standups$q$), '2', 'E1 the Owner reads its workspace''s rows only (not the other workspace''s)');
select is(pg_temp.q('a_sales', $q$select count(*)::text from public.ai_team_standups$q$), '0', 'E2 Sales sees no rows');
select is(pg_temp.q('a_owner', format($q$insert into public.ai_team_standups (tenant_id, day, language, body, lines, numbers, draft, by) values (%L, current_date - 3, 'en', 'x', '[{"text": "x", "source": "s"}]'::jsonb, '[]'::jsonb, false, 'owner')$q$, tests.tid('a'))), 'ERR:42501', 'E3 nobody writes the table directly');

select * from finish();
rollback;
