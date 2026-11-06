-- Money at a glance and low stock (migration 20261231340000): totals summed from the ledger's own statements; payments this month; the items marked "few left" with how many asked this week.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');

create function pg_temp.rec(p_id text, p_kind text, p_date text, p_amount bigint, p_due text default null, p_inv text default null, p_method text default null) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.sqlstate_as(tests.uid('a_owner'), format($q$select public.ledger_entry_record(%L, %L, %L, %L, null, date %L, %L, %s, null, %L, null, %L, null, null)$q$,
                           tests.rid(p_id), tests.tid('a'), p_kind, tests.rid('a_company'), p_date, p_amount, case when p_due is null then 'null' else format('date %L', p_due) end, p_inv, p_method));
end $$;
create function pg_temp.m(p_user text, p_key text, p_as_of text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(tests.uid(p_user), format($q$select public.money_summary(%L, date %L) ->> %L$q$, tests.tid('a'), p_as_of, p_key));
exception when others then return 'ERR:' || sqlstate;
end $$;

-- (the set-up is asserted too: a bare select of 'ok' would read as a TAP line)
select is(pg_temp.rec('m1', 'charge', '2026-10-01', 1000000, '2026-10-10', 'INV-1'), 'ok', 'S1 a charge');
select is(pg_temp.rec('m2', 'charge', '2026-10-20', 500000, '2026-11-30', 'INV-2'), 'ok', 'S2 another charge');
select is(pg_temp.rec('m3', 'payment', '2026-11-03', 300000, null, null, 'upi'), 'ok', 'S3 a payment');

select is(pg_temp.m('a_owner', 'owed_paise', '2026-11-06'), '1200000', 'A1 owed across customers: 15,000 invoiced - 3,000 paid = 12,000');
select is(pg_temp.m('a_owner', 'overdue_paise', '2026-11-06'), '700000', 'A2 overdue: the first invoice, after the payment went to it (the ledger''s own rule)');
select is(pg_temp.m('a_sales', 'customers_owing', '2026-11-06') || '/' || pg_temp.m('a_sales', 'customers_overdue', '2026-11-06'), '1/1', 'A3 one customer owes, and is overdue (Sales reads it too)');
select is(pg_temp.m('a_owner', 'paid_this_month_paise', '2026-11-06'), '300000', 'A4 paid this month');
select is(pg_temp.m('a_owner', 'paid_this_month_paise', '2026-10-31'), '0', 'A5 ... and none in October');
select is(tests.scalar_as(tests.uid('a_owner'), format($q$select jsonb_array_length(public.money_summary(%L, date '2026-11-06') -> 'top')::text$q$, tests.tid('a'))), '1', 'A6 the top list');
select is(pg_temp.m('a_viewer', 'owed_paise', '2026-11-06'), 'ERR:42501', 'B1 a Viewer reads no money');
select is(pg_temp.m('b_owner', 'owed_paise', '2026-11-06'), 'ERR:42501', 'B2 nor another workspace');

set local session_replication_role = replica;   -- fixture only: two active items without photos (the photo rule is the catalogue's own test)
insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, stock_status, active, item_kind, created_by, updated_by)
values (tests.rid('i1'), tests.tid('a'), 'Red Kanchi silk', 'kanchi_pattu', array['red'], '10k_25k', 'few_left', true, 'saree', tests.uid('a_owner'), tests.uid('a_owner')),
       (tests.rid('i2'), tests.tid('a'), 'Cotton daily wear', 'cotton_silk', array['yellow'], 'under_5k', 'in_stock', true, 'saree', tests.uid('a_owner'), tests.uid('a_owner'));
set local session_replication_role = origin;
insert into public.lead_profiles (tenant_id, lead_id, need) values (tests.tid('a'), tests.rid('a_lead'), 'Looking for a kanchi silk saree for a wedding');
select is(tests.scalar_as(tests.uid('a_viewer'), format($q$select string_agg((x ->> 'name') || ':' || (x ->> 'asked_this_week'), ',') from jsonb_array_elements(public.catalogue_low_stock(%L)) x$q$, tests.tid('a'))),
          'Red Kanchi silk:1', 'C1 only "few left" items, each with how many asked this week (any member)');
select throws_ok(format($q$select tests.scalar_as(%L, %L)$q$, tests.uid('b_owner'), format('select public.catalogue_low_stock(%L)::text', tests.tid('a'))), '42501', null, 'C2 another workspace: refused');

select * from finish();
rollback;
