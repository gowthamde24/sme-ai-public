-- Job voice-picker: the workspace's chosen voice per language. A catalog  B reads and roles  C setting, clearing, validation  D audit
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');           -- a setting like the opening line: no second factor is asked
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.get(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.call_voice_get(%L)::text', tests.tid(p_tenant))) $$;
create function pg_temp.setv(p_user text, p_lang text, p_voice text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.call_voice_set(%L, %L, %L)::text', tests.tid(p_tenant), p_lang, p_voice)) $$;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('call_voice_get', 'call_voice_set')
  and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 2::bigint, 'A1: two definer functions with a fixed search path, for signed-in people only');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and table_name = 'call_call_voices' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A2: no client holds a grant on the table');

select is(pg_temp.get('a_viewer')::jsonb, '{"choices": {}}'::jsonb, 'B1: nothing chosen = empty (the default speaks)');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'B2: another business reads nothing of ours');
select is(pg_temp.get('anon'), 'ERR:42501', 'B3: anon neither');
select is(pg_temp.setv('a_viewer', 'te', 'te-sindhu'), 'ERR:42501', 'B4: a viewer cannot choose');
select is(pg_temp.setv('a_sales', 'te', 'te-sindhu'), 'ERR:42501', 'B5: nor Sales');
select is(pg_temp.setv('b_owner', 'te', 'te-sindhu', 'a'), 'ERR:42501', 'B6: nor another business''s Owner');

select is(pg_temp.setv('a_owner', 'te', 'te-sindhu')::jsonb, '{"choices": {"te": "te-sindhu"}}'::jsonb, 'C1: the Owner chooses a Telugu voice');
select is(pg_temp.setv('a_admin', 'hi', 'hi-esha')::jsonb, '{"choices": {"te": "te-sindhu", "hi": "hi-esha"}}'::jsonb, 'C2: an Admin chooses too; the choices are per language');
select is(pg_temp.get('a_viewer')::jsonb -> 'choices' ->> 'hi', 'hi-esha', 'C3: every member reads the choice');
select is(pg_temp.setv('a_owner', 'te', 'te-ramya')::jsonb -> 'choices' ->> 'te', 'te-ramya', 'C4: changing a choice replaces it');
select is(pg_temp.setv('a_owner', 'te', null)::jsonb, '{"choices": {"hi": "hi-esha"}}'::jsonb, 'C5: null clears it (back to the default)');
select is(pg_temp.setv('a_owner', 'te', null)::jsonb, '{"choices": {"hi": "hi-esha"}}'::jsonb, 'C6: clearing what is not there is fine');
select is(pg_temp.setv('a_owner', 'xx', 'xx-abc'), 'ERR:22023', 'C7: a language of the call set only');
select is(pg_temp.setv('a_owner', 'te', 'hi-esha'), 'ERR:22023', 'C8: a voice of another language is refused');
select is(pg_temp.setv('a_owner', 'te', 'TE-Ramya'), 'ERR:22023', 'C9: a badly formed id is refused');
select is(pg_temp.setv('a_owner', 'te', 'te-' || repeat('a', 60)), 'ERR:22023', 'C10: too long');
select is(pg_temp.get('b_owner', 'b')::jsonb, '{"choices": {}}'::jsonb, 'C11: the other business has chosen nothing');

select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.call_voice_changed'), 5::bigint, 'D1: every change is in the audit log');
select is((select (old_values ->> 'voice_id') || '>' || (new_values ->> 'voice_id') from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.call_voice_changed' order by created_at, id offset 2 limit 1), 'te-sindhu>te-ramya', 'D2: ...with the old and the new id');

select * from finish();
rollback;
