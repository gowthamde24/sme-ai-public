-- Lead Finder, Google Places route 1 (migration 20261231540000): from Google we keep the place ID and the coordinates (30 days) and nothing else; the fixture source is unchanged.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'textiles');
select tests.cp_pack('b', 'textiles');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.item(p_place text, p_name text) returns jsonb language sql as $$
  select jsonb_build_object('place_id', p_place, 'name', p_name, 'name_key', lower(p_name), 'category', 'Saree shop', 'area', 'Jayanagar', 'lat', 12.93, 'lng', 77.58, 'phone', '+91 98450 12345', 'phone_key', '919845012345',
                            'website', 'https://example.test', 'rating', 4.3, 'review_count', 120, 'status', 'call_ready', 'decision_reason', 'fit_high', 'fit_score', 82, 'fit_reason', 'Saree shop; we have silk sarees', 'stock_match', jsonb_build_object('enough', true))
$$;

select app.operator_open_real_data_gate((select slug from public.tenants where id = tests.tid('a')), 'adr:0014', 'doc:hosting', 'dpdp-children:review', 'doc:restore');
-- an older Google row (what the first version stored) is blanked by the migration: plant one, then run the migration's first statement again
alter table public.prospects drop constraint prospects_google_route1_check;
insert into public.prospects (tenant_id, name, name_key, category, area, phone, phone_key, website, rating, review_count, source, source_label, place_id, status, fit, lat, lng)
values (tests.tid('a'), 'Old Google Row', 'old google row', 'Saree shop', 'Jayanagar', '+91 98450 99999', '919845099999', 'https://old.test', 4.0, 10, 'google_maps', 'Google Maps search', 'ChIJ_old_one', 'skipped', 50, 12.9, 77.5);
update public.prospects set name = null, name_key = null, category = null, area = null, phone = null, phone_key = null, website = null, rating = null, review_count = null where source = 'google_maps';
alter table public.prospects add constraint prospects_google_route1_check check (
  source <> 'google_maps' or (name is null and name_key is null and category is null and area is null and phone is null and phone_key is null and website is null and rating is null and review_count is null));
select is((select name || phone from public.prospects where place_id = 'ChIJ_old_one'), null, 'R1: an old Google row is blanked (name and phone null)');
select is((select place_id || lat::text from public.prospects where place_id = 'ChIJ_old_one'), 'ChIJ_old_one12.900000', 'R2: its place ID and coordinates stay');

-- a Places search, approved, finished with items that CARRY Google content: the database keeps none of it
select pg_temp.sc('a_owner', format($q$select public.prospect_search_plan(%L, %L, 'saree shops', 'Jayanagar Bengaluru', 'retailer', 20, 'places', 'places_text_search_enterprise', 300, 'Google Maps search')::text$q$, tests.tid('a'), tests.rid('g1')));
select pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('g1')));
select is(jsonb_typeof(pg_temp.sc('a_owner', format($q$select public.prospect_search_finish(%L, %L, %L, 'done', 300, null)::text$q$, tests.tid('a'), tests.rid('g1'),
          jsonb_build_array(pg_temp.item('ChIJ_new_1', 'Sri Lakshmi Sarees'), pg_temp.item('ChIJ_new_2', 'Kanchi Silk House'))))::jsonb), 'object', 'R3: a Places search finishes');
select is((select count(*) from public.prospects where source = 'google_maps' and place_id in ('ChIJ_new_1', 'ChIJ_new_2')), 2::bigint, 'R4: both places are stored');
select is((select count(*) from public.prospects where source = 'google_maps' and (name is not null or name_key is not null or category is not null or area is not null or phone is not null or phone_key is not null
            or website is not null or rating is not null or review_count is not null)), 0::bigint, 'R5: NOTHING copied from Google is stored (name, category, address, phone, website, rating, reviews)');
select is((select lat::text || '/' || lng::text || '/' || fit::text || '/' || status from public.prospects where place_id = 'ChIJ_new_1'), '12.930000/77.580000/82/call_ready', 'R6: the coordinates and OUR score and decision are stored');
select is(pg_temp.sc('a_owner', format($q$select (public.prospect_get(%L, %L))::text$q$, tests.tid('a'), (select id from public.prospects where place_id = 'ChIJ_new_1')))::jsonb ->> 'name', null, 'R7: reading the prospect gives no name (the API fetches it fresh)');
select throws_ok(format($q$update public.prospects set phone = '+91 98450 12345' where place_id = 'ChIJ_new_1' and tenant_id = %L$q$, tests.tid('a')), '23514', null, 'R8: even the owner of the database cannot write a Google phone into a google_maps row');
select throws_ok(format($q$update public.prospects set name = 'x', name_key = 'x' where place_id = 'ChIJ_new_2' and tenant_id = %L$q$, tests.tid('a')), '23514', null, 'R9: nor a name');

-- 30 days: the coordinates go, the place ID and our decision stay
update public.prospects set fetched_at = now() - interval '31 days' where place_id = 'ChIJ_new_1';
select is((select count(*) from public.prospects where place_id = 'ChIJ_new_1' and lat is not null), 1::bigint, 'R10: before the expiry run the coordinates are there');
select app.operator_register_scheduler('outsider@test.local');
select is(pg_temp.sc('a_owner', $q$select public.prospect_places_expire(30)::text$q$), 'ERR:42501', 'R11: only the scheduler expires (an Owner is refused)');
select is(tests.scalar_as(tests.uid('outsider'), $q$select public.prospect_places_expire(30)::text$q$), '1', 'R12: the scheduler clears the coordinates of the one 31 days old (and the old row is not counted twice)');
select is((select (lat is null)::text || (lng is null)::text || '/' || status || '/' || place_id from public.prospects where place_id = 'ChIJ_new_1'), 'truetrue/call_ready/ChIJ_new_1', 'R13: coordinates gone; place ID, status and score stay');
select is((select count(*) from public.prospects where place_id = 'ChIJ_new_2' and lat is not null), 1::bigint, 'R14: a fresh one keeps its coordinates');

-- the fixture source is unchanged: it still stores its invented business in full
select pg_temp.sc('a_owner', format($q$select public.prospect_search_plan(%L, %L, 'saree shops', 'Jayanagar', 'retailer', 20, 'fixture', 'fixture', 0, 'Example search')::text$q$, tests.tid('a'), tests.rid('f1')));
select pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('f1')));
select pg_temp.sc('a_owner', format($q$select public.prospect_search_finish(%L, %L, %L, 'done', 0, null)::text$q$, tests.tid('a'), tests.rid('f1'), jsonb_build_array(pg_temp.item('fx_one', 'Invented Sarees') || '{"phone": "+00 000 5001 0001", "phone_key": "00000050010001"}'::jsonb)));
select is((select name || '|' || phone from public.prospects where place_id = 'fx_one'), 'Invented Sarees|+00 000 5001 0001', 'R15: a fixture prospect keeps its name and phone');
select throws_ok(format($q$update public.prospects set name = null where place_id = 'fx_one' and tenant_id = %L$q$, tests.tid('a')), '23514', null, 'R16: a fixture prospect always has a name');

select * from finish();
rollback;
