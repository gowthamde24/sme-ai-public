-- Today "Needs you": a workspace with a phone line and no price list (migration 20261231989000). Owner and Admin see it; Sales and other workspaces do not; the first price row makes it go.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.has_item(p_user text, p_tenant text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format($q$select exists (select 1 from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') e where e ->> 'kind' = 'phone_needs_prices' and e -> 'target' ->> 'type' = 'price_list')::text$q$, tests.tid(p_tenant)));
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(pg_temp.has_item('a_owner', 'a'), 'false', 'A1: no phone line yet: nothing to say');

set local session_replication_role = replica;
insert into public.phone_numbers (id, tenant_id, number, label) values (tests.rid('a_pn_x'), tests.tid('a'), '+919000000771', 'Shop line');
reset session_replication_role;

select is(pg_temp.has_item('a_owner', 'a'), 'true', 'B1: a phone line and no price list: the Owner sees it');
select is(pg_temp.has_item('a_admin', 'a'), 'true', 'B2: the Admin too');
select is(pg_temp.has_item('a_sales', 'a'), 'false', 'B3: Sales does not');
select is(pg_temp.has_item('b_owner', 'b'), 'false', 'B4: another workspace without a line does not');
select is(pg_temp.has_item('b_owner', 'a'), 'ERR:42501', 'B5: and cannot ask about workspace A');

set local session_replication_role = replica;
insert into public.price_lists (id, tenant_id, name) values (tests.rid('a_pl'), tests.tid('a'), 'Fixture price list');
insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256) values (tests.rid('a_plv'), tests.tid('a'), tests.rid('a_pl'), 1, current_date, 1, repeat('0', 64));
insert into public.price_list_items (id, tenant_id, version_id, product_id, sku, name, unit_price_paise, minimum_order_quantity, tax_bps) values (tests.rid('a_pli'), tests.tid('a'), tests.rid('a_plv'), tests.rid('a_product'), 'SKU-1', 'Silk saree', 100000, 1, 500);
reset session_replication_role;
select is(pg_temp.has_item('a_owner', 'a'), 'false', 'C1: the first price row and the item is gone');

select * from finish();
rollback;
