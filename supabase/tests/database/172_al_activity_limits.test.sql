-- "Everything it did" and "Limits" (migration 20261231410000): who reads, newest first, paging, the undo flag is only ever an assistant change's, no message text; the limits come from the real settings and the
-- Owner can only make them tighter (all or nothing).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_guards_off();

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.act(p_user text, p_args text default '') returns text language plpgsql as $$
begin
  return pg_temp.q(p_user, format($q$select public.activity_log(%L%s)::text$q$, tests.tid('a'), p_args));
end $$;
create function pg_temp.lim(p_user text, p_tenant text default 'a') returns jsonb language plpgsql as $$
begin
  return pg_temp.q(p_user, format($q$select public.limits_get(%L)::text$q$, tests.tid(p_tenant)))::jsonb;
end $$;
create function pg_temp.tighten(p_user text, p_changes text, p_tenant text default 'a') returns text language plpgsql as $$
begin
  return pg_temp.q(p_user, format($q$select public.limits_tighten(%L, %L::jsonb)::text$q$, tests.tid(p_tenant), p_changes));
end $$;
create function pg_temp.kind(l jsonb, p_kind text, p_key text) returns text language sql as $$ select (select k ->> p_key from jsonb_array_elements(l -> 'kinds') k where k ->> 'kind' = p_kind) $$;
create function pg_temp.cap(l jsonb, p_key text) returns text language sql as $$ select (select k ->> 'value' from jsonb_array_elements(l -> 'caps') k where k ->> 'key' = p_key) $$;
create function pg_temp.keys(p_json jsonb) returns text language sql as $$ select string_agg(i ->> 'key', ',' order by ord) from jsonb_array_elements(p_json -> 'items') with ordinality t(i, ord) $$;

-- the three sources, through the registry's own inserts (tenant a), and one row of each in tenant b
do $$
declare
  r record;
begin
  for r in select * from tests.tenant_table_registry where table_name in ('phone_calls', 'outbox_messages', 'assistant_work_actions') order by table_name loop
    execute format(r.insert_sql, tests.tid('a'), gen_random_uuid(), tests.rid('a_company'), tests.rid('a_contact'), tests.pool_uid(1));
    execute format(r.insert_sql, tests.tid('b'), gen_random_uuid(), tests.rid('b_company'), tests.rid('b_contact'), tests.pool_uid(2));
  end loop;
end $$;
set local session_replication_role = replica;
update public.assistant_work_actions set created_at = now() - interval '1 minute' where tenant_id = tests.tid('a');
update public.outbox_messages set created_at = now() - interval '2 minutes' where tenant_id = tests.tid('a');
update public.phone_calls set created_at = now() - interval '3 minutes', state = 'completed', answered_at = now() - interval '3 minutes', ended_at = now() - interval '2 minutes' where tenant_id = tests.tid('a');
reset session_replication_role;

-- A: the timeline
select is(jsonb_array_length((pg_temp.act('a_owner')::jsonb) -> 'items'), 3, 'A1 the Owner sees the call, the message and the assistant''s change, and not the other workspace''s');
select is(jsonb_array_length((pg_temp.act('a_admin')::jsonb) -> 'items'), 3, 'A2 an Admin too');
select is(pg_temp.act('a_sales'), 'ERR:42501', 'A3 Sales does not');
select is(pg_temp.act('a_viewer'), 'ERR:42501', 'A4 nor a Viewer');
select is(pg_temp.q('b_owner', format($q$select public.activity_log(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A5 nor another workspace''s Owner');
select is((select string_agg(i ->> 'kind', ',' order by ord) from jsonb_array_elements((pg_temp.act('a_owner')::jsonb) -> 'items') with ordinality t(i, ord)), 'action,message,call', 'A6 newest first');
select is(((pg_temp.act('a_owner')::jsonb) -> 'items' -> 1) ? 'body', false, 'A7 a message item carries no message text');
select is(((pg_temp.act('a_owner')::jsonb) -> 'items' -> 1 ->> 'waiting')::boolean, true, 'A8 a message waiting for approval says so');
select is(jsonb_array_length((pg_temp.act('a_owner', ', 50, null, null, ''call''')::jsonb) -> 'items'), 1, 'A9 one kind only');
select is(pg_temp.act('a_owner', ', 50, null, null, ''nonsense'''), 'ERR:22023', 'A10 an unknown kind is refused');
select is(pg_temp.act('a_owner', ', 0'), 'ERR:22023', 'A11 a limit of 0 is refused');
select is(pg_temp.act('a_owner', ', 50, now(), null'), 'ERR:22023', 'A12 a cursor needs both parts');
-- paging
select is(jsonb_array_length((pg_temp.act('a_owner', ', 2')::jsonb) -> 'items'), 2, 'B1 a page of two');
select isnt((pg_temp.act('a_owner', ', 2')::jsonb) -> 'next', null, 'B2 and it says where the next page starts');
select is(pg_temp.keys(pg_temp.q('a_owner', format($q$select public.activity_log(%L, 2, (%L::jsonb -> 'next' ->> 'before_at')::timestamptz, %L::jsonb -> 'next' ->> 'before_key')::text$q$,
                          tests.tid('a'), pg_temp.act('a_owner', ', 2'), pg_temp.act('a_owner', ', 2')))::jsonb),
          (select (i ->> 'key') from jsonb_array_elements((pg_temp.act('a_owner')::jsonb) -> 'items') with ordinality t(i, ord) where ord = 3),
          'B3 the second page is exactly the third item');
select is(pg_temp.q('a_owner', format($q$select ((public.activity_log(%L, 2, (%L::jsonb -> 'next' ->> 'before_at')::timestamptz, %L::jsonb -> 'next' ->> 'before_key')) -> 'next')::text$q$,
                    tests.tid('a'), pg_temp.act('a_owner', ', 2'), pg_temp.act('a_owner', ', 2'))), 'null', 'B4 the last page has no next');
-- the undo flag
select is(((pg_temp.act('a_owner')::jsonb) -> 'items' -> 0 -> 'undo' ->> 'state'), 'none', 'C1 an assistant change that stored no undo has none');
set local session_replication_role = replica;
update public.assistant_work_actions set undo = '{"tool": "leads.undo"}'::jsonb, undo_until = now() + interval '1 hour' where tenant_id = tests.tid('a');
reset session_replication_role;
select is(((pg_temp.act('a_owner')::jsonb) -> 'items' -> 0 -> 'undo' ->> 'state'), 'available', 'C2 with a stored undo inside its time it can be undone');
set local session_replication_role = replica;
update public.assistant_work_actions set undo_until = now() - interval '1 minute' where tenant_id = tests.tid('a');
reset session_replication_role;
select is(((pg_temp.act('a_owner')::jsonb) -> 'items' -> 0 -> 'undo' ->> 'state'), 'expired', 'C3 after its time it has expired');
set local session_replication_role = replica;
update public.assistant_work_actions set status = 'undone' where tenant_id = tests.tid('a');
reset session_replication_role;
select is(((pg_temp.act('a_owner')::jsonb) -> 'items' -> 0 -> 'undo' ->> 'state'), 'done', 'C4 and an undone one says done');
select is((select count(*)::integer from jsonb_array_elements((pg_temp.act('a_owner')::jsonb) -> 'items') i where i ->> 'kind' in ('call', 'message') and i -> 'undo' ->> 'state' <> 'none'), 0, 'C5 a call and a message never have an undo');

-- D: the limits as the settings give them
do $$
declare
  r record;
begin
  for r in select * from tests.tenant_table_registry where table_name in ('assistant_settings', 'tenant_agent_settings') order by table_name loop
    execute format(r.insert_sql, tests.tid('a'), gen_random_uuid(), tests.rid('a_company'), tests.rid('a_contact'), tests.pool_uid(1));
  end loop;
end $$;
select is(pg_temp.q('a_sales', format($q$select public.limits_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D1 Sales cannot read the limits');
select is(pg_temp.q('b_owner', format($q$select public.limits_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D2 nor another workspace');
select is(pg_temp.kind(pg_temp.lim('a_admin'), 'message_routine', 'mode'), 'needs_ok', 'D3 an Admin reads them; messages wait for the Owner while automatic sending is off (the default)');
select is(pg_temp.kind(pg_temp.lim('a_owner'), 'call_prices', 'mode'), 'alone', 'D4 the assistant''s own permission, from its settings');
select is(pg_temp.kind(pg_temp.lim('a_owner'), 'quote_send', 'locked'), 'true', 'D5 a quote always waits for the Owner');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.lim('a_owner') -> 'kinds') k where k ->> 'locked' = 'true' and k ->> 'mode' <> 'needs_ok'), 0, 'D6 every locked kind asks');
select is((pg_temp.lim('a_owner') -> 'workspace' ->> 'on'), 'true', 'D7 the workspace is on (its agent switch)');
select is(pg_temp.cap(pg_temp.lim('a_owner'), 'messages_per_customer_per_day'), '3', 'D8 the daily message limit is the default 3');
select is((pg_temp.lim('a_owner') -> 'quiet_hours' -> 'messages' ->> 'start_hour') || '-' || (pg_temp.lim('a_owner') -> 'quiet_hours' -> 'messages' ->> 'end_hour'), '21-9', 'D9 message quiet hours');
select is(pg_temp.lim('a_owner') -> 'quiet_hours' -> 'calls' ->> 'source', 'assistant', 'D10 call hours come from the assistant''s settings when nothing else is set');
select is(pg_temp.lim('b_owner', 'b') ->> 'assistant_saved', 'false', 'D11 a workspace that never saved its assistant says so');
select is(pg_temp.kind(pg_temp.lim('b_owner', 'b'), 'call_prices', 'mode'), null, 'D12 and lists no call permission');

-- E: tightening
select is(pg_temp.tighten('a_admin', '{"messages_alone": false}'), 'ERR:42501', 'E1 only the Owner tightens (an Admin does not)');
select is(pg_temp.tighten('a_sales', '{"messages_alone": false}'), 'ERR:42501', 'E2 nor Sales');
select is(pg_temp.tighten('b_owner', '{"messages_alone": false}'), 'ERR:42501', 'E3 nor another workspace''s Owner');
select is((pg_temp.tighten('a_owner', '{"messages_alone": true}')::jsonb) ->> 'reason', 'would_loosen', 'E4 turning automatic sending ON is refused (it is off)');
set local session_replication_role = replica;
insert into public.outbox_settings (tenant_id, auto_send_enabled, per_customer_daily_limit) values (tests.tid('a'), true, 3) on conflict (tenant_id) do update set auto_send_enabled = true, per_customer_daily_limit = 3;
update public.assistant_settings set max_discount_percent = 10, handover_order_above_paise = null, call_days = array[1, 2, 3]::smallint[], call_from_minute = 540, call_to_minute = 1140 where tenant_id = tests.tid('a');
reset session_replication_role;
select is(pg_temp.kind(pg_temp.lim('a_owner'), 'message_routine', 'mode'), 'alone', 'E5 with automatic sending on, routine messages go alone');
select is((pg_temp.tighten('a_owner', '{"messages_alone": false}')::jsonb) ->> 'ok', 'true', 'E6 the Owner stops automatic sending');
select is(pg_temp.kind(pg_temp.lim('a_owner'), 'message_routine', 'mode'), 'needs_ok', 'E7 and it really changed in the settings');
select is((select auto_send_enabled from public.outbox_settings where tenant_id = tests.tid('a')), false, 'E8 ... in the table itself');
select is((pg_temp.tighten('a_owner', '{"message_daily_limit": 5}')::jsonb) ->> 'reason', 'would_loosen', 'E9 a higher daily limit is refused');
select is((pg_temp.tighten('a_owner', '{"message_daily_limit": 2}')::jsonb #>> '{limits,caps,0,value}'), '2', 'E10 a lower one is taken');
select is((pg_temp.tighten('a_owner', '{"message_quiet_hours": {"start_hour": 22}}')::jsonb) ->> 'reason', 'would_loosen', 'E11 later quiet hours are refused');
select is((pg_temp.tighten('a_owner', '{"message_quiet_hours": {"end_hour": 8}}')::jsonb) ->> 'reason', 'would_loosen', 'E12 an earlier end is refused');
select is((pg_temp.tighten('a_owner', '{"message_quiet_hours": {"start_hour": 20, "end_hour": 10}}')::jsonb) ->> 'ok', 'true', 'E13 longer quiet hours are taken');
select is((select quiet_start_hour || '-' || quiet_end_hour from public.outbox_settings where tenant_id = tests.tid('a')), '20-10', 'E14 ... stored');
select is((pg_temp.tighten('a_owner', '{"call_prices": false, "call_dues": false}')::jsonb) ->> 'ok', 'true', 'E15 the assistant stops answering prices and talking about dues');
select is(pg_temp.kind(pg_temp.lim('a_owner'), 'call_prices', 'mode') || pg_temp.kind(pg_temp.lim('a_owner'), 'call_visits', 'mode'), 'needs_okalone', 'E16 only those two changed');
select is((pg_temp.tighten('a_owner', '{"call_prices": true}')::jsonb) ->> 'reason', 'would_loosen', 'E17 allowing it again is refused');
select is((pg_temp.tighten('a_owner', '{"call_discount_percent": 20}')::jsonb) ->> 'reason', 'would_loosen', 'E18 a bigger discount is refused');
select is((pg_temp.tighten('a_owner', '{"call_discount_percent": 5}')::jsonb) ->> 'ok', 'true', 'E19 a smaller one is taken');
select is((select max_discount_percent from public.assistant_settings where tenant_id = tests.tid('a'))::text, '5', 'E20 ... stored');
select is((pg_temp.tighten('a_owner', '{"call_big_order_paise": 100000000}')::jsonb) ->> 'ok', 'true', 'E21 a big-order limit where there was none is a tightening');
select is((pg_temp.tighten('a_owner', '{"call_big_order_paise": 200000000}')::jsonb) ->> 'reason', 'would_loosen', 'E22 raising it is refused');
select is((pg_temp.tighten('a_owner', '{"call_hours": {"days": [1, 2, 3, 4]}}')::jsonb) ->> 'reason', 'would_loosen', 'E23 more calling days are refused');
select is((pg_temp.tighten('a_owner', '{"call_hours": {"from_minute": 600, "to_minute": 1080, "days": [1, 2]}}')::jsonb) ->> 'ok', 'true', 'E25 shorter calling hours and fewer days are taken');
select is((select call_days::text || call_from_minute || '-' || call_to_minute from public.assistant_settings where tenant_id = tests.tid('a')), '{1,2}600-1080', 'E26 ... stored');
select is((pg_temp.tighten('a_owner', '{"call_hours": {"from_minute": 570}}')::jsonb) ->> 'reason', 'would_loosen', 'E24 an earlier start (inside the allowed range) is refused once the start has moved to 10:00');
select is((pg_temp.tighten('a_owner', '{"call_hours": {"from_minute": 1080, "to_minute": 1080}}')::jsonb) ->> 'reason', 'invalid', 'E27 an empty window is invalid');
-- all or nothing, unknown things, wrong shapes
select is((pg_temp.tighten('a_owner', '{"message_daily_limit": 1, "call_media": false, "call_prices": true}')::jsonb) ->> 'reason', 'would_loosen', 'F1 one loosening in the list refuses the whole list');
select is((select o.per_customer_daily_limit::text || a.may_send_media::text from public.outbox_settings o, public.assistant_settings a where o.tenant_id = tests.tid('a') and a.tenant_id = tests.tid('a')), '2true', 'F2 and nothing of it was applied');
select is((pg_temp.tighten('a_owner', '{"something_else": 1}')::jsonb) ->> 'reason', 'unknown_field', 'F3 an unknown field is refused');
select is((pg_temp.tighten('a_owner', '[]')::jsonb) ->> 'reason', 'invalid', 'F4 a list instead of an object is invalid');
select is((pg_temp.tighten('a_owner', '{}')::jsonb) ->> 'reason', 'invalid', 'F5 an empty change is invalid');
select is((pg_temp.tighten('a_owner', '{"message_daily_limit": "2"}')::jsonb) ->> 'reason', 'invalid', 'F6 a number must be a number');
select is((pg_temp.tighten('b_owner', '{"call_prices": false}', 'b')::jsonb) ->> 'reason', 'not_saved', 'F7 a workspace that never saved its assistant cannot tighten its permissions');
-- the call hours may come from the call settings: then they are changed there, not here
set local session_replication_role = replica;
insert into public.call_settings (tenant_id, settings, updated_by) values (tests.tid('a'), '{"hours": {"days": [1, 2], "from_minute": 600, "to_minute": 1080}}'::jsonb, tests.pool_uid(1));
reset session_replication_role;
select is(pg_temp.lim('a_owner') -> 'quiet_hours' -> 'calls' ->> 'source', 'call_settings', 'G1 the call settings'' hours win when set');
select is((pg_temp.tighten('a_owner', '{"call_hours": {"from_minute": 660}}')::jsonb) ->> 'reason', 'limits_elsewhere', 'G2 and tightening them here is refused: they are changed in the call settings');
-- the off switch is last
select is((pg_temp.tighten('a_owner', '{"workspace_on": false}')::jsonb #>> '{limits,workspace,on}'), 'false', 'H1 the Owner switches the workspace off');
select is((select enabled from public.tenant_agent_settings where tenant_id = tests.tid('a')), false, 'H2 ... in the table');
select is((pg_temp.tighten('a_owner', '{"workspace_on": true}')::jsonb) ->> 'reason', 'would_loosen', 'H3 switching it back on is not a tightening');

select * from finish();
rollback;
