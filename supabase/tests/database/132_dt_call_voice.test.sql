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

select is(pg_temp.get('a_viewer')::jsonb, '{"choices": {}, "gender": "female"}'::jsonb, 'B1: nothing chosen = empty (the default speaks)');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'B2: another business reads nothing of ours');
select is(pg_temp.get('anon'), 'ERR:42501', 'B3: anon neither');
select is(pg_temp.setv('a_viewer', 'te', 'te-sindhu'), 'ERR:42501', 'B4: a viewer cannot choose');
select is(pg_temp.setv('a_sales', 'te', 'te-sindhu'), 'ERR:42501', 'B5: nor Sales');
select is(pg_temp.setv('b_owner', 'te', 'te-sindhu', 'a'), 'ERR:42501', 'B6: nor another business''s Owner');

select is(pg_temp.setv('a_owner', 'te', 'te-sindhu')::jsonb, '{"choices": {"te": "te-sindhu"}, "gender": "female"}'::jsonb, 'C1: the Owner chooses a Telugu voice');
select is(pg_temp.setv('a_admin', 'hi', 'hi-esha')::jsonb, '{"choices": {"te": "te-sindhu", "hi": "hi-esha"}, "gender": "female"}'::jsonb, 'C2: an Admin chooses too; the choices are per language');
select is(pg_temp.get('a_viewer')::jsonb -> 'choices' ->> 'hi', 'hi-esha', 'C3: every member reads the choice');
select is(pg_temp.setv('a_owner', 'te', 'te-ramya')::jsonb -> 'choices' ->> 'te', 'te-ramya', 'C4: changing a choice replaces it');
select is(pg_temp.setv('a_owner', 'te', null)::jsonb, '{"choices": {"hi": "hi-esha"}, "gender": "female"}'::jsonb, 'C5: null clears it (back to the default)');
select is(pg_temp.setv('a_owner', 'te', null)::jsonb, '{"choices": {"hi": "hi-esha"}, "gender": "female"}'::jsonb, 'C6: clearing what is not there is fine');
select is(pg_temp.setv('a_owner', 'xx', 'xx-abc'), 'ERR:22023', 'C7: a language of the call set only');
select is(pg_temp.setv('a_owner', 'te', 'hi-esha'), 'ERR:22023', 'C8: a voice of another language is refused');
select is(pg_temp.setv('a_owner', 'te', 'TE-Ramya'), 'ERR:22023', 'C9: a badly formed id is refused');
select is(pg_temp.setv('a_owner', 'te', 'te-' || repeat('a', 60)), 'ERR:22023', 'C10: too long');
select is(pg_temp.get('b_owner', 'b')::jsonb, '{"choices": {}, "gender": "female"}'::jsonb, 'C11: the other business has chosen nothing');

select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.call_voice_changed'), 5::bigint, 'D1: every change is in the audit log');
select is((select (old_values ->> 'voice_id') || '>' || (new_values ->> 'voice_id') from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.call_voice_changed' order by created_at, id offset 2 limit 1), 'te-sindhu>te-ramya', 'D2: ...with the old and the new id');

-- E. voice v2: Tamil and Malayalam choices, the workspace's gender (a flip clears the choices), roles, audit
create function pg_temp.gender(p_user text, p_gender text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.call_voice_gender_set(%L, %L)::text', tests.tid(p_tenant), p_gender)) $$;
select is(pg_temp.setv('a_owner', 'ta', 'ta-janani')::jsonb -> 'choices' ->> 'ta', 'ta-janani', 'E1: a Tamil voice can be chosen');
select is(pg_temp.setv('a_owner', 'ml', 'ml-latha')::jsonb -> 'choices' ->> 'ml', 'ml-latha', 'E2: and a Malayalam one');
select is(pg_temp.gender('a_owner', 'male')::jsonb, '{"choices": {}, "gender": "male"}'::jsonb, 'E3: flipping the gender clears every choice');
select is(pg_temp.get('a_viewer')::jsonb ->> 'gender', 'male', 'E4: every member reads the gender');
select is(pg_temp.setv('a_admin', 'te', 'te-charan')::jsonb, '{"choices": {"te": "te-charan"}, "gender": "male"}'::jsonb, 'E5: a choice after the flip');
select is(pg_temp.gender('a_admin', 'male')::jsonb ->> 'gender', 'male', 'E6: setting the same gender again keeps the choices') ;
select is(pg_temp.get('a_owner')::jsonb -> 'choices' ->> 'te', 'te-charan', 'E7: ...they are still there');
select is(pg_temp.gender('a_admin', 'female')::jsonb, '{"choices": {}, "gender": "female"}'::jsonb, 'E8: an Admin flips back; choices cleared');
select is(pg_temp.gender('a_owner', 'other'), 'ERR:22023', 'E9: only female or male');
select is(pg_temp.gender('a_sales', 'male'), 'ERR:42501', 'E10: Sales cannot');
select is(pg_temp.gender('a_viewer', 'male'), 'ERR:42501', 'E11: nor a Viewer');
select is(pg_temp.gender('b_owner', 'male', 'a'), 'ERR:42501', 'E12: nor another business''s Owner');
select is(pg_temp.gender('anon', 'male'), 'ERR:42501', 'E13: nor anyone signed out');
select is(pg_temp.get('b_owner', 'b')::jsonb ->> 'gender', 'female', 'E14: the other business is untouched');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.call_voice_gender_changed'), 3::bigint, 'E15: each call is audited');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and table_name = 'call_voice_gender' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'E16: no client reaches the table');

select * from finish();
rollback;
