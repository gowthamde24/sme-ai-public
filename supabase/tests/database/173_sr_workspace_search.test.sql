-- Search for the ⌘K palette (migration 20261231270000): the caller's own row-level security decides every row; case, spaces and Unicode form do not matter; the phone matches on its end only;
-- numbers find quotes and orders; at most 5 per kind; q is 2 to 80 characters; another workspace finds nothing. Plus a timing on 2,000 leads.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');

insert into public.companies (id, tenant_id, name, city) values (tests.rid('co_l'), tests.tid('a'), 'Lakshmi Silks', 'Vijayawada'), (tests.rid('co_t'), tests.tid('a'), 'శ్రీ లక్ష్మి సిల్క్స్', 'Guntur');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('k_r'), tests.tid('a'), tests.rid('co_l'), 'Ravi Kumar', '+91 98765 43210'), (tests.rid('k_t'), tests.tid('a'), tests.rid('co_t'), 'రవి', '+91 90000 11112');
insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid('l_r'), tests.tid('a'), tests.rid('co_l'), tests.rid('k_r')), (tests.rid('l_t'), tests.tid('a'), tests.rid('co_t'), tests.rid('k_t'));

create function pg_temp.s(p_user text, p_q text, p_tenant text default 'a') returns jsonb language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format($q$select public.workspace_search(%L, %L)::text$q$, tests.tid(p_tenant), p_q))::jsonb;
exception when others then return jsonb_build_object('error', sqlstate);
end $$;
create function pg_temp.titles(d jsonb, k text) returns text language sql as $$
  select coalesce(string_agg(i ->> 'title', ',' order by i ->> 'title'), '') from jsonb_array_elements(d -> 'groups') g, jsonb_array_elements(g -> 'items') i where g ->> 'kind' = k
$$;

select is(pg_temp.titles(pg_temp.s('a_owner', 'RAVI'), 'lead'), 'Ravi Kumar', 'A1 a name, any case');
select is(pg_temp.titles(pg_temp.s('a_owner', 'lakshmisilks'), 'customer'), 'Lakshmi Silks', 'A2 spaces do not matter');
select is(pg_temp.titles(pg_temp.s('a_owner', 'లక్ష్మి'), 'customer'), 'శ్రీ లక్ష్మి సిల్క్స్', 'A3 Telugu matches as typed');
select is(pg_temp.titles(pg_temp.s('a_owner', 'రవి'), 'lead'), 'రవి', 'A4 a Telugu name');
select is(pg_temp.titles(pg_temp.s('a_owner', '43210'), 'lead'), 'Ravi Kumar', 'A5 the end of a phone number');
select is(pg_temp.titles(pg_temp.s('a_owner', '98765'), 'lead'), '', 'A6 ... only its end (not the middle)');
select ok(not (pg_temp.s('a_owner', '43210')::text like '%98765%'), 'A7 the whole number is never returned');
select is(pg_temp.s('a_owner', 'x') ->> 'error', '22023', 'B1 one letter: refused');
select is(pg_temp.s('a_owner', repeat('x', 81)) ->> 'error', '22023', 'B2 81 letters: refused');
select is(pg_temp.s('b_owner', 'ravi', 'a') ->> 'error', '42501', 'B3 another workspace''s Owner: refused');
select is(pg_temp.titles(pg_temp.s('b_owner', 'ravi', 'b'), 'lead'), '', 'B4 ... and in their own workspace, A''s lead is not found');
select is(pg_temp.titles(pg_temp.s('a_sales', 'ravi'), 'lead'), 'Ravi Kumar', 'B5 Sales finds the lead');
select ok(pg_temp.s('a_viewer', 'ravi') ? 'groups', 'B6 a Viewer gets an answer (only what a Viewer may read)');

-- at most 5 a kind, newest first; numbers find quotes and orders
insert into public.companies (id, tenant_id, name) select gen_random_uuid(), tests.tid('a'), 'Bulk Traders ' || g from generate_series(1, 8) g;
select is((select jsonb_array_length(g -> 'items') from jsonb_array_elements(pg_temp.s('a_owner', 'bulk traders') -> 'groups') g where g ->> 'kind' = 'customer'), 5, 'C1 at most 5 a kind');
do $$
declare
  r record;
begin
  for r in select * from tests.tenant_table_registry where table_name in ('quotes', 'orders') loop
    execute format(r.insert_sql, tests.tid('a'), gen_random_uuid(), tests.rid('a_company'), tests.rid('a_contact'), tests.pool_uid(1));
  end loop;
end $$;
select is(pg_temp.titles(pg_temp.s('a_owner', 'Q' || (select min(quote_no) from public.quotes where tenant_id = tests.tid('a')))::jsonb, 'quote'),
          'Quote ' || (select min(quote_no) from public.quotes where tenant_id = tests.tid('a')), 'C2 a quote by its number (Q42)');
select is(pg_temp.titles(pg_temp.s('a_owner', '#' || (select min(order_no) from public.orders where tenant_id = tests.tid('a')))::jsonb, 'order'),
          'Order ' || (select min(order_no) from public.orders where tenant_id = tests.tid('a')), 'C3 an order by its number (#17)');

-- timing: 2,000 leads
insert into public.companies (id, tenant_id, name) select tests.rid('bulk' || g), tests.tid('a'), 'Shop ' || g from generate_series(1, 2000) g;
insert into public.contacts (id, tenant_id, company_id, full_name, phone) select tests.rid('bk' || g), tests.tid('a'), tests.rid('bulk' || g), 'Person ' || g, '+91 9' || lpad(g::text, 9, '0') from generate_series(1, 2000) g;
insert into public.leads (id, tenant_id, company_id, contact_id) select tests.rid('bl' || g), tests.tid('a'), tests.rid('bulk' || g), tests.rid('bk' || g) from generate_series(1, 2000) g;
analyze;
create temp table timings (ms numeric);
do $$
declare
  t0 timestamptz;
  i integer;
begin
  for i in 1 .. 20 loop
    t0 := clock_timestamp();
    perform pg_temp.s('a_owner', case when i % 2 = 0 then 'person 17' else '01999' end);
    insert into timings values (extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
end $$;
select diag('search on 2,000 leads: p50=' || round(percentile_cont(0.5) within group (order by ms)::numeric, 1) || ' ms  p95=' || round(percentile_cont(0.95) within group (order by ms)::numeric, 1) || ' ms') from timings;
select ok((select percentile_cont(0.95) within group (order by ms) from timings) < 150, 'D1 p95 under 150 ms on 2,000 leads');

select * from finish();
rollback;
