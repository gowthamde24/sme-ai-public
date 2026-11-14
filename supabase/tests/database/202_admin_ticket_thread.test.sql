-- Admin console phase 2, slice 1: the support thread (read, reply, internal note, status, assign).
begin;
select no_plan();
select tests.seed_two_tenants();

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@staff.test', now(), jsonb_build_object('display_name', n), now(), now()
  from unnest(array['s_owner', 's_support', 's_finance']) n;
select app.operator_register_staff('s_owner@staff.test', 'Gowtham R', 'owner');
select app.operator_register_staff('s_support@staff.test', 'Anu Support', 'support');
select app.operator_register_staff('s_finance@staff.test', 'Fay Finance', 'finance');

create function pg_temp.st(p_user text, p_aal text, p_sid text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid(p_user), 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
  perform set_config('request.jwt.claim.sub', tests.uid(p_user)::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return v;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return 'ERR:' || sqlstate;
end $$;


create function pg_temp.sup(p_user text, p_sql text) returns text language sql as $$ select pg_temp.st(p_user, 'aal2', 'sess-' || p_user || '-0001', p_sql) $$;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to public;
insert into t_ids select 'tk', (pg_temp.sup('s_support', format($q$select public.admin_ticket_create(%L, 'Calls not reaching assistant', 'phone', 'normal')::jsonb ->> 'id'$q$, tests.tid('a'))))::uuid;
create function pg_temp.tk() returns uuid language sql as $$ select v from t_ids where k = 'tk' $$;
create function pg_temp.q(p_user text, p_fmt text, variadic p_args text[] default '{}') returns text language plpgsql as $$ begin return pg_temp.sup(p_user, format(p_fmt, variadic p_args)); end $$;

-- A. who may use it
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format('select public.admin_ticket_get(%L)::text', pg_temp.tk())), 'ERR:SM941', 'A1: a shop owner is not staff');
select is(pg_temp.st('s_support', 'aal1', 'sess-s_support-0001', format('select public.admin_ticket_get(%L)::text', pg_temp.tk())), 'ERR:SM942', 'A2: the second factor is always needed');
select is(pg_temp.q('s_finance', 'select public.admin_ticket_get(%L)::text', pg_temp.tk()::text), 'ERR:42501', 'A3: finance does not read customer tickets');
select is(pg_temp.q('s_finance', 'select public.admin_ticket_reply(%L, %L)::text', pg_temp.tk()::text, 'hello'), 'ERR:42501', 'A4: finance does not reply');
select is(pg_temp.q('s_finance', 'select public.admin_ticket_status(%L, %L)::text', pg_temp.tk()::text, 'closed'), 'ERR:42501', 'A5: finance does not change a status');
select is(pg_temp.q('s_finance', 'select public.admin_ticket_assign(%L, null)::text', pg_temp.tk()::text), 'ERR:42501', 'A6: finance does not assign');

-- B. the thread starts empty; a reply goes on it and makes the ticket wait for the shop
select is(pg_temp.q('s_support', 'select (public.admin_ticket_get(%L) -> %L)::text', pg_temp.tk()::text, 'messages'), '[]', 'B1: a new ticket has no messages');
select is(pg_temp.q('s_support', 'select (public.admin_ticket_reply(%L, %L) -> %L -> 0 ->> %L)', pg_temp.tk()::text, '  Thanks, we are looking at your numbers now.  ', 'messages', 'body'), 'Thanks, we are looking at your numbers now.', 'B2: the reply is trimmed and stored');
select is(pg_temp.q('s_support', 'select public.admin_ticket_get(%L) ->> %L', pg_temp.tk()::text, 'status'), 'waiting', 'B3: a reply makes the ticket wait for the shop');
select is(pg_temp.q('s_support', 'select public.admin_ticket_get(%L) -> %L -> 0 ->> %L', pg_temp.tk()::text, 'messages', 'delivered'), 'false', 'B4: nothing is sent to the shop yet (said honestly)');
select is(pg_temp.q('s_support', 'select public.admin_ticket_get(%L) -> %L -> 0 -> %L ->> %L', pg_temp.tk()::text, 'messages', 'staff', 'name'), 'Anu Support', 'B5: who wrote it');
update admin.support_tickets set last_message_at = now() - interval '2 hours' where id = pg_temp.tk();
select is(pg_temp.q('s_owner', 'select public.admin_ticket_reply(%L, %L, %L) -> %L -> 1 ->> %L', pg_temp.tk()::text, 'Call the shop owner back tomorrow', 'note', 'messages', 'kind'), 'note', 'B6: an internal note goes on the thread');
select cmp_ok((admin.ticket_row(pg_temp.tk()) ->> 'waiting_minutes')::int, '>=', 119, 'B7: a note does not restart the waiting clock');

-- C. bad input
select is(pg_temp.q('s_support', 'select public.admin_ticket_reply(%L, %L)::text', pg_temp.tk()::text, '   '), 'ERR:22023', 'C1: an empty reply is refused');
select is(pg_temp.q('s_support', 'select public.admin_ticket_reply(%L, %L, %L)::text', pg_temp.tk()::text, 'x', 'shout'), 'ERR:22023', 'C2: the kind is from a closed list');
select is(pg_temp.q('s_support', 'select public.admin_ticket_reply(%L, %L)::text', pg_temp.tk()::text, repeat('x', 4001)), 'ERR:22023', 'C3: 4,000 characters at most');
select is(pg_temp.q('s_support', 'select public.admin_ticket_reply(%L, %L)::text', pg_temp.tk()::text, 'bad' || chr(8203) || 'text'), 'ERR:22023', 'C4: hidden characters are refused');
select is(pg_temp.q('s_support', 'select public.admin_ticket_reply(%L, %L)::text', gen_random_uuid()::text, 'hi'), 'ERR:23503', 'C5: the ticket must exist');
select is(pg_temp.q('s_support', 'select public.admin_ticket_status(%L, %L)::text', pg_temp.tk()::text, 'gone'), 'ERR:22023', 'C6: the status is from a closed list');

-- D. status and closing
select is(pg_temp.q('s_support', 'select public.admin_ticket_status(%L, %L) ->> %L', pg_temp.tk()::text, 'closed', 'status'), 'closed', 'D1: close it');
select isnt((select closed_at from admin.support_tickets where id = pg_temp.tk()), null, 'D2: closing stamps the time');
select is(pg_temp.q('s_support', 'select public.admin_ticket_reply(%L, %L)::text', pg_temp.tk()::text, 'one more thing'), 'ERR:SM947', 'D3: a closed ticket takes no reply');
select is(pg_temp.q('s_support', 'select public.admin_ticket_status(%L, %L) ->> %L', pg_temp.tk()::text, 'open', 'status'), 'open', 'D4: reopen it');
select is((select closed_at from admin.support_tickets where id = pg_temp.tk()), null, 'D5: reopening clears the closing time');
select is(pg_temp.q('s_support', 'select jsonb_array_length(public.admin_ticket_reply(%L, %L) -> %L)::text', pg_temp.tk()::text, 'back again', 'messages'), '3', 'D6: and takes replies again');

-- E. assigning
select is(pg_temp.q('s_support', 'select public.admin_ticket_assign(%L, %L) -> %L ->> %L', pg_temp.tk()::text, tests.uid('s_owner')::text, 'assignee', 'name'), 'Gowtham R', 'E1: hand it to the owner');
select is(pg_temp.q('s_support', 'select public.admin_ticket_assign(%L, null) ->> %L', pg_temp.tk()::text, 'assignee'), null, 'E2: or to nobody');
select is(pg_temp.q('s_support', 'select public.admin_ticket_assign(%L, %L)::text', pg_temp.tk()::text, tests.uid('s_finance')::text), 'ERR:22023', 'E3: finance staff do not take customer tickets');
select is(pg_temp.q('s_support', 'select public.admin_ticket_assign(%L, %L)::text', pg_temp.tk()::text, gen_random_uuid()::text), 'ERR:22023', 'E4: nor does someone who is not staff');

-- F. the trail
select cmp_ok((select count(*)::int from admin.audit where target_kind = 'ticket' and target_id = pg_temp.tk()::text and action = 'note'), '>=', 4, 'F1: every reply and note is in the audit trail');
select cmp_ok((select count(*)::int from admin.audit where target_kind = 'ticket' and target_id = pg_temp.tk()::text and action = 'status'), '>=', 4, 'F2: every status change and assignment too');
select is((select count(*) from admin.audit where target_kind = 'ticket' and customer_visible), 0::bigint, 'F3: none of it is shown to the shop');
select throws_ok($q$update admin.ticket_messages set body = 'changed'$q$, '42501', null, 'F4: a message cannot be edited');
select throws_ok($q$delete from admin.ticket_messages$q$, '42501', null, 'F5: or deleted');
select is(has_table_privilege('authenticated', 'admin.ticket_messages', 'select'), false, 'F6: no client can read the table');

select * from finish();
rollback;
