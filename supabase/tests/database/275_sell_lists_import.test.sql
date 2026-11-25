-- Importing the rows of a file into a list and remembering the mapping (migration 20261231990100).
begin;
select no_plan();

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
select tests.seed_two_tenants();
select pg_temp.at('a_owner', format($q$select public.sell_list_create(%L, %L, 'Sarees', 'products')::text$q$, tests.tid('a'), tests.rid('l1')));
create function pg_temp.key(p text) returns text language sql as $$ select c.key from public.sell_list_columns c where c.tenant_id = tests.tid('a') and c.list_id = tests.rid('l1') and c.removed_at is null and c.label = p $$;
select is(pg_temp.at('a_owner', format($q$select (public.sell_rows_import(%L, %L, %L::jsonb, 'My sheet', '{"Item":"name","Rate":"price"}'::jsonb))::text$q$, tests.tid('a'), tests.rid('l1'), '[{"name":"Cotton","cells":{"price":45000}},{"name":"Silk","cells":{"price":900000}}]')), '{"created": 2, "updated": 0}', 'I1: two new items');
select is(pg_temp.at('a_owner', format($q$select (public.sell_rows_import(%L, %L, %L::jsonb))::text$q$, tests.tid('a'), tests.rid('l1'), '[{"name":"cotton","cells":{"availability":"Out of stock"}},{"name":"Linen","cells":{}}]')), '{"created": 1, "updated": 1}', 'I2: a known name updates, a new one is added');
select is(pg_temp.at('a_owner', format($q$select (cells ->> 'price') || '/' || (cells ->> 'availability') from public.sell_list_rows where tenant_id = %L and list_id = %L and lower(name) = 'cotton'$q$, tests.tid('a'), tests.rid('l1'))), '45000/Out of stock', 'I3: the update kept the cells the file did not carry');
select is(pg_temp.at('a_admin', format($q$select public.sell_rows_import(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l1'), '[{"name":"Dupatta","cells":{"price":12000}}]')), 'ERR:42501', 'I4: an Admin cannot import an amount');
select is(pg_temp.at('a_owner', format($q$select count(*)::text from public.sell_list_rows where tenant_id = %L and list_id = %L and removed_at is null$q$, tests.tid('a'), tests.rid('l1'))), '3', 'I5: nothing of the refused import stayed (all or nothing)');
select is(pg_temp.at('a_owner', format($q$select public.sell_rows_import(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l1'), '[{"name":"Bad","cells":{"price":"cheap"}},{"name":"Good","cells":{}}]')), 'ERR:SM849', 'I6: one bad cell refuses the whole file');
select is(pg_temp.at('a_owner', format($q$select count(*)::text from public.sell_list_rows where tenant_id = %L and list_id = %L and removed_at is null$q$, tests.tid('a'), tests.rid('l1'))), '3', 'I7: and nothing was added');
select is(pg_temp.at('a_viewer', format($q$select jsonb_array_length((public.sell_list_mappings(%L, %L)) -> 'mappings')::text$q$, tests.tid('a'), tests.rid('l1'))), '1', 'I8: a member reads the remembered mapping');
select is(pg_temp.at('b_owner', format($q$select public.sell_list_mappings(%L, %L)::text$q$, tests.tid('a'), tests.rid('l1'))), 'ERR:42501', 'I9: another workspace cannot');
select is(pg_temp.at('a_owner', format($q$select (public.sell_rows_import(%L, %L, '[]'::jsonb, 'My sheet', '{"Item":"name","Rate":"price","Stock":"availability"}'::jsonb))::text$q$, tests.tid('a'), tests.rid('l1'))), '{"created": 0, "updated": 0}', 'I10: saving the same label again');
select is(pg_temp.at('a_owner', format($q$select (select count(*) from public.sell_list_imports where tenant_id = %L and list_id = %L)::text$q$, tests.tid('a'), tests.rid('l1'))), '1', 'I11: replaces it, not a second copy');

select * from finish();
rollback;
