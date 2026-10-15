-- Job CV (ADR 0088), part 2: ONE REPORTS API FOR EVERY PACK. The catalogue of reports a business may run (every module of a report on, the caller's role allowed), the one door `report_run`, the construction pack's five
-- reports worked by hand, the weekly summary in the one shape, and the gates.
--   A catalogue: by pack, by role    B construction.quotes    C revenue by product    D trips per day    E dues ageing    F top customers    G the weekly summary    H the door: roles, modules, windows, shape
-- The clock is NOT pinned: the fixture is made "today" and the windows default to the last 30 days up to today.
begin;
select no_plan();
-- setup calls that return a value are wrapped in q() so no row of theirs reaches the TAP stream (a bare `ok` line would be read as a test)
create function pg_temp.q(p_value anyelement) returns void language plpgsql as $$ begin end $$;
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');
select tests.er_plant('a');

create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.sqlstate_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  return r;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create function pg_temp.run(p_user text, p_code text, p_from text default null, p_to text default null, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.report_run(%L, %L, %s, %s)::text$q$, tests.tid(p_tenant), p_code,
                                    case when p_from is null then 'null' else format('date %L', p_from) end, case when p_to is null then 'null' else format('date %L', p_to) end))
$$;
create function pg_temp.kpi(p_json text, p_key text) returns text language sql as $$ select (select e ->> 'value' from jsonb_array_elements((p_json::jsonb) -> 'kpis') e where e ->> 'key' = p_key) $$;
create function pg_temp.rows(p_json text, p_table text) returns text language sql as $$ select ((select t -> 'rows' from jsonb_array_elements((p_json::jsonb) -> 'tables') t where t ->> 'key' = p_table))::text $$;
create function pg_temp.pts(p_json text, p_series text) returns text language sql as $$
  select (select jsonb_agg(p ->> 'value' order by p ->> 'day')::text from jsonb_array_elements((select s -> 'points' from jsonb_array_elements((p_json::jsonb) -> 'series') s where s ->> 'key' = p_series)) p)
$$;

-- ============================================================================ A. the catalogue of reports
create function pg_temp.cat(p_user text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select coalesce((select string_agg(e ->> 'code', ',' order by e ->> 'code') from jsonb_array_elements(public.report_catalogue(%L)) e), '')$q$, tests.tid(p_tenant)))
$$;
select is(pg_temp.cat('a_owner'), 'construction.dues_ageing,construction.quotes,construction.revenue_by_product,construction.top_customers,construction.trips_per_day,weekly.summary', 'A1 a construction business: its five reports and the weekly summary');
select is(pg_temp.cat('a_sales'), 'construction.dues_ageing,construction.quotes,construction.revenue_by_product,construction.top_customers,construction.trips_per_day', 'A2 Sales read the pack reports but not the weekly summary (the Owner''s and Admin''s)');
select is(pg_temp.cat('a_admin'), pg_temp.cat('a_owner'), 'A3 an Admin sees what the Owner sees');
select is(pg_temp.cat('a_viewer'), '', 'A4 a Viewer is offered none');
select is(pg_temp.cat('b_owner', 'b'), 'weekly.summary', 'A5 a textile business: the weekly summary (its other reports are the existing ones; no construction or school report is offered)');
select is(pg_temp.val('b_owner', format($q$select public.report_catalogue(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A6 DENY: another business''s catalogue');
select is(pg_temp.val('a_owner', format($q$select (public.report_catalogue(%L) -> 0 ->> 'title_key')$q$, tests.tid('a'))), 'report.construction.dues_ageing', 'A7 each report carries the key of its title (the words are the web''s, in four languages)');
select is(pg_temp.val('a_owner', format($q$select (select e ->> 'window' from jsonb_array_elements(public.report_catalogue(%L)) e where e ->> 'code' = 'construction.dues_ageing')$q$, tests.tid('a'))), 'day', 'A8 and the kind of window it takes (a day, a range, or a week)');
select tests.cp_pack('b', 'education');
select is(pg_temp.cat('b_owner', 'b'), 'education.collection,education.funnel,education.pending,education.today,weekly.summary', 'A9 a school: the four education reports and the weekly summary');
select is(pg_temp.val('b_owner', format($q$select (select e -> 'modules' from jsonb_array_elements(public.report_catalogue(%L)) e where e ->> 'code' = 'education.today')::text$q$, tests.tid('b'))), '["reports", "programmes", "fees"]', 'A10 the modules a report needs are named');
select tests.cp_pack('b', 'textiles');

-- ============================================================================ the fixture: a construction business with quotes, orders, trips and a ledger (all created today)
insert into public.catalogue_items (id, tenant_id, name, item_kind, sell_unit, area_unit, created_by) values
  (tests.rid('paver'), tests.tid('a'), 'Paver A', 'material', 'sq_ft', 'sq_ft', tests.uid('a_owner')),
  (tests.rid('kerb'), tests.tid('a'), 'Kerb B', 'material', 'piece', null, tests.uid('a_owner'));
insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips,
                                    material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, approved_by, approved_at, approved_hash)
select tests.rid('q' || n), tests.tid('a'), n, tests.rid('a_er_req'), tests.rid('a_er_enq'), tests.rid('a_lead'), 'superseded', tests.rid('a_er_mp'), '1.0.0', '{}', '{}', repeat(n::text, 64), current_date, current_date, 1,
       mat, tr, 0, 0, tax, mat + tr + tax, (mat + tr + tax) / 2, (mat + tr + tax) - (mat + tr + tax) / 2, false, tests.uid('a_owner'), now(), repeat('a', 64)
  from (values (2, 900000, 50000, 50000), (3, 1800000, 100000, 100000)) v(n, mat, tr, tax);
insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips,
                                    material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval)
values (tests.rid('q4'), tests.tid('a'), 4, tests.rid('a_er_req'), tests.rid('a_er_enq'), tests.rid('a_lead'), 'draft', tests.rid('a_er_mp'), '1.0.0', '{}', '{}', repeat('4', 64), current_date, current_date, 1,
        300000, 0, 0, 0, 0, 300000, 150000, 150000, false);
insert into public.material_quote_lines (tenant_id, quote_id, line_no, catalogue_item_id, name, mode, sold_per, unit_price_paise, gst_bps, billed_quantity, material_paise, tax_paise) values
  (tests.tid('a'), tests.rid('q2'), 1, tests.rid('paver'), 'Paver A', 'direct', 'sq_ft', 600, 500, 1000, 600000, 30000),
  (tests.tid('a'), tests.rid('q2'), 2, tests.rid('kerb'), 'Kerb B', 'direct', 'piece', 1000, 500, 300, 300000, 20000);
insert into public.orders (id, tenant_id, order_no, quote_id, material_quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
values (tests.rid('o2'), tests.tid('a'), (select max(order_no) + 1 from public.orders where tenant_id = tests.tid('a')), null, tests.rid('q2'), tests.rid('a_er_enq'), tests.rid('a_er_req'), tests.rid('a_lead'), 1000000, 500000, current_date, tests.rid('a_er_op'));
insert into public.delivery_trips (id, tenant_id, order_id, trip_no, challan_no, planned_date, status, problem_code, delivered_at, created_by)
select tests.rid('t' || n), tests.tid('a'), tests.rid('o2'), n, (select coalesce(max(challan_no), 0) + 1 from public.delivery_trips where tenant_id = tests.tid('a')) + n, pg_temp.today() + d, st, pc,
       case when st = 'delivered' then now() end, tests.uid('a_owner')
  from (values (1, 0, 'delivered', null), (2, -3, 'delivered', null), (3, -2, 'problem', 'truck_breakdown'), (4, -1, 'cancelled', null)) v(n, d, st, pc);
-- the ledger of the company: invoice 1 (entry 100 days ago, due 70 days ago) Rs 10,000; invoice 2 (due 10 days ago) Rs 5,000; invoice 3 (due in 20 days) Rs 3,000; a payment of Rs 2,000 today
select pg_temp.q(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(gen_random_uuid(), %L, 'charge', %L, null, %L::date, 1000000, %L::date, null, 'R-1')$q$, tests.tid('a'), tests.rid('a_company'), pg_temp.today() - 100, pg_temp.today() - 70)));
select pg_temp.q(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(gen_random_uuid(), %L, 'charge', %L, null, %L::date, 500000, %L::date, null, 'R-2')$q$, tests.tid('a'), tests.rid('a_company'), pg_temp.today() - 40, pg_temp.today() - 10)));
select pg_temp.q(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(gen_random_uuid(), %L, 'charge', %L, null, %L::date, 300000, %L::date, null, 'R-3')$q$, tests.tid('a'), tests.rid('a_company'), pg_temp.today() - 5, pg_temp.today() + 20)));
select pg_temp.q(pg_temp.try('a_owner', format($q$select public.ledger_entry_record(gen_random_uuid(), %L, 'payment', %L, null, %L::date, 200000, null, null, null, null, 'cash')$q$, tests.tid('a'), tests.rid('a_company'), pg_temp.today())));

-- ============================================================================ B. construction.quotes
create temp table rq as select pg_temp.run('a_sales', 'construction.quotes') as j;
select is(pg_temp.kpi((select j from rq), 'quotes_made'), '4', 'B1 four quotes were made (the fixture''s rejected one, two approved, one draft)');
select is(pg_temp.kpi((select j from rq), 'quotes_approved'), '2', 'B2 two were approved');
select is(pg_temp.kpi((select j from rq), 'quotes_won'), '1', 'B3 one became an order (the order on the rejected quote does not count: only an APPROVED quote can be won)');
select is(pg_temp.kpi((select j from rq), 'win_rate_pct'), '50.0', 'B4 half of the approved quotes were won');
select is(pg_temp.kpi((select j from rq), 'approved_value_paise'), '3000000', 'B5 Rs 30,000 approved (10,000 + 20,000)');
select is(pg_temp.kpi((select j from rq), 'won_value_paise'), '1000000', 'B6 Rs 10,000 won');
select is(pg_temp.rows((select j from rq), 'by_status'), '[["draft", 1, 300000], ["rejected", 1, 0], ["superseded", 2, 3000000]]', 'B7 by status');
select is(pg_temp.pts((select j from rq), 'quotes_by_day'), '["4"]', 'B8 four quotes today (the series)');
select is(((select j from rq)::jsonb ->> 'report') || '/' || ((select j from rq)::jsonb ->> 'to'), 'construction.quotes/' || pg_temp.today()::text, 'B9 the window ends today');
select is(pg_temp.kpi(pg_temp.run('a_sales', 'construction.quotes', (pg_temp.today() - 60)::text, (pg_temp.today() - 31)::text), 'quotes_made'), '0', 'B10 another window has none');
select is(pg_temp.kpi(pg_temp.run('a_sales', 'construction.quotes', (pg_temp.today() - 60)::text, (pg_temp.today() - 31)::text), 'win_rate_pct'), null, 'B11 and no rate (nothing to divide)');

-- ============================================================================ C. revenue by product
create temp table rr as select pg_temp.run('a_sales', 'construction.revenue_by_product') as j;
select is(pg_temp.kpi((select j from rr), 'orders'), '2', 'C1 two orders today (the fixture''s order of Rs 0 and the Rs 10,000 one)');
select is(pg_temp.kpi((select j from rr), 'order_value_paise'), '1000000', 'C2 Rs 10,000');
select is(pg_temp.kpi((select j from rr), 'material_paise'), '900000', 'C3 of which Rs 9,000 is material');
select is(pg_temp.rows((select j from rr), 'by_product'), '[["Paver A", "sq_ft", 1000, 600000], ["Kerb B", "piece", 300, 300000]]', 'C4 by product, the most first, with the unit and the quantity billed');

-- ============================================================================ D. trips per day
create temp table rt as select pg_temp.run('a_sales', 'construction.trips_per_day') as j;
select is(pg_temp.kpi((select j from rt), 'trips'), '5', 'D1 five trips in the window (the fixture''s planned one and four of ours)');
select is(pg_temp.kpi((select j from rt), 'delivered'), '2', 'D2 two delivered');
select is(pg_temp.kpi((select j from rt), 'problems'), '1', 'D3 one problem');
select is(pg_temp.kpi((select j from rt), 'cancelled'), '1', 'D4 one cancelled');
select is(pg_temp.kpi((select j from rt), 'delivered_pct'), '50.0', 'D5 half of the trips that were not cancelled were delivered (2 of 4)');
select is(pg_temp.rows((select j from rt), 'by_status'), '[["cancelled", 1], ["delivered", 2], ["planned", 1], ["problem", 1]]', 'D6 by status');
select is(pg_temp.pts((select j from rt), 'trips_by_day'), '["1", "1", "2"]', 'D7 trips a day (a cancelled trip is not a trip that day): 3 days ago, 2 days ago, today');
select is(pg_temp.pts((select j from rt), 'delivered_by_day'), '["1", "1"]', 'D8 and the delivered ones by day');

-- ============================================================================ E. dues ageing
create temp table rd as select pg_temp.run('a_sales', 'construction.dues_ageing') as j;
select is(pg_temp.kpi((select j from rd), 'outstanding_paise'), '1600000', 'E1 owed: Rs 16,000 (10,000 + 5,000 + 3,000 less the 2,000 paid, to the oldest invoice first)');
select is(pg_temp.kpi((select j from rd), 'overdue_paise'), '1300000', 'E2 of which Rs 13,000 is past its due date');
select is(pg_temp.kpi((select j from rd), 'customers_owing'), '1', 'E3 by one customer');
select is(pg_temp.kpi((select j from rd), 'overdue_pct'), '81.3', 'E4 81.3 percent is overdue');
select is(pg_temp.rows((select j from rd), 'ageing'), '[["not_due", 300000], ["d1_30", 500000], ["d31_60", 0], ["d61_90", 800000], ["d90_plus", 0]]', 'E5 by days past due: the 70-day-old invoice has Rs 8,000 left, the 10-day-old one Rs 5,000, the third is not due');
select is(pg_temp.rows((select j from rd), 'top_debtors'), '[["Kzv9 Silks", 1600000, 1300000]]', 'E6 the debtor');
select is(pg_temp.kpi(pg_temp.run('a_sales', 'construction.dues_ageing', null, (pg_temp.today() - 80)::text), 'outstanding_paise'), '1000000', 'E7 80 days ago only the first invoice existed (Rs 10,000); the report is as of the day asked');

-- ============================================================================ F. top customers
create temp table rc as select pg_temp.run('a_sales', 'construction.top_customers') as j;
select is(pg_temp.kpi((select j from rc), 'customers'), '1', 'F1 one customer ordered');
select is(pg_temp.kpi((select j from rc), 'orders'), '2', 'F2 two orders');
select is(pg_temp.kpi((select j from rc), 'order_value_paise'), '1000000', 'F3 Rs 10,000');
select is(pg_temp.rows((select j from rc), 'top_customers'), '[["Kzv9 Silks", 2, 1000000]]', 'F4 by customer');

-- ============================================================================ G. the weekly summary in the one shape
create temp table rw as select pg_temp.run('a_owner', 'weekly.summary') as j;
select is((select j from rw)::jsonb ->> 'report', 'weekly.summary', 'G1 the existing weekly report, in the one shape');
select is(pg_temp.kpi((select j from rw), 'visits_booked'), '0', 'G2 its figures are kpis (a week with no visit)');
select is((select e ->> 'unit' from jsonb_array_elements((select j from rw)::jsonb -> 'kpis') e where e ->> 'key' = 'median_answer_seconds'), 'seconds', 'G3 a time is in seconds');
select is(jsonb_array_length((select j from rw)::jsonb -> 'tables' -> 0 -> 'columns')::text, '2', 'G4 the sarees whose photos went out most are a table of two columns');
select is(pg_temp.run('a_sales', 'weekly.summary'), 'ERR:42501', 'G5 DENY: Sales (it is the Owner''s and Admin''s)');
select is(pg_temp.run('a_admin', 'weekly.summary', (select (app.india_week_start(now()) - 7)::text)) like '%"report": "weekly.summary"%', true, 'G6 an Admin reads last week (a Monday)');
select is(pg_temp.run('a_admin', 'weekly.summary', (select (app.india_week_start(now()) + 1)::text)), 'ERR:22023', 'G7 a day that is not a Monday is invalid');

-- ============================================================================ H. the door
select is(pg_temp.run('a_viewer', 'construction.quotes'), 'ERR:42501', 'H1 DENY: a Viewer');
select is(pg_temp.run('b_owner', 'construction.quotes', null, null, 'a'), 'ERR:42501', 'H2 DENY: another business');
select is(pg_temp.run('anon', 'construction.quotes'), 'ERR:42501', 'H3 DENY: anon');
select is(pg_temp.run('a_owner', 'construction.nothing'), 'ERR:22023', 'H4 an unknown code is invalid');
select is(pg_temp.run('b_owner', 'construction.quotes', null, null, 'b'), 'ERR:SM701', 'H5 a textile business: the construction reports are off (SM701)');
select is(pg_temp.run('b_owner', 'education.collection', null, null, 'b'), 'ERR:SM701', 'H6 nor are a school''s');
select is(pg_temp.run('a_owner', 'education.collection'), 'ERR:SM701', 'H7 and a construction business has no school reports');
select is(pg_temp.run('a_owner', 'construction.quotes', null, (pg_temp.today() + 1)::text), 'ERR:22023', 'H8 not for a future day');
select is(pg_temp.run('a_owner', 'construction.quotes', (pg_temp.today() - 1)::text, (pg_temp.today() - 5)::text), 'ERR:22023', 'H9 the window runs forwards');
select is(pg_temp.run('a_owner', 'construction.quotes', (pg_temp.today() - 400)::text), 'ERR:22023', 'H10 at most a year');
select is(pg_temp.try('a_owner', format($q$select public.construction_report(%L, 'education.collection')$q$, tests.tid('a'))), '22023', 'H11 the pack''s own function refuses another pack''s code');
select is(pg_temp.try('a_viewer', format($q$select public.construction_report(%L, 'construction.quotes')$q$, tests.tid('a'))), '42501', 'H12 and a Viewer cannot call it directly either');
select is(position('defaulter' in lower((select j from rq) || (select j from rd) || (select j from rc))), 0, 'H14 the word "defaulter" appears in no report');
select * from finish();
rollback;
