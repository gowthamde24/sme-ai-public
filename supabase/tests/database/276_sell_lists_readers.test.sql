-- The readers of the lists (migration 20261231990200): the phone prices from list price columns (not from-prices), the items' availability and description in the pack, and the built-in lists beside the owner's own.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

select pg_temp.at('a_owner', format($q$select public.sell_list_create(%L, %L, 'Dress materials', 'products')::text$q$, tests.tid('a'), tests.rid('l1')));
select pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l1'),
  '[{"label":"Retail price","type":"rupees","role":"price","quote_default":true},{"label":"Wholesale price","type":"rupees","role":"price","billing_period":"per_unit"},{"label":"From price","type":"rupees","role":"price","billing_period":"from"},{"label":"Stock","type":"choice","choices":["In stock","Out"],"role":"availability"},{"label":"About","type":"text","role":"description"}]'));
create function pg_temp.k(p text) returns text language sql as $$ select c.key from public.sell_list_columns c where c.tenant_id = tests.tid('a') and c.list_id = tests.rid('l1') and c.removed_at is null and c.label = p $$;
select pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Cotton', jsonb_build_object(%L, 52000, %L, 45000, %L, 30000, %L, 'In stock', %L, 'Soft cotton'))::text$q$, tests.tid('a'), tests.rid('l1'), tests.rid('r1'), pg_temp.k('Retail price'), pg_temp.k('Wholesale price'), pg_temp.k('From price'), pg_temp.k('Stock'), pg_temp.k('About')));
select pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Hidden', jsonb_build_object(%L, 99900), false)::text$q$, tests.tid('a'), tests.rid('l1'), tests.rid('r2'), pg_temp.k('Retail price')));

select is((select string_agg((e ->> 'label') || '=' || (e ->> 'paise') || '/' || (e ->> 'period') || '/' || (e ->> 'default'), ',' order by e ->> 'label') from jsonb_array_elements(app.phone_exact_prices(tests.tid('a'), 100)) e where e ->> 'label' is not null),
          'Retail price=52000/one_time/true,Wholesale price=45000/per_unit/false', 'A1: both exact price columns count, with label, period and the default flag; the from-price and an inactive item do not');
select is((select count(*) from jsonb_array_elements(app.phone_exact_prices(tests.tid('b'), 100)) e where e ->> 'label' is not null)::int, 0, 'A2: another workspace sees none of them');
select is(pg_temp.at('a_owner', format($q$select (public.phone_assistant_knows(%L)) ->> 'price_rows'$q$, tests.tid('a'))), '2', 'A3: the readiness count counts the two exact list prices');

create function pg_temp.w(p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid('outsider'), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
select is(pg_temp.w(format($q$select ((public.phone_fact_pack(%L)) -> 'items' -> 0 ->> 'availability') || '/' || ((public.phone_fact_pack(%L)) -> 'items' -> 0 ->> 'description')$q$, tests.tid('a'), tests.tid('a'))), 'In stock/Soft cotton', 'B1: the pack carries the item''s availability word and description');
select is(pg_temp.w(format($q$select jsonb_array_length((public.phone_fact_pack(%L)) -> 'items')::text$q$, tests.tid('b'))), '0', 'B2: and none of another workspace''s');

select is(pg_temp.at('a_viewer', format($q$select jsonb_array_length((public.sell_lists_list(%L)) -> 'lists')::text$q$, tests.tid('a'))), '1', 'C1: the lists answer holds the owner''s list (no built-in list while nothing exists)');
set local session_replication_role = replica;
insert into public.sell_entries (id, tenant_id, style, name, data, created_by) values (tests.rid('s1'), tests.tid('a'), 'services', 'Fall and pico', '{"price_paise": 15000}', tests.uid('a_owner'));
reset session_replication_role;
select is(pg_temp.at('a_viewer', format($q$select (select string_agg(l ->> 'builtin', ',' order by l ->> 'builtin') from jsonb_array_elements((public.sell_lists_list(%L)) -> 'lists') l where l ->> 'builtin' is not null)$q$, tests.tid('a'))), 'services', 'C2: an existing store with rows shows as a built-in list');
select is(pg_temp.at('a_viewer', format($q$select (select (l ->> 'row_count') from jsonb_array_elements((public.sell_lists_list(%L)) -> 'lists') l where l ->> 'builtin' = 'services')$q$, tests.tid('a'))), '1', 'C3: with its item count');
select is(pg_temp.at('a_viewer', format($q$select (select l ->> 'edit_in' from jsonb_array_elements((public.sell_lists_list(%L)) -> 'lists') l where l ->> 'builtin' = 'services')$q$, tests.tid('a'))), 'what_you_sell', 'C4: and says where it is edited');
select is(pg_temp.at('b_owner', format($q$select jsonb_array_length((public.sell_lists_list(%L)) -> 'lists')::text$q$, tests.tid('b'))), '0', 'C5: another workspace has no lists and no built-in ones');

select * from finish();
rollback;
