-- Job DQ part 3 (migration 20261202090000): Malayalam joins the call and WhatsApp languages. The database must list SIX (en, te, hi, kn, ta, ml) everywhere it lists the five, and must not bring a five-language list back.
--   A no constraint or function lists 'kn', 'ta' without 'ml'   B the rows really accept ml   C the app's own four-language lists are untouched   D the two length limits count six
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

-- ============================================================================ A. nothing left behind
select is((select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
             where c.contype = 'c' and n.nspname in ('public', 'app', 'voice', 'integrations', 'privacy', 'billing', 'storage_app')
               and pg_get_constraintdef(c.oid) ~ $re$'kn'::text, 'ta'::text$re$ and pg_get_constraintdef(c.oid) !~ $re$'ml'::text$re$), 0,
          'A1 no CHECK constraint lists kn and ta without ml');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where p.prokind = 'f' and n.nspname in ('public', 'app', 'voice', 'integrations', 'privacy', 'billing')
               and p.prosrc ~ $re$'kn'\s*,\s*'ta'$re$ and p.prosrc !~ $re$'ml'$re$), 0,
          'A2 no function lists kn and ta without ml');
select cmp_ok((select count(*)::int from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$'ta'::text, 'ml'::text$re$), '>=', 10,
          'A3 many language constraints now carry ml (the rewrite did run)');
select cmp_ok((select count(*)::int from pg_proc p where p.prokind = 'f' and p.prosrc ~ $re$'ta'\s*,\s*'ml'$re$), '>=', 10,
          'A4 many functions now carry ml');

-- ============================================================================ B. rows accept ml
select tests.cn_guards_off();
select lives_ok(format($q$insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media, may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute)
                           values (%L, 'Vijaya', 'female_warm', 'ml', true, true, 'warm', 1.00, true, true, true, false, 5, true, true, array[1,2,3]::smallint[], 600, 1080)$q$, tests.tid('a')),
          'B1 assistant settings: main_language ml is accepted');
select throws_ok(format($q$insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media, may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute)
                           values (%L, 'Vijaya', 'female_warm', 'xx', true, true, 'warm', 1.00, true, true, true, false, 5, true, true, array[1,2,3]::smallint[], 600, 1080)$q$, tests.tid('b')), '23514', null, 'B2 a language that is not one of the six is still refused');

-- ============================================================================ C. the app's own screens still list four
select is((select count(*)::int from pg_constraint c where c.conrelid = 'public.account_setups'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$'ml'$re$), 0, 'C1 the sign-up language list stays at four (en, te, hi, kn)');

-- ============================================================================ D. the two length limits
select is((select count(*)::int from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ $re$cardinality\(\w*languages\) <= 5$re$), 0, 'D1 no length limit of 5 languages is left');

select * from finish();
rollback;
