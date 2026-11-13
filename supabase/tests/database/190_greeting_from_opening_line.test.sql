-- ONE greeting (13 Nov 2026): the migration copies a workspace's old opening line into its Talk training greeting where the language has none, never over an existing greeting, never a doubtful line,
-- and gives a workspace with no training document none.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.run_migration() returns void language plpgsql as $m$
begin
  execute $q$with legacy as (
  select l.workspace_id, jsonb_object_agg(l.language, btrim(l.line)) as lines
    from workspace.opening_lines l
   where l.campaign_key = '00000000-0000-0000-0000-000000000000'
     and l.language in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr')
     and char_length(btrim(l.line)) between 2 and 200
     and btrim(l.line) !~* '₹|\yrs\.?\s?[0-9]|[0-9]\s?%|[0-9]+\s*(lakh|crore|rupees)|\y(guarantee|guaranteed|promise|promised|assure|assured|warranty)\y'
   group by l.workspace_id
)
update public.talk_training t
   set doc = jsonb_set(t.doc, '{greeting}', legacy.lines || coalesce(t.doc -> 'greeting', '{}'::jsonb), true)
  from legacy
 where legacy.workspace_id = t.tenant_id
   and jsonb_typeof(coalesce(t.doc -> 'greeting', '{}'::jsonb)) = 'object'
   and (legacy.lines || coalesce(t.doc -> 'greeting', '{}'::jsonb)) is distinct from coalesce(t.doc -> 'greeting', '{}'::jsonb);$q$;
end $m$;

-- tenant A: opening lines in four languages and one for a campaign; a training document with a Telugu greeting already
select pg_temp.sc('a_owner', format($q$select public.opening_set_line(%L, 'en', null, 'Welcome to {business}, how can we help you today?')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.opening_set_line(%L, 'te', null, 'పాత తెలుగు లైన్ అందరికీ స్వాగతం.')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.opening_set_line(%L, 'kn', null, 'Come now: 20%% off on every saree today.')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.opening_set_line(%L, 'hi', %L, 'Campaign only line, for the campaign.')$q$, tests.tid('a'), tests.rid('camp')));
select pg_temp.sc('a_owner', format($q$select public.talk_training_save(%L, '{"greeting": {"te": "Saved Telugu greeting"}, "questions": ["What do you need?"]}'::jsonb)$q$, tests.tid('a')));
-- tenant B: an opening line but no training document
select pg_temp.sc('b_owner', format($q$select public.opening_set_line(%L, 'en', null, 'Welcome to our shop, how can we help?')$q$, tests.tid('b')));

select pg_temp.run_migration();
select is((select doc -> 'greeting' ->> 'en' from public.talk_training where tenant_id = tests.tid('a')), 'Welcome to {business}, how can we help you today?', 'a language with no greeting gets the old workspace line');
select is((select doc -> 'greeting' ->> 'te' from public.talk_training where tenant_id = tests.tid('a')), 'Saved Telugu greeting', 'NEVER OVER A SAVED GREETING');
select is((select doc -> 'greeting' ->> 'kn' from public.talk_training where tenant_id = tests.tid('a')), null, 'a line with a percentage is not copied (it stays the fallback)');
select is((select doc -> 'greeting' ->> 'hi' from public.talk_training where tenant_id = tests.tid('a')), null, 'a campaign''s own line is not copied');
select is((select doc -> 'questions' ->> 0 from public.talk_training where tenant_id = tests.tid('a')), 'What do you need?', 'the rest of the document is untouched');
select is((select count(*) from public.talk_training where tenant_id = tests.tid('b')), 0::bigint, 'a workspace with no training document is not given one (it would hide its pack defaults)');
select is((select count(*) from workspace.opening_lines where workspace_id = tests.tid('a')), 4::bigint, 'the old lines are all still there');
select pg_temp.run_migration();
select is((select jsonb_object_keys_count from (select count(*) as jsonb_object_keys_count from jsonb_object_keys((select doc -> 'greeting' from public.talk_training where tenant_id = tests.tid('a')))) x), 2::bigint, 'IDEMPOTENT: a second run changes nothing (two greetings: en, te)');

select * from finish();
rollback;
