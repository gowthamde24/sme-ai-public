-- Job CN (ADR 0085), part 3: MATERIAL QUOTES. The database builds the calculator's request from its own sources, recomputes the figures (app.cq_compute, the SQL twin of the calculator) and refuses any quote that differs.
--   A the owner's quoting rules (a policy version)   B the request the database builds, the worked example by hand, and every missing input refused   C the draft: tampering of every kind is refused (SM761)
--   D approval: who, the second factor, flags, replay, staleness    E reject, supersede    F the order from an approved quote, the credit warning, the follow-up stop
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');

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
-- the SQLSTATE and DETAIL of a statement run as a user (superuser inside a block, so the DETAIL is readable)
create function pg_temp.detail(p_user text, p_sql text) returns text language plpgsql as $$
declare v_state text; v_detail text;
begin
  perform tests.as_aal('aal2');
  perform tests.set_identity(tests.uid(p_user));
  begin
    execute p_sql;
    reset role;
    return 'ok';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    v_state := sqlstate;
    reset role;
    return v_state || case when coalesce(v_detail, '') <> '' then ':' || v_detail else '' end;
  end;
end $$;
create function pg_temp.fld(p_enq uuid, p_line int, p_key text, p_code text, p_int bigint, p_text text, p_basis text, p_quote text) returns text language plpgsql as $$
declare
  b text := (select body from public.enquiries where id = p_enq);
  s int := position(p_quote in b) - 1;
begin
  return pg_temp.try('a_owner', format($q$select public.add_requirement_field(%L, %L, %L, %L, %L, null, %L, %L, %L, %L, %L)$q$, p_enq, p_line, p_key, p_code, p_int, p_text, p_basis, p_quote, s, s + char_length(p_quote)));
end $$;
create function pg_temp.confirm(p_enq uuid) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select public.confirm_requirement((select id from public.requirements where tenant_id = %L and enquiry_id = %L))->>'status'$q$, tests.tid('a'), p_enq))
$$;
create function pg_temp.req(p_enq uuid) returns uuid language sql as $$ select id from public.requirements where tenant_id = tests.tid('a') and enquiry_id = p_enq $$;
create function pg_temp.build(p_req uuid, p_picks jsonb, p_site uuid default null) returns jsonb language sql as $$
  select app.cq_build(tests.tid('a'), p_req, app.quote_today(), app.material_active_policy(tests.tid('a'), app.quote_today()), p_picks, p_site)
$$;
-- what the engine would answer for a build (the calculator's own result shape, with the figures the database computed standing in for the engine's)
create function pg_temp.result(p_build jsonb, p_hash text) returns jsonb language sql as $$
  select (p_build -> 'core') || jsonb_build_object('status', 'draft', 'engine_version', '1.0.0', 'canonical_hash', p_hash,
         'flags', jsonb_build_object('needs_owner_approval', true, 'reasons', p_build -> 'flag_list'), 'trace', '[]'::jsonb,
         'range', jsonb_build_object('total_low', 0, 'total_high', (p_build -> 'core' -> 'totals' ->> 'total')::bigint))
$$;
-- a draft as a person: the request, the result and the hash exactly as the API would send them; p_tamper lets a test change one thing
create function pg_temp.draft(p_user text, p_qid uuid, p_req uuid, p_picks jsonb, p_site uuid default null, p_tamper text default null) returns text language plpgsql as $$
declare
  b jsonb := pg_temp.build(p_req, p_picks, p_site);
  rt text := (b -> 'request')::text;
  h text := app.cq_request_hash('1.0.0', rt);
  res jsonb;
begin
  res := pg_temp.result(b, case when p_tamper = 'hash' then repeat('0', 64) else h end);
  if p_tamper = 'total' then res := jsonb_set(res, '{totals,total}', to_jsonb((res #>> '{totals,total}')::bigint + 1)); end if;
  if p_tamper = 'line' then res := jsonb_set(res, '{lines,0,pieces}', to_jsonb((res #>> '{lines,0,pieces}')::bigint - 1)); end if;
  if p_tamper = 'trips' then res := jsonb_set(res, '{trips}', to_jsonb((res ->> 'trips')::bigint + 1)); end if;
  if p_tamper = 'flags' then res := jsonb_set(res, '{flags,reasons}', '[{"code": "CREDIT_LIMIT_EXCEEDED"}]'::jsonb); end if;
  if p_tamper = 'noflags' then res := jsonb_set(res, '{flags,reasons}', '[]'::jsonb); end if;
  if p_tamper = 'extra' then res := res || '{"surprise": 1}'::jsonb; end if;
  if p_tamper = 'status' then res := jsonb_set(res, '{status}', '"rejected"'); end if;
  if p_tamper = 'price' then rt := replace(rt, '"unit_price_paise": 6500', '"unit_price_paise": 100'); end if;
  return pg_temp.try(p_user, format($q$select public.material_quote_draft(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)$q$, p_qid, tests.tid('a'), p_req, p_picks::text, p_site,
                                    case when p_tamper = 'engine' then '9.9.9' else '1.0.0' end, rt, res::text));
end $$;
create function pg_temp.qstatus(p_qid uuid) returns text language sql as $$ select status::text from public.material_quotes where id = p_qid $$;

-- ---------------------------------------------------------------- the business: a customer, a site 22 km from the yard, three items, the owner's rules
insert into public.companies (id, tenant_id, name) values (tests.rid('a_company2'), tests.tid('a'), 'Contractor Two');
do $do$ begin perform pg_temp.try('a_owner', format($$select public.site_save(%L, %L, %L, 'Kukatpally villa', 'Plot 4', 'Hyderabad', '500072', null, null, 22, 14, false, true, null, null, true)$$, tests.rid('site1'), tests.tid('a'), tests.rid('a_company'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.site_save(%L, %L, %L, 'Yard without a distance', null, null, null, null, null, null, null, false, false, null, null, true)$$, tests.rid('site2'), tests.tid('a'), tests.rid('a_company'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Paver block 80 mm grey', 'sq_ft', null, 'in_stock', false, 6500, true)$$, tests.rid('paver'), tests.tid('a'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"pieces_per_area": 4.5, "pieces_per_pallet": 500, "gst_rate_percent": 18, "hsn_code": "68101990"}'::jsonb)$$, tests.tid('a'), tests.rid('paver'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Cement 53 grade 50 kg bag', 'bag', null, 'in_stock', false, 38000, true)$$, tests.rid('cement'), tests.tid('a'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"gst_rate_percent": 28, "hsn_code": "2523", "minimum_order": 100}'::jsonb)$$, tests.tid('a'), tests.rid('cement'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Kerb stone', 'piece', 'sq_ft', 'in_stock', false)$$, tests.rid('kerb'), tests.tid('a'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"gst_rate_percent": 18, "pieces_per_area": 1}'::jsonb)$$, tests.tid('a'), tests.rid('kerb'))); end $do$;
-- enquiry 1: 1,000 sq ft of the paver (the worked example); enquiry 2: the paver and 120 bags of cement; enquiry 3: a line with no GST rate on its item
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values
  (tests.rid('enq1'), tests.tid('a'), tests.rid('a_lead'), 'whatsapp', now() - interval '2 hours', 'Need 1000 sq ft paver blocks 80 mm for the driveway at Kukatpally'),
  (tests.rid('enq2'), tests.tid('a'), tests.rid('a_lead'), 'whatsapp', now() - interval '2 hours', 'Need 1000 sq ft paver blocks and 120 bags of cement'),
  (tests.rid('enq3'), tests.tid('a'), tests.rid('a_lead'), 'whatsapp', now() - interval '2 hours', 'Need 50 kerb stones'),
  (tests.rid('enq4'), tests.tid('a'), tests.rid('a_lead'), 'whatsapp', now() - interval '2 hours', 'Need a 40 ft by 25 ft yard paved with paver blocks, laying needed');
do $do$ begin perform pg_temp.fld(tests.rid('enq1'), 1, 'product_type', 'paver_block', null, null, null, 'paver blocks'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq1'), 1, 'area', null, 100000, null, 'sq_ft', '1000 sq ft'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq2'), 1, 'product_type', 'paver_block', null, null, null, 'paver blocks'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq2'), 1, 'area', null, 100000, null, 'sq_ft', '1000 sq ft'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq2'), 2, 'product_type', 'cement', null, null, null, 'cement'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq2'), 2, 'quantity', null, 120, null, 'bag', '120 bags'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq3'), 1, 'product_type', 'kerb_stone', null, null, null, 'kerb stones'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq3'), 1, 'quantity', null, 50, null, 'piece', '50'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq4'), 1, 'product_type', 'paver_block', null, null, null, 'paver blocks'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq4'), 1, 'length', null, 4000, null, 'ft', '40 ft'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq4'), 1, 'width', null, 2500, null, 'ft', '25 ft'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq4'), null, 'laying', 'yes', null, null, null, 'laying needed'); end $do$;
select is(pg_temp.confirm(tests.rid('enq1')), 'confirmed', 'S1 (setup) the first requirement is confirmed');
do $do$ begin perform pg_temp.confirm(tests.rid('enq2')); end $do$;
do $do$ begin perform pg_temp.confirm(tests.rid('enq3')); end $do$;
do $do$ begin perform pg_temp.confirm(tests.rid('enq4')); end $do$;
create function pg_temp.picks(p_items text[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('line_no', n, 'item_id', tests.rid(p_items[n])) order by n) from generate_series(1, cardinality(p_items)) n
$$;

-- ============================================================================ A. the owner's quoting rules
create function pg_temp.pol(p_user text, p_id uuid, p_policy text, p_effective text default null) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.material_policy_create(%L, %L, %L, %L::jsonb)$q$, p_id, tests.tid('a'), coalesce(p_effective, app.quote_today()::text)::date, p_policy))
$$;
select is(pg_temp.val('a_owner', format($$select public.material_policy_get(%L)->>'current'$$, tests.tid('a'))), null, 'A1 before the Owner has set any rules there are none in force');
select is(pg_temp.pol('a_owner', tests.rid('pol0'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'), 'ok', 'A2 ALLOW: the Owner saves rules (aal2): wastage 5 %, no freight, advance 50 %');
select is(pg_temp.pol('a_admin', tests.rid('pol1'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'), '42501', 'A3 DENY: the Admin (money rules are the Owner''s)');
select is(pg_temp.pol('a_sales', tests.rid('pol1'), '{}'), '42501', 'A4 DENY: Sales');
select is(pg_temp.at('aal1', 'a_owner', format($$select public.material_policy_create(%L, %L, current_date, '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'::jsonb)$$, tests.rid('pol1'), tests.tid('a'))), 'SM306', 'A5 DENY: without a second factor (SM306)');
select is(pg_temp.pol('a_owner', tests.rid('pol1'), '{"default_wastage_bps":500}'), '22023', 'A6 rules with a missing key are invalid');
select is(pg_temp.pol('a_owner', tests.rid('pol1'), '{"default_wastage_bps":9000,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'), '22023', 'A7 a wastage over 50 % is invalid');
select is(pg_temp.pol('a_owner', tests.rid('pol1'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"per_trip","truck_capacity":2500,"capacity_basis":"pieces","rate_per_trip_paise":350000},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'), '22023', 'A8 freight without its GST rate is invalid: the rate is never assumed');
select is(pg_temp.pol('a_owner', tests.rid('pol1'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"per_km_slab","gst_bps":1800,"slabs":[{"up_to_km":10,"charge_paise":1},{"up_to_km":10,"charge_paise":2}]},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'), '22023', 'A9 slabs that do not rise are invalid');
select is(pg_temp.pol('a_owner', tests.rid('pol1'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"floor"}'), '22023', 'A10 a rounding mode outside the closed list is invalid');
select is(pg_temp.pol('a_owner', tests.rid('pol1'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up","surprise":1}'), '22023', 'A11 an unknown key is invalid');
select is(pg_temp.pol('a_owner', tests.rid('pol0'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'), 'ok', 'A12 an exact repeat replays');
select is(pg_temp.pol('a_owner', tests.rid('pol0'), '{"default_wastage_bps":600,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'), '23505', 'A13 other rules under the same id conflict');
select is(pg_temp.pol('a_owner', tests.rid('pol1'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"none"},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}', '2020-01-01'), '22023', 'A14 rules cannot take effect in the past');
-- the rules the worked example uses: 5 % wastage, a truck carries 2,500 pieces at Rs 3,500 a trip + 18 % GST, 50 % advance, paid on delivery, valid 7 days
select is(pg_temp.pol('a_owner', tests.rid('pol2'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"per_trip","capacity_basis":"pieces","truck_capacity":2500,"rate_per_trip_paise":350000,"gst_bps":1800},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}'), 'ok', 'A15 the second version of the rules');
select is((select version_no from public.material_quote_policies where id = tests.rid('pol2')), 2, 'A16 is version 2');
select is(app.material_active_policy(tests.tid('a'), app.quote_today()), tests.rid('pol2'), 'A17 and is the one in force');
select is(pg_temp.val('a_sales', format($$select public.material_policy_get(%L)->'current'->>'version_no'$$, tests.tid('a'))), '2', 'A18 Sales read the rules in force');
select is(pg_temp.val('a_viewer', format($$select public.material_policy_get(%L)->>'current'$$, tests.tid('a'))), 'ERR:42501', 'A19 DENY: a Viewer');
select is(pg_temp.sc(format($$update public.material_quote_policies set policy = '{}' where id = %L$$, tests.rid('pol2'))), '42501', 'A20 a version of the rules never changes');
select is(pg_temp.sc($$delete from public.material_quote_policies$$), '42501', 'A21 nor is deleted');
select is(pg_temp.pol('b_owner', tests.rid('pol9'), '{}'), '42501', 'A22 DENY: another business');

-- ============================================================================ B. the request the database builds
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{core,totals,total}'), '8879500', 'B1 the worked example: 1,000 sq ft of the 80 mm paver at 4.5 pieces per sq ft, 5 % wastage, 2 trips = Rs 88,795.00');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{core,lines,0,pieces}'), '4725', 'B2 4,725 pieces');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{core,lines,0,pallets}'), '10', 'B3 10 pallets');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{core,trips}'), '2', 'B4 two trips');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{core,totals,transport}'), '700000', 'B5 freight Rs 7,000');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{core,payment_terms,advance_amount}'), '4439750', 'B6 advance Rs 44,397.50');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{request,lines,0,gst_bps}'), '1800', 'B7 the GST rate in the request is the one the owner entered');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{request,lines,0,hsn}'), '68101990', 'B8 and so is the HSN code');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{request,as_of}'), app.quote_today()::text, 'B9 the date is today in India');
select is((pg_temp.build(pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])) #>> '{valid_until}'), (app.quote_today() + 7)::text, 'B10 valid for seven days');
-- two lines: the paver and 120 bags of cement (a direct line; the bags do not count in the truck's pieces)
select is((pg_temp.build(pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver', 'cement'])) #>> '{core,lines,1,material}'), '4560000', 'B11 120 bags at Rs 380 = Rs 45,600');
select is((pg_temp.build(pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver', 'cement'])) #>> '{core,lines,1,tax}'), '1276800', 'B12 GST 28 % on the bags');
select is((pg_temp.build(pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver', 'cement'])) #> '{flag_list}')::text, '[{"sku": "' || tests.rid('cement') || '", "code": "LINE_NOT_COUNTED_IN_TRIPS"}]', 'B13 and the quote says the bags were not counted in the trips');
select is((pg_temp.build(pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver', 'cement'])) #>> '{core,totals,total}'), (8879500 + 4560000 + 1276800)::text, 'B14 the total is the paver quote plus the bags and their GST');
-- length x width: 40 ft x 25 ft = 1,000.00 sq ft, laying needed (no laying rate in the rules yet: the engine would reject)
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq4')), pg_temp.picks(array['paver'])::text)), 'SM766:LAYING_RATE_MISSING', 'B15 laying is needed but the owner set no laying rate: refused with the calculator''s own code (SM766)');
-- every missing input is refused, with the missing thing named
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, '[]'::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')))), 'SM762:pick', 'B16 no pick: SM762 (pick)');
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq3')), pg_temp.picks(array['kerb'])::text)), 'SM762:price', 'B17 a kerb the owner has not priced yet: SM762 (price)');
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver'])::text)), 'SM762:pick', 'B18 a line of the requirement with no pick: SM762 (pick)');
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')), jsonb_build_array(jsonb_build_object('line_no', 1, 'item_id', gen_random_uuid()))::text)), 'SM762:pick', 'B19 a pick that is not an item of the business: SM762 (pick)');
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')), jsonb_build_array(jsonb_build_object('line_no', 1, 'item_id', tests.rid('paver')), jsonb_build_object('line_no', 3, 'item_id', tests.rid('cement')))::text)), 'SM762:pick', 'B20 a pick for a line the requirement does not have: SM762 (pick)');
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq2')), jsonb_build_array(jsonb_build_object('line_no', 1, 'item_id', tests.rid('paver')), jsonb_build_object('line_no', 2, 'item_id', tests.rid('paver')))::text)), 'SM762:duplicate_item', 'B21 the same item twice: SM762 (duplicate_item)');
-- the owner has not entered the price / the GST rate / the coverage: the quote is refused until they do
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Cement 53 grade 50 kg bag', 'bag', null, 'in_stock', false, null, true)$$, tests.rid('cement'), tests.tid('a'))); end $do$;
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver', 'cement'])::text)), 'SM762:price', 'B22 an item with no price: SM762 (price)');
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Cement 53 grade 50 kg bag', 'bag', null, 'in_stock', false, 38000, true)$$, tests.rid('cement'), tests.tid('a'))); end $do$;
do $do$ begin perform pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"gst_rate_percent": null}'::jsonb)$$, tests.tid('a'), tests.rid('cement'))); end $do$;
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver', 'cement'])::text)), 'SM762:gst_rate', 'B23 an item whose GST rate was cleared: SM762 (gst_rate), never a default rate');
do $do$ begin perform pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"gst_rate_percent": 28}'::jsonb)$$, tests.tid('a'), tests.rid('cement'))); end $do$;
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['cement'])::text)), 'SM762:unit', 'B24 a bag cannot answer a measure in sq ft: SM762 (unit)');
select is(pg_temp.detail('a_viewer', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])::text)), '42501', 'B25 DENY: a Viewer');
select is(pg_temp.detail('b_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])::text)), '42501', 'B26 DENY: another business');
select is(pg_temp.val('a_owner', format($$select (public.material_quote_build(%L, %L, %L::jsonb) #>> '{core,totals,total}')$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])::text)), '8879500', 'B27 ALLOW: the Owner, through the function, gets the same figure');
select is(pg_temp.val('a_sales', format($$select (public.material_quote_build(%L, %L, %L::jsonb) #>> '{core,totals,total}')$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])::text)), '8879500', 'B28 ALLOW: and Sales');
-- freight by the kilometre needs a distance: site 1 has 22 km, site 2 none
select is(pg_temp.pol('a_owner', tests.rid('pol3'), '{"default_wastage_bps":500,"round_to_pallet":false,"bill_wastage":true,"transport":{"kind":"per_km_slab","capacity_basis":"pieces","truck_capacity":2500,"gst_bps":1800,"slabs":[{"up_to_km":10,"charge_paise":250000},{"up_to_km":25,"charge_paise":400000},{"up_to_km":50,"charge_paise":650000}]},"advance_bps":5000,"credit_days":0,"validity_days":7,"rounding_mode":"half_up"}', (app.quote_today() + 1)::text), 'ok', 'B29 (setup) rules with freight by slabs take effect tomorrow');
select is(pg_temp.val('a_owner', format($$select (public.material_quote_build(%L, %L, %L::jsonb, %L) #>> '{core,totals,transport}')$$, tests.tid('a'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])::text, tests.rid('site1'))), '700000', 'B30 (the new rules are not in force yet: today the per-trip rule still applies, with the site given)');

-- ============================================================================ C. the draft: the engine answers, the database checks every figure
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'total'), 'SM761', 'C1 a total that is one paisa different is refused (SM761)');
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'line'), 'SM761', 'C2 a line quantity that differs is refused');
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'trips'), 'SM761', 'C3 a different number of trips is refused');
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'hash'), 'SM761', 'C4 a hash that is not the request''s is refused');
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'price'), 'SM761', 'C5 a request with another price than the owner''s is refused: nobody chooses a figure');
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'flags'), 'SM761', 'C6 a flag that is not derived is refused');
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'extra'), 'SM761', 'C7 a result with an extra key is refused');
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'status'), 'SM761', 'C8 a result that is not a draft is refused');
select is(pg_temp.draft('a_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver']), null, 'engine'), '22023', 'C9 an engine version nobody reviewed is invalid');
select is((select count(*) from public.material_quotes where tenant_id = tests.tid('a')), 0::bigint, 'C10 none of the refusals left a quote');
select is(pg_temp.draft('a_viewer', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])), '42501', 'C11 DENY: a Viewer');
select is(pg_temp.draft('b_owner', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])), '42501', 'C12 DENY: another business');
select is(pg_temp.draft('a_sales', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])), 'ok', 'C13 ALLOW: Sales makes the draft');
select is(pg_temp.qstatus(tests.rid('q1')), 'draft', 'C14 it is a draft');
select is((select total_paise || ':' || advance_paise || ':' || balance_paise || ':' || trips from public.material_quotes where id = tests.rid('q1')), '8879500:4439750:4439750:2', 'C15 the figures are the database''s: Rs 88,795.00, advance and balance equal, two trips');
select is((select count(*) from public.material_quote_lines where quote_id = tests.rid('q1')), 1::bigint, 'C16 one line');
select is((select pieces || ':' || pallets || ':' || delivered_area_x100 || ':' || material_paise || ':' || tax_paise || ':' || gst_bps || ':' || hsn from public.material_quote_lines where quote_id = tests.rid('q1')), '4725:10:105000:6825000:1228500:1800:68101990', 'C17 the line holds what the delivery plan needs: pieces, pallets, the area covered, the material and its GST');
select is((select needs_owner_approval from public.material_quotes where id = tests.rid('q1')), false, 'C18 nothing is flagged');
select is(pg_temp.draft('a_sales', tests.rid('q1'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])), 'ok', 'C19 the same draft again replays');
select is((select count(*) from public.material_quotes where tenant_id = tests.tid('a')), 1::bigint, 'C20 (still one quote)');
select is(pg_temp.draft('a_sales', tests.rid('q1'), pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver', 'cement'])), '23505', 'C21 the same id for another requirement is the constant conflict');
select is(pg_temp.draft('a_owner', tests.rid('q2'), pg_temp.req(tests.rid('enq1')), pg_temp.picks(array['paver'])), 'ok', 'C22 a new draft of the same requirement ...');
select is(pg_temp.qstatus(tests.rid('q1')) || ':' || pg_temp.qstatus(tests.rid('q2')), 'superseded:draft', 'C23 ... supersedes the old one: one draft at a time');
select is((select quote_no from public.material_quotes where id = tests.rid('q2')), 2, 'C24 the quote number is the business''s next');
select is(pg_temp.sc(format($$update public.material_quotes set total_paise = 1 where id = %L$$, tests.rid('q2'))), '42501', 'C25 the content of a quote never changes (any session)');
select is(pg_temp.sc(format($$delete from public.material_quotes where id = %L$$, tests.rid('q2'))), '42501', 'C26 a quote is never deleted');
select is(pg_temp.sc(format($$update public.material_quote_lines set pieces = 1 where quote_id = %L$$, tests.rid('q2'))), '42501', 'C27 nor are its lines changed');
select is(pg_temp.try('a_owner', format($$update public.material_quotes set status = 'approved' where id = %L$$, tests.rid('q2'))), '42501', 'C28 DENY: a client cannot approve by writing the row');
select is(pg_temp.sc(format($$update public.requirements set status = 'discarded' where id = %L$$, pg_temp.req(tests.rid('enq1')))), 'SM212', 'C29 a requirement with a live quote cannot be discarded (SM212)');
-- a requirement that is not confirmed cannot be quoted
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (tests.rid('enq5'), tests.tid('a'), tests.rid('a_lead'), 'whatsapp', now() - interval '1 hour', 'Need 300 sq ft paver blocks');
do $do$ begin perform pg_temp.fld(tests.rid('enq5'), 1, 'product_type', 'paver_block', null, null, null, 'paver blocks'); end $do$;
do $do$ begin perform pg_temp.fld(tests.rid('enq5'), 1, 'area', null, 30000, null, 'sq_ft', '300 sq ft'); end $do$;
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq5')), pg_temp.picks(array['paver'])::text)), 'SM767', 'C30 a requirement still in draft cannot be quoted (SM767)');
-- the quote with the bags carries a flag
select is(pg_temp.draft('a_owner', tests.rid('q3'), pg_temp.req(tests.rid('enq2')), pg_temp.picks(array['paver', 'cement'])), 'ok', 'C31 a quote whose bags are not counted in the trips is a draft ...');
select is((select needs_owner_approval::text || ':' || array_to_string(engine_flags, ',') from public.material_quotes where id = tests.rid('q3')), 'true:LINE_NOT_COUNTED_IN_TRIPS', 'C32 ... and carries its flag: the Owner decides');

-- ============================================================================ D. approval
select is(pg_temp.try('a_sales', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q2'), (select canonical_hash from public.material_quotes where id = tests.rid('q2')))), '42501', 'D1 DENY: Sales cannot approve');
select is(pg_temp.try('a_viewer', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q2'), (select canonical_hash from public.material_quotes where id = tests.rid('q2')))), '42501', 'D2 DENY: a Viewer');
select is(pg_temp.try('b_owner', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q2'), (select canonical_hash from public.material_quotes where id = tests.rid('q2')))), '42501', 'D3 DENY: another business');
select is(pg_temp.at('aal1', 'a_admin', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q2'), (select canonical_hash from public.material_quotes where id = tests.rid('q2')))), 'SM306', 'D4 DENY: no second factor (SM306)');
select is(pg_temp.try('a_admin', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q2'), repeat('0', 64))), 'SM761', 'D5 an approver''s recomputation that differs from the quote''s hash is refused (SM761)');
select is(pg_temp.try('a_admin', format($$select public.material_quote_approve(%L, 'not a hash')$$, tests.rid('q2'))), '22023', 'D6 a malformed hash is invalid');
select is(pg_temp.try('a_admin', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q3'), (select canonical_hash from public.material_quotes where id = tests.rid('q3')))), 'SM765', 'D7 an Admin cannot approve a FLAGGED quote (SM765): the Owner alone');
select is(pg_temp.try('a_admin', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q2'), (select canonical_hash from public.material_quotes where id = tests.rid('q2')))), 'ok', 'D8 ALLOW: an Admin approves an unflagged quote at aal2');
select is(pg_temp.qstatus(tests.rid('q2')), 'approved', 'D9 it is approved');
select is((select approved_by from public.material_quotes where id = tests.rid('q2')), tests.uid('a_admin'), 'D10 by the Admin');
select is(pg_temp.try('a_admin', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q2'), (select canonical_hash from public.material_quotes where id = tests.rid('q2')))), 'ok', 'D11 the same approval again replays');
select is(pg_temp.try('a_owner', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q2'), (select canonical_hash from public.material_quotes where id = tests.rid('q2')))), 'SM763', 'D12 another person approving an approved quote is told it is not a draft (SM763)');
select is(pg_temp.try('a_owner', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q3'), (select canonical_hash from public.material_quotes where id = tests.rid('q3')))), 'ok', 'D13 ALLOW: the Owner approves the flagged quote');
select is(pg_temp.qstatus(tests.rid('q3')) || ':' || pg_temp.qstatus(tests.rid('q2')), 'approved:approved', 'D14 both are approved (different requirements)');
-- stale: a price changed after the draft
select is(pg_temp.detail('a_owner', format($$select public.material_quote_build(%L, %L, %L::jsonb)$$, tests.tid('a'), pg_temp.req(tests.rid('enq3')), pg_temp.picks(array['kerb'])::text)), 'SM762:price', 'D15 (setup) a kerb with no price cannot be quoted yet (SM762)');
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Kerb stone', 'piece', null, 'in_stock', false, 9500, true)$$, tests.rid('kerb'), tests.tid('a'))); end $do$;
select is(pg_temp.draft('a_owner', tests.rid('q4'), pg_temp.req(tests.rid('enq3')), pg_temp.picks(array['kerb'])), 'ok', 'D17 with the unit right the kerb quote is a draft (50 pieces at Rs 95 + 18 % GST + one trip)');
select is((select total_paise from public.material_quotes where id = tests.rid('q4')), (50 * 9500 + 50 * 9500 * 18 / 100 + 350000 + 350000 * 18 / 100)::bigint, 'D18 Rs 4,750 + GST Rs 855 + freight Rs 3,500 + GST Rs 630 = Rs 9,735');
do $do$ begin perform pg_temp.try('a_owner', format($$select public.catalogue_material_save(%L, %L, 'Kerb stone', 'piece', null, 'in_stock', false, 9900, true)$$, tests.rid('kerb'), tests.tid('a'))); end $do$;
select is(pg_temp.try('a_owner', format($$select public.material_quote_approve(%L, %L)$$, tests.rid('q4'), (select canonical_hash from public.material_quotes where id = tests.rid('q4')))), 'SM764', 'D19 the owner changed the price after the draft: the quote is stale (SM764)');
select is(pg_temp.qstatus(tests.rid('q4')), 'draft', 'D20 and stays a draft');
-- stale: a customer who paid or owes more does NOT make a quote stale (the snapshot is in the request)
select is(pg_temp.try('a_owner', format($$select public.invoice_record(%L, %L, %L, 'LATE-1', current_date, current_date, 99900000)$$, tests.rid('late1'), tests.tid('a'), tests.rid('a_company'))), 'ok', 'D21 (setup) the customer is invoiced Rs 9,99,000 after the drafts were made');
select is(pg_temp.try('a_owner', format($$select public.material_quote_reject(%L, 'wrong_prices')$$, tests.rid('q4'))), 'ok', 'D22 the stale draft is rejected');

-- ============================================================================ E. reject, and the rules about who
select is(pg_temp.draft('a_sales', tests.rid('q5'), pg_temp.req(tests.rid('enq5')), pg_temp.picks(array['paver'])), 'SM767', 'E1 (setup) the requirement is still a draft');
select is(pg_temp.try('a_sales', format($$select public.material_quote_reject(%L, 'other')$$, tests.rid('q4'))), '42501', 'E2 DENY: Sales cannot reject a quote that is not theirs ...');
select is(pg_temp.try('a_owner', format($$select public.material_quote_reject(%L, 'wrong_prices')$$, tests.rid('q4'))), 'ok', 'E3 ... the Owner''s repeat of a rejection replays');
select is(pg_temp.try('a_owner', format($$select public.material_quote_reject(%L, 'madeup')$$, tests.rid('q2'))), '22023', 'E4 a reason outside the closed list is invalid');
select is(pg_temp.try('a_owner', format($$select public.material_quote_reject(%L, 'other')$$, tests.rid('q2'))), 'SM763', 'E5 an approved quote is not rejected (SM763): it is withdrawn another way');
select is(pg_temp.try('a_viewer', format($$select public.material_quote_reject(%L, 'other')$$, tests.rid('q4'))), '42501', 'E6 DENY: a Viewer');

-- ============================================================================ F. the order
select is(pg_temp.try('a_owner', format($$select public.create_order_policy_version(%L, %L, %L::date, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$$, tests.rid('opol'), tests.tid('a'), app.quote_today())), 'ok', 'F1 (setup) the order rules');
select is(pg_temp.try('a_sales', format($$select public.create_order_from_material_quote(%L, %L)$$, tests.rid('o1'), tests.rid('q2'))), '42501', 'F2 DENY: Sales cannot make the order (money)');
select is(pg_temp.at('aal1', 'a_owner', format($$select public.create_order_from_material_quote(%L, %L)$$, tests.rid('o1'), tests.rid('q2'))), 'SM306', 'F3 DENY: without a second factor');
select is(pg_temp.try('b_owner', format($$select public.create_order_from_material_quote(%L, %L)$$, tests.rid('o1'), tests.rid('q2'))), '42501', 'F4 DENY: another business');
select is(pg_temp.try('a_owner', format($$select public.create_order_from_material_quote(%L, %L)$$, tests.rid('o2'), tests.rid('q1'))), 'SM230', 'F5 a superseded quote is not approved (SM230)');
select is(pg_temp.try('a_owner', format($$select public.create_order_from_material_quote(%L, %L)$$, tests.rid('o1'), tests.rid('q2'))), 'ok', 'F6 ALLOW: the Owner makes the order from the approved quote');
select is((select order_total_paise || ':' || advance_paise || ':' || state || ':' || (quote_id is null)::text || ':' || (material_quote_id = tests.rid('q2'))::text from public.orders where id = tests.rid('o1')), '8879500:4439750:quote_approved:true:true', 'F7 the order holds the quote''s figures, in the first state, linked to the material quote (and to no saree quote)');
select is((select count(*) from public.order_events where order_id = tests.rid('o1')), 1::bigint, 'F8 the first event is recorded');
select is(pg_temp.try('a_owner', format($$select public.create_order_from_material_quote(%L, %L)$$, tests.rid('o1'), tests.rid('q2'))), 'ok', 'F9 the same request again replays');
select is(pg_temp.try('a_owner', format($$select public.create_order_from_material_quote(%L, %L)$$, tests.rid('o9'), tests.rid('q2'))), 'SM231', 'F10 a second order for one quote is refused (SM231)');
select is(pg_temp.val('a_owner', format($$select (public.create_order_from_material_quote(%L, %L) -> 'credit' ->> 'exceeded')$$, tests.rid('o3'), tests.rid('q3'))), 'false', 'F11 the order answers with the credit position: no limit is set, so no warning');
select is(pg_temp.try('a_owner', format($$select public.credit_limit_set(%L, %L, 50000000)$$, tests.tid('a'), tests.rid('a_company'))), 'ok', 'F12 (setup) the Owner sets a limit of Rs 5,00,000 for the customer, who owes Rs 9,99,000');
select is(pg_temp.try('a_owner', format($$select public.invoice_record(%L, %L, %L, 'LATE-2', current_date, current_date, 100)$$, tests.rid('late2'), tests.tid('a'), tests.rid('a_company'))), 'ok', 'F13 (setup)');
select is(pg_temp.val('a_owner', format($$select (public.credit_check(%L, %L, 4439750) ->> 'exceeded')$$, tests.tid('a'), tests.rid('a_company'))), 'true', 'F14 a customer already over the limit is warned about a new order of any size');
select is(app.order_stops_followups(tests.rid('a_lead')), null, 'F15 an order that is only quote_approved stops no follow-up');
alter table public.orders disable trigger orders_guard_update;
update public.orders set state = 'accepted' where id = tests.rid('o3');
alter table public.orders enable trigger orders_guard_update;
select is(app.order_stops_followups(tests.rid('a_lead')), 'accepted', 'F16 an ACCEPTED order (the latest of the lead) of a material quote stops the lead''s follow-ups, as a saree order does');
select is(pg_temp.try('a_owner', format($$select public.material_quote_reject(%L, 'other')$$, tests.rid('q2'))), 'SM763', 'F17 the approved quote stays approved');
select is(pg_temp.sc(format($$update public.requirements set status = 'discarded' where id = %L$$, pg_temp.req(tests.rid('enq1')))), 'SM212', 'F18 and its requirement cannot be discarded while a quote is approved');

select * from finish();
rollback;
