-- The business's own type label (migration 20261231992720): markup characters are refused by the table, and the phone fact pack carries it as `business_type` only for a business that chose Other.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.bset(p_user text, p_patch text, p_tenant text default 'a') returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');
  return tests.scalar_as(tests.uid(p_user), format('select public.workspace_business_set(%L, %L::jsonb)::text', tests.tid(p_tenant), p_patch));
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.w(p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid('outsider'), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(pg_temp.bset('a_sales', '{"type":"other","type_label":"Tent house"}') like 'ERR:%', true, 'A1: only the Owner sets the label');
select pg_temp.bset('a_owner', '{"type":"other","type_label":"Tent house"}');
select is(pg_temp.w(format($q$select (public.phone_fact_pack(%L)) ->> 'business_type'$q$, tests.tid('a'))), 'Tent house', 'B1: the phone pack carries the label of a business that chose Other');
select pg_temp.bset('a_owner', '{"type":"coaching"}');
select is(pg_temp.w(format($q$select coalesce((public.phone_fact_pack(%L)) ->> 'business_type', 'none')$q$, tests.tid('a'))), 'none', 'B2: another type carries none');
select throws_ok($q$update workspace.profiles set type_label = 'a <b> c' where tenant_id = tests.tid('a')$q$, '23514', null, 'C1: a label with angle brackets is refused by the table');
select is(pg_temp.w(format($q$select coalesce((public.phone_fact_pack(%L)) ->> 'business_type', 'none')$q$, tests.tid('b'))), 'none', 'B3: another workspace has none');

select * from finish();
rollback;
