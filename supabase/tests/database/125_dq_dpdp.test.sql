-- Job DQ part 4 (migration 20261202090200): DPDP from day one.
--   A consent ledger   B profile   C a grievance from anyone   D the waitlist   E the 7-day cancel window   F lapsed workspace: warning, then erasure   G old logs   H doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-01T12:00:00+05:30'::timestamptz);
select app.operator_register_scheduler('x5@test.local');

-- ============================================================================ A. consent
select is(pg_temp.val('a_owner', $q$select (public.consents_mine() -> 'consents' -> 0 ->> 'state')$q$), 'given', 'A1 the service consent is shown as given (the account exists)');
select is(pg_temp.val('a_owner', $q$select (public.consents_mine() -> 'consents' -> 1 ->> 'state')$q$), 'not_given', 'A2 marketing is OFF by default');
select is(pg_temp.val('a_owner', $q$select (public.consent_set_marketing(true, 'settings', '2026-10-25') -> 'consents' -> 1 ->> 'state')$q$), 'given', 'A3 giving marketing consent');
select is((select count(*)::int from privacy.consent_events where user_id = tests.uid('a_owner') and purpose = 'marketing'), 1, 'A4 one ledger row');
select is(pg_temp.val('a_owner', $q$select (public.consent_set_marketing(true, 'settings', '2026-10-25') -> 'consents' -> 1 ->> 'state')$q$), 'given', 'A5 giving it again is fine');
select is((select count(*)::int from privacy.consent_events where user_id = tests.uid('a_owner') and purpose = 'marketing'), 1, 'A6 ... and writes nothing new');
select pg_temp.pin('2026-11-02T12:00:00+05:30'::timestamptz);
select is(pg_temp.val('a_owner', $q$select (public.consent_set_marketing(false, 'settings', '2026-10-25') -> 'consents' -> 1 ->> 'state')$q$), 'withdrawn', 'A7 withdrawing is the SAME one call');
select is((select count(*)::int from privacy.consent_events where user_id = tests.uid('a_owner') and purpose = 'marketing'), 2, 'A8 the history keeps both');
select is(pg_temp.val('a_owner', $q$select (public.consents_mine() -> 'history' -> 0 ->> 'action')$q$), 'withdrawn', 'A9 newest first');
select is(pg_temp.val('a_owner', $q$select (public.consents_mine() -> 'history' -> 1 ->> 'via')$q$), 'settings', 'A10 how it was given is recorded');
select is(pg_temp.val('a_owner', $q$select (public.consent_set_marketing(true, 'google', '2026-10-25') -> 'consents' -> 1 ->> 'via')$q$), 'google', 'A11 given at a Google sign-up is recorded as google');
select is(pg_temp.val('a_owner', $q$select public.consent_set_marketing(true, 'prompt', '2026-10-25')::text$q$), 'ERR:22023', 'A12 "prompt" is not a way to give marketing consent (invalid)');
select is(pg_temp.val('a_owner', $q$select public.consent_set_marketing(null, 'settings', '2026-10-25')::text$q$), 'ERR:22023', 'A13 a missing answer is invalid');
select is(pg_temp.val('a_owner', $q$select public.consent_set_marketing(true, 'settings', 'bad version!')::text$q$), 'ERR:22023', 'A14 a malformed notice version is invalid');
select is(pg_temp.val('anon', $q$select public.consents_mine()::text$q$), 'ERR:42501', 'A15 no sign-in, no answer');
select is(pg_temp.val('a_sales', $q$select (public.consents_mine() -> 'consents' -> 1 ->> 'state')$q$), 'not_given', 'A16 another person''s consent is not mine');
select throws_ok($q$insert into privacy.consent_events (user_id, purpose, action, notice_version, via) values (tests.uid('a_owner'), 'service', 'withdrawn', '2026-10-25', 'settings')$q$, '23514', null, 'A17 the service consent cannot be withdrawn (it ends with the account)');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action = 'consent.changed'), 3, 'A18 each change is logged in the workspace trail');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action = 'consent.changed' and new_values::text ~* 'a_owner|@'), 0, 'A19 the log holds no name or address');
-- policy_accept now also records the service consent
select ok(pg_temp.val('a_viewer', $q$select public.policy_accept('2026-10-25', '2026-10-25', 'signup')::text$q$) not like 'ERR:%', 'A20 accepting the notice works');
select is((select via from privacy.consent_events where user_id = tests.uid('a_viewer') and purpose = 'service' and notice_version = '2026-10-25'), 'signup', 'A21 ... and writes the service consent (via signup)');
select is(pg_temp.val('a_viewer', $q$select public.policy_accept('2026-10-25', '2026-10-25', 'signup') is not null$q$), 'true', 'A22 again: fine');
select is((select count(*)::int from privacy.consent_events where user_id = tests.uid('a_viewer') and purpose = 'service' and notice_version = '2026-10-25'), 1, 'A23 ... once per notice version');
update auth.users set raw_app_meta_data = jsonb_set(coalesce(raw_app_meta_data, '{}'::jsonb), '{provider}', '"google"') where id = tests.uid('a_sales');
select pg_temp.val('a_sales', $q$select public.policy_accept(null, '2026-10-25', 'signup')::text$q$);
select is((select via from privacy.consent_events where user_id = tests.uid('a_sales') and purpose = 'service'), 'google', 'A24 an account that came from Google says google');

-- ============================================================================ B. profile
select is(pg_temp.val('a_admin', $q$select public.profile_get() ->> 'display_name'$q$), 'a_admin', 'B1 my profile');
select is(pg_temp.val('a_admin', $q$select public.profile_get() ->> 'email'$q$), 'a_admin@test.local', 'B2 ... with my address (read only)');
select is(pg_temp.val('a_admin', $q$select public.profile_set('  Asha Rao  ') ->> 'display_name'$q$), 'Asha Rao', 'B3 correcting my name');
select is((select display_name from public.users where id = tests.uid('a_admin')), 'Asha Rao', 'B4 it is stored');
select is(pg_temp.val('a_admin', $q$select public.profile_set('')::text$q$), 'ERR:22023', 'B5 an empty name is invalid');
select is(pg_temp.val('a_admin', format($q$select public.profile_set(%L)::text$q$, repeat('x', 101))), 'ERR:22023', 'B6 too long is invalid');
select is(pg_temp.val('a_admin', $q$select public.profile_set('<script>')::text$q$), 'ERR:22023', 'B7 markup is refused');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action = 'profile.corrected' and entity_id = tests.uid('a_admin')), 1, 'B8 the correction is logged');
select is((select count(*)::int from public.audit_events where action = 'profile.corrected' and new_values::text ~* 'Asha'), 0, 'B9 ... without the value');
select is(pg_temp.val('anon', $q$select public.profile_get()::text$q$), 'ERR:42501', 'B10 no sign-in, no profile');
select is(pg_temp.val('a_viewer', $q$select public.profile_get() ->> 'display_name'$q$), 'a_viewer', 'B11 one person''s correction does not touch another''s');

-- ============================================================================ C. a grievance from anyone
select ok(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi Kumar', 'ravi@example.test', 'erasure', 'Please delete my data', 'en') ->> 'reference'$q$, tests.rid('pg1'))) like 'GR-2026-%', 'C1 anyone can file one, and gets a reference');
select is(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi Kumar', 'ravi@example.test', 'erasure', 'Please delete my data', 'en') ->> 'replayed'$q$, tests.rid('pg1'))), 'true', 'C2 the same grievance again is a replay');
select is((select count(*)::int from privacy.public_grievances), 1, 'C3 ... one row');
select is(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi Kumar', 'ravi@example.test', 'erasure', '', 'en') ->> 'answer_within_days'$q$, tests.rid('pg1'))), '30', 'C4 the answer time is 30 days');
select is((select (due_at at time zone 'Asia/Kolkata')::date from privacy.public_grievances where id = tests.rid('pg1')), '2026-12-02'::date, 'C5 the due date is 30 days on (the clock was at 2 November)');
select is(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi Kumar', 'someone.else@example.test', 'erasure', '', 'en')::text$q$, tests.rid('pg1'))), 'ERR:22023', 'C6 an id reused for another person is refused');
select is(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'X', 'x@example.test', 'nonsense', '', 'en')::text$q$, tests.rid('pg2'))), 'ERR:22023', 'C7 an unknown kind is invalid');
select is(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'X', 'x@example.test', 'other', '', 'zz')::text$q$, tests.rid('pg2'))), 'ERR:22023', 'C8 an unknown language is invalid');
select is(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, '', 'x@example.test', 'other')::text$q$, tests.rid('pg2'))), 'ERR:22023', 'C9 no name is invalid');
select is(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi', 'ravi@example.test', 'other', repeat('a', 4001))::text$q$, tests.rid('pg2'))), 'ERR:22023', 'C10 a huge text is invalid');
select pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi', 'ravi@example.test', 'other')::text$q$, tests.rid('pg3')));
select pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi', 'ravi@example.test', 'other')::text$q$, tests.rid('pg4')));
select pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi', 'ravi@example.test', 'other')::text$q$, tests.rid('pg5')));
select pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi', 'ravi@example.test', 'other')::text$q$, tests.rid('pg6')));
select is(pg_temp.val('anon', format($q$select public.public_grievance_submit(%L, 'Ravi', 'RAVI@example.test', 'other')::text$q$, tests.rid('pg7'))), 'ERR:SM614', 'C11 the sixth in a day from one contact is refused (the cap is in the database)');
select is(pg_temp.val('anon', $q$select count(*)::text from privacy.public_grievances$q$), 'ERR:42501', 'C12 the public key cannot read the grievances');
select is(pg_temp.val('a_owner', $q$select count(*)::text from privacy.public_grievances$q$), 'ERR:42501', 'C13 a signed-in member cannot read them either');
select is(pg_temp.val('x5', $q$select jsonb_array_length(public.scheduler_public_intake_due() -> 'grievances')::text$q$), '5', 'C15 the worker is offered the five to e-mail');
select is(pg_temp.val('x5', $q$select (public.scheduler_public_intake_due() -> 'grievances' -> 0 ->> 'need_ack')$q$), 'true', 'C16 an e-mail contact is acknowledged by e-mail');
select is(pg_temp.val('x5', format($q$select public.scheduler_public_intake_mark('grievance', %L, 'inbox')::text$q$, tests.rid('pg1'))), '', 'C17 the worker marks the inbox mail sent');
select pg_temp.val('x5', format($q$select public.scheduler_public_intake_mark('grievance', %L, 'ack')::text$q$, tests.rid('pg1')));
select is(pg_temp.val('x5', $q$select jsonb_array_length(public.scheduler_public_intake_due() -> 'grievances')::text$q$), '4', 'C18 ... and it is not offered again');
select is(pg_temp.val('a_owner', $q$select public.scheduler_public_intake_due()::text$q$), 'ERR:42501', 'C19 a member is not the worker');
select is(pg_temp.val('x5', $q$select public.scheduler_public_intake_mark('grievance', gen_random_uuid(), 'nonsense')::text$q$), 'ERR:22023', 'C20 an unknown mark is invalid');

-- ============================================================================ D. the waitlist
select is(pg_temp.val('anon', $q$select public.waitlist_join('Sita Devi', 'textiles', 'Guntur', '+91 98765 43210', null, 'te', false, '2026-10-25') ->> 'status'$q$), 'joined', 'D1 anyone can join');
select is((select marketing_opt_in from privacy.waitlist_entries where email is null limit 1), false, 'D2 marketing is off unless they said so');
select is((select notice_version from privacy.waitlist_entries limit 1), '2026-10-25', 'D3 the notice they saw is stored with the consent');
select is((select phone from privacy.waitlist_entries limit 1), '+919876543210', 'D4 the phone is stored as digits');
select is(pg_temp.val('anon', $q$select public.waitlist_join('Sita Devi', 'textiles', 'Guntur', '+91-98765-43210', null, 'te', true, '2026-10-25') ->> 'status'$q$), 'already_joined', 'D5 the same person again');
select is((select count(*)::int from privacy.waitlist_entries), 1, 'D6 ... is not a second row');
select is((select marketing_opt_in from privacy.waitlist_entries limit 1), true, 'D7 ... but their latest word on marketing is kept');
select is(pg_temp.val('anon', $q$select public.waitlist_join('A', 'other', 'Pune', null, 'A@Example.TEST', 'ml', true, '2026-10-25') ->> 'status'$q$), 'joined', 'D8 an e-mail alone is enough (and Malayalam is a language)');
select is((select email from privacy.waitlist_entries where name = 'A'), 'a@example.test', 'D9 the address is stored in lower case');
select is(pg_temp.val('anon', $q$select public.waitlist_join('B', 'other', 'Pune', null, null, 'en', true, '2026-10-25')::text$q$), 'ERR:22023', 'D10 neither phone nor e-mail is invalid');
select is(pg_temp.val('anon', $q$select public.waitlist_join('B', 'other', 'Pune', null, 'not-an-address', 'en', true, '2026-10-25')::text$q$), 'ERR:22023', 'D11 a malformed address is invalid');
select is(pg_temp.val('anon', $q$select public.waitlist_join('B', 'bank', 'Pune', null, 'b@example.test', 'en', true, '2026-10-25')::text$q$), 'ERR:22023', 'D12 an unknown business type is invalid');
select is(pg_temp.val('anon', $q$select public.waitlist_join('B', 'other', 'Pune', null, 'b@example.test', 'fr', true, '2026-10-25')::text$q$), 'ERR:22023', 'D13 an unknown language is invalid');
select is(pg_temp.val('anon', $q$select public.waitlist_join('B', 'other', 'Pune', null, 'b@example.test', 'en', null, '2026-10-25')::text$q$), 'ERR:22023', 'D14 the consent answer must be given either way');
select is(pg_temp.val('anon', $q$select count(*)::text from privacy.waitlist_entries$q$), 'ERR:42501', 'D15 the public key cannot read the waitlist');
select is(pg_temp.val('x5', $q$select jsonb_array_length(public.scheduler_public_intake_due() -> 'waitlist')::text$q$), '2', 'D16 the worker is offered two to e-mail');
select pg_temp.val('x5', format($q$select public.scheduler_public_intake_mark('waitlist', %L, 'inbox')::text$q$, (select id from privacy.waitlist_entries where name = 'A')));
select is(pg_temp.val('x5', $q$select jsonb_array_length(public.scheduler_public_intake_due() -> 'waitlist')::text$q$), '1', 'D17 ... one after marking');
insert into privacy.waitlist_entries (contact_key, name, business_type, city, email, language, marketing_opt_in, notice_version, created_at)
select 'cap' || g || '@example.test', 'Cap', 'other', 'Pune', 'cap' || g || '@example.test', 'en', false, '2026-10-25', app.outbox_now() from generate_series(1, 298) g;
select is(pg_temp.val('anon', $q$select public.waitlist_join('Over', 'other', 'Pune', null, 'over@example.test', 'en', false, '2026-10-25')::text$q$), 'ERR:SM614', 'D18 three hundred in an hour is the cap (in the database)');
delete from privacy.waitlist_entries where name = 'Cap';

-- ============================================================================ E. the cancel window
select is(app.deletion_cooling_off(), interval '7 days', 'E1 the cooling-off is 7 days');
select is(pg_temp.val('a_viewer', format($q$select (public.deletion_request(%L, 'account', null, 'a_viewer@test.local') ->> 'execute_after')::timestamptz - (public.deletion_request(%L, 'account', null, 'a_viewer@test.local') ->> 'requested_at')::timestamptz$q$, tests.rid('del1'), tests.rid('del1'))), '7 days', 'E2 an account deletion happens 7 days after the request');
select is(pg_temp.val('a_viewer', format($q$select public.deletion_cancel(%L) ->> 'status'$q$, tests.rid('del1'))), 'cancelled', 'E3 and can be cancelled inside the window');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action in ('deletion.requested', 'deletion.cancelled')), 2, 'E4 both steps are logged');

-- ============================================================================ F. a lapsed workspace
select tests.cn_guards_off();
update public.tenants set trial_started_at = '2026-06-01T12:00:00+05:30' where id = tests.tid('a');   -- no subscription: access ends 30 days after (2026-07-01 12:00)
update public.tenants set trial_started_at = '2026-10-30T12:00:00+05:30' where id = tests.tid('b');   -- not lapsed
select app.operator_set_billing_enforced(true);
select is(app.lapse_erase_at(tests.tid('a')), '2026-09-29T12:00:00+05:30'::timestamptz, 'F1 the erasure moment is 90 days after the access ended');
select is(app.lapse_erase_at(tests.tid('b')), null, 'F2 a workspace that has not lapsed has none');
select pg_temp.pin('2026-09-26T12:00:00+05:30'::timestamptz);   -- 3 days before
select is(pg_temp.val('x5', $q$select (public.scheduler_lapse_due() -> 'warn')::text$q$), '[]', 'F3 the switch is off: nothing is due, whatever the date');
select app.operator_set_lapse_erasure(true);
select is(pg_temp.val('x5', $q$select jsonb_array_length(public.scheduler_lapse_due() -> 'warn')::text$q$), '0', 'F4 three days before: no warning yet');
select pg_temp.pin('2026-09-27T12:00:01+05:30'::timestamptz);   -- 48 hours before
select is(pg_temp.val('x5', $q$select (public.scheduler_lapse_due() -> 'warn' -> 0 ->> 'tenant_name')$q$), 'Tenant A', 'F5 48 hours before: the Owners are to be warned');
select is(pg_temp.val('x5', $q$select (jsonb_array_length(public.scheduler_lapse_due() -> 'warn' -> 0 -> 'emails') = 3 and (public.scheduler_lapse_due() -> 'warn' -> 0 -> 'emails') @> '["dual@test.local", "a_owner@test.local"]'::jsonb)::text$q$), 'true', 'F6 ... at the three Owners'' addresses');
select is(pg_temp.val('x5', $q$select (public.scheduler_lapse_due() -> 'warn' -> 0 ->> 'erase_on')$q$), '2026-09-29', 'F7 ... with the day');
select is(pg_temp.val('x5', format($q$select public.scheduler_lapse_erase(%L)::text$q$, tests.tid('a'))), 'ERR:SM613', 'F8 erasing before the warning went out is refused by the database');
select is(pg_temp.val('x5', format($q$select public.scheduler_lapse_warned(%L)::text$q$, tests.tid('a'))), '', 'F9 the worker marks the warning sent');
select is(pg_temp.val('x5', $q$select jsonb_array_length(public.scheduler_lapse_due() -> 'warn')::text$q$), '0', 'F10 ... and it is not offered again');
select is(pg_temp.val('a_owner', format($q$select public.lapse_erasure_status(%L) ->> 'erasure_warning_sent_at' is not null$q$, tests.tid('a'))), 'true', 'F11 the Owner''s screen can see that the warning went');
select is(pg_temp.val('a_viewer', format($q$select public.lapse_erasure_status(%L) ->> 'erasure_warning_sent_at' is not null$q$, tests.tid('a'))), 'true', 'F12 ... and so can every member');
select is(pg_temp.val('outsider', format($q$select public.lapse_erasure_status(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'F13 ... but not a stranger');
select is(pg_temp.val('a_viewer', format($q$select public.lapse_erasure_status(%L) ->> 'demo'$q$, tests.tid('a'))), 'false', 'F13a an ordinary workspace is not a demo');
select app.operator_set_demo(tests.tid('b'), true);
select is(pg_temp.val('b_viewer', format($q$select public.lapse_erasure_status(%L) ->> 'demo'$q$, tests.tid('b'))), 'true', 'F13b a demo workspace says so (every member can read it)');
select is(pg_temp.val('b_viewer', format($q$select public.lapse_erasure_status(%L) ->> 'exempt'$q$, tests.tid('b'))), 'true', 'F13c ... and a demo is exempt from billing');
select app.operator_set_demo(tests.tid('b'), false);
select app.operator_billing_exempt(tests.tid('b'), false);
select is(pg_temp.val('x5', format($q$select public.scheduler_lapse_erase(%L)::text$q$, tests.tid('a'))), 'ERR:SM613', 'F14 before the day: refused');
select pg_temp.pin('2026-09-29T11:00:00+05:30'::timestamptz);
select is(pg_temp.val('x5', format($q$select public.scheduler_lapse_erase(%L)::text$q$, tests.tid('a'))), 'ERR:SM613', 'F15 an hour before the day: refused');
select pg_temp.pin('2026-09-29T12:00:01+05:30'::timestamptz);   -- the day, and the warning is 48h old
select is(pg_temp.val('x5', $q$select (public.scheduler_lapse_due() -> 'erase' -> 0 ->> 'tenant_id')$q$), tests.tid('a')::text, 'F16 on the day, with a warning 48 hours old: due for erasure');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_lapse_erase(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'F17 only the worker can erase');
select is(pg_temp.val('x5', format($q$select (public.scheduler_lapse_erase(%L) ->> 'request_id') is not null$q$, tests.tid('a'))), 'true', 'F18 the worker erases');
select is((select status::text from public.erasure_requests where tenant_id = tests.tid('a') and scope = 'tenant'), 'executed', 'F19 through the existing tenant erasure');
select is((select result ->> 'reason' from public.erasure_requests where tenant_id = tests.tid('a') and scope = 'tenant'), 'lapsed_90_days', 'F20 ... recorded with its reason');
select is(pg_temp.val('x5', format($q$select public.scheduler_lapse_erase(%L)::text$q$, tests.tid('a'))), 'ERR:SM613', 'F21 a second time: refused');
select is(pg_temp.val('x5', $q$select (public.scheduler_lapse_due() -> 'erase')::text$q$), '[]', 'F22 an erased workspace is not due again');
select is(app.lapse_erase_at(tests.tid('a')), null, 'F23 ... and has no new moment (so no new warning)');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action in ('retention.lapse_warned', 'retention.lapse_erased')), 2, 'F24 both steps are in the trail');
-- exempt and resumed workspaces are never touched
update public.tenants set trial_started_at = '2026-06-01T12:00:00+05:30' where id = tests.tid('b');
select pg_temp.pin('2026-09-28T12:00:00+05:30'::timestamptz);
select is(pg_temp.val('x5', $q$select jsonb_array_length(public.scheduler_lapse_due() -> 'warn')::text$q$), '1', 'F25 workspace b, lapsed the same way, is due a warning');
select app.operator_billing_exempt(tests.tid('b'), true);
select is(pg_temp.val('x5', $q$select jsonb_array_length(public.scheduler_lapse_due() -> 'warn')::text$q$), '0', 'F26 an exempt workspace (Customer Zero, the demos) is never warned');
select is(pg_temp.val('x5', format($q$select public.scheduler_lapse_warned(%L)::text$q$, tests.tid('b'))), 'ERR:22023', 'F27 ... and cannot be marked');
select app.operator_billing_exempt(tests.tid('b'), false);
select app.operator_set_billing_enforced(false);
select is(app.lapse_erasure_enabled(), false, 'F28 with billing not enforced the lapse erasure is off whatever its own switch says');
select app.operator_set_billing_enforced(true);

-- ============================================================================ G. old logs
select pg_temp.pin('2027-12-31T12:00:00+05:30'::timestamptz);   -- more than 395 days after every row made above
update privacy.public_grievances set status = 'resolved', closed_at = '2026-10-01T12:00:00+05:30' where id = tests.rid('pg1');
select is(pg_temp.val('a_owner', $q$select public.privacy_worker_purge_logs()::text$q$), 'ERR:42501', 'G1 only the worker purges');
select cmp_ok((pg_temp.val('x5', $q$select (public.privacy_worker_purge_logs() ->> 'audit_events')$q$))::int, '>', 0, 'G2 audit rows older than 395 days are purged');
select is((select count(*)::int from public.audit_events where created_at < app.outbox_now() - interval '395 days'), 0, 'G3 none older remain');
select is((select count(*)::int from privacy.public_grievances where id = tests.rid('pg1')), 0, 'G4 a resolved public grievance goes a year after it closed');
select is((select count(*)::int from privacy.public_grievances where id = tests.rid('pg3')), 1, 'G5 an open one stays');
select is((select count(*)::int from privacy.waitlist_entries), 0, 'G6 the waitlist is purged after 12 months');

-- ============================================================================ H. doors
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'privacy' and table_name in ('consent_events', 'public_grievances', 'waitlist_entries', 'lapse_erasures') and grantee in ('anon', 'authenticated', 'public')), 0, 'H1 no client holds any right on the new tables');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('public_grievance_submit', 'waitlist_join') and has_function_privilege('anon', p.oid, 'execute')), 2, 'H2 only the two public doors are open to the public key');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('consents_mine', 'consent_set_marketing', 'profile_get', 'profile_set', 'scheduler_lapse_due', 'scheduler_lapse_warned', 'scheduler_lapse_erase', 'scheduler_public_intake_due', 'scheduler_public_intake_mark', 'privacy_worker_purge_logs', 'lapse_erasure_status') and has_function_privilege('anon', p.oid, 'execute')), 0, 'H3 every other new function is closed to the public key');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('public_grievance_submit', 'waitlist_join', 'consents_mine', 'consent_set_marketing', 'profile_get', 'profile_set', 'scheduler_lapse_due', 'scheduler_lapse_warned', 'scheduler_lapse_erase', 'scheduler_public_intake_due', 'scheduler_public_intake_mark', 'privacy_worker_purge_logs', 'lapse_erasure_status') and p.prosecdef and p.proconfig::text ~ 'search_path='), 13, 'H4 every new function is a definer with a fixed search path');

select * from finish();
rollback;
