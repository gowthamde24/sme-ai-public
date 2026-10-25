-- Job DP part 5 (migration 20261130090300): THE OWNER'S OWN VOICE, WITH CONSENT.
--   A who   B the sentence   C making it   D selectable in the assistant settings   E one at a time   F deleting it   G what the table and the bucket keep   H doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);

create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.val1(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

-- the two tenants' business names are what the sentence will say
update public.tenants set name = 'Sri Lakshmi Silks' where id = tests.tid('a');
update public.tenants set name = 'Little Stars School' where id = tests.tid('b');
create function pg_temp.sentence(p_tenant text, p_name text) returns text language sql as $$ select 'I, ' || p_name || ', allow Stack19 to create an AI voice of me for ' || (select name from public.tenants where id = tests.tid(p_tenant)) $$;
create function pg_temp.vid(p_n text) returns uuid language sql as $$ select tests.rid('ovc_' || p_n) $$;
-- put the two recordings in the workspace's bucket (what the API does with the Owner's token)
create function pg_temp.files(p_tenant text, p_n text, p_type text default 'audio/wav') returns void language plpgsql as $$
declare v_b text := app.ovc_bucket(tests.tid(p_tenant)); v_id text := pg_temp.vid(p_n)::text;
begin
  insert into storage.buckets (id, name, public) values (v_b, v_b, false) on conflict (id) do nothing;
  insert into storage.objects (bucket_id, name, metadata) values
    (v_b, v_id || '/sample.wav', jsonb_build_object('mimetype', p_type, 'size', 300000)),
    (v_b, v_id || '/consent.wav', jsonb_build_object('mimetype', p_type, 'size', 60000));
end $$;
create function pg_temp.begin_(p_user text, p_tenant text, p_n text, p_name text, p_sentence text default null, p_sample_s numeric default 32.5, p_consent_s numeric default 6) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.own_voice_begin(%L, %L, %L, %L, %L, %s, %L, %s)::text$q$, tests.tid(p_tenant), pg_temp.vid(p_n), p_name,
         coalesce(p_sentence, pg_temp.sentence(p_tenant, p_name)), pg_temp.vid(p_n)::text || '/sample.wav', p_sample_s, pg_temp.vid(p_n)::text || '/consent.wav', p_consent_s)) $$;
create function pg_temp.ready(p_user text, p_tenant text, p_n text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.own_voice_ready(%L, %L, 'fake', 'fake_clone_abc123')::text$q$, tests.tid(p_tenant), pg_temp.vid(p_n))) $$;
create function pg_temp.get(p_user text, p_tenant text) returns text language sql as $$ select pg_temp.val(p_user, format($q$select public.own_voice_get(%L)::text$q$, tests.tid(p_tenant))) $$;

-- ============================================================================ B. the sentence
select is(pg_temp.val('a_owner', format($q$select public.own_voice_sentence(%L, 'Suresh Kumar')$q$, tests.tid('a'))), 'I, Suresh Kumar, allow Stack19 to create an AI voice of me for Sri Lakshmi Silks', 'B1 the sentence names the person and the business');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_sentence(%L, '  Suresh Kumar  ')$q$, tests.tid('a'))), 'I, Suresh Kumar, allow Stack19 to create an AI voice of me for Sri Lakshmi Silks', 'B2 padding is trimmed');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_sentence(%L, 'A')$q$, tests.tid('a'))), 'ERR:22023', 'B3 a name of at least two characters');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_sentence(%L, 'a<b>c')$q$, tests.tid('a'))), 'ERR:22023', 'B4 no markup in a name');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_sentence(%L, 'a@b.c')$q$, tests.tid('a'))), 'ERR:22023', 'B5 no at-sign');
select is(pg_temp.val('a_admin', format($q$select public.own_voice_sentence(%L, 'Suresh Kumar')$q$, tests.tid('a'))), 'ERR:42501', 'B6 DENY: an Admin');
select is(pg_temp.val('b_owner', format($q$select public.own_voice_sentence(%L, 'Suresh Kumar')$q$, tests.tid('a'))), 'ERR:42501', 'B7 DENY: another business''s Owner');

-- ============================================================================ A. who  /  C. making it
select pg_temp.files('a', '1');
select is(pg_temp.begin_('a_admin', 'a', '1', 'Suresh Kumar'), 'ERR:42501', 'A1 DENY: an Admin cannot record a consent');
select is(pg_temp.begin_('a_sales', 'a', '1', 'Suresh Kumar'), 'ERR:42501', 'A2 DENY: Sales');
select is(pg_temp.begin_('a_viewer', 'a', '1', 'Suresh Kumar'), 'ERR:42501', 'A3 DENY: a Viewer');
select is(pg_temp.begin_('b_owner', 'a', '1', 'Suresh Kumar'), 'ERR:42501', 'A4 DENY: another business''s Owner');
select is(pg_temp.begin_('anon', 'a', '1', 'Suresh Kumar'), 'ERR:42501', 'A5 DENY: anon');
select is(pg_temp.val1('a_owner', format($q$select public.own_voice_begin(%L, %L, 'Suresh Kumar', %L, %L, 32.5, %L, 6)::text$q$, tests.tid('a'), pg_temp.vid('1'), pg_temp.sentence('a', 'Suresh Kumar'), pg_temp.vid('1')::text || '/sample.wav', pg_temp.vid('1')::text || '/consent.wav')), 'ERR:SM306', 'A6 the Owner needs the second factor');
select is(pg_temp.val1('a_owner', format($q$select public.own_voice_ensure_bucket(%L)$q$, tests.tid('a'))), 'ERR:SM306', 'A7 ...also to open the bucket');
select is(pg_temp.val('a_admin', format($q$select public.own_voice_ensure_bucket(%L)$q$, tests.tid('a'))), 'ERR:42501', 'A8 DENY: an Admin cannot open the bucket');
select is((select count(*)::int from public.own_voices), 0, 'A9 nothing refused wrote a record');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_ensure_bucket(%L)$q$, tests.tid('a'))), 'ovc-' || tests.tid('a')::text, 'A10 the Owner opens the workspace''s private bucket');
select is((select public from storage.buckets where id = app.ovc_bucket(tests.tid('a'))), false, 'A11 the bucket is private');

select is(pg_temp.begin_('a_owner', 'a', '1', 'Suresh Kumar', 'I, Suresh Kumar, allow somebody to use my voice for anything they like at all'), 'ERR:SM833', 'C1 a sentence that is not the one to read is refused (SM833)');
select is(pg_temp.begin_('a_owner', 'a', '1', 'Suresh Kumar', pg_temp.sentence('a', 'Someone Else')), 'ERR:SM833', 'C2 the name in the sentence must be the name given');
select is(pg_temp.begin_('a_owner', 'a', '1', 'Suresh Kumar', pg_temp.sentence('b', 'Suresh Kumar')), 'ERR:SM833', 'C3 and the business must be this one');
select is(pg_temp.begin_('a_owner', 'a', '1', 'Suresh Kumar', null, 14.9), 'ERR:22023', 'C4 a sample of at least 15 seconds');
select is(pg_temp.begin_('a_owner', 'a', '1', 'Suresh Kumar', null, 60.1), 'ERR:22023', 'C5 ...at most 60');
select is(pg_temp.begin_('a_owner', 'a', '1', 'Suresh Kumar', null, 32.5, 1.9), 'ERR:22023', 'C6 a consent recording of at least 2 seconds');
select is(pg_temp.begin_('a_owner', 'a', '1', 'Suresh Kumar', null, 32.5, 30.1), 'ERR:22023', 'C7 ...at most 30');
select is(pg_temp.begin_('a_owner', 'a', '2', 'Suresh Kumar'), 'ERR:SM832', 'C8 recordings that are not in the bucket are refused (SM832)');
select pg_temp.files('a', '3', 'text/html');
select is(pg_temp.begin_('a_owner', 'a', '3', 'Suresh Kumar'), 'ERR:SM832', 'C9 files that are not audio are refused');
select is((select count(*)::int from public.own_voices), 0, 'C10 nothing refused wrote a record');
select is((pg_temp.begin_('a_owner', 'a', '1', 'Suresh Kumar')::jsonb ->> 'status'), 'pending', 'C11 the consent is recorded (pending)');
select is((select consenting_name || '|' || consent_sentence from public.own_voices where id = pg_temp.vid('1')), 'Suresh Kumar|I, Suresh Kumar, allow Stack19 to create an AI voice of me for Sri Lakshmi Silks', 'C12 the name and the exact sentence are kept');
select is((select consented_by from public.own_voices where id = pg_temp.vid('1')), tests.uid('a_owner'), 'C13 with who consented');
select is((select (consented_at = timestamptz '2026-10-26T12:00:00+05:30')::text from public.own_voices where id = pg_temp.vid('1')), 'true', 'C14 and when');
select is((select sample_bytes || '/' || consent_bytes from public.own_voices where id = pg_temp.vid('1')), '300000/60000', 'C15 the database read the sizes from the files themselves');
select is((pg_temp.get('a_owner', 'a')::jsonb ->> 'status') || '/' || (pg_temp.get('a_owner', 'a')::jsonb -> 'languages')::text, 'pending/[]', 'C16 not selectable until the provider has made it');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_private(%L)::text$q$, tests.tid('a')))::jsonb ->> 'sample_path', pg_temp.vid('1')::text || '/sample.wav', 'C17 the Owner (only) can ask where the files are, to delete them');
select is(pg_temp.val('a_admin', format($q$select public.own_voice_private(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C18 DENY: not an Admin');
select is(pg_temp.ready('a_admin', 'a', '1'), 'ERR:42501', 'C19 DENY: an Admin cannot make it ready');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_ready(%L, %L, 'razorpay', 'abc123')::text$q$, tests.tid('a'), pg_temp.vid('1'))), 'ERR:22023', 'C20 only the fake provider exists');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_ready(%L, %L, 'fake', 'x')::text$q$, tests.tid('a'), pg_temp.vid('1'))), 'ERR:22023', 'C21 a provider id of 3 to 100 safe characters');
select is((pg_temp.ready('a_owner', 'a', '1')::jsonb ->> 'status'), 'ready', 'C22 the provider made the voice: ready');
select is((pg_temp.get('a_owner', 'a')::jsonb -> 'languages'), '["en", "te", "hi", "kn"]'::jsonb, 'C23 it speaks four languages');
select is((select count(*)::int from voice.voices where code like 'own-%' and active), 4, 'C24 four voices of the catalogue are the workspace''s own');
select is(pg_temp.ready('a_owner', 'a', '1'), 'ERR:23503', 'C25 ready is said once');
select is((pg_temp.get('a_admin', 'a')::jsonb ->> 'status'), 'ready', 'C26 an Admin sees the status');
select is(pg_temp.get('a_sales', 'a'), 'ERR:42501', 'C27 DENY: Sales');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'C28 DENY: another business');
select is((pg_temp.get('b_owner', 'b')::jsonb ->> 'status'), 'none', 'C29 another business has none');

-- ============================================================================ E. one at a time
select pg_temp.files('a', '4');
select is(pg_temp.begin_('a_owner', 'a', '4', 'Suresh Kumar'), 'ERR:SM831', 'E1 a second voice is refused while one lives (SM831)');
select is(pg_temp.sc(format($q$insert into public.own_voices (id, tenant_id, status, consenting_name, consent_sentence, consented_by, consented_at, bucket, sample_path, consent_path) values (%L, %L, 'pending', 'Dup Person', 'I, Dup Person, allow Stack19 to create an AI voice of me for X', %L, now(), %L, %L, %L)$q$,
                            pg_temp.vid('9'), tests.tid('a'), tests.uid('a_owner'), app.ovc_bucket(tests.tid('a')), pg_temp.vid('9')::text || '/sample.wav', pg_temp.vid('9')::text || '/consent.wav')), '23505', 'E2 and the table itself allows one live voice per workspace');

-- ============================================================================ D. selectable in the assistant settings
create function pg_temp.settings(p_persona text) returns text language sql as $$
  select jsonb_build_object('name', 'Vani', 'voice_persona', p_persona, 'main_language', 'te', 'auto_switch_language', true, 'allow_english_mixing', true, 'style', 'warm', 'speed', 1.0, 'may_answer_prices', true,
    'may_book_visits', true, 'may_send_media', true, 'may_talk_dues', false, 'max_discount_percent', 5, 'handover_owner_asked', true, 'handover_upset', true, 'handover_order_above_paise', null,
    'call_days', jsonb_build_array(1, 2, 3, 4, 5, 6), 'call_from_minute', 540, 'call_to_minute', 1140)::text $$;
create function pg_temp.save(p_user text, p_tenant text, p_persona text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.assistant_settings_save(%L, %L::jsonb)::text$q$, tests.tid(p_tenant), pg_temp.settings(p_persona))) $$;
select is((select count(*)::int from jsonb_array_elements(pg_temp.val('a_owner', format($q$select public.assistant_voices(%L)::text$q$, tests.tid('a')))::jsonb) e where e ->> 'persona' = 'own_voice'), 4, 'D1 the Owner''s own voice is listed as the persona own_voice in four languages');
select is((select count(*)::int from jsonb_array_elements(pg_temp.val('b_owner', format($q$select public.assistant_voices(%L)::text$q$, tests.tid('b')))::jsonb) e where e ->> 'persona' = 'own_voice'), 0, 'D2 another business is not offered it');
select is((select count(*)::int from jsonb_array_elements(pg_temp.val('a_owner', format($q$select public.assistant_voices(%L)::text$q$, tests.tid('a')))::jsonb) e where e ->> 'persona' = 'female_warm'), 5, 'D3 the stock personas are still there');
select is(pg_temp.save('b_owner', 'b', 'own_voice'), 'ERR:22023', 'D4 a business without a voice cannot choose it');
select is((pg_temp.save('a_owner', 'a', 'own_voice')::jsonb -> 'settings' ->> 'voice_persona'), 'own_voice', 'D5 the Owner chooses it');
select is((select voice_persona from public.assistant_settings where tenant_id = tests.tid('a')), 'own_voice', 'D6 and it is saved');
select is(pg_temp.save('a_owner', 'a', 'robot_voice'), 'ERR:22023', 'D7 an unknown persona is still invalid');
select is((pg_temp.save('a_owner', 'a', 'female_clear')::jsonb -> 'settings' ->> 'voice_persona'), 'female_clear', 'D8 a stock persona still works');
select pg_temp.save('a_owner', 'a', 'own_voice');

-- ============================================================================ F. deleting
select is(pg_temp.val('a_admin', format($q$select public.own_voice_deleted(%L, %L)::text$q$, tests.tid('a'), pg_temp.vid('1'))), 'ERR:42501', 'F1 DENY: an Admin cannot delete');
select is(pg_temp.val1('a_owner', format($q$select public.own_voice_deleted(%L, %L)::text$q$, tests.tid('a'), pg_temp.vid('1'))), 'ERR:SM306', 'F2 the Owner needs the second factor');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_deleted(%L, %L)::text$q$, tests.tid('a'), pg_temp.vid('1'))), 'ERR:SM832', 'F3 while a recording is still in the bucket the record cannot say deleted');
select set_config('storage.allow_delete_query', 'true', true);   -- Storage refuses a direct delete unless this is set (the API deletes through the Storage service)
delete from storage.objects where bucket_id = app.ovc_bucket(tests.tid('a')) and name like pg_temp.vid('1')::text || '/%';
select is((pg_temp.val('a_owner', format($q$select public.own_voice_deleted(%L, %L)::text$q$, tests.tid('a'), pg_temp.vid('1')))::jsonb ->> 'status'), 'deleted', 'F4 with both recordings gone, the voice is deleted');
select is((select consenting_name is null and consent_sentence is null and sample_path is null and consent_path is null and provider_voice_id is null and bucket is null and deleted_at is not null from public.own_voices where id = pg_temp.vid('1')), true, 'F5 the name, the sentence, the paths and the provider id are gone from the record');
select is((select consented_by from public.own_voices where id = pg_temp.vid('1')), tests.uid('a_owner'), 'F6 who consented and when stay (without the name)');
select is((select count(*)::int from voice.voices where code like 'own-%' and active), 0, 'F7 the voices stop being selectable');
select is((select voice_persona from public.assistant_settings where tenant_id = tests.tid('a')), 'female_warm', 'F8 an assistant that used it goes back to a stock voice');
select is((pg_temp.get('a_owner', 'a')::jsonb ->> 'status'), 'deleted', 'F9 the status says deleted');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_private(%L)::text$q$, tests.tid('a'))), 'null', 'F10 nothing live is left to delete');
select is(pg_temp.save('a_owner', 'a', 'own_voice'), 'ERR:22023', 'F11 and it can no longer be chosen');
select is(pg_temp.val('a_owner', format($q$select public.own_voice_deleted(%L, %L)::text$q$, tests.tid('a'), pg_temp.vid('1'))), 'ERR:23503', 'F12 deleting twice is "not found"');
select pg_temp.files('a', '5');
select is((pg_temp.begin_('a_owner', 'a', '5', 'Suresh Kumar')::jsonb ->> 'status'), 'pending', 'F13 after a deletion a new voice can be made');
select is((pg_temp.ready('a_owner', 'a', '5')::jsonb ->> 'status'), 'ready', 'F14 ...and is ready');
select is((select count(*)::int from voice.voices where code like 'own-%' and active), 4, 'F15 the four voices are active again');
select is((pg_temp.val('a_owner', format($q$select public.own_voice_failed(%L, %L)::text$q$, tests.tid('a'), pg_temp.vid('5'))) like 'ERR%')::text, 'true', 'F16 a ready voice cannot be marked failed');

-- ============================================================================ G. what the table and the bucket keep
select is((select count(*)::int from public.own_voices where tenant_id = tests.tid('a')), 2, 'G1 the deleted record stays (no personal data), the live one too');
select is(pg_temp.sc(format($q$delete from public.own_voices where id = %L$q$, pg_temp.vid('1'))), '42501', 'G2 a record is never deleted');
select is(pg_temp.sc('truncate public.own_voices'), '42501', 'G3 nor truncated');
select is(pg_temp.sc(format($q$update public.own_voices set consented_by = %L where id = %L$q$, tests.uid('a_admin'), pg_temp.vid('5'))), '42501', 'G4 who consented never changes');
select is(pg_temp.sc(format($q$update public.own_voices set status = 'pending' where id = %L$q$, pg_temp.vid('1'))), '42501', 'G5 a deleted voice never comes back');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'ovc_objects_%'), 3, 'G6 the bucket has its three rules (read, add, remove): the Owner''s alone');
select is(pg_temp.val('a_admin', format($q$select count(*)::text from storage.objects where bucket_id = %L$q$, app.ovc_bucket(tests.tid('a')))), '0', 'G7 an Admin cannot hear the recordings');
select is(pg_temp.val('a_owner', format($q$select count(*)::text from storage.objects where bucket_id = %L$q$, app.ovc_bucket(tests.tid('a')))), '2', 'G8 the Owner sees their own two');
select is(pg_temp.val('b_owner', format($q$select count(*)::text from storage.objects where bucket_id = %L$q$, app.ovc_bucket(tests.tid('a')))), '0', 'G9 another business''s Owner sees none');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'own_voices' and column_name ~* '(audio|blob|bytea|embedding|raw)'), 0, 'G10 no column holds audio');
select is((select count(*)::int from erasure.registry where table_name = 'own_voices' and scope = 'tenant'), 2, 'G11 the name and the sentence are in the erasure registry');

-- ============================================================================ H. doors
select is(pg_temp.val('a_owner', $q$insert into public.own_voices (id, tenant_id, status, consented_by, consented_at) values (gen_random_uuid(), gen_random_uuid(), 'ready', gen_random_uuid(), now())$q$), 'ERR:42501', 'H1 a client cannot insert directly');
select is(pg_temp.val('a_owner', $q$update public.own_voices set status = 'deleted'$q$), 'ERR:42501', 'H2 nor update');
select is(pg_temp.val('a_sales', 'select count(*)::text from public.own_voices'), '0', 'H3 Sales reads no record');
select is(pg_temp.val('a_admin', 'select count(*)::text from public.own_voices'), '2', 'H4 an Admin reads the records of the workspace (no files)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'own\_voice\_%' and has_function_privilege('anon', p.oid, 'execute')), 0, 'H5 anon can run none of the functions');

select * from finish();
rollback;
