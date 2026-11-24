-- Opening sign-up (migration 20261231990700): closed by default, one verified identity gets one trial credit, throwaway mail and a reused phone are refused, codes are limited, and nobody sees another person's data.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
-- (a hash is written inline: statements run as the member, who cannot reach this session's temp schema)

-- A. closed by default; the switch is for system accounts only
select is(pg_temp.at('a_owner', $q$select (public.signup_status() ->> 'open')$q$), 'false', 'A1: sign-up is closed until the operator opens it');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_start(encode(sha256(convert_to('p1', 'UTF8')), 'hex'), encode(sha256(convert_to('c1', 'UTF8')), 'hex'), null) ->> 'reason'$q$), 'closed', 'A2: no phone code while closed');
select is(pg_temp.at('a_owner', $q$select public.ops_signup_set(true, null, null, null, null)::text$q$), 'ERR:42501', 'A3: a member cannot open it');
select is(pg_temp.at('anon', $q$select public.signup_status()::text$q$), 'ERR:42501', 'A4: nor a stranger read the status');
select is(pg_temp.at('a_owner', format($q$select public.signup_trial_claim(%L) ->> 'reason'$q$, tests.tid('a'))), 'closed', 'A5: no credit while closed');
select is(signup.email_key('A.B+news@Gmail.com'), signup.email_key('ab@googlemail.com'), 'A6: Gmail dots, +tags and googlemail are one identity');
select isnt(signup.email_key('ab@example.com'), signup.email_key('a.b@example.com'), 'A7: dots count outside Gmail');
update signup.settings set open = true;

-- B. consent: only the current versions count
select is(pg_temp.at('a_owner', $q$select public.signup_consent_record('terms', 'old')::text$q$), 'ERR:22023', 'B1: an old version is refused');
select is(pg_temp.at('a_owner', $q$select public.signup_consent_record('cookies', '2026-11')::text$q$), 'ERR:22023', 'B2: an unknown kind is refused');
select is(pg_temp.at('a_owner', $q$select public.signup_status() ->> 'consent_done'$q$), 'false', 'B3: not done yet');
select is(pg_temp.at('a_owner', $q$select public.signup_consent_record('terms', '2026-11')::text$q$), '{"ok": true}', 'B4: terms recorded');
select is(pg_temp.at('a_owner', $q$select public.signup_consent_record('privacy', '2026-11')::text$q$), '{"ok": true}', 'B5: privacy recorded');
select is(pg_temp.at('a_owner', $q$select public.signup_status() ->> 'consent_done'$q$), 'false', 'B5b: two of three is not done');
select is(pg_temp.at('a_owner', $q$select public.signup_consent_record('aup', '2026-11')::text$q$), '{"ok": true}', 'B5c: the acceptable-use policy recorded');
select is(pg_temp.at('a_owner', $q$select public.signup_status() ->> 'consent_done'$q$), 'true', 'B6: all three current versions recorded');
select is(pg_temp.at('a_owner', format($q$select public.signup_trial_claim(%L) ->> 'reason'$q$, tests.tid('a'))), 'phone_not_verified', 'B7: no credit without a verified phone');

-- C. the phone code: wrong tries are counted and kept, five is the end, the right code verifies
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('c1', 'UTF8')), 'hex'))::text$q$), '{"ok": false, "reason": "no_code"}', 'C1: no code was asked for');
select is(pg_temp.at('a_owner', $q$select (public.signup_phone_start(encode(sha256(convert_to('p1', 'UTF8')), 'hex'), encode(sha256(convert_to('c1', 'UTF8')), 'hex'), encode(sha256(convert_to('ip1', 'UTF8')), 'hex'))) ->> 'ok'$q$), 'true', 'C2: a code is started');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('bad', 'UTF8')), 'hex'))::text$q$), '{"ok": false, "reason": "wrong_code", "tries_left": 4}', 'C3: a wrong code costs a try');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('bad', 'UTF8')), 'hex'))::text$q$), '{"ok": false, "reason": "wrong_code", "tries_left": 3}', 'C4: and the count stays');
select is((select attempts from signup.phone_challenges where user_id = tests.uid('a_owner')), 2, 'C5: two tries recorded');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('bad', 'UTF8')), 'hex'))::text$q$) like '%wrong_code%', true, 'C6: third');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('bad', 'UTF8')), 'hex'))::text$q$) like '%wrong_code%', true, 'C7: fourth');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('bad', 'UTF8')), 'hex'))::text$q$) like '%wrong_code%', true, 'C8: fifth');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('c1', 'UTF8')), 'hex'))::text$q$), '{"ok": false, "reason": "too_many_tries"}', 'C9: after five wrong tries even the right code is refused');
select is(pg_temp.at('a_owner', $q$select (public.signup_phone_start(encode(sha256(convert_to('p1', 'UTF8')), 'hex'), encode(sha256(convert_to('c2', 'UTF8')), 'hex'), encode(sha256(convert_to('ip1', 'UTF8')), 'hex'))) ->> 'ok'$q$), 'true', 'C10: a new code resets the tries');
update signup.phone_challenges set expires_at = now() - interval '1 minute' where user_id = tests.uid('a_owner');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('c2', 'UTF8')), 'hex'))::text$q$), '{"ok": false, "reason": "expired"}', 'C11: an old code is refused');
select is(pg_temp.at('a_owner', $q$select (public.signup_phone_start(encode(sha256(convert_to('p1', 'UTF8')), 'hex'), encode(sha256(convert_to('c3', 'UTF8')), 'hex'), encode(sha256(convert_to('ip1', 'UTF8')), 'hex'))) ->> 'ok'$q$), 'true', 'C12: the third code for one phone in an hour still goes');
select is(pg_temp.at('a_owner', $q$select (public.signup_phone_start(encode(sha256(convert_to('p1', 'UTF8')), 'hex'), encode(sha256(convert_to('c4', 'UTF8')), 'hex'), encode(sha256(convert_to('ip1', 'UTF8')), 'hex'))) ->> 'reason'$q$), 'rate', 'C12b: the fourth is refused (three an hour for one phone)');
update signup.hits set n = 0;
select is(pg_temp.at('a_owner', $q$select (public.signup_phone_start(encode(sha256(convert_to('p1', 'UTF8')), 'hex'), encode(sha256(convert_to('c3', 'UTF8')), 'hex'), encode(sha256(convert_to('ip1', 'UTF8')), 'hex'))) ->> 'ok'$q$), 'true', 'C13: after the hour the limit is open again');
select is(pg_temp.at('a_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('c3', 'UTF8')), 'hex'))::text$q$), '{"ok": true}', 'C14: the right code verifies');
select is(pg_temp.at('a_owner', $q$select public.signup_status() ->> 'phone_verified'$q$), 'true', 'C15: the phone is verified');
select is((select count(*) from signup.phone_challenges where user_id = tests.uid('a_owner')), 0::bigint, 'C16: the challenge is gone');

-- D. the credit: once per identity, the amount is the free start, a member who is not the Owner cannot claim
select is(pg_temp.at('a_admin', format($q$select public.signup_trial_claim(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D1: an Admin cannot claim for the workspace');
select is(pg_temp.at('b_owner', format($q$select public.signup_trial_claim(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D2: nor another workspace''s Owner');
select is(pg_temp.at('a_owner', format($q$select (public.signup_trial_claim(%L)) ->> 'granted'$q$, tests.tid('a'))), 'true', 'D3: the verified Owner gets the credit');
select is((select balance_paise from (select pricing.balance_of(tests.tid('a')) as balance_paise) x), (select free_start_paise::bigint from pricing.settings), 'D4: the amount is the free start');
select is(pg_temp.at('a_owner', format($q$select public.signup_trial_claim(%L) ->> 'reason'$q$, tests.tid('a'))), 'email_used', 'D5: a second claim by the same identity is refused');
select is((select count(*) from signup.trial_identities where tenant_id = tests.tid('a')), 1::bigint, 'D6: one identity row, no address kept');

-- E. another person: the same phone is refused, a different phone works, the day's cap stops it
select is(pg_temp.at('b_owner', $q$select signup.hit('x:0000000000000000', 1)::text$q$), 'ERR:42501', 'E0: the helpers are not callable by members');
select is(pg_temp.at('b_owner', $q$select public.signup_consent_record('terms', '2026-11')::text$q$), '{"ok": true}', 'E1: b consents (terms)');
select is(pg_temp.at('b_owner', $q$select public.signup_consent_record('privacy', '2026-11')::text$q$), '{"ok": true}', 'E2: (privacy)');
select is(pg_temp.at('b_owner', $q$select public.signup_consent_record('aup', '2026-11')::text$q$), '{"ok": true}', 'E2b: (acceptable use)');
select is(pg_temp.at('b_owner', $q$select public.signup_phone_start(encode(sha256(convert_to('p1', 'UTF8')), 'hex'), encode(sha256(convert_to('c9', 'UTF8')), 'hex'), encode(sha256(convert_to('ip2', 'UTF8')), 'hex'))::text$q$), '{"ok": false, "reason": "phone_taken"}', 'E3: a phone already proved by someone else is refused');
select is(pg_temp.at('b_owner', $q$select (public.signup_phone_start(encode(sha256(convert_to('p2', 'UTF8')), 'hex'), encode(sha256(convert_to('c9', 'UTF8')), 'hex'), encode(sha256(convert_to('ip2', 'UTF8')), 'hex'))) ->> 'ok'$q$), 'true', 'E4: another phone starts');
select is(pg_temp.at('b_owner', $q$select public.signup_phone_verify(encode(sha256(convert_to('c9', 'UTF8')), 'hex'))::text$q$), '{"ok": true}', 'E5: and verifies');
update signup.settings set trial_daily_cap = 1;
select is(pg_temp.at('b_owner', format($q$select public.signup_trial_claim(%L) ->> 'reason'$q$, tests.tid('b'))), 'daily_cap', 'E6: the day''s cap stops the next credit');
update signup.settings set trial_daily_cap = 100;
insert into signup.blocked_email_domains (domain) values ('test.local');
select is(pg_temp.at('b_owner', format($q$select public.signup_trial_claim(%L) ->> 'reason'$q$, tests.tid('b'))), 'email_blocked', 'E7: a blocked domain gets no credit');
select is(pg_temp.at('b_owner', $q$select public.signup_status() ->> 'email_blocked'$q$), 'true', 'E8: and the screen can say so');
delete from signup.blocked_email_domains where domain = 'test.local';
select is(pg_temp.at('b_owner', format($q$select (public.signup_trial_claim(%L)) ->> 'granted'$q$, tests.tid('b'))), 'true', 'E9: with a clean domain b gets the credit');

-- F. no client role touches the tables
select is(has_table_privilege('authenticated', 'signup.settings', 'select'), false, 'F1: settings are closed to members');
select is(has_table_privilege('authenticated', 'signup.verified_phones', 'select'), false, 'F2: phones are closed to members');
select is(has_table_privilege('authenticated', 'signup.phone_challenges', 'select'), false, 'F3: challenges are closed');
select is(has_table_privilege('anon', 'signup.consents', 'select'), false, 'F4: consents are closed to strangers');
select is((select count(*) from signup.blocked_email_domains where domain in ('mailinator.com', 'yopmail.com')), 2::bigint, 'F5: the throwaway list is seeded');

select * from finish();
rollback;
