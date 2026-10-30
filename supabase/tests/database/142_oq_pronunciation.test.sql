-- Job pronunciation-quality: the workspace's own pronunciation words. A catalog  B reads and roles  C saving, the upsert and bounds  D deleting
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.list(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.pronunciation_list(%L)::text', tests.tid(p_tenant))) $$;
create function pg_temp.save(p_user text, p_word text, p_sound text, p_lang text default null, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.pronunciation_set(%L, %L, %L, %L)::text', tests.tid(p_tenant), p_word, p_sound, p_lang)) $$;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('pronunciation_list', 'pronunciation_set', 'pronunciation_delete')
  and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 3::bigint, 'A1: three security-definer functions for signed-in members only');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and table_name = 'pronunciation_words' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A2: the table is reached only through the functions');

select is(pg_temp.list('a_viewer'), '[]', 'B1: nothing saved yet; every member reads the list');
select is(pg_temp.list('b_owner', 'a'), 'ERR:42501', 'B2: another business reads nothing of ours');
select is(pg_temp.list('anon'), 'ERR:42501', 'B3: anon neither');
select is(pg_temp.save('a_sales', 'Neelambari', 'Neel-um-buh-ree'), 'ERR:42501', 'B4: Sales cannot save a word');
select is(pg_temp.save('a_viewer', 'Neelambari', 'Neel-um-buh-ree'), 'ERR:42501', 'B5: nor a viewer');
select is(pg_temp.save('b_owner', 'Neelambari', 'Neel-um-buh-ree', null, 'a'), 'ERR:42501', 'B6: nor another business''s Owner');
select is(pg_temp.save('anon', 'Neelambari', 'Neel-um-buh-ree'), 'ERR:42501', 'B7: nor anon');

select is((pg_temp.save('a_owner', 'Neelambari', 'Neel-um-buh-ree', 'en')::jsonb - 'id'), '{"word": "Neelambari", "sounds_like": "Neel-um-buh-ree", "language": "en", "source": "owner"}'::jsonb, 'C1: the Owner saves a word');
select is(jsonb_array_length(pg_temp.list('a_sales')::jsonb), 1, 'C2: a member reads it back');
select is((pg_temp.save('a_admin', ' neelambari ', 'Nee-lum-buh-ree')::jsonb ->> 'sounds_like'), 'Nee-lum-buh-ree', 'C3: an Admin saves the same word in any case: it is changed, not added');
select is(jsonb_array_length(pg_temp.list('a_owner')::jsonb), 1, 'C4: still one row');
select is((pg_temp.list('a_owner')::jsonb -> 0 ->> 'language'), null, 'C5: the language of the later save (all languages) replaced the first');
select is(pg_temp.save('a_owner', '', 'x'), 'ERR:22023', 'C6: a word is needed');
select is(pg_temp.save('a_owner', repeat('w', 61), 'x'), 'ERR:22023', 'C7: at most 60 characters');
select is(pg_temp.save('a_owner', 'w', repeat('s', 81)), 'ERR:22023', 'C8: a sound of at most 80');
select is(pg_temp.save('a_owner', 'w', 'x', 'xx'), 'ERR:22023', 'C9: a language of the product');
select is(pg_temp.save('a_owner', 'w', 'x' || chr(7)), 'ERR:22023', 'C10: clean text only');
select is(pg_temp.list('b_owner', 'b'), '[]', 'C11: the other business has none');
insert into workspace.pronunciation_words (workspace_id, word, sounds_like) select tests.tid('a'), 'w' || n, 's' from generate_series(1, 199) n;
select is(pg_temp.save('a_owner', 'one more', 'x'), 'ERR:22023', 'C12: at most 200 words a workspace');
select is((pg_temp.save('a_owner', 'w1', 'changed')::jsonb ->> 'sounds_like'), 'changed', 'C13: ...but a word already there can still be changed');

select is(pg_temp.sc('a_sales', format($q$select public.pronunciation_delete(%L, %L)$q$, tests.tid('a'), (select id from workspace.pronunciation_words where workspace_id = tests.tid('a') limit 1))), 'ERR:42501', 'D1: Sales cannot delete');
select is(pg_temp.sc('b_owner', format($q$select public.pronunciation_delete(%L, %L)$q$, tests.tid('b'), (select id from workspace.pronunciation_words where workspace_id = tests.tid('a') limit 1))), 'false', 'D2: another business''s Owner deletes nothing of ours');
select is(pg_temp.sc('a_admin', format($q$select public.pronunciation_delete(%L, %L)$q$, tests.tid('a'), (select id from workspace.pronunciation_words where workspace_id = tests.tid('a') and word = 'w2'))), 'true', 'D3: an Admin deletes a word');
select is((select count(*) from workspace.pronunciation_words where workspace_id = tests.tid('a') and word = 'w2'), 0::bigint, 'D4: and it is gone');

select * from finish();
rollback;
