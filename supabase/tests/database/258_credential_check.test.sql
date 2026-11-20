-- The daily read of the WhatsApp platform token's expiry (migration 20261231986700): only the system account asks and writes, one successful read a day, a failing read is tried again after the retry gap,
-- the date Meta gave is what the existing credential alerts warn on (14 days before, once on the day), a renewed token starts clean.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.w(p_sql text, p_user text default 'outsider') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A. who
select is(pg_temp.w($q$select public.ops_credential_check_due('whatsapp.platform_token')::text$q$, 'a_owner'), 'ERR:42501', 'A1 a workspace owner cannot ask');
select is(pg_temp.w($q$select public.ops_credential_check_due('whatsapp.platform_token')::text$q$), 'true', 'A2 nothing read yet: a read is due');
select is(pg_temp.w($q$select public.ops_credential_check_due('Bad Key!')::text$q$), 'ERR:22023', 'A3 a bad key is refused');
select is(pg_temp.w($q$select public.ops_credential_deadline_set('whatsapp.platform_token', 'WhatsApp platform token', now() + interval '10 days', 14, 'Make a new token.')::text$q$, 'a_owner'), 'ERR:42501', 'A4 nor can a workspace owner write');

-- B. a try is marked first: no second try within the retry gap, even though nothing was read
select pg_temp.w($q$select public.ops_credential_check_attempt('whatsapp.platform_token', 'WhatsApp platform token')::text$q$);
select is(pg_temp.w($q$select public.ops_credential_check_due('whatsapp.platform_token')::text$q$), 'false', 'B1 just tried: not due again for an hour');
update ops.credential_deadlines set attempted_at = now() - interval '2 hours' where key = 'whatsapp.platform_token';
select is(pg_temp.w($q$select public.ops_credential_check_due('whatsapp.platform_token')::text$q$), 'true', 'B2 after the gap the failing read is tried again');
select is((select expires_at from ops.credential_deadlines where key = 'whatsapp.platform_token'), timestamptz '2100-01-01', 'B3 until Meta answers the row says "never" (no alert)');

-- C. what Meta said
select is(pg_temp.w($q$select (public.ops_credential_deadline_set('whatsapp.platform_token', 'WhatsApp platform token', now() + interval '10 days', 14, 'Make a new token.') ->> 'never')$q$), 'false', 'C1 a token that stops in 10 days is written');
select is(pg_temp.w($q$select public.ops_credential_check_due('whatsapp.platform_token')::text$q$), 'false', 'C2 read today: not due');
update ops.credential_deadlines set checked_at = now() - interval '25 hours', attempted_at = now() - interval '25 hours' where key = 'whatsapp.platform_token';
select is(pg_temp.w($q$select public.ops_credential_check_due('whatsapp.platform_token')::text$q$), 'true', 'C3 a day later it is read again');
select is(pg_temp.w($q$select jsonb_array_length((public.ops_credential_alerts_run() -> 'new'))::text$q$), '1', 'C4 within 14 days the existing alert run raises ONE alert');
select is((select count(*)::int from admin.alerts where kind = 'credential_expiry' and title like 'WhatsApp platform token expires on%'), 1, 'C5 it names the credential and the day, never the token');
select pg_temp.w($q$select public.ops_credential_alerts_run()::text$q$);
select is((select count(*)::int from admin.alerts where kind = 'credential_expiry'), 1, 'C6 a second run adds nothing');

-- D. a renewed token starts clean; "never" does not warn
select pg_temp.w($q$select public.ops_credential_deadline_set('whatsapp.platform_token', 'WhatsApp platform token', null, 14, 'Make a new token.')::text$q$);
select is((select expires_at from ops.credential_deadlines where key = 'whatsapp.platform_token'), timestamptz '2100-01-01', 'D1 a token that never expires is the year 2100');
select is(pg_temp.w($q$select public.ops_credential_deadline_set('whatsapp.platform_token', 'WhatsApp platform token', now() + interval '40 days', 14, 'Make a new token.')::text$q$) like '%false%', true, 'D2 a renewed token with a later date');
select is(pg_temp.w($q$select jsonb_array_length((public.ops_credential_alerts_run() -> 'new'))::text$q$), '1', 'D3 40 days away: no new alert (the first one is still unsent and listed)');
select is((select count(*)::int from admin.alerts where kind = 'credential_expiry'), 1, 'D4 and none was added');
select is(pg_temp.w($q$select public.ops_credential_deadline_set('whatsapp.platform_token', 'WhatsApp platform token', now() + interval '10 days', 99, 'x')::text$q$), 'ERR:22023', 'D5 a bad warning window is refused');

select * from finish();
rollback;
