-- T006b M2 (ADR 0015): THE REAL-DATA GATE. Default closed per workspace. While closed, a contact's e-mail must be on a reserved domain and
-- its phone must start "+00", on EVERY write path (a trigger on contacts: the API, PostgREST, the import function, the privileged session).
-- Only the operator opens or closes it, with four recorded prerequisites; both ways are audited and reversible.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.mk(p_tenant text, p_id text, p_email text, p_phone text) returns text language sql as $$
  select format('insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (%L, %L, %L, %L, %L, %L)',
                tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'DEMO ' || p_id, p_email, p_phone) $$;
create function pg_temp.open_a() returns void language sql as $$ select tests.open_gate('a') $$;

-- ---- the table
select ok(to_regclass('public.tenant_data_policy') is not null, 'tenant_data_policy exists');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.tenant_data_policy'::regclass), true, 'RLS enabled and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'tenant_data_policy' and grantee in ('anon', 'public')), 0::bigint, 'anon and PUBLIC hold nothing');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'tenant_data_policy' and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'clients can only SELECT');
select is(app.real_data_gate_open(tests.tid('a')), false, 'a workspace with no policy row is CLOSED');
select is((select count(*) from public.tenant_data_policy where tenant_id = tests.tid('a')), 0::bigint, '...and the gate does not need a row to be closed');

-- ---- closed: every path refuses a real address or number (SM401), and accepts reserved ones
select is(pg_temp.try(pg_temp.mk('a', 'g1', 'real@gmail.com', null)), 'SM401', 'closed: a real e-mail is refused (privileged insert)');
select is(pg_temp.try(pg_temp.mk('a', 'g2', 'x@example.test', '+91 98765 43210')), 'SM401', 'closed: a real phone is refused');
select is(pg_temp.try(pg_temp.mk('a', 'g3', null, '+91 98765 43210')), 'SM401', 'closed: a real phone with no e-mail is refused');
select is(pg_temp.try(pg_temp.mk('a', 'g4', 'x@example.com.evil.in', null)), 'SM401', 'closed: a look-alike domain is refused');
select is(pg_temp.try(pg_temp.mk('a', 'g5', 'a@b@example.test', null)), '23514', 'closed: two @ signs are malformed: the table''s own CHECK refuses it (the trigger leaves it to them)');
select is(pg_temp.try(pg_temp.mk('a', 'g5b', 'a@gmail.com' || chr(8203), null)), '23514', 'closed: an invisible character is the hygiene CHECK''s to refuse');
select is(pg_temp.try(pg_temp.mk('a', 'g4b', 'x@notexample.com', null)), 'SM401', 'closed: a domain merely ending in "example.com" is refused');
select is(pg_temp.try(pg_temp.mk('a', 'g4c', 'x@fastest.in', null)), 'SM401', 'closed: a domain merely containing "test" is refused');
select is(pg_temp.try(pg_temp.mk('a', 'g4d', 'x@mytest.com', null)), 'SM401', 'closed: mytest.com is refused');
select is(pg_temp.try(pg_temp.mk('a', 'g6', 'x@example.test', '+00 1234 567')), 'ok', 'closed: a reserved domain and a +00 phone are accepted');
select is(pg_temp.try(pg_temp.mk('a', 'g7', null, null)), 'ok', 'closed: a contact with neither is accepted (nothing to check)');
select is(pg_temp.try(pg_temp.mk('a', 'g8', 'Mixed.Case@Sub.EXAMPLE.org', null)), 'ok', 'closed: the domain is compared in lower case, subdomains of reserved domains are reserved');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.mk('a', 'g9', 'real@gmail.com', null)), 'SM401', 'closed: an Owner through the API role is refused too');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.mk('a', 'g10', 'x@example.test', '+91 98765 43210')), 'SM401', 'closed: Sales is refused a real phone');
select is(tests.error_full_as(tests.uid('a_owner'), pg_temp.mk('a', 'g11', 'real@gmail.com', null)), 'SM401|real data is not accepted in this workspace yet||||', 'the message is fixed and carries no value');

-- updates: only a change of e-mail or phone is checked (an archive, a rename or an erasure must still work on any row)
update public.contacts set email = null where id = tests.rid('a_contact');
select is(pg_temp.try(format($q$update public.contacts set email = 'real@gmail.com' where id = %L$q$, tests.rid('a_contact'))), 'SM401', 'closed: changing an e-mail to a real one is refused');
select is(pg_temp.try(format($q$update public.contacts set phone = '+91 98765 43210' where id = %L$q$, tests.rid('a_contact'))), 'SM401', 'closed: changing a phone to a real one is refused');
select is(pg_temp.try(format($q$update public.contacts set job_title = 'Buyer' where id = %L$q$, tests.rid('a_contact'))), 'ok', 'closed: an unrelated update is fine');

-- the import function agrees (its own constant check stays as the first line; the trigger is the backstop)
create function pg_temp.imp(p_tenant text, p_rows jsonb) returns jsonb language sql as $$
  select tests.scalar_as(tests.uid(p_tenant || '_owner'), format('select public.import_lead_rows(%L, %L, %L::jsonb, %L, false)', tests.tid(p_tenant), gen_random_uuid(), p_rows::text, null))::jsonb $$;
select is(pg_temp.imp('a', '[{"company_name":"DEMO Imp Co","contact_name":"DEMO P","contact_email":"p@gmail.com"}]') -> 'rows' -> 0 ->> 'reason', 'contact_domain_not_reserved', 'closed: the import rejects a real e-mail with a code');

-- ---- the operator functions
select is((select count(*) from pg_proc where pronamespace = 'app'::regnamespace and proname in ('operator_open_real_data_gate', 'operator_close_real_data_gate', 'real_data_gate_open', 'guard_real_data')), 4::bigint, 'the four gate functions exist in the private schema');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('operator_open_real_data_gate', 'operator_close_real_data_gate')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'no client role can execute the operator functions');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select app.operator_open_real_data_gate(%L, 'adr:0014', 'doc:h', 'doc:d', 'doc:r')$q$, 'x')), '42501', 'an Owner cannot call the open function');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select app.operator_close_real_data_gate(%L)$q$, 'x')), '42501', 'an Owner cannot call the close function');
-- even the database owner is refused while a request identity is present (the function is for the operator's SQL session, never a request)
create function pg_temp.with_jwt(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid('a_owner'), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', tests.uid('a_owner')::text, true);
  return pg_temp.try(p_sql);
end $$;
select is(pg_temp.with_jwt(format($q$select app.operator_open_real_data_gate(%L, 'adr:0014', 'doc:h', 'doc:d', 'doc:r')$q$, (select slug from public.tenants where id = tests.tid('a')))), '42501', 'the owner role with a request identity is refused');
select is(pg_temp.with_jwt(format($q$select app.operator_close_real_data_gate(%L)$q$, (select slug from public.tenants where id = tests.tid('a')))), '42501', 'the owner role with a request identity cannot call the close function either');
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select is(app.real_data_gate_open(tests.tid('a')), false, 'and nothing opened');

-- prerequisites: all four, typed
create function pg_temp.open(p_slug text, p1 text, p2 text, p3 text, p4 text) returns text language plpgsql as $$
begin
  return pg_temp.try(format('select app.operator_open_real_data_gate(%L, %L, %L, %L, %L)', p_slug, p1, p2, p3, p4));
end $$;
select is(pg_temp.open((select slug from public.tenants where id = tests.tid('a')), null, 'doc:h', 'doc:d', 'doc:r'), '22023', 'a missing erasure reference is refused');
select is(pg_temp.open((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', null, 'doc:d', 'doc:r'), '22023', 'a missing hosting reference is refused');
select is(pg_temp.open((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', 'doc:h', null, 'doc:r'), '22023', 'a missing DPDP review reference is refused');
select is(pg_temp.open((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', 'doc:h', 'doc:d', null), '22023', 'a missing restore-drill reference is refused');
select is(pg_temp.open((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', 'doc:h', 'doc:d', ''), '22023', 'an empty reference is refused');
select is(pg_temp.open((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', 'doc:h', 'doc:d', 'not a typed reference'), '22023', 'a reference that is not typed (kind:token) is refused');
select is(pg_temp.open((select slug from public.tenants where id = tests.tid('a')), 'yes', 'yes', 'yes', 'yes'), '22023', '"yes" is not a reference');
select is(pg_temp.open('no-such-workspace', 'adr:0014', 'doc:h', 'doc:d', 'doc:r'), '23503', 'an unknown workspace is refused');
select is(app.real_data_gate_open(tests.tid('a')), false, 'after every refusal the gate is still closed');
select is((select count(*) from public.tenant_data_policy where tenant_id = tests.tid('a')), 0::bigint, '...and no policy row was written');
-- the erasure workflow must exist: the first prerequisite is checked, not only recorded
create function pg_temp.open_without_erasure() returns text language plpgsql as $$
declare r text;
begin
  begin
    drop function public.execute_erasure(uuid, boolean);
    r := pg_temp.open((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', 'doc:h', 'doc:d', 'doc:r');
    raise exception 'unwind' using errcode = 'SM999';
  exception when sqlstate 'SM999' then null;
  end;
  return r;
end $$;
select is(pg_temp.open_without_erasure(), 'SM402', 'the gate cannot open where the erasure function is not installed');
select is(to_regprocedure('public.execute_erasure(uuid, boolean)') is not null, true, '(sanity: the function is back after the unwind)');

-- ---- open tenant a
create temp table before_b as select count(*) as n from public.contacts where tenant_id = tests.tid('b');
select pg_temp.open_a();
select is(app.real_data_gate_open(tests.tid('a')), true, 'tenant a is open');
select is(app.real_data_gate_open(tests.tid('b')), false, 'tenant b is still closed (independent)');
select results_eq(format($$select real_data_allowed, erasure_ref, hosting_ref, dpdp_review_ref, restore_drill_ref, opened_at is not null, closed_at is null from public.tenant_data_policy where tenant_id = %L$$, tests.tid('a')),
  $$values (true, 'adr:0014'::text, 'doc:hosting-staging'::text, 'doc:dpdp-review'::text, 'doc:restore-drill'::text, true, true)$$, 'the four references are recorded');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'tenant_data_policy' and new_values @> '{"real_data_allowed": true}'), 1::bigint, 'opening is audited, with the references');
select is((select actor_type from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'tenant_data_policy' order by id desc limit 1), 'system', '...as the system (the operator has no request identity)');
select is(pg_temp.try(pg_temp.mk('a', 'o1', 'real@gmail.com', '+91 98765 43210')), 'ok', 'open: a real e-mail and phone are accepted');
select is(pg_temp.try(pg_temp.mk('b', 'o2', 'real@gmail.com', null)), 'SM401', 'tenant b still refuses a real e-mail');
select is(pg_temp.imp('a', '[{"company_name":"DEMO Imp Co","contact_name":"Real P","contact_email":"p@gmail.com","contact_phone":"+91 98765 43211"}]') -> 'rows' -> 0 ->> 'outcome', 'created', 'open: the import accepts a real contact');
select is(pg_temp.imp('b', '[{"company_name":"DEMO Imp B","contact_name":"Real P","contact_email":"p@gmail.com"}]') -> 'rows' -> 0 ->> 'reason', 'contact_domain_not_reserved', 'tenant b: the import still rejects it');
select is((select count(*) from public.contacts where tenant_id = tests.tid('b')), (select n from before_b), 'tenant b gained no contact');

-- ---- clients read the state (the banner), and write nothing
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from public.tenant_data_policy')::bigint, 1::bigint, 'a Viewer of tenant a sees tenant a''s policy');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from public.tenant_data_policy')::bigint, 0::bigint, 'tenant b sees nothing of tenant a''s');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.tenant_data_policy set real_data_allowed = false where tenant_id = %L$q$, tests.tid('a'))), '42501', 'an Owner cannot close it through the table');
select is(tests.outcome_as(tests.uid('b_owner'), format($q$insert into public.tenant_data_policy (tenant_id, real_data_allowed, erasure_ref, hosting_ref, dpdp_review_ref, restore_drill_ref, opened_at) values (%L, true, 'a:b', 'a:b', 'a:b', 'a:b', now())$q$, tests.tid('b'))), '42501', 'an Owner cannot open it through the table');
select is(tests.outcome_as(tests.uid('a_owner'), 'delete from public.tenant_data_policy'), '42501', 'nor delete it');

-- ---- close again: reversible, audited, and the refusal is back
select app.operator_close_real_data_gate((select slug from public.tenants where id = tests.tid('a')));
select is(app.real_data_gate_open(tests.tid('a')), false, 'closed again');
select is(pg_temp.try(pg_temp.mk('a', 'c1', 'real2@gmail.com', null)), 'SM401', 'closed again: a real e-mail is refused');
select is((select closed_at is not null and not real_data_allowed and erasure_ref = 'adr:0014' from public.tenant_data_policy where tenant_id = tests.tid('a')), true, 'the references stay as history');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'tenant_data_policy' and new_values @> '{"real_data_allowed": false}'), 1::bigint, 'closing is audited');
select is(pg_temp.try(format($q$update public.contacts set email = 'fixed.o1@example.test' where id = %L$q$, tests.rid('o1'))), 'ok', 'real data already in is not locked: a fix to a reserved address still works (the real phone already in is not re-checked)');
select is(pg_temp.try(format($q$update public.contacts set email = 'again@gmail.com' where id = %L$q$, tests.rid('o1'))), 'SM401', '...but writing a NEW real e-mail is refused');
select is(pg_temp.try(format($q$update public.contacts set archived_at = now() where id = %L$q$, tests.rid('o1'))), 'ok', '...and so does archiving');
select is(pg_temp.try(format($q$select app.operator_close_real_data_gate(%L)$q$, 'no-such-workspace')), '23503', 'closing an unknown workspace is refused');
select pg_temp.open_a();
select is(app.real_data_gate_open(tests.tid('a')), true, 'it can be reopened (with the references again)');

-- ---- a new workspace starts closed
select tests.scalar_as(tests.uid('outsider'), $q$select id from public.create_tenant('Gate New', 'gate-new-tenant')$q$);
select is(app.real_data_gate_open((select id from public.tenants where slug = 'gate-new-tenant')), false, 'a new workspace is closed');

select * from finish();
rollback;
