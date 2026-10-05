-- T006b M2 (ADR 0014 decision on open question 2; ADR 0015): (1) the last Owner cannot erase their own contact record; (2) the operator adds a
-- family member by e-mail at a limited role (no open sign-up), and, as a recorded exception, a second Owner.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.with_jwt(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('b_owner'), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', tests.uid('b_owner')::text, true);
  return pg_temp.try(p_sql);
end $$;

-- ============================================================ 1. the sole Owner
-- tenant b has ONE Owner (b_owner); tenant a has three. The Owner's own address is the identity: a contact with that address is the Owner.
update auth.users set email = 'b_owner@owner.example.test' where id = tests.uid('b_owner');
update auth.users set email = 'a_owner@owner.example.test' where id = tests.uid('a_owner');
insert into public.contacts (id, tenant_id, company_id, full_name, email) values
  (tests.rid('b_self'),  tests.tid('b'), tests.rid('b_company'), 'DEMO Owner Self',  'B_Owner@Owner.Example.test'),
  (tests.rid('b_other'), tests.tid('b'), tests.rid('b_company'), 'DEMO Other',       'someone.else@example.test'),
  (tests.rid('a_self'),  tests.tid('a'), tests.rid('a_company'), 'DEMO A Owner',     'a_owner@owner.example.test');
create function pg_temp.req(p_user text, p_tenant text, p_id text, p_subject text) returns void language plpgsql as $$
begin perform tests.scalar_as(tests.uid(p_user), format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_subject))); end $$;
select pg_temp.req('b_owner', 'b', 'so1', 'b_self');
select is(tests.error_full_as(tests.uid('b_owner'), format('select public.execute_erasure(%L, false)', tests.rid('so1'))),
          'SM305|ownership must be transferred before this contact can be erased||||', 'the sole Owner cannot erase their own contact record (address compared in any case)');
select is(tests.error_full_as(tests.uid('b_owner'), format('select public.execute_erasure(%L, true)', tests.rid('so1'))),
          'SM305|ownership must be transferred before this contact can be erased||||', '...not even as a preview');
select is((select full_name || '/' || email from public.contacts where id = tests.rid('b_self')), 'DEMO Owner Self/B_Owner@Owner.Example.test', 'and nothing was changed');
select is((select status::text from public.erasure_requests where id = tests.rid('so1')), 'pending', 'the request is still pending');
select pg_temp.req('b_owner', 'b', 'so2', 'b_other');
select is(tests.error_full_as(tests.uid('b_owner'), format('select public.execute_erasure(%L, false)', tests.rid('so2'))), 'ok', 'another contact of the same workspace is erased as usual');
select pg_temp.req('a_owner', 'a', 'so3', 'a_self');
select is(tests.error_full_as(tests.uid('a_owner'), format('select public.execute_erasure(%L, false)', tests.rid('so3'))), 'ok', 'where there are other Owners an Owner can be erased (ownership is not at stake)');

-- ============================================================ 2. the operator adds a member
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('operator_add_member', 'operator_add_owner_exception')), 2::bigint, 'both operator functions exist in the private schema');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('operator_add_member', 'operator_add_owner_exception')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'no client role can execute them');
select is(tests.outcome_as(tests.uid('a_owner'), $q$select app.operator_add_member('tenant-a', 'outsider@test.local', 'viewer', 'family member')$q$), '42501', 'an Owner cannot call it');
select is(pg_temp.with_jwt($q$select app.operator_add_member('tenant-b', 'outsider@test.local', 'viewer', 'family member')$q$), '42501', 'the owner role with a request identity is refused');
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select is((select count(*) from public.memberships where user_id = tests.uid('outsider')), 0::bigint, '...and nothing was added');

select is(pg_temp.try($q$select app.operator_add_member('no-such-workspace', 'outsider@test.local', 'viewer', 'family member')$q$), '23503', 'an unknown workspace is refused');
select is(pg_temp.try($q$select app.operator_add_member('tenant-b', 'nobody@test.local', 'viewer', 'family member')$q$), '23503', 'an e-mail with no account is refused: there is no open sign-up, the person must be invited first');
select is(pg_temp.try($q$select app.operator_add_member('tenant-b', 'outsider@test.local', 'owner', 'family member')$q$), '22023', 'the plain function never makes an Owner');
select is(pg_temp.try($q$select app.operator_add_member('tenant-b', 'outsider@test.local', 'superuser', 'family member')$q$), '22023', 'an unknown role is refused');
select is(pg_temp.try($q$select app.operator_add_member('tenant-b', 'outsider@test.local', 'viewer', '')$q$), '22023', 'a reason is required');
select is(pg_temp.try($q$select app.operator_add_member('tenant-b', 'outsider@test.local', 'viewer', null)$q$), '22023', '...not null either');
select is(pg_temp.try(format($q$select app.operator_add_member('tenant-b', 'outsider@test.local', 'viewer', %L)$q$, repeat('x', 201))), '22023', '...and not longer than 200 characters');
select is(pg_temp.try(format($q$select app.operator_add_member('tenant-b', 'outsider@test.local', 'viewer', %L)$q$, 'bad' || chr(8203) || 'reason')), '22023', '...and clean text');
select is((select count(*) from public.memberships where user_id = tests.uid('outsider')), 0::bigint, 'after every refusal the person is still not a member');

select is(pg_temp.try($q$select app.operator_add_member('tenant-b', 'OUTSIDER@Test.Local', 'sales', 'Aunt, wholesale desk')$q$), 'ok', 'a member is added by e-mail, in any case');
select is((select role::text from public.memberships where tenant_id = tests.tid('b') and user_id = tests.uid('outsider')), 'sales', 'at the limited role');
select is(tests.scalar_as(tests.uid('outsider'), 'select count(*) from public.tenants')::bigint, 1::bigint, 'and she can see exactly that workspace');
select is(tests.scalar_as(tests.uid('outsider'), format('select count(*) from public.contacts where tenant_id = %L', tests.tid('a')))::bigint, 0::bigint, '...and nothing of another');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('b') and action = 'membership.operator_added' and metadata ->> 'reason' = 'Aunt, wholesale desk' and actor_type = 'system'), 1::bigint, 'the addition is audited with the reason, as the system');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('b') and entity_type = 'membership' and action = 'membership.create' and entity_id = (select id from public.memberships where tenant_id = tests.tid('b') and user_id = tests.uid('outsider'))), 1::bigint, '...and by the membership trigger');
select is(pg_temp.try($q$select app.operator_add_member('tenant-b', 'outsider@test.local', 'viewer', 'again')$q$), '23505', 'adding the same person again is refused (no silent role change)');
select is((select role::text from public.memberships where tenant_id = tests.tid('b') and user_id = tests.uid('outsider')), 'sales', '...and the role is unchanged');

-- ============================================================ 3. the recorded exception: a second Owner
select is(pg_temp.try($q$select app.operator_add_owner_exception('tenant-b', 'x1@test.local', 'transfer')$q$), '22023', 'a second Owner needs a real reason (20+ characters)');
select is(pg_temp.try($q$select app.operator_add_owner_exception('tenant-b', 'x1@test.local', null)$q$), '22023', '...not null');
select is(pg_temp.with_jwt($q$select app.operator_add_owner_exception('tenant-b', 'x1@test.local', 'identity verified by video call with the Owner 2026-10-05')$q$), '42501', 'the owner role with a request identity is refused');
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select is(pg_temp.try($q$select app.operator_add_owner_exception('tenant-b', 'x1@test.local', 'identity verified by video call with the Owner 2026-10-05')$q$), 'ok', 'with a recorded reason the operator adds an Owner');
select is((select role::text from public.memberships where tenant_id = tests.tid('b') and user_id = tests.uid('x1')), 'owner', '...who is an Owner');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('b') and action = 'membership.operator_added_owner' and metadata ->> 'reason' like 'identity verified%'), 1::bigint, 'and the exception is audited with its reason');
select pg_temp.req('b_owner', 'b', 'so4', 'b_self');
select is(tests.error_full_as(tests.uid('b_owner'), format('select public.execute_erasure(%L, false)', tests.rid('so4'))), 'ok', 'with a second Owner in place the first Owner''s record can be erased');
select is((select full_name from public.contacts where id = tests.rid('b_self')), 'erased:1', '...and is');

select * from finish();
rollback;
