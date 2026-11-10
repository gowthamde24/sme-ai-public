-- Job TO: the live take-over safety switch. A catalog and grants  B default OFF and reads  C who may switch it  D every change is audited  E session events are audited  F start is locked while off, nothing said is stored
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.get(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.call_takeover_get(%L)::text', tests.tid(p_tenant))) $$;
create function pg_temp.setit(p_user text, p_on boolean, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.call_takeover_set(%L, %L)::text', tests.tid(p_tenant), p_on)) $$;
create function pg_temp.ev(p_user text, p_call text, p_event text, p_detail text default '{}', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.call_takeover_event(%L, %L, %L, %L::jsonb)::text', tests.tid(p_tenant), tests.rid(p_call), p_event, p_detail)) $$;

insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, answered_at, created_at) values
  (tests.rid('call_a'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'in_progress', now(), now()),
  (tests.rid('call_b'), tests.tid('b'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'in_progress', now(), now());

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('call_takeover_get', 'call_takeover_set', 'call_takeover_event')
  and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 3::bigint, 'A1: three security-definer functions with a fixed search path, for signed-in people only');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and table_name = 'call_takeover_settings' and grantee in ('anon', 'authenticated', 'service_role', 'public')), 0::bigint, 'A2: nobody reads or writes the table directly');

select is(pg_temp.get('a_viewer')::jsonb ->> 'enabled', 'false', 'B1: take-over is OFF by default (no row)');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'B2: another business reads nothing of ours');
select is(pg_temp.get('anon'), 'ERR:42501', 'B3: anon neither');

select is(pg_temp.setit('a_admin', true), 'ERR:42501', 'C1: only the OWNER turns it on (an Admin cannot)');
select is(pg_temp.setit('a_sales', true), 'ERR:42501', 'C2: nor Sales');
select is(pg_temp.setit('b_owner', true, 'a'), 'ERR:42501', 'C3: nor another business''s Owner');
select is(pg_temp.sc('a_owner', format('select public.call_takeover_set(%L, null)::text', tests.tid('a'))), 'ERR:22023', 'C4: on or off, not neither');
select is(pg_temp.get('a_viewer')::jsonb ->> 'enabled', 'false', 'C5: still OFF after the refused attempts');

select is((select count(*) from public.audit_events where action = 'calls.takeover_setting_changed' and tenant_id = tests.tid('a')), 0::bigint, 'D0: nothing audited yet');
select is(pg_temp.setit('a_owner', true)::jsonb ->> 'enabled', 'true', 'D1: the Owner turns it ON');
select is(pg_temp.get('a_viewer')::jsonb ->> 'enabled', 'true', 'D2: everybody reads it');
select is((select old_values::text || ' -> ' || new_values::text from public.audit_events where action = 'calls.takeover_setting_changed' and tenant_id = tests.tid('a') order by id limit 1),
          '{"enabled": false} -> {"enabled": true}', 'D3: the audit entry has the old and the new value');
select is((select actor_user_id from public.audit_events where action = 'calls.takeover_setting_changed' and tenant_id = tests.tid('a') order by id limit 1), tests.uid('a_owner'), 'D4: and who did it (when is the entry''s own time)');
select is(pg_temp.setit('a_owner', true)::jsonb ->> 'enabled', 'true', 'D5: setting the same value again is fine');
select is((select count(*) from public.audit_events where action = 'calls.takeover_setting_changed' and tenant_id = tests.tid('a')), 1::bigint, 'D6: and is not a change, so not a second entry');
select is(pg_temp.setit('a_owner', false)::jsonb ->> 'enabled', 'false', 'D7: the Owner turns it OFF');
select is((select count(*) from public.audit_events where action = 'calls.takeover_setting_changed' and tenant_id = tests.tid('a')), 2::bigint, 'D8: the second change is the second entry');
select is(pg_temp.get('b_owner', 'b')::jsonb ->> 'enabled', 'false', 'D9: the other business is untouched');

-- E / F: session events
select is(pg_temp.ev('a_owner', 'call_a', 'start'), 'ERR:42501', 'F1: a take-over START is refused by the database while the business has it OFF');
select is((select count(*) from public.audit_events where action = 'calls.takeover_start'), 0::bigint, 'F2: and nothing was audited as started');
select is(pg_temp.setit('a_owner', true)::jsonb ->> 'enabled', 'true', 'E0: switched ON again');
select is(pg_temp.ev('a_sales', 'call_a', 'start'), 'ERR:42501', 'E1: Sales cannot log a session');
select is(pg_temp.ev('b_owner', 'call_a', 'start', '{}', 'a'), 'ERR:42501', 'E2: nor another business');
select is(pg_temp.ev('a_owner', 'call_b', 'start'), 'ERR:22023', 'E3: a call of another business is refused');
select is(pg_temp.ev('a_owner', 'call_a', 'listen'), 'ERR:22023', 'E4: only the four known events');
select is(pg_temp.ev('a_owner', 'call_a', 'start'), '', 'E5: the Owner starts a session');
select is(pg_temp.ev('a_admin', 'call_a', 'whisper', '{"text_chars": 42, "text": "offer the Saturday visit", "duration_s": 7}'), '', 'E6: an Admin logs a whisper');
select is(pg_temp.ev('a_admin', 'call_a', 'hang_up'), '', 'E7: a hang-up');
select is(pg_temp.ev('a_owner', 'call_a', 'end', '{"duration_s": 95}'), '', 'E8: the end of the session, with its length');
select is((select array_agg(action order by id) from public.audit_events where entity_type = 'phone_call' and entity_id = tests.rid('call_a') and action like 'calls.takeover_%'),
          array['calls.takeover_start', 'calls.takeover_whisper', 'calls.takeover_hang_up', 'calls.takeover_end'], 'E9: four entries, in order');
select is((select new_values::text from public.audit_events where action = 'calls.takeover_whisper' and entity_id = tests.rid('call_a')), '{"event": "whisper", "duration_s": 7, "text_chars": 42}', 'E10: a whisper stores its length, never its words (the "text" key was dropped)');
select is((select new_values::text from public.audit_events where action = 'calls.takeover_end' and entity_id = tests.rid('call_a')), '{"event": "end", "duration_s": 95}', 'E11: an end stores its duration');
select is((select count(*) from public.audit_events where action like 'calls.takeover_%' and new_values::text like '%Saturday%'), 0::bigint, 'E12: no word that was said is in the trail');
select is(pg_temp.ev('a_owner', 'call_a', 'end', '{"duration_s": 99999999, "text_chars": -3}'), '', 'E13: absurd numbers are dropped, not stored');
select is((select new_values::text from public.audit_events where action = 'calls.takeover_end' and entity_id = tests.rid('call_a') order by id desc limit 1), '{"event": "end"}', 'E14: only the event name remains');

select is((select recorded from public.phone_calls where id = tests.rid('call_a')), false, 'F3: the call is not recorded (the column is forced false)');
select throws_ok(format('update public.phone_calls set recorded = true where id = %L', tests.rid('call_a')), '23514', null, 'F4: and cannot be set to true');

select * from finish();
rollback;
