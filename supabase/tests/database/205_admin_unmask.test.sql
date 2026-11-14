-- Admin console phase 2, slice 4: unmasking an end-customer's name and number needs a second reason, is its own audit row, and is shown to the shop owner.
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
-- a business with one customer who called
select tests.open_gate('a');
insert into public.contacts (tenant_id, full_name, phone) values (tests.tid('a'), 'Priya Narayanan', '+91 98765 43210');
insert into public.phone_calls (tenant_id, direction, provider, state, contact_id, created_at, ended_at)
select tests.tid('a'), 'inbound', 'plivo', 'completed', c.id, now(), now() from public.contacts c where c.tenant_id = tests.tid('a') and c.full_name = 'Priya Narayanan';
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to public;
insert into t_ids select 'acc', (pg_temp.sup('s_support', $q$select public.admin_access_open(%L, 'profile', 'support_ticket')::jsonb ->> 'access_id'$q$, tests.tid('a')::text))::uuid;
create function pg_temp.acc() returns text language sql as $$ select v::text from t_ids where k = 'acc' $$;

-- A. who may
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number')::text$q$, tests.tid('a'), pg_temp.acc())), 'ERR:SM941', 'A1: a shop owner is not staff');
select is(pg_temp.sup('s_finance', $q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number')::text$q$, tests.tid('a')::text, pg_temp.acc()), 'ERR:42501', 'A2: finance never sees customers');
select is(pg_temp.st('s_support', 'aal1', 'sess-s_support-0001', format($q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number')::text$q$, tests.tid('a'), pg_temp.acc())), 'ERR:SM942', 'A3: the second factor is always needed');

-- B. masked first (the support view), unmasked only with the second reason
select is(pg_temp.sup('s_support', $q$select public.admin_business_get(%L, %L) -> 'recent_calls' -> 0 ->> 'customer_phone'$q$, tests.tid('a')::text, pg_temp.acc()), '+•• ••••• ••210', 'B1: the support view shows the number masked');
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number') -> 'recent_calls' -> 0 ->> 'customer_phone'$q$, tests.tid('a')::text, pg_temp.acc()), '+91 98765 43210', 'B2: with a second reason the real number');
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number') -> 'recent_calls' -> 0 ->> 'customer'$q$, tests.tid('a')::text, pg_temp.acc()), 'Priya Narayanan', 'B3: and the real name');
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number')::text like '%%transcript%%'$q$, tests.tid('a')::text, pg_temp.acc()), 'false', 'B4: still no transcript or message text');

-- C. the second reason
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'incident', null)::text$q$, tests.tid('a')::text, pg_temp.acc()), 'ERR:SM946', 'C1: no words, no names');
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'incident', 'ab')::text$q$, tests.tid('a')::text, pg_temp.acc()), 'ERR:SM946', 'C2: at least 3 characters');
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'whim', 'checking a wrong number')::text$q$, tests.tid('a')::text, pg_temp.acc()), 'ERR:22023', 'C3: the code is from the list');
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number')::text$q$, tests.tid('a')::text, gen_random_uuid()::text), 'ERR:SM944', 'C4: needs the business access open first');
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number')::text$q$, tests.tid('b')::text, pg_temp.acc()), 'ERR:SM944', 'C5: and that access is for THIS business only');
update admin.access_grants set expires_at = now() - interval '1 minute', created_at = now() - interval '1 hour' where id = pg_temp.acc()::uuid;
select is(pg_temp.sup('s_support', $q$select public.admin_business_unmask(%L, %L, 'incident', 'checking a wrong number')::text$q$, tests.tid('a')::text, pg_temp.acc()), 'ERR:SM944', 'C6: an expired access opens nothing');

-- D. the trail and the shop owner
select is((select count(*) from admin.audit where action = 'unmask' and tenant_id = tests.tid('a')), 3::bigint, 'D1: each look is its own audit row (3 above worked)');
select is((select reason_text from admin.audit where action = 'unmask' order by at limit 1), 'checking a wrong number', 'D2: with the words that were typed');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select (public.activity_log(%L, 10, null, null, 'support') -> 'items' -> 0 ->> 'summary')$q$, tests.tid('a'))), 'Stack19 support looked at your customers'' contact details', 'D3: the shop owner sees it in plain words');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', format($q$select (public.activity_log(%L, 10, null, null, 'support') -> 'items' -> 0 ->> 'reason')$q$, tests.tid('a'))), 'checking a wrong number', 'D4: with the reason');

select * from finish();
rollback;
