-- "What you sell" lists (migration 20261231990000): who may do what, the limits, the roles (several price columns, one default, one stock), cells checked per column type, only the Owner changes an amount, and tenants never see each other's lists.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A. create: Owner and Admin; the kind's default columns; the first list is main; the same id again is a retry
select is(pg_temp.at('a_sales', format($q$select public.sell_list_create(%L, %L, 'Sarees', 'products')::text$q$, tests.tid('a'), tests.rid('l1'))), 'ERR:42501', 'A1: Sales cannot make a list');
select is(pg_temp.at('b_owner', format($q$select public.sell_list_create(%L, %L, 'Sarees', 'products')::text$q$, tests.tid('a'), tests.rid('l1'))), 'ERR:42501', 'A2: nor another workspace''s Owner');
select is(pg_temp.at('a_admin', format($q$select (public.sell_list_create(%L, %L, 'Sarees', 'products')) ->> 'is_main'$q$, tests.tid('a'), tests.rid('l1'))), 'true', 'A3: an Admin makes the first list and it is main');
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.sell_list_create(%L, %L, 'Sarees', 'products')) -> 'columns')::text$q$, tests.tid('a'), tests.rid('l1'))), '4', 'A4: the same id again is a retry (4 default columns: price, availability, quantity, photo)');
select is(pg_temp.at('a_owner', format($q$select (public.sell_list_create(%L, %L, 'sarees', 'products')) ->> 'id'$q$, tests.tid('a'), tests.rid('l2'))), 'ERR:SM844', 'A5: the same name in another case is name_taken');
select is(pg_temp.at('a_owner', format($q$select (public.sell_list_create(%L, %L, 'Dress materials', 'other')) ->> 'is_main'$q$, tests.tid('a'), tests.rid('l2'))), 'false', 'A6: the second list is not main');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_create(%L, %L, '   ', 'other')::text$q$, tests.tid('a'), tests.rid('l3'))), 'ERR:22023', 'A7: an empty name is invalid');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_create(%L, %L, 'x', 'gadgets')::text$q$, tests.tid('a'), tests.rid('l3'))), 'ERR:22023', 'A8: an unknown kind is invalid');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_create(%L, %L, 'Third', 'services')::text$q$, tests.tid('a'), tests.rid('l3'))) like '{%', true, 'A9: a third list on a trial');
select is(pg_temp.at('a_owner', format($q$select count(*)::text from (select public.sell_list_create(%L, gen_random_uuid(), 'Extra ' || g, 'other') from generate_series(1, 5) g) x$q$, tests.tid('a'))), '5', 'A10a: a trial workspace can have up to 8 lists (5 more)');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_create(%L, %L, 'Ninth', 'services')::text$q$, tests.tid('a'), tests.rid('l4'))), 'ERR:SM841', 'A10: a trial workspace has at most 8 lists');

-- B. reads: members only, never another workspace's
select is(pg_temp.at('a_viewer', format($q$select jsonb_array_length(public.sell_lists_list(%L) -> 'lists')::text$q$, tests.tid('a'))), '8', 'B1: any member reads the lists');
select is(pg_temp.at('b_owner', format($q$select public.sell_lists_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B2: another workspace cannot');
select is(pg_temp.at('b_owner', format($q$select jsonb_array_length(public.sell_lists_list(%L) -> 'lists')::text$q$, tests.tid('b'))), '0', 'B3: and has none of its own yet');

-- C. columns: several price columns, exactly one default, one stock column, limits, data guards
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.sell_list_columns_put(%L, %L, %L::jsonb)) -> 'columns')::text$q$, tests.tid('a'), tests.rid('l2'),
  '[{"label":"Retail price","type":"rupees","role":"price","quote_default":true},{"label":"Wholesale price","type":"rupees","role":"price","billing_period":"per_unit"},{"label":"Stock","type":"choice","choices":["In stock","Out"],"role":"availability"},{"label":"Colour","type":"text"}]')), '4', 'C1: two price columns, an availability column and a text column');
select is(pg_temp.at('a_owner', format($q$select (select count(*) from jsonb_array_elements((public.sell_list_get(%L, %L)) -> 'columns') c where (c ->> 'quote_default')::boolean)::text$q$, tests.tid('a'), tests.rid('l2'))), '1', 'C2: exactly one is the default to quote');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'),
  '[{"label":"A","type":"rupees","role":"price","quote_default":true},{"label":"B","type":"rupees","role":"price","quote_default":true}]')), 'ERR:SM845', 'C3: two defaults are refused');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'),
  '[{"label":"S1","type":"choice","choices":["a"],"role":"availability"},{"label":"S2","type":"choice","choices":["b"],"role":"availability"}]')), 'ERR:SM846', 'C4: two availability columns are refused');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'),
  '[{"label":"Same","type":"text"},{"label":"same","type":"text"}]')), 'ERR:SM844', 'C5: two columns with one label are name_taken');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'),
  '[{"label":"Cost","type":"text","role":"price"}]')), 'ERR:SM849', 'C6: a price column must hold rupees');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, (select jsonb_agg(jsonb_build_object('label', 'c' || g, 'type', 'text')) from generate_series(1, 13) g))$q$, tests.tid('a'), tests.rid('l2'))), 'ERR:SM842', 'C7: at most 12 columns');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'),
  '[{"label":"Colour","type":"choice","choices":[]}]')), 'ERR:22023', 'C8: a choice column needs words');
select is(pg_temp.at('a_viewer', format($q$select public.sell_list_columns_put(%L, %L, '[]'::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'))), 'ERR:42501', 'C9: a viewer cannot change columns');
select is(pg_temp.at('a_owner', format($q$select (select count(*) from public.sell_list_columns where tenant_id = %L and list_id = %L and removed_at is null)::text$q$, tests.tid('a'), tests.rid('l2'))), '4', 'C10: the refused calls changed nothing (still the 4 columns of C1)');

select is(pg_temp.at('a_owner', format($q$select (select c ->> 'billing_period' from jsonb_array_elements((public.sell_list_get(%L, %L)) -> 'columns') c where c ->> 'label' = 'Wholesale price')$q$, tests.tid('a'), tests.rid('l2'))), 'per_unit', 'C11: a price column carries its billing period');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'), '[{"label":"P","type":"rupees","role":"price","billing_period":"weekly"}]')), 'ERR:22023', 'C12: an unknown billing period is invalid');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'), '[{"label":"Link","type":"text","role":"how_to_buy"}]')), 'ERR:22023', 'C13: the how-to-buy role needs a link column');

-- D. rows: cells are checked against their column; only the Owner sets an amount; names are unique per list; limits
create function pg_temp.col(p_label text) returns text language sql as $$ select c.key from public.sell_list_columns c where c.tenant_id = tests.tid('a') and c.list_id = tests.rid('l2') and c.removed_at is null and c.label = p_label $$;
select is(pg_temp.at('a_admin', format($q$select public.sell_row_put(%L, %L, %L, 'Cotton', jsonb_build_object(%L, 45000))::text$q$, tests.tid('a'), tests.rid('l2'), tests.rid('r1'), pg_temp.col('Wholesale price'))), 'ERR:42501', 'D1: an Admin cannot set an amount');
select is(pg_temp.at('a_owner', format($q$select (public.sell_row_put(%L, %L, %L, 'Cotton', jsonb_build_object(%L, 45000, %L, 52000, %L, 'In stock', %L, 'Red'))) ->> 'created'$q$, tests.tid('a'), tests.rid('l2'), tests.rid('r1'), pg_temp.col('Wholesale price'), pg_temp.col('Retail price'), pg_temp.col('Stock'), pg_temp.col('Colour'))), 'true', 'D2: the Owner saves an item with two prices');
select is(pg_temp.at('a_admin', format($q$select (public.sell_row_put(%L, %L, %L, 'Cotton', jsonb_build_object(%L, 45000, %L, 52000, %L, 'Out', %L, 'Red'))) ->> 'created'$q$, tests.tid('a'), tests.rid('l2'), tests.rid('r1'), pg_temp.col('Wholesale price'), pg_temp.col('Retail price'), pg_temp.col('Stock'), pg_temp.col('Colour'))), 'false', 'D3: an Admin changes stock and keeps the amounts');
select is(pg_temp.at('a_admin', format($q$select public.sell_row_put(%L, %L, %L, 'Cotton', jsonb_build_object(%L, 99900))::text$q$, tests.tid('a'), tests.rid('l2'), tests.rid('r1'), pg_temp.col('Wholesale price'))), 'ERR:42501', 'D4: an Admin cannot change or drop an amount');
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Linen', jsonb_build_object(%L, 12.5))::text$q$, tests.tid('a'), tests.rid('l2'), tests.rid('r2'), pg_temp.col('Retail price'))), 'ERR:SM849', 'D5: a price must be whole paise');
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Linen', jsonb_build_object(%L, 'Sold'))::text$q$, tests.tid('a'), tests.rid('l2'), tests.rid('r2'), pg_temp.col('Stock'))), 'ERR:SM848', 'D6: a stock word that is not in the choices is refused');
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Linen', '{"nope": 1}'::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'), tests.rid('r2'))), 'ERR:22023', 'D7: a cell for a column the list does not have is invalid');
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'cotton', '{}'::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'), tests.rid('r2'))), 'ERR:SM844', 'D8: two items of a list with one name are name_taken');
select is(pg_temp.at('a_viewer', format($q$select (public.sell_row_list(%L, %L)) -> 'items' -> 0 ->> 'name'$q$, tests.tid('a'), tests.rid('l2'))), 'Cotton', 'D9: any member reads the rows');
select is(pg_temp.at('b_owner', format($q$select public.sell_row_list(%L, %L)::text$q$, tests.tid('a'), tests.rid('l2'))), 'ERR:42501', 'D10: another workspace cannot');
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Elsewhere', '{}'::jsonb)::text$q$, tests.tid('a'), tests.rid('l1'), tests.rid('r1'))), 'ERR:23503', 'D11: an item id that belongs to another list is not found');

-- E. removing a column that holds data needs a yes; the cells stay; a type change needs an empty column
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'),
  format('[{"key":%s,"label":"Retail price","type":"rupees","role":"price","quote_default":true}]', to_json(pg_temp.col('Retail price'))))), 'ERR:SM847', 'E1: dropping columns that hold data needs a yes');
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.sell_list_columns_put(%L, %L, %L::jsonb, true)) -> 'columns')::text$q$, tests.tid('a'), tests.rid('l2'),
  format('[{"key":%s,"label":"Retail price","type":"rupees","role":"price","quote_default":true}]', to_json(pg_temp.col('Retail price'))))), '1', 'E2: with the yes the other columns are hidden');
select is((select (cells ? 'wholesale_price')::text from public.sell_list_rows where id = tests.rid('r1')), 'true', 'E3: but the cells are kept');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l2'),
  format('[{"key":%s,"label":"Retail price","type":"number"}]', to_json(pg_temp.col('Retail price'))))), 'ERR:SM847', 'E4: a column that holds data keeps its type');

-- F. the main list and removing a list
select is(pg_temp.at('a_owner', format($q$select (public.sell_list_update(%L, %L, 'Dress materials', true)) ->> 'is_main'$q$, tests.tid('a'), tests.rid('l2'))), 'true', 'F1: another list can be made main');
select is((select count(*) from public.sell_lists where tenant_id = tests.tid('a') and is_main and removed_at is null)::int, 1, 'F2: still exactly one main');
select is(pg_temp.at('a_owner', format($q$select (public.sell_list_remove(%L, %L)) ->> 'removed'$q$, tests.tid('a'), tests.rid('l2'))), 'true', 'F3: the main list can be removed');
select is((select count(*) from public.sell_lists where tenant_id = tests.tid('a') and is_main and removed_at is null)::int, 1, 'F4: and the oldest remaining list becomes main');
select is((select count(*) from public.sell_list_rows where tenant_id = tests.tid('a') and list_id = tests.rid('l2') and removed_at is null)::int, 0, 'F5: its items go with it (soft)');

-- H. the kinds: digital, bookings, events carry their own default columns and roles
select is(pg_temp.at('a_owner', format($q$select (select string_agg(c ->> 'role', ',' order by c ->> 'role') from jsonb_array_elements((public.sell_list_create(%L, %L, 'E-books', 'digital')) -> 'columns') c where c ->> 'role' is not null)$q$, tests.tid('a'), tests.rid('l5'))), 'availability,description,how_to_buy,price', 'H1: a digital list has price, availability, how to buy and description');
select is(pg_temp.at('a_owner', format($q$select (select c ->> 'billing_period' from jsonb_array_elements((public.sell_list_get(%L, %L)) -> 'columns') c where c ->> 'role' = 'price')$q$, tests.tid('a'), tests.rid('l5'))), 'one_time', 'H2: its price is one-time');
select is(pg_temp.at('a_owner', format($q$select (public.sell_list_columns_put(%L, %L, %L::jsonb)) ->> 'id'$q$, tests.tid('a'), tests.rid('l5'),
  '[{"label":"Join","type":"rupees","role":"price","billing_period":"per_month"},{"label":"Starts","type":"date"},{"label":"Length","type":"duration"},{"label":"Link","type":"link","role":"how_to_buy"}]')), tests.rid('l5')::text, 'H3: a subscription-style price per month, a date, a duration and a link');
create function pg_temp.col5(p_label text) returns text language sql as $$ select c.key from public.sell_list_columns c where c.tenant_id = tests.tid('a') and c.list_id = tests.rid('l5') and c.removed_at is null and c.label = p_label $$;
select is(pg_temp.at('a_owner', format($q$select (public.sell_row_put(%L, %L, %L, 'Pro plan', jsonb_build_object(%L, 99900, %L, '2026-12-01', %L, 60, %L, 'https://example.test/buy'))) ->> 'created'$q$, tests.tid('a'), tests.rid('l5'), tests.rid('r5'), pg_temp.col5('Join'), pg_temp.col5('Starts'), pg_temp.col5('Length'), pg_temp.col5('Link'))), 'true', 'H4: date, duration and https link cells are accepted');
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Pro plan', jsonb_build_object(%L, '2026-13-45'))::text$q$, tests.tid('a'), tests.rid('l5'), tests.rid('r5'), pg_temp.col5('Starts'))), 'ERR:SM848', 'H5: an impossible date is refused');
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Pro plan', jsonb_build_object(%L, 'http://example.test/buy'))::text$q$, tests.tid('a'), tests.rid('l5'), tests.rid('r5'), pg_temp.col5('Link'))), 'ERR:SM848', 'H6: a link must be https');
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Pro plan', jsonb_build_object(%L, 0))::text$q$, tests.tid('a'), tests.rid('l5'), tests.rid('r5'), pg_temp.col5('Length'))), 'ERR:SM848', 'H7: a duration is at least one minute');

-- G. the catalog: tables are closed to direct writes
select is(pg_temp.at('a_owner', format($q$insert into public.sell_lists (id, tenant_id, name, kind, created_by) values (gen_random_uuid(), %L, 'Direct', 'other', %L)$q$, tests.tid('a'), tests.uid('a_owner'))), 'ERR:42501', 'G1: no direct insert');

select * from finish();
rollback;
