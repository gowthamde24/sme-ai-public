-- Credential deadlines (migration 20261231930000): a warning from 14 days before a known expiry, one more on the day, the owner alone sees it, the worker e-mails it once.
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
create function pg_temp.w(p_sql text, p_user text default 'outsider') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A. nothing in the warning window yet: no alert
insert into ops.credential_deadlines (key, label, expires_at, what_to_do) values ('meta_page_token', 'The Meta Page token (data access)', now() + interval '40 days', 'Log in to Meta again and run scripts/staging_meta_secrets.py.');
select is(jsonb_array_length(pg_temp.w($q$select (public.ops_credential_alerts_run() -> 'new')::text$q$)::jsonb), 0, 'A1: 40 days before is outside the 14-day window');
select is((select count(*) from admin.alerts), 0::bigint, 'A2: no alert row');
select is(pg_temp.w($q$select (public.ops_credential_alerts_run() -> 'new')::text$q$, 's_owner'), 'ERR:42501', 'A3: only the system account runs it');

-- B. inside the window: one warning, however often it runs
update ops.credential_deadlines set expires_at = now() + interval '10 days' where key = 'meta_page_token';
select is(jsonb_array_length(pg_temp.w($q$select (public.ops_credential_alerts_run() -> 'new')::text$q$)::jsonb), 1, 'B1: 10 days before: one alert to send');
select is(jsonb_array_length(pg_temp.w($q$select (public.ops_credential_alerts_run() -> 'new')::text$q$)::jsonb), 1, 'B2: a second run lists the same one');
select is((select count(*) from admin.alerts where kind = 'credential_expiry'), 1::bigint, 'B3: one stored row');
select is((select severity from admin.alerts where kind = 'credential_expiry'), 'warn', 'B4: a warning');
select ok((select title from admin.alerts where kind = 'credential_expiry') like 'The Meta Page token (data access) expires on %', 'B5: the title says when');
select is(jsonb_array_length(pg_temp.sup('s_owner', $q$select (public.admin_alerts_list() -> 'items')::text$q$)::jsonb), 1, 'B6: the owner sees it');
select is(jsonb_array_length(pg_temp.sup('s_finance', $q$select (public.admin_alerts_list() -> 'items')::text$q$)::jsonb), 0, 'B7: finance does not');
select is(jsonb_array_length(pg_temp.sup('s_support', $q$select (public.admin_alerts_list() -> 'items')::text$q$)::jsonb), 0, 'B8: support does not');
select pg_temp.w(format($q$select public.ops_alert_mark_emailed(array[%L]::uuid[])::text$q$, (select id from admin.alerts where kind = 'credential_expiry' limit 1)));
select is(jsonb_array_length(pg_temp.w($q$select (public.ops_credential_alerts_run() -> 'new')::text$q$)::jsonb), 0, 'B9: once e-mailed it is not listed again');

-- C. the day has passed: one more alert, "over"
update ops.credential_deadlines set expires_at = now() - interval '1 hour' where key = 'meta_page_token';
select is(jsonb_array_length(pg_temp.w($q$select (public.ops_credential_alerts_run() -> 'new')::text$q$)::jsonb), 1, 'C1: after the day: one new alert');
select is((select count(*) from admin.alerts where kind = 'credential_expiry' and severity = 'over'), 1::bigint, 'C2: an over alert');
select ok((select title from admin.alerts where kind = 'credential_expiry' and severity = 'over') like '% has expired', 'C3: it says it has expired');

select * from finish();
rollback;
