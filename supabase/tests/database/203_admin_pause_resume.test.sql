-- Admin console phase 2, slice 2: support pauses and resumes a business's assistant (with a reason); the pause really stops inbound calls; the shop owner sees it.
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


create function pg_temp.sup(p_user text, p_fmt text, variadic p_args text[] default '{}') returns text language plpgsql as $$ begin return pg_temp.st(p_user, 'aal2', 'sess-' || p_user || '-0001', format(p_fmt, variadic p_args)); end $$;
select app.operator_register_scheduler('outsider@test.local');
insert into public.phone_numbers (tenant_id, number, label, inbound_on) values (tests.tid('a'), '+914045903172', 'Test line', true);

-- the shop owner of A went live first (so there is a state to restore)
insert into workspace.assistant_live (workspace_id, live, changed_by) values (tests.tid('a'), true, tests.uid('a_owner'));

create function pg_temp.inbound() returns text language sql as $$ select tests.scalar_as(tests.uid('outsider'), $q$select public.phone_line_find('+914045903172') ->> 'inbound_on'$q$) $$;

-- A. who may
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select public.admin_assistant_pause(%L, 'incident')::text$q$, tests.tid('a'))), 'ERR:SM941', 'A1: a shop owner is not staff');
select is(pg_temp.st('s_support', 'aal1', 'sess-s_support-0001', format($q$select public.admin_assistant_pause(%L, 'incident')::text$q$, tests.tid('a'))), 'ERR:SM942', 'A2: the second factor is always needed');
select is(pg_temp.sup('s_finance', $q$select public.admin_assistant_pause(%L, 'incident')::text$q$, tests.tid('a')::text), 'ERR:42501', 'A3: finance does not pause assistants');
select is(pg_temp.sup('s_finance', $q$select public.admin_assistant_resume(%L, 'incident')::text$q$, tests.tid('a')::text), 'ERR:42501', 'A4: nor resume them');

-- B. the reason
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, null)::text$q$, tests.tid('a')::text), 'ERR:22023', 'B1: a reason code is required');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, 'whim')::text$q$, tests.tid('a')::text), 'ERR:22023', 'B2: from the closed list');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, 'other')::text$q$, tests.tid('a')::text), 'ERR:SM946', 'B3: "other" needs words');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, 'other', 'ab')::text$q$, tests.tid('a')::text), 'ERR:SM946', 'B4: of 3 to 300 characters');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, 'incident')::text$q$, gen_random_uuid()::text), 'ERR:23503', 'B5: the business must exist');
select is(pg_temp.inbound(), 'true', 'B6: nothing has changed so far: the line answers');

-- C. pausing really stops inbound calls
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, 'incident', 'wrong numbers being called')::jsonb ->> 'status'$q$, tests.tid('a')::text), 'paused', 'C1: the business shows as paused');
select is(pg_temp.inbound(), 'false', 'C2: the line no longer answers inbound calls');
select is((select staff_hold from workspace.assistant_live where workspace_id = tests.tid('a')), true, 'C3: support holds it');
select is((select live_before from workspace.assistant_live where workspace_id = tests.tid('a')), true, 'C4: and remembers it was live');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select public.assistant_go_live(%L)::text$q$, tests.tid('a'))), 'ERR:SM992', 'C6: it says why (SM992)');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, 'incident')::jsonb ->> 'status'$q$, tests.tid('a')::text), 'paused', 'C7: pausing twice is fine');
select is((select live_before from workspace.assistant_live where workspace_id = tests.tid('a')), true, 'C8: and does not forget it was live');

-- D. the shop owner sees it
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select (public.activity_log(%L, 10, null, null, 'support') -> 'items' -> 0 ->> 'summary')$q$, tests.tid('a'))), 'Stack19 support paused your assistant', 'D1: in their activity log, in plain words');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select (public.activity_log(%L, 10, null, null, 'support') -> 'items' -> 1 ->> 'reason')$q$, tests.tid('a'))), 'wrong numbers being called', 'D2: with the reason (the earlier pause)');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select (public.activity_log(%L, 10, null, null, 'support') -> 'items' -> 0 ->> 'who')$q$, tests.tid('a'))), 'support', 'D3: never a staff name');

-- E. resuming
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_resume(%L, 'customer_asked')::jsonb ->> 'status'$q$, tests.tid('a')::text), 'live', 'E1: resume puts it back to live');
select is(pg_temp.inbound(), 'true', 'E2: and the line answers again');
select is((select staff_hold from workspace.assistant_live where workspace_id = tests.tid('a')), false, 'E3: the hold is gone');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_resume(%L, 'customer_asked')::text$q$, tests.tid('a')::text), 'ERR:22023', 'E4: nothing to resume the second time');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select (public.activity_log(%L, 10, null, null, 'support') -> 'items' -> 0 ->> 'summary')$q$, tests.tid('a'))), 'Stack19 support resumed your assistant', 'E5: the shop owner sees that too');

-- F. a pause by the shop owner is theirs
update workspace.assistant_live set live = false where workspace_id = tests.tid('a');
select is(pg_temp.inbound(), 'false', 'F1: the shop owner''s own pause now stops inbound calls too');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_resume(%L, 'incident')::text$q$, tests.tid('a')::text), 'ERR:22023', 'F2: support cannot lift the shop owner''s own pause');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, 'incident')::jsonb ->> 'status'$q$, tests.tid('a')::text), 'paused', 'F3: support can hold it as well');
select is((select live_before from workspace.assistant_live where workspace_id = tests.tid('a')), false, 'F4: remembering it was already paused');
select is(pg_temp.sup('s_support', $q$select public.admin_assistant_resume(%L, 'incident')::jsonb ->> 'status'$q$, tests.tid('a')::text), 'paused', 'F5: so resume leaves the owner''s own pause in place');

-- G. a business that never went live is not touched by lookups
insert into public.phone_numbers (tenant_id, number, label, inbound_on) values (tests.tid('b'), '+914045903173', 'B line', true);
select is(tests.scalar_as(tests.uid('outsider'), $q$select public.phone_line_find('+914045903173') ->> 'inbound_on'$q$), 'true', 'G1: no assistant_live row: unchanged (answers)');

select * from finish();
rollback;
