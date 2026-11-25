-- Sign-up in e-mail-only mode (migration 20261231991600): a smaller credit without a phone, stricter limits, the default stays strict.
begin;
select no_plan();
select tests.seed_two_tenants();
create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

update signup.settings set open = true;
select is(pg_temp.at('a_owner', $q$select public.signup_consent_record('terms', '2026-11')::text$q$), '{"ok": true}', 'A1: terms');
select is(pg_temp.at('a_owner', $q$select public.signup_consent_record('privacy', '2026-11')::text$q$), '{"ok": true}', 'A2: privacy');
select is(pg_temp.at('a_owner', $q$select public.signup_consent_record('aup', '2026-11')::text$q$), '{"ok": true}', 'A3: acceptable use');
select is(pg_temp.at('a_owner', $q$select public.signup_status() ->> 'phone_required'$q$), 'true', 'A4: the phone is required by default');
select is(pg_temp.at('a_owner', format($q$select public.signup_trial_claim(%L) ->> 'reason'$q$, tests.tid('a'))), 'phone_not_verified', 'A5: so no credit without one');

update signup.settings set phone_required = false;
select is(pg_temp.at('a_owner', $q$select public.signup_status() ->> 'phone_required'$q$), 'false', 'B1: e-mail-only mode shows in the status');
update signup.settings set email_only_daily_cap = 0;
select is(pg_temp.at('a_owner', format($q$select public.signup_trial_claim(%L) ->> 'reason'$q$, tests.tid('a'))), 'daily_cap', 'B2: its own daily cap');
update signup.settings set email_only_daily_cap = 50;
insert into signup.hits (key_hash, bucket, n) values ('cip:' || encode(sha256(convert_to('ipx', 'UTF8')), 'hex'), date_trunc('hour', now()), 3);
select is(pg_temp.at('a_owner', format($q$select public.signup_trial_claim(%L, encode(sha256(convert_to('ipx', 'UTF8')), 'hex')) ->> 'reason'$q$, tests.tid('a'))), 'rate', 'B3: three claims an hour from one address is the limit');
select is(pg_temp.at('a_owner', format($q$select public.signup_trial_claim(%L, 'not-a-hash') ->> 'reason'$q$, tests.tid('a'))), 'ERR:22023', 'B4: a malformed address hash is refused');
select is(pg_temp.at('a_owner', format($q$select (public.signup_trial_claim(%L, encode(sha256(convert_to('ip-other', 'UTF8')), 'hex'))) ->> 'granted'$q$, tests.tid('a'))), 'true', 'B5: another address, no phone: the smaller credit is granted');
select is((select count(*) from pricing.free_starts where tenant_id = tests.tid('a') and phone_hash is null), 1::bigint, 'B6: recorded as an e-mail-only start');
select is(pricing.balance_of(tests.tid('a')), (select email_only_paise::bigint from signup.settings), 'B7: the amount is the e-mail-only credit, not the full free start');
select isnt(pricing.balance_of(tests.tid('a')), (select free_start_paise::bigint from pricing.settings), 'B8: and smaller than the full one');
select is(pg_temp.at('a_owner', format($q$select public.signup_trial_claim(%L) ->> 'reason'$q$, tests.tid('a'))), 'email_used', 'B9: the same e-mail cannot claim twice');
select is(pg_temp.at('a_admin', format($q$select public.signup_trial_claim(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C1: only the Owner claims');
select is(pg_temp.at('a_owner', $q$select public.ops_signup_set(true, null, null, null, null, false, 2000, 10)::text$q$), 'ERR:42501', 'C2: members cannot change the mode');
select * from finish();
rollback;
