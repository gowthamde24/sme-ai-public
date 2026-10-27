-- Job DT (ADR 0116): the opening line and the "mention that I'm an AI assistant" switch. A catalog  B reads and roles  C lines (validation, reset, campaign)  D the switch and its audit trail
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');           -- a session that signed in an hour ago: the opening line asks for no recent sign-in and no second factor
  perform tests.as_signin_age(3600);
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.get(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.opening_get(%L)::text', tests.tid(p_tenant))) $$;
create function pg_temp.line(p_user text, p_lang text, p_camp uuid, p_text text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.opening_set_line(%L, %L, %L, %L)::text', tests.tid(p_tenant), p_lang, p_camp, p_text)) $$;
create function pg_temp.mention(p_user text, p_camp uuid, p_on boolean, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.opening_set_mention(%L, %L, %L)::text', tests.tid(p_tenant), p_camp, p_on)) $$;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('opening_get', 'opening_set_line', 'opening_set_mention')
  and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 3::bigint, 'A: three definer functions for signed-in callers');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and table_name in ('opening_lines', 'opening_settings') and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A: no client role holds a privilege on the tables');

select is(pg_temp.get('a_viewer')::jsonb ->> 'mention_ai', 'true', 'B1: the switch is ON by default');
select is(pg_temp.get('a_viewer')::jsonb -> 'lines', '[]'::jsonb, 'B2: no line until the Owner writes one');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'B3: another business reads nothing of ours');
select is(pg_temp.get('anon'), 'ERR:42501', 'B4: anon neither');
select is(pg_temp.line('a_admin', 'en', null, 'Hello {customer}, this is {assistant}.'), 'ERR:42501', 'B5: only the OWNER writes (an Admin cannot)');
select is(pg_temp.mention('a_sales', null, false), 'ERR:42501', 'B6: nor Sales, for the switch');

select is((pg_temp.line('a_owner', 'te', null, 'నమస్కారం {customer} గారు, నేను {assistant}, {business} నుంచి.')::jsonb -> 'lines' -> 0) ->> 'language', 'te', 'C1: the Owner saves a Telugu line');
select is(pg_temp.line('a_owner', 'en', null, 'Hello {name}, welcome here'), 'ERR:22023', 'C2: a brace that is not one of the four placeholders is refused');
select is(pg_temp.line('a_owner', 'en', null, 'short'), 'ERR:22023', 'C3: too short');
select is(pg_temp.line('a_owner', 'en', null, repeat('a', 301)), 'ERR:22023', 'C4: too long');
select is(pg_temp.line('a_owner', 'xx', null, 'Hello {customer}, this is {assistant}.'), 'ERR:22023', 'C5: a language of the product');
select is(pg_temp.line('a_owner', 'mr', null, 'नमस्कार {customer}, मी {assistant} बोलत आहे.')::jsonb ->> 'mention_ai', 'true', 'C6: Marathi is accepted');
select is(jsonb_array_length(pg_temp.line('a_owner', 'en', '00000000-0000-0000-0000-0000000000c1', 'Campaign hello {customer}, {assistant} here.')::jsonb -> 'lines'), 3, 'C7: a campaign line sits next to the workspace lines');
select is(jsonb_array_length(pg_temp.line('a_owner', 'en', '00000000-0000-0000-0000-0000000000c1', null)::jsonb -> 'lines'), 2, 'C8: a null text resets that line (the row goes)');
select is(pg_temp.line('a_owner', 'en', null, null)::jsonb -> 'lines' @> '[{"language":"te"}]', true, 'C9: resetting a line that is not there is fine and the others stay');

select is(pg_temp.mention('a_owner', null, false)::jsonb ->> 'mention_ai', 'false', 'D1: the Owner turns the mention OFF');
select is(pg_temp.get('a_viewer')::jsonb ->> 'mention_ai', 'false', 'D2: everybody reads it');
select is(pg_temp.mention('a_owner', null, null), 'ERR:22023', 'D3: the workspace switch cannot be removed, only set');
select is(jsonb_array_length(pg_temp.mention('a_owner', '00000000-0000-0000-0000-0000000000c1', true)::jsonb -> 'campaign_overrides'), 1, 'D4: a campaign can override it');
select is(jsonb_array_length(pg_temp.mention('a_owner', '00000000-0000-0000-0000-0000000000c1', null)::jsonb -> 'campaign_overrides'), 0, 'D5: and the override can be removed');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.mention_ai_changed'), 3::bigint, 'D6: every change of the switch is in the audit log (who and when are the event''s own)');
select is((select (old_values ->> 'mention_ai') || '>' || (new_values ->> 'mention_ai') from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.mention_ai_changed' order by created_at, id limit 1), 'true>false', 'D7: ...with the old and the new value');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'assistant.opening_line_saved'), 5::bigint, 'D8: every line change is audited too');

select * from finish();
rollback;
