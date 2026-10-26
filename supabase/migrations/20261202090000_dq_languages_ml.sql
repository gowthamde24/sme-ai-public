-- Job DQ part 3: Malayalam ('ml') joins the call and WhatsApp languages (en, te, hi, kn, ta, ml). The app's own screens stay en/te/hi/kn (the sign-up, pack-activation and account language lists are NOT touched: they list four).
--
-- Where the database lists the five call/WhatsApp languages ('en', 'te', 'hi', 'kn', 'ta') it is in two kinds of place: CHECK constraints on language columns and the literal lists inside functions that validate a language argument.
-- Writing each of ~60 of them out again would copy a lot of code that other jobs own, so this migration REWRITES them from the catalog: every constraint and every function that lists 'kn', 'ta' gets 'ml' after 'ta'
-- (the function is re-created with CREATE OR REPLACE from its own definition, so its owner, grants, settings, body and comment stay exactly as they were; only the list grows). The two small length limits that count the languages
-- (a workspace report and an institution's parent languages: at most 5) become 6. The test supabase/tests/database/124_dq_languages.test.sql fails if a later migration brings a five-language list back.

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
       and pg_get_constraintdef(c.oid) ~ $re$'kn'::text, 'ta'::text$re$
       and pg_get_constraintdef(c.oid) !~ $re$'ml'::text$re$
  loop
    v_new := regexp_replace(r.def, $re$('kn'::text, 'ta'::text)$re$, $re$\1, 'ml'::text$re$, 'g');
    v_new := regexp_replace(v_new, $re$cardinality\((\w*languages)\) <= 5$re$, $re$cardinality(\1) <= 6$re$, 'g');
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
       and p.prosrc ~ $re$'kn'\s*,\s*'ta'$re$
       and p.prosrc !~ $re$'ml'$re$
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, $re$('kn'\s*,\s*'ta')$re$, $re$\1, 'ml'$re$, 'g');
    if v_new = v_def then
      raise exception 'dq_languages: nothing to change in %', r.proname;
    end if;
    execute v_new;
    v_n_functions := v_n_functions + 1;
  end loop;

  raise notice 'dq_languages: % constraints and % functions now list ml', v_n_constraints, v_n_functions;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The words that decide what a person must read before it goes, and the AI line: Malayalam needs its own (a list that does not know a language lets a price in that language through as "automatic").
-- Both functions are rewritten from their own definition with the Malayalam words added, so nothing else about them changes. First drafts: a native reader should check every word (docs/runbooks/native-review-kit.md).
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  -- content flags: money | commitment | complaint, plus Malayalam digits in the currency-sign rule
  v_def := pg_get_functiondef('app.outbox_content_flags(text)'::regprocedure);
  v_new := v_def;
  if position('|லட்சம்|கோடி)' in v_new) = 0 or position('|கேரண்டி)' in v_new) = 0 or position('|தாமதம்|தவறு)' in v_new) = 0 then
    raise exception 'dq_languages: the content-flag function is not the one this migration expects';
  end if;
  v_new := replace(v_new, '|லட்சம்|கோடி)', '|லட்சம்|கோடி'
        || '|രൂപ|രൂ\.|വില|നിരക്ക്|ചെലവ്|ഡിസ്കൗണ്ട്|കിഴിവ്|ജിഎസ്ടി|നികുതി|അഡ്വാൻസ്|മുൻകൂർ|പണം|അടയ്ക്ക|പേയ്മെന്റ്|റീഫണ്ട്|ക്രെഡിറ്റ്|കടം|യുപിഐ|ബാങ്ക്|ബിൽ|ഇൻവോയ്സ്|ആകെ|ഇഎംഐ|ചെക്ക്|ബാക്കി|കുടിശ്ശിക|ഫീസ്|ലക്ഷം|കോടി)');
  v_new := replace(v_new, '|கேரண்டி)', '|கேரண்டி|ഉറപ്പ്|വാഗ്ദാനം|ഗ്യാരണ്ടി|വാറണ്ടി)');
  v_new := replace(v_new, '|தாமதம்|தவறு)', '|தாமதம்|தவறு|പരാതി|പ്രശ്നം|കേടായ|തകരാർ|വഞ്ചന|ദേഷ്യം|അസംതൃപ്തി|വൈകി|താമസം|തെറ്റ്)');
  v_new := replace(v_new, '௦-௯', '௦-௯൦-൯');
  if v_new = v_def then
    raise exception 'dq_languages: content flags unchanged';
  end if;
  execute v_new;

  -- the AI line of a WhatsApp message
  v_def := pg_get_functiondef('app.outbox_disclosure(text)'::regprocedure);
  if position('else ''This message is from' in v_def) = 0 then
    raise exception 'dq_languages: the disclosure function is not the one this migration expects';
  end if;
  v_new := replace(v_def, 'else ''This message is from', 'when ''ml'' then ''ഈ സന്ദേശം ബിസിനസിന്റെ AI സഹായിയിൽ നിന്നുള്ളതാണ്.''' || E'\n    ' || 'else ''This message is from');
  execute v_new;
end;
$$;

-- the voice catalogue: a synthetic Malayalam voice (so a voice note in Malayalam can be tried with the fake engine) and the first draft of its spoken AI line
insert into voice.voices (code, provider, language, label, synthetic) values ('fake-ml', 'fake', 'ml', 'Synthetic Malayalam (no human voice)', true) on conflict (code) do nothing;
insert into voice.disclosures (language, version, status, text) values ('ml', 1, 'draft', 'ഇത് {{business}} ന്റെ AI സഹായിയിൽ നിന്നുള്ള ഒരു ഓട്ടോമാറ്റിക് വോയ്സ് സന്ദേശമാണ്.') on conflict (language, version) do nothing;
