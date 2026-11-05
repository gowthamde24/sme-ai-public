-- A workspace's own keys (migration 20261231120000): the secure card's request (Owner, 15 minutes, once, the caller's own), where the key is (name, last four, fingerprint; never the key), who reads it.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.open_gate('a');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

create temp table r (id uuid);
grant select, insert on r to authenticated;
insert into r select (pg_temp.q('a_owner', $q$select public.secret_request_open(%L, 'indiamart_key') ->> 'request_id'$q$))::uuid;

select ok((select id from r) is not null, 'A1 the Owner opens a request');
select is(pg_temp.q('a_admin', $q$select public.secret_request_open(%L, 'indiamart_key') ->> 'request_id'$q$), 'ERR:42501', 'A2 an Admin does not');
select is(pg_temp.q('a_sales', $q$select public.secret_request_open(%L, 'indiamart_key') ->> 'request_id'$q$), 'ERR:42501', 'A3 nor Sales');
select is(pg_temp.q('b_owner', format($q$select public.secret_request_open(%L, 'indiamart_key') ->> 'request_id'$q$, tests.tid('a'))), 'ERR:42501', 'A4 nor another workspace''s Owner');
select is(pg_temp.q('a_owner', $q$select public.secret_request_open(%L, 'smtp_password') ->> 'request_id'$q$), 'ERR:22023', 'A5 a kind not on the list');
select is(pg_temp.q('a_owner', $q$select (public.secret_request_open(%L, 'indiamart_key') -> 'saved')::text$q$), 'null', 'A6 nothing saved yet');

select is(pg_temp.q('a_owner', format($q$select public.secret_request_use(%%L, %L) ->> 'secret_name'$q$, (select id from r))), 'sme-ws-' || tests.tid('a')::text || '-indiamart', 'B1 the request is used: the secret''s name');
select is(pg_temp.q('a_owner', format($q$select public.secret_request_use(%%L, %L) ->> 'secret_name'$q$, (select id from r))), 'ERR:SM981', 'B2 once');
update public.secret_requests set expires_at = now() - interval '1 second' where tenant_id = tests.tid('a') and used_at is null;
select is(pg_temp.q('a_owner', format($q$select public.secret_request_use(%%L, %L) ->> 'kind'$q$, (select id from public.secret_requests where tenant_id = tests.tid('a') and used_at is null limit 1))), 'ERR:SM982', 'B3 after 15 minutes: expired');
select is(pg_temp.q('a_owner', format($q$select public.secret_request_use(%%L, %L) ->> 'kind'$q$, gen_random_uuid())), 'ERR:23503', 'B4 an unknown request');

select is(pg_temp.q('a_owner', $q$select public.workspace_secret_record(%1$L, 'indiamart_key', 'sme-ws-' || %1$L || '-indiamart', 'A0sZ', '0123456789abcdef') ->> 'last4'$q$), 'A0sZ', 'C1 where it is: the Owner records it');
select is(pg_temp.q('a_owner', $q$select public.workspace_secret_record(%L, 'indiamart_key', 'sme-ws-someone-else-indiamart', 'A0sZ', '0123456789abcdef') ->> 'last4'$q$), 'ERR:22023', 'C2 only its own name');
select is(pg_temp.q('a_admin', $q$select public.workspace_secret_record(%1$L, 'indiamart_key', 'sme-ws-' || %1$L || '-indiamart', 'A0sZ', '0123456789abcdef') ->> 'last4'$q$), 'ERR:42501', 'C3 an Admin does not record');
select is(pg_temp.q('a_owner', $q$select public.workspace_secret_record(%1$L, 'indiamart_key', 'sme-ws-' || %1$L || '-indiamart', 'A0sZ', 'not-a-fingerprint') ->> 'last4'$q$), 'ERR:23514', 'C4 a fingerprint is 16 hex characters');

select is(pg_temp.q('a_admin', $q$select public.workspace_secret_get(%L, 'indiamart_key') ->> 'last4'$q$), 'A0sZ', 'D1 an Admin reads where it is (for a pull)');
select is(pg_temp.q('a_sales', $q$select public.workspace_secret_get(%L, 'indiamart_key') ->> 'last4'$q$), 'ERR:42501', 'D2 Sales does not');
select is(pg_temp.q('a_owner', $q$select (public.workspace_secret_get(%L, 'indiamart_key') ? 'fingerprint')::text$q$), 'false', 'D3 the fingerprint is never returned');
select is(pg_temp.q('a_owner', $q$select (public.secret_request_open(%L, 'indiamart_key') -> 'saved' ->> 'last4')$q$), 'A0sZ', 'D4 the next card says it is saved (last four)');

select is(pg_temp.q('a_sales', $q$select count(*)::text from public.workspace_secrets$q$), '0', 'E1 Sales sees no row of the table');
select is(pg_temp.q('a_owner', $q$select max(fingerprint) from public.workspace_secrets$q$), 'ERR:42501', 'E2 nobody reads the fingerprint column');
select is(pg_temp.q('a_admin', $q$select count(*)::text from public.secret_requests$q$), '0', 'E2b an Admin sees no card request');
insert into r select null;
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'workspace_secrets' and column_name in ('value', 'key', 'secret', 'data')), 0, 'E3 no column could hold a key');

select * from finish();
rollback;
