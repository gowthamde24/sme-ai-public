-- Admin console, phase 1: staff only, a second factor ALWAYS, a 30-minute session, a reason before any business is opened, an append-only audit trail, masking, the shop owner's switch.
begin;
select no_plan();
select tests.seed_two_tenants();

-- staff accounts: people who belong to no workspace (the fixtures a_owner / b_owner are shop members)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@staff.test', now(), jsonb_build_object('display_name', n), now(), now()
  from unnest(array['s_owner', 's_owner2', 's_support', 's_finance', 's_gone', 's_plain']) n;

-- call a statement as a user with explicit claims (aal, session id); returns the text result or 'ERR:<sqlstate>'
create function pg_temp.st(p_user text, p_aal text, p_sid text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', case when p_user = 'anon' then '' else json_build_object('sub', tests.uid(p_user), 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text end, true);
  perform set_config('request.jwt.claim.sub', case when p_user = 'anon' then '' else tests.uid(p_user)::text end, true);
  perform set_config('role', case when p_user = 'anon' then 'anon' else 'authenticated' end, true);
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return v;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p text, k text) returns text language sql as $$ select case when p like 'ERR:%' then p else (p::jsonb) ->> k end $$;

-- A. registering staff (operator only; one owner; no workspace member)
select is(app.operator_register_staff('s_owner@staff.test', 'The Owner', 'owner'), tests.uid('s_owner'), 'A1: the operator registers the owner');
select is(pg_temp.st('s_owner', 'aal2', 'sess-owner-0001', $q$select app.operator_register_staff('s_plain@staff.test', 'Plain Person', 'support')::text$q$), 'ERR:42501', 'A2: nobody registers staff through the API (the function is not callable)');
select throws_ok($$select app.operator_register_staff('s_owner2@staff.test', 'Second Owner', 'owner')$$, '42501', null, 'A3: there is exactly one owner');
select throws_ok($$select app.operator_register_staff('a_owner@test.local', 'Shop Owner', 'support')$$, '42501', null, 'A4: a workspace member cannot be staff');
select throws_ok($$select app.operator_register_staff('nobody@staff.test', 'No One', 'support')$$, '23503', null, 'A5: the account must exist');
select throws_ok($$select app.operator_register_staff('s_support@staff.test', 'Some One', 'admin')$$, '22023', null, 'A6: only owner, support or finance');
select is(app.operator_register_staff('s_support@staff.test', 'Sia Support', 'support'), tests.uid('s_support'), 'A7: support registered');
select is(app.operator_register_staff('s_finance@staff.test', 'Fay Finance', 'finance'), tests.uid('s_finance'), 'A8: finance registered');
select is(app.operator_register_staff('s_gone@staff.test', 'Gone Soon', 'support'), tests.uid('s_gone'), 'A9: another support account');
select lives_ok($$select app.operator_remove_staff('s_gone@staff.test')$$, 'A10: and it is switched off');

-- B. the staff check: who, which factor, which role, which session
select is(pg_temp.j(pg_temp.st('s_support', 'aal2', 'sess-support-01', 'select public.admin_me()::text'), 'role'), 'support', 'B1: staff with a second factor and a session is let in');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-owner1', 'select public.admin_me()::text'), 'ERR:SM941', 'B2: a shop owner is not staff');
select is(pg_temp.st('s_plain', 'aal2', 'sess-plain-0001', 'select public.admin_me()::text'), 'ERR:SM941', 'B3: an account that is not registered is not staff');
select is(pg_temp.st('s_gone', 'aal2', 'sess-gone-00001', 'select public.admin_me()::text'), 'ERR:SM941', 'B4: a switched-off staff account is not staff');
select is(pg_temp.st('anon', null, null, 'select public.admin_me()::text'), 'ERR:42501', 'B5: an anonymous caller cannot even call it');
select is(pg_temp.st('s_support', 'aal1', 'sess-support-01', 'select public.admin_me()::text'), 'ERR:SM942', 'B6: a password alone is not enough: the second factor is ALWAYS needed');
select is(pg_temp.st('s_support', 'absent', 'sess-support-01', 'select public.admin_me()::text'), 'ERR:SM942', 'B7: no assurance level at all is refused too');
select is(pg_temp.st('s_support', 'aal2', null, 'select public.admin_me()::text'), 'ERR:SM943', 'B8: no session id, no session');
select is(pg_temp.j(pg_temp.st('s_support', 'aal2', 'sess-support-01', 'select public.admin_me()::text'), 'session_idle_limit_minutes'), '30', 'B9: the idle limit is 30 minutes');
update admin.sessions set last_seen_at = now() - interval '31 minutes' where session_id = 'sess-support-01';
select is(pg_temp.st('s_support', 'aal2', 'sess-support-01', 'select public.admin_me()::text'), 'ERR:SM943', 'B10: 31 minutes without a call ends the session');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-01', 'select public.admin_me()::text'), 'ERR:SM943', 'B11: and it stays ended (a refresh of the same token does not revive it)');
select is(pg_temp.j(pg_temp.st('s_support', 'aal2', 'sess-support-02', 'select public.admin_me()::text'), 'role'), 'support', 'B12: a fresh sign-in is a new session');
select is(pg_temp.st('s_finance', 'aal2', 'sess-support-02', 'select public.admin_me()::text'), 'ERR:SM943', 'B13: a session id belongs to ONE staff member');
update admin.sessions set last_seen_at = now() - interval '29 minutes' where session_id = 'sess-support-02';
select is(pg_temp.j(pg_temp.st('s_support', 'aal2', 'sess-support-02', 'select public.admin_me()::text'), 'role'), 'support', 'B14: 29 minutes is still inside the limit');
select cmp_ok((select last_seen_at from admin.sessions where session_id = 'sess-support-02'), '>', now() - interval '1 minute', 'B15: and every call renews it');

-- C. the businesses list: all three roles, no reason needed, business facts only
select is(jsonb_array_length(pg_temp.st('s_finance', 'aal2', 'sess-finance-01', 'select (public.admin_businesses_list() -> ''items'')::text')::jsonb), 2, 'C1: finance lists the businesses');
select is((pg_temp.st('s_support', 'aal2', 'sess-support-02', 'select (public.admin_businesses_list(null, 1) -> ''next'' ->> ''after_id'')') is not null), true, 'C2: paging: a next cursor when there are more');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select (public.admin_businesses_list(%L) -> 'items' -> 0 ->> 'tenant_id')$q$, 'tenant a')), tests.tid('a')::text, 'C3: search by name finds the business');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', 'select public.admin_businesses_list(null, 0)::text'), 'ERR:22023', 'C4: a bad page size is refused');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-owner1', 'select public.admin_businesses_list()::text'), 'ERR:SM941', 'C5: a shop owner cannot list other businesses');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', 'select (public.admin_businesses_list() -> ''items'' -> 0 ?& array[''tenant_id'', ''name'', ''plan'', ''balance_paise'', ''status'', ''signup_at'', ''last_activity_at''])::text'), 'true', 'C6: each row has name, plan, balance, status, signup date, last activity');
select is((select count(*) from admin.audit where action = 'list' and tenant_id is null), 4::bigint, 'C7: every successful list call was audit-logged (C1, C2, C3, C6)');

-- D. one business: a reason first, one business, one scope, 15 minutes
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_access_open(%L, 'profile', 'other')::text$q$, tests.tid('a'))), 'ERR:SM946', 'D1: reason "other" needs words');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_access_open(%L, 'profile', 'whim')::text$q$, tests.tid('a'))), 'ERR:22023', 'D2: the reason code is from a closed list');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_access_open(%L, 'calls', 'incident')::text$q$, tests.tid('a'))), 'ERR:22023', 'D3: only the scopes that exist');
select is(pg_temp.st('s_finance', 'aal2', 'sess-finance-01', format($q$select public.admin_access_open(%L, 'profile', 'incident')::text$q$, tests.tid('a'))), 'ERR:42501', 'D4: finance does not open a business profile');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_access_open(%L, 'profile', 'incident')::text$q$, gen_random_uuid())), 'ERR:23503', 'D5: an unknown business');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_business_get(%L, %L)::text$q$, tests.tid('a'), gen_random_uuid())), 'ERR:SM944', 'D6: no access, no data');

create temp table acc as select pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_access_open(%L, 'profile', 'support_ticket', 'Customer wrote in about calls')::text$q$, tests.tid('a')))::jsonb as j;
select is((select j ->> 'scope' from acc), 'profile', 'D7: an access is granted for one scope');
select is((select count(*) from admin.audit where action = 'access' and tenant_id = tests.tid('a') and customer_visible and reason_code = 'support_ticket' and reason_text = 'Customer wrote in about calls'), 1::bigint, 'D8: the access is logged with its reason, visible to the shop owner');
select is(pg_temp.j(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_business_get(%L, %L)::text$q$, tests.tid('a'), (select j ->> 'access_id' from acc))), 'business'), pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select (public.admin_business_get(%L, %L) -> 'business')::text$q$, tests.tid('a'), (select j ->> 'access_id' from acc))), 'D9: the access opens the business');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_business_get(%L, %L)::text$q$, tests.tid('b'), (select j ->> 'access_id' from acc))), 'ERR:SM944', 'D10: the access covers ONE business only');
select is(pg_temp.st('s_owner', 'aal2', 'sess-owner-0001', format($q$select public.admin_business_get(%L, %L)::text$q$, tests.tid('a'), (select j ->> 'access_id' from acc))), 'ERR:SM944', 'D11: and ONE staff member only');
select is(pg_temp.st('s_finance', 'aal2', 'sess-finance-01', format($q$select public.admin_business_get(%L, %L)::text$q$, tests.tid('a'), (select j ->> 'access_id' from acc))), 'ERR:42501', 'D12: finance cannot read a profile at all');
select is((select count(*) from admin.audit where action = 'read' and tenant_id = tests.tid('a')), 2::bigint, 'D13: each read is logged (D9 read twice)');
update admin.access_grants set expires_at = now() - interval '1 second', created_at = now() - interval '16 minutes' where id = (select (j ->> 'access_id')::uuid from acc);
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_business_get(%L, %L)::text$q$, tests.tid('a'), (select j ->> 'access_id' from acc))), 'ERR:SM944', 'D14: after 15 minutes the access is over');

-- E. masking of END-CUSTOMER data
select is(admin.mask_name('Padmaja Naidu'), 'P•••••• N••••', 'E1: a name keeps the first letter of each word');
select is(admin.mask_phone('+91 98765 43210'), '+•• ••••• ••210', 'E2: a number keeps its last three digits');
select is(admin.mask_phone(null), null, 'E3: nothing stays nothing');
select tests.open_gate('a');   -- a real-looking number needs the real-data gate open, as in production
insert into public.contacts (tenant_id, full_name, phone) values (tests.tid('a'), 'Padmaja Naidu', '+91 98765 43210');
insert into public.phone_calls (tenant_id, direction, provider, state, contact_id, created_at, ended_at)
select tests.tid('a'), 'inbound', 'plivo', 'completed', c.id, now(), now() from public.contacts c where c.tenant_id = tests.tid('a') and c.full_name = 'Padmaja Naidu';
create temp table acc2 as select pg_temp.st('s_owner', 'aal2', 'sess-owner-0001', format($q$select public.admin_access_open(%L, 'profile', 'privacy_request')::text$q$, tests.tid('a')))::jsonb as j;
create temp table view_a as select pg_temp.st('s_owner', 'aal2', 'sess-owner-0001', format($q$select public.admin_business_get(%L, %L)::text$q$, tests.tid('a'), (select j ->> 'access_id' from acc2))) as t;
select is((select t from view_a) like '%Padmaja%', false, 'E4: the support view never carries the customer''s name');
select is((select t from view_a) like '%98765%', false, 'E5: nor the customer''s number');
select is(((select t from view_a)::jsonb -> 'recent_calls' -> 0 ->> 'customer'), 'P•••••• N••••', 'E6: only the masked name');

-- F. "Require my OK before support views my account" (default OFF)
select is(pg_temp.j(pg_temp.st('a_owner', 'aal2', 'x', format($q$select public.support_access_get(%L)::text$q$, tests.tid('a'))), 'require_ok'), 'false', 'F1: default OFF');
select is(pg_temp.st('a_admin', 'aal2', 'x', format($q$select public.support_access_set(%L, true)::text$q$, tests.tid('a'))), 'ERR:42501', 'F2: only the shop owner switches it');
select is(pg_temp.st('b_owner', 'aal2', 'x', format($q$select public.support_access_set(%L, true)::text$q$, tests.tid('a'))), 'ERR:42501', 'F3: not another business''s owner');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.support_access_set(%L, true)::text$q$, tests.tid('a'))), 'ERR:42501', 'F4: and staff cannot switch it off for a business');
select is(pg_temp.j(pg_temp.st('a_owner', 'aal2', 'x', format($q$select public.support_access_set(%L, true)::text$q$, tests.tid('a'))), 'require_ok'), 'true', 'F5: the shop owner turns it on');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_access_open(%L, 'profile', 'incident')::text$q$, tests.tid('a'))), 'ERR:SM945', 'F6: now support must wait for the shop owner''s OK');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select (public.admin_access_open(%L, 'profile', 'incident') ->> 'scope')$q$, tests.tid('b'))), 'profile', 'F7: other businesses are not affected');
select is(pg_temp.j(pg_temp.st('a_owner', 'aal2', 'x', format($q$select public.support_access_approve(%L)::text$q$, tests.tid('a'))), 'require_ok'), 'true', 'F8: the shop owner approves one visit');
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select (public.admin_access_open(%L, 'profile', 'incident') ->> 'scope')$q$, tests.tid('a'))), 'profile', 'F9: and support can open the business');
update admin.access_approvals set expires_at = now() - interval '1 second', approved_at = now() - interval '31 minutes';
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', format($q$select public.admin_access_open(%L, 'profile', 'incident')::text$q$, tests.tid('a'))), 'ERR:SM945', 'F10: the OK runs out after 30 minutes');
select is(pg_temp.j(pg_temp.st('a_owner', 'aal2', 'x', format($q$select public.support_access_set(%L, false)::text$q$, tests.tid('a'))), 'require_ok'), 'false', 'F11: the shop owner can turn it off again');

-- G. the shop owner sees every support view in their own activity log
select is((select count(*) from jsonb_array_elements(pg_temp.st('a_owner', 'aal2', 'x', format($q$select (public.activity_log(%L, 50, null, null, 'support') -> 'items')::text$q$, tests.tid('a')))::jsonb) x where x ->> 'summary' = 'Stack19 support viewed your account'), 3::bigint, 'G1: three accesses, three entries in the shop owner''s activity log');
select is((select array_agg(x ->> 'reason' order by x ->> 'reason' collate "C") from jsonb_array_elements(pg_temp.st('a_owner', 'aal2', 'x', format($q$select (public.activity_log(%L, 50, null, null, 'support') -> 'items')::text$q$, tests.tid('a')))::jsonb) x), array['Customer wrote in about calls', 'a privacy request', 'a technical problem'], 'G2: each with its reason in words (the words typed, or the reason in plain words)');
select is((select count(*) from jsonb_array_elements(pg_temp.st('a_owner', 'aal2', 'x', format($q$select (public.activity_log(%L, 50) -> 'items')::text$q$, tests.tid('a')))::jsonb) x where x ->> 'kind' = 'support'), 3::bigint, 'G3: and in the full timeline');
select is((select count(*) from jsonb_array_elements(pg_temp.st('b_owner', 'aal2', 'x', format($q$select (public.activity_log(%L, 50, null, null, 'support') -> 'items')::text$q$, tests.tid('b')))::jsonb) x), 1::bigint, 'G4: business B sees only its own access');
select is(pg_temp.st('a_owner', 'aal2', 'x', format($q$select (public.activity_log(%L, 50, null, null, 'support') -> 'items' -> 0)::text$q$, tests.tid('a'))) like '%Support%' or pg_temp.st('a_owner', 'aal2', 'x', format($q$select (public.activity_log(%L, 50, null, null, 'support') -> 'items' -> 0)::text$q$, tests.tid('a'))) like '%s_support%', false, 'G5: the entry never names the staff member');

-- H. the audit trail: owner only, append-only
select is(pg_temp.st('s_support', 'aal2', 'sess-support-02', 'select public.admin_audit_list()::text'), 'ERR:42501', 'H1: support cannot read the audit trail');
select is(pg_temp.st('s_finance', 'aal2', 'sess-finance-01', 'select public.admin_audit_list()::text'), 'ERR:42501', 'H2: nor finance');
select cmp_ok(jsonb_array_length(pg_temp.st('s_owner', 'aal2', 'sess-owner-0001', 'select (public.admin_audit_list(null, null, 100) -> ''items'')::text')::jsonb), '>=', 8, 'H3: the owner reads it');
select is(pg_temp.st('s_owner', 'aal2', 'sess-owner-0001', format($q$select jsonb_array_length(public.admin_audit_list(%L) -> 'items')::text$q$, tests.tid('b'))), '1', 'H4: filtered by business');
select throws_ok($$update admin.audit set reason_text = 'changed'$$, '42501', null, 'H5: no update, not even by the operator');
select throws_ok($$delete from admin.audit$$, '42501', null, 'H6: no delete');
select throws_ok($$truncate admin.audit$$, '42501', null, 'H7: no truncate');

-- I. privileges
select is((select count(*) from information_schema.table_privileges where table_schema = 'admin' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'I1: no client role touches an admin table');
select is(has_schema_privilege('authenticated', 'admin', 'usage'), false, 'I2: nor the schema');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'admin\_%' or p.proname like 'support\_access\_%') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'I3: anon can execute no admin function');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'admin\_%' or p.proname like 'support\_access\_%') and p.prosecdef and p.proconfig @> array['search_path=""']), 12::bigint, 'I4: all twelve are security definer with a fixed, empty search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'admin'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint, 'I5: no function of the admin schema is callable by a client');

select * from finish();
rollback;
