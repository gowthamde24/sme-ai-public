-- Rebuild a test workspace (migration 20261227090000): A the operator archives (only the operator, a reason, never real data or a demo)   B read-only (the gate's answer, the worker's test) without
-- lapse dates or reminders   C undo   D a member cannot touch the flag
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

create temp table t_name as select name from public.tenants where id = tests.tid('a');
-- A: who may archive, and what
select is(pg_temp.at('aal2', 'a_owner', format($q$select app.operator_archive_workspace(%L, 'owner test workspace rebuilt on request')::text$q$, tests.tid('a'))), 'ERR:42501', 'A1: nobody signed in may archive (operator only, even the Owner)');
select throws_ok(format($q$select app.operator_archive_workspace(%L, 'too short')$q$, tests.tid('a')), '22023', null, 'A2: the operator gives a reason of 20+ characters');
select throws_ok($q$select app.operator_archive_workspace(gen_random_uuid(), 'owner test workspace rebuilt on request')$q$, '23503', null, 'A3: an unknown workspace');
insert into public.tenant_data_policy (tenant_id, real_data_allowed, erasure_ref, hosting_ref, dpdp_review_ref, restore_drill_ref, opened_at) values (tests.tid('b'), true, 'adr:0014', 'adr:0014', 'adr:0014', 'adr:0014', now())
  on conflict (tenant_id) do update set real_data_allowed = true, erasure_ref = 'adr:0014', hosting_ref = 'adr:0014', dpdp_review_ref = 'adr:0014', restore_drill_ref = 'adr:0014', opened_at = now();
select throws_ok(format($q$select app.operator_archive_workspace(%L, 'owner test workspace rebuilt on request')$q$, tests.tid('b')), '42501', null, 'A4: a workspace whose real-data gate is OPEN is never archived this way');
update public.tenant_data_policy set real_data_allowed = false where tenant_id = tests.tid('b');
update public.tenants set demo = true where id = tests.tid('b');
select throws_ok(format($q$select app.operator_archive_workspace(%L, 'owner test workspace rebuilt on request')$q$, tests.tid('b')), '42501', null, 'A5: a demo workspace is rebuilt by its own seed, not archived');
update public.tenants set demo = false where id = tests.tid('b');
select is((app.operator_archive_workspace(tests.tid('a'), 'owner test workspace rebuilt on request') ->> 'archived'), 'true', 'A6: the operator archives the test workspace');
select ok((select archived_at is not null and archived_reason = 'owner test workspace rebuilt on request' from public.tenants where id = tests.tid('a')), 'A7: when and why are kept');
select is((select name from public.tenants where id = tests.tid('a')), (select name from t_name) || ' (archived ' || to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') || ')',
          'A8: the name says it is archived (a seed that finds a workspace by name finds the fresh one)');
select is((app.operator_archive_workspace(tests.tid('a'), 'owner test workspace rebuilt on request') ->> 'archived'), 'false', 'A9: again: nothing changes');
select ok((select name from public.tenants where id = tests.tid('a')) not like '%(archived %(archived %', 'A10: ... and the name is not marked twice');

-- B: read-only, with no lapse
select is(app.billing_read_only(tests.tid('a')), true, 'B1: read-only for the worker and the outbox (nothing is sent, released, planned or run)');
select is(app.billing_read_only(tests.tid('b')), false, 'B2: another workspace is not');
select is(pg_temp.at('aal2', 'a_owner', format($q$select public.billing_access(%L) ->> 'access'$q$, tests.tid('a'))), 'read_only', 'B3: the API gate reads read_only (every change and spend is refused)');
select is(pg_temp.at('aal2', 'a_viewer', format($q$select public.billing_access(%L) ->> 'archived'$q$, tests.tid('a'))), 'true', 'B4: any member reads that it is archived');
select is(pg_temp.at('aal2', 'a_owner', format($q$select coalesce(public.billing_access(%L) ->> 'delete_on', 'none')$q$, tests.tid('a'))), 'none', 'B5: no deletion date (it is not a lapse)');
select is(pg_temp.at('aal2', 'a_owner', format($q$select public.billing_access(%L) ->> 'sending'$q$, tests.tid('a'))), 'off', 'B6: sending is off');
select is(app.billing_lapse(tests.tid('a')) ->> 'access', 'full', 'B7: the lapse itself is unchanged: no "your plan ended" reminder, never on the 90-day deletion list');
select is(pg_temp.at('aal2', 'b_owner', format($q$select public.billing_access(%L) ->> 'archived'$q$, tests.tid('b'))), 'false', 'B8: a workspace in use says archived: false');
select is(pg_temp.at('aal2', 'b_owner', format($q$select public.billing_access(%L) ->> 'access'$q$, tests.tid('b'))), 'full', 'B9: ... and full');
select is(pg_temp.at('aal2', 'b_owner', format($q$select public.billing_access(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B10: another workspace''s owner reads nothing of it');
select ok(pg_temp.at('aal2', 'a_viewer', format($q$select count(*)::text from public.tenants where id = %L$q$, tests.tid('a'))) = '1', 'B11: a member still sees it (a direct link opens it, read-only)');

-- E: the allowance (an archived workspace no longer counts: the fresh one replaces it)
update public.tenants set workspace_limit = 1 where id in (tests.tid('a'), tests.tid('b'));
select is((select owned from app.owner_allowance(tests.uid('a_owner'), tests.tid('b'))), 0, 'E1: the Owner of an archived workspace owns none that count');
select is((select allowed from app.owner_allowance(tests.uid('a_owner'), tests.tid('b'))), 1, 'E2: ... and may own one more on a limit of one');

-- D: a member cannot touch the flag
select is(pg_temp.at('aal2', 'a_owner', format($q$update public.tenants set archived_at = null where id = %L returning 'x'$q$, tests.tid('a'))), 'ERR:42501', 'D1: the Owner cannot un-archive it (only the name is theirs to change)');
select is(pg_temp.at('aal2', 'a_owner', format($q$select app.operator_unarchive_workspace(%L, 'owner test workspace back in use')::text$q$, tests.tid('a'))), 'ERR:42501', 'D2: nor through the operator''s function');

-- C: undo
select throws_ok(format($q$select app.operator_unarchive_workspace(%L, 'short')$q$, tests.tid('a')), '22023', null, 'C1: undo needs a reason too');
select is((app.operator_unarchive_workspace(tests.tid('a'), 'owner test workspace back in use') ->> 'archived'), 'false', 'C2: the operator undoes it');
select is(app.billing_read_only(tests.tid('a')), false, 'C3: it can be changed again');
select is(pg_temp.at('aal2', 'a_owner', format($q$select public.billing_access(%L) ->> 'access'$q$, tests.tid('a'))), 'full', 'C4: ... the gate reads full');

select * from finish();
rollback;
