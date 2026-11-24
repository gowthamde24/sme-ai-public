-- "What you sell" store for services, courses, properties and price lists (migration 20261231988100).  A who may write and who may set an amount  B retries, style, removed ids, closed keys, clean text
--   C the list and its paging, members only   D remove   E the first-run count
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.cp_pack('a', 'textiles');

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A: the Owner creates an entry with a price; the Admin one without; the Admin may not set or change an amount
select is(pg_temp.at('a_owner', format($$select (public.sell_entry_put(%L, 'services', %L, 'Haircut', '{"minutes": 30, "price_paise": 25000, "price_from": false, "booking": "any_day", "place": null}'::jsonb) ->> 'created')$$, tests.tid('a'), tests.rid('s1'))), 'true', 'A1: the Owner adds a service with a price');
select is(pg_temp.at('a_admin', format($$select (public.sell_entry_put(%L, 'services', %L, 'Facial', '{"minutes": 45, "price_paise": null, "price_from": false, "booking": "book_ahead", "place": "at_shop"}'::jsonb) ->> 'created')$$, tests.tid('a'), tests.rid('s2'))), 'true', 'A2: an Admin adds one without a price');
select is(pg_temp.at('a_admin', format($$select public.sell_entry_put(%L, 'services', %L, 'Facial', '{"minutes": 45, "price_paise": 40000, "price_from": false, "booking": "book_ahead", "place": "at_shop"}'::jsonb)::text$$, tests.tid('a'), tests.rid('s2'))), 'ERR:42501', 'A3: an Admin may not set a price');
select is(pg_temp.at('a_admin', format($$select public.sell_entry_put(%L, 'services', %L, 'Haircut', '{"minutes": 30, "price_paise": 99900, "price_from": false, "booking": "any_day", "place": null}'::jsonb)::text$$, tests.tid('a'), tests.rid('s1'))), 'ERR:42501', 'A4: nor change the Owner''s price');
select is(pg_temp.at('a_admin', format($$select (public.sell_entry_put(%L, 'services', %L, 'Haircut and wash', '{"minutes": 40, "price_paise": 25000, "price_from": false, "booking": "any_day", "place": null}'::jsonb) -> 'item' ->> 'name')$$, tests.tid('a'), tests.rid('s1'))), 'Haircut and wash', 'A5: but may change the other fields while the amount stays');
select is(pg_temp.at('a_owner', format($$select (public.sell_entry_put(%L, 'services', %L, 'Facial', '{"minutes": 45, "price_paise": 40000, "price_from": true, "booking": "book_ahead", "place": "at_shop"}'::jsonb) -> 'item' ->> 'price_paise')$$, tests.tid('a'), tests.rid('s2'))), '40000', 'A6: the Owner sets it later');
select is(pg_temp.at('a_viewer', format($$select public.sell_entry_put(%L, 'services', gen_random_uuid(), 'X', '{}'::jsonb)::text$$, tests.tid('a'))), 'ERR:42501', 'A7: a Viewer may not write');
select is(pg_temp.at('a_sales', format($$select public.sell_entry_put(%L, 'services', gen_random_uuid(), 'X', '{}'::jsonb)::text$$, tests.tid('a'))), 'ERR:42501', 'A8: nor Sales');
select is(pg_temp.at('b_owner', format($$select public.sell_entry_put(%L, 'services', gen_random_uuid(), 'X', '{}'::jsonb)::text$$, tests.tid('a'))), 'ERR:42501', 'A9: nor the Owner of another business');
select is(pg_temp.at('anon', format($$select public.sell_entry_put(%L, 'services', gen_random_uuid(), 'X', '{}'::jsonb)::text$$, tests.tid('a'))), 'ERR:42501', 'A10: nor somebody who is not signed in');

-- B: the same id again is a retry; the style cannot change; a removed id is not brought back; closed keys; clean text
select is(pg_temp.at('a_owner', format($$select (public.sell_entry_put(%L, 'services', %L, 'Haircut and wash', '{"minutes": 40, "price_paise": 25000, "price_from": false, "booking": "any_day", "place": null}'::jsonb) ->> 'created')$$, tests.tid('a'), tests.rid('s1'))), 'false', 'B1: the same id again is an update, not a second row');
select is((select count(*) from public.sell_entries where tenant_id = tests.tid('a') and id = tests.rid('s1')), 1::bigint, 'B2: one row');
select is(pg_temp.at('a_owner', format($$select public.sell_entry_put(%L, 'courses', %L, 'Haircut', '{}'::jsonb)::text$$, tests.tid('a'), tests.rid('s1'))), 'ERR:22023', 'B3: an entry cannot change its style');
select is(pg_temp.at('a_owner', format($$select public.sell_entry_put(%L, 'products', gen_random_uuid(), 'Saree', '{}'::jsonb)::text$$, tests.tid('a'))), 'ERR:22023', 'B4: products are not stored here (the catalogue has them)');
select is(pg_temp.at('a_owner', format($$select public.sell_entry_put(%L, 'services', gen_random_uuid(), 'Haircut', '{"secret_field": 1}'::jsonb)::text$$, tests.tid('a'))), 'ERR:22023', 'B5: a key the style does not have is refused');
select is(pg_temp.at('a_owner', format($$select public.sell_entry_put(%L, 'properties', gen_random_uuid(), 'Plot 12', '{"location": "Behind the temple", "size": 200, "size_unit": "sq_yd", "note": "Plot\u200b12", "price_paise": null, "status": "available"}'::jsonb)::text$$, tests.tid('a'))), 'ERR:22023', 'B6: an invisible character inside a note is refused');
select is(pg_temp.at('a_owner', format($$select public.sell_entry_put(%L, 'services', gen_random_uuid(), '   ', '{}'::jsonb)::text$$, tests.tid('a'))), 'ERR:22023', 'B7: an empty name is refused');
select is(pg_temp.at('a_owner', format($$select (public.sell_entry_put(%L, 'pricelist', %L, 'Plain bag', '{"moq": 10, "unit": "piece", "rates": [{"from_qty": 10, "rate_paise": 9000}, {"from_qty": 100, "rate_paise": 8000}], "good_until": null}'::jsonb) ->> 'created')$$, tests.tid('a'), tests.rid('p1'))), 'true', 'B8: a price list entry with two rates');
select is(pg_temp.at('a_admin', format($$select public.sell_entry_put(%L, 'pricelist', %L, 'Plain bag', '{"moq": 10, "unit": "piece", "rates": [{"from_qty": 10, "rate_paise": 9000}, {"from_qty": 100, "rate_paise": 7000}], "good_until": null}'::jsonb)::text$$, tests.tid('a'), tests.rid('p1'))), 'ERR:42501', 'B9: an Admin may not change a rate either');
select is(pg_temp.at('a_owner', format($$select (public.sell_entry_put(%L, 'courses', %L, 'Spoken English', '{"batch": "Morning", "starts_on": "2026-12-10", "fee_paise": 150000, "seats": {"state": "left", "count": 4}, "total": 20, "description": null}'::jsonb) ->> 'created')$$, tests.tid('a'), tests.rid('c1'))), 'true', 'B10: a course');

-- C: the list
select is(pg_temp.at('a_viewer', format($$select jsonb_array_length(public.sell_entry_list(%L, 'services') -> 'items')::text$$, tests.tid('a'))), '2', 'C1: a Viewer reads the two services');
select is(pg_temp.at('a_viewer', format($$select (public.sell_entry_list(%L, 'courses') -> 'items' -> 0 ->> 'name')$$, tests.tid('a'))), 'Spoken English', 'C2: the course list holds only courses, in the wire shape (name next to the fields)');
select is(pg_temp.at('a_viewer', format($$select (public.sell_entry_list(%L, 'services') ->> 'style')$$, tests.tid('a'))), 'services', 'C3: the answer names the style');
select is(pg_temp.at('b_owner', format($$select public.sell_entry_list(%L, 'services')::text$$, tests.tid('a'))), 'ERR:42501', 'C4: another business reads nothing of ours');
select is(pg_temp.at('a_owner', format($$select public.sell_entry_list(%L, 'nonsense')::text$$, tests.tid('a'))), 'ERR:22023', 'C5: an unknown style is invalid');
select is(pg_temp.at('a_owner', format($$select (public.sell_entry_list(%L, 'services', 1) ->> 'next_cursor') is not null$$, tests.tid('a'))), 'true', 'C6: with a page of one there is a next cursor');
select is(pg_temp.at('a_owner', format($$select jsonb_array_length(public.sell_entry_list(%L, 'services', 1, (public.sell_entry_list(%L, 'services', 1) ->> 'next_cursor')) -> 'items')::text$$, tests.tid('a'), tests.tid('a'))), '1', 'C7: the next page holds the other one');

-- D: remove
select is(pg_temp.at('a_admin', format($$select (public.sell_entry_remove(%L, 'services', %L) ->> 'removed')$$, tests.tid('a'), tests.rid('s2'))), 'true', 'D1: an Admin removes an entry');
select is(pg_temp.at('a_admin', format($$select (public.sell_entry_remove(%L, 'services', %L) ->> 'removed')$$, tests.tid('a'), tests.rid('s2'))), 'true', 'D2: removing it again is fine');
select is(pg_temp.at('a_viewer', format($$select jsonb_array_length(public.sell_entry_list(%L, 'services') -> 'items')::text$$, tests.tid('a'))), '1', 'D3: it is gone from the list');
select is(pg_temp.at('a_owner', format($$select public.sell_entry_put(%L, 'services', %L, 'Facial', '{}'::jsonb)::text$$, tests.tid('a'), tests.rid('s2'))), 'ERR:23503', 'D4: a removed id is not brought back');
select is(pg_temp.at('a_owner', format($$select public.sell_entry_remove(%L, 'courses', %L)::text$$, tests.tid('a'), tests.rid('s1'))), 'ERR:23503', 'D5: removing under the wrong style finds nothing');
select is(pg_temp.at('a_viewer', format($$select public.sell_entry_remove(%L, 'services', %L)::text$$, tests.tid('a'), tests.rid('s1'))), 'ERR:42501', 'D6: a Viewer may not remove');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action in ('sell_entry.create', 'sell_entry.update')), 8::bigint, 'D7: every change is in the audit log (4 creates, 3 updates and the remove, which is an update)');

-- E: the first-run count
select is(pg_temp.at('a_owner', format($$select (public.first_run_facts(%L) ->> 'items_count')$$, tests.tid('a'))), '3', 'E1: the first-run count holds the entries that are not removed (service, price list, course)');

select * from finish();
rollback;
