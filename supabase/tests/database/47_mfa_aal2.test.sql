-- T006b M3a (ADR 0016): Owners and Admins need a second factor (the token's aal claim = aal2) for the privileged actions. In the DATABASE:
-- the erasure functions, the agents switch, and any client-role write to memberships or tenants. The check comes AFTER the caller's role
-- is proven (a stranger still gets the generic refusal and learns nothing about the session's level). Sales is unaffected.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$
  select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal(p_aal);
  return tests.error_full_as(tests.uid(p_user), p_sql);
end $$;
create function pg_temp.out_at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal(p_aal);
  return tests.outcome_as(tests.uid(p_user), p_sql);
end $$;
create function pg_temp.req_sql(p_id text, p_tenant text, p_scope text, p_subject text default null) returns text language sql as $$
  select format('select public.request_erasure(%L, %L, %L, %L)', tests.rid(p_id), tests.tid(p_tenant), p_scope, case when p_subject is null then null else tests.rid(p_subject) end) $$;
select tests.open_gate('a');

-- ============================================================ the helper
select is((select count(*) from pg_proc where pronamespace = 'app'::regnamespace and proname in ('require_aal2', 'guard_aal2_client_write')), 2::bigint, 'the aal helper and the client-write trigger exist');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'require_aal2' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint, 'no client role can execute the helper');

-- ============================================================ erasure: request
select is(pg_temp.at('aal1', 'a_owner', pg_temp.req_sql('m1', 'a', 'contact', 'a_contact')), 'SM306|a second factor is required for this action||||', 'request_erasure: a password-only Owner is refused');
select is(pg_temp.at('aal1', 'a_admin', pg_temp.req_sql('m1', 'a', 'contact', 'a_contact')), 'SM306|a second factor is required for this action||||', '...and a password-only Admin');
select is(pg_temp.at('absent', 'a_owner', pg_temp.req_sql('m1', 'a', 'contact', 'a_contact')), 'SM306|a second factor is required for this action||||', '...and a token with NO aal claim at all (fail closed)');
select is(pg_temp.at('aal1', 'a_sales', pg_temp.req_sql('m1', 'a', 'contact', 'a_contact')), '42501|erasure action not permitted||||', 'Sales at aal1: the GENERIC refusal (the role is proven first, the level is not an oracle)');
select is(pg_temp.at('aal1', 'b_owner', pg_temp.req_sql('m1', 'a', 'contact', 'a_contact')), '42501|erasure action not permitted||||', 'another tenant''s Owner at aal1: the generic refusal');
select is(pg_temp.at('aal1', 'outsider', pg_temp.req_sql('m1', 'a', 'contact', 'a_contact')), '42501|erasure action not permitted||||', 'an outsider at aal1: the generic refusal');
select is((select count(*) from public.erasure_requests where tenant_id = tests.tid('a')), 0::bigint, 'none of the refusals recorded a request');
select is(pg_temp.at('aal2', 'a_owner', pg_temp.req_sql('m1', 'a', 'contact', 'a_contact')), 'ok', 'at aal2 the Owner may request');
select is(pg_temp.at('aal2', 'a_admin', pg_temp.req_sql('m2', 'a', 'company', 'a_company')), 'ok', 'at aal2 the Admin may request');
select is(pg_temp.at('aal1', 'a_owner', pg_temp.req_sql('m1', 'a', 'contact', 'a_contact')), 'SM306|a second factor is required for this action||||', 'a replay of an existing request is refused at aal1 too (the check comes before idempotency)');

-- ============================================================ erasure: execute (preview and real) and cancel
create temp table before_a as select tests.er_digest('a') as d;
select is(pg_temp.at('aal1', 'a_owner', format('select public.execute_erasure(%L, false)', tests.rid('m1'))), 'SM306|a second factor is required for this action||||', 'execute_erasure: a password-only Owner is refused');
select is(pg_temp.at('aal1', 'a_owner', format('select public.execute_erasure(%L, true)', tests.rid('m1'))), 'SM306|a second factor is required for this action||||', '...also the preview');
select is(pg_temp.at('absent', 'a_owner', format('select public.execute_erasure(%L, false)', tests.rid('m1'))), 'SM306|a second factor is required for this action||||', '...and a token with no aal claim');
select is(pg_temp.at('aal1', 'a_admin', format('select public.execute_erasure(%L, false)', tests.rid('m1'))), '42501|erasure action not permitted||||', 'an Admin is not the Owner: generic refusal whatever the level');
select is(pg_temp.at('aal1', 'a_sales', format('select public.execute_erasure(%L, false)', tests.rid('m1'))), '42501|erasure action not permitted||||', 'Sales: generic');
select is(pg_temp.at('aal1', 'b_owner', format('select public.execute_erasure(%L, false)', tests.rid('m1'))), '42501|erasure action not permitted||||', 'a foreign Owner: generic');
select is(tests.er_digest('a'), (select d from before_a), 'nothing changed');
select is((select status::text from public.erasure_requests where id = tests.rid('m1')), 'pending', 'the request is still pending');
select is(pg_temp.at('aal1', 'a_owner', format('select public.cancel_erasure(%L)', tests.rid('m2'))), 'SM306|a second factor is required for this action||||', 'cancel_erasure: a password-only Owner is refused');
select is(pg_temp.at('aal1', 'a_admin', format('select public.cancel_erasure(%L)', tests.rid('m2'))), 'SM306|a second factor is required for this action||||', '...and a password-only Admin');
select is(pg_temp.at('aal1', 'a_sales', format('select public.cancel_erasure(%L)', tests.rid('m2'))), '42501|erasure action not permitted||||', 'Sales: generic');
select is((select status::text from public.erasure_requests where id = tests.rid('m2')), 'pending', 'still pending');
select is(pg_temp.at('aal2', 'a_admin', format('select public.cancel_erasure(%L)', tests.rid('m2'))), 'ok', 'at aal2 the Admin may cancel');
-- T010 (ADR 0020): the contact needs a recorded suppression key (a well-formed fake: the database cannot verify an HMAC)
select is(pg_temp.at('aal2', 'a_owner', format($q$select public.record_contact_keys(%L, jsonb_build_object('version', 1, 'email', %L, 'phone', %L))$q$, tests.rid('a_contact'), md5('a_contact') || md5('a_contact' || 'x'), md5('a_phone') || md5('a_phone' || 'x'))), 'ok', 'setup: the contact has recorded suppression keys');
select is(pg_temp.at('aal2', 'a_owner', format('select public.execute_erasure(%L, true)', tests.rid('m1'))), 'ok', 'at aal2 the Owner may preview');
select is(pg_temp.at('aal2', 'a_owner', format('select public.execute_erasure(%L, false)', tests.rid('m1'))), 'ok', '...and execute');
select is(pg_temp.at('aal1', 'a_owner', format('select public.execute_erasure(%L, false)', tests.rid('m1'))), 'SM306|a second factor is required for this action||||', 'a replay of an executed request is refused at aal1 (the stored result is not handed to a password-only session)');

-- ============================================================ the agents switch
select is(pg_temp.at('aal1', 'a_owner', format('select public.set_tenant_agents_enabled(%L, true)', tests.tid('a'))), 'SM306|a second factor is required for this action||||', 'set_tenant_agents_enabled: a password-only Owner is refused');
select is(pg_temp.at('aal1', 'a_admin', format('select public.set_tenant_agents_enabled(%L, true)', tests.tid('a'))), 'SM306|a second factor is required for this action||||', '...and Admin');
select is(pg_temp.at('absent', 'a_owner', format('select public.set_tenant_agents_enabled(%L, true)', tests.tid('a'))), 'SM306|a second factor is required for this action||||', '...and a token with no aal claim');
select is(pg_temp.at('aal1', 'a_sales', format('select public.set_tenant_agents_enabled(%L, true)', tests.tid('a'))), '42501|agent action not permitted||||', 'Sales: the generic agent refusal');
select is(pg_temp.at('aal1', 'b_owner', format('select public.set_tenant_agents_enabled(%L, true)', tests.tid('a'))), '42501|agent action not permitted||||', 'a foreign Owner: generic');
select is((select count(*) from public.tenant_agent_settings where tenant_id = tests.tid('a') and enabled), 0::bigint, 'the switch did not move');
select is(pg_temp.at('aal2', 'a_owner', format('select public.set_tenant_agents_enabled(%L, true)', tests.tid('a'))), 'ok', 'at aal2 the Owner may switch');

-- ============================================================ memberships and tenant settings written straight through the API role
select is(pg_temp.out_at('aal1', 'a_owner', format($q$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$q$, tests.tid('a'), tests.uid('a_sales'))), 'SM306', 'a password-only Owner cannot change a role');
select is(pg_temp.out_at('aal1', 'a_admin', format($q$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$q$, tests.tid('a'), tests.uid('outsider'))), 'SM306', '...nor add a member');
select is(pg_temp.out_at('aal1', 'a_admin', format($q$delete from public.memberships where tenant_id = %L and user_id = %L$q$, tests.tid('a'), tests.uid('a_viewer'))), 'SM306', '...nor remove one');
select is(pg_temp.out_at('absent', 'a_owner', format($q$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$q$, tests.tid('a'), tests.uid('a_sales'))), 'SM306', '...and a token with no aal claim is refused too');
select is((select role::text from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('a_sales')), 'sales', 'no role moved');
select is((select count(*) from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('outsider')), 0::bigint, 'no member was added');
select is(pg_temp.out_at('aal1', 'a_sales', format($q$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$q$, tests.tid('a'), tests.uid('a_sales'))), 'rows:0', 'Sales at aal1: the role policy filters the row out first (no row, no error: nothing to learn)');
select is(pg_temp.out_at('aal1', 'a_owner', format($q$update public.tenants set name = 'Renamed' where id = %L$q$, tests.tid('a'))), 'SM306', 'a password-only Owner cannot rename the workspace');
select is((select name from public.tenants where id = tests.tid('a')), 'Tenant A', 'the name did not change');
select is(pg_temp.out_at('aal2', 'a_owner', format($q$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$q$, tests.tid('a'), tests.uid('a_sales'))), 'rows:1', 'at aal2 the Owner can change a role');
select is(pg_temp.out_at('aal2', 'a_admin', format($q$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'viewer')$q$, tests.tid('a'), tests.uid('outsider'))), 'rows:1', '...and an Admin add a member');
select is(pg_temp.out_at('aal2', 'a_owner', format($q$update public.tenants set name = 'Renamed' where id = %L$q$, tests.tid('a'))), 'rows:1', '...and rename the workspace');

-- the trusted paths are not caught: creating a workspace (a definer function) works for a brand-new, password-only user
select is(pg_temp.at('aal1', 'x1', $q$select id from public.create_tenant('Fresh Workspace', 'fresh-workspace')$q$), 'ok', 'create_tenant works at aal1 (a new user has no factor yet; the function runs as the trusted role)');
select is((select role::text from public.memberships m join public.tenants t on t.id = m.tenant_id where t.slug = 'fresh-workspace' and m.user_id = tests.uid('x1')), 'owner', '...and made them the Owner');

-- ============================================================ Sales is unaffected
select is(pg_temp.out_at('aal1', 'a_sales', format($q$insert into public.contacts (id, tenant_id, company_id, full_name) values (%L, %L, %L, 'DEMO Sales Made')$q$, tests.rid('m_sales_c'), tests.tid('a'), tests.rid('a_company'))), 'rows:1', 'Sales at aal1 creates a contact');
select is(pg_temp.out_at('aal1', 'a_sales', format($q$update public.contacts set job_title = 'Buyer' where id = %L$q$, tests.rid('m_sales_c'))), 'rows:1', '...and edits it');
select is(pg_temp.out_at('aal1', 'a_owner', format($q$update public.contacts set job_title = 'Buyer' where id = %L$q$, tests.rid('m_sales_c'))), 'rows:1', 'an Owner at aal1 can still do the ordinary work');

-- ============================================================ the operator resets a lost device
select tests.as_aal('aal2');
update auth.users set email = 'lost.device@owner.example.test' where id = tests.uid('a_owner2');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), tests.uid('a_owner2'), 'phone', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'),
       (gen_random_uuid(), tests.uid('a_admin'), 'phone', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (gen_random_uuid(), tests.uid('a_owner2'), now(), now(), 'aal2'), (gen_random_uuid(), tests.uid('a_admin'), now(), now(), 'aal2');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'operator_reset_mfa'
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'no client role can execute operator_reset_mfa');
select is(tests.outcome_as(tests.uid('a_owner'), $q$select app.operator_reset_mfa('lost.device@owner.example.test', 'device lost, identity verified by video call')$q$), '42501', 'an Owner cannot call it');
create function pg_temp.try(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.with_jwt(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('a_owner'), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', tests.uid('a_owner')::text, true);
  return pg_temp.try(p_sql);
end $$;
select is(pg_temp.with_jwt($q$select app.operator_reset_mfa('lost.device@owner.example.test', 'device lost, identity verified by video call')$q$), '42501', 'the owner role with a request identity is refused');
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select is(pg_temp.try($q$select app.operator_reset_mfa('nobody@owner.example.test', 'device lost, identity verified by video call')$q$), '23503', 'an unknown account is refused');
select is(pg_temp.try($q$select app.operator_reset_mfa('lost.device@owner.example.test', 'lost')$q$), '22023', 'a reason of at least 20 characters is required');
select is(pg_temp.try($q$select app.operator_reset_mfa('lost.device@owner.example.test', null)$q$), '22023', '...not null');
select is((select count(*) from auth.mfa_factors where user_id = tests.uid('a_owner2')), 1::bigint, 'after the refusals the factor is still there');
select is(pg_temp.try($q$select app.operator_reset_mfa('LOST.Device@Owner.Example.test', 'device lost, identity verified by video call 2026-10-05')$q$), 'ok', 'with a recorded reason the operator resets (any case)');
select is((select count(*) from auth.mfa_factors where user_id = tests.uid('a_owner2')), 0::bigint, 'the person''s factors are gone');
select is((select count(*) from auth.sessions where user_id = tests.uid('a_owner2')), 0::bigint, '...and so are their sessions (a lost device may be in someone else''s hands)');
select is((select count(*) from auth.mfa_factors where user_id = tests.uid('a_admin')), 1::bigint, 'another person''s factor is untouched');
select is((select count(*) from auth.sessions where user_id = tests.uid('a_admin')), 1::bigint, '...and their session');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'mfa.operator_reset' and metadata ->> 'reason' like 'device lost%' and actor_type = 'system'), 1::bigint, 'the reset is audited in each workspace the person belongs to, with the reason, as the system');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('b') and action = 'mfa.operator_reset'), 0::bigint, '...and not in an unrelated one');

select * from finish();
rollback;
