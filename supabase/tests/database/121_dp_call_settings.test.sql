-- Job DP part 4 (migration 20261130090200): CALL SETTINGS AS DATA. The database validates the whole document; the Owner (second factor) saves; Owner and Admin read; a school never gets sales or dues calls.
--   A who   B the workspace document   C every range   D lists   E the school rule   F one campaign   G hand-over rules (personal data)   H doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_guards_off();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.val1(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

-- the document the screen sends: every key
create function pg_temp.doc(p_changes jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'retry_busy', jsonb_build_object('count', 2, 'gap_minutes', 30), 'retry_no_answer', jsonb_build_object('count', 3, 'gap_minutes', 120), 'retry_call_later', jsonb_build_object('count', 2, 'gap_minutes', 60),
    'concurrent_calls', 1, 'detect_voicemail', true, 'voicemail_action', 'retry_later', 'detect_phone_menu', true, 'phone_menu_action', 'hang_up', 'silence_timeout_seconds', 8, 'max_call_seconds', 300,
    'interruption_sensitivity', 'medium', 'listening_sounds', true, 'pronunciations', '[]'::jsonb, 'keywords', '[]'::jsonb, 'hours', null, 'holidays', '[]'::jsonb,
    'max_calls_per_customer_per_week', 2, 'auto_pause_refusals_per_hour', 10, 'contact_memory', true, 'handover', '[]'::jsonb,
    'allowed_purposes', jsonb_build_array('sales_followup', 'payment_reminder', 'visit_reminder')) || p_changes $$;
create function pg_temp.save(p_user text, p_tenant text, p_doc jsonb) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.call_settings_save(%L, %L::jsonb)::text$q$, tests.tid(p_tenant), p_doc::text)) $$;
create function pg_temp.get(p_user text, p_tenant text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.call_settings_get(%L)::text$q$, tests.tid(p_tenant))) $$;
create function pg_temp.csave(p_user text, p_tenant text, p_camp text, p_doc jsonb) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.call_settings_campaign_save(%L, %L, %L::jsonb)::text$q$, tests.tid(p_tenant), tests.rid(p_camp), p_doc::text)) $$;

insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select tests.tid('b'), 'education', max(version), 'operator' from packs.pack_versions where code = 'education'
  on conflict (tenant_id) do update set pack_code = excluded.pack_code, pack_version = excluded.pack_version;
-- one campaign in each business
insert into public.campaigns (id, tenant_id, name, kind, language, message_text, steps, created_by) values
  (tests.rid('camp_a'), tests.tid('a'), 'Camp A', 'payment_due', 'en', 'Dear {{name}}, reminder', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, tests.uid('a_owner')),
  (tests.rid('camp_b'), tests.tid('b'), 'Camp B', 'event', 'en', 'Dear {{name}}, event', '[{"offset_days": 0, "time": "10:00"}]'::jsonb, tests.uid('b_owner'));

-- ============================================================================ A. who
select is(pg_temp.save('a_owner', 'a', pg_temp.doc()) like 'ERR%', false, 'A1 the Owner saves');
select is(pg_temp.save('a_admin', 'a', pg_temp.doc()), 'ERR:42501', 'A2 DENY: an Admin cannot save (the Owner decides)');
select is(pg_temp.save('a_sales', 'a', pg_temp.doc()), 'ERR:42501', 'A3 DENY: Sales');
select is(pg_temp.save('a_viewer', 'a', pg_temp.doc()), 'ERR:42501', 'A4 DENY: a Viewer');
select is(pg_temp.save('b_owner', 'a', pg_temp.doc()), 'ERR:42501', 'A5 DENY: another business''s Owner');
select is(pg_temp.save('anon', 'a', pg_temp.doc()), 'ERR:42501', 'A6 DENY: anon');
select is(pg_temp.val1('a_owner', format($q$select public.call_settings_save(%L, %L::jsonb)::text$q$, tests.tid('a'), pg_temp.doc()::text)), 'ERR:SM306', 'A7 the Owner needs the second factor');
select isnt(pg_temp.get('a_admin', 'a'), 'ERR:42501', 'A8 an Admin reads');
select is(pg_temp.get('a_sales', 'a'), 'ERR:42501', 'A9 DENY: Sales cannot read (hand-over numbers are personal data)');
select is(pg_temp.get('a_viewer', 'a'), 'ERR:42501', 'A10 DENY: a Viewer');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'A11 DENY: another business');

-- ============================================================================ B. the document
select is((pg_temp.get('a_owner', 'a')::jsonb ->> 'saved'), 'true', 'B1 saved is true after the first save');
select is((pg_temp.get('a_owner', 'a')::jsonb -> 'settings' -> 'retry_no_answer'), '{"count": 3, "gap_minutes": 120}'::jsonb, 'B2 the document comes back as it went in');
select is((pg_temp.get('a_owner', 'a')::jsonb -> 'settings' -> 'hours'), 'null'::jsonb, 'B3 hours null = follow the AI assistant');
select is((pg_temp.get('a_owner', 'a')::jsonb ->> 'business_type'), 'textiles', 'B4 the business type is the pack''s code');
select is((select count(*)::int from public.call_settings where tenant_id = tests.tid('a') and campaign_id is null), 1, 'B5 one workspace row');
select pg_temp.save('a_owner', 'a', pg_temp.doc('{"max_call_seconds": 600}'));
select is((select count(*)::int from public.call_settings where tenant_id = tests.tid('a') and campaign_id is null), 1, 'B6 saving again replaces it (still one row)');
select is((select (settings ->> 'max_call_seconds') from public.call_settings where tenant_id = tests.tid('a') and campaign_id is null), '600', 'B7 ...with the new value');
select is((select settings ? 'handover' from public.call_settings where tenant_id = tests.tid('a') and campaign_id is null), false, 'B8 the hand-over rules (phone numbers) are NOT in the settings document');
select is((pg_temp.get('a_owner', 'a')::jsonb -> 'assistant_hours'), 'null'::jsonb, 'B9 no assistant settings saved: no hours of its own to show');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc() - 'keywords'), 'ERR:22023', 'B10 a missing key is invalid');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"surprise": 1}')), 'ERR:22023', 'B11 an unknown key is invalid');
select is(pg_temp.save('a_owner', 'a', '[]'::jsonb), 'ERR:22023', 'B12 not an object is invalid');
select is(pg_temp.val('a_owner', format($q$select public.call_settings_save(%L, null)::text$q$, tests.tid('a'))), 'ERR:22023', 'B13 null is invalid');

-- ============================================================================ C. every range
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"retry_busy": {"count": 6, "gap_minutes": 30}}')), 'ERR:22023', 'C1 at most 5 retries');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"retry_busy": {"count": 1, "gap_minutes": 7}}')), 'ERR:22023', 'C2 the gap is in steps of 5');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"retry_busy": {"count": 1, "gap_minutes": 5, "x": 1}}')), 'ERR:22023', 'C3 a retry rule has exactly two keys');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"retry_busy": {"count": 0, "gap_minutes": 5}}')) like 'ERR%', false, 'C4 count 0 (never retry) is allowed');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"concurrent_calls": 0}')), 'ERR:22023', 'C5 at least one call at a time');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"concurrent_calls": 21}')), 'ERR:22023', 'C6 at most 20');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"concurrent_calls": 2.5}')), 'ERR:22023', 'C7 a whole number');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"concurrent_calls": "2"}')), 'ERR:22023', 'C8 a number, not text');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"detect_voicemail": "yes"}')), 'ERR:22023', 'C9 a switch is true or false, not "yes"');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"contact_memory": 1}')), 'ERR:22023', 'C10 ...nor 1');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"voicemail_action": "shout"}')), 'ERR:22023', 'C11 a closed word');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"phone_menu_action": "leave_message"}')), 'ERR:22023', 'C12 a menu cannot be left a message');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"silence_timeout_seconds": 2}')), 'ERR:22023', 'C13 silence 3 to 30');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"silence_timeout_seconds": 31}')), 'ERR:22023', 'C14');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"max_call_seconds": 100}')), 'ERR:22023', 'C15 the longest call is in steps of 30');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"max_call_seconds": 1830}')), 'ERR:22023', 'C16 ...at most 1800');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"interruption_sensitivity": "extreme"}')), 'ERR:22023', 'C17 low, medium or high');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"max_calls_per_customer_per_week": 0}')), 'ERR:22023', 'C18 1 to 14 calls a week');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"max_calls_per_customer_per_week": 15}')), 'ERR:22023', 'C19');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"auto_pause_refusals_per_hour": 2}')), 'ERR:22023', 'C20 the pause threshold 3 to 100');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"auto_pause_refusals_per_hour": null}')) like 'ERR%', false, 'C21 null = never pause on its own');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"hours": {"days": [1,2], "from_minute": 540, "to_minute": 1260}}')) like 'ERR%', false, 'C22 hours of its own');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"hours": {"days": [], "from_minute": 540, "to_minute": 600}}')), 'ERR:22023', 'C23 at least one day');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"hours": {"days": [1,1], "from_minute": 540, "to_minute": 600}}')), 'ERR:22023', 'C24 a day once');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"hours": {"days": [8], "from_minute": 540, "to_minute": 600}}')), 'ERR:22023', 'C25 days 1 to 7');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"hours": {"days": [1], "from_minute": 600, "to_minute": 540}}')), 'ERR:22023', 'C26 it must end after it begins');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"hours": {"days": [1], "from_minute": 500, "to_minute": 600}}')), 'ERR:22023', 'C27 not before 09:00');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"hours": {"days": [1], "from_minute": 541, "to_minute": 600}}')), 'ERR:22023', 'C28 steps of 15 minutes');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"hours": {"days": [1], "from_minute": 540, "to_minute": 1275}}')), 'ERR:22023', 'C29 not after 21:00');

-- ============================================================================ D. lists
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"pronunciations": [{"written": "Kanchipuram", "spoken": "Kanchee-puram"}], "keywords": ["Kanchipuram", "jari"]}')) like 'ERR%', false, 'D1 pronunciations and key words');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"pronunciations": [{"written": "A", "spoken": "<b>x</b>"}]}')), 'ERR:22023', 'D2 no markup in what is spoken');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"pronunciations": [{"written": "Kanchi", "spoken": "x"}, {"written": "KANCHI", "spoken": "y"}]}')), 'ERR:22023', 'D3 a name is listed once, in any capitals');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"pronunciations": [{"written": "Kanchi"}]}')), 'ERR:22023', 'D4 both words are needed');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc(jsonb_build_object('pronunciations', (select jsonb_agg(jsonb_build_object('written', 'N' || i, 'spoken', 'x')) from generate_series(1, 51) i)))), 'ERR:22023', 'D5 at most 50 pronunciations');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc(jsonb_build_object('keywords', (select jsonb_agg('word' || i) from generate_series(1, 101) i)))), 'ERR:22023', 'D6 at most 100 key words');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"keywords": ["a"]}')), 'ERR:22023', 'D7 a key word has at least 2 characters');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"keywords": ["fine", "Fine"]}')), 'ERR:22023', 'D8 a key word once');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"keywords": ["bad@word"]}')), 'ERR:22023', 'D9 no at-sign in a key word');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"keywords": [" padded"]}')), 'ERR:22023', 'D10 no padding');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"keywords": ["a' || chr(8238) || 'bc"]}')), 'ERR:22023', 'D11 no direction override (clean text)');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"holidays": ["2026-11-09", "2026-12-25"]}')) like 'ERR%', false, 'D12 holidays');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"holidays": ["2026-11-09", "2026-11-09"]}')), 'ERR:22023', 'D13 a day once');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"holidays": ["2026-02-30"]}')), 'ERR:22023', 'D14 a real day');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"holidays": ["2026-10-20"]}')), 'ERR:22023', 'D15 not in the past');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"holidays": ["2028-01-01"]}')), 'ERR:22023', 'D16 not more than 400 days ahead');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"holidays": ["26-11-09"]}')), 'ERR:22023', 'D17 YYYY-MM-DD');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"allowed_purposes": []}')), 'ERR:22023', 'D18 at least one purpose');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"allowed_purposes": ["spam"]}')), 'ERR:22023', 'D19 a closed word');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"allowed_purposes": ["visit_reminder", "visit_reminder"]}')), 'ERR:22023', 'D20 once');

-- ============================================================================ E. the school rule
select is(pg_temp.save('b_owner', 'b', pg_temp.doc('{"allowed_purposes": ["admission_followup", "visit_reminder", "event_reminder"]}')) like 'ERR%', false, 'E1 a school may switch on admissions, visits and events');
select is(pg_temp.save('b_owner', 'b', pg_temp.doc('{"allowed_purposes": ["sales_followup"]}')), 'ERR:22023', 'E2 a school may not make sales calls');
select is(pg_temp.save('b_owner', 'b', pg_temp.doc('{"allowed_purposes": ["payment_reminder"]}')), 'ERR:22023', 'E3 ...nor calls about dues or fees');
select is(pg_temp.save('b_owner', 'b', pg_temp.doc('{"allowed_purposes": ["admission_followup", "payment_reminder"]}')), 'ERR:22023', 'E4 ...not even one among others');
select is((pg_temp.get('b_owner', 'b')::jsonb -> 'locked' -> 'allowed_purposes'), '["admission_followup", "visit_reminder", "event_reminder"]'::jsonb, 'E5 the read says what is locked');
select is((pg_temp.get('b_owner', 'b')::jsonb ->> 'business_type'), 'education', 'E6 ...and the business type');
select is((pg_temp.get('a_owner', 'a')::jsonb -> 'locked'), '{}'::jsonb, 'E7 a textile shop has nothing locked');

-- ============================================================================ F. one campaign
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"max_call_seconds": 120, "listening_sounds": false}') like 'ERR%', false, 'F1 the Owner saves an override');
select is((select settings from public.call_settings where tenant_id = tests.tid('a') and campaign_id = tests.rid('camp_a')), '{"max_call_seconds": 120, "listening_sounds": false}'::jsonb, 'F2 only what was named is stored');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"max_call_seconds": 90, "keywords": null}') like 'ERR%', false, 'F3 null means inherit (and is not stored)');
select is((select settings from public.call_settings where tenant_id = tests.tid('a') and campaign_id = tests.rid('camp_a')), '{"max_call_seconds": 90}'::jsonb, 'F4 saving again replaces the override');
select is((select count(*)::int from public.call_settings where tenant_id = tests.tid('a')), 2, 'F5 the workspace row and the campaign row');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"holidays": ["2026-11-09"]}'), 'ERR:22023', 'F6 holidays belong to the business, not a campaign');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"handover": []}'), 'ERR:22023', 'F7 nor the hand-over rules');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"allowed_purposes": ["visit_reminder"]}'), 'ERR:22023', 'F8 nor the purposes');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"max_call_seconds": 100}'), 'ERR:22023', 'F9 the same ranges as the workspace');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"auto_pause_off": true, "auto_pause_refusals_per_hour": 5}'), 'ERR:22023', 'F10 "off" and a number together are invalid');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"auto_pause_off": true}') like 'ERR%', false, 'F11 auto-pause can be switched off for one campaign');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{"hours": {"days": [1], "from_minute": 660, "to_minute": 720}}') like 'ERR%', false, 'F12 a campaign''s own hours');
select is(pg_temp.csave('a_admin', 'a', 'camp_a', '{"max_call_seconds": 90}'), 'ERR:42501', 'F13 DENY: an Admin cannot save an override');
select is(pg_temp.csave('b_owner', 'a', 'camp_a', '{"max_call_seconds": 90}'), 'ERR:42501', 'F14 DENY: another business');
select is(pg_temp.csave('a_owner', 'a', 'camp_b', '{"max_call_seconds": 90}'), 'ERR:23503', 'F15 a campaign of another business is "not found"');
select is(pg_temp.csave('a_owner', 'a', 'nope', '{"max_call_seconds": 90}'), 'ERR:23503', 'F16 so is one that does not exist');
select is(pg_temp.val('a_admin', format($q$select public.call_settings_campaign_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('camp_a')))::jsonb ->> 'saved', 'true', 'F17 an Admin reads it');
select is(pg_temp.val('a_sales', format($q$select public.call_settings_campaign_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('camp_a'))), 'ERR:42501', 'F18 DENY: Sales');
select is(pg_temp.csave('a_owner', 'a', 'camp_a', '{}') like 'ERR%', false, 'F19 an empty override is allowed...');
select is((select count(*)::int from public.call_settings where tenant_id = tests.tid('a') and campaign_id = tests.rid('camp_a')), 0, 'F20 ...and removes the override');
select pg_temp.csave('a_owner', 'a', 'camp_a', '{"max_call_seconds": 90}');
select is(pg_temp.val('a_owner', format($q$select public.call_settings_campaign_clear(%L, %L)::text$q$, tests.tid('a'), tests.rid('camp_a')))::jsonb ->> 'saved', 'false', 'F21 clear removes it');
select is(pg_temp.val('a_admin', format($q$select public.call_settings_campaign_clear(%L, %L)::text$q$, tests.tid('a'), tests.rid('camp_a'))), 'ERR:42501', 'F22 DENY: an Admin cannot clear');
select is(pg_temp.val1('a_owner', format($q$select public.call_settings_campaign_clear(%L, %L)::text$q$, tests.tid('a'), tests.rid('camp_a'))), 'ERR:SM306', 'F23 clearing needs the second factor');
select is(pg_temp.sc(format($q$insert into public.call_settings (tenant_id, campaign_id, settings, updated_by) values (%L, %L, '{}', %L)$q$, tests.tid('a'), tests.rid('camp_b'), tests.uid('a_owner'))), '23503', 'F24 the foreign key keeps a campaign override in its own business (composite key)');

-- ============================================================================ G. hand-over rules (personal data)
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"handover": [{"topic": "pricing", "person_name": "Suresh (owner)", "phone": "+919876500001"}, {"topic": "complaint", "person_name": "Lakshmi", "phone": "9876500002"}]}')) like 'ERR%', false, 'G1 hand-over rules');
select is((pg_temp.get('a_owner', 'a')::jsonb -> 'settings' -> 'handover' -> 0 ->> 'person_name'), 'Suresh (owner)', 'G2 they come back in the settings (Owner and Admin only)');
select is((select count(*)::int from public.call_handover_rules where tenant_id = tests.tid('a')), 2, 'G3 two rows in their own table');
select pg_temp.save('a_owner', 'a', pg_temp.doc('{"handover": [{"topic": "delivery", "person_name": "Ravi", "phone": "+919876500003"}]}'));
select is((select string_agg(topic, ',') from public.call_handover_rules where tenant_id = tests.tid('a')), 'delivery', 'G4 saving replaces the rules');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"handover": [{"topic": "pricing", "person_name": "A", "phone": "123"}]}')), 'ERR:22023', 'G5 a phone number of 7 to 15 digits');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"handover": [{"topic": "pricing", "person_name": "A", "phone": "+91 98765 00001"}]}')), 'ERR:22023', 'G6 digits only (and an optional +)');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"handover": [{"topic": "pricing", "person_name": "A", "phone": "+919876500001"}, {"topic": "pricing", "person_name": "B", "phone": "+919876500002"}]}')), 'ERR:22023', 'G7 a topic goes to one person');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"handover": [{"topic": "weather", "person_name": "A", "phone": "+919876500001"}]}')), 'ERR:22023', 'G8 a closed topic');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"handover": [{"topic": "pricing", "person_name": "A<b>", "phone": "+919876500001"}]}')), 'ERR:22023', 'G9 a clean name');
select is(pg_temp.save('a_owner', 'a', pg_temp.doc('{"handover": [{"topic": "pricing", "person_name": "A"}]}')), 'ERR:22023', 'G10 a name and a number');
select is((select count(*)::int from public.call_handover_rules where tenant_id = tests.tid('a')), 1, 'G11 a refused save changed nothing');
select is(pg_temp.val('a_sales', 'select count(*)::text from public.call_handover_rules'), '0', 'G12 Sales cannot read the rules through RLS');
select is(pg_temp.val('b_owner', 'select count(*)::text from public.call_handover_rules'), '0', 'G13 nor can another business');
select is(pg_temp.val('a_owner', 'select count(*)::text from public.call_handover_rules'), '1', 'G14 the Owner reads their own');
select is(pg_temp.sc(format($q$insert into public.call_handover_rules (tenant_id, topic, person_name, phone, updated_by) values (%L, 'other', 'X', '12', %L)$q$, tests.tid('a'), tests.uid('a_owner'))), '23514', 'G15 the table refuses a bad number by itself');
select is((select count(*)::int from erasure.registry where table_name = 'call_handover_rules' and scope = 'tenant'), 2, 'G16 the name and the number are in the erasure registry');

-- ============================================================================ H. doors
select is(pg_temp.val('a_owner', $q$insert into public.call_settings (tenant_id, settings, updated_by) values (gen_random_uuid(), '{}', gen_random_uuid())$q$), 'ERR:42501', 'H1 a client cannot insert directly');
select is(pg_temp.val('a_owner', $q$update public.call_settings set settings = '{}'$q$), 'ERR:42501', 'H2 nor update');
select is(pg_temp.val('a_owner', $q$delete from public.call_settings$q$), 'ERR:42501', 'H3 nor delete');
select is(pg_temp.val('a_owner', $q$insert into public.call_handover_rules (tenant_id, topic, person_name, updated_by) values (gen_random_uuid(), 'other', 'X', gen_random_uuid())$q$), 'ERR:42501', 'H4 nor the rules');
select is(pg_temp.val('a_sales', 'select count(*)::text from public.call_settings'), '0', 'H5 Sales reads no settings row');
select is(pg_temp.val('b_owner', 'select count(*)::text from public.call_settings'), '0', 'H6 another business reads none of A''s');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'call\_settings\_%' and has_function_privilege('anon', p.oid, 'execute')), 0, 'H7 anon can run none of the functions');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'call\_settings\_%' and not p.prosecdef), 0, 'H8 every one is a pinned definer function');

select * from finish();
rollback;
