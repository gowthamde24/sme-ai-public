-- Job CN (ADR 0085), part 1: the building-materials CATALOGUE, customer SITES and the REQUIREMENT fields.
--   A module default-deny: every function of the new modules is refused (SM701) for a business whose pack does not list the module, and works for the construction pack; textiles is unchanged
--   B the catalogue item kinds: a material is not a saree, the table and the functions say so    C the item's specs (the pack's custom fields) as exact integers, never assumed
--   D sites: who, what, limits, cross-tenant, never deleted         E requirement fields of an enquiry: keys per business, shapes, the confirm rule
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');  -- tenant A runs the building-materials pack; tenant B keeps the default pack (textiles)

create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.sqlstate_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  return r;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.item(p_user text, p_tenant text, p_id uuid, p_name text, p_unit text, p_area text default null, p_active boolean default false, p_price text default 'null', p_change boolean default false) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.catalogue_material_save(%L, %L, %L, %L, %L, 'in_stock', %L, %s, %L)$q$, p_id, tests.tid(p_tenant), p_name, p_unit, p_area, p_active, p_price, p_change))
$$;
create function pg_temp.site(p_user text, p_tenant text, p_id uuid, p_company uuid, p_name text, p_extra text default 'null, null, null, null, null, null, null, false, false, null, null, true') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.site_save(%L, %L, %L, %L, %s)$q$, p_id, tests.tid(p_tenant), p_company, p_name, p_extra))
$$;

-- ============================================================================ A. module default-deny
select is(app.module_enabled(tests.tid('a'), 'materials'), true, 'A1 construction: the materials module is on');
select is(app.module_enabled(tests.tid('a'), 'sites') and app.module_enabled(tests.tid('a'), 'deliveries') and app.module_enabled(tests.tid('a'), 'dues'), true, 'A2 and so are sites, deliveries and dues');
select is(app.module_enabled(tests.tid('b'), 'materials') or app.module_enabled(tests.tid('b'), 'sites') or app.module_enabled(tests.tid('b'), 'deliveries') or app.module_enabled(tests.tid('b'), 'dues'), false, 'A3 textiles: none of the four is on (default-deny)');
select is((select count(*) from packs.modules where code in ('sites', 'deliveries', 'dues', 'materials') and guard = 'tables'), 4::bigint, 'A4 the four modules now own tables (guard kind tables)');
select is((select count(*) from packs.workspace_pack where pack_code = 'construction_materials' and pack_version = 1), 0::bigint, 'A5 no business is left on construction pack version 1 (the migration moved them to 2)');
select is(pg_temp.item('b_owner', 'b', tests.rid('b_mat'), 'Paver', 'sq_ft'), 'SM701', 'A6 textiles: a material item cannot be saved (SM701)');
select is(pg_temp.sc(format($$insert into public.catalogue_items (id, tenant_id, name, item_kind, sell_unit, area_unit, created_by) values (gen_random_uuid(), %L, 'Direct', 'material', 'bag', null, %L)$$, tests.tid('b'), tests.uid('b_owner'))), 'SM701', 'A7 nor inserted by any other road (the trigger, SM701)');
select is(pg_temp.site('b_owner', 'b', tests.rid('b_site'), tests.rid('b_company'), 'A site'), 'SM701', 'A8 textiles: a site cannot be saved');
select is(pg_temp.sc(format($$insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values (gen_random_uuid(), %L, 'Saree', 'soft_silk', array['red'], '5k_10k', %L)$$, tests.tid('b'), tests.uid('b_owner'))), 'ok', 'A9 textiles can still make a saree: nothing it does today changed');

-- ============================================================================ B. the catalogue item kinds
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat'), 'Paver block 80 mm grey', 'sq_ft'), 'ok', 'B1 ALLOW: the Owner makes a material item sold per sq ft');
select is((select item_kind || ':' || sell_unit || ':' || area_unit || ':' || active::text from public.catalogue_items where id = tests.rid('a_mat')), 'material:sq_ft:sq_ft:false', 'B2 an item sold by the area counts its coverage in the same unit; it starts inactive');
select is(pg_temp.item('a_admin', 'a', tests.rid('a_mat2'), 'Cement 53 grade bag', 'bag'), 'ok', 'B3 ALLOW: the Admin makes one sold by the bag');
select is((select coalesce(area_unit, 'none') from public.catalogue_items where id = tests.rid('a_mat2')), 'none', 'B4 a bag has no coverage unit');
select is(pg_temp.item('a_sales', 'a', tests.rid('a_mat3'), 'By sales', 'bag'), '42501', 'B5 DENY: Sales');
select is(pg_temp.item('a_viewer', 'a', tests.rid('a_mat3'), 'By viewer', 'bag'), '42501', 'B6 DENY: Viewer');
select is(pg_temp.item('b_owner', 'a', tests.rid('a_mat3'), 'By B', 'bag'), '42501', 'B7 DENY: another business''s Owner');
select is(pg_temp.item('outsider', 'a', tests.rid('a_mat3'), 'By out', 'bag'), '42501', 'B8 DENY: an outsider');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat3'), 'Odd unit', 'furlong'), '22023', 'B9 a unit outside the closed list is invalid');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat3'), 'A set', 'set'), '22023', 'B10 `set` is a saree unit: not a material one');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat3'), 'Wrong coverage', 'sq_ft', 'sq_m'), '22023', 'B11 sold per sq ft but counted in sq m: invalid');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat3'), 'Piece with coverage', 'piece', 'sq_m'), 'ok', 'B12 sold by the piece with its coverage counted in sq m is fine');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat'), 'Paver block 80 mm grey', 'sq_ft'), 'ok', 'B13 an exact repeat of a save is fine (the same id)');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat'), 'Renamed', 'sq_ft'), 'ok', 'B14 and a change of the name too');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat'), 'Paver block 80 mm grey', 'sq_ft', null, true), 'SM521', 'B15 an item cannot be made active without a photo (SM521)');
select is(pg_temp.item('a_owner', 'a', tests.rid('b_mat_taken'), 'Id of another business', 'bag'), 'ok', 'B16 a new id is just a new item');
select is(pg_temp.sc(format($$update public.catalogue_items set item_kind = 'saree' where id = %L$$, tests.rid('a_mat'))), '42501', 'B17 the kind of an item never changes');
select is(pg_temp.sc(format($$insert into public.catalogue_items (id, tenant_id, name, item_kind, fabric, colours, price_band, sell_unit, created_by) values (gen_random_uuid(), %L, 'Mixed', 'material', 'soft_silk', array['red'], '5k_10k', 'bag', %L)$$, tests.tid('a'), tests.uid('a_owner'))), '23514', 'B18 a material cannot carry saree columns (CHECK)');
select is(pg_temp.sc(format($$insert into public.catalogue_items (id, tenant_id, name, item_kind, created_by) values (gen_random_uuid(), %L, 'Saree without fabric', 'saree', %L)$$, tests.tid('a'), tests.uid('a_owner'))), '23514', 'B19 a saree must still have its fabric, colours and price band (CHECK)');
select is(pg_temp.val('a_owner', format($$select public.catalogue_item_save(%L, %L, 'Back to silk', 'soft_silk', array['red'], 'none', null, array[]::text[], '5k_10k', 'in_stock', false, null, false)::text$$, tests.rid('a_mat'), tests.tid('a'))), 'ERR:22023', 'B20 the saree save function cannot turn a material into a saree (invalid)');
-- price: the Owner's, with a second factor
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat'), 'Paver block 80 mm grey', 'sq_ft', null, false, '6500', true), 'ok', 'B21 ALLOW: the Owner sets the price per sq ft (Rs 65) at aal2');
select is(pg_temp.at('aal1', 'a_owner', format($$select public.catalogue_material_save(%L, %L, 'Paver block 80 mm grey', 'sq_ft', null, 'in_stock', false, 7000, true)$$, tests.rid('a_mat'), tests.tid('a'))), 'SM306', 'B22 DENY: the Owner without a second factor (SM306)');
select is(pg_temp.item('a_admin', 'a', tests.rid('a_mat'), 'Paver block 80 mm grey', 'sq_ft', null, false, '7000', true), '42501', 'B23 DENY: the Admin cannot change a price');
select is((select price_paise from public.catalogue_items where id = tests.rid('a_mat')), 6500::bigint, 'B24 and the price is what the Owner set');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat'), 'Paver block 80 mm grey', 'sq_ft', null, false, '50', true), '22023', 'B25 a price below Re 1 is invalid');
select is(pg_temp.item('a_owner', 'a', tests.rid('a_mat'), 'Renamed again', 'sq_ft'), 'ok', 'B26 a save that does not touch the price keeps it');
select is((select price_paise from public.catalogue_items where id = tests.rid('a_mat')), 6500::bigint, 'B27 (kept)');
select is(pg_temp.val('a_viewer', format($$select (public.catalogue_search(%L, null, null, null, null, false, true, 20, null, null, null, 'material'))::text$$, tests.tid('a'))), '[]', 'B28 the search shows a Viewer no inactive item');
select is(pg_temp.val('a_owner', format($$select jsonb_array_length(public.catalogue_search(%L, null, null, null, null, false, true, 20, null, null, null, 'material'))::text$$, tests.tid('a'))), '4', 'B29 the Owner sees the four inactive materials when asking for them');
select is(pg_temp.val('a_owner', format($$select jsonb_array_length(public.catalogue_search(%L, null, null, null, null, false, true, 20, null, null, null, 'saree'))::text$$, tests.tid('a'))), '0', 'B30 a kind filter keeps the kinds apart');
select is(pg_temp.val('a_owner', format($$select (public.catalogue_get(%L, %L) ->> 'item_kind') || ':' || (public.catalogue_get(%L, %L) ->> 'sell_unit')$$, tests.tid('a'), tests.rid('a_mat'), tests.tid('a'), tests.rid('a_mat'))), 'material:sq_ft', 'B31 the reader says what kind an item is and how it is sold');

-- ============================================================================ C. the specs: the pack's custom fields, as exact integers, never assumed
select is((select count(*) from public.custom_field_defs where tenant_id = tests.tid('a') and entity = 'catalogue_item' and code in ('pieces_per_area', 'pieces_per_pallet', 'minimum_order', 'gst_rate_percent', 'hsn_code', 'thickness_mm', 'product_type')), 7::bigint, 'C1 the pack gave the business its product spec fields');
select is(pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"pieces_per_area": 4.5, "pieces_per_pallet": 500, "gst_rate_percent": 18, "hsn_code": "68101990", "minimum_order": 200}'::jsonb)$$, tests.tid('a'), tests.rid('a_mat'))), 'ok', 'C2 ALLOW: the Owner enters the specs of the paver (4.5 pieces per sq ft, 500 per pallet, GST 18 %)');
select is(app.cq_spec_int(tests.tid('a'), tests.rid('a_mat'), 'pieces_per_area', 1000, 1, 1000000, 'pieces_per_area'), 4500::bigint, 'C3 4.5 pieces per sq ft is 4500 thousandths');
select is(app.cq_spec_int(tests.tid('a'), tests.rid('a_mat'), 'gst_rate_percent', 100, 0, 10000, 'gst_rate'), 1800::bigint, 'C4 GST 18 % is 1800 basis points');
select is(app.cq_spec_int(tests.tid('a'), tests.rid('a_mat'), 'pieces_per_pallet', 1, 1, 10000000, null), 500::bigint, 'C5 500 pieces per pallet');
select is(pg_temp.sc(format($$select app.cq_spec_int(%L, %L, 'pieces_per_area', 1, 1, 1000000, 'pieces_per_area')$$, tests.tid('a'), tests.rid('a_mat'))), 'SM762', 'C6 a number that is not whole at the scale asked is refused (SM762), never rounded');
select is(pg_temp.sc(format($$select app.cq_spec_int(%L, %L, 'gst_rate_percent', 100, 0, 10000, 'gst_rate')$$, tests.tid('a'), tests.rid('a_mat2'))), 'SM762', 'C7 an item with no GST rate entered is refused: the rate is never assumed (SM762)');
select is(app.cq_spec_int(tests.tid('a'), tests.rid('a_mat2'), 'pieces_per_pallet', 1, 1, 10000000, null), null::bigint, 'C8 an optional spec that is absent is null');
select is(pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"gst_rate_percent": 18.25}'::jsonb)$$, tests.tid('a'), tests.rid('a_mat2'))), 'ok', 'C9 a rate with a fraction can be entered (GST 18.25 %)');
select is(app.cq_spec_int(tests.tid('a'), tests.rid('a_mat2'), 'gst_rate_percent', 100, 0, 10000, 'gst_rate'), 1825::bigint, 'C10 and is 1825 basis points');
select is(pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"gst_rate_percent": 18.256}'::jsonb)$$, tests.tid('a'), tests.rid('a_mat2'))), 'ok', 'C11 a rate finer than a basis point can be typed ...');
select is(pg_temp.sc(format($$select app.cq_spec_int(%L, %L, 'gst_rate_percent', 100, 0, 10000, 'gst_rate')$$, tests.tid('a'), tests.rid('a_mat2'))), 'SM762', 'C12 ... but a quote refuses it (SM762)');

-- ============================================================================ D. sites
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site1'), tests.rid('a_company'), 'Banjara Hills villa', $$'Road no. 12', 'Hyderabad', '500034', 17.412345, 78.434567, 12, 14, false, true, 'Night delivery not allowed', null, true$$), 'ok', 'D1 ALLOW: the Owner records a site');
select is(pg_temp.site('a_sales', 'a', tests.rid('a_site2'), tests.rid('a_company'), 'Kukatpally yard'), 'ok', 'D2 ALLOW: Sales records one too');
select is(pg_temp.site('a_viewer', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'By viewer'), '42501', 'D3 DENY: a Viewer');
select is(pg_temp.site('b_owner', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'By B'), '42501', 'D4 DENY: another business');
select is(pg_temp.site('anon', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'By anon'), '42501', 'D5 DENY: anon');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), tests.rid('b_company'), 'Customer of B'), '23503', 'D6 a customer of another business is not found (the same refusal as an unknown id)');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), gen_random_uuid(), 'Unknown customer'), '23503', 'D7 ... exactly like an unknown id');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'Contact of B', $$null, null, null, null, null, null, null, false, false, null, '$$ || tests.rid('b_contact') || $$'::uuid, true$$), 'SM751', 'D8 a site contact of another business is refused (SM751)');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'Bad pin', $$null, null, '12345', null, null, null, null, false, false, null, null, true$$), '22023', 'D9 a PIN is six digits');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'Half a pin', $$null, null, null, 17.4, null, null, null, false, false, null, null, true$$), '22023', 'D10 a map pin is both numbers or neither');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'Far pin', $$null, null, null, 91, 78, null, null, false, false, null, null, true$$), '22023', 'D11 latitude is within 90');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'Phone in notes', $$null, null, null, null, null, null, null, false, false, 'Ask for Ravi on 9876543210', null, true$$), '22023', 'D12 a phone number does not belong in free text: it is a contact (invalid)');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'Far away', $$null, null, null, null, null, 6000, null, false, false, null, null, true$$), '22023', 'D13 a distance over 5,000 km is invalid');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site3'), tests.rid('a_company'), 'Wide lane', $$null, null, null, null, null, null, 500, false, false, null, null, true$$), '22023', 'D14 a lane width over 100 ft is invalid');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site1'), tests.rid('a_company'), 'Banjara Hills villa', $$'Road no. 12', 'Hyderabad', '500034', 17.412345, 78.434567, 12, 14, false, true, 'Night delivery not allowed', null, true$$), 'ok', 'D15 an exact repeat replays');
select is(pg_temp.val('a_owner', format($$select (public.site_save(%L, %L, %L, 'Banjara Hills villa', 'Road no. 12', 'Hyderabad', '500034', 17.412345, 78.434567, 12, 14, false, true, 'Night delivery not allowed', %L, true)->>'created')$$, tests.rid('a_site1'), tests.tid('a'), tests.rid('a_company'), tests.rid('a_contact'))), 'false', 'D16 a change (the site contact) is an update, not a second site');
select is((select site_contact_id from public.customer_sites where id = tests.rid('a_site1')), tests.rid('a_contact'), 'D17 the site contact is a contact of the business (so consent, suppression and quiet hours apply to the messages)');
insert into public.companies (id, tenant_id, name) values (tests.rid('a_company2'), tests.tid('a'), 'Another customer');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site1'), tests.rid('a_company2'), 'Banjara Hills villa'), '23505', 'D18 a site never moves to another customer (the id is already used for another site)');
select is(pg_temp.val('a_viewer', format($$select jsonb_array_length(public.sites_list(%L, %L))::text$$, tests.tid('a'), tests.rid('a_company'))), '2', 'D19 every member reads the sites of a customer');
select is(pg_temp.val('b_owner', format($$select jsonb_array_length(public.sites_list(%L))::text$$, tests.tid('b'))), '0', 'D20 another business sees none of them');
select is(pg_temp.val('b_owner', format($$select public.site_get(%L, %L)::text$$, tests.tid('b'), tests.rid('a_site1'))), 'ERR:23503', 'D21 and cannot read one by its id');
select is(pg_temp.try('a_owner', $$delete from public.customer_sites$$), '42501', 'D22 DENY: a client cannot delete a site');
select is(pg_temp.sc($$delete from public.customer_sites$$), '42501', 'D23 nor any session: a site is made inactive, never deleted');
select is(pg_temp.try('a_owner', format($$update public.customer_sites set name = 'x' where id = %L$$, tests.rid('a_site1'))), '42501', 'D24 DENY: nor update one directly');
select is(pg_temp.site('a_owner', 'a', tests.rid('a_site2'), tests.rid('a_company'), 'Kukatpally yard', $$null, null, null, null, null, null, null, false, false, null, null, false$$), 'ok', 'D25 a site is made inactive');
select is(pg_temp.val('a_owner', format($$select jsonb_array_length(public.sites_list(%L, null, false))::text$$, tests.tid('a'))), '1', 'D26 and the list leaves it out unless asked');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'customer_site'), 5::bigint, 'D27 every change of a site is in the audit trail');
select is((select coalesce(bool_or(new_values::text like '%Banjara%' or new_values::text like '%Road no%'), false) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'customer_site'), false, 'D28 and the trail holds the NAMES of the personal columns, never what is in them');

-- ============================================================================ E. requirement fields
select is(app.requirement_keys(tests.tid('a')) @> array['area', 'product_type', 'laying', 'application'] and not (app.requirement_keys(tests.tid('a')) && array['saree_type', 'fabric', 'colour']), true, 'E1 construction uses the building-materials keys and none of the saree ones');
select is(app.requirement_keys(tests.tid('b')), array['saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms'], 'E2 textiles has exactly the eight keys it had');
select is(app.requirement_value_ok('area', 1::smallint, null, 100000, null, null, 'sq_ft'), true, 'E3 an area of 1,000.00 sq ft is a value');
select is(app.requirement_value_ok('area', 1::smallint, null, 100000, null, null, 'ft'), false, 'E4 an area is in sq ft or sq m, not ft');
select is(app.requirement_value_ok('area', null, null, 100000, null, null, 'sq_ft'), false, 'E5 an area belongs to a line');
select is(app.requirement_value_ok('area', 1::smallint, null, 0, null, null, 'sq_ft'), false, 'E6 an area of nothing is no area');
select is(app.requirement_value_ok('length', 2::smallint, null, 1250, null, null, 'ft'), true, 'E7 a length of 12.50 ft');
select is(app.requirement_value_ok('thickness', 1::smallint, null, 80, null, null, 'mm'), true, 'E8 thickness 80 mm');
select is(app.requirement_value_ok('thickness', 1::smallint, null, 5, null, null, 'mm'), false, 'E9 5 mm is not a thickness of a building material');
select is(app.requirement_value_ok('product_type', 1::smallint, 'paver_block', null, null, null, null), true, 'E10 product type from the closed list');
select is(app.requirement_value_ok('product_type', 1::smallint, 'spaceship', null, null, null, null), false, 'E11 ... and nothing else');
select is(app.requirement_value_ok('application', null, 'driveway', null, null, null, null), true, 'E12 application belongs to the whole enquiry');
select is(app.requirement_value_ok('application', 1::smallint, 'driveway', null, null, null, null), false, 'E13 ... not to a line');
select is(app.requirement_value_ok('laying', null, 'yes', null, null, null, null), true, 'E14 laying needed: yes');
select is(app.requirement_value_ok('laying', null, 'maybe', null, null, null, null), false, 'E15 ... or no, never maybe');
select is(app.requirement_value_ok('site_location', null, null, null, null, 'Kukatpally, near the ring road', null), true, 'E16 a site location is words');
select is(app.requirement_value_ok('quantity', 1::smallint, null, 120, null, null, 'bag'), true, 'E17 a quantity may now be in bags (the saree units still pass)');
select is(app.requirement_value_ok('quantity', 1::smallint, null, 20, null, null, 'piece'), true, 'E18 and in pieces, as before');
select is(app.requirement_value_ok('saree_type', 1::smallint, 'banarasi', null, null, null, null), true, 'E19 the saree arms are untouched');
-- an enquiry in each business, the fields a person (or the analyst) states, and the confirm rule
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values
  (tests.rid('a_enq'), tests.tid('a'), tests.rid('a_lead'), 'whatsapp', now() - interval '1 hour', 'Need 1000 sq ft paver blocks 80 mm for my driveway in Kukatpally, laying also needed'),
  (tests.rid('b_enq'), tests.tid('b'), tests.rid('b_lead'), 'whatsapp', now() - interval '1 hour', 'Need 20 kanjivaram sarees');
create function pg_temp.addf(p_user text, p_enq uuid, p_line int, p_key text, p_code text, p_int bigint, p_text text, p_basis text, p_quote text, p_start int, p_end int) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.add_requirement_field(%L, %L, %L, %L, %L, null, %L, %L, %L, %L, %L)$q$, p_enq, p_line, p_key, p_code, p_int, p_text, p_basis, p_quote, p_start, p_end))
$$;
select is(pg_temp.addf('a_owner', tests.rid('a_enq'), null, 'saree_type', 'banarasi', null, null, null, 'paver', 5, 10), '22023', 'E20 a saree key is refused in a construction business (invalid)');
select is(pg_temp.addf('b_owner', tests.rid('b_enq'), null, 'area', null, 100000, null, 'sq_ft', 'Need 20', 0, 7), '22023', 'E21 and a building-materials key in a textile business');
select is(pg_temp.addf('a_owner', tests.rid('a_enq'), 1, 'product_type', 'paver_block', null, null, null, 'paver blocks', 16, 28), 'ok', 'E22 ALLOW: product type of line 1 (a quote of the enquiry)');
select is(pg_temp.addf('a_owner', tests.rid('a_enq'), 1, 'area', null, 100000, null, 'sq_ft', '1000 sq ft', 5, 15), 'ok', 'E23 ALLOW: area of line 1 (1,000.00 sq ft)');
select is(pg_temp.addf('a_sales', tests.rid('a_enq'), 1, 'thickness', null, 80, null, 'mm', '80 mm', 29, 34), 'ok', 'E24 ALLOW: Sales states the thickness');
select is(pg_temp.addf('a_owner', tests.rid('a_enq'), null, 'application', 'driveway', null, null, null, 'driveway', 42, 50), 'ok', 'E25 ALLOW: the application');
select is(pg_temp.addf('a_owner', tests.rid('a_enq'), null, 'site_location', null, null, 'Kukatpally', null, 'Kukatpally', 54, 64), 'ok', 'E26 ALLOW: the site location');
select is(pg_temp.addf('a_owner', tests.rid('a_enq'), null, 'laying', 'yes', null, null, null, 'laying', 66, 72), 'ok', 'E27 ALLOW: laying needed');
select is(pg_temp.addf('a_viewer', tests.rid('a_enq'), 2, 'product_type', 'tile', null, null, null, 'paver', 16, 21), '42501', 'E28 DENY: a Viewer');
select is(pg_temp.addf('a_owner', tests.rid('a_enq'), 1, 'area', null, 5, null, 'sq_ft', '1000 sq ft', 5, 15), '23514', 'E29 a second area on the same line is refused (one field per slot)');
select is((select count(*) from public.requirement_fields where tenant_id = tests.tid('a') and field_key in ('product_type', 'area', 'thickness', 'application', 'site_location', 'laying')), 6::bigint, 'E30 six fields are stored');
select is(pg_temp.sc(format($$insert into public.requirement_fields (id, tenant_id, requirement_id, line_no, field_key, value_code, certainty, quote, quote_start, quote_end) values (gen_random_uuid(), %L, (select id from public.requirements where tenant_id = %L limit 1), 3, 'saree_type', 'banarasi', 'stated', 'x', 0, 1)$$, tests.tid('a'), tests.tid('a'))), '22023', 'E31 even a privileged insert cannot store a key the business does not use (the trigger)');
select is(pg_temp.val('a_owner', format($$select public.confirm_requirement((select id from public.requirements where tenant_id = %L and enquiry_id = %L))->>'status'$$, tests.tid('a'), tests.rid('a_enq'))), 'confirmed', 'E32 a requirement is confirmable when a line has its product type AND its area settled by a person');
-- a requirement that has only an area cannot be confirmed
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (tests.rid('a_enq2'), tests.tid('a'), tests.rid('a_lead'), 'whatsapp', now() - interval '1 hour', 'Need 500 sq ft of something');
select is(pg_temp.addf('a_owner', tests.rid('a_enq2'), 1, 'area', null, 50000, null, 'sq_ft', '500 sq ft', 5, 14), 'ok', 'E33 an area without a product type is stored ...');
select is(pg_temp.val('a_owner', format($$select public.confirm_requirement((select id from public.requirements where tenant_id = %L and enquiry_id = %L))::text$$, tests.tid('a'), tests.rid('a_enq2'))), 'ERR:SM210', 'E34 ... but cannot be confirmed (SM210): a line needs its product type and its measure');
select is(pg_temp.addf('a_owner', tests.rid('a_enq2'), 1, 'product_type', 'tile', null, null, null, 'something', 18, 27), 'ok', 'E35 the product type completes the line ...');
select is(pg_temp.val('a_owner', format($$select public.confirm_requirement((select id from public.requirements where tenant_id = %L and enquiry_id = %L))->>'status'$$, tests.tid('a'), tests.rid('a_enq2'))), 'confirmed', 'E36 ... and it can be confirmed');
-- the textile rule is exactly as it was
select is(pg_temp.addf('b_owner', tests.rid('b_enq'), 1, 'quantity', null, 20, null, 'piece', 'Need 20', 0, 7), 'ok', 'E37 textiles: a quantity is stored as before');
select is(pg_temp.val('b_owner', format($$select public.confirm_requirement((select id from public.requirements where tenant_id = %L and enquiry_id = %L))::text$$, tests.tid('b'), tests.rid('b_enq'))), 'ERR:SM210', 'E38 textiles: a requirement still needs its saree type AND quantity (SM210)');
select is(pg_temp.sc(format($$update public.requirements set status = 'discarded' where tenant_id = %L and enquiry_id = %L$$, tests.tid('b'), tests.rid('b_enq'))), 'ok', 'E39 the discard guard for material quotes does not touch a business with none');

select * from finish();
rollback;
