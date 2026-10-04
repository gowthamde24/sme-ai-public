-- T006b M1 (ADR 0014): request_erasure / execute_erasure / cancel_erasure: roles, the oracle-free refusals, idempotency, the 24-hour
-- window, replay, dry run, atomicity, and a request log that holds no value.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.er_plant('a');
select tests.er_plant('b');

-- ---- properties
create temp table fns as select p.oid, p.proname, p.prosecdef, p.proconfig, p.proowner::regrole::text as owner
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('request_erasure', 'execute_erasure', 'cancel_erasure');
select is((select count(*) from fns), 3::bigint, 'one overload each of the three functions');
select is((select count(*) from fns where prosecdef and 'search_path=""' = any (proconfig) and owner = 'postgres'), 3::bigint, 'SECURITY DEFINER, empty search_path, owned by the migration role');
select is((select count(*) from fns where has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')), 3::bigint, 'authenticated may execute, anon may not');

create function pg_temp.req(p_user text, p_id text, p_tenant text, p_scope text, p_subject text default null) returns text language sql as $$
  select tests.error_full_as(tests.uid(p_user), format('select public.request_erasure(%L, %L, %L, %L)', tests.rid(p_id), tests.tid(p_tenant), p_scope, case when p_subject is null then null else tests.rid(p_subject) end)) $$;
create function pg_temp.req_ok(p_user text, p_id text, p_tenant text, p_scope text, p_subject text default null) returns jsonb language sql as $$
  select tests.scalar_as(tests.uid(p_user), format('select public.request_erasure(%L, %L, %L, %L)', tests.rid(p_id), tests.tid(p_tenant), p_scope, case when p_subject is null then null else tests.rid(p_subject) end))::jsonb $$;
create function pg_temp.exec(p_user text, p_id text, p_dry text default 'false') returns text language sql as $$
  select tests.error_full_as(tests.uid(p_user), format('select public.execute_erasure(%L, %s)', tests.rid(p_id), p_dry)) $$;
create function pg_temp.exec_ok(p_user text, p_id text, p_dry text default 'false') returns jsonb language sql as $$
  select tests.scalar_as(tests.uid(p_user), format('select public.execute_erasure(%L, %s)', tests.rid(p_id), p_dry))::jsonb $$;
create function pg_temp.canc(p_user text, p_id text) returns text language sql as $$
  select tests.error_full_as(tests.uid(p_user), format('select public.cancel_erasure(%L)', tests.rid(p_id))) $$;

-- ---- request: who may
select is(pg_temp.req('a_sales', 'r_sales', 'a', 'contact', 'a_contact'), '42501|erasure action not permitted||||', 'Sales cannot request: generic refusal');
select is(pg_temp.req('a_viewer', 'r_viewer', 'a', 'contact', 'a_contact'), '42501|erasure action not permitted||||', 'a Viewer cannot request: identical');
select is(pg_temp.req('outsider', 'r_out', 'a', 'contact', 'a_contact'), '42501|erasure action not permitted||||', 'an outsider cannot request: identical');
select is(pg_temp.req('b_owner', 'r_foreign', 'a', 'contact', 'a_contact'), '42501|erasure action not permitted||||', 'another tenant''s Owner naming tenant a: identical');
select is(pg_temp.req(null, 'r_anon', 'a', 'contact', 'a_contact'), '42501|permission denied for function request_erasure||||', 'anon: no EXECUTE');
select is(tests.error_full_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid('r_u1'), gen_random_uuid(), tests.rid('a_contact'))), '42501|erasure action not permitted||||', 'an unknown tenant id looks like a foreign one');
select is((select count(*) from public.erasure_requests where tenant_id in (tests.tid('a'), tests.tid('b'))), 0::bigint, 'none of the refusals logged anything');

-- ---- request: Owner and Admin may; subject checks come only after the role is proven
select is(pg_temp.req_ok('a_admin', 'r_admin', 'a', 'contact', 'a_contact') ->> 'status', 'pending', 'an Admin may request');
select is(pg_temp.req_ok('a_owner', 'r_owner', 'a', 'company', 'a_company') ->> 'status', 'pending', 'an Owner may request');
select is(pg_temp.req('a_owner', 'r_bad_subject', 'a', 'contact', 'b_contact'), '23503|invalid reference||||', 'a contact of ANOTHER tenant: invalid reference (the caller is an Owner here)');
select is(pg_temp.req('a_owner', 'r_bad_subject2', 'a', 'contact', 'a_company'), '23503|invalid reference||||', 'a company id used as a contact: the same');
select is(pg_temp.req('a_owner', 'r_args1', 'a', 'nonsense', 'a_contact'), '22023|invalid argument||||', 'unknown scope: invalid argument');
select is(pg_temp.req('a_owner', 'r_args2', 'a', 'contact', null), '22023|invalid argument||||', 'contact scope needs a subject');
select is(pg_temp.req('a_owner', 'r_args3', 'a', 'tenant', 'a_contact'), '22023|invalid argument||||', 'tenant scope takes no subject');
select is(tests.error_full_as(tests.uid('a_owner'), format('select public.request_erasure(null, %L, ''contact'', %L)', tests.tid('a'), tests.rid('a_contact'))), '42501|erasure action not permitted||||', 'a NULL request id is refused before anything else');

-- ---- idempotency
select is(pg_temp.req_ok('a_admin', 'r_admin', 'a', 'contact', 'a_contact') ->> 'replayed', 'true', 'the same request again is a replay');
select is(pg_temp.req('a_admin', 'r_admin', 'a', 'company', 'a_company'), '23505|erasure request id already used||||', 'the same id with another payload: constant 23505');
select is(pg_temp.req('b_owner', 'r_admin', 'b', 'contact', 'b_contact'), pg_temp.req('a_admin', 'r_admin', 'a', 'company', 'a_company'), 'an id used by ANOTHER tenant gives the identical answer');
select is((select count(*) from public.erasure_requests where tenant_id = tests.tid('a')), 2::bigint, 'two requests, not four');

-- ---- the window
select ok((select execute_after <= now() + interval '1 second' from public.erasure_requests where id = tests.rid('r_admin')), 'a contact request is executable at once');
select ok((select execute_after <= now() + interval '1 second' from public.erasure_requests where id = tests.rid('r_owner')), 'a company request is executable at once');
select is(pg_temp.req_ok('a_admin', 'r_tenant', 'a', 'tenant') ->> 'status', 'pending', 'a tenant-wide request is recorded');
select ok((select execute_after between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from public.erasure_requests where id = tests.rid('r_tenant')), 'a tenant-wide request waits 24 hours');

-- ---- execute: who may (always Owner of the request's tenant; everything else is the same generic refusal)
select is(pg_temp.exec('a_admin', 'r_admin'), '42501|erasure action not permitted||||', 'the Admin who requested cannot execute');
select is(pg_temp.exec('a_sales', 'r_admin'), '42501|erasure action not permitted||||', 'Sales cannot execute');
select is(pg_temp.exec('b_owner', 'r_admin'), '42501|erasure action not permitted||||', 'another tenant''s Owner cannot execute');
select is(pg_temp.exec('a_owner', 'r_nothing'), '42501|erasure action not permitted||||', 'an unknown request id: identical');
select is(pg_temp.exec(null, 'r_admin'), '42501|permission denied for function execute_erasure||||', 'anon: no EXECUTE');
select is(pg_temp.exec('a_owner', 'r_tenant'), 'SM302|erasure window has not elapsed||||', 'a tenant-wide request cannot run inside its 24 hours');

-- ---- cancel
select is(pg_temp.canc('a_sales', 'r_tenant'), '42501|erasure action not permitted||||', 'Sales cannot cancel');
select is(pg_temp.canc('b_owner', 'r_tenant'), '42501|erasure action not permitted||||', 'another tenant cannot cancel');
select is(tests.scalar_as(tests.uid('a_admin'), format('select public.cancel_erasure(%L)', tests.rid('r_tenant')))::jsonb ->> 'status', 'cancelled', 'an Admin may cancel a pending request');
select is(tests.scalar_as(tests.uid('a_owner'), format('select public.cancel_erasure(%L)', tests.rid('r_tenant')))::jsonb ->> 'replayed', 'true', 'cancelling twice is a replay');
select is(pg_temp.exec('a_owner', 'r_tenant'), 'SM304|erasure request was cancelled||||', 'a cancelled request cannot be executed');

-- ---- dry run: counts, nothing changes
create temp table before_a as select tests.er_digest('a') as d, (select count(*) from public.audit_events where tenant_id = tests.tid('a')) as audits;
create temp table dry as select pg_temp.exec_ok('a_owner', 'r_admin', 'true') as r;
select is((select r ->> 'dry_run' from dry), 'true', 'a dry run says so');
select ok((select (r -> 'counts' ->> 'contacts.email')::int = 1 from dry), 'a dry run reports what it would change');
select is(tests.er_digest('a'), (select d from before_a), 'a dry run changes nothing (not one byte of the workspace)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a')), (select audits from before_a), 'a dry run writes no audit row');
select is((select status::text from public.erasure_requests where id = tests.rid('r_admin')), 'pending', 'a dry run leaves the request pending');

-- ---- atomicity: a failure half-way (the sweep reaches products last in the contact scope) leaves nothing changed and the request pending
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger zz_boom before update on public.products for each row execute function pg_temp.boom();
select is(substr(pg_temp.exec('a_owner', 'r_admin'), 1, 5), 'P0001', 'an error inside the erasure aborts it');
select is(tests.er_digest('a'), (select d from before_a), 'all or nothing: the workspace is byte-identical after the failure');
select is((select status::text from public.erasure_requests where id = tests.rid('r_admin')), 'pending', '...and the request is still pending');
drop trigger zz_boom on public.products;

-- ---- execute for real, then replay
create temp table before_b as select tests.er_digest('b') as d;
create temp table done as select pg_temp.exec_ok('a_owner', 'r_admin') as r;
select is((select r ->> 'status' from done), 'executed', 'the Owner executes');
select is((select status::text from public.erasure_requests where id = tests.rid('r_admin')), 'executed', 'the log says executed');
select is((select executed_by from public.erasure_requests where id = tests.rid('r_admin')), tests.uid('a_owner'), '...by the Owner');
select is(tests.er_digest('b'), (select d from before_b), 'tenant b is byte-identical after tenant a''s erasure');
create temp table after_a as select tests.er_digest('a') as d;
select is(pg_temp.exec_ok('a_owner', 'r_admin') ->> 'replayed', 'true', 'executing again is a replay');
select is(tests.er_digest('a'), (select d from after_a), '...and changes nothing');
select is(pg_temp.canc('a_owner', 'r_admin'), 'SM303|erasure request already executed||||', 'an executed request cannot be cancelled');
select is((select count(*) from public.erasure_requests where tenant_id in (tests.tid('a'), tests.tid('b')) and result::text ~* '(qxjv|zed|9876|canary|kzv9)'), 0::bigint, 'the log holds no canary: ids and counts only');

-- ---- the log is readable by Owner/Admin of the tenant only
select is((select count(*) from public.erasure_requests where tenant_id = tests.tid('a')), 3::bigint, 'sanity: three requests in tenant a');
select is(tests.scalar_as(tests.uid('a_admin'), 'select count(*) from public.erasure_requests')::bigint, 3::bigint, 'an Admin reads the log');
select is(tests.scalar_as(tests.uid('a_sales'), 'select count(*) from public.erasure_requests')::bigint, 0::bigint, 'Sales sees nothing');
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from public.erasure_requests')::bigint, 0::bigint, 'a Viewer sees nothing');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from public.erasure_requests')::bigint, 0::bigint, 'another tenant sees nothing');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.erasure_requests (id, tenant_id, scope, requested_by, execute_after) values (%L, %L, 'tenant', %L, now())$q$, gen_random_uuid(), tests.tid('a'), tests.uid('a_owner'))), '42501', 'nobody writes the log directly (insert)');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.erasure_requests set status = 'cancelled' where id = %L$q$, tests.rid('r_admin'))), '42501', '...nor updates it');
select is(tests.outcome_as(tests.uid('a_owner'), 'delete from public.erasure_requests'), '42501', '...nor deletes from it');

select * from finish();
rollback;
