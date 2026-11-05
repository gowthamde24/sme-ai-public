-- Marathi part M1 (migration 20261231190000): Marathi joins the call and WhatsApp languages as a draft. The database must list SEVEN (en, te, hi, kn, ta, ml, mr) everywhere it listed the six, and must not bring a six-language list back.
--   A no constraint or function lists 'ta', 'ml' without 'mr'   B the rows and functions really accept mr   C the app's own four-language lists are untouched   D the two length limits count seven   E the seeds and the per-language words
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.setstyle(p_doc text) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select public.speaking_style_set(%L, %L::jsonb)::text$q$, tests.tid('a'), p_doc)) $$;

-- ============================================================================ A. nothing left behind
select is((select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
             where c.contype = 'c' and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public', 'pgsodium', 'supabase_functions', 'net', 'cron', 'pgbouncer')
               and pg_get_constraintdef(c.oid) ~ $re$'ta'::text, 'ml'::text$re$ and pg_get_constraintdef(c.oid) !~ $re$'mr'::text$re$), 0,
          'A1 no CHECK constraint lists ta and ml without mr');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where p.prokind = 'f' and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public', 'pgsodium', 'supabase_functions', 'net', 'cron', 'pgbouncer')
               and p.prosrc ~ $re$'ta'\s*,\s*'ml'$re$ and p.prosrc !~ $re$'mr'$re$), 0,
          'A2 no function lists ta and ml without mr');
select cmp_ok((select count(*)::int from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$'ml'::text, 'mr'::text$re$), '>=', 20,
          'A3 the language constraints now carry mr (the rewrite did run)');
select cmp_ok((select count(*)::int from pg_proc p where p.prokind = 'f' and p.prosrc ~ $re$'ml'\s*,\s*'mr'$re$), '>=', 20,
          'A4 the language functions now carry mr');

-- ============================================================================ B. rows and functions accept mr
select tests.cn_guards_off();
select lives_ok(format($q$insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media, may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute)
                           values (%L, 'Vijaya', 'female_warm', 'mr', true, true, 'warm', 1.00, true, true, true, false, 5, true, true, array[1,2,3]::smallint[], 600, 1080)$q$, tests.tid('a')),
          'B1 assistant settings: main_language mr is accepted');
select throws_ok(format($q$insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media, may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute)
                           values (%L, 'Vijaya', 'female_warm', 'xx', true, true, 'warm', 1.00, true, true, true, false, 5, true, true, array[1,2,3]::smallint[], 600, 1080)$q$, tests.tid('b')), '23514', null, 'B2 a language that is not one of the seven is still refused');
select throws_ok(format($q$insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media, may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute)
                           values (%L, 'Vijaya', 'female_warm', 'bn', true, true, 'warm', 1.00, true, true, true, false, 5, true, true, array[1,2,3]::smallint[], 600, 1080)$q$, tests.tid('b')), '23514', null, 'B3 Bengali is not a call language yet');
select is(pg_temp.val('a_owner', format($q$select (public.speaking_style_get(%L) -> 'languages' -> 'mr' ->> 'region')$q$, tests.tid('a'))), 'neutral', 'B4 the speaking style lists Marathi (neutral by default)');
select isnt(pg_temp.setstyle('{"languages": {"mr": {"style": "everyday_pure", "region": "neutral"}}}'), 'ERR:22023', 'B5 a Marathi style with the neutral region is saved');
select is((select style from public.speaking_styles where tenant_id = tests.tid('a') and language = 'mr'), 'everyday_pure', 'B6 ... and stored');
select is(pg_temp.setstyle('{"languages": {"mr": {"style": "everyday_pure", "region": "coastal"}}}'), 'ERR:22023', 'B7 Marathi has no region but neutral');
select throws_ok(format($q$insert into public.speaking_styles (tenant_id, language, style, region, updated_by) values (%L, 'mr', 'formal', 'kongu', %L)$q$, tests.tid('b'), tests.uid('b_owner')), '23514', null,
          'B8 ... and the table refuses one too');

-- ============================================================================ C. the app's own screens still list four
select is((select count(*)::int from pg_constraint c where c.conrelid = 'public.account_setups'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$'mr'$re$), 0, 'C1 the sign-up language list stays at four (en, te, hi, kn)');
select is((select count(*)::int from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$'en'::text, 'te'::text, 'hi'::text, 'kn'::text\]$re$ and pg_get_constraintdef(c.oid) ~ $re$'mr'$re$), 0,
          'C2 no four-language list gained mr');
select cmp_ok((select count(*)::int from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$'en'::text, 'te'::text, 'hi'::text, 'kn'::text\]$re$), '>=', 1,
          'C3 the four-language lists are still there');

-- ============================================================================ D. the two length limits
select is((select count(*)::int from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$cardinality\(\w*languages\) <= [56]\)$re$), 0, 'D1 no length limit of 5 or 6 languages is left');
select is((select count(*)::int from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$cardinality\(\w*languages\) <= 7\)$re$), 2, 'D2 both length limits count seven');

-- ============================================================================ E. seeds and words
select is((select language from voice.voices where code = 'fake-mr'), 'mr', 'E1 the synthetic Marathi voice exists');
select is((select synthetic from voice.voices where code = 'fake-mr'), true, 'E2 ... and is synthetic (no human voice)');
select is((select count(*)::int from voice.voice_personas where language = 'mr' and voice_code = 'fake-mr'), 4, 'E3 the four personas have a Marathi voice');
select is((select status from voice.disclosures where language = 'mr' and version = 1), 'draft', 'E4 the spoken Marathi AI line is a draft (native review)');
select ok((select text from voice.disclosures where language = 'mr' and version = 1) ~ 'AI', 'E5 ... and says AI');
select ok(app.outbox_disclosure('mr') ~ 'AI' and app.outbox_disclosure('mr') ~ '[ऀ-ॿ]', 'E6 the WhatsApp AI line in Marathi says AI, in Devanagari');
select isnt(app.outbox_disclosure('mr'), app.outbox_disclosure('hi'), 'E7 ... and is not the Hindi one');
select ok('money' = any (app.outbox_content_flags('या साडीची किंमत किती आहे?')), 'E8 a Marathi price question is money');
select ok('money' = any (app.outbox_content_flags('दहा टक्के सवलत मिळेल')), 'E9 a Marathi discount is money');
select ok('complaint' = any (app.outbox_content_flags('माझी तक्रार आहे')), 'E10 a Marathi complaint is a complaint');
select ok('commitment' = any (app.outbox_content_flags('उद्या पोहोचेल याची हमी देतो')), 'E11 a Marathi promise is a commitment');
select is(app.outbox_content_flags('नमस्कार, तुम्हाला साडी आवडली का?'), '{}'::text[], 'E12 an ordinary Marathi sentence has no flag');
select is(app.outbox_content_flags('सुंदर साडी आहे'), '{}'::text[], 'E13 a word that merely contains दर is not money');

select * from finish();
rollback;
