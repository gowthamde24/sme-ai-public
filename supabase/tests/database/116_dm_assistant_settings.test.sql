-- Job DM (C1 part; migration 20261129090300): the AI ASSISTANT'S SETTINGS per workspace (Settings > AI assistant).
--   A who may read and save   B what is refused   C the round trip   D one setting for calls and voice replies   E the voices of the personas   F guards and doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.base() returns jsonb language sql as $$
  select jsonb_build_object('name', 'Vani', 'voice_persona', 'female_warm', 'main_language', 'te', 'auto_switch_language', true, 'allow_english_mixing', true, 'style', 'warm', 'speed', 1.0,
    'may_answer_prices', true, 'may_book_visits', true, 'may_send_media', true, 'may_talk_dues', false, 'max_discount_percent', 5, 'handover_owner_asked', true, 'handover_upset', true,
    'handover_order_above_paise', 5000000, 'call_days', jsonb_build_array(1, 2, 3, 4, 5, 6), 'call_from_minute', 540, 'call_to_minute', 1140) $$;
create function pg_temp.edu() returns jsonb language sql as $$
  select pg_temp.base() || '{"may_talk_dues": false, "may_answer_prices": false, "max_discount_percent": 0, "handover_order_above_paise": null}'::jsonb $$;
create function pg_temp.save(p_user text, p_tenant text, p_settings jsonb, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.assistant_settings_save(%L, %L::jsonb)::text$q$, tests.tid(p_tenant), p_settings::text), p_aal) $$;
create function pg_temp.get(p_user text, p_tenant text, p_key text default null) returns text language sql as $$
  select case when r like 'ERR:%' or p_key is null then r else (r::jsonb ->> p_key) end from (select pg_temp.val(p_user, format($q$select public.assistant_settings_get(%L)::text$q$, tests.tid(p_tenant))) r) x $$;
create function pg_temp.field(p_tenant text, p_key text) returns text language sql as $$
  select (app.assistant_json(a)) ->> p_key from public.assistant_settings a where a.tenant_id = tests.tid(p_tenant) $$;

-- ============================================================================ A. who may read and save
select is(pg_temp.get('a_owner', 'a', 'saved'), 'false', 'A1 before the first save: nothing is stored (the API shows the defaults of the business type)');
select is(pg_temp.get('a_owner', 'a', 'business_type'), 'textiles', 'A2 the business type comes from the workspace''s pack (the default pack is textiles)');
select is(pg_temp.get('a_owner', 'a', 'business_name'), (select name from public.tenants where id = tests.tid('a')), 'A3 ...and the business name from the workspace');
select is(pg_temp.get('a_admin', 'a', 'saved'), 'false', 'A4 an Admin reads');
select is(pg_temp.get('a_sales', 'a'), 'ERR:42501', 'A5 DENY: a Sales person');
select is(pg_temp.get('a_viewer', 'a'), 'ERR:42501', 'A6 DENY: a Viewer');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'A7 DENY: another business''s Owner');
select is(pg_temp.get('anon', 'a'), 'ERR:42501', 'A8 DENY: anon');
select is(pg_temp.save('a_admin', 'a', pg_temp.base()), 'ERR:42501', 'A9 DENY: an Admin may read but not save (the Owner''s)');
select is(pg_temp.save('a_sales', 'a', pg_temp.base()), 'ERR:42501', 'A10 DENY: a Sales person');
select is(pg_temp.save('b_owner', 'a', pg_temp.base()), 'ERR:42501', 'A11 DENY: another business''s Owner');
select is(pg_temp.save('anon', 'a', pg_temp.base()), 'ERR:42501', 'A12 DENY: anon');
select is(pg_temp.save('a_owner', 'a', pg_temp.base(), 'aal1'), 'ERR:SM306', 'A13 a second factor is needed');
select is((select count(*)::int from public.assistant_settings), 0, 'A14 nothing refused wrote a row');
select is(pg_temp.save('a_owner', 'a', pg_temp.base()) is not null and pg_temp.field('a', 'name') = 'Vani', true, 'A15 the Owner saves (with a second factor)');

-- ============================================================================ B. what is refused (each one on its own; nothing is changed)
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"extra": 1}'), 'ERR:22023', 'B1 an unknown key');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() - 'style'), 'ERR:22023', 'B2 a missing key');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"name": ""}'), 'ERR:22023', 'B3 an empty name');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || jsonb_build_object('name', repeat('x', 25))), 'ERR:22023', 'B4 a name of at most 24 characters');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"name": "<b>Vani</b>"}'), 'ERR:22023', 'B5 a name carries no markup');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"name": "Vani {name}"}'), 'ERR:22023', 'B6 ...no braces');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"name": "a@b"}'), 'ERR:22023', 'B7 ...no at-sign');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || jsonb_build_object('name', 'a' || chr(8238) || 'b')), 'ERR:22023', 'B8 ...no direction override');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"speed": 1.3}'), 'ERR:22023', 'B9 speed at most 1.25');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"speed": 0.7}'), 'ERR:22023', 'B10 speed at least 0.75');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"max_discount_percent": 51}'), 'ERR:22023', 'B11 a discount of at most 50 percent');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"max_discount_percent": -1}'), 'ERR:22023', 'B12 ...not below 0');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"call_days": []}'), 'ERR:22023', 'B13 at least one calling day');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"call_days": [8]}'), 'ERR:22023', 'B14 days 1 to 7');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"call_days": "mon"}'), 'ERR:22023', 'B15 days are a list');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"call_from_minute": 480}'), 'ERR:22023', 'B16 no calls before 09:00');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"call_to_minute": 1275}'), 'ERR:22023', 'B17 ...or after 21:00');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"call_from_minute": 605}'), 'ERR:22023', 'B18 minutes in steps of 15');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"call_from_minute": 1140, "call_to_minute": 1140}'), 'ERR:22023', 'B19 the hours must end after they begin');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"voice_persona": "robot"}'), 'ERR:22023', 'B20 a persona from the list');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"main_language": "fr"}'), 'ERR:22023', 'B21 a language from the list');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"style": "angry"}'), 'ERR:22023', 'B22 a style from the list');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"handover_order_above_paise": 0}'), 'ERR:22023', 'B23 an order amount above 0, or null for off');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"auto_switch_language": "yes"}'), 'ERR:22023', 'B24 a switch is true or false');
select is(pg_temp.save('a_owner', 'a', '[1]'::jsonb), 'ERR:22023', 'B25 an object');
select is(pg_temp.save('a_owner', 'a', null), 'ERR:22023', 'B26 not null');
select is(pg_temp.field('a', 'name'), 'Vani', 'B27 none of those changed the stored name');

-- ============================================================================ C. the round trip
select is(pg_temp.get('a_owner', 'a', 'saved'), 'true', 'C1 saved');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"name": "  Priya  ", "call_days": [3, 1, 3, 2], "speed": 1.1, "handover_order_above_paise": null, "max_discount_percent": 7}')::jsonb -> 'settings' ->> 'name', 'Priya', 'C2 a second save updates it; the name is trimmed');
select is(pg_temp.field('a', 'call_days'), '[1, 2, 3]', 'C3 the calling days are kept once each, in order');
select is(pg_temp.field('a', 'speed') || '/' || pg_temp.field('a', 'max_discount_percent'), '1.10/7', 'C4 numbers as saved');
select is(pg_temp.field('a', 'handover_order_above_paise'), null, 'C5 an order rule that is off is null');
select is((select count(*)::int from public.assistant_settings where tenant_id = tests.tid('a')), 1, 'C6 one row per workspace');
select is(pg_temp.get('a_admin', 'a', 'updated_at') is not null, true, 'C7 an Admin sees when it was saved');
select is((select updated_by = tests.uid('a_owner') from public.assistant_settings where tenant_id = tests.tid('a')), true, 'C8 who saved it');
select is((select count(*)::int from public.audit_events where entity_type = 'assistant_settings' and tenant_id = tests.tid('a')) >= 2, true, 'C9 every save is audited');
select is(pg_temp.get('b_owner', 'b', 'saved'), 'false', 'C10 the other business has nothing');

-- ============================================================================ D. one setting for calls and voice replies
-- b is an education workspace (it has voice notes); a is textiles (it has not)
insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select tests.tid('b'), 'education', max(version), 'operator' from packs.pack_versions where code = 'education'
  on conflict (tenant_id) do update set pack_code = excluded.pack_code, pack_version = excluded.pack_version;
insert into public.voice_settings (tenant_id, enabled, speed, call_from_hour, call_to_hour) values (tests.tid('b'), true, 1.00, 9, 21);
select is(pg_temp.get('b_owner', 'b', 'voice_notes'), 'true', 'D1 the education workspace has voice notes');
select is(pg_temp.get('b_owner', 'b', 'business_type'), 'education', 'D2 ...and says what business it is');
select is(pg_temp.save('b_owner', 'b', pg_temp.edu() || '{"speed": 0.9, "call_from_minute": 630, "call_to_minute": 1185, "voice_persona": "male_calm", "main_language": "hi"}') is not null, true, 'D3 the Owner of b saves');
select is((select speed::text || '/' || call_from_hour || '/' || call_to_hour from public.voice_settings where tenant_id = tests.tid('b')), '0.90/10/20', 'D4 the voice notes follow: speed 0.9, hours 10 and 20 (10:30 rounds down, 19:45 rounds up)');
select is((select count(*)::int from public.voice_choices where tenant_id = tests.tid('b')), 6, 'D5 the persona''s voice is chosen for every language that has one');
select is((select voice_code from public.voice_choices where tenant_id = tests.tid('b') and language = 'te'), 'fake-te', 'D6 ...the one the operator mapped');
select is((select enabled from public.voice_settings where tenant_id = tests.tid('b')), true, 'D7 the switch of the voice notes is not touched');
select is((select count(*)::int from public.voice_settings where tenant_id = tests.tid('a')), 0, 'D8 a business without voice notes gets no voice settings made by a save');
select is((select count(*)::int from public.voice_choices where tenant_id = tests.tid('a')), 0, 'D9 ...and no voice choices');
select is(left(pg_temp.save('b_owner', 'b', pg_temp.edu() || '{"call_from_minute": 1245, "call_to_minute": 1260}'), 12), '{"saved": tr', 'D10 the latest hours (20:45 to 21:00) can be saved');
select is((select call_from_hour || '/' || call_to_hour from public.voice_settings where tenant_id = tests.tid('b')), '20/21', 'D11 ...and stay inside the voice notes'' own 9 to 21 rule');

-- ============================================================================ D2. the school rule (owner, 25 Oct 2026)
select is(pg_temp.get('b_owner', 'b', 'locked'), '{"may_talk_dues": false, "may_answer_prices": false, "max_discount_percent": 0, "handover_order_above_paise": null}', 'D11 a school''s answer says which fields are locked');
select is(pg_temp.get('a_owner', 'a', 'locked'), '{}', 'D12 a textile shop has none locked');
select is(pg_temp.save('b_owner', 'b', pg_temp.edu() || '{"may_talk_dues": true}'), 'ERR:22023', 'D13 a school''s assistant cannot be allowed to talk about dues');
select is(pg_temp.save('b_owner', 'b', pg_temp.edu() || '{"may_answer_prices": true}'), 'ERR:22023', 'D14 ...nor about prices (fees)');
select is(pg_temp.save('b_owner', 'b', pg_temp.edu() || '{"max_discount_percent": 1}'), 'ERR:22023', 'D15 ...nor offer a discount');
select is(pg_temp.save('b_owner', 'b', pg_temp.edu() || '{"handover_order_above_paise": 100}'), 'ERR:22023', 'D16 ...nor have an order limit');
select is(pg_temp.save('b_owner', 'b', pg_temp.base()), 'ERR:22023', 'D17 the ordinary defaults of a shop are refused for a school');
select is(pg_temp.save('a_owner', 'a', pg_temp.base() || '{"may_talk_dues": true, "max_discount_percent": 9}') is not null and pg_temp.field('a', 'may_talk_dues') = 'true', true, 'D18 a shop may (the rule belongs to the business type)');

-- ============================================================================ E. the voices of the personas
select is(jsonb_array_length(pg_temp.val('a_owner', format($q$select public.assistant_voices(%L)::text$q$, tests.tid('a')))::jsonb), 24, 'E1 four personas in six languages (fake voices today)');
select is(pg_temp.val('a_admin', format($q$select (public.assistant_voices(%L) -> 0 ->> 'synthetic')$q$, tests.tid('a'))), 'true', 'E2 an Admin reads them; they are machine voices');
select is(pg_temp.val('a_sales', format($q$select public.assistant_voices(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'E3 DENY: a Sales person');
select is(pg_temp.val('a_owner', $$select app.operator_set_voice_persona('female_warm', 'te', 'fake-te')$$), 'ERR:42501', 'E4 DENY: a client cannot map a voice (the operator''s)');
select is(pg_temp.sc($$select app.operator_set_voice_persona('female_warm', 'te', 'fake-hi')$$), '23503', 'E5 a voice must be in the same language');
select is(pg_temp.sc($$select app.operator_set_voice_persona('robot', 'te', 'fake-te')$$), '23514', 'E6 a persona must be one of the four');
select is(pg_temp.val('a_owner', 'select count(*)::text from voice.voice_personas'), 'ERR:42501', 'E7 the table is not readable by a client');

-- ============================================================================ F. guards and doors
select is(tests.outcome_as(tests.uid('a_owner'), format($$insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media, may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute) values (%L, 'X', 'female_warm', 'te', true, true, 'warm', 1, true, true, true, true, 0, true, true, array[1], 540, 600)$$, tests.tid('b'))), '42501', 'F1 DENY: a client cannot insert a row');
select is(tests.outcome_as(tests.uid('a_owner'), format($$update public.assistant_settings set max_discount_percent = 50 where tenant_id = %L$$, tests.tid('a'))), '42501', 'F2 DENY: nor update one');
select is(tests.outcome_as(tests.uid('a_owner'), format($$delete from public.assistant_settings where tenant_id = %L$$, tests.tid('a'))), '42501', 'F3 DENY: nor delete one');
select is(pg_temp.sc(format($$update public.assistant_settings set max_discount_percent = 50 where tenant_id = %L$$, tests.tid('a'))), '42501', 'F4 not even the table''s owner changes a row except through the function (the guard)');
select is(pg_temp.sc(format($$delete from public.assistant_settings where tenant_id = %L$$, tests.tid('a'))), '42501', 'F5 ...nor deletes');
select is(pg_temp.sc('truncate public.assistant_settings'), '42501', 'F6 ...nor truncates');
select is(pg_temp.val('a_owner', 'select count(*)::text from public.assistant_settings'), '1', 'F7 an Owner reads the own business''s row (and not the other)');
select is(pg_temp.val('a_admin', 'select count(*)::text from public.assistant_settings'), '1', 'F8 an Admin too');
select is(pg_temp.val('a_sales', 'select count(*)::text from public.assistant_settings'), '0', 'F9 a Sales person reads none');
select is(pg_temp.val('a_viewer', 'select count(*)::text from public.assistant_settings'), '0', 'F10 a Viewer reads none');
select is(pg_temp.val('b_owner', format($$select count(*)::text from public.assistant_settings where tenant_id = %L$$, tests.tid('a'))), '0', 'F11 another business reads none of a''s');
select is((select has_table_privilege('authenticated', 'public.assistant_settings', 'insert') or has_table_privilege('authenticated', 'public.assistant_settings', 'update') or has_table_privilege('authenticated', 'public.assistant_settings', 'delete')), false, 'F12 a signed-in user holds select only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('assistant_settings_get', 'assistant_settings_save', 'assistant_voices')
              and p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute')), 3, 'F13 the three public functions are SECURITY DEFINER with an empty search_path, closed to anon');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.assistant_settings'::regclass and tgname = 'audit_assistant_settings'), 1, 'F14 every change is audited');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'assistant_settings' and (column_name ilike '%student%' or column_name ilike '%child%' or column_name ilike '%pupil%')), 0, 'F15 no column could name a student or a child');

select * from finish();
rollback;
