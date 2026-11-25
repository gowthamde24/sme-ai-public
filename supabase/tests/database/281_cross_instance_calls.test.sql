-- Running more than one API instance (migration 20261231990900): the platform-wide live count and the whisper / hang-up commands.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

insert into public.phone_calls (id, tenant_id, direction, state, purpose, language, provider, created_by, created_at, heartbeat_at, ended_at) values
  (tests.rid('xc_live'), tests.tid('a'), 'inbound', 'in_progress', 'inbound', 'te', 'plivo', tests.uid('a_owner'), now(), now(), null),
  (tests.rid('xc_live_b'), tests.tid('b'), 'inbound', 'in_progress', 'inbound', 'te', 'plivo', tests.uid('b_owner'), now(), now(), null),
  (tests.rid('xc_old'), tests.tid('a'), 'inbound', 'in_progress', 'inbound', 'te', 'plivo', tests.uid('a_owner'), now() - interval '20 minutes', now() - interval '20 minutes', null),
  (tests.rid('xc_done'), tests.tid('a'), 'inbound', 'completed', 'inbound', 'te', 'plivo', tests.uid('a_owner'), now(), now(), now());

-- A. the count is for the system account only
select is(pg_temp.at('a_owner', 'select public.phone_live_count()::text'), 'ERR:42501', 'A1: a member cannot read the platform count');
select is(pg_temp.at('anon', 'select public.phone_live_count()::text'), 'ERR:42501', 'A2: nor a stranger');
select is((select count(*)::integer from public.phone_calls c where app.phone_call_is_live(c)), 2, 'A3: two calls are live (a stale and a finished one are not)');

-- B. push: Owner and Admin of the call's workspace, only for a live call
select is(pg_temp.at('a_sales', format($q$select public.call_command_push(%L, %L, 'hang_up')::text$q$, tests.tid('a'), tests.rid('xc_live'))), 'ERR:42501', 'B1: Sales cannot');
select is(pg_temp.at('b_owner', format($q$select public.call_command_push(%L, %L, 'hang_up')::text$q$, tests.tid('a'), tests.rid('xc_live'))), 'ERR:42501', 'B2: nor another workspace');
select is(pg_temp.at('a_owner', format($q$select public.call_command_push(%L, %L, 'shout', 'x')::text$q$, tests.tid('a'), tests.rid('xc_live'))), 'ERR:22023', 'B3: an unknown kind');
select is(pg_temp.at('a_owner', format($q$select public.call_command_push(%L, %L, 'whisper')::text$q$, tests.tid('a'), tests.rid('xc_live'))), 'ERR:22023', 'B4: a whisper needs words');
select is(pg_temp.at('a_owner', format($q$select public.call_command_push(%L, %L, 'hang_up', 'words')::text$q$, tests.tid('a'), tests.rid('xc_live'))), 'ERR:22023', 'B5: a hang-up carries none');
select is(pg_temp.at('a_owner', format($q$select (public.call_command_push(%L, %L, 'hang_up')) ->> 'reason'$q$, tests.tid('a'), tests.rid('xc_old'))), 'not_live', 'B6: a call that is not live is refused in words');
select is(pg_temp.at('a_owner', format($q$select (public.call_command_push(%L, %L, 'hang_up')) ->> 'reason'$q$, tests.tid('a'), tests.rid('xc_live_b'))), 'not_live', 'B7: another workspace''s call is never reachable');
select is(pg_temp.at('a_admin', format($q$select (public.call_command_push(%L, %L, 'whisper', 'ask about the colour')) ->> 'queued'$q$, tests.tid('a'), tests.rid('xc_live'))), 'true', 'B8: an Admin whispers');
select is(pg_temp.at('a_owner', format($q$select (public.call_command_push(%L, %L, 'hang_up')) ->> 'queued'$q$, tests.tid('a'), tests.rid('xc_live'))), 'true', 'B9: the Owner hangs up');

-- C. the status belongs to the workspace
create temp table cmd as select id, kind from telephony.call_commands where call_id = tests.rid('xc_live');
select is((select count(*) from cmd), 2::bigint, 'C1: two commands are waiting');
select is(pg_temp.at('a_owner', format($q$select (public.call_command_status(%L, %L)) ->> 'done'$q$, tests.tid('a'), (select id from cmd where kind = 'hang_up'))), 'false', 'C2: not done yet');
select is(pg_temp.at('b_owner', format($q$select (public.call_command_status(%L, %L)) ->> 'known'$q$, tests.tid('b'), (select id from cmd where kind = 'hang_up'))), 'false', 'C3: another workspace does not know it');
select is(pg_temp.at('a_viewer', format($q$select public.call_command_status(%L, %L)::text$q$, tests.tid('a'), (select id from cmd limit 1))), 'ERR:42501', 'C4: a Viewer cannot ask');

-- D. claim and finish are the system account's; the words are given once and cleared
select is(pg_temp.at('a_owner', format($q$select public.call_command_claim(array[%L]::uuid[])::text$q$, tests.rid('xc_live'))), 'ERR:42501', 'D1: a member cannot claim');
select is(pg_temp.at('a_owner', format($q$select public.call_command_finish(%L, true)::text$q$, (select id from cmd limit 1))), 'ERR:42501', 'D2: nor finish');
select is(has_table_privilege('authenticated', 'telephony.call_commands', 'select'), false, 'D3: the table is closed to members');
select is((select count(*) from telephony.call_commands where claimed_at is null), 2::bigint, 'D4: nothing was taken by those attempts');
-- the system side, run as the table owner would not pass ops.system_only(); its logic is checked by the statement itself:
with picked as (select c.id, c.body as words from telephony.call_commands c where c.call_id = tests.rid('xc_live') and c.claimed_at is null),
     upd as (update telephony.call_commands c set claimed_at = now(), body = case when c.kind = 'whisper' then '-' else null end from picked p where c.id = p.id returning c.id, c.kind, p.words)
select 1 from upd;
select is((select body from telephony.call_commands where kind = 'whisper' and call_id = tests.rid('xc_live')), '-', 'D5: a claimed whisper no longer holds the words');
select is((select count(*) from telephony.call_commands where claimed_at is not null), 2::bigint, 'D6: both claimed (the hang-up row stays valid)');

select * from finish();
rollback;
