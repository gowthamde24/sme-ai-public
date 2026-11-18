-- A business gets and gives back its own number (migration 20261231982900; planner, 18 Nov 2026).
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('Outsider@test.local');
create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.attach(p_user text, p_number text, p_aal text default 'aal2', p_ref text default null, p_sub text default 'SA1234567890AB') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.phone_number_attach(%L, %L, %L, %L)::jsonb ->> 'number'$q$, tests.tid('a'), p_number, coalesce(p_ref, 'sme-ws-' || tests.tid('a') || '-plivo-token'), p_sub), p_aal) $$;
-- the business's own registration is accepted, in its own sub-account
insert into public.phone_kyc (id, tenant_id, doc_kind, plivo_subaccount, compliance_id, status, created_by) values (gen_random_uuid(), tests.tid('a'), 'gst', 'SA1234567890AB', 'comp-12345678', 'accepted', tests.uid('a_owner'));

select is(pg_temp.attach('a_owner', '+918044440111', 'aal2', 'sme-ws-' || tests.tid('b') || '-plivo-token'), 'ERR:22023', 'N0 another workspace''s vault key can never be named');
select is(pg_temp.attach('a_owner', '+918044440111', 'aal2', null, 'SAOTHER0000001'), 'ERR:SM961', 'N0b a sub-account that is not the one its accepted registration made is refused');
select is(pg_temp.attach('a_owner', '+918044440111'), '+918044440111', 'N1 the Owner records the line the provider rented');
select is((select inbound_on::text || '/' || provider from public.phone_numbers where number = '+918044440111'), 'false/plivo', 'N2 inbound is OFF until the first test call has passed');
select is(pg_temp.attach('a_owner', '+918044440222'), 'ERR:SM961', 'N3 one business line per workspace');
select is(pg_temp.attach('a_admin', '+918044440222'), 'ERR:42501', 'N4 an Admin cannot (the Owner''s)');
select is(pg_temp.attach('b_owner', '+918044440222'), 'ERR:42501', 'N5 another workspace''s Owner cannot');
select is(pg_temp.attach('a_owner', '+918044440222', 'aal1'), 'ERR:SM306', 'N6 a second factor is needed');
select is(pg_temp.attach('a_owner', 'not a number'), 'ERR:22023', 'N7 a bad number is refused');
select is(pg_temp.val('a_owner', format($q$select public.phone_number_detach(%L, '+918044440999')::text$q$, tests.tid('a'))), 'ERR:23503', 'N8 giving back a number the business does not hold is refused');
select is(pg_temp.val('a_admin', format($q$select public.phone_number_detach(%L, '+918044440111')::text$q$, tests.tid('a'))), 'ERR:42501', 'N9 an Admin cannot give it back');
select is(pg_temp.val('a_owner', format($q$select public.phone_number_detach(%L, '+918044440111')::jsonb ->> 'number'$q$, tests.tid('a'))), '+918044440111', 'N10 the Owner gives it back');
select is((select count(*) from public.phone_numbers where number = '+918044440111'), 0::bigint, 'N11 the row is gone');

-- a closed workspace
select pg_temp.attach('a_owner', '+918044440333');
select is(pg_temp.val('outsider', $q$select public.scheduler_phone_lines_closed(10)::text$q$), '[]', 'N12 an open workspace''s line is not listed');
update public.tenants set archived_at = now(), archived_reason = 'closed by the owner on request' where id = tests.tid('a');
select is(pg_temp.val('outsider', $q$select (public.scheduler_phone_lines_closed(10)::jsonb -> 0) ->> 'number'$q$), '+918044440333', 'N13 a closed workspace''s line is listed for release');
select is(pg_temp.val('a_owner', $q$select public.scheduler_phone_lines_closed(10)::text$q$), 'ERR:42501', 'N14 only the phone server lists them');
select is(pg_temp.val('outsider', $q$select public.scheduler_phone_line_removed('+918044440333')::text$q$), 'true', 'N15 the phone server removes the row once the provider released it');
select is(pg_temp.val('outsider', $q$select public.scheduler_phone_line_removed('+918044440333')::text$q$), 'false', 'N16 ... and a second time does nothing');

select * from finish();
rollback;
