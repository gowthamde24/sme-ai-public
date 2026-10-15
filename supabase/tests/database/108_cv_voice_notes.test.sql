-- Job CV (ADR 0088), part 1: VOICE NOTES. The business's settings and voices, the spoken AI disclosure (a draft is spoken only over synthetic data), a campaign's voice switch (part of what the Owner approves),
-- the fair-use ledger of audio seconds (80 percent warns, 100 percent pauses voice), the preview, and the worker's two calls.
--   A structure, grants, RLS, module    B settings    C voices and choices    D the disclosure    E a campaign's switch and its approval    F the preview and the fair-use ledger    G the worker's plan and record    H guards
begin;
select no_plan();
-- setup calls that return a value are wrapped in q() so no row of theirs reaches the TAP stream (a bare `ok` line would be read as a test)
create function pg_temp.q(p_value anyelement) returns void language plpgsql as $$ begin end $$;
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'education');
select tests.open_gate('a');

create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.sqlstate_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  return r;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.vala(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);
select pg_temp.q(app.operator_register_scheduler('outsider@test.local'));

create function pg_temp.settings(p_user text, p_enabled boolean, p_speed numeric, p_from int, p_to int, p_aal text default 'aal2', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.at(p_aal, p_user, format($q$select public.voice_settings_set(%L, %L, %L, %L, %L)$q$, tests.tid(p_tenant), p_enabled, p_speed, p_from, p_to))
$$;
create function pg_temp.choose(p_user text, p_lang text, p_voice text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.at(p_aal, p_user, format($q$select public.voice_choice_set(%L, %L, %L)$q$, tests.tid('a'), p_lang, p_voice))
$$;

-- ============================================================================ A. structure, grants, RLS, module
select is((select count(*) from pg_class where relname in ('voice_settings', 'voice_choices', 'campaign_voice', 'voice_note_usage') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 4::bigint, 'A1 RLS is enabled and forced on the four tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('voice_settings', 'voice_choices', 'campaign_voice', 'voice_note_usage') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'A2 a client can only read them');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('voice_settings', 'voice_choices', 'campaign_voice', 'voice_note_usage', 'plan_voice_allowances') and grantee in ('anon', 'public', 'service_role')), 0::bigint, 'A3 anon, PUBLIC and the service role hold nothing');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'voice' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A4 the operator''s catalogues (voices, disclosures) have no client grant at all');
select is((select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'voice', 'usage')), 0::bigint, 'A5 no client role has USAGE on schema voice');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'plan_voice_allowances' and grantee = 'authenticated'), 0::bigint, 'A6 nor can a client read the allowances table');
select is((select guard from packs.modules where code = 'voice_notes'), 'tables', 'A7 the module `voice_notes` owns tables now');
select is(pg_temp.settings('b_owner', true, 1.0, 9, 21, 'aal2', 'b'), 'SM701', 'A8 textiles: voice notes are not on (SM701)');
select is(pg_temp.val('b_owner', format($q$select public.voice_usage_get(%L)::text$q$, tests.tid('b'))), 'ERR:SM701', 'A9 nor the usage');
select is(pg_temp.try('a_owner', format($q$insert into public.voice_settings (tenant_id) values (%L)$q$, tests.tid('a'))), '42501', 'A10 DENY: a client cannot write the settings directly');
select is(pg_temp.try('a_owner', format($q$select count(*) from voice.voices$q$)), '42501', 'A11 nor read the catalogue');

-- ============================================================================ B. settings
select is(pg_temp.val('a_owner', format($q$select public.voice_settings_get(%L)::text$q$, tests.tid('a'))), '{"speed": 1.00, "choices": {}, "enabled": false, "recording": false, "updated_at": null, "call_to_hour": 21, "call_from_hour": 9}', 'B1 a business that never set anything: off, normal speed, calls 09:00 to 21:00, recording off');
select is(pg_temp.settings('a_admin', true, 1.0, 9, 21), '42501', 'B2 DENY: an Admin cannot change them (the Owner''s)');
select is(pg_temp.settings('a_sales', true, 1.0, 9, 21), '42501', 'B3 DENY: Sales');
select is(pg_temp.settings('b_owner', true, 1.0, 9, 21, 'aal2', 'a'), '42501', 'B4 DENY: another business');
select is(pg_temp.settings('a_owner', true, 1.0, 9, 21, 'aal1'), 'SM306', 'B5 a second factor is needed (SM306)');
select is(pg_temp.settings('a_owner', true, 1.5, 9, 21), '22023', 'B6 the speed is 0.75 to 1.25');
select is(pg_temp.settings('a_owner', true, 1.0, 8, 21), '22023', 'B7 calls start no earlier than 09:00...');
select is(pg_temp.settings('a_owner', true, 1.0, 9, 22), '22023', 'B8 ... and end no later than 21:00');
select is(pg_temp.settings('a_owner', true, 1.0, 12, 12), '22023', 'B9 the window has a width');
select is(pg_temp.settings('a_owner', true, 0.9, 10, 20), 'ok', 'B10 ALLOW: the Owner switches voice notes on at 0.9 speed');
select is(pg_temp.val('a_admin', format($q$select (public.voice_settings_get(%L) ->> 'speed')$q$, tests.tid('a'))), '0.90', 'B11 an Admin reads it');
select is(pg_temp.val('a_sales', format($q$select public.voice_settings_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B12 Sales and a Viewer do not');
select is(pg_temp.val('a_owner', format($q$select (public.voice_settings_get(%L) ->> 'recording')$q$, tests.tid('a'))), 'false', 'B13 recording is off, and there is no switch to turn it on');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'voice_settings' and column_name ~* 'record'), 0::bigint, 'B14 (no column for it)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'voice_settings'), 1::bigint, 'B15 the change is in the audit trail');

-- ============================================================================ C. voices and choices
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.voice_voices_list(%L))::text$q$, tests.tid('a'))), '5', 'C1 five synthetic voices (the fake provider; no human voice)');
select is(pg_temp.val('a_owner', format($q$select (public.voice_voices_list(%L) -> 0 ->> 'synthetic')$q$, tests.tid('a'))), 'true', 'C2 each says it is synthetic');
select is(pg_temp.val('a_sales', format($q$select public.voice_voices_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C3 DENY: Sales');
select is(pg_temp.choose('a_owner', 'en', 'fake-en'), 'ok', 'C4 ALLOW: the Owner chooses a voice for English');
select is(pg_temp.choose('a_owner', 'te', 'fake-te'), 'ok', 'C5 and for Telugu');
select is(pg_temp.choose('a_owner', 'en', 'fake-te'), '23503', 'C6 a voice of another language is not found');
select is(pg_temp.choose('a_owner', 'en', 'nobody'), '23503', 'C7 nor an unknown one');
select is(pg_temp.choose('a_owner', 'xx', 'fake-en'), '22023', 'C8 a language outside the five is invalid');
select is(pg_temp.choose('a_admin', 'hi', 'fake-hi'), '42501', 'C9 DENY: an Admin');
select is(pg_temp.choose('a_owner', 'hi', 'fake-hi', 'aal1'), 'SM306', 'C10 a second factor is needed');
select is(pg_temp.val('a_owner', format($q$select (public.voice_settings_get(%L) -> 'choices')::text$q$, tests.tid('a'))), '{"en": "fake-en", "te": "fake-te"}', 'C11 the choices are listed');
select is(pg_temp.choose('a_owner', 'te', null), 'ok', 'C12 a choice can be removed');
select is(pg_temp.val('a_owner', format($q$select (public.voice_settings_get(%L) -> 'choices')::text$q$, tests.tid('a'))), '{"en": "fake-en"}', 'C13 (gone)');
select is(pg_temp.sc(format($q$insert into voice.voices (code, provider, language, label) values ('real-hi', 'sarvam', 'hi', 'A real voice nobody listened to')$q$)), '23514', 'C14 a voice that is not synthetic needs a native speaker''s review (23514)');
select is(pg_temp.sc(format($q$insert into voice.voices (code, provider, language, label, reviewed_by, reviewed_at) values ('real-hi', 'sarvam', 'hi', 'Reviewed Hindi voice', 'a native speaker', now())$q$)), 'ok', 'C15 a reviewed one can be added by the operator');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.voice_voices_list(%L))::text$q$, tests.tid('a'))), '6', 'C16 and is offered');

-- ============================================================================ D. the spoken disclosure
select is(pg_temp.val('a_sales', format($q$select (public.voice_disclosure_get(%L, 'en') ->> 'text')$q$, tests.tid('a'))), 'This is an automated voice message from the AI assistant of ' || (select name from public.tenants where id = tests.tid('a')) || '.', 'D1 the line names the business');
select is(pg_temp.val('a_sales', format($q$select (public.voice_disclosure_get(%L, 'en') ->> 'status')$q$, tests.tid('a'))), 'draft', 'D2 the wording is a draft until a native speaker has read it');
select is(pg_temp.val('a_sales', format($q$select (public.voice_disclosure_get(%L, 'en') ->> 'usable')$q$, tests.tid('a'))), 'false', 'D3 and a draft is NOT spoken in a workspace that holds real data (the gate of this workspace is open)');
select app.operator_close_real_data_gate((select slug from public.tenants where id = tests.tid('a')));
select is(pg_temp.val('a_sales', format($q$select (public.voice_disclosure_get(%L, 'en') ->> 'usable')$q$, tests.tid('a'))), 'true', 'D4 over synthetic data (gate closed) a draft may be spoken');
select app.operator_open_real_data_gate((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', 'doc:hosting', 'dpdp-children:review', 'doc:restore');
select is(pg_temp.val('a_sales', format($q$select (public.voice_disclosure_get(%L, 'en') ->> 'usable')$q$, tests.tid('a'))), 'false', 'D5 (open again: not usable)');
select is(pg_temp.sc($q$insert into voice.disclosures (language, version, status, text) values ('en', 2, 'reviewed', 'This is an automated voice note from the assistant of {{business}}.')$q$), '23514', 'D6 a reviewed wording names who reviewed it and when');
select is(pg_temp.sc($q$insert into voice.disclosures (language, version, status, text, reviewed_by, reviewed_at) values ('en', 2, 'reviewed', 'This is an automated voice note from the assistant.', 'a native speaker', now())$q$), '23514', 'D7 and holds the business-name slot exactly once');
select is(pg_temp.sc($q$insert into voice.disclosures (language, version, status, text, reviewed_by, reviewed_at) values ('en', 2, 'reviewed', 'This is an automated voice note from the assistant of {{business}}.', 'a native speaker', now())$q$), 'ok', 'D8 the operator adds a reviewed wording');
select is(pg_temp.val('a_sales', format($q$select (public.voice_disclosure_get(%L, 'en') ->> 'version') || '/' || (public.voice_disclosure_get(%L, 'en') ->> 'usable')$q$, tests.tid('a'), tests.tid('a'))), '2/true', 'D9 the newest REVIEWED wording wins and is spoken anywhere');
select is(pg_temp.val('a_sales', format($q$select (public.voice_disclosure_get(%L, 'hi') ->> 'status')$q$, tests.tid('a'))), 'draft', 'D10 another language is still a draft');
select is(pg_temp.val('a_sales', format($q$select public.voice_disclosure_get(%L, 'xx')::text$q$, tests.tid('a'))), 'ERR:22023', 'D11 a language outside the five is invalid');
select is(pg_temp.val('a_viewer', format($q$select public.voice_disclosure_get(%L, 'en')::text$q$, tests.tid('a'))), 'ERR:42501', 'D12 DENY: a Viewer');

-- ============================================================================ E. a campaign's voice switch and its approval
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) values
  (tests.rid('tpl'), tests.tid('a'), 'notice', 'en', 'utility', 'reminder', 'Hello, a notice from the school: {{1}} Thank you.', 'approved');
insert into public.contacts (id, tenant_id, full_name, phone) values (tests.rid('par'), tests.tid('a'), 'Rao Parent', '+00 90070 00001');
select app.edu_edit(true);
insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (tests.rid('prog'), tests.tid('a'), 'Class 5', 'class', 'none', tests.uid('a_owner'));
insert into public.students (id, tenant_id, contact_id, is_adult, child_label, programme_id, created_by) values (tests.rid('stu'), tests.tid('a'), tests.rid('par'), false, 'Asha', tests.rid('prog'), tests.uid('a_owner'));
select app.edu_edit(false);
select pg_temp.q(tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, jsonb_build_object('version', 1, 'phone', %L))$q$, tests.rid('par'), md5('v1') || md5('v2'))));
select pg_temp.q(tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:cv')$q$, tests.tid('a'), tests.rid('par'))));
select pg_temp.q(pg_temp.try('a_owner', format($q$select public.campaign_save(%L, %L, 'Annual day', 'event', 'en', %L, 'Dear {{name}}, our annual day is on {{due_date}}. We look forward to seeing you.', '[{"offset_days": -2, "time": "10:00"}]'::jsonb, null, 24)$q$,
                                      tests.rid('cmp'), tests.tid('a'), tests.rid('tpl'))));
select pg_temp.q(pg_temp.val('a_owner', format($q$select public.campaign_recipients_from_students(%L, %L, '{"scope": "all", "date": "2026-12-20"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('cmp'))));
create function pg_temp.vset(p_user text, p_on boolean) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.campaign_voice_set(%L, %L, %L)$q$, tests.tid('a'), tests.rid('cmp'), p_on))
$$;
create function pg_temp.vget(p_key text) returns text language sql as $$
  select pg_temp.val('a_sales', format($q$select (public.campaign_voice_get(%L, %L) ->> %L)$q$, tests.tid('a'), tests.rid('cmp'), p_key))
$$;
select is(pg_temp.vget('enabled'), 'false', 'E1 a campaign is a text campaign until someone says otherwise');
select is(pg_temp.val('a_sales', format($q$select (public.campaign_voice_get(%L, %L) -> 'issues')::text$q$, tests.tid('a'), tests.rid('cmp'))), '[]', 'E2 nothing stands in the way: the switch is on, English has a voice, the wording is reviewed, the allowance is not used');
select is(pg_temp.val('a_viewer', format($q$select public.campaign_voice_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('cmp'))), 'ERR:42501', 'E3 DENY: a Viewer');
select is(pg_temp.vset('a_viewer', true), '42501', 'E4 DENY: a Viewer cannot switch it');
select is(pg_temp.vset('b_owner', true), '42501', 'E5 DENY: another business');
select is(pg_temp.try('a_owner', format($q$select public.campaign_voice_set(%L, gen_random_uuid(), true)$q$, tests.tid('a'))), '23503', 'E6 a campaign that does not exist is not found');
select is(pg_temp.vset('a_sales', true), 'ok', 'E7 ALLOW: Sales switch voice notes on for the campaign (like any edit of it)');
select is(pg_temp.vget('enabled'), 'true', 'E8 on');
select is(pg_temp.vset('a_sales', true), 'ok', 'E9 saying it again changes nothing');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'campaign_voice'), 1::bigint, 'E10 (one change on record)');
-- the approval binds to it: approve the campaign (with the voice on), then switch it off: back to draft
create function pg_temp.sha() returns text language sql as $$ select pg_temp.val('a_owner', format($q$select (public.campaign_preview(%L, %L) ->> 'samples_sha256')$q$, tests.tid('a'), tests.rid('cmp'))) $$;
select is(pg_temp.vala('aal2', 'a_owner', format($q$select (public.campaign_approve(%L, %L, %L) -> 'campaign' ->> 'status')$q$, tests.tid('a'), tests.rid('cmp'), pg_temp.sha())), 'approved', 'E11 the Owner approves the campaign (with voice on)');
create temp table hash_on as select content_sha256 as h from public.campaigns where id = tests.rid('cmp');
select is(pg_temp.vset('a_sales', false), 'ok', 'E12 switching voice OFF afterwards...');
select is((select status from public.campaigns where id = tests.rid('cmp')), 'draft', 'E13 ... sends the approved campaign back to DRAFT (what the Owner approved included the voice)');
select is(pg_temp.vset('a_sales', false), 'ok', 'E14 a repeat of the same state does not');
select is(pg_temp.vala('aal2', 'a_owner', format($q$select (public.campaign_approve(%L, %L, %L) -> 'campaign' ->> 'status')$q$, tests.tid('a'), tests.rid('cmp'), pg_temp.sha())), 'approved', 'E15 approved again as a text campaign');
select is((select content_sha256 <> (select h from hash_on) from public.campaigns where id = tests.rid('cmp')), true, 'E16 and its hash is another');
select is(pg_temp.vset('a_sales', true), 'ok', 'E17 voice on again (back to draft)');
select is(pg_temp.vset('a_sales', false), 'ok', 'E18 and off again');
select is(pg_temp.vala('aal2', 'a_owner', format($q$select (public.campaign_approve(%L, %L, %L) -> 'campaign' ->> 'status')$q$, tests.tid('a'), tests.rid('cmp'), pg_temp.sha())), 'approved', 'E19 approved once more');
select is(app.campaign_voice_sig(tests.tid('a'), tests.rid('cmp')), '', 'E20 with voice off its signature is empty: a campaign made before this job keeps the hash it was approved with');
select is((select content_sha256 = app.campaign_content_sha(tenant_id, id) from public.campaigns where id = tests.rid('cmp')), true, 'E21 (the stored hash equals the computed one)');

-- ============================================================================ F. the preview and the fair-use ledger
-- free_trial: 120 seconds a day, 1,200 a month
select is(pg_temp.val('a_owner', format($q$select (public.voice_usage_get(%L) ->> 'state')$q$, tests.tid('a'))), 'ok', 'F1 nothing used: ok');
select is(pg_temp.val('a_sales', format($q$select (public.voice_usage_get(%L) ->> 'day_percent')$q$, tests.tid('a'))), '0', 'F2 0 percent (Sales read the percentages, never rupees or tokens)');
select is(pg_temp.val('a_viewer', format($q$select public.voice_usage_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'F3 DENY: a Viewer');
select is(pg_temp.val('a_owner', format($q$select (public.voice_preview_plan(%L, 'en') ->> 'ok')$q$, tests.tid('a'))), 'true', 'F4 with a voice and a reviewed wording the preview plan is ok');
select is(pg_temp.val('a_owner', format($q$select (public.voice_preview_plan(%L, 'hi') ->> 'reason')$q$, tests.tid('a'))), 'no_voice_for_language', 'F5 a language with no chosen voice has no plan');
select is(pg_temp.val('a_sales', format($q$select public.voice_preview_plan(%L, 'en')::text$q$, tests.tid('a'))), 'ERR:42501', 'F7 DENY: Sales (the preview is the Owner''s and Admin''s)');
create function pg_temp.prev(p_secs int, p_id uuid default gen_random_uuid()) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.voice_preview_record(%L, %L, 'en', %L, 80) ->> 'state')$q$, tests.tid('a'), p_id, p_secs))
$$;
select is(pg_temp.prev(21), 'ERR:22023', 'F8 a preview is at most 20 seconds');
select is(pg_temp.prev(20), 'ok', 'F9 a preview of 20 seconds is recorded (17 percent of the day)');
select is(pg_temp.val('a_owner', format($q$select (public.voice_usage_get(%L) ->> 'day_percent')$q$, tests.tid('a'))), '16', 'F10 16 percent of 120 seconds');
select is(pg_temp.val('a_owner', format($q$select public.voice_preview_record(%L, %L, 'hi', 5, 10)::text$q$, tests.tid('a'), gen_random_uuid())), 'ERR:23503', 'F11 a preview in a language with no chosen voice cannot be recorded');
select pg_temp.q(pg_temp.prev(20, tests.rid('pv_same')));
select pg_temp.q(pg_temp.prev(20, tests.rid('pv_same')));
select is(pg_temp.val('a_owner', format($q$select (public.voice_usage_get(%L) ->> 'today_seconds')$q$, tests.tid('a'))), '40', 'F12 the same preview id counts once (a retry)');
select pg_temp.q(pg_temp.prev(20));
select pg_temp.q(pg_temp.prev(20));
select is(pg_temp.val('a_owner', format($q$select (public.voice_usage_get(%L) ->> 'state') || '/' || (public.voice_usage_get(%L) ->> 'day_percent')$q$, tests.tid('a'), tests.tid('a'))), 'ok/66', 'F13 80 seconds of 120: 66 percent, still ok');
select pg_temp.q(pg_temp.prev(20));
select is(pg_temp.val('a_owner', format($q$select (public.voice_usage_get(%L) ->> 'state') || '/' || (public.voice_usage_get(%L) ->> 'day_percent')$q$, tests.tid('a'), tests.tid('a'))), 'warn/83', 'F14 100 seconds of 120: 83 percent, from 80 percent the state is `warn`');
select pg_temp.q(pg_temp.prev(20));
select is(pg_temp.val('a_owner', format($q$select (public.voice_usage_get(%L) ->> 'state')$q$, tests.tid('a'))), 'paused', 'F16 at 120 of 120 seconds voice is PAUSED');
select is(pg_temp.val('a_owner', format($q$select (public.voice_preview_plan(%L, 'en') ->> 'reason')$q$, tests.tid('a'))), 'allowance_used', 'F17 and a preview has no plan');
select is(pg_temp.val('a_sales', format($q$select (public.campaign_voice_get(%L, %L) -> 'issues')::text$q$, tests.tid('a'), tests.rid('cmp'))), '["allowance_used"]', 'F18 the campaign says why voice will not go out (the text still does)');
update public.plan_voice_allowances set daily_seconds = 300, monthly_seconds = 3000 where plan = 'free_trial';
select is(pg_temp.val('a_owner', format($q$select (public.voice_usage_get(%L) ->> 'state')$q$, tests.tid('a'))), 'ok', 'F19 the operator raises the allowance and voice is back');
select is((select count(*) from public.voice_note_usage where tenant_id = tests.tid('a') and kind = 'preview'), 6::bigint, 'F20 six previews on the ledger');
-- ten previews an hour
select pg_temp.q(pg_temp.prev(1));
select pg_temp.q(pg_temp.prev(1));
select pg_temp.q(pg_temp.prev(1));
select pg_temp.q(pg_temp.prev(1));
select is(pg_temp.val('a_owner', format($q$select (public.voice_preview_plan(%L, 'en') ->> 'reason')$q$, tests.tid('a'))), 'too_many_previews', 'F21 at most ten previews an hour');

-- ============================================================================ G. the worker's plan and record
update public.plan_voice_allowances set daily_seconds = 2400, monthly_seconds = 48000 where plan = 'free_trial';
insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, source, status, reason, request_sha256, created_by, disclosure_added)
select tests.rid('m1'), tests.tid('a'), app.campaign_lead_for(tests.tid('a'), tests.rid('par')), tests.rid('par'), 'whatsapp',
       'Dear Rao Parent, our annual day is on 20 Dec 2026. We look forward to seeing you.' || E'\n\n' || app.outbox_disclosure('en'), 'en', 'campaign_reminder', 'system', 'queued', 'campaign_approved', repeat('c', 64), tests.uid('a_owner'), true;
create function pg_temp.plan(p_user text, p_msg text default 'm1', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.scheduler_voice_plan(%L, %L)::text$q$, tests.tid(p_tenant), tests.rid(p_msg)))
$$;
create function pg_temp.pj(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
select is(pg_temp.plan('a_owner'), 'ERR:42501', 'G1 DENY: only the registered scheduler account asks for a plan');
select is(pg_temp.pj(pg_temp.plan('outsider'), 'reason'), 'campaign_text_only', 'G2 a message that belongs to no voice campaign is text');
-- link the message to the campaign through a step (a privileged fixture)
select pg_temp.q(pg_temp.val('a_sales', format($q$select public.campaign_voice_set(%L, %L, true)::text$q$, tests.tid('a'), tests.rid('cmp'))));
alter table public.campaign_steps disable trigger campaign_steps_guard;
alter table public.campaign_recipients disable trigger campaign_recipients_guard;
insert into public.campaign_steps (id, tenant_id, campaign_id, recipient_id, step_no, scheduled_for, status, outbox_message_id, materialised_at)
select gen_random_uuid(), tests.tid('a'), tests.rid('cmp'), (select id from public.campaign_recipients where campaign_id = tests.rid('cmp') limit 1), 1, now(), 'submitted', tests.rid('m1'), now();
alter table public.campaign_steps enable trigger campaign_steps_guard;
alter table public.campaign_recipients enable trigger campaign_recipients_guard;
select is(pg_temp.pj(pg_temp.plan('outsider'), 'voice'), 'true', 'G3 ALLOW: a message of a campaign that has voice on, with a voice, a usable wording and an allowance, is a voice note');
select is(pg_temp.pj(pg_temp.plan('outsider'), 'voice_code') || '/' || pg_temp.pj(pg_temp.plan('outsider'), 'language') || '/' || pg_temp.pj(pg_temp.plan('outsider'), 'speed'), 'fake-en/en/0.90', 'G4 with the business''s voice, language and speed');
select is(pg_temp.pj(pg_temp.plan('outsider'), 'text'), 'This is an automated voice note from the assistant of ' || (select name from public.tenants where id = tests.tid('a')) || '. Dear Rao Parent, our annual day is on 20 Dec 2026. We look forward to seeing you.',
          'G5 the spoken text is the disclosure first (the REVIEWED wording, naming the business), then the message''s own words; the outbox''s own first-message line is not spoken twice');
select is(pg_temp.pj(pg_temp.plan('outsider'), 'chars')::int, char_length(pg_temp.pj(pg_temp.plan('outsider'), 'text')), 'G6 and its length is given');
select is(pg_temp.val('outsider', format($q$select public.scheduler_voice_plan(%L, %L)::text$q$, tests.tid('b'), tests.rid('m1'))), '{"voice": false, "reason": "module_off"}', 'G7 a textile business has no voice: text');
select pg_temp.q(pg_temp.settings('a_owner', false, 0.9, 10, 20));
select is(pg_temp.pj(pg_temp.plan('outsider'), 'reason'), 'voice_off', 'G8 with the business''s switch off: text');
select pg_temp.q(pg_temp.settings('a_owner', true, 0.9, 10, 20));
select pg_temp.q(pg_temp.choose('a_owner', 'en', null));
select is(pg_temp.pj(pg_temp.plan('outsider'), 'reason'), 'no_voice_for_language', 'G9 with no voice chosen for the language: text');
select pg_temp.q(pg_temp.choose('a_owner', 'en', 'fake-en'));
select app.operator_open_real_data_gate((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', 'doc:hosting', 'dpdp-children:review', 'doc:restore');
select pg_temp.q(pg_temp.sc($q$delete from voice.disclosures where language = 'en' and version = 2$q$));
select is(pg_temp.pj(pg_temp.plan('outsider'), 'reason'), 'disclosure_not_reviewed', 'G10 a draft wording over real data: text');
select app.operator_close_real_data_gate((select slug from public.tenants where id = tests.tid('a')));
select is(pg_temp.pj(pg_temp.plan('outsider'), 'voice'), 'true', 'G11 (over synthetic data the draft is spoken)');
insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, source, status, reason, request_sha256, created_by)
select tests.rid('m2'), tests.tid('a'), lead_id, tests.rid('par'), 'whatsapp', 'A different kind of message to the same parent.', 'en', 'info', 'system', 'queued', 'auto_allowed', repeat('f', 64), tests.uid('a_owner')
  from public.outbox_messages where id = tests.rid('m1');
select is(pg_temp.pj(pg_temp.plan('outsider', 'm2'), 'reason'), 'not_a_campaign_message', 'G12 a message that is not a campaign reminder is never a voice note');
insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, source, status, reason, request_sha256, created_by)
select tests.rid('m3'), tests.tid('a'), lead_id, tests.rid('par'), 'whatsapp', repeat('x', 700), 'en', 'campaign_reminder', 'system', 'queued', 'campaign_approved', repeat('9', 64), tests.uid('a_owner')
  from public.outbox_messages where id = tests.rid('m1');
alter table public.campaign_steps disable trigger campaign_steps_guard;
insert into public.campaign_steps (id, tenant_id, campaign_id, recipient_id, step_no, scheduled_for, status, outbox_message_id, materialised_at)
select gen_random_uuid(), tests.tid('a'), tests.rid('cmp'), (select id from public.campaign_recipients where campaign_id = tests.rid('cmp') limit 1), 2, now(), 'submitted', tests.rid('m3'), now();
alter table public.campaign_steps enable trigger campaign_steps_guard;
select is(pg_temp.pj(pg_temp.plan('outsider', 'm3'), 'reason'), 'too_long', 'G13 a text over 600 characters is not spoken');
create function pg_temp.rec(p_secs int, p_msg text default 'm1', p_voice text default 'fake-en', p_user text default 'outsider') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.scheduler_voice_record(%L, %L, 'en', %L, %L, 90)::text$q$, tests.tid('a'), tests.rid(p_msg), p_voice, p_secs))
$$;
select is(pg_temp.rec(7, 'm1', 'fake-en', 'a_owner'), 'ERR:42501', 'G14 DENY: only the scheduler records seconds');
select is(pg_temp.rec(0), 'ERR:22023', 'G15 at least a second');
select is(pg_temp.rec(601), 'ERR:22023', 'G16 and at most ten minutes');
select is(pg_temp.rec(7, 'm1', 'fake-te'), 'ERR:23503', 'G17 a voice of another language is not found');
select is(pg_temp.val('outsider', format($q$select public.scheduler_voice_record(%L, gen_random_uuid(), 'en', 'fake-en', 5, 50)::text$q$, tests.tid('a'))), 'ERR:23503', 'G18 nor a message that does not exist');
select is(pg_temp.pj(pg_temp.rec(7), 'today_seconds')::int >= 7, true, 'G19 ALLOW: the seconds of the note are recorded');
select is(pg_temp.pj(pg_temp.rec(7), 'today_seconds')::int >= 7, true, 'G20 recording the same message again');
select is((select count(*) from public.voice_note_usage where tenant_id = tests.tid('a') and ref_id = tests.rid('m1')), 1::bigint, 'G21 counts ONCE (a message offered again after a lapsed claim is not charged twice)');
select is((select kind || '/' || seconds || '/' || voice_code from public.voice_note_usage where ref_id = tests.rid('m1')), 'note/7/fake-en', 'G22 as a note, with its seconds and its voice');

-- ============================================================================ H. guards
select is(pg_temp.sc($q$update public.voice_note_usage set seconds = 1$q$), '42501', 'H1 the ledger is never changed, whoever asks');
select is(pg_temp.sc($q$delete from public.voice_note_usage$q$), '42501', 'H2 nor deleted');
select is(pg_temp.sc($q$truncate public.voice_note_usage$q$), '42501', 'H3 nor truncated');
select is(pg_temp.sc(format($q$update public.voice_settings set enabled = false where tenant_id = %L$q$, tests.tid('a'))), '42501', 'H4 the settings change only through their function');
select is(pg_temp.sc($q$delete from public.voice_settings$q$), '42501', 'H5 and are never deleted');
select is(pg_temp.sc(format($q$update public.campaign_voice set enabled = true where tenant_id = %L$q$, tests.tid('a'))), '42501', 'H6 nor a campaign''s switch');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'voice_note_usage' and (new_values::text ~ 'Rao|annual')), 0::bigint, 'H7 the audit trail of the ledger holds numbers, never words');
select is((select count(*) from public.voice_note_usage where tenant_id = tests.tid('b')), 0::bigint, 'H8 another business has nothing on the ledger');
select * from finish();
rollback;
