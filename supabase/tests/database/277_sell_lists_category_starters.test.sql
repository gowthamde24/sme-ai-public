-- "What you sell" lists, round 2 (migration 20261231992710): the column role `category` (a choice, one per list, read into the phone pack and the phone prices), the trial cap of 8, and the starter lists of the textiles pack.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.w(p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid('outsider'), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A. the role
select pg_temp.at('a_owner', format($q$select public.sell_list_create(%L, %L, 'Blouses', 'products')::text$q$, tests.tid('a'), tests.rid('l1')));
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.sell_list_columns_put(%L, %L, %L::jsonb)) -> 'columns')::text$q$, tests.tid('a'), tests.rid('l1'),
  '[{"label":"Price","type":"rupees","role":"price"},{"label":"Category","type":"choice","choices":["Ready-made","Blouse piece"],"role":"category"}]')), '2', 'A1: a category column (a choice) is accepted');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l1'),
  '[{"label":"Category","type":"text","role":"category"}]')), 'ERR:22023', 'A2: a category must be a choice column');
select is(pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l1'),
  '[{"label":"C1","type":"choice","choices":["a"],"role":"category"},{"label":"C2","type":"choice","choices":["b"],"role":"category"}]')), 'ERR:SM846', 'A3: two category columns are refused (role_taken)');
select pg_temp.at('a_owner', format($q$select public.sell_list_columns_put(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid('l1'),
  '[{"label":"Retail price","type":"rupees","role":"price","quote_default":true},{"label":"Category","type":"choice","choices":["Ready-made","Blouse piece"],"role":"category"},{"label":"Stock","type":"choice","choices":["In stock","Out"],"role":"availability"}]'));
create function pg_temp.k(p text) returns text language sql as $$ select c.key from public.sell_list_columns c where c.tenant_id = tests.tid('a') and c.list_id = tests.rid('l1') and c.removed_at is null and c.label = p $$;
select pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Silk piece', jsonb_build_object(%L, 45000, %L, 'Blouse piece'))::text$q$, tests.tid('a'), tests.rid('l1'), tests.rid('r1'), pg_temp.k('Retail price'), pg_temp.k('Category')));
select is(pg_temp.at('a_owner', format($q$select public.sell_row_put(%L, %L, %L, 'Bad', jsonb_build_object(%L, 'Saree'))::text$q$, tests.tid('a'), tests.rid('l1'), tests.rid('r2'), pg_temp.k('Category'))), 'ERR:SM848', 'A4: a category cell must be one of the column''s words');

-- B. readers: the category word travels with the item
select is((select e ->> 'name' from jsonb_array_elements(app.phone_exact_prices(tests.tid('a'), 100)) e where e ->> 'label' is not null), 'Silk piece (Blouse piece)', 'B1: a price line names the item with its category word');
select is(pg_temp.w(format($q$select ((public.phone_fact_pack(%L)) -> 'items' -> 0 ->> 'name') || '/' || ((public.phone_fact_pack(%L)) -> 'items' -> 0 ->> 'category')$q$, tests.tid('a'), tests.tid('a'))), 'Silk piece/Blouse piece', 'B2: the pack carries the item''s category');
select is(pg_temp.w(format($q$select jsonb_array_length((public.phone_fact_pack(%L)) -> 'items')::text$q$, tests.tid('b'))), '0', 'B3: and none of another workspace''s');

-- C. the starters
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.sell_lists_starters_make(%L)) -> 'created')::text$q$, tests.tid('b'))), 'ERR:42501', 'C1: another workspace''s Owner cannot make this one''s starters');
select is(pg_temp.at('a_sales', format($q$select public.sell_lists_starters_make(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C2: Sales cannot');
update packs.workspace_pack set pack_code = 'general_business', pack_version = (select max(v.version) from packs.pack_versions v where v.code = 'general_business') where tenant_id = tests.tid('a');
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.sell_lists_starters_make(%L)) -> 'created')::text$q$, tests.tid('a'))), '0', 'C3: a workspace whose pack has no starters gets none');
update packs.workspace_pack set pack_code = 'textiles', pack_version = (select max(v.version) from packs.pack_versions v where v.code = 'textiles') where tenant_id = tests.tid('a');
-- tenant a holds 1 list now (Blouses); the trial cap is 8: Sarees, Dress materials, Dupattas, Fabric by the metre, Stitching and alterations fit (5 new, Blouses already there)
select is(pg_temp.at('a_owner', format($q$select (public.sell_lists_starters_make(%L)) ->> 'created'$q$, tests.tid('a'))), '["Sarees", "Dress materials", "Dupattas", "Fabric by the metre", "Stitching and alterations"]', 'C4: only the missing starters are made, in order');
select is(pg_temp.at('a_owner', format($q$select (public.sell_lists_starters_make(%L)) ->> 'already_there'$q$, tests.tid('a'))), '["Sarees", "Dress materials", "Blouses", "Dupattas", "Fabric by the metre", "Stitching and alterations"]', 'C5: a second call makes nothing twice');
select is((select count(*)::int from public.sell_lists where tenant_id = tests.tid('a') and removed_at is null), 6, 'C6: six lists in all');
select is((select count(*)::int from public.sell_list_columns c join public.sell_lists l on l.id = c.list_id where c.tenant_id = tests.tid('a') and l.name = 'Sarees' and c.removed_at is null and c.role = 'category'), 1, 'C7: a starter has its category column');
select is((select c.billing_period from public.sell_list_columns c join public.sell_lists l on l.id = c.list_id where c.tenant_id = tests.tid('a') and l.name = 'Fabric by the metre' and c.removed_at is null and c.role = 'price'), 'per_unit', 'C8: fabric by the metre is priced per unit');
select is((select l.kind from public.sell_lists l where l.tenant_id = tests.tid('a') and l.name = 'Stitching and alterations'), 'services', 'C9: stitching is a services list');
select is((select count(*)::int from public.sell_lists where tenant_id = tests.tid('a') and removed_at is null and is_main), 1, 'C10: exactly one list is main');
-- the cap: a workspace with 8 lists gets the rest named as skipped, not an error
select pg_temp.at('a_owner', format($q$select count(*)::text from (select public.sell_list_create(%L, gen_random_uuid(), 'Extra ' || g, 'other') from generate_series(1, 2) g) x$q$, tests.tid('a')));
update public.sell_lists set removed_at = now() where tenant_id = tests.tid('a') and name in ('Sarees', 'Dupattas');
select is(pg_temp.at('a_owner', format($q$select (public.sell_lists_starters_make(%L)) ->> 'skipped_cap'$q$, tests.tid('a'))), '[]', 'C11: room for the two removed ones, nothing skipped');
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.sell_lists_starters_make(%L)) -> 'skipped_cap')::text$q$, tests.tid('a'))), '0', 'C12: and nothing more to make');
update public.sell_lists set removed_at = now() where tenant_id = tests.tid('a') and name in ('Blouses', 'Dress materials');
select pg_temp.at('a_owner', format($q$select count(*)::text from (select public.sell_list_create(%L, gen_random_uuid(), 'More ' || g, 'other') from generate_series(1, 2) g) x$q$, tests.tid('a')));
select is(pg_temp.at('a_owner', format($q$select (public.sell_lists_starters_make(%L)) ->> 'skipped_cap'$q$, tests.tid('a'))), '["Dress materials", "Blouses"]', 'C12b: a full workspace (8 lists) gets the starters it has no room for named as skipped, not an error');
select is((select count(*)::int from public.sell_list_starters where pack_code = 'textiles'), 6, 'C13: the textiles pack has six starters');
select is(has_table_privilege('authenticated', 'public.sell_list_starters', 'select'), false, 'C14: the starters table is not readable by a member (the function reads it)');

select * from finish();
rollback;
