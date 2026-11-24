-- "Out of stock" as a catalogue stock state (migration 20261231990300).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(pg_temp.try(format($q$insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, stock_status, created_by) values (%L, %L, 'Sold out saree', 'soft_silk', array['red'], '5k_10k', 'out_of_stock', %L)$q$, tests.rid('oos1'), tests.tid('a'), tests.uid('a_owner'))), 'ok', 'A1: an item can be out of stock');
select is(pg_temp.try(format($q$update public.catalogue_items set stock_status = 'in_stock' where id = %L$q$, tests.rid('oos1'))), 'ok', 'A2: and back in stock');
select is(pg_temp.try(format($q$insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, stock_status, created_by) values (%L, %L, 'Odd saree', 'soft_silk', array['red'], '5k_10k', 'sold', %L)$q$, tests.rid('oos2'), tests.tid('a'), tests.uid('a_owner'))), 'ERR:23514', 'B1: another word is still refused');
select is((select position('out_of_stock' in pg_get_functiondef('public.catalogue_stock_apply(uuid, uuid, jsonb)'::regprocedure)) > 0), true, 'C1: the bulk stock function accepts the new word');

select * from finish();
rollback;
