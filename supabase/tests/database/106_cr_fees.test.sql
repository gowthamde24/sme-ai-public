-- Job CR (ADR 0087), part 3: FEES on the shared ledger. Fee plans (heads, instalments, a late-fee rule), a plan assigned to a student (the instalments become charges on the student's OWN account), payments with
-- receipt numbers, concessions and adjustments (Owner or Admin, second factor), late fees (computed by a rule, posted by a person), the statement, the receipt, the guardian's total, the pending list, a fee reminder
-- for a guardian with two children, and admitted -> student -> plan in one transaction.
--   A structure, grants, RLS, module    B fee plans    C assigning a plan    D payments and receipts: the ledger worked by hand    E concessions and adjustments    F the statement, the entries, the guardian
--   G late fees    H voiding an assignment    I the pending list    J a reminder for a guardian with two children    K admitted with a plan    L guards
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'education');
select tests.open_gate('a');

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
create function pg_temp.vala(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.today(p_day text) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.dues_today() returns date language sql stable set search_path = '''' as $b$ select date %L $b$', p_day);
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_day || ' 11:00:00+05:30');
end $fn$;
select pg_temp.today('2026-10-14');

-- the school: two classes, three guardians, five students (directly, as a privileged fixture; the functions are proved in 104)
insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values
  (tests.rid('p5'), tests.tid('a'), 'Class 5', 'class', 'section', tests.uid('a_owner')),
  (tests.rid('p6'), tests.tid('a'), 'Class 6', 'class', 'section', tests.uid('a_owner'));
insert into public.programme_groups (id, tenant_id, programme_id, label, created_by) values
  (tests.rid('g5a'), tests.tid('a'), tests.rid('p5'), 'A', tests.uid('a_owner')),
  (tests.rid('g5b'), tests.tid('a'), tests.rid('p5'), 'B', tests.uid('a_owner'));
insert into public.contacts (id, tenant_id, full_name, phone) values
  (tests.rid('g1'), tests.tid('a'), 'Rao Parent', '+00 90030 00001'),
  (tests.rid('g2'), tests.tid('a'), 'Reddy Parent', '+00 90030 00002'),
  (tests.rid('g3'), tests.tid('a'), 'Sita Parent', '+00 90030 00003');
insert into public.students (id, tenant_id, contact_id, is_adult, child_label, programme_id, group_id, created_by) values
  (tests.rid('s1'), tests.tid('a'), tests.rid('g1'), false, 'Asha', tests.rid('p5'), tests.rid('g5a'), tests.uid('a_owner')),
  (tests.rid('s2'), tests.tid('a'), tests.rid('g1'), false, 'Bala', tests.rid('p5'), tests.rid('g5b'), tests.uid('a_owner')),
  (tests.rid('s3'), tests.tid('a'), tests.rid('g2'), false, 'Chitra', tests.rid('p5'), tests.rid('g5a'), tests.uid('a_owner')),
  (tests.rid('s4'), tests.tid('a'), tests.rid('g3'), false, 'Dev', tests.rid('p6'), null, tests.uid('a_owner')),
  (tests.rid('s5'), tests.tid('a'), tests.rid('g3'), false, 'Esha', tests.rid('p5'), tests.rid('g5a'), tests.uid('a_owner'));

create function pg_temp.plan(p_user text, p_id text, p_name text, p_prog text, p_kind text, p_amt bigint, p_grace int, p_cap bigint, p_lines jsonb, p_year text default '2026-27', p_group text default null) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.fee_plan_save(%L, %L, %L, %L, %L, %L, %L, %L, %s, %L, true, %L::jsonb)$q$, tests.rid(p_id), tests.tid('a'), p_name, tests.rid(p_prog),
                                    case when p_group is null then null else tests.rid(p_group)::text end, p_year, p_kind, p_amt, p_grace, p_cap, p_lines::text))
$$;
create function pg_temp.assign(p_user text, p_aid text, p_student text, p_plan text, p_on text default '2026-06-01') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.fee_assign(%L, %L, %L, %L, date %L)$q$, tests.rid(p_aid), tests.tid('a'), tests.rid(p_student), tests.rid(p_plan), p_on))
$$;
create function pg_temp.pay(p_user text, p_eid text, p_student text, p_on text, p_amount bigint, p_method text default 'cash') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.fee_payment_record(%L, %L, %L, date %L, %L, %L)$q$, tests.rid(p_eid), tests.tid('a'), tests.rid(p_student), p_on, p_amount, p_method))
$$;
create function pg_temp.stmt(p_student text, p_key text, p_as_of text default null) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.fee_statement(%L, %L, %s) -> 'statement' ->> %L)$q$, tests.tid('a'), tests.rid(p_student), case when p_as_of is null then 'null' else format('date %L', p_as_of) end, p_key))
$$;
create function pg_temp.bucket(p_student text, p_obj text, p_key text, p_as_of text default null) returns text language sql as $$
  select pg_temp.val('a_owner', format($q$select (public.fee_statement(%L, %L, %s) -> 'statement' -> %L ->> %L)$q$, tests.tid('a'), tests.rid(p_student), case when p_as_of is null then 'null' else format('date %L', p_as_of) end, p_obj, p_key))
$$;
create function pg_temp.conc(p_user text, p_eid text, p_student text, p_mode text, p_value bigint, p_reason text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.at(p_aal, p_user, format($q$select public.fee_concession_apply(%L, %L, %L, %L, %L, %L)$q$, tests.rid(p_eid), tests.tid('a'), tests.rid(p_student), p_mode, p_value, p_reason))
$$;

-- the plan of Class 5, 2026-27: Rs 35,000 in five instalments; a late fee of Rs 50 a day after a 5-day grace, never above Rs 500
create function pg_temp.lines5() returns jsonb language sql as $$ select jsonb_build_array(
  jsonb_build_object('head', 'tuition', 'instalment_no', 1, 'due_date', '2026-06-10', 'amount_paise', 1000000),
  jsonb_build_object('head', 'tuition', 'instalment_no', 2, 'due_date', '2026-10-10', 'amount_paise', 1000000),
  jsonb_build_object('head', 'tuition', 'instalment_no', 3, 'due_date', '2027-01-10', 'amount_paise', 1000000),
  jsonb_build_object('head', 'transport', 'instalment_no', 1, 'due_date', '2026-06-12', 'amount_paise', 200000),
  jsonb_build_object('head', 'books', 'instalment_no', 1, 'due_date', '2026-07-01', 'amount_paise', 300000)) $$;

-- ============================================================================ A. structure, grants, RLS, module
select is((select count(*) from pg_class where relname in ('fee_plans', 'fee_plan_lines', 'fee_assignments') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 3::bigint, 'A1 RLS is enabled and forced on the three tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('fee_plans', 'fee_plan_lines', 'fee_assignments') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'A2 a client can only read them');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('fee_plans', 'fee_plan_lines', 'fee_assignments') and grantee in ('anon', 'public', 'service_role')), 0::bigint, 'A3 anon, PUBLIC and the service role hold nothing');
select is(pg_temp.try('b_owner', format($q$select public.fee_plans_list(%L)$q$, tests.tid('b'))), 'SM701', 'A4 textiles: fees are not on (SM701)');
select is(pg_temp.try('b_owner', format($q$select public.fee_payment_record(gen_random_uuid(), %L, gen_random_uuid(), date '2026-10-01', 100, 'cash')$q$, tests.tid('b'))), 'SM701', 'A5 nor a fee payment');
select is(pg_temp.try('a_owner', format($q$insert into public.fee_plans (id, tenant_id, name, programme_id, academic_year, created_by) values (gen_random_uuid(), %L, 'Direct', %L, '2026-27', %L)$q$, tests.tid('a'), tests.rid('p5'), tests.uid('a_owner'))), '42501', 'A6 DENY: a client cannot write a plan directly');
select is((select count(*) from pg_constraint where conrelid = 'public.ledger_accounts'::regclass and conname = 'ledger_accounts_party_check'), 1::bigint, 'A7 a ledger account is for one of a company, a contact or a student');

-- ============================================================================ B. fee plans
select is(pg_temp.plan('a_owner', 'pl5', 'Class 5 fees', 'p5', 'per_day', 5000, 5, 50000, pg_temp.lines5()), 'ok', 'B1 ALLOW: the Owner makes the plan of Class 5');
select is(pg_temp.plan('a_admin', 'pl6', 'Class 6 fees', 'p6', 'fixed', 10000, 0, null, jsonb_build_array(jsonb_build_object('head', 'tuition', 'instalment_no', 1, 'due_date', '2026-09-01', 'amount_paise', 500000))), 'ok', 'B2 ALLOW: an Admin makes one with a fixed late fee');
select is(pg_temp.plan('a_sales', 'plx', 'Nope', 'p5', 'none', null, 0, null, pg_temp.lines5()), '42501', 'B3 DENY: Sales');
select is(pg_temp.plan('a_viewer', 'plx', 'Nope', 'p5', 'none', null, 0, null, pg_temp.lines5()), '42501', 'B4 DENY: a Viewer');
select is(pg_temp.plan('b_owner', 'plx', 'Nope', 'p5', 'none', null, 0, null, pg_temp.lines5()), '42501', 'B5 DENY: another business');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'fixed', null, 0, null, pg_temp.lines5()), '22023', 'B6 a late-fee rule needs an amount');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'none', 100, 0, null, pg_temp.lines5()), '22023', 'B7 no rule has none');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'fixed', 100, 0, 500, pg_temp.lines5()), '22023', 'B8 only a per-day rule has a cap');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'none', null, 0, null, '[]'::jsonb), '22023', 'B9 a plan has at least one line');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'none', null, 0, null, jsonb_build_array(jsonb_build_object('head', 'tuition', 'instalment_no', 1, 'due_date', '2026-06-10', 'amount_paise', 0))), '22023', 'B10 a line of nothing is invalid');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'none', null, 0, null, jsonb_build_array(jsonb_build_object('head', 'fun', 'instalment_no', 1, 'due_date', '2026-06-10', 'amount_paise', 100))), '22023', 'B11 a head outside the list is invalid');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'none', null, 0, null, jsonb_build_array(jsonb_build_object('head', 'tuition', 'instalment_no', 1, 'due_date', '2026-06-10', 'amount_paise', 100), jsonb_build_object('head', 'tuition', 'instalment_no', 1, 'due_date', '2026-07-10', 'amount_paise', 100))), '23505', 'B12 a head and instalment number once');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'none', null, 0, null, jsonb_build_array(jsonb_build_object('head', 'tuition', 'instalment_no', 1, 'due_date', '2026-06-10', 'amount_paise', 100, 'x', 1))), '22023', 'B13 a line holds four things, nothing else');
select is(pg_temp.plan('a_owner', 'plx', 'Nope', 'p5', 'none', null, 0, null, pg_temp.lines5(), '2026'), '22023', 'B14 the academic year looks like 2026-27');
select is(pg_temp.plan('a_owner', 'plx', 'Class 5 fees', 'p5', 'none', null, 0, null, pg_temp.lines5()), '23505', 'B15 two plans of one year with the same name are a conflict');
select is(pg_temp.try('a_owner', format($q$select public.fee_plan_save(%L, %L, 'X', %L, null, '2026-27', 'none', null, 0, null, true, %L::jsonb)$q$, tests.rid('plx'), tests.tid('a'), gen_random_uuid(), pg_temp.lines5()::text)), '23503', 'B16 a programme that does not exist is not found');
select is(pg_temp.plan('a_owner', 'pl5', 'Class 5 fees', 'p5', 'per_day', 5000, 5, 50000, pg_temp.lines5()), 'ok', 'B17 an exact repeat replays (nobody has the plan yet)');
select is((select count(*) from public.fee_plan_lines where plan_id = tests.rid('pl5')), 5::bigint, 'B18 with its five lines, none doubled');
select is(pg_temp.val('a_sales', format($q$select (public.fee_plan_get(%L, %L) ->> 'total_paise')$q$, tests.tid('a'), tests.rid('pl5'))), '3500000', 'B19 Sales read it: Rs 35,000 in all');
select is(pg_temp.val('a_viewer', format($q$select public.fee_plans_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'B20 a Viewer reads no fee plan (money)');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.fee_plans_list(%L, %L))::text$q$, tests.tid('a'), tests.rid('p5'))), '1', 'B21 the plans of a programme');
select is(pg_temp.sc(format($q$update public.fee_plan_lines set amount_paise = 1 where plan_id = %L$q$, tests.rid('pl5'))), '42501', 'B22 a line is replaced, never changed');
select is(pg_temp.sc(format($q$delete from public.fee_plan_lines where plan_id = %L$q$, tests.rid('pl5'))), '42501', 'B23 nor deleted outside the save');

-- ============================================================================ C. assigning a plan
select is(pg_temp.assign('a_owner', 'as1', 's1', 'pl5'), 'ok', 'C1 ALLOW: the Owner assigns the plan to Asha (assigned on 1 June)');
select is((select count(*) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s1') and e.kind = 'charge'), 5::bigint, 'C2 five charges on her OWN account');
select is((select sum(e.amount_paise) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s1')), 3500000::numeric, 'C3 Rs 35,000');
select is((select string_agg(e.reference, ',' order by e.reference) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s1')), 'Books 1,Transport 1,Tuition 1,Tuition 2,Tuition 3', 'C4 each charge is labelled by its head and number');
select is((select count(*) from public.ledger_accounts where student_id = tests.rid('s1') and company_id is null and contact_id is null), 1::bigint, 'C5 the account belongs to the student alone (not to the guardian)');
select is(pg_temp.assign('a_owner', 'as1', 's1', 'pl5'), 'ok', 'C6 an exact repeat replays: nothing is charged twice');
select is((select count(*) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s1')), 5::bigint, 'C7 (still five)');
select is(pg_temp.assign('a_owner', 'as1', 's2', 'pl5'), '23505', 'C8 the same assignment id for another student is a conflict');
select is(pg_temp.assign('a_owner', 'as1b', 's1', 'pl5'), 'SM814', 'C9 one live plan per student per year (SM814)');
select is(pg_temp.assign('a_admin', 'as2', 's2', 'pl5'), 'ok', 'C10 ALLOW: an Admin assigns it to Bala');
select is(pg_temp.assign('a_sales', 'asx', 's3', 'pl5'), '42501', 'C11 DENY: Sales');
select is(pg_temp.assign('a_viewer', 'asx', 's3', 'pl5'), '42501', 'C12 DENY: a Viewer');
select is(pg_temp.assign('b_owner', 'asx', 's3', 'pl5'), '42501', 'C13 DENY: another business');
select is(pg_temp.assign('a_owner', 'asx', 's4', 'pl5'), '22023', 'C14 a plan for another programme is invalid');
select is(pg_temp.assign('a_owner', 'asx', 's3', 'pl5', '2030-01-01'), '22023', 'C15 not assigned in the future');
select is(pg_temp.try('a_owner', format($q$select public.fee_assign(%L, %L, %L, gen_random_uuid(), null)$q$, tests.rid('asx'), tests.tid('a'), tests.rid('s3'))), '23503', 'C16 a plan that does not exist is not found');
select is(pg_temp.plan('a_owner', 'pl5', 'Class 5 fees', 'p5', 'per_day', 5000, 5, 50000, pg_temp.lines5()), 'SM813', 'C17 a plan someone has been assigned can no longer change (SM813)');
select app.edu_edit(true);
update public.students set status = 'left', left_on = date '2026-09-01' where id = tests.rid('s5');
select app.edu_edit(false);
select is(pg_temp.assign('a_owner', 'asx', 's5', 'pl5'), 'SM815', 'C18 a student who left cannot be given a plan (SM815)');
select is(pg_temp.assign('a_owner', 'as4', 's4', 'pl6', '2026-08-01'), 'ok', 'C19 Dev (Class 6) gets the Class 6 plan, with a fixed late fee');
select is((select min(e.entry_date)::text from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s4')), '2026-08-01', 'C20 the entry is dated the day it was assigned');
select is(pg_temp.stmt('s1', 'invoiced_paise'), '3500000', 'C21 Asha is charged Rs 35,000');
select is(pg_temp.stmt('s1', 'outstanding_paise'), '3500000', 'C22 and owes it all');
select is(pg_temp.stmt('s1', 'overdue_paise'), '2500000', 'C23 of which Rs 25,000 has fallen due (tuition 1 and 2, transport, books) on 14 Oct');

-- ============================================================================ D. payments and receipts: the ledger worked by hand
select is(pg_temp.pay('a_sales', 'pay1', 's1', '2026-06-05', 1200000), 'ok', 'D1 ALLOW: Sales record a payment of Rs 12,000 (5 June)');
select is((select receipt_no from public.ledger_entries where id = tests.rid('pay1')), 'R/2026-27/000001', 'D2 the first receipt of the year');
select is(pg_temp.pay('a_admin', 'pay2', 's2', '2026-06-06', 500000, 'upi'), 'ok', 'D3 ALLOW: an Admin records Bala''s payment of Rs 5,000');
select is((select receipt_no from public.ledger_entries where id = tests.rid('pay2')), 'R/2026-27/000002', 'D4 the second receipt: one series for the whole school, not per student');
select is(pg_temp.pay('a_viewer', 'payx', 's1', '2026-06-05', 100), '42501', 'D5 DENY: a Viewer');
select is(pg_temp.pay('b_owner', 'payx', 's1', '2026-06-05', 100), '42501', 'D6 DENY: another business');
select is(pg_temp.pay('a_owner', 'payx', 's1', '2026-06-05', 100, 'barter'), '22023', 'D7 a method outside the closed list is invalid');
select is(pg_temp.pay('a_owner', 'payx', 's1', '2030-01-01', 100), '22023', 'D8 a payment is never dated in the future');
select is(pg_temp.pay('a_owner', 'payx', 's1', '2026-06-05', 0), '22023', 'D9 nor of nothing');
select is(pg_temp.try('a_owner', format($q$select public.fee_payment_record(%L, %L, gen_random_uuid(), date '2026-06-05', 100, 'cash')$q$, tests.rid('payx'), tests.tid('a'))), '23503', 'D10 a student that does not exist is not found');
select is(pg_temp.pay('a_owner', 'pay1', 's1', '2026-06-05', 1200000), 'ok', 'D11 an exact repeat replays: the same receipt, no second payment');
select is(pg_temp.pay('a_owner', 'pay1', 's1', '2026-06-05', 1200001), '23505', 'D12 other figures under the same id conflict');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and kind = 'payment'), 2::bigint, 'D13 two payments on record');
-- worked by hand: Asha owes 35,000 and paid 12,000: the 12,000 clears tuition 1 and transport (both due 10 June); 23,000 is open
select is(pg_temp.stmt('s1', 'outstanding_paise'), '2300000', 'D14 Asha owes Rs 23,000');
select is(pg_temp.stmt('s1', 'paid_paise'), '1200000', 'D15 she has paid Rs 12,000');
select is(pg_temp.stmt('s1', 'overdue_paise'), '1300000', 'D16 overdue: books (Rs 3,000) and tuition 2 (Rs 10,000); the payment went to the OLDEST claims first');
select is(pg_temp.bucket('s1', 'overdue_ageing', 'd90_plus'), '300000', 'D17 books are 105 days past due (over 90)');
select is(pg_temp.bucket('s1', 'overdue_ageing', 'd1_30'), '1000000', 'D18 tuition 2 is 4 days past due');
select is(pg_temp.bucket('s1', 'overdue_ageing', 'not_due'), '1000000', 'D19 tuition 3 is not yet due');
select is(pg_temp.bucket('s1', 'ageing', 'd90_plus'), '2300000', 'D20 by the age of the entry (1 June): all Rs 23,000 is over 90 days old');
select is(pg_temp.stmt('s1', 'outstanding_paise', '2026-06-04'), '3500000', 'D21 on 4 June, before the payment, Rs 35,000');
select is(pg_temp.stmt('s1', 'outstanding_paise', '2026-06-05'), '2300000', 'D22 on 5 June, after it, Rs 23,000');
select is(pg_temp.stmt('s2', 'outstanding_paise'), '3000000', 'D23 Bala owes Rs 30,000: a payment of one child never lands on another''s account');
select is(pg_temp.val('a_owner', format($q$select (public.fee_receipt_get(%L, %L) ->> 'receipt_no')$q$, tests.tid('a'), tests.rid('pay1'))), 'R/2026-27/000001', 'D24 the receipt of the first payment');
select is(pg_temp.val('a_owner', format($q$select (public.fee_receipt_get(%L, %L) ->> 'paid_by')$q$, tests.tid('a'), tests.rid('pay1'))), 'Rao Parent', 'D25 ... says who paid (the guardian)');
select is(pg_temp.val('a_owner', format($q$select (public.fee_receipt_get(%L, %L) -> 'student' ->> 'display_name')$q$, tests.tid('a'), tests.rid('pay1'))), 'Asha', 'D26 ... for whom');
select is(pg_temp.val('a_owner', format($q$select (public.fee_receipt_get(%L, %L) ->> 'balance_after_paise')$q$, tests.tid('a'), tests.rid('pay1'))), '2300000', 'D27 ... and the balance after it');
select is(pg_temp.val('a_owner', format($q$select (public.fee_receipt_get(%L, %L) ->> 'business_name')$q$, tests.tid('a'), tests.rid('pay1'))), (select name from public.tenants where id = tests.tid('a')), 'D28 ... and the school''s name');
select is(pg_temp.val('a_viewer', format($q$select public.fee_receipt_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('pay1'))), 'ERR:42501', 'D29 DENY: a Viewer');
select is(pg_temp.val('a_owner', format($q$select public.fee_receipt_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('as1'))), 'ERR:23503', 'D30 only a payment is a receipt');
select is(pg_temp.try('a_sales', format($q$select public.ledger_entry_void(%L, %L)$q$, tests.tid('a'), tests.rid('pay2'))), '42501', 'D31 DENY: Sales cannot void a payment');
select is(pg_temp.try('a_admin', format($q$select public.ledger_entry_void(%L, %L)$q$, tests.tid('a'), tests.rid('pay2'))), 'ok', 'D32 ALLOW: an Admin voids Bala''s payment (the shared void)');
select is(pg_temp.stmt('s2', 'outstanding_paise'), '3500000', 'D33 Bala owes Rs 35,000 again');
select is(pg_temp.pay('a_owner', 'pay3', 's2', '2026-06-07', 300000), 'ok', 'D34 and a new payment is recorded');
select is((select receipt_no from public.ledger_entries where id = tests.rid('pay3')), 'R/2026-27/000003', 'D35 it gets the NEXT number: a voided receipt keeps its own and a number is never reused');
select is((select receipt_no from public.ledger_entries where id = tests.rid('pay2')), 'R/2026-27/000002', 'D36 (the voided one still has 2)');
select is(pg_temp.vala('aal2', 'a_owner', format($q$select (public.fee_receipt_get(%L, %L) ->> 'voided')$q$, tests.tid('a'), tests.rid('pay2'))), 'true', 'D37 and its receipt says so');

-- ============================================================================ E. concessions and adjustments
select is(pg_temp.conc('a_owner', 'c1', 's1', 'percent', 10, 'sibling'), 'ok', 'E1 ALLOW: the Owner gives Asha a 10 percent sibling concession');
select is((select amount_paise from public.ledger_entries where id = tests.rid('c1')), 350000::bigint, 'E2 10 percent of Rs 35,000 charged is Rs 3,500, computed by the database from the charges');
select is((select reason_code from public.ledger_entries where id = tests.rid('c1')), 'sibling', 'E3 with its reason code');
select is(pg_temp.conc('a_admin', 'c2', 's1', 'amount', 200000, 'hardship'), 'ok', 'E4 ALLOW: an Admin gives a Rs 2,000 hardship concession');
select is(pg_temp.conc('a_sales', 'cx', 's1', 'amount', 100, 'merit'), '42501', 'E5 DENY: Sales');
select is(pg_temp.conc('a_viewer', 'cx', 's1', 'amount', 100, 'merit'), '42501', 'E6 DENY: a Viewer');
select is(pg_temp.conc('a_owner', 'cx', 's1', 'amount', 100, 'merit', 'aal1'), 'SM306', 'E7 a concession needs a second factor (SM306)');
select is(pg_temp.conc('a_owner', 'cx', 's1', 'amount', 100, 'discount'), '22023', 'E8 a reason outside the closed list is invalid');
select is(pg_temp.conc('a_owner', 'cx', 's1', 'percent', 101, 'merit'), '22023', 'E9 a percentage is 1 to 100');
select is(pg_temp.conc('a_owner', 'cx', 's1', 'amount', 3500000, 'merit'), '22023', 'E10 concessions together never exceed what was charged');
select is(pg_temp.conc('a_owner', 'cx', 's3', 'amount', 100, 'merit'), '23503', 'E12 a student with nothing charged has no account to give a concession on');
select is(pg_temp.conc('a_owner', 'c1', 's1', 'percent', 10, 'sibling'), 'ok', 'E13 an exact repeat replays');
select is((select count(*) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s1') and e.kind = 'concession'), 2::bigint, 'E14 (two concessions, none doubled)');
-- worked by hand: Asha owes 35,000 - 12,000 paid - 3,500 - 2,000 = 17,500. The credits (12,000 + 3,500 + 2,000 = 17,500) clear tuition 1, transport and books (15,000) and Rs 2,500 of tuition 2.
select is(pg_temp.stmt('s1', 'outstanding_paise'), '1750000', 'E15 Asha owes Rs 17,500');
select is(pg_temp.stmt('s1', 'concessions_paise'), '550000', 'E16 concessions Rs 5,500');
select is(pg_temp.stmt('s1', 'overdue_paise'), '750000', 'E17 overdue: Rs 7,500 of tuition 2 (the credits cleared books and part of tuition 2)');
select is(pg_temp.val('a_owner', format($q$select (public.fee_statement(%L, %L) -> 'statement' -> 'open_invoices' -> 0 ->> 'reference')$q$, tests.tid('a'), tests.rid('s1'))), 'Tuition 2', 'E18 the first open claim is tuition 2');
select is(pg_temp.try('a_owner', format($q$select public.fee_adjustment_record(%L, %L, %L, 'credit', 50000, 'rounding')$q$, tests.rid('ad1'), tests.tid('a'), tests.rid('s1'))), 'ok', 'E19 ALLOW: a correction down of Rs 500 (Owner, second factor)');
select is(pg_temp.stmt('s1', 'outstanding_paise'), '1700000', 'E20 Asha owes Rs 17,000');
select is(pg_temp.try('a_owner', format($q$select public.fee_adjustment_record(%L, %L, %L, 'debit', 50000, 'correction', date '2026-11-01')$q$, tests.rid('ad2'), tests.tid('a'), tests.rid('s1'))), 'ok', 'E21 ALLOW: a correction up of Rs 500 with a due date');
select is(pg_temp.stmt('s1', 'outstanding_paise'), '1750000', 'E22 back to Rs 17,500');
select is(pg_temp.try('a_owner', format($q$select public.fee_adjustment_record(%L, %L, %L, 'debit', 50000, 'correction')$q$, tests.rid('ad3'), tests.tid('a'), tests.rid('s1'))), '22023', 'E23 a debit without a due date is invalid');
select is(pg_temp.try('a_owner', format($q$select public.fee_adjustment_record(%L, %L, %L, 'credit', 50000, 'late_fee')$q$, tests.rid('ad3'), tests.tid('a'), tests.rid('s1'))), '22023', 'E24 `late_fee` is not a reason a person may give: only the rule posts it');
select is(pg_temp.try('a_sales', format($q$select public.fee_adjustment_record(%L, %L, %L, 'credit', 50000, 'rounding')$q$, tests.rid('ad3'), tests.tid('a'), tests.rid('s1'))), '42501', 'E25 DENY: Sales');
select is(pg_temp.at('aal1', 'a_owner', format($q$select public.fee_adjustment_record(%L, %L, %L, 'credit', 50000, 'rounding')$q$, tests.rid('ad3'), tests.tid('a'), tests.rid('s1'))), 'SM306', 'E26 an adjustment needs a second factor');
select is(pg_temp.try('a_admin', format($q$select public.ledger_entry_void(%L, %L)$q$, tests.tid('a'), tests.rid('ad1'))), 'ok', 'E27 (an adjustment can be voided by an Admin, with the second factor)');
select is(pg_temp.try('a_admin', format($q$select public.ledger_entry_void(%L, %L)$q$, tests.tid('a'), tests.rid('ad1'))), 'SM782', 'E28 once');

-- ============================================================================ F. the statement, the entries, the guardian
select is(pg_temp.val('a_sales', format($q$select (public.fee_statement(%L, %L) -> 'student' ->> 'display_name')$q$, tests.tid('a'), tests.rid('s1'))), 'Asha', 'F1 Sales read a student''s statement (with the name the front desk uses)');
select is(pg_temp.val('a_sales', format($q$select (public.fee_statement(%L, %L) -> 'assignment' ->> 'plan_name')$q$, tests.tid('a'), tests.rid('s1'))), 'Class 5 fees', 'F2 and the plan');
select is(pg_temp.val('a_viewer', format($q$select public.fee_statement(%L, %L)::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:42501', 'F3 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.fee_statement(%L, %L)::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:42501', 'F4 DENY: another business');
select is(pg_temp.stmt('s3', 'outstanding_paise'), '0', 'F5 a student with no entries yet owes nothing (an empty statement)');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.fee_entries_list(%L, %L) -> 'entries')::text$q$, tests.tid('a'), tests.rid('s1'))), '10', 'F6 Asha''s entries: five charges, one payment, two concessions, two adjustments (one voided) = ten');
select is(pg_temp.val('a_owner', format($q$select count(*)::text from jsonb_array_elements(public.fee_entries_list(%L, %L) -> 'entries') e where (e ->> 'voided')::boolean$q$, tests.tid('a'), tests.rid('s1'))), '1', 'F7 the voided one is marked');
select is(pg_temp.val('a_owner', format($q$select public.fee_entries_list(%L, %L, 0)::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:22023', 'F8 a page of none is invalid');
select is(pg_temp.val('a_owner', format($q$select (public.fee_guardian_statement(%L, %L) ->> 'outstanding_paise')$q$, tests.tid('a'), tests.rid('g1'))), '5000000', 'F10 the guardian of Asha and Bala owes Rs 50,000: Asha 18,000 (her correction up of Rs 500 stands, the correction down was voided) + Bala 35,000 - 3,000 paid = 32,000');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.fee_guardian_statement(%L, %L) -> 'students')::text$q$, tests.tid('a'), tests.rid('g1'))), '2', 'F11 listed child by child');
select is(pg_temp.val('a_viewer', format($q$select public.fee_guardian_statement(%L, %L)::text$q$, tests.tid('a'), tests.rid('g1'))), 'ERR:42501', 'F12 DENY: a Viewer');
select is(pg_temp.val('a_owner', format($q$select (public.ledger_statement(%L, null, %L) ->> 'student_id') is null$q$, tests.tid('a'), tests.rid('g1'))), 'true', 'F13 the guardian''s own ledger (a contact) is a different account from the children''s: it has no student');
select is(pg_temp.val('a_owner', format($q$select count(*)::text from jsonb_array_elements(public.ledger_summary(%L)) e$q$, tests.tid('a'))), '0', 'F14 the shared summary of parties does not list the children''s accounts (it would not name them)');

-- ============================================================================ G. late fees
-- Asha: nothing late (her only open claim, tuition 2 due 10 Oct, is inside the 5-day grace on 14 Oct). Bala: tuition 1, transport and books are open and long late; Rs 50 a day, capped at Rs 500, for each.
select is(pg_temp.val('a_sales', format($q$select (public.fee_late_fees_preview(%L) ->> 'count')$q$, tests.tid('a'))), '4', 'G1 the rule gives four late fees on 14 Oct: Bala''s three long-late instalments and Dev''s fixed one');
select is(pg_temp.val('a_sales', format($q$select (public.fee_late_fees_preview(%L) ->> 'total_paise')$q$, tests.tid('a'))), '160000', 'G2 Rs 500 each at the cap for Bala (Rs 1,500) and Rs 100 fixed for Dev: Rs 1,600');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and reason_code = 'late_fee'), 0::bigint, 'G3 looking adds nothing to anyone''s account');
select is(pg_temp.val('a_viewer', format($q$select public.fee_late_fees_preview(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'G4 DENY: a Viewer');
select is(pg_temp.try('a_sales', format($q$select public.fee_late_fees_post(%L)$q$, tests.tid('a'))), '42501', 'G5 DENY: Sales cannot post them');
select is(pg_temp.at('aal1', 'a_owner', format($q$select public.fee_late_fees_post(%L)$q$, tests.tid('a'))), 'SM306', 'G6 posting needs a second factor');
select is(pg_temp.val('a_owner', format($q$select (public.fee_late_fees_post(%L) ->> 'posted')$q$, tests.tid('a'))), '4', 'G7 ALLOW: the Owner posts them');
select is((select count(*) from public.ledger_entries where tenant_id = tests.tid('a') and reason_code = 'late_fee' and kind = 'adjustment' and direction = 'debit'), 4::bigint, 'G8 four debit adjustments, each against its own instalment');
select is((select count(*) from public.ledger_entries e where e.reason_code = 'late_fee' and e.against_entry_id is not null and e.due_date = date '2026-10-14' and e.reference = 'Late fee'), 4::bigint, 'G9 due the day they were posted');
select is(pg_temp.val('a_owner', format($q$select (public.fee_late_fees_post(%L) ->> 'posted')$q$, tests.tid('a'))), '0', 'G10 posting again adds nothing');
select is(pg_temp.stmt('s2', 'outstanding_paise'), '3350000', 'G12 Bala owes Rs 33,500: Rs 35,000 - Rs 3,000 paid + Rs 1,500 late fees');
select is(pg_temp.stmt('s1', 'outstanding_paise'), '1800000', 'G13 Asha is untouched (Rs 18,000)');
-- two days on: tuition 2 (due 10 Oct) is 1 day past its grace on 16 Oct
select pg_temp.today('2026-10-16');
select is(pg_temp.val('a_owner', format($q$select (public.fee_late_fees_preview(%L) ->> 'count')$q$, tests.tid('a'))), '2', 'G14 on 16 Oct two more fall due: tuition 2 of Asha and of Bala (1 day past the grace)');
select is(pg_temp.val('a_owner', format($q$select (public.fee_late_fees_preview(%L) ->> 'total_paise')$q$, tests.tid('a'))), '10000', 'G15 Rs 50 each: Rs 100 (Dev''s fixed fee was posted on the 14th and is once only; Bala''s other three are at their cap)');
select is(pg_temp.val('a_owner', format($q$select (public.fee_late_fees_post(%L) ->> 'posted')$q$, tests.tid('a'))), '2', 'G16 posted');
select pg_temp.today('2026-10-17');
select is(pg_temp.val('a_owner', format($q$select (public.fee_late_fees_preview(%L) ->> 'total_paise')$q$, tests.tid('a'))), '10000', 'G17 on 17 Oct a day more: Rs 50 for each tuition 2 (Rs 100), the fixed fee is once only');
select is(pg_temp.val('a_owner', format($q$select (public.fee_late_fees_post(%L) ->> 'posted')$q$, tests.tid('a'))), '2', 'G18 posted');
select is(pg_temp.val('a_owner', format($q$select (public.fee_late_fees_post(%L) ->> 'posted')$q$, tests.tid('a'))), '0', 'G19 and again: nothing');
select is((select sum(amount_paise) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s1') and e.reason_code = 'late_fee'), 10000::numeric, 'G20 Asha''s tuition 2 carries two days of late fee in all (Rs 100)');
select pg_temp.today('2026-10-14');

-- ============================================================================ H. voiding an assignment
select is(pg_temp.assign('a_owner', 'as3', 's3', 'pl5'), 'ok', 'H1 Chitra is given the plan');
select is(pg_temp.stmt('s3', 'outstanding_paise'), '3500000', 'H2 and owes Rs 35,000');
select is(pg_temp.try('a_sales', format($q$select public.fee_assignment_void(%L, %L)$q$, tests.tid('a'), tests.rid('as3'))), '42501', 'H3 DENY: Sales cannot void an assignment');
select is(pg_temp.try('a_owner', format($q$select public.fee_assignment_void(%L, %L)$q$, tests.tid('a'), tests.rid('as3'))), 'ok', 'H4 ALLOW: the Owner voids it (a mistake)');
select is(pg_temp.stmt('s3', 'outstanding_paise'), '0', 'H5 her charges are voided: she owes nothing');
select is(pg_temp.try('a_owner', format($q$select public.fee_assignment_void(%L, %L)$q$, tests.tid('a'), tests.rid('as3'))), 'SM782', 'H6 once');
select is(pg_temp.assign('a_owner', 'as3b', 's3', 'pl5'), 'ok', 'H7 after a void a plan can be assigned again (a new assignment)');
select is(pg_temp.stmt('s3', 'outstanding_paise'), '3500000', 'H8 and her charges are new ones');
select is(pg_temp.assign('a_owner', 'as3', 's3', 'pl5'), 'ok', 'H9 repeating the voided assignment replays it as it is (voided), and charges nothing');
select is(pg_temp.stmt('s3', 'outstanding_paise'), '3500000', 'H10 (still Rs 35,000)');
select is((select count(*) from public.fee_assignments where student_id = tests.rid('s3') and voided_at is null), 1::bigint, 'H11 one live assignment');

-- ============================================================================ I. the pending list
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.fee_pending_list(%L))::text$q$, tests.tid('a'))), '4', 'I1 four students have money fallen due and unpaid (Asha, Bala, Chitra, Dev)');
select is(pg_temp.val('a_sales', format($q$select (public.fee_pending_list(%L) -> 0 ->> 'pending_paise')$q$, tests.tid('a'))), '2500000', 'I2 the largest first: Chitra, Rs 25,000 (tuition 1 and 2, transport and books have fallen due and nothing is paid)');
select is(pg_temp.val('a_sales', format($q$select (public.fee_pending_list(%L, date '2026-06-30') -> 0 ->> 'display_name')$q$, tests.tid('a'))), 'Chitra', 'I3 as of 30 June only the June instalments had fallen due (Rs 12,000 for Chitra, the most)');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.fee_pending_list(%L, null, %L))::text$q$, tests.tid('a'), tests.rid('p6'))), '1', 'I4 filtered by programme');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.fee_pending_list(%L, null, null, %L))::text$q$, tests.tid('a'), tests.rid('g5b'))), '1', 'I5 filtered by section');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.fee_pending_list(%L, null, null, null, 2))::text$q$, tests.tid('a'))), '2', 'I6 a page of two');
select is(pg_temp.val('a_sales', format($q$select public.fee_pending_list(%L, date '2030-01-01')::text$q$, tests.tid('a'))), 'ERR:22023', 'I7 not for a future day');
select is(pg_temp.val('a_viewer', format($q$select public.fee_pending_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'I8 DENY: a Viewer');
select is(pg_temp.val('a_sales', format($q$select (public.fee_pending_list(%L) -> 0 ->> 'overdue_days')$q$, tests.tid('a'))), '126', 'I9 the oldest unpaid instalment is 126 days past due (10 June to 14 Oct)');

-- ============================================================================ J. a fee reminder for a guardian with two children
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) values
  (tests.rid('tpl'), tests.tid('a'), 'fee_reminder', 'en', 'utility', 'reminder', 'Hello, a reminder from the school: {{1}} Thank you.', 'approved');
create function pg_temp.camp(p_id text, p_kind text default 'fee_due', p_text text default 'Dear {{name}}, school fees of {{amount}} fall due on {{due_date}}.') returns text language sql as $$
  select pg_temp.try('a_owner', format($q$select public.campaign_save(%L, %L, 'Fee reminder', %L, 'en', %L, %L, '[{"offset_days": -3, "time": "10:00"}, {"offset_days": 0, "time": "10:00"}]'::jsonb, null, 24)$q$,
                                        tests.rid(p_id), tests.tid('a'), p_kind, tests.rid('tpl'), p_text))
$$;
select is(pg_temp.camp('cf1'), 'ok', 'J1 (setup) a fee-due campaign');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_ledger(%L, %L, '{"due_from": "2026-10-01", "due_to": "2026-10-31", "party": "student"}'::jsonb) ->> 'added')$q$, tests.tid('a'), tests.rid('cf1'))), '3', 'J2 the list from the ledger for claims due in October: the guardian of Asha and Bala (ONE person), Chitra''s guardian, and Dev''s (whose late fee fell due on the 14th)');
select is((select count(*) from public.campaign_recipients where campaign_id = tests.rid('cf1') and contact_id = tests.rid('g1')), 1::bigint, 'J3 one message for the guardian of two children');
select is((select ledger_scope from public.campaign_recipients where campaign_id = tests.rid('cf1') and contact_id = tests.rid('g1')), 'guardian', 'J4 marked as a guardian''s total');
select is((select amount_paise from public.campaign_recipients where campaign_id = tests.rid('cf1') and contact_id = tests.rid('g1')), 1900000::bigint, 'J6 the total of October''s open claims for the two children: tuition 2 of Asha (Rs 7,500) and of Bala (Rs 10,000) and Bala''s three late fees (Rs 1,500) = Rs 19,000');
select is((select due_date::text from public.campaign_recipients where campaign_id = tests.rid('cf1') and contact_id = tests.rid('g1')), '2026-10-10', 'J7 the earliest date');
select is((select reference from public.campaign_recipients where campaign_id = tests.rid('cf1') and contact_id = tests.rid('g1')), null, 'J8 no single reference when there are several claims');
select is(app.recipient_outstanding(tests.tid('a'), null, tests.rid('g1'), 'guardian', date '2026-10-14'), 5150000::bigint, 'J9 "what is still owed" for the guardian is both children''s balances together');
select is((select campaign_lead_for is not null from (select app.campaign_lead_for(tests.tid('a'), tests.rid('g1'))) x), true, 'J10 a guardian has a lead (job CR) so the reminder can be sent');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_ledger(%L, %L, '{"due_from": "2026-10-01", "due_to": "2026-10-31", "party": "student"}'::jsonb) ->> 'added')$q$, tests.tid('a'), tests.rid('cf1'))), '0', 'J11 building it again adds no one twice');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_ledger(%L, %L, '{"due_from": "2026-10-01", "due_to": "2026-10-31", "party": "company"}'::jsonb) ->> 'added')$q$, tests.tid('a'), tests.rid('cf1'))), '0', 'J12 a list of companies finds none in a school');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_ledger(%L, %L, '{"due_from": "2026-10-01", "due_to": "2026-10-31", "party": "pupil"}'::jsonb) ->> 'added')$q$, tests.tid('a'), tests.rid('cf1'))), 'ERR:22023', 'J13 a party outside the list is invalid');
select is((select count(*) from public.campaign_recipients r join public.contacts c on c.id = r.contact_id where r.campaign_id = tests.rid('cf1') and c.full_name ~ 'Asha|Bala|Chitra|Dev'), 0::bigint, 'J14 no child''s name is anywhere on the list');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_preview(%L, %L) -> 'samples' -> 0 ->> 'body') !~ '(Asha|Bala|Chitra|Dev|Esha)'$q$, tests.tid('a'), tests.rid('cf1'))), 'true', 'J15 and no child''s name is in any message the Owner approves');

-- ============================================================================ K. admitted with a plan, in one transaction
insert into public.contacts (id, tenant_id, full_name, phone) values (tests.rid('g9'), tests.tid('a'), 'Newcomer Parent', '+00 90030 00009');
select is(pg_temp.try('a_sales', format($q$select public.admission_create(%L, %L, %L, %L, 'walk_in')$q$, tests.rid('adm9'), tests.tid('a'), tests.rid('g9'), tests.rid('p5'))), 'ok', 'K1 (setup) an enquiry for Class 5');
select is(pg_temp.try('a_owner', format($q$select public.admission_admit(%L, %L, %L, false, 'Farah', %L, %L, 'C5-009', %L, %L, date '2026-10-14')$q$, tests.tid('a'), tests.rid('adm9'), tests.rid('s9'), tests.rid('p6'), null, tests.rid('pl5'), tests.rid('as9'))), '22023', 'K2 a plan for another programme than the student''s is refused...');
select is((select count(*) from public.students where id = tests.rid('s9')) || '/' || (select stage from public.admissions where id = tests.rid('adm9')), '0/enquiry', 'K3 ... and the WHOLE admission is undone: no student, still an enquiry');
select is(pg_temp.try('a_owner', format($q$select public.admission_admit(%L, %L, %L, false, 'Farah', %L, %L, 'C5-009', %L, %L, date '2026-10-14')$q$, tests.tid('a'), tests.rid('adm9'), tests.rid('s9'), tests.rid('p5'), tests.rid('g5a'), tests.rid('pl5'), tests.rid('as9'))), 'ok', 'K4 ALLOW: admitted into Class 5 section A with the plan');
select is((select stage from public.admissions where id = tests.rid('adm9')), 'admitted', 'K5 the enquiry is admitted');
select is(pg_temp.stmt('s9', 'invoiced_paise'), '3500000', 'K6 and the child is charged the plan''s Rs 35,000 on their own account');
select is((select min(e.entry_date)::text from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s9')), '2026-06-10', 'K7 each charge is dated no later than its due date');
select is(pg_temp.try('a_owner', format($q$select public.admission_admit(%L, %L, %L, false, 'Farah', %L, %L, 'C5-009', %L, %L, date '2026-10-14')$q$, tests.tid('a'), tests.rid('adm9'), tests.rid('s9'), tests.rid('p5'), tests.rid('g5a'), tests.rid('pl5'), tests.rid('as9'))), 'ok', 'K8 an exact repeat replays');
select is((select count(*) from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.student_id = tests.rid('s9')), 5::bigint, 'K9 (five charges, none doubled)');

-- ============================================================================ L. guards
select is(pg_temp.sc(format($q$update public.fee_assignments set plan_id = %L where id = %L$q$, tests.rid('pl6'), tests.rid('as1'))), '42501', 'L1 an assignment changes only by being voided');
select is(pg_temp.sc($q$delete from public.fee_assignments$q$), '42501', 'L2 nor is deleted');
select is(pg_temp.sc(format($q$update public.fee_plans set name = 'Edited' where id = %L$q$, tests.rid('pl6'))), '42501', 'L3 a plan changes only through its function');
select is(pg_temp.sc($q$delete from public.fee_plans$q$), '42501', 'L4 nor is deleted');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type in ('fee_plan', 'fee_assignment') and (new_values::text ~ '(Asha|Bala|Chitra|Farah)')), 0::bigint, 'L5 the audit trail names no child');
select * from finish();
rollback;
