-- Marathi part M1 (owner decision 5 Nov 2026): Marathi ('mr') joins the call and WhatsApp languages (en, te, hi, kn, ta, ml, mr) as a DRAFT: every Marathi word below is a first draft for a native reader
-- (docs/runbooks/native-review-kit.md). The app's own screens stay en/te/hi/kn (the sign-up, pack-activation, account, grievance and billing language lists are NOT touched: they list four and do not contain 'ta', 'ml').
--
-- Like job DQ's Malayalam migration (20261202090000_dq_languages_ml.sql), this REWRITES from the catalog: every CHECK constraint and every function whose language list contains 'ta', 'ml' and not yet 'mr' gets 'mr' after 'ml'
-- (a function is re-created with CREATE OR REPLACE from its own definition, so its owner, grants, settings, body and comment stay as they were; only the list grows). The lists that already accept mr
-- (workspace.opening_lines and public.opening_set_line, which list en..ml, mr, bn) are skipped. The two length limits that count the languages (a workspace report's languages and an institution's parent
-- languages: at most 6) become 7.
-- Speaking styles: the existing region rule (speaking_styles CHECK and speaking_style_set) lets only te, ta and kn have a region other than 'neutral', so Marathi gets 'neutral' only with no further change.
-- The test supabase/tests/database/165_mr_languages.test.sql fails if a later migration brings a six-language list back.

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_n_constraints integer := 0;
  v_n_functions integer := 0;
begin
  -- 1. CHECK constraints on user tables
  for r in
    select c.conrelid::regclass as rel, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'c'
       and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public', 'pgsodium', 'supabase_functions', 'net', 'cron', 'pgbouncer')
       and pg_get_constraintdef(c.oid) ~ $re$'ta'::text, 'ml'::text$re$
       and pg_get_constraintdef(c.oid) !~ $re$'mr'::text$re$
  loop
    v_new := regexp_replace(r.def, $re$('ta'::text, 'ml'::text)$re$, $re$\1, 'mr'::text$re$, 'g');
    v_new := regexp_replace(v_new, $re$cardinality\((\w*languages)\) <= 6$re$, $re$cardinality(\1) <= 7$re$, 'g');
    execute format('alter table %s drop constraint %I', r.rel, r.conname);
    execute format('alter table %s add constraint %I %s', r.rel, r.conname, v_new);
    v_n_constraints := v_n_constraints + 1;
  end loop;

  -- 2. functions that validate a language argument with a literal list
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.prokind = 'f'
       and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public', 'pgsodium', 'supabase_functions', 'net', 'cron', 'pgbouncer')
       and p.prosrc ~ $re$'ta'\s*,\s*'ml'$re$
       and p.prosrc !~ $re$'mr'$re$
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, $re$('ta'\s*,\s*'ml')$re$, $re$\1, 'mr'$re$, 'g');
    if v_new = v_def then
      raise exception 'mr_languages: nothing to change in %', r.proname;
    end if;
    execute v_new;
    v_n_functions := v_n_functions + 1;
  end loop;

  raise notice 'mr_languages: % constraints and % functions now list mr', v_n_constraints, v_n_functions;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The words that decide what a person must read before it goes, and the AI line: Marathi needs its own. Marathi is written in Devanagari like Hindi, so many Hindi words (रुपये, पैसे, बिल, शुल्क ...) already
-- match; these are the Marathi words the Hindi list does not have. Short words that occur inside ordinary words (दर, फी) are left out on purpose. First drafts: a native reader should check every word.
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('app.outbox_content_flags(text)'::regprocedure);
  v_new := v_def;
  if position('|ലക്ഷം|കോടി)' in v_new) = 0 or position('|വാറണ്ടി)' in v_new) = 0 or position('|തെറ്റ്)' in v_new) = 0 then
    raise exception 'mr_languages: the content-flag function is not the one this migration expects';
  end if;
  v_new := replace(v_new, '|ലക്ഷം|കോടി)', '|ലക്ഷം|കോടി'
        || '|किंमत|सवलत|रुपये|रुपया|पैसे|रक्कम|खर्च|आगाऊ|परतावा|उधारी|एकूण|थकबाकी|लाख|कोटी|हप्ता|भरणा)');
  v_new := replace(v_new, '|വാറണ്ടി)', '|വാറണ്ടി|हमी|खात्री|आश्वासन|गॅरंटी|वॉरंटी)');
  v_new := replace(v_new, '|തെറ്റ്)', '|തെറ്റ്|तक्रार|अडचण|फसवणूक|रागाव|उशीर|चूक|बिघड|तुटल)');
  if v_new = v_def then
    raise exception 'mr_languages: content flags unchanged';
  end if;
  execute v_new;

  -- the AI line of a WhatsApp message (it must say that it comes from an AI assistant)
  v_def := pg_get_functiondef('app.outbox_disclosure(text)'::regprocedure);
  if position('else ''This message is from' in v_def) = 0 or position('when ''mr''' in v_def) > 0 then
    raise exception 'mr_languages: the disclosure function is not the one this migration expects';
  end if;
  v_new := replace(v_def, 'else ''This message is from', 'when ''mr'' then ''हा संदेश व्यवसायाच्या AI सहाय्यकाकडून आला आहे.''' || E'\n    ' || 'else ''This message is from');
  execute v_new;
end;
$$;

-- the voice catalogue: a synthetic Marathi voice (so a voice note in Marathi can be tried with the fake engine; no real provider voice is added), the first draft of its spoken AI line, and the four personas' Marathi voice
insert into voice.voices (code, provider, language, label, synthetic) values ('fake-mr', 'fake', 'mr', 'Synthetic Marathi (no human voice)', true) on conflict (code) do nothing;
insert into voice.disclosures (language, version, status, text) values ('mr', 1, 'draft', 'हा {{business}} च्या AI सहाय्यकाकडून आलेला एक स्वयंचलित व्हॉइस संदेश आहे.') on conflict (language, version) do nothing;
insert into voice.voice_personas (persona, language, voice_code)
select p, 'mr', 'fake-mr' from unnest(array['female_warm', 'female_clear', 'male_calm', 'male_lively']) p
on conflict do nothing;
