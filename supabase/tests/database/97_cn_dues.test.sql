-- Job CN (ADR 0085), part 2: DUES (receivables) groundwork.
--   A structure, grants, RLS, module    B invoices: who, what, replay, the number    C payments and voiding    D the ledger rules worked by hand: oldest invoice first, the age buckets, what is overdue, credit
--   E the credit limit and the check before a new order    F the import of an accounting export    G the summary
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');
insert into public.companies (id, tenant_id, name) values (tests.rid('a_company2'), tests.tid('a'), 'Second customer');

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
create function pg_temp.inv(p_user text, p_tenant text, p_id uuid, p_company uuid, p_no text, p_date text, p_due text, p_amount bigint) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.invoice_record(%L, %L, %L, %L, date %L, date %L, %L)$q$, p_id, tests.tid(p_tenant), p_company, p_no, p_date, p_due, p_amount))
$$;
create function pg_temp.pay(p_user text, p_tenant text, p_id uuid, p_company uuid, p_on text, p_amount bigint, p_method text default 'cash') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.payment_record(%L, %L, %L, date %L, %L, %L)$q$, p_id, tests.tid(p_tenant), p_company, p_on, p_amount, p_method))
$$;
create function pg_temp.st(p_user text, p_company uuid, p_key text, p_as_of text default '2026-10-14') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (public.dues_statement(%L, %L, date %L) ->> %L)$q$, tests.tid('a'), p_company, p_as_of, p_key))
$$;
create function pg_temp.bucket(p_company uuid, p_key text, p_as_of text default '2026-10-14') returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.dues_statement(%L, %L, date %L) -> 'ageing' ->> %L)$q$, tests.tid('a'), p_company, p_as_of, p_key))
$$;

-- ============================================================================ A. structure, grants, RLS, module
select is((select count(*) from pg_class where relname in ('ledger_accounts', 'ledger_entries', 'customer_credit_limits') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 3::bigint, 'A1 RLS is enabled and forced on the three tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('ledger_accounts', 'ledger_entries', 'customer_credit_limits') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'A2 a client can only read them');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('ledger_accounts', 'ledger_entries', 'customer_credit_limits') and grantee in ('anon', 'public')), 0::bigint, 'A3 anon and PUBLIC hold nothing');
select is(pg_temp.try('a_owner', format($$insert into public.ledger_entries (id, tenant_id, account_id, kind, direction, amount_paise, entry_date, due_date, invoice_no, source, recorded_by) values (gen_random_uuid(), %L, gen_random_uuid(), 'charge', 'debit', 100, date '2026-10-01', date '2026-10-02', 'X-1', 'manual', %L)$$, tests.tid('a'), tests.uid('a_owner'))), '42501', 'A4 DENY: a client cannot write an invoice directly');
select is(pg_temp.inv('b_owner', 'b', tests.rid('b_inv'), tests.rid('b_company'), 'B-1', '2026-10-01', '2026-10-31', 10000), 'SM701', 'A5 textiles: dues are not on (SM701)');
select is(pg_temp.pay('b_owner', 'b', tests.rid('b_pay'), tests.rid('b_company'), '2026-10-01', 10000), 'SM701', 'A6 nor payments');
select is(pg_temp.try('b_owner', format($$select public.dues_statement(%L, %L)$$, tests.tid('b'), tests.rid('b_company'))), 'SM701', 'A7 nor the statement');
select is(pg_temp.try('b_owner', format($$select public.credit_limit_set(%L, %L, 100000)$$, tests.tid('b'), tests.rid('b_company'))), 'SM701', 'A8 nor a credit limit');

-- ============================================================================ B. invoices
select is(pg_temp.inv('a_owner', 'a', tests.rid('i1'), tests.rid('a_company'), 'INV-1', '2026-06-01', '2026-07-01', 1000000), 'ok', 'B1 ALLOW: the Owner enters an invoice (Rs 10,000)');
select is(pg_temp.inv('a_admin', 'a', tests.rid('i2'), tests.rid('a_company'), 'INV-2', '2026-08-01', '2026-09-01', 2000000), 'ok', 'B2 ALLOW: the Admin enters one (Rs 20,000)');
select is(pg_temp.inv('a_sales', 'a', tests.rid('i3'), tests.rid('a_company'), 'INV-3', '2026-09-20', '2026-10-20', 500000), 'ok', 'B3 ALLOW: Sales enters one (Rs 5,000)');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i4'), tests.rid('a_company'), 'INV-4', '2026-10-10', '2026-11-10', 100000), 'ok', 'B4 ALLOW: and a fourth (Rs 1,000)');
select is(pg_temp.inv('a_viewer', 'a', tests.rid('i5'), tests.rid('a_company'), 'INV-5', '2026-10-10', '2026-11-10', 100000), '42501', 'B5 DENY: a Viewer');
select is(pg_temp.inv('b_owner', 'a', tests.rid('i5'), tests.rid('a_company'), 'INV-5', '2026-10-10', '2026-11-10', 100000), '42501', 'B6 DENY: another business');
select is(pg_temp.inv('anon', 'a', tests.rid('i5'), tests.rid('a_company'), 'INV-5', '2026-10-10', '2026-11-10', 100000), '42501', 'B7 DENY: anon');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i5'), tests.rid('a_company'), 'inv-1', '2026-10-10', '2026-11-10', 100000), 'SM781', 'B8 the invoice number is unique among live invoices, whatever the case (SM781)');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i5'), tests.rid('b_company'), 'INV-5', '2026-10-10', '2026-11-10', 100000), '23503', 'B9 a customer of another business is not found');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i5'), tests.rid('a_company'), 'INV-5', '2026-10-10', '2026-10-01', 100000), '22023', 'B10 a due date before the invoice date is invalid');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i5'), tests.rid('a_company'), 'INV-5', '2026-10-10', '2026-11-10', 0), '22023', 'B11 an invoice of nothing is invalid');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i5'), tests.rid('a_company'), 'INV 5; drop', '2026-10-10', '2026-11-10', 100), '22023', 'B12 an invoice number is letters, digits and a few marks');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i5'), tests.rid('a_company'), 'INV-5', '2019-12-31', '2026-11-10', 100), '22023', 'B13 a date before 2020 is invalid');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i1'), tests.rid('a_company'), 'INV-1', '2026-06-01', '2026-07-01', 1000000), 'ok', 'B14 an exact repeat replays');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i1'), tests.rid('a_company'), 'INV-1', '2026-06-01', '2026-07-01', 1000001), '23505', 'B15 the same id with other figures is the constant conflict');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and kind = 'charge'), 4::bigint, 'B16 four invoices, none from a refusal');
select is(pg_temp.try('a_owner', format($$select public.invoice_record(%L, %L, %L, 'INV-X', date '2026-10-01', date '2026-10-31', 100, %L)$$, tests.rid('i6'), tests.tid('a'), tests.rid('a_company'), gen_random_uuid())), '23503', 'B17 an order that is not this business''s cannot be linked');
select is(pg_temp.val('a_viewer', format($$select count(*)::text from public.ledger_entries where kind = 'charge' and tenant_id = %L$$, tests.tid('a'))), '0', 'B18 a Viewer reads no invoice (money)');
select is(pg_temp.val('a_sales', format($$select count(*)::text from public.ledger_entries where kind = 'charge' and tenant_id = %L$$, tests.tid('a'))), '4', 'B19 Sales do');
select is(pg_temp.val('b_owner', format($$select count(*)::text from public.ledger_entries where kind = 'charge' and tenant_id = %L$$, tests.tid('a'))), '0', 'B20 another business sees none');
select is(pg_temp.try('a_owner', format($$update public.ledger_entries set amount_paise = 1 where id = %L$$, tests.rid('i1'))), '42501', 'B21 DENY: an invoice is never edited by a client');
select is(pg_temp.sc(format($$update public.ledger_entries set amount_paise = 1 where id = %L$$, tests.rid('i1'))), '42501', 'B22 nor by any session: only voiding changes a row');
select is(pg_temp.sc($$delete from public.ledger_entries$$), '42501', 'B23 nor deleted');

-- ============================================================================ C. payments and voiding
select is(pg_temp.pay('a_owner', 'a', tests.rid('p1'), tests.rid('a_company'), '2026-09-01', 1200000), 'ok', 'C1 ALLOW: a payment of Rs 12,000 on 1 Sept');
select is(pg_temp.pay('a_sales', 'a', tests.rid('p2'), tests.rid('a_company2'), '2026-09-02', 50000, 'upi'), 'ok', 'C2 ALLOW: Sales records a payment of the second customer');
select is(pg_temp.pay('a_viewer', 'a', tests.rid('p3'), tests.rid('a_company'), '2026-09-02', 50000), '42501', 'C3 DENY: a Viewer');
select is(pg_temp.pay('a_owner', 'a', tests.rid('p3'), tests.rid('a_company'), '2026-09-02', 50000, 'barter'), '22023', 'C4 a method outside the closed list is invalid');
select is(pg_temp.pay('a_owner', 'a', tests.rid('p3'), tests.rid('a_company'), '2090-01-01', 50000), '22023', 'C5 a payment is never dated in the future');
select is(pg_temp.pay('a_owner', 'a', tests.rid('p3'), tests.rid('a_company'), '2026-09-02', 0), '22023', 'C6 nor of nothing');
select is(pg_temp.pay('a_owner', 'a', tests.rid('p3'), tests.rid('b_company'), '2026-09-02', 100), '23503', 'C7 nor for a customer of another business');
select is(pg_temp.try('a_owner', format($$select public.payment_record(%L, %L, %L, date '2026-09-02', 100, 'cash', %L)$$, tests.rid('p3'), tests.tid('a'), tests.rid('a_company2'), tests.rid('i1'))), '23503', 'C8 an invoice of ANOTHER customer cannot be named');
select is(pg_temp.pay('a_owner', 'a', tests.rid('p1'), tests.rid('a_company'), '2026-09-01', 1200000), 'ok', 'C9 an exact repeat replays');
select is(pg_temp.pay('a_owner', 'a', tests.rid('p1'), tests.rid('a_company'), '2026-09-01', 1200001), '23505', 'C10 other figures under the same id conflict');
select is(pg_temp.try('a_sales', format($$select public.payment_void(%L, %L)$$, tests.tid('a'), tests.rid('p2'))), '42501', 'C11 DENY: Sales cannot void');
select is(pg_temp.try('a_admin', format($$select public.payment_void(%L, %L)$$, tests.tid('a'), tests.rid('p2'))), 'ok', 'C12 ALLOW: the Admin voids a payment');
select is(pg_temp.try('a_admin', format($$select public.payment_void(%L, %L)$$, tests.tid('a'), tests.rid('p2'))), 'SM782', 'C13 a payment is voided once (SM782)');
select is(pg_temp.try('b_owner', format($$select public.payment_void(%L, %L)$$, tests.tid('b'), tests.rid('p1'))), '23503', 'C14 another business cannot void it (not found)');
select is(pg_temp.sc(format($$update public.ledger_entries set amount_paise = 1 where id = %L$$, tests.rid('p2'))), '42501', 'C15 a voided payment never changes again');

-- ============================================================================ D. the ledger rules, worked by hand
-- INV-1 Rs 10,000 (1 Jun, due 1 Jul), INV-2 Rs 20,000 (1 Aug, due 1 Sep), INV-3 Rs 5,000 (20 Sep, due 20 Oct), INV-4 Rs 1,000 (10 Oct, due 10 Nov); paid Rs 12,000 on 1 Sept.
-- Oldest first: INV-1 is paid (10,000) and INV-2 has 2,000 paid: open 18,000. Open in all: 18,000 + 5,000 + 1,000 = 24,000.
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'invoiced_paise'), '3600000', 'D1 invoiced Rs 36,000');
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'paid_paise'), '1200000', 'D2 paid Rs 12,000');
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'outstanding_paise'), '2400000', 'D3 owes Rs 24,000: the payment went to the OLDEST invoice first');
select is(pg_temp.val('a_owner', format($$select (select (e ->> 'open_paise') from jsonb_array_elements(public.dues_statement(%L, %L, date '2026-10-14') -> 'open_invoices') e where e ->> 'invoice_no' = 'INV-2')$$, tests.tid('a'), tests.rid('a_company'))), '1800000', 'D4 INV-2 has Rs 18,000 left');
select is(pg_temp.val('a_owner', format($$select count(*)::text from jsonb_array_elements(public.dues_statement(%L, %L, date '2026-10-14') -> 'open_invoices') e where e ->> 'invoice_no' = 'INV-1'$$, tests.tid('a'), tests.rid('a_company'))), '0', 'D5 INV-1 is paid and not listed');
select is(pg_temp.bucket(tests.rid('a_company'), 'd0_30'), '600000', 'D6 0 to 30 days old: INV-3 (24 days) and INV-4 (4 days) = Rs 6,000');
select is(pg_temp.bucket(tests.rid('a_company'), 'd31_60'), '0', 'D7 31 to 60: nothing');
select is(pg_temp.bucket(tests.rid('a_company'), 'd61_90'), '1800000', 'D8 61 to 90: INV-2 (74 days) = Rs 18,000');
select is(pg_temp.bucket(tests.rid('a_company'), 'd90_plus'), '0', 'D9 over 90: nothing (INV-1 is paid)');
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'overdue_paise'), '1800000', 'D10 overdue (past its due date): INV-2 only = Rs 18,000');
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'credit_paise'), '0', 'D11 no credit balance');
-- the same books a month later: INV-2 is 105 days old, INV-3 is overdue
select is(pg_temp.bucket(tests.rid('a_company'), 'd90_plus', '2026-11-14'), '1800000', 'D12 a month later INV-2 is over 90 days');
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'overdue_paise', '2026-11-14'), '2400000', 'D13 and INV-3 and INV-4 are overdue too (Rs 18,000 + 5,000 + 1,000: every open invoice is past its due date)');
-- earlier: the payment of 1 Sept is not yet received on 15 Aug, INV-3 and INV-4 do not exist yet
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'outstanding_paise', '2026-08-15'), '3000000', 'D14 on 15 Aug: INV-1 + INV-2 = Rs 30,000, nothing paid');
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'outstanding_paise', '2026-09-05'), '1800000', 'D15 on 5 Sept: after the payment, Rs 18,000');
-- a customer's ledger is its own
select is(pg_temp.st('a_owner', tests.rid('a_company2'), 'outstanding_paise'), '0', 'D16 the second customer owes nothing (and its voided payment counts for nothing)');
select is(pg_temp.st('a_owner', tests.rid('a_company2'), 'credit_paise'), '0', 'D17 ... and has no credit');
-- an advance: paid before any invoice is a credit, owed nothing
select is(pg_temp.pay('a_owner', 'a', tests.rid('p4'), tests.rid('a_company2'), '2026-10-01', 300000), 'ok', 'D18 an advance of Rs 3,000 from the second customer, before any invoice');
select is(pg_temp.st('a_owner', tests.rid('a_company2'), 'credit_paise'), '300000', 'D19 shows as a credit');
select is(pg_temp.st('a_owner', tests.rid('a_company2'), 'outstanding_paise'), '0', 'D20 and nothing is owed');
-- voiding moves the books
select is(pg_temp.try('a_owner', format($$select public.invoice_void(%L, %L)$$, tests.tid('a'), tests.rid('i4'))), 'ok', 'D21 ALLOW: the Owner voids INV-4');
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'outstanding_paise'), '2300000', 'D22 the books drop by Rs 1,000');
select is(pg_temp.try('a_owner', format($$select public.invoice_void(%L, %L)$$, tests.tid('a'), tests.rid('i4'))), 'SM782', 'D23 an invoice is voided once');
select is(pg_temp.inv('a_owner', 'a', tests.rid('i7'), tests.rid('a_company'), 'INV-4', '2026-10-10', '2026-11-10', 100000), 'ok', 'D24 a voided invoice''s number can be used again');
select is(pg_temp.try('a_sales', format($$select public.invoice_void(%L, %L)$$, tests.tid('a'), tests.rid('i7'))), '42501', 'D25 DENY: Sales cannot void an invoice');
select is(pg_temp.st('a_viewer', tests.rid('a_company'), 'outstanding_paise'), 'ERR:42501', 'D26 DENY: a Viewer cannot read a statement');
select is(pg_temp.st('b_owner', tests.rid('a_company'), 'outstanding_paise'), 'ERR:42501', 'D27 DENY: nor another business');
select is(pg_temp.val('a_owner', format($$select (public.dues_statement(%L, %L, date '2026-10-14') ->> 'outstanding_paise')::bigint = app.dues_outstanding(%L, %L, date '2026-10-14')$$, tests.tid('a'), tests.rid('a_company'), tests.tid('a'), tests.rid('a_company'))), 'ERR:42501', 'D28 the helper the quote reads is not callable by a client');
select is(app.dues_outstanding(tests.tid('a'), tests.rid('a_company'), date '2026-10-14'), 2400000::bigint, 'D29 and says what the statement says (as the database)');
select is(pg_temp.val('a_owner', format($$select jsonb_array_length(public.dues_ledger(%L, %L) -> 'invoices')::text || ':' || jsonb_array_length(public.dues_ledger(%L, %L) -> 'payments')::text$$, tests.tid('a'), tests.rid('a_company'), tests.tid('a'), tests.rid('a_company'))), '5:1', 'D30 the ledger lists every invoice (voided ones marked) and payment');

-- ============================================================================ E. the credit limit and the check before a new order
select is(pg_temp.try('a_owner', format($$select public.credit_limit_set(%L, %L, 2500000)$$, tests.tid('a'), tests.rid('a_company'))), 'ok', 'E1 ALLOW: the Owner sets a limit of Rs 25,000 (aal2)');
select is(pg_temp.at('aal1', 'a_owner', format($$select public.credit_limit_set(%L, %L, 2500000)$$, tests.tid('a'), tests.rid('a_company'))), 'SM306', 'E2 DENY: without a second factor (SM306)');
select is(pg_temp.try('a_admin', format($$select public.credit_limit_set(%L, %L, 2500000)$$, tests.tid('a'), tests.rid('a_company'))), '42501', 'E3 DENY: the Admin cannot (it is the Owner''s)');
select is(pg_temp.try('a_owner', format($$select public.credit_limit_set(%L, %L, -1)$$, tests.tid('a'), tests.rid('a_company'))), '22023', 'E4 a negative limit is invalid');
select is(pg_temp.try('a_owner', format($$select public.credit_limit_set(%L, %L, 100)$$, tests.tid('a'), tests.rid('b_company'))), '23503', 'E5 a customer of another business is not found');
select is(pg_temp.st('a_owner', tests.rid('a_company'), 'over_limit'), 'false', 'E6 owing Rs 23,000 (after INV-4 voided and re-entered as 1,000: 24,000) against Rs 25,000 is within the limit');
select is(pg_temp.val('a_owner', format($$select (public.credit_check(%L, %L, 100000) ->> 'exceeded')$$, tests.tid('a'), tests.rid('a_company'))), 'false', 'E7 an order whose balance would bring it to exactly Rs 25,000 is not over (the limit is a ceiling)');
select is(pg_temp.val('a_owner', format($$select (public.credit_check(%L, %L, 100001) ->> 'exceeded')$$, tests.tid('a'), tests.rid('a_company'))), 'true', 'E8 one paisa more is');
select is(pg_temp.val('a_owner', format($$select (public.credit_check(%L, %L, 100000) ->> 'would_be_paise')$$, tests.tid('a'), tests.rid('a_company'))), '2500000', 'E9 the check says what the customer would owe');
select is(pg_temp.val('a_owner', format($$select (public.credit_check(%L, %L, 100000) ->> 'credit_limit_paise')$$, tests.tid('a'), tests.rid('a_company'))), '2500000', 'E10 and the limit');
select is(pg_temp.val('a_owner', format($$select (public.credit_check(%L, %L, 100000) ->> 'has_limit')$$, tests.tid('a'), tests.rid('a_company2'))), 'false', 'E11 a customer with no limit is never over');
select is(pg_temp.try('a_viewer', format($$select public.credit_check(%L, %L, 1)$$, tests.tid('a'), tests.rid('a_company'))), '42501', 'E12 DENY: a Viewer');
select is(pg_temp.try('a_owner', format($$select public.credit_limit_set(%L, %L, null)$$, tests.tid('a'), tests.rid('a_company'))), 'ok', 'E13 the Owner removes the limit');
select is((select count(*) from public.customer_credit_limits where tenant_id = tests.tid('a')), 0::bigint, 'E14 (the row is gone; the audit trail keeps what it was)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'customer_credit_limit'), 2::bigint, 'E15 two audit rows: set, removed');

-- ============================================================================ F. the import
select is(pg_temp.try('a_owner', format($$select public.invoices_import(%L, %L, %L::jsonb)$$, tests.tid('a'), tests.rid('batch1'),
  jsonb_build_array(
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-100', 'invoice_date', '2026-09-01', 'due_date', '2026-09-30', 'amount_paise', 100000),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-101', 'invoice_date', '2026-09-02', 'due_date', '2026-10-01', 'amount_paise', 200000),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-100', 'invoice_date', '2026-09-03', 'due_date', '2026-10-02', 'amount_paise', 5),
    jsonb_build_object('company_id', tests.rid('b_company'), 'invoice_no', 'T-102', 'invoice_date', '2026-09-03', 'due_date', '2026-10-02', 'amount_paise', 5),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-103', 'invoice_date', 'not a date', 'due_date', '2026-10-02', 'amount_paise', 5),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-104', 'invoice_date', '2026-09-03', 'due_date', '2026-09-02', 'amount_paise', 5))::text)), 'ok', 'F1 ALLOW: an export of six rows is read');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and kind = 'charge' and source = 'import'), 2::bigint, 'F2 two rows were added; the others were skipped, not fatal');
select is(pg_temp.val('a_owner', format($$select (public.invoices_import(%L, %L, %L::jsonb) ->> 'added')$$, tests.tid('a'), tests.rid('batch1'),
  jsonb_build_array(
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-100', 'invoice_date', '2026-09-01', 'due_date', '2026-09-30', 'amount_paise', 100000),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-101', 'invoice_date', '2026-09-02', 'due_date', '2026-10-01', 'amount_paise', 200000),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-100', 'invoice_date', '2026-09-03', 'due_date', '2026-10-02', 'amount_paise', 5),
    jsonb_build_object('company_id', tests.rid('b_company'), 'invoice_no', 'T-102', 'invoice_date', '2026-09-03', 'due_date', '2026-10-02', 'amount_paise', 5),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-103', 'invoice_date', 'not a date', 'due_date', '2026-10-02', 'amount_paise', 5),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-104', 'invoice_date', '2026-09-03', 'due_date', '2026-09-02', 'amount_paise', 5))::text)), '0', 'F3 the same file again adds nothing (a retry)');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and kind = 'charge' and source = 'import'), 2::bigint, 'F4 ... and nothing is added');
select is(pg_temp.val('a_owner', format($$select (select string_agg(e ->> 'reason', ',' order by (e ->> 'row')::int) from jsonb_array_elements(public.invoices_import(%L, %L, %L::jsonb) -> 'skipped') e)$$, tests.tid('a'), tests.rid('batch2'),
  jsonb_build_array(
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-101', 'invoice_date', '2026-09-02', 'due_date', '2026-10-01', 'amount_paise', 200000),
    jsonb_build_object('company_id', tests.rid('b_company'), 'invoice_no', 'T-109', 'invoice_date', '2026-09-03', 'due_date', '2026-10-02', 'amount_paise', 5),
    jsonb_build_object('company_id', tests.rid('a_company2'), 'invoice_no', 'T-108', 'invoice_date', 'not a date', 'due_date', '2026-10-02', 'amount_paise', 5))::text)), 'invoice_number_used,customer_not_found,invalid_row', 'F5 each skipped row says why');
select is(pg_temp.try('a_viewer', format($$select public.invoices_import(%L, %L, '[]'::jsonb)$$, tests.tid('a'), tests.rid('batch3'))), '42501', 'F6 DENY: a Viewer');
select is(pg_temp.try('a_owner', format($$select public.invoices_import(%L, %L, '[]'::jsonb)$$, tests.tid('a'), tests.rid('batch3'))), '22023', 'F7 an empty file is invalid');
select is(pg_temp.try('a_owner', format($$select public.invoices_import(%L, %L, %L::jsonb)$$, tests.tid('a'), tests.rid('batch3'), (select jsonb_agg(jsonb_build_object('company_id', tests.rid('a_company'), 'invoice_no', 'Z-' || n, 'invoice_date', '2026-09-01', 'due_date', '2026-09-30', 'amount_paise', 1)) from generate_series(1, 501) n)::text)), '22023', 'F8 more than 500 rows in one call is invalid (the API sends parts)');

-- ============================================================================ G. the summary
select is(pg_temp.val('a_owner', format($$select (public.dues_summary(%L, date '2026-10-14') -> 0 ->> 'company_name') || ':' || (public.dues_summary(%L, date '2026-10-14') -> 0 ->> 'outstanding_paise')$$, tests.tid('a'), tests.tid('a'))), 'Company a:2400000', 'G1 the largest debtor comes first with its balance');
select is(pg_temp.val('a_owner', format($$select jsonb_array_length(public.dues_summary(%L, date '2026-10-14'))::text$$, tests.tid('a'))), '1', 'G2 only one customer owes something (the second one''s advance covers what was imported for it)');
select is(pg_temp.try('a_viewer', format($$select public.dues_summary(%L)$$, tests.tid('a'))), '42501', 'G3 DENY: a Viewer');
select is(pg_temp.try('b_owner', format($$select public.dues_summary(%L)$$, tests.tid('a'))), '42501', 'G4 DENY: another business');

select * from finish();
rollback;
