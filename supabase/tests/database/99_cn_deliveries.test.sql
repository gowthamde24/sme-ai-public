-- Job CN (ADR 0085), part 4: DELIVERIES. An order is delivered in trips; each trip has a vehicle, a driver, a site contact, quantities, a status, a delivery note (challan), a proof when delivered, and a message to the site contact through the outbox.
--   A module default-deny   B planning: who, quantities against the order line, numbers   C the status machine, the dispatch rule   D proof of delivery   E the challan (no amounts)   F the update to the site contact (consent, key, policy)   G read and write rules
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');
select tests.seed_t008();
select tests.seed_t009();
select tests.seed_orders();  -- (a saree order of the business, for the one refusal that needs it)

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
create function pg_temp.fld(p_enq uuid, p_line int, p_key text, p_code text, p_int bigint, p_text text, p_basis text, p_quote text) returns void language plpgsql as $$
declare
  b text := (select body from public.enquiries where id = p_enq);
  s int := position(p_quote in b) - 1;
begin
  perform pg_temp.try('a_owner', format($q$select public.add_requirement_field(%L, %L, %L, %L, %L, null, %L, %L, %L, %L, %L)$q$, p_enq, p_line, p_key, p_code, p_int, p_text, p_basis, p_quote, s, s + char_length(p_quote)));
end $$;
create function pg_temp.picks(p_items text[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('line_no', n, 'item_id', tests.rid(p_items[n])) order by n) from generate_series(1, cardinality(p_items)) n
$$;

-- ---------------------------------------------------------------- setup: rules, items, a requirement of 1,000 sq ft of paver and 120 bags of cement, an approved quote, an order that has been dispatched
do $do$ begin perform pg_temp.try('a_owner', format($$select public.material_policy_create(%L, %L, %L::date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"per_trip","capacity_basis":"pieces","truck_capacity":2500,"rate_per_trip_paise":350000,"gst_bps":1800},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb)$$, tests.rid('pol'), tests.tid('a'), app.quote_today())); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Paver block 80 mm grey', 'sq_ft', null, 'in_stock', false, 6500, true)$$, tests.rid('paver'), tests.tid('a'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"pieces_per_area": 4.5, "pieces_per_pallet": 500, "gst_rate_percent": 18, "hsn_code": "68101990"}'::jsonb)$$, tests.tid('a'), tests.rid('paver'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Cement 53 grade 50 kg bag', 'bag', null, 'in_stock', false, 38000, true)$$, tests.rid('cement'), tests.tid('a'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"gst_rate_percent": 28, "minimum_order": 100}'::jsonb)$$, tests.tid('a'), tests.rid('cement'))); end $do$;
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values
  (tests.rid('enq'), tests.tid('a'), tests.rid('a_lead'), 'whatsapp', now() - interval '2 hours', 'Need 1000 sq ft paver blocks and 120 bags of cement');
do $do$ begin
  perform pg_temp.fld(tests.rid('enq'), 1, 'product_type', 'paver_block', null, null, null, 'paver blocks');
  perform pg_temp.fld(tests.rid('enq'), 1, 'area', null, 100000, null, 'sq_ft', '1000 sq ft');
  perform pg_temp.fld(tests.rid('enq'), 2, 'product_type', 'cement', null, null, null, 'cement');
  perform pg_temp.fld(tests.rid('enq'), 2, 'quantity', null, 120, null, 'bag', '120 bags');
  perform pg_temp.try('a_owner', format($q$select public.confirm_requirement((select id from public.requirements where tenant_id = %L and enquiry_id = %L))$q$, tests.tid('a'), tests.rid('enq')));
end $do$;
-- the draft, as the API would send it (the figures are the database's own: pgTAP 98 proves the database refuses any other)
do $do$
declare
  req uuid := (select id from public.requirements where tenant_id = tests.tid('a') and enquiry_id = tests.rid('enq'));
  b jsonb := app.cq_build(tests.tid('a'), req, app.quote_today(), app.material_active_policy(tests.tid('a'), app.quote_today()), pg_temp.picks(array['paver', 'cement']), null);
  rt text := (b -> 'request')::text;
  res jsonb;
begin
  res := (b -> 'core') || jsonb_build_object('status', 'draft', 'engine_version', '1.0.0', 'canonical_hash', app.cq_request_hash('1.0.0', rt), 'flags', jsonb_build_object('needs_owner_approval', true, 'reasons', b -> 'flag_list'),
                                              'trace', '[]'::jsonb, 'range', '{}'::jsonb);
  perform pg_temp.try('a_owner', format($q$select public.material_quote_draft(%L, %L, %L, %L::jsonb, null, '1.0.0', %L, %L)$q$, tests.rid('q'), tests.tid('a'), req, pg_temp.picks(array['paver', 'cement'])::text, rt, res::text));
end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q'), (select canonical_hash from public.material_quotes where id = tests.rid('q')))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.create_order_policy_version(%L, %L, %L::date, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$$, tests.rid('opol'), tests.tid('a'), app.quote_today())); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.create_order_from_material_quote(%L, %L)$$, tests.rid('ord'), tests.rid('q'))); end $do$;
select is((select status::text from public.material_quotes where id = tests.rid('q')) || ':' || (select state::text from public.orders where id = tests.rid('ord')), 'approved:quote_approved', 'S1 (setup) an approved material quote and its order');
select is((select string_agg(line_no || '=' || coalesce(pieces, billed_quantity) , ',' order by line_no) from public.material_quote_lines where quote_id = tests.rid('q')), '1=4725,2=120', 'S2 (setup) the order holds 4,725 paver pieces and 120 bags');
-- a customer on the site: a site contact with a phone, a key and consent; a second one with no consent
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values
  (tests.rid('sc1'), tests.tid('a'), tests.rid('a_company'), 'Site supervisor', '+00 90000 00051'),
  (tests.rid('sc2'), tests.tid('a'), tests.rid('a_company'), 'Gatekeeper', '+00 90000 00052');
do $do$ begin
  perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid('sc1'), jsonb_build_object('version', 1, 'phone', md5('sc1p') || md5('sc1px'))::text));
  perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid('sc2'), jsonb_build_object('version', 1, 'phone', md5('sc2p') || md5('sc2px'))::text));
  perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:cn')$q$, tests.tid('a'), tests.rid('sc1')));
end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.site_save(%L, %L, %L, 'Kukatpally villa', 'Plot 4', 'Hyderabad', '500072', null, null, 22, 14, false, true, 'Gate on the left', %L, true)$$, tests.rid('site'), tests.tid('a'), tests.rid('a_company'), tests.rid('sc1'))); end $do$;
-- the order is dispatched (the lifecycle's own proof is in pgTAP 61; here the state is set the way a privileged fixture may)
alter table public.orders disable trigger orders_guard_update;
update public.orders set state = 'dispatched', site_id = tests.rid('site') where id = tests.rid('ord');
alter table public.orders enable trigger orders_guard_update;

create function pg_temp.plan(p_user text, p_trip text, p_date text, p_lines text, p_extra text default $$'TS09 AB 1234', 'Ramesh', '+91 98480 11111', null, null$$, p_order text default 'ord', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.trip_plan(%L, %L, %L, date %L, %s, %L::jsonb)$q$, tests.rid(p_trip), tests.tid(p_tenant), tests.rid(p_order), p_date, p_extra, p_lines))
$$;
create function pg_temp.tstatus(p_trip text) returns text language sql as $$ select status from public.delivery_trips where id = tests.rid(p_trip) $$;
create function pg_temp.setst(p_user text, p_trip text, p_status text, p_code text default null) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.trip_set_status(%L, %L, %L, %L)$q$, tests.tid('a'), tests.rid(p_trip), p_status, p_code))
$$;

-- ============================================================================ A. module default-deny
select is(pg_temp.plan('b_owner', 'tb', '2026-10-20', '[{"line_no":1,"quantity":10}]', $$null, null, null, null, null$$, 'ord', 'b'), 'SM701', 'A1 textiles: no trips (SM701)');
select is(pg_temp.try('b_owner', format($$select public.trips_list(%L)$$, tests.tid('b'))), 'SM701', 'A2 nor the day board');
select is(pg_temp.try('b_owner', format($$select public.pod_ensure_bucket(%L)$$, tests.tid('b'))), 'SM701', 'A3 nor a proof bucket');
select is(pg_temp.try('b_owner', format($$select public.delivery_challan_get(%L, %L)$$, tests.tid('b'), gen_random_uuid())), 'SM701', 'A4 nor a challan');
select is(pg_temp.try('b_owner', format($$select public.trip_update_submit(%L, %L, %L, 'Truck left', 'en')$$, gen_random_uuid(), tests.tid('b'), gen_random_uuid())), 'SM701', 'A5 nor a message about a trip');

-- ============================================================================ B. planning
select is(pg_temp.plan('a_owner', 't1', '2026-10-20', '[{"line_no":1,"quantity":2500},{"line_no":2,"quantity":120}]', format($$'TS09 AB 1234', 'Ramesh', '+91 98480 11111', null, %L$$, tests.rid('sc1'))), 'ok', 'B1 ALLOW: the Owner plans the first trip (2,500 pieces and all 120 bags) with the site contact');
select is(pg_temp.plan('a_sales', 't2', '2026-10-21', '[{"line_no":1,"quantity":2225}]'), 'ok', 'B2 ALLOW: Sales plans the second (the other 2,225 pieces)');
select is((select trip_no || ':' || challan_no from public.delivery_trips where id = tests.rid('t1')) || ' ' || (select trip_no || ':' || challan_no from public.delivery_trips where id = tests.rid('t2')), '1:1 2:2', 'B3 trips are numbered per order and each has a challan number of the business');
select is((select site_id from public.delivery_trips where id = tests.rid('t1')), tests.rid('site'), 'B4 the site is the order''s unless another is given');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":1,"quantity":1}]'), 'SM773', 'B5 one piece more than the order holds is refused (SM773)');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]'), 'SM773', 'B6 nor a bag more than the 120 (SM773)');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":3,"quantity":1}]'), '23503', 'B7 a line the order does not have is not found');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":1,"quantity":0}]'), '22023', 'B8 a quantity of nothing is invalid');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[]'), '22023', 'B9 a trip with no lines is invalid');
select is(pg_temp.try('a_owner', format($$select public.trip_update(%L, %L, date '2026-10-21', null, null, null, null, null, '[{"line_no":1,"quantity":1},{"line_no":1,"quantity":1}]'::jsonb)$$, tests.tid('a'), tests.rid('t2'))), '22023', 'B10 the same line twice in one trip is invalid');
select is((select quantity from public.delivery_trip_lines where trip_id = tests.rid('t2')), 2225::bigint, 'B10b and the refused change left the trip''s lines as they were (one transaction)');
select is((select count(*) from public.delivery_trips where tenant_id = tests.tid('a')), 2::bigint, 'B11 the refusals left no trip behind');
select is(pg_temp.plan('a_viewer', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]'), '42501', 'B12 DENY: a Viewer');
select is(pg_temp.plan('b_owner', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]', $$null, null, null, null, null$$, 'ord', 'a'), '42501', 'B13 DENY: another business');
select is(pg_temp.plan('anon', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]'), '42501', 'B14 DENY: anon');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]', $$'ab', null, null, null, null$$), '22023', 'B15 a vehicle number of fewer than 3 characters is invalid');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]', $$'TS09 AB 1234', null, 'call me', null, null$$), '22023', 'B16 a driver phone is a phone number');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]', $$null, 'Call 9876543210', null, null, null$$), '22023', 'B17 a phone number in the driver''s NAME is refused (it belongs in the phone)');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]', format($$null, null, null, null, %L$$, tests.rid('b_contact'))), '23503', 'B18 a site contact of another business is not found');
select is(pg_temp.plan('a_owner', 't3', '2026-10-22', '[{"line_no":2,"quantity":1}]', format($$null, null, null, %L, null$$, tests.rid('b_company'))), '23503', 'B19 a site of another business is not found');
select is(pg_temp.plan('a_owner', 't1', '2026-10-20', '[{"line_no":1,"quantity":2500},{"line_no":2,"quantity":120}]', format($$'TS09 AB 1234', 'Ramesh', '+91 98480 11111', null, %L$$, tests.rid('sc1'))), 'ok', 'B20 an exact repeat of a plan replays');
select is(pg_temp.plan('a_owner', 't1', '2026-10-20', '[{"line_no":1,"quantity":2500}]', $$null, null, null, null, null$$, 'ord', 'a'), 'ok', 'B21 the same id again for the same order replays, whatever is sent (it is the same trip)');
select is((select count(*) from public.delivery_trips where tenant_id = tests.tid('a')), 2::bigint, 'B22 still two trips');
-- the order must be a material order and not closed
select is(pg_temp.try('a_owner', format($$select public.trip_plan(%L, %L, %L, current_date, null, null, null, null, null, '[{"line_no":1,"quantity":1}]'::jsonb)$$, tests.rid('tx'), tests.tid('a'), tests.rid('a_order'))), 'SM774', 'B23 an order that has no material quote (a saree order) cannot have trips (SM774)');
select is(pg_temp.try('a_owner', format($$select public.trip_update(%L, %L, date '2026-10-25', 'TS09 CD 5678', 'Suresh', '+91 98480 22222', %L, %L, '[{"line_no":1,"quantity":2000}]'::jsonb)$$, tests.tid('a'), tests.rid('t2'), tests.rid('site'), tests.rid('sc1'))), 'ok', 'B24 ALLOW: a planned trip can change its date, vehicle, driver, contact and quantities');
select is((select quantity from public.delivery_trip_lines where trip_id = tests.rid('t2')), 2000::bigint, 'B25 the quantity is the new one');
select is(pg_temp.plan('a_owner', 't3', '2026-10-26', '[{"line_no":1,"quantity":225}]'), 'ok', 'B26 and the 225 pieces that freed up can be planned on a third trip');
select is(pg_temp.try('a_owner', format($$select public.trip_update(%L, %L, date '2026-10-25', null, null, null, null, null, '[{"line_no":1,"quantity":2300}]'::jsonb)$$, tests.tid('a'), tests.rid('t2'))), 'SM773', 'B27 growing a trip past the order line is refused (SM773): the other trips count');
select is((select quantity from public.delivery_trip_lines where trip_id = tests.rid('t2')), 2000::bigint, 'B28 and the refused change did not touch the trip');

-- ============================================================================ C. the status machine and the dispatch rule
select is(pg_temp.setst('a_owner', 't1', 'on_the_way'), 'SM771', 'C1 a planned trip does not leave before it is loaded (SM771)');
select is(pg_temp.setst('a_sales', 't1', 'loaded'), 'ok', 'C2 ALLOW: planned -> loaded');
select is(pg_temp.setst('a_sales', 't1', 'loaded'), 'ok', 'C3 the same status again replays');
select is(pg_temp.try('a_owner', format($$select public.trip_update(%L, %L, date '2026-10-20', null, null, null, null, null)$$, tests.tid('a'), tests.rid('t1'))), 'SM771', 'C4 a loaded truck is not re-planned (SM771)');
alter table public.orders disable trigger orders_guard_update;
update public.orders set state = 'accepted' where id = tests.rid('ord');
alter table public.orders enable trigger orders_guard_update;
select is(pg_temp.setst('a_owner', 't1', 'on_the_way'), 'SM772', 'C5 a truck does not leave before the order is dispatched (SM772): the advance rule is the order''s');
alter table public.orders disable trigger orders_guard_update;
update public.orders set state = 'dispatched' where id = tests.rid('ord');
alter table public.orders enable trigger orders_guard_update;
select is(pg_temp.setst('a_owner', 't1', 'on_the_way'), 'ok', 'C6 ALLOW: loaded -> on the way once the order is dispatched');
select is(pg_temp.setst('a_owner', 't1', 'planned'), 'SM771', 'C7 a truck on the road is not planned again (SM771)');
select is(pg_temp.setst('a_owner', 't1', 'delivered'), '22023', 'C8 delivered is not a status to set: the proof makes it');
select is(pg_temp.setst('a_owner', 't1', 'problem'), '22023', 'C9 a problem needs its reason');
select is(pg_temp.setst('a_owner', 't1', 'problem', 'ran_out_of_diesel'), '22023', 'C10 from the closed list');
select is(pg_temp.setst('a_owner', 't1', 'on_the_way', 'road_blocked'), '22023', 'C11 a reason belongs only to a problem');
select is(pg_temp.setst('a_owner', 't2', 'problem', 'truck_breakdown'), 'ok', 'C12 ALLOW: a planned trip can be marked with a problem');
select is((select problem_code from public.delivery_trips where id = tests.rid('t2')), 'truck_breakdown', 'C13 and keeps the reason');
select is(pg_temp.setst('a_owner', 't2', 'loaded'), 'SM771', 'C14 a trip in problem is rescheduled (planned), not loaded');
select is(pg_temp.setst('a_owner', 't2', 'planned'), 'ok', 'C15 ALLOW: problem -> planned');
select is((select coalesce(problem_code, 'none') from public.delivery_trips where id = tests.rid('t2')), 'none', 'C16 and the reason is cleared');
select is(pg_temp.setst('a_owner', 't3', 'cancelled'), 'ok', 'C17 ALLOW: a trip that has not gone is cancelled');
select is(pg_temp.setst('a_owner', 't3', 'planned'), 'SM771', 'C18 a cancelled trip stays cancelled (SM771)');
select is(pg_temp.plan('a_owner', 't4', '2026-10-27', '[{"line_no":1,"quantity":225}]'), 'ok', 'C19 its quantity is free again for another trip (cancelled trips do not count)');
select is(pg_temp.setst('a_viewer', 't2', 'loaded'), '42501', 'C20 DENY: a Viewer');
select is(pg_temp.setst('anon', 't2', 'loaded'), '42501', 'C21 DENY: anon');
select is(pg_temp.try('b_owner', format($$select public.trip_set_status(%L, %L, 'loaded')$$, tests.tid('b'), tests.rid('t2'))), 'SM701', 'C22 DENY: another business (its own module is off)');
select is(pg_temp.try('a_owner', format($$select public.trip_set_status(%L, %L, 'loaded')$$, tests.tid('a'), gen_random_uuid())), '23503', 'C23 an unknown trip is not found');
select is((select string_agg(coalesce(from_status, '-') || '>' || to_status, ' ' order by seq) from public.delivery_trip_events where trip_id = tests.rid('t1')), '->planned planned>loaded loaded>on_the_way', 'C24 every change is in the trip''s own history');
select is((select string_agg(coalesce(from_status, '-') || '>' || to_status || coalesce('/' || problem_code, ''), ' ' order by seq) from public.delivery_trip_events where trip_id = tests.rid('t2')), '->planned planned>problem/truck_breakdown problem>planned', 'C25 ... with the problem named');
select is(pg_temp.try('a_owner', format($$update public.delivery_trips set status = 'delivered' where id = %L$$, tests.rid('t2'))), '42501', 'C26 DENY: a client cannot write a status');
select is(pg_temp.sc($$delete from public.delivery_trips$$), '42501', 'C27 a trip is never deleted');
select is(pg_temp.sc(format($$update public.delivery_trip_events set to_status = 'planned' where trip_id = %L$$, tests.rid('t1'))), '42501', 'C28 the history is never changed');
select is(pg_temp.sc(format($$delete from public.delivery_trip_lines where trip_id = %L$$, tests.rid('t1'))), '42501', 'C29 nor are the lines of a trip deleted outside the trip functions');

-- ============================================================================ D. proof of delivery
select is(pg_temp.try('a_owner', format($$select public.pod_ensure_bucket(%L)$$, tests.tid('a'))), 'ok', 'D1 ALLOW: the Owner opens the business''s private proof bucket');
select is(pg_temp.try('a_sales', format($$select public.pod_ensure_bucket(%L)$$, tests.tid('a'))), 'ok', 'D2 ALLOW: and Sales (the driver''s office)');
select is((select public from storage.buckets where id = app.pod_bucket(tests.tid('a'))), false, 'D3 the bucket is private');
select is(pg_temp.try('a_owner', format($$select public.trip_deliver(%L, %L, 'Site supervisor', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t1'), tests.rid('photo1'))), 'SM776', 'D4 no photo in storage: the proof is incomplete (SM776)');
insert into storage.objects (bucket_id, name, metadata) values (app.pod_bucket(tests.tid('a')), tests.rid('t1')::text || '/' || tests.rid('photo1')::text || '.jpg', jsonb_build_object('mimetype', 'image/jpeg', 'size', 200000));
select is(pg_temp.try('a_owner', format($$select public.trip_deliver(%L, %L, '   ', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t1'), tests.rid('photo1'))), 'SM776', 'D5 no name: incomplete (SM776)');
select is(pg_temp.try('a_owner', format($$select public.trip_deliver(%L, %L, 'Call 9876543210', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t1'), tests.rid('photo1'))), 'SM776', 'D6 a phone number as the name is refused too');
select is(pg_temp.try('a_owner', format($$select public.trip_deliver(%L, %L, 'Site supervisor', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t2'), tests.rid('photo1'))), 'SM771', 'D7 a trip that is not on the road cannot be delivered (SM771)');
select is(pg_temp.try('a_viewer', format($$select public.trip_deliver(%L, %L, 'Site supervisor', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t1'), tests.rid('photo1'))), '42501', 'D8 DENY: a Viewer');
select is(pg_temp.try('b_owner', format($$select public.trip_deliver(%L, %L, 'Site supervisor', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t1'), tests.rid('photo1'))), '42501', 'D9 DENY: another business');
select is(pg_temp.try('a_sales', format($$select public.trip_deliver(%L, %L, 'Site supervisor', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t1'), tests.rid('photo1'))), 'ok', 'D10 ALLOW: Sales records the proof: the name and the photo');
select is(pg_temp.tstatus('t1'), 'delivered', 'D11 the trip is delivered');
select is((select received_by || ':' || path from public.delivery_proofs where trip_id = tests.rid('t1')), 'Site supervisor:' || tests.rid('t1') || '/' || tests.rid('photo1') || '.jpg', 'D12 the proof holds the name and a path the database derived from the ids');
select is(pg_temp.try('a_sales', format($$select public.trip_deliver(%L, %L, 'Site supervisor', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t1'), tests.rid('photo1'))), 'ok', 'D13 the same proof again replays');
select is(pg_temp.try('a_sales', format($$select public.trip_deliver(%L, %L, 'Someone else', %L, 1600, 1200, 200000)$$, tests.tid('a'), tests.rid('t1'), tests.rid('photo1'))), 'SM771', 'D14 another name for a delivered trip is refused (SM771)');
select is(pg_temp.setst('a_owner', 't1', 'problem', 'other'), 'SM771', 'D15 a delivered trip stays delivered');
select is(pg_temp.sc(format($$update public.delivery_proofs set received_by = 'x' where trip_id = %L$$, tests.rid('t1'))), '42501', 'D16 a proof is never changed (except by an erasure)');
select is(pg_temp.sc($$delete from public.delivery_proofs$$), '42501', 'D17 nor deleted');
select is((select delivered_at is not null from public.delivery_trips where id = tests.rid('t1')), true, 'D18 the delivery time is recorded');
select is(pg_temp.sc(format($$insert into public.delivery_proofs (trip_id, tenant_id, received_by, photo_id, bucket, path, width, height, bytes, recorded_by) values (%L, %L, 'X', gen_random_uuid(), 'pod-other', 'a/b.jpg', 100, 100, 100, %L)$$, tests.rid('t2'), tests.tid('a'), tests.uid('a_owner'))), '23514', 'D19 a path or a bucket that is not the derived one is refused by the table');
select is(pg_temp.val('b_owner', format($$select count(*)::text from storage.objects where bucket_id = %L$$, app.pod_bucket(tests.tid('a')))), '0', 'D20 another business reads none of the photos');
select is(pg_temp.val('a_viewer', format($$select count(*)::text from storage.objects where bucket_id = %L$$, app.pod_bucket(tests.tid('a')))), '0', 'D21 nor does a Viewer (a photo names a person and a place)');
select is(pg_temp.val('a_sales', format($$select count(*)::text from storage.objects where bucket_id = %L$$, app.pod_bucket(tests.tid('a')))), '1', 'D22 Sales do');
select is(pg_temp.try('a_sales', format($$insert into storage.objects (bucket_id, name) values (%L, 'x/y.jpg')$$, app.pod_bucket(tests.tid('b')))), '42501', 'D23 DENY: Sales of one business cannot add a file to another''s bucket');
select is(pg_temp.try('a_viewer', format($$insert into storage.objects (bucket_id, name) values (%L, 'x/y.jpg')$$, app.pod_bucket(tests.tid('a')))), '42501', 'D24 DENY: a Viewer cannot add a file');

-- ============================================================================ E. the challan
select is(pg_temp.val('a_sales', format($$select (public.delivery_challan_get(%L, %L) ->> 'challan_no') || ':' || (public.delivery_challan_get(%L, %L) ->> 'order_no') || ':' || (public.delivery_challan_get(%L, %L) ->> 'customer')$$, tests.tid('a'), tests.rid('t1'), tests.tid('a'), tests.rid('t1'), tests.tid('a'), tests.rid('t1'))), '1:2:Company a', 'E1 the challan names its number, the order and the customer');
select is(pg_temp.val('a_sales', format($$select (select string_agg((e ->> 'description') || ' x ' || (e ->> 'quantity') || ' ' || (e ->> 'unit'), '; ' order by (e ->> 'line_no')::int) from jsonb_array_elements(public.delivery_challan_get(%L, %L) -> 'lines') e)$$, tests.tid('a'), tests.rid('t1'))), 'Paver block 80 mm grey x 2500 piece; Cement 53 grade 50 kg bag x 120 bag', 'E2 it lists what the truck carries, in pieces and bags');
select is(pg_temp.val('a_sales', format($$select (public.delivery_challan_get(%L, %L) -> 'site' ->> 'name') || ' | ' || (public.delivery_challan_get(%L, %L) -> 'site' ->> 'pin') || ' | ' || (public.delivery_challan_get(%L, %L) -> 'site_contact' ->> 'name')$$, tests.tid('a'), tests.rid('t1'), tests.tid('a'), tests.rid('t1'), tests.tid('a'), tests.rid('t1'))), 'Kukatpally villa | 500072 | Site supervisor', 'E3 the site and the person who will receive');
select is(pg_temp.val('a_sales', format($$select (public.delivery_challan_get(%L, %L) ->> 'vehicle_no') || ' / ' || (public.delivery_challan_get(%L, %L) ->> 'driver_name')$$, tests.tid('a'), tests.rid('t1'), tests.tid('a'), tests.rid('t1'))), 'TS09 AB 1234 / Ramesh', 'E4 the vehicle and the driver');
select is(pg_temp.val('a_sales', format($$select (public.delivery_challan_get(%L, %L) ->> 'received_by')$$, tests.tid('a'), tests.rid('t1'))), 'Site supervisor', 'E5 and, once delivered, who received it');
select is(pg_temp.val('a_sales', format($$select (public.delivery_challan_get(%L, %L))::text ~ '(paise|amount|total|price|gst|tax|rate)'$$, tests.tid('a'), tests.rid('t1'))), 'false', 'E6 the challan has NO amounts, no rates and no GST: an invoice stays in the owner''s accounting system');
select is(pg_temp.val('a_viewer', format($$select public.delivery_challan_get(%L, %L)::text$$, tests.tid('a'), tests.rid('t1'))), 'ERR:42501', 'E7 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($$select public.delivery_challan_get(%L, %L)::text$$, tests.tid('a'), tests.rid('t1'))), 'ERR:42501', 'E8 DENY: another business');
select is(pg_temp.val('a_owner', format($$select public.delivery_challan_get(%L, %L)::text$$, tests.tid('a'), gen_random_uuid())), 'ERR:23503', 'E9 an unknown trip is not found');

-- ============================================================================ F. the update to the site contact (the outbox, ADR 0066)
-- the outbox clock pinned at 14:00 IST (the policy depends on the hour in India), the kill switch on, automatic sending on
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
do $do$ begin
  perform pg_temp.pin('2026-10-20T14:00:00+05:30'::timestamptz);
  update public.platform_flags set enabled = true where key = 'outbox_enabled';
  perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.outbox_set_settings(%L, true, 3)$q$, tests.tid('a')));
end $do$;
create function pg_temp.msg(p_user text, p_msg text, p_trip text, p_text text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (public.trip_update_submit(%L, %L, %L, %L, 'en')->>'status') || '/' || (public.trip_update_submit(%L, %L, %L, %L, 'en')->>'reason')$q$,
                                    tests.rid(p_msg), tests.tid('a'), tests.rid(p_trip), p_text, tests.rid(p_msg), tests.tid('a'), tests.rid(p_trip), p_text))
$$;
select is(pg_temp.msg('a_sales', 'm1', 't1', 'The truck TS09 AB 1234 has left and should reach the site around 3 pm.'), 'queued/auto_allowed', 'F1 a message without amounts to a site contact who agreed goes out by itself (queued: auto_allowed)');
select is((select category || ':' || source || ':' || (contact_id = tests.rid('sc1'))::text from public.outbox_messages where id = tests.rid('m1')), 'order_status:system:true', 'F2 it is an order status, made by the system, to the SITE CONTACT (not to the lead''s contact)');
select is((select (body like '%AI assistant%' or body like '%assistant%')::text from public.outbox_messages where id = tests.rid('m1')), 'true', 'F3 and the first message to a person carries the AI-assistant line, as every first message does');
select is(pg_temp.msg('a_sales', 'm2', 't1', 'The truck has left. Please pay Rs 5,000 on delivery.'), 'needs_approval/money', 'F4 a text with an amount in it waits for a person (money words): the policy is the outbox''s, not ours');
select is(pg_temp.msg('a_sales', 'm1', 't1', 'The truck TS09 AB 1234 has left and should reach the site around 3 pm.'), 'queued/auto_allowed', 'F5 the same message again replays');
select is(pg_temp.val('a_sales', format($$select public.trip_update_submit(%L, %L, %L, 'A different text', 'en')::text$$, tests.rid('m1'), tests.tid('a'), tests.rid('t1'))), 'ERR:23505', 'F6 other words under a used message id conflict');
-- the second site contact never agreed: the consent rule blocks it, exactly as for any customer
do $do$ begin perform pg_temp.try('a_owner', format($$select public.trip_update(%L, %L, date '2026-10-27', null, null, null, null, %L)$$, tests.tid('a'), tests.rid('t4'), tests.rid('sc2'))); end $do$;
select is(pg_temp.msg('a_sales', 'm3', 't4', 'The truck is loaded and will leave soon.'), 'blocked/no_opt_in', 'F7 a site contact who never agreed to WhatsApp is not messaged (blocked: no_opt_in)');
select is(pg_temp.val('a_sales', format($$select public.trip_update_submit(%L, %L, %L, 'Truck left', 'en')::text$$, gen_random_uuid(), tests.tid('a'), tests.rid('t3'))), 'ERR:SM775', 'F8 a trip with no site contact has nobody to tell (SM775)');
select is(pg_temp.val('a_viewer', format($$select public.trip_update_submit(%L, %L, %L, 'Truck left', 'en')::text$$, gen_random_uuid(), tests.tid('a'), tests.rid('t1'))), 'ERR:42501', 'F9 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($$select public.trip_update_submit(%L, %L, %L, 'Truck left', 'en')::text$$, gen_random_uuid(), tests.tid('a'), tests.rid('t1'))), 'ERR:42501', 'F10 DENY: another business');
select is(pg_temp.val('a_sales', format($$select public.trip_update_submit(%L, %L, %L, 'x', 'en')::text$$, gen_random_uuid(), tests.tid('a'), tests.rid('t1'))), 'ERR:22023', 'F11 a one-letter text is invalid');
select is(pg_temp.val('a_sales', format($$select public.trip_update_submit(%L, %L, %L, 'Truck left', 'xx')::text$$, gen_random_uuid(), tests.tid('a'), tests.rid('t1'))), 'ERR:22023', 'F12 a language outside the five is invalid');
-- STOP: a site contact who asks us to stop is not messaged again
do $do$ begin perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('sc1'))); end $do$;
select is(pg_temp.msg('a_sales', 'm4', 't1', 'Thank you, the delivery is complete.'), 'blocked/stopped', 'F13 a site contact who asked us to stop is never messaged (blocked: stopped)');

-- ============================================================================ G. the day board, reads, who sees what
select is(pg_temp.val('a_sales', format($$select jsonb_array_length(public.trips_list(%L, %L))::text$$, tests.tid('a'), tests.rid('ord'))), '4', 'G1 the trips of an order');
select is(pg_temp.val('a_sales', format($$select (public.trips_list(%L, null, date '2026-10-20'))->0->>'trip_no'$$, tests.tid('a'))), '1', 'G2 the day board: trips on 20 Oct');
select is(pg_temp.val('a_sales', format($$select jsonb_array_length(public.trips_list(%L, null, null, 'cancelled'))::text$$, tests.tid('a'))), '1', 'G3 by status: one cancelled');
select is(pg_temp.val('a_sales', format($$select (public.trip_get(%L, %L)->'proof'->>'received_by')$$, tests.tid('a'), tests.rid('t1'))), 'Site supervisor', 'G4 a trip carries its proof');
select is(pg_temp.val('a_sales', format($$select jsonb_array_length(public.trip_get(%L, %L)->'events')::text$$, tests.tid('a'), tests.rid('t1'))), '4', 'G5 and its history');
select is(pg_temp.val('a_viewer', format($$select public.trips_list(%L)::text$$, tests.tid('a'))), 'ERR:42501', 'G6 DENY: a Viewer reads no trip');
select is(pg_temp.val('b_owner', format($$select public.trips_list(%L)::text$$, tests.tid('a'))), 'ERR:42501', 'G7 DENY: another business');
select is(pg_temp.val('a_viewer', format($$select count(*)::text from public.delivery_trips where tenant_id = %L$$, tests.tid('a'))), '0', 'G8 and the table shows a Viewer nothing');
select is(pg_temp.val('b_owner', format($$select count(*)::text from public.delivery_trips where tenant_id = %L$$, tests.tid('a'))), '0', 'G9 nor another business');
select is(pg_temp.val('a_sales', format($$select count(*)::text from public.delivery_trips where tenant_id = %L$$, tests.tid('a'))), '4', 'G10 Sales see the four');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'delivery_trip'), 12::bigint, 'G11 every change of a trip is in the audit trail');
select is((select coalesce(bool_or(new_values::text like '%TS09%' or new_values::text like '%98480%' or new_values::text like '%Ramesh%'), false) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'delivery_trip'), false, 'G12 the trail names the personal columns (vehicle, driver, phone) but never holds them');
select is((select count(*) from erasure.registry where table_name in ('delivery_trips', 'delivery_proofs', 'customer_sites')), 25::bigint, 'G13 the personal columns of trips, proofs and sites are in the erasure registry');

select * from finish();
rollback;
