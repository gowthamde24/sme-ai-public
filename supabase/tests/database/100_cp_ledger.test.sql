-- Job CP (ADR 0086), part 1: THE SHARED LEDGER. One receivables engine for a construction customer's dues and an education fee: accounts (a company or a contact), entries (charge, payment, adjustment, concession),
-- receipt numbers, the allocation rule, the statement, the import, the summary.
--   A structure, grants, RLS, module    B who may record what, and what is refused    C replay and conflict    D receipts: one series per business per financial year    E the rules worked by hand (four kinds of entry)
--   F the import of charges    G the summary, the list, the receipt    H another business (education) and isolation
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_construction('a');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('a_c2'), tests.tid('a'), tests.rid('a_company'), 'Guardian two', '+00 90000 00071');

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
-- one entry through the shared writer
create function pg_temp.rec(p_user text, p_id text, p_kind text, p_company uuid, p_contact uuid, p_date text, p_amount bigint, p_due text default null, p_dir text default null, p_inv text default null,
                            p_ref text default null, p_method text default null, p_reason text default null, p_against uuid default null, p_aal text default 'aal2', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.at(p_aal, p_user, format($q$select public.ledger_entry_record(%L, %L, %L, %L, %L, date %L, %L, %s, %L, %L, %L, %L, %L, %L)$q$,
                    tests.rid(p_id), tests.tid(p_tenant), p_kind, p_company, p_contact, p_date, p_amount, case when p_due is null then 'null' else format('date %L', p_due) end, p_dir, p_inv, p_ref, p_method, p_reason, p_against))
$$;
create function pg_temp.st(p_contact uuid, p_key text, p_as_of text default '2026-10-14') returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.ledger_statement(%L, null, %L, date %L) ->> %L)$q$, tests.tid('a'), p_contact, p_as_of, p_key))
$$;
create function pg_temp.stb(p_contact uuid, p_obj text, p_key text, p_as_of text default '2026-10-14') returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.ledger_statement(%L, null, %L, date %L) -> %L ->> %L)$q$, tests.tid('a'), p_contact, p_as_of, p_obj, p_key))
$$;
create function pg_temp.fy() returns text language sql as $$ select app.ledger_fy(app.dues_today()) $$;

-- ============================================================================ A. structure, grants, RLS, module
select is((select count(*) from pg_class where relname in ('ledger_accounts', 'ledger_entries') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 2::bigint, 'A1 RLS is enabled and forced on both tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('ledger_accounts', 'ledger_entries') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'A2 a client can only read them');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('ledger_accounts', 'ledger_entries') and grantee in ('anon', 'public')), 0::bigint, 'A3 anon and PUBLIC hold nothing');
select is((select count(*) from pg_class where relname in ('customer_invoices', 'customer_payments') and relnamespace = 'public'::regnamespace), 0::bigint, 'A4 job CN''s two tables are gone: the ledger is the one store');
select is(pg_temp.rec('b_owner', 'x1', 'charge', tests.rid('b_company'), null, '2026-10-01', 100, '2026-10-31', null, 'B-1', p_tenant => 'b'), 'SM701', 'A5 textiles: the ledger is not on (SM701)');
select is(pg_temp.try('b_owner', format($$select public.ledger_statement(%L, %L)$$, tests.tid('b'), tests.rid('b_company'))), 'SM701', 'A6 nor the statement');
select is(pg_temp.try('b_owner', format($$select public.ledger_summary(%L)$$, tests.tid('b'))), 'SM701', 'A7 nor the summary');
select is(pg_temp.try('b_owner', format($$select public.ledger_receipt_get(%L, %L)$$, tests.tid('b'), gen_random_uuid())), 'SM701', 'A8 nor a receipt');
select is(pg_temp.try('a_owner', format($$insert into public.ledger_entries (id, tenant_id, account_id, kind, direction, amount_paise, entry_date, due_date, invoice_no, source, recorded_by) values (gen_random_uuid(), %L, gen_random_uuid(), 'charge', 'debit', 100, date '2026-10-01', date '2026-10-02', 'X-1', 'manual', %L)$$, tests.tid('a'), tests.uid('a_owner'))), '42501', 'A9 DENY: a client cannot write an entry directly');
select is(pg_temp.try('a_owner', format($$insert into public.ledger_accounts (id, tenant_id, company_id) values (gen_random_uuid(), %L, %L)$$, tests.tid('a'), tests.rid('a_company'))), '42501', 'A10 nor an account');

-- ============================================================================ B. who may record what, and what is refused
select is(pg_temp.rec('a_owner', 'k1', 'charge', tests.rid('a_company'), null, '2026-06-01', 1000000, '2026-07-01', null, 'L-1'), 'ok', 'B1 ALLOW: the Owner records a charge for a company (an invoice, Rs 10,000)');
select is(pg_temp.rec('a_sales', 'k2', 'charge', null, tests.rid('a_c2'), '2026-08-01', 1000000, '2026-08-31', null, null, 'Tuition T1'), 'ok', 'B2 ALLOW: Sales records a charge for a CONTACT (a fee instalment, with a reference)');
select is(pg_temp.rec('a_admin', 'k3', 'payment', tests.rid('a_company'), null, '2026-09-01', 400000, null, null, null, null, 'upi'), 'ok', 'B3 ALLOW: the Admin records a payment');
select is(pg_temp.rec('a_sales', 'k4', 'payment', null, tests.rid('a_c2'), '2026-09-02', 100000, null, null, null, null, 'cash'), 'ok', 'B4 ALLOW: Sales records a payment');
select is(pg_temp.rec('a_sales', 'k5', 'concession', null, tests.rid('a_c2'), '2026-09-03', 100000, null, null, null, null, null, 'scholarship'), '42501', 'B5 DENY: Sales cannot give a concession (it changes what is owed without money)');
select is(pg_temp.rec('a_sales', 'k5', 'adjustment', null, tests.rid('a_c2'), '2026-09-03', 100000, null, 'credit', null, null, null, 'correction'), '42501', 'B6 DENY: nor an adjustment');
select is(pg_temp.rec('a_admin', 'k5', 'concession', null, tests.rid('a_c2'), '2026-09-03', 100000, null, null, null, null, null, 'scholarship', null, 'aal1'), 'SM306', 'B7 a concession needs the second factor (SM306 without it)');
select is(pg_temp.rec('a_admin', 'k5', 'concession', null, tests.rid('a_c2'), '2026-09-03', 100000, null, null, null, null, null, 'scholarship'), 'ok', 'B8 ALLOW: the Admin gives a concession of Rs 1,000 (with the second factor)');
select is(pg_temp.rec('a_owner', 'k6', 'adjustment', null, tests.rid('a_c2'), '2026-09-04', 50000, '2026-09-30', 'debit', null, null, null, 'late_fee'), 'ok', 'B9 ALLOW: the Owner adds a debit adjustment (a late fee, Rs 500) which has a due date');
select is(pg_temp.rec('a_owner', 'k7', 'adjustment', null, tests.rid('a_c2'), '2026-09-04', 50000, null, 'credit', null, null, null, 'rounding'), 'ok', 'B10 ... and a credit adjustment, which has none');
select is(pg_temp.rec('a_viewer', 'k8', 'charge', tests.rid('a_company'), null, '2026-10-01', 100, '2026-10-31'), '42501', 'B11 DENY: a Viewer');
select is(pg_temp.rec('b_owner', 'k8', 'charge', tests.rid('a_company'), null, '2026-10-01', 100, '2026-10-31'), '42501', 'B12 DENY: another business');
select is(pg_temp.rec('anon', 'k8', 'charge', tests.rid('a_company'), null, '2026-10-01', 100, '2026-10-31'), '42501', 'B13 DENY: anon');
select is(pg_temp.rec('a_owner', 'k8', 'charge', tests.rid('a_company'), null, '2026-10-01', 100), '22023', 'B14 a charge without a due date is invalid');
select is(pg_temp.rec('a_owner', 'k8', 'charge', tests.rid('a_company'), null, '2026-10-01', 100, '2026-09-30'), '22023', 'B15 ... or with a due date before its entry date');
select is(pg_temp.rec('a_owner', 'k8', 'payment', tests.rid('a_company'), null, '2026-10-01', 100, '2026-10-31', null, null, null, 'cash'), '22023', 'B16 a payment has no due date');
select is(pg_temp.rec('a_owner', 'k8', 'payment', tests.rid('a_company'), null, '2026-10-01', 100), '22023', 'B17 a payment names its method');
select is(pg_temp.rec('a_owner', 'k8', 'payment', tests.rid('a_company'), null, '2026-10-01', 100, null, null, null, null, 'barter'), '22023', 'B18 a method outside the closed list is invalid');
select is(pg_temp.rec('a_owner', 'k8', 'payment', tests.rid('a_company'), null, '2090-01-01', 100, null, null, null, null, 'cash'), '22023', 'B19 money received is never dated in the future');
select is(pg_temp.rec('a_owner', 'k8', 'charge', tests.rid('a_company'), null, '2090-01-01', 100, '2090-02-01', null, 'FUT-1'), 'ok', 'B20 ... but a charge may be (next term''s fee)');
select is(pg_temp.rec('a_owner', 'k9', 'adjustment', null, tests.rid('a_c2'), '2026-09-04', 100, null, null, null, null, null, 'correction'), '22023', 'B21 an adjustment says which way (debit or credit)');
select is(pg_temp.rec('a_owner', 'k9', 'adjustment', null, tests.rid('a_c2'), '2026-09-04', 100, null, 'credit', null, null, null, 'because'), '22023', 'B22 a reason code outside the closed list is invalid');
select is(pg_temp.rec('a_owner', 'k9', 'concession', null, tests.rid('a_c2'), '2026-09-04', 100), '22023', 'B23 a concession needs its reason code');
select is(pg_temp.rec('a_owner', 'k9', 'charge', tests.rid('a_company'), null, '2026-10-01', 100, '2026-10-31', null, null, null, null, 'waiver'), '22023', 'B24 a charge has no reason code');
select is(pg_temp.rec('a_owner', 'k9', 'refund', tests.rid('a_company'), null, '2026-10-01', 100, '2026-10-31'), '22023', 'B25 an unknown kind is invalid');
select is(pg_temp.rec('a_owner', 'k9', 'charge', tests.rid('a_company'), tests.rid('a_c2'), '2026-10-01', 100, '2026-10-31'), '22023', 'B26 an entry belongs to ONE party (a company or a contact, not both)');
select is(pg_temp.rec('a_owner', 'k9', 'charge', null, null, '2026-10-01', 100, '2026-10-31'), '22023', 'B27 ... and to one');
select is(pg_temp.rec('a_owner', 'k9', 'charge', tests.rid('a_company'), null, '2026-10-01', 0, '2026-10-31'), '22023', 'B28 an amount of nothing is invalid');
select is(pg_temp.rec('a_owner', 'k9', 'charge', tests.rid('a_company'), null, '2026-10-01', 100000000001, '2026-10-31'), '22023', 'B29 ... and so is one over Rs 100 crore');
select is(pg_temp.rec('a_owner', 'k9', 'charge', tests.rid('a_company'), null, '2026-10-01', 100, '2026-10-31', null, 'l-1'), 'SM781', 'B30 an invoice number is unique among live charges, whatever the case (SM781)');
select is(pg_temp.rec('a_owner', 'k9', 'charge', tests.rid('a_company'), null, '2026-10-01', 100, '2026-10-31', null, 'bad; number'), '22023', 'B31 an invoice number is letters, digits and a few marks');
select is(pg_temp.rec('a_owner', 'k9', 'charge', null, tests.rid('a_c2'), '2026-10-01', 100, '2026-10-31', null, null, 'Ann +91 98480 11111'), '22023', 'B32 a reference cannot hold a name or a phone number: a label only');
select is(pg_temp.rec('a_owner', 'k9', 'charge', tests.rid('b_company'), null, '2026-10-01', 100, '2026-10-31'), '23503', 'B33 a company of another business is not found');
select is(pg_temp.rec('a_owner', 'k9', 'charge', null, tests.rid('b_contact'), '2026-10-01', 100, '2026-10-31'), '23503', 'B34 nor a contact of another business');
select is(pg_temp.rec('a_owner', 'k9', 'payment', tests.rid('a_company'), null, '2026-09-10', 100, null, null, null, null, 'cash', null, tests.rid('k2')), '23503', 'B35 a payment cannot be set against ANOTHER party''s charge');
select is(pg_temp.rec('a_owner', 'k9', 'payment', tests.rid('a_company'), null, '2026-09-10', 100, null, null, null, null, 'cash', null, tests.rid('k3')), '23503', 'B36 nor against a credit');
select is(pg_temp.rec('a_owner', 'k9', 'payment', tests.rid('a_company'), null, '2026-09-10', 100, null, null, null, null, 'cash', null, tests.rid('k1')), 'ok', 'B37 but against that party''s own charge it can');
select is((select count(*) from public.ledger_accounts where tenant_id = tests.tid('a')), 2::bigint, 'B38 one account per party: the company and the contact (no account was made by a refusal)');
select is(pg_temp.sc($$update public.ledger_entries set amount_paise = 1$$), '42501', 'B39 an entry never changes (only voiding does)');
select is(pg_temp.sc($$delete from public.ledger_entries$$), '42501', 'B40 nor is it deleted');
select is(pg_temp.sc($$delete from public.ledger_accounts$$), '42501', 'B41 nor an account');
select is(pg_temp.sc($$truncate public.ledger_entries$$), '42501', 'B42 nor truncated');
select is(pg_temp.val('a_viewer', format($$select count(*)::text from public.ledger_entries where tenant_id = %L$$, tests.tid('a'))), '0', 'B43 a Viewer reads no entry (money)');
select is(pg_temp.val('a_sales', format($$select count(*)::text from public.ledger_entries where tenant_id = %L$$, tests.tid('a'))), '9', 'B44 Sales read them (nine entries so far)');
select is(pg_temp.val('b_owner', format($$select count(*)::text from public.ledger_entries where tenant_id = %L$$, tests.tid('a'))), '0', 'B45 another business sees none');

-- ============================================================================ C. replay and conflict
select is(pg_temp.rec('a_owner', 'k1', 'charge', tests.rid('a_company'), null, '2026-06-01', 1000000, '2026-07-01', null, 'L-1'), 'ok', 'C1 an exact repeat replays');
select is(pg_temp.val('a_owner', format($$select (public.ledger_entry_record(%L, %L, 'charge', %L, null, date '2026-06-01', 1000000, date '2026-07-01', null, 'L-1')->>'replayed')$$, tests.rid('k1'), tests.tid('a'), tests.rid('a_company'))), 'true', 'C2 ... and says so');
select is(pg_temp.rec('a_owner', 'k1', 'charge', tests.rid('a_company'), null, '2026-06-01', 1000001, '2026-07-01', null, 'L-1'), '23505', 'C3 other figures under the same id conflict');
select is(pg_temp.rec('a_owner', 'k1', 'charge', null, tests.rid('a_c2'), '2026-06-01', 1000000, '2026-07-01', null, 'L-1'), '23505', 'C4 ... and so does another party');
select is(pg_temp.rec('b_owner', 'k1', 'charge', tests.rid('b_company'), null, '2026-06-01', 1000000, '2026-07-01', null, 'L-1', p_tenant => 'b'), 'SM701', 'C5 another business cannot use the id (it is refused first by its module)');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a')), 9::bigint, 'C6 a replay and a conflict add nothing');

-- ============================================================================ D. receipts: one series per business per financial year
select is((select string_agg(receipt_no, ',' order by receipt_seq) from public.ledger_entries where tenant_id = tests.tid('a') and kind = 'payment'),
          'R/' || pg_temp.fy() || '/000001,R/' || pg_temp.fy() || '/000002,R/' || pg_temp.fy() || '/000003', 'D1 the three payments are R/<financial year>/000001 to 000003, in the order they were recorded');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and kind <> 'payment' and (receipt_no is not null or receipt_seq is not null)), 0::bigint, 'D2 only a payment has a receipt number');
select is(pg_temp.val('a_owner', format($$select (public.ledger_entry_record(%L, %L, 'payment', %L, null, date '2026-09-01', 400000, null, null, null, null, 'upi')->>'receipt_no')$$, tests.rid('k3'), tests.tid('a'), tests.rid('a_company'))),
          'R/' || pg_temp.fy() || '/000001', 'D3 a replay returns the SAME number and takes no new one');
select is(pg_temp.try('a_admin', format($$select public.ledger_entry_void(%L, %L)$$, tests.tid('a'), tests.rid('k4'))), 'ok', 'D4 the Admin voids the second payment');
select is(pg_temp.rec('a_owner', 'k10', 'payment', tests.rid('a_company'), null, '2026-09-11', 100, null, null, null, null, 'cash'), 'ok', 'D5 the next payment ...');
select is((select receipt_no from public.ledger_entries where id = tests.rid('k10')), 'R/' || pg_temp.fy() || '/000004', 'D6 ... is 000004: a voided receipt keeps its number and the number is not reused');
select is((select receipt_no from public.ledger_entries where id = tests.rid('k4')), 'R/' || pg_temp.fy() || '/000002', 'D7 the voided one is still 000002');
select is(pg_temp.try('a_owner', format($$select public.payment_record(%L, %L, %L, date '2026-09-12', 100, 'cash')$$, gen_random_uuid(), tests.tid('a'), tests.rid('a_company'))), 'ok', 'D8 job CN''s payment_record uses the same series');
select is((select max(receipt_seq) from public.ledger_entries where tenant_id = tests.tid('a')), 5, 'D9 ... it was 000005');
select is(pg_temp.val('a_owner', format($$select (public.payment_record(%L, %L, %L, date '2026-09-12', 100, 'cash')->>'receipt_no') is not null$$, gen_random_uuid(), tests.tid('a'), tests.rid('a_company'))), 'true', 'D10 and it returns the receipt number');
select is(pg_temp.sc(format($$update public.ledger_entries set receipt_seq = 99 where id = %L$$, tests.rid('k10'))), '42501', 'D11 a receipt number never changes');
select is((select count(distinct receipt_no) from public.ledger_entries where tenant_id = tests.tid('a') and receipt_no is not null), (select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and receipt_no is not null), 'D12 and no number is used twice');
select is(pg_temp.sc(format($$insert into public.ledger_entries (id, tenant_id, account_id, kind, direction, amount_paise, entry_date, method, receipt_fy, receipt_seq, receipt_no, source, recorded_by)
                              select gen_random_uuid(), tenant_id, account_id, 'payment', 'credit', 1, date '2026-09-01', 'cash', receipt_fy, receipt_seq, receipt_no, 'manual', recorded_by from public.ledger_entries where id = %L$$, tests.rid('k10'))), '23505', 'D13 the database refuses a duplicate receipt number even from a privileged session');

-- ============================================================================ E. the rules, worked by hand (a contact account, four kinds of entry)
-- C1 Rs 10,000 (1 Aug, due 31 Aug); C2 Rs 10,000 (1 Sep, due 30 Sep); C3 Rs 10,000 (1 Oct, due 15 Nov); late fee (debit adjustment) Rs 500 (2 Oct, due 10 Oct).
-- credits: payment Rs 8,000 (5 Sep), concession Rs 5,000 (6 Sep), credit adjustment Rs 1,000 (7 Sep).
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('a_g'), tests.tid('a'), tests.rid('a_company'), 'Guardian worked', '+00 90000 00072');
select is(pg_temp.rec('a_owner', 'e1', 'charge', null, tests.rid('a_g'), '2026-08-01', 1000000, '2026-08-31', null, null, 'Tuition T1'), 'ok', 'E1 charge 1');
select is(pg_temp.rec('a_owner', 'e2', 'charge', null, tests.rid('a_g'), '2026-09-01', 1000000, '2026-09-30', null, null, 'Tuition T2'), 'ok', 'E2 charge 2');
select is(pg_temp.rec('a_owner', 'e3', 'charge', null, tests.rid('a_g'), '2026-10-01', 1000000, '2026-11-15', null, null, 'Tuition T3'), 'ok', 'E3 charge 3');
select is(pg_temp.rec('a_owner', 'e4', 'adjustment', null, tests.rid('a_g'), '2026-10-02', 50000, '2026-10-10', 'debit', null, null, null, 'late_fee'), 'ok', 'E4 a late fee');
select is(pg_temp.rec('a_owner', 'e5', 'payment', null, tests.rid('a_g'), '2026-09-05', 800000, null, null, null, null, 'bank_transfer'), 'ok', 'E5 a payment of Rs 8,000');
select is(pg_temp.rec('a_owner', 'e6', 'concession', null, tests.rid('a_g'), '2026-09-06', 500000, null, null, null, null, null, 'scholarship'), 'ok', 'E6 a concession of Rs 5,000');
select is(pg_temp.rec('a_owner', 'e7', 'adjustment', null, tests.rid('a_g'), '2026-09-07', 100000, null, 'credit', null, null, null, 'correction'), 'ok', 'E7 a credit adjustment of Rs 1,000');
select is(pg_temp.st(tests.rid('a_g'), 'invoiced_paise'), '3050000', 'E8 invoiced = 3 x 10,000 + 500 = Rs 30,500');
select is(pg_temp.st(tests.rid('a_g'), 'paid_paise'), '1400000', 'E9 credits = 8,000 + 5,000 + 1,000 = Rs 14,000');
select is(pg_temp.st(tests.rid('a_g'), 'payments_paise'), '800000', 'E10 of which payments Rs 8,000');
select is(pg_temp.st(tests.rid('a_g'), 'concessions_paise'), '500000', 'E11 concessions Rs 5,000');
select is(pg_temp.st(tests.rid('a_g'), 'adjustments_paise'), '-50000', 'E12 adjustments net -Rs 500 (+500 late fee, -1,000)');
select is(pg_temp.st(tests.rid('a_g'), 'outstanding_paise'), '1650000', 'E13 owed: oldest first, C1 is paid, C2 has 4,000 paid (6,000 open), C3 10,000, late fee 500 = Rs 16,500');
select is(pg_temp.st(tests.rid('a_g'), 'overdue_paise'), '650000', 'E14 overdue: C2''s 6,000 (due 30 Sep) and the late fee 500 (due 10 Oct) = Rs 6,500');
select is(pg_temp.stb(tests.rid('a_g'), 'ageing', 'd0_30'), '1050000', 'E15 age since the entry, 0-30 days: C3 10,000 + the late fee 500');
select is(pg_temp.stb(tests.rid('a_g'), 'ageing', 'd31_60'), '600000', 'E16 31-60 days: C2''s 6,000 (43 days old)');
select is(pg_temp.stb(tests.rid('a_g'), 'ageing', 'd61_90'), '0', 'E17 61-90: nothing');
select is(pg_temp.stb(tests.rid('a_g'), 'overdue_ageing', 'not_due'), '1000000', 'E18 by days past due: not yet due: C3 10,000');
select is(pg_temp.stb(tests.rid('a_g'), 'overdue_ageing', 'd1_30'), '650000', 'E19 1-30 days past due: C2 (14 days) and the late fee (4 days) = 6,500');
select is(pg_temp.stb(tests.rid('a_g'), 'overdue_ageing', 'd31_60'), '0', 'E20 31-60 days past due: nothing');
select is(pg_temp.st(tests.rid('a_g'), 'outstanding_paise', '2026-09-10'), '600000', 'E21 on 10 Sep (C3 and the late fee not yet entered): C1 and C2 are Rs 20,000, credits Rs 14,000: Rs 6,000');
select is(pg_temp.st(tests.rid('a_g'), 'outstanding_paise', '2026-09-04'), '2000000', 'E22 on 4 Sep (before any credit): C1 + C2 = Rs 20,000 owed');
select is(pg_temp.try('a_admin', format($$select public.ledger_entry_void(%L, %L)$$, tests.tid('a'), tests.rid('e6'))), 'ok', 'E23 the concession is voided (second factor present)');
select is(pg_temp.st(tests.rid('a_g'), 'outstanding_paise'), '2150000', 'E24 and the balance goes back up by Rs 5,000 (C1 has 1,000 open, C2 10,000, C3 10,000, fee 500)');
select is(pg_temp.at('aal1', 'a_admin', format($$select public.ledger_entry_void(%L, %L)$$, tests.tid('a'), tests.rid('e7'))), 'SM306', 'E25 voiding an adjustment needs the second factor too (SM306)');
select is(pg_temp.try('a_sales', format($$select public.ledger_entry_void(%L, %L)$$, tests.tid('a'), tests.rid('e5'))), '42501', 'E26 DENY: Sales cannot void');
select is(pg_temp.try('a_admin', format($$select public.ledger_entry_void(%L, %L)$$, tests.tid('a'), tests.rid('e6'))), 'SM782', 'E27 a voided entry is voided once (SM782)');
select is(pg_temp.st(tests.rid('a_g'), 'credit_paise'), '0', 'E28 no credit while something is owed');
select is(pg_temp.rec('a_owner', 'e8', 'payment', null, tests.rid('a_g'), '2026-10-13', 3000000, null, null, null, null, 'cash'), 'ok', 'E29 a payment of Rs 30,000 (more than is owed)');
select is(pg_temp.st(tests.rid('a_g'), 'outstanding_paise') || '/' || pg_temp.st(tests.rid('a_g'), 'credit_paise'), '0/850000', 'E30 pays everything and leaves Rs 8,500 as an advance credit, never a negative balance');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_statement(%L, null, %L, date '2026-10-14') -> 'open_invoices')::text$q$, tests.tid('a'), tests.rid('a_g'))), '[]', 'E31 and nothing is listed as open');

-- ============================================================================ F. the import of charges
select is(pg_temp.val('a_owner', format($q$select (public.ledger_charges_import(%L, %L, %L::jsonb)->>'added')$q$, tests.tid('a'), tests.rid('batch1'), jsonb_build_array(
  jsonb_build_object('contact_id', tests.rid('a_c2'), 'entry_date', '2026-10-01', 'due_date', '2026-10-31', 'amount_paise', 250000, 'reference', 'Exam fee'),
  jsonb_build_object('company_id', tests.rid('a_company'), 'entry_date', '2026-10-01', 'due_date', '2026-10-31', 'amount_paise', 300000, 'invoice_no', 'L-1'),
  jsonb_build_object('company_id', tests.rid('b_company'), 'entry_date', '2026-10-01', 'due_date', '2026-10-31', 'amount_paise', 300000, 'invoice_no', 'Z-9'),
  jsonb_build_object('entry_date', '2026-10-01', 'due_date', '2026-10-31', 'amount_paise', 100),
  jsonb_build_object('contact_id', tests.rid('a_c2'), 'entry_date', 'next week', 'due_date', '2026-10-31', 'amount_paise', 100),
  jsonb_build_object('contact_id', tests.rid('a_c2'), 'entry_date', '2026-10-01', 'due_date', '2026-10-31', 'amount_paise', 125000, 'reference', 'Bus fee'))::text)), '2', 'F1 six rows: two are added');
select is(pg_temp.val('a_owner', format($q$select coalesce((select string_agg((e->>'row') || '=' || (e->>'reason'), ',' order by (e->>'row')::int) from jsonb_array_elements(public.ledger_charges_import(%L, %L, %L::jsonb)->'skipped') e), 'none')$q$, tests.tid('a'), tests.rid('batch1'), '[{"contact_id": null}]')), 'none', 'F2 a retry of the same batch id adds and reports nothing (the ids come from the batch)');
select is(pg_temp.val('a_owner', format($q$select (select string_agg((e->>'row') || '=' || (e->>'reason'), ',' order by (e->>'row')::int) from jsonb_array_elements(public.ledger_charges_import(%L, %L, %L::jsonb)->'skipped') e)$q$, tests.tid('a'), tests.rid('batch2'), jsonb_build_array(
  jsonb_build_object('company_id', tests.rid('a_company'), 'entry_date', '2026-10-01', 'due_date', '2026-10-31', 'amount_paise', 300000, 'invoice_no', 'L-1'),
  jsonb_build_object('company_id', tests.rid('b_company'), 'entry_date', '2026-10-01', 'due_date', '2026-10-31', 'amount_paise', 300000, 'invoice_no', 'Z-9'),
  jsonb_build_object('entry_date', '2026-10-01', 'due_date', '2026-10-31', 'amount_paise', 100),
  jsonb_build_object('contact_id', tests.rid('a_c2'), 'entry_date', 'next week', 'due_date', '2026-10-31', 'amount_paise', 100))::text)),
  '1=invoice_number_used,2=party_not_found,3=invalid_row,4=invalid_row', 'F3 each bad row is reported with a closed reason, none is fatal');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and source = 'import'), 2::bigint, 'F4 two imported charges in all');
select is(pg_temp.try('a_viewer', format($$select public.ledger_charges_import(%L, %L, '[{"contact_id": null}]'::jsonb)$$, tests.tid('a'), gen_random_uuid())), '42501', 'F5 DENY: a Viewer');
select is(pg_temp.try('a_owner', format($$select public.ledger_charges_import(%L, %L, '[]'::jsonb)$$, tests.tid('a'), gen_random_uuid())), '22023', 'F6 an empty file is invalid');
select is(pg_temp.try('b_owner', format($$select public.ledger_charges_import(%L, %L, '[{"contact_id": null}]'::jsonb)$$, tests.tid('b'), gen_random_uuid())), 'SM701', 'F7 textiles: not on');

-- ============================================================================ G. the summary, the list, the receipt
select is(pg_temp.val('a_owner', format($q$select (select string_agg((e->>'party_kind') || ':' || (e->>'outstanding_paise'), ',' order by (e->>'outstanding_paise')::bigint desc, e->>'account_id' desc) from jsonb_array_elements(public.ledger_summary(%L, date '2026-10-14')) e)$q$, tests.tid('a'))),
  'contact:1275000,company:599600', 'G1 the summary lists every party that owes something, the largest first, with its kind (the contact Rs 12,750, the company Rs 5,996)');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.ledger_summary(%L, date '2026-10-14', 50, null, null, 'contact'))::text$q$, tests.tid('a'))), '1', 'G2 and can be narrowed to contacts');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_summary(%L, date '2026-10-14', 1) -> 0 ->> 'party_name')$q$, tests.tid('a'))), 'Guardian two', 'G3 with the party''s name');
select is(pg_temp.val('a_viewer', format($q$select public.ledger_summary(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'G4 DENY: a Viewer');
select is(pg_temp.val('a_owner', format($q$select public.ledger_summary(%L, null, 50, 5, null)::text$q$, tests.tid('a'))), 'ERR:22023', 'G5 a half cursor is invalid');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.ledger_entries_list(%L, null, %L)->'entries')::text$q$, tests.tid('a'), tests.rid('a_g'))), '8', 'G6 the entries of a party, newest first (eight on the worked account)');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_entries_list(%L, null, %L)->'entries'->0->>'kind')$q$, tests.tid('a'), tests.rid('a_g'))), 'payment', 'G7 the newest is the payment of 13 Oct');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_receipt_get(%L, %L)->>'party_name') || ' | ' || (public.ledger_receipt_get(%L, %L)->>'method') || ' | ' || (public.ledger_receipt_get(%L, %L)->>'amount_paise')$q$,
                                         tests.tid('a'), tests.rid('e8'), tests.tid('a'), tests.rid('e8'), tests.tid('a'), tests.rid('e8'))), 'Guardian worked | cash | 3000000', 'G8 a receipt names the payer, the method and the amount');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_receipt_get(%L, %L)->>'receipt_no') ~ '^R/[0-9]{4}-[0-9]{2}/[0-9]{6}$'$q$, tests.tid('a'), tests.rid('e8'))), 'true', 'G9 ... and its number');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_receipt_get(%L, %L)->>'balance_after_paise')$q$, tests.tid('a'), tests.rid('e8'))), '0', 'G10 ... and the balance after it (nothing owed)');
select is(pg_temp.val('a_owner', format($q$select public.ledger_receipt_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('e1'))), 'ERR:23503', 'G11 a charge is not a receipt (not found)');
select is(pg_temp.val('a_viewer', format($q$select public.ledger_receipt_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('e8'))), 'ERR:42501', 'G12 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.ledger_receipt_get(%L, %L)::text$q$, tests.tid('b'), tests.rid('e8'))), 'ERR:SM701', 'G13 another business: its own module is off');
select is(pg_temp.val('a_owner', format($q$select public.ledger_statement(%L, null, %L)::text$q$, tests.tid('a'), tests.rid('b_contact'))), 'ERR:23503', 'G14 a statement of another business''s contact is not found');
select is(pg_temp.val('a_owner', format($q$select public.ledger_statement(%L, %L, %L)::text$q$, tests.tid('a'), tests.rid('a_company'), tests.rid('a_g'))), 'ERR:42501', 'G15 a statement is of ONE party');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_statement(%L, null, %L) ->> 'outstanding_paise')$q$, tests.tid('a'), tests.rid('a_contact'))), '0', 'G16 a party with no entries has a statement of zeros (no account is made by asking)');
select is((select count(*) from public.ledger_accounts where tenant_id = tests.tid('a') and contact_id = tests.rid('a_contact')), 0::bigint, 'G17 and none was made');

-- ============================================================================ H. another business (education) and isolation
select tests.cp_pack('b', 'education');
select is(pg_temp.rec('b_owner', 'h1', 'charge', null, tests.rid('b_contact'), '2026-10-01', 500000, '2026-10-31', null, null, 'Tuition T1', p_tenant => 'b'), 'ok', 'H1 an education business can use the ledger (module dues): a fee for a guardian');
select is(pg_temp.rec('b_owner', 'h2', 'payment', null, tests.rid('b_contact'), '2026-10-05', 200000, null, null, null, null, 'cash', p_tenant => 'b'), 'ok', 'H2 ... and record the payment');
select is((select receipt_no from public.ledger_entries where id = tests.rid('h2')), 'R/' || pg_temp.fy() || '/000001', 'H3 its receipt numbers are its OWN series (000001, whatever the other business has)');
select is(pg_temp.val('b_owner', format($q$select (public.ledger_statement(%L, null, %L, date '2026-10-14') ->> 'outstanding_paise')$q$, tests.tid('b'), tests.rid('b_contact'))), '300000', 'H4 Rs 5,000 less Rs 2,000 paid = Rs 3,000 owed');
select is(pg_temp.val('b_owner', format($q$select count(*)::text from public.ledger_entries where tenant_id = %L$q$, tests.tid('a'))), '0', 'H5 the education business sees none of the construction business''s entries');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_statement(%L, null, %L) ->> 'outstanding_paise')$q$, tests.tid('a'), tests.rid('b_contact'))), 'ERR:23503', 'H6 and cannot ask for its contacts');
select is(pg_temp.rec('b_owner', 'h3', 'payment', null, tests.rid('b_contact'), '2026-10-06', 100, null, null, null, null, 'cash', null, tests.rid('e1'), p_tenant => 'b'), '23503', 'H7 an entry cannot be set against another business''s charge');

select * from finish();
rollback;
