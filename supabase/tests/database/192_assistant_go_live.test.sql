-- "My assistant": status facts, go live (needs a business name and a connected phone number), pause, who may.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;

update public.tenants set name = 'My business' where id = tests.tid('a');
delete from public.phone_numbers where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.sc('a_viewer', format($q$select public.assistant_status_get(%L)::text$q$, tests.tid('a'))), 'live'), 'false', 'S1: any member reads the status; a new assistant is not live');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.assistant_status_get(%L)::text$q$, tests.tid('a'))), 'business_name_ok'), 'false', 'S2: the placeholder name "My business" is not a business name');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.assistant_status_get(%L)::text$q$, tests.tid('a'))), 'phone_number_ok'), 'false', 'S3: no phone number yet');
select is(pg_temp.sc('b_owner', format($q$select public.assistant_status_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'S4: another business sees nothing');
select is(pg_temp.sc('anon', format($q$select public.assistant_status_get(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'S5: nor anyone signed out');

select is(pg_temp.sc('a_owner', format($q$select public.assistant_go_live(%L)::text$q$, tests.tid('a'))), 'ERR:SM991', 'G1: going live needs a name and a phone number (SM991)');
update public.tenants set name = 'Synthetic Silks' where id = tests.tid('a');
select is(pg_temp.sc('a_owner', format($q$select public.assistant_go_live(%L)::text$q$, tests.tid('a'))), 'ERR:SM991', 'G2: a name alone is not enough');
insert into public.phone_numbers (tenant_id, number, label, inbound_on) values (tests.tid('a'), '+918045551234', 'Shop line', true);
select is(pg_temp.sc('a_admin', format($q$select public.assistant_go_live(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'G3: only the Owner goes live (an Admin is refused)');
select is(pg_temp.sc('a_sales', format($q$select public.assistant_pause(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'G4: nor pauses');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.assistant_go_live(%L)::text$q$, tests.tid('a'))), 'live'), 'true', 'G5: with a name and a phone number the Owner goes live');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.assistant_go_live(%L)::text$q$, tests.tid('a'))), 'live'), 'true', 'G6: going live again changes nothing');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.assistant_pause(%L)::text$q$, tests.tid('a'))), 'live'), 'false', 'P1: pause');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.assistant_pause(%L)::text$q$, tests.tid('a'))), 'ever_changed'), 'true', 'P2: and it is remembered that it was changed');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action in ('assistant.went_live', 'assistant.paused')), 4::bigint, 'A1: every call is in the audit log (go live twice, pause twice)');
select is((select count(*) from information_schema.table_privileges where table_schema = 'workspace' and table_name = 'assistant_live' and grantee in ('anon', 'authenticated', 'public')), 0::bigint, 'C1: no client role touches the table');
select pg_temp.sc('a_owner', format($q$select public.assistant_go_live(%L)::text$q$, tests.tid('a')));
update public.tenants set name = 'My business' where id = tests.tid('a');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.assistant_status_get(%L)::text$q$, tests.tid('a'))), 'live'), 'true', 'L1: the stored live flag is what the status reports (the API turns a missing prerequisite into "not ready")');

select * from finish();
rollback;
