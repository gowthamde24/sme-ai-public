-- Where the phone assistant's prices come from (migration 20261231989300): the price list, the catalogue's exact price and "what you sell" entries; only exact amounts.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.names(p_tenant text) returns text language sql as $$
  select coalesce(string_agg((e ->> 'name') || '=' || (e ->> 'paise'), ',' order by e ->> 'name', (e ->> 'paise')::bigint), '') from jsonb_array_elements(app.phone_exact_prices(tests.tid(p_tenant), 100)) e $$;

select is(pg_temp.names('a'), '', 'A1: nothing priced: nothing');

set local session_replication_role = replica;
insert into public.catalogue_items (id, tenant_id, name, fabric, price_band, price_paise, stock_status, active, created_by, colours) values
  (tests.rid('p_c1'), tests.tid('a'), 'Kanchi red', 'kanchi_pattu', '10k_25k', 1250000, 'in_stock', true, tests.uid('a_owner'), array['red']),
  (tests.rid('p_c2'), tests.tid('a'), 'No price saree', 'pure_cotton', 'under_5k', null, 'in_stock', true, tests.uid('a_owner'), array['blue']),
  (tests.rid('p_c3'), tests.tid('a'), 'Hidden saree', 'pure_cotton', 'under_5k', 99900, 'in_stock', false, tests.uid('a_owner'), array['blue']),
  (tests.rid('p_c4'), tests.tid('b'), 'Other workspace saree', 'pure_cotton', 'under_5k', 55500, 'in_stock', true, tests.uid('b_owner'), array['blue']);
select is(pg_temp.names('a'), 'Kanchi red=1250000', 'B1: an active catalogue item with an exact price counts; no price, inactive and another workspace do not');

insert into public.sell_entries (id, tenant_id, style, name, data, created_by) values
  (tests.rid('p_s1'), tests.tid('a'), 'services', 'Fall and pico', '{"price_paise": 15000, "price_from": false}', tests.uid('a_owner')),
  (tests.rid('p_s2'), tests.tid('a'), 'services', 'Stitching from', '{"price_paise": 60000, "price_from": true}', tests.uid('a_owner')),
  (tests.rid('p_s3'), tests.tid('a'), 'courses', 'Blouse class', '{"fee_paise": 200000, "batch": "", "seats": {"state": "open"}}', tests.uid('a_owner')),
  (tests.rid('p_s4'), tests.tid('a'), 'pricelist', 'Handloom cotton', '{"moq": 10, "unit": "piece", "rates": [{"from_qty": 10, "rate_paise": 90000}, {"from_qty": 50, "rate_paise": 80000}], "good_until": null}', tests.uid('a_owner')),
  (tests.rid('p_s5'), tests.tid('a'), 'pricelist', 'Expired list', '{"moq": 1, "unit": "piece", "rates": [{"from_qty": 1, "rate_paise": 70000}], "good_until": "2020-01-01"}', tests.uid('a_owner'));
select is(pg_temp.names('a'), 'Blouse class=200000,Fall and pico=15000,Handloom cotton=80000,Handloom cotton=90000,Kanchi red=1250000', 'C1: service and course exact prices and both price-list tiers count; a "from" price and an expired list do not');
update public.sell_entries set removed_at = now() where id = tests.rid('p_s1');
select is(pg_temp.names('a') like '%Fall and pico%', false, 'C2: a removed entry is gone');
reset session_replication_role;

select is(tests.scalar_as(tests.uid('a_owner'), format($q$select (public.phone_assistant_knows(%L) ->> 'price_rows')$q$, tests.tid('a'))), '4', 'D1: the readiness count uses all sources (4 rows now)');
select is(tests.scalar_as(tests.uid('b_owner'), format($q$select (public.phone_assistant_knows(%L) ->> 'price_rows')$q$, tests.tid('b'))), '1', 'D2: and another workspace has its own one');

select * from finish();
rollback;
