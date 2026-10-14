-- Job CP (wave 3, C1, ADR 0086), migration 1 of 3: ONE SHARED RECEIVABLES LEDGER. Job CN built the dues groundwork for construction customers (invoices, payments, FIFO allocation). This migration generalises it so
-- the same engine serves construction dues now and education fees in job CR. The rule of the whole product is unchanged: AMOUNTS COME ONLY FROM ENTRIES AND IMPORTS A PERSON MADE, never from a model.
--
--   public.ledger_accounts    one account per party: a COMPANY (a construction customer) or a CONTACT (a guardian or an adult student, job CR). A party has at most one account.
--   public.ledger_entries     the entries, never changed and never deleted (a mistake is VOIDED):
--                               charge       a claim (an invoice, a fee instalment): amount, entry date, DUE DATE, the owner's invoice number (unique among live charges) or a reference (a fee head)
--                               payment      money received: date, method, and a RECEIPT NUMBER (R/2026-27/000001: one series per business per financial year, never reused, a voided receipt keeps its number)
--                               adjustment   a debit (a late fee, a correction up: it has a due date) or a credit (a correction down), with a reason code; Owner/Admin with a second factor
--                               concession   a credit with a reason code (scholarship, sibling, hardship ...); Owner/Admin with a second factor
--   app.ledger_open_items     the ONE place the allocation rule lives: credits (payments, concessions, credit adjustments) are applied to the OLDEST claim first (entry date, then due date, then id)
--   app.ledger_statement_json balance, credit, ageing by age (0-30, 31-60, 61-90, 90+ days since the entry) and by days past due, what is overdue, the open claims
--
-- The CN functions keep their names, their arguments and their answers (invoice_record, payment_record, invoices_import, invoice_void, payment_void, dues_statement, dues_summary, dues_ledger, credit_check);
-- they now read and write this ledger. CN's two tables are copied here (same ids) and dropped. Every write is a SECURITY DEFINER function that proves the role first; module `dues` must be on (SM701).
-- No client writes a table. A model never reads these tables. Amounts have a cap (Rs 100 crore per entry).
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, 23505 id reused for another record, SM701 module off, SM781 the invoice number is already used, SM782 already voided.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.ledger_accounts (
  id          uuid primary key,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  company_id  uuid,
  contact_id  uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  check (num_nonnulls(company_id, contact_id) = 1)
);
create unique index ledger_accounts_company_key on public.ledger_accounts (tenant_id, company_id) where company_id is not null;
create unique index ledger_accounts_contact_key on public.ledger_accounts (tenant_id, contact_id) where contact_id is not null;

create table public.ledger_entries (
  id               uuid primary key,
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  account_id       uuid not null,
  kind             text not null check (kind in ('charge', 'payment', 'adjustment', 'concession')),
  direction        text not null check (direction in ('debit', 'credit')),
  amount_paise     bigint not null check (amount_paise between 1 and 100000000000),
  entry_date       date not null check (entry_date between date '2020-01-01' and date '2100-12-31'),
  due_date         date check (due_date between date '2020-01-01' and date '2100-12-31'),
  invoice_no       text check (invoice_no ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$'),
  reference        text check (reference ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$'),
  method           text check (method in ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')),
  reason_code      text check (reason_code in ('correction', 'late_fee', 'waiver', 'rounding', 'scholarship', 'sibling', 'staff_ward', 'hardship', 'merit', 'other')),
  receipt_fy       text check (receipt_fy ~ '^[0-9]{4}-[0-9]{2}$'),
  receipt_seq      integer check (receipt_seq between 1 and 999999),
  receipt_no       text check (receipt_no ~ '^R/[0-9]{4}-[0-9]{2}/[0-9]{6}$'),
  against_entry_id uuid,
  order_id         uuid,
  source           text not null check (source in ('manual', 'import')),
  recorded_by      uuid not null,
  recorded_at      timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references public.ledger_accounts (tenant_id, id),
  foreign key (tenant_id, against_entry_id) references public.ledger_entries (tenant_id, id),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  -- the four kinds and their directions
  check ((kind = 'charge' and direction = 'debit') or (kind in ('payment', 'concession') and direction = 'credit') or kind = 'adjustment'),
  -- a claim has a due date on or after its entry date; a credit has none
  check ((direction = 'debit') = (due_date is not null)),
  check (due_date is null or due_date >= entry_date),
  check (invoice_no is null or kind = 'charge'),
  check (reference is null or kind in ('charge', 'adjustment', 'concession')),
  check ((kind = 'payment') = (method is not null)),
  check ((kind in ('adjustment', 'concession')) = (reason_code is not null)),
  check ((kind = 'payment') = (receipt_no is not null)),
  check ((receipt_no is null) = (receipt_seq is null) and (receipt_no is null) = (receipt_fy is null)),
  check ((voided_at is null) = (voided_by is null))
);
create unique index ledger_entries_invoice_no_key on public.ledger_entries (tenant_id, lower(invoice_no)) where invoice_no is not null and voided_at is null;
create unique index ledger_entries_receipt_key on public.ledger_entries (tenant_id, receipt_fy, receipt_seq) where receipt_seq is not null;
create index ledger_entries_account_idx on public.ledger_entries (tenant_id, account_id, entry_date, id);
create index ledger_entries_against_idx on public.ledger_entries (tenant_id, against_entry_id) where against_entry_id is not null;
create index ledger_entries_order_idx on public.ledger_entries (tenant_id, order_id) where order_id is not null;
comment on column public.ledger_entries.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ledger_entries.direction is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ledger_entries.invoice_no is 'SAFE: the owner''s own invoice number (letters, digits, / . _ - and spaces). CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.ledger_entries.reference is 'SAFE: a short label such as a fee head (letters, digits, / . _ - and spaces; never a name or a number to call). CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.ledger_entries.method is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ledger_entries.reason_code is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ledger_entries.receipt_fy is 'SAFE: a financial year such as 2026-27. CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.ledger_entries.receipt_no is 'SAFE: the receipt number R/2026-27/000001. CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.ledger_entries.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- copy job CN's invoices and payments (same ids), then drop its two tables
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into public.ledger_accounts (id, tenant_id, company_id)
select gen_random_uuid(), x.tenant_id, x.company_id
  from (select tenant_id, company_id from public.customer_invoices union select tenant_id, company_id from public.customer_payments) x;

insert into public.ledger_entries (id, tenant_id, account_id, kind, direction, amount_paise, entry_date, due_date, invoice_no, order_id, source, recorded_by, recorded_at, voided_at, voided_by)
select i.id, i.tenant_id, a.id, 'charge', 'debit', i.amount_paise, i.invoice_date, i.due_date, i.invoice_no, i.order_id, i.source, i.recorded_by, i.recorded_at, i.voided_at, i.voided_by
  from public.customer_invoices i join public.ledger_accounts a on a.tenant_id = i.tenant_id and a.company_id = i.company_id;

insert into public.ledger_entries (id, tenant_id, account_id, kind, direction, amount_paise, entry_date, method, receipt_fy, receipt_seq, receipt_no, against_entry_id, source, recorded_by, recorded_at, voided_at, voided_by)
select p.id, p.tenant_id, a.id, 'payment', 'credit', p.amount_paise, p.received_on, p.method, p.fy, p.n, 'R/' || p.fy || '/' || lpad(p.n::text, 6, '0'), p.invoice_id, 'manual', p.recorded_by, p.recorded_at, p.voided_at, p.voided_by
  from (select x.*,
               case when extract(month from x.recorded_at at time zone 'Asia/Kolkata') >= 4
                    then extract(year from x.recorded_at at time zone 'Asia/Kolkata')::int || '-' || lpad(((extract(year from x.recorded_at at time zone 'Asia/Kolkata')::int + 1) % 100)::text, 2, '0')
                    else (extract(year from x.recorded_at at time zone 'Asia/Kolkata')::int - 1) || '-' || lpad((extract(year from x.recorded_at at time zone 'Asia/Kolkata')::int % 100)::text, 2, '0') end as fy,
               row_number() over (partition by x.tenant_id,
                    case when extract(month from x.recorded_at at time zone 'Asia/Kolkata') >= 4
                         then extract(year from x.recorded_at at time zone 'Asia/Kolkata')::int else extract(year from x.recorded_at at time zone 'Asia/Kolkata')::int - 1 end
                    order by x.recorded_at, x.id)::integer as n
          from public.customer_payments x) p
  join public.ledger_accounts a on a.tenant_id = p.tenant_id and a.company_id = p.company_id;

drop table public.customer_payments;
drop table public.customer_invoices;
drop function app.dues_rows_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- guards, audit, row-level security
-- ---------------------------------------------------------------------------------------------------------------------------------
-- an entry never changes except to be voided (once); nothing is deleted
create function app.ledger_entries_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'ledger entries are never deleted: void them' using errcode = '42501';
  end if;
  if old.voided_at is not null or (to_jsonb(new) - 'voided_at' - 'voided_by') is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by') then
    raise exception 'a ledger entry changes only by being voided, once' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.ledger_entries_guard() from public;
create trigger ledger_entries_guard before update or delete on public.ledger_entries for each row execute function app.ledger_entries_guard();
create trigger ledger_entries_no_truncate before truncate on public.ledger_entries for each statement execute function app.ledger_entries_guard();
create function app.ledger_accounts_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a ledger account is never changed or deleted' using errcode = '42501';
end;
$$;
revoke all on function app.ledger_accounts_guard() from public;
create trigger ledger_accounts_guard before update or delete on public.ledger_accounts for each row execute function app.ledger_accounts_guard();
create trigger ledger_accounts_no_truncate before truncate on public.ledger_accounts for each statement execute function app.ledger_accounts_guard();
create trigger ledger_accounts_forbid_tenant_id_change before update on public.ledger_accounts for each row execute function app.forbid_tenant_id_change();
create trigger ledger_entries_forbid_tenant_id_change before update on public.ledger_entries for each row execute function app.forbid_tenant_id_change();
create trigger module_guard before insert on public.ledger_accounts for each row execute function app.module_guard('dues');
create trigger module_guard before insert on public.ledger_entries for each row execute function app.module_guard('dues');
create trigger audit_ledger_accounts after insert or update or delete on public.ledger_accounts for each row execute function app.audit_row_change('ledger_account', '');
create trigger audit_ledger_entries after insert or update or delete on public.ledger_entries for each row execute function app.audit_row_change('ledger_entry', '');

do $$
declare t text;
begin
  foreach t in array array['ledger_accounts', 'ledger_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the allocation rule, the statement, the clock, the receipt numbers
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.dues_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'id already used for another record' using errcode = '23505';
    when 'number'    then raise exception 'that invoice number is already used' using errcode = 'SM781';
    when 'voided'    then raise exception 'already voided' using errcode = 'SM782';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;

-- the financial year (April to March) of a day: 2026-27
create function app.ledger_fy(p_day date) returns text
language sql
immutable
set search_path = ''
as $$
  select case when extract(month from p_day) >= 4
              then extract(year from p_day)::int || '-' || lpad(((extract(year from p_day)::int + 1) % 100)::text, 2, '0')
              else (extract(year from p_day)::int - 1) || '-' || lpad((extract(year from p_day)::int % 100)::text, 2, '0') end
$$;
revoke all on function app.ledger_fy(date) from public;

-- the account of a party (null when it has none yet)
create function app.ledger_account_of(p_tenant uuid, p_company uuid, p_contact uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.ledger_accounts a
   where a.tenant_id = p_tenant and ((p_company is not null and a.company_id = p_company) or (p_contact is not null and a.contact_id = p_contact))
$$;
revoke all on function app.ledger_account_of(uuid, uuid, uuid) from public;

-- What is left of each live claim on `p_as_of`: the credits received up to that day (live ones) are applied to the OLDEST claim first (entry date, due date, id). Claims dated after p_as_of are not yet owed.
create function app.ledger_open_items(p_tenant uuid, p_account uuid, p_as_of date)
returns table (entry_id uuid, kind text, invoice_no text, reference text, entry_date date, due_date date, amount_paise bigint, open_paise bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with paid as (
    select coalesce(sum(e.amount_paise), 0)::bigint as total from public.ledger_entries e
     where e.tenant_id = p_tenant and e.account_id = p_account and e.direction = 'credit' and e.voided_at is null and e.entry_date <= p_as_of),
  claims as (
    select e.id, e.kind, e.invoice_no, e.reference, e.entry_date, e.due_date, e.amount_paise,
           sum(e.amount_paise) over (order by e.entry_date, e.due_date, e.id rows between unbounded preceding and current row)::bigint as running
      from public.ledger_entries e
     where e.tenant_id = p_tenant and e.account_id = p_account and e.direction = 'debit' and e.voided_at is null and e.entry_date <= p_as_of)
  select c.id, c.kind, c.invoice_no, c.reference, c.entry_date, c.due_date, c.amount_paise,
         least(c.amount_paise, greatest(0::bigint, c.running - paid.total))::bigint
    from claims c cross join paid
   order by c.entry_date, c.due_date, c.id
$$;
revoke all on function app.ledger_open_items(uuid, uuid, date) from public;

create function app.ledger_outstanding(p_tenant uuid, p_account uuid, p_as_of date) returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(sum(open_paise), 0)::bigint from app.ledger_open_items(p_tenant, p_account, p_as_of) $$;
revoke all on function app.ledger_outstanding(uuid, uuid, date) from public;

-- job CN's names, now reading the ledger (the quote engine and the credit check call them)
create or replace function app.dues_open_items(p_tenant uuid, p_company uuid, p_as_of date)
returns table (invoice_id uuid, invoice_no text, invoice_date date, due_date date, amount_paise bigint, open_paise bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.entry_id, o.invoice_no, o.entry_date, o.due_date, o.amount_paise, o.open_paise
    from app.ledger_open_items(p_tenant, app.ledger_account_of(p_tenant, p_company, null), p_as_of) o
$$;
create or replace function app.dues_outstanding(p_tenant uuid, p_company uuid, p_as_of date) returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select app.ledger_outstanding(p_tenant, app.ledger_account_of(p_tenant, p_company, null), p_as_of) $$;

create function app.ledger_statement_json(p_tenant uuid, p_account uuid, p_as_of date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a         public.ledger_accounts;
  v_debits  bigint;
  v_credits bigint;
  v_pay     bigint;
  v_conc    bigint;
  v_adj     bigint;
  v_limit   bigint;
  v_out     bigint;
  v_b       jsonb;
  v_o       jsonb;
  v_overdue bigint;
  v_open    jsonb;
begin
  select * into a from public.ledger_accounts x where x.tenant_id = p_tenant and x.id = p_account;
  select coalesce(sum(e.amount_paise) filter (where e.direction = 'debit'), 0),
         coalesce(sum(e.amount_paise) filter (where e.direction = 'credit'), 0),
         coalesce(sum(e.amount_paise) filter (where e.kind = 'payment'), 0),
         coalesce(sum(e.amount_paise) filter (where e.kind = 'concession'), 0),
         coalesce(sum(case when e.kind = 'adjustment' and e.direction = 'debit' then e.amount_paise when e.kind = 'adjustment' then -e.amount_paise else 0 end), 0)
    into v_debits, v_credits, v_pay, v_conc, v_adj
    from public.ledger_entries e where e.tenant_id = p_tenant and e.account_id = p_account and e.voided_at is null and e.entry_date <= p_as_of;
  if a.company_id is not null then
    select l.limit_paise into v_limit from public.customer_credit_limits l where l.tenant_id = p_tenant and l.company_id = a.company_id;
  end if;
  select coalesce(sum(o.open_paise), 0),
         jsonb_build_object(
           'd0_30',    coalesce(sum(o.open_paise) filter (where p_as_of - o.entry_date <= 30), 0),
           'd31_60',   coalesce(sum(o.open_paise) filter (where p_as_of - o.entry_date between 31 and 60), 0),
           'd61_90',   coalesce(sum(o.open_paise) filter (where p_as_of - o.entry_date between 61 and 90), 0),
           'd90_plus', coalesce(sum(o.open_paise) filter (where p_as_of - o.entry_date > 90), 0)),
         jsonb_build_object(
           'not_due',  coalesce(sum(o.open_paise) filter (where o.due_date >= p_as_of), 0),
           'd1_30',    coalesce(sum(o.open_paise) filter (where p_as_of - o.due_date between 1 and 30), 0),
           'd31_60',   coalesce(sum(o.open_paise) filter (where p_as_of - o.due_date between 31 and 60), 0),
           'd61_90',   coalesce(sum(o.open_paise) filter (where p_as_of - o.due_date between 61 and 90), 0),
           'd90_plus', coalesce(sum(o.open_paise) filter (where p_as_of - o.due_date > 90), 0)),
         coalesce(sum(o.open_paise) filter (where o.due_date < p_as_of), 0),
         coalesce(jsonb_agg(jsonb_build_object('invoice_id', o.entry_id, 'entry_id', o.entry_id, 'kind', o.kind, 'invoice_no', o.invoice_no, 'reference', o.reference,
                                               'invoice_date', o.entry_date, 'due_date', o.due_date, 'amount_paise', o.amount_paise, 'open_paise', o.open_paise,
                                               'age_days', p_as_of - o.entry_date, 'overdue_days', greatest(0, p_as_of - o.due_date)) order by o.entry_date, o.due_date, o.entry_id) filter (where o.open_paise > 0), '[]'::jsonb)
    into v_out, v_b, v_o, v_overdue, v_open
    from app.ledger_open_items(p_tenant, p_account, p_as_of) o;
  return jsonb_build_object(
    'account_id', p_account, 'company_id', a.company_id, 'contact_id', a.contact_id, 'as_of', p_as_of,
    'invoiced_paise', v_debits, 'paid_paise', v_credits, 'payments_paise', v_pay, 'concessions_paise', v_conc, 'adjustments_paise', v_adj,
    'outstanding_paise', v_out, 'credit_paise', greatest(0::bigint, v_credits - v_debits), 'overdue_paise', v_overdue,
    'ageing', v_b, 'overdue_ageing', v_o, 'open_invoices', v_open, 'credit_limit_paise', v_limit, 'over_limit', v_limit is not null and v_out > v_limit);
end;
$$;
revoke all on function app.ledger_statement_json(uuid, uuid, date) from public;

-- the statement of a party with no entries yet: all zeros
create function app.ledger_empty_statement_json(p_company uuid, p_contact uuid, p_as_of date) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'account_id', null, 'company_id', p_company, 'contact_id', p_contact, 'as_of', p_as_of,
    'invoiced_paise', 0, 'paid_paise', 0, 'payments_paise', 0, 'concessions_paise', 0, 'adjustments_paise', 0,
    'outstanding_paise', 0, 'credit_paise', 0, 'overdue_paise', 0,
    'ageing', jsonb_build_object('d0_30', 0, 'd31_60', 0, 'd61_90', 0, 'd90_plus', 0),
    'overdue_ageing', jsonb_build_object('not_due', 0, 'd1_30', 0, 'd31_60', 0, 'd61_90', 0, 'd90_plus', 0),
    'open_invoices', '[]'::jsonb, 'credit_limit_paise', null, 'over_limit', false)
$$;
revoke all on function app.ledger_empty_statement_json(uuid, uuid, date) from public;

create or replace function app.dues_statement_json(p_tenant uuid, p_company uuid, p_as_of date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc  uuid := app.ledger_account_of(p_tenant, p_company, null);
  v_lim  bigint;
  v_json jsonb;
begin
  if v_acc is null then
    select l.limit_paise into v_lim from public.customer_credit_limits l where l.tenant_id = p_tenant and l.company_id = p_company;
    v_json := app.ledger_empty_statement_json(p_company, null, p_as_of);
    return v_json || jsonb_build_object('credit_limit_paise', v_lim);
  end if;
  return app.ledger_statement_json(p_tenant, v_acc, p_as_of);
end;
$$;

create or replace function app.dues_today() returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the one writer: every entry goes through here (the public functions below prove the role first)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.ledger_record_core(
  p_actor uuid, p_entry_id uuid, p_tenant uuid, p_kind text, p_direction text, p_company uuid, p_contact uuid, p_entry_date date, p_due_date date, p_amount bigint,
  p_invoice_no text, p_reference text, p_method text, p_reason text, p_against uuid, p_order uuid, p_source text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_no      text := nullif(btrim(coalesce(p_invoice_no, '')), '');
  v_ref     text := nullif(btrim(coalesce(p_reference, '')), '');
  v_old     public.ledger_entries;
  v_acc     uuid;
  v_target  public.ledger_entries;
  v_fy      text;
  v_seq     integer;
  v_rno     text;
  v_cons    text;
  v_today   date := app.dues_today();
begin
  if p_entry_id is null or p_kind is null or p_direction is null or p_entry_date is null or p_amount is null or p_source is null
     or num_nonnulls(p_company, p_contact) <> 1 or p_source not in ('manual', 'import') then
    perform app.dues_error('invalid');
  end if;
  if not ((p_kind = 'charge' and p_direction = 'debit') or (p_kind in ('payment', 'concession') and p_direction = 'credit') or (p_kind = 'adjustment' and p_direction in ('debit', 'credit'))) then
    perform app.dues_error('invalid');
  end if;
  if (p_direction = 'debit') <> (p_due_date is not null) or (p_due_date is not null and p_due_date < p_entry_date) then
    perform app.dues_error('invalid');
  end if;
  if (v_no is not null and p_kind <> 'charge') or (v_ref is not null and p_kind = 'payment') or ((p_kind = 'payment') <> (p_method is not null)) or ((p_kind in ('adjustment', 'concession')) <> (p_reason is not null)) then
    perform app.dues_error('invalid');
  end if;
  if p_kind <> 'charge' and p_entry_date > v_today + 1 then
    perform app.dues_error('invalid');  -- money received, a concession or an adjustment is never dated in the future
  end if;

  -- a retry: the same figures under the same id replay; other figures conflict
  select * into v_old from public.ledger_entries x where x.id = p_entry_id;
  if found then
    select a.id into v_acc from public.ledger_accounts a where a.id = v_old.account_id and a.tenant_id = p_tenant
       and a.company_id is not distinct from p_company and a.contact_id is not distinct from p_contact;
    if v_old.tenant_id <> p_tenant or v_acc is null or v_old.kind <> p_kind or v_old.direction <> p_direction or v_old.entry_date <> p_entry_date or v_old.due_date is distinct from p_due_date
       or v_old.amount_paise <> p_amount or v_old.invoice_no is distinct from v_no or v_old.reference is distinct from v_ref or v_old.method is distinct from p_method
       or v_old.reason_code is distinct from p_reason or v_old.against_entry_id is distinct from p_against or v_old.order_id is distinct from p_order then
      perform app.dues_error('conflict');
    end if;
    return jsonb_build_object('entry_id', v_old.id, 'account_id', v_old.account_id, 'receipt_no', v_old.receipt_no, 'replayed', true);
  end if;

  if p_company is not null and not exists (select 1 from public.companies c where c.id = p_company and c.tenant_id = p_tenant and c.erased_at is null) then
    perform app.dues_error('reference');
  end if;
  if p_contact is not null and not exists (select 1 from public.contacts c where c.id = p_contact and c.tenant_id = p_tenant and c.erased_at is null) then
    perform app.dues_error('reference');
  end if;
  if p_order is not null and not exists (select 1 from public.orders o where o.id = p_order and o.tenant_id = p_tenant) then
    perform app.dues_error('reference');
  end if;

  -- the account of this party (made on the first entry)
  v_acc := app.ledger_account_of(p_tenant, p_company, p_contact);
  if v_acc is null then
    begin
      insert into public.ledger_accounts (id, tenant_id, company_id, contact_id) values (gen_random_uuid(), p_tenant, p_company, p_contact) returning id into v_acc;
    exception when unique_violation then
      v_acc := app.ledger_account_of(p_tenant, p_company, p_contact);
    end;
  end if;
  if p_against is not null then
    select * into v_target from public.ledger_entries x where x.id = p_against and x.tenant_id = p_tenant and x.account_id = v_acc;
    if not found or (p_direction = 'credit' and v_target.direction <> 'debit') then
      perform app.dues_error('reference');
    end if;
  end if;

  if p_kind = 'payment' then
    -- the receipt number: one series per business per financial year, numbered in the order the receipts are made (a voided receipt keeps its number; a number is never reused)
    v_fy := app.ledger_fy(v_today);
    perform pg_advisory_xact_lock(hashtextextended('ledger-receipt:' || p_tenant::text || ':' || v_fy, 0));
    select coalesce(max(e.receipt_seq), 0) + 1 into v_seq from public.ledger_entries e where e.tenant_id = p_tenant and e.receipt_fy = v_fy;
    if v_seq > 999999 then
      perform app.dues_error('invalid');
    end if;
    v_rno := 'R/' || v_fy || '/' || lpad(v_seq::text, 6, '0');
  end if;

  begin
    insert into public.ledger_entries (id, tenant_id, account_id, kind, direction, amount_paise, entry_date, due_date, invoice_no, reference, method, reason_code, receipt_fy, receipt_seq, receipt_no,
                                       against_entry_id, order_id, source, recorded_by)
    values (p_entry_id, p_tenant, v_acc, p_kind, p_direction, p_amount, p_entry_date, p_due_date, v_no, v_ref, p_method, p_reason, case when v_rno is not null then v_fy end, v_seq, v_rno,
            p_against, p_order, p_source, p_actor);
  exception
    when check_violation then perform app.dues_error('invalid');
    when unique_violation then
      get stacked diagnostics v_cons = constraint_name;
      if v_cons = 'ledger_entries_invoice_no_key' then
        perform app.dues_error('number');
      end if;
      perform app.dues_error('conflict');
  end;
  return jsonb_build_object('entry_id', p_entry_id, 'account_id', v_acc, 'receipt_no', v_rno, 'replayed', false);
end;
$$;
revoke all on function app.ledger_record_core(uuid, uuid, uuid, text, text, uuid, uuid, date, date, bigint, text, text, text, text, uuid, uuid, text) from public, anon, authenticated, service_role;

create function app.ledger_void_core(p_actor uuid, p_tenant uuid, p_entry uuid, p_kinds text[]) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  x public.ledger_entries;
begin
  select * into x from public.ledger_entries e where e.id = p_entry and e.tenant_id = p_tenant for update;
  if not found or not (x.kind = any (p_kinds)) then
    perform app.dues_error('reference');
  end if;
  if x.voided_at is not null then
    perform app.dues_error('voided');
  end if;
  update public.ledger_entries set voided_at = now(), voided_by = p_actor where id = x.id;
  return jsonb_build_object('entry_id', x.id, 'kind', x.kind, 'voided', true);
end;
$$;
revoke all on function app.ledger_void_core(uuid, uuid, uuid, text[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- job CN's writers, same names and arguments, now on the ledger
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.invoice_record(
  p_invoice_id uuid, p_tenant_id uuid, p_company_id uuid, p_invoice_no text, p_invoice_date date, p_due_date date, p_amount_paise bigint, p_order_id uuid default null, p_source text default 'manual'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_invoice_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_company_id is null or p_invoice_date is null or p_due_date is null or p_amount_paise is null or p_source is null or p_source not in ('manual', 'import') or p_invoice_no is null then
    perform app.dues_error('invalid');
  end if;
  r := app.ledger_record_core(v_uid, p_invoice_id, p_tenant_id, 'charge', 'debit', p_company_id, null, p_invoice_date, p_due_date, p_amount_paise, p_invoice_no, null, null, null, null, p_order_id, p_source);
  return jsonb_build_object('invoice_id', r -> 'entry_id', 'replayed', r -> 'replayed');
end;
$$;

create or replace function public.invoices_import(p_tenant_id uuid, p_batch_id uuid, p_rows jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_row     jsonb;
  v_i       integer := 0;
  v_added   integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_id      uuid;
begin
  if v_uid is null or p_tenant_id is null or p_batch_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    perform app.dues_error('invalid');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_id := app.agent_derived_id(p_batch_id, 'invoice-' || v_i::text, 'invoice');
    if exists (select 1 from public.ledger_entries x where x.id = v_id) then
      continue;  -- a retry of the same file: this row was added before
    end if;
    begin
      if not exists (select 1 from public.companies c where c.id = (v_row ->> 'company_id')::uuid and c.tenant_id = p_tenant_id and c.erased_at is null) then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'customer_not_found');
        continue;
      end if;
      perform app.ledger_record_core(v_uid, v_id, p_tenant_id, 'charge', 'debit', (v_row ->> 'company_id')::uuid, null, (v_row ->> 'invoice_date')::date, (v_row ->> 'due_date')::date,
                                     (v_row ->> 'amount_paise')::bigint, v_row ->> 'invoice_no', null, null, null, null, null, 'import');
      v_added := v_added + 1;
    exception
      when sqlstate 'SM781' then v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'invoice_number_used');
      when sqlstate '22023' or sqlstate '23503' or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or null_value_not_allowed then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'invalid_row');
    end;
  end loop;
  return jsonb_build_object('batch_id', p_batch_id, 'added', v_added, 'skipped', v_skipped);
end;
$$;

create or replace function public.invoice_void(p_tenant_id uuid, p_invoice_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_invoice_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  r := app.ledger_void_core(v_uid, p_tenant_id, p_invoice_id, array['charge']);
  return jsonb_build_object('invoice_id', r -> 'entry_id', 'voided', true);
end;
$$;

create or replace function public.payment_record(
  p_payment_id uuid, p_tenant_id uuid, p_company_id uuid, p_received_on date, p_amount_paise bigint, p_method text, p_invoice_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_payment_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_company_id is null or p_received_on is null or p_amount_paise is null or p_method is null then
    perform app.dues_error('invalid');
  end if;
  r := app.ledger_record_core(v_uid, p_payment_id, p_tenant_id, 'payment', 'credit', p_company_id, null, p_received_on, null, p_amount_paise, null, null, p_method, null, p_invoice_id, null, 'manual');
  return jsonb_build_object('payment_id', r -> 'entry_id', 'receipt_no', r -> 'receipt_no', 'replayed', r -> 'replayed');
end;
$$;

create or replace function public.payment_void(p_tenant_id uuid, p_payment_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_payment_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  r := app.ledger_void_core(v_uid, p_tenant_id, p_payment_id, array['payment']);
  return jsonb_build_object('payment_id', r -> 'entry_id', 'voided', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the shared writers: charge, payment, adjustment, concession for a company OR a contact
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Owner, Admin and Sales record a charge or a payment; an ADJUSTMENT or a CONCESSION changes what is owed without money coming in, so it is the Owner's or Admin's, with a second factor.
create function public.ledger_entry_record(
  p_entry_id uuid, p_tenant_id uuid, p_kind text, p_company_id uuid, p_contact_id uuid, p_entry_date date, p_amount_paise bigint,
  p_due_date date default null, p_direction text default null, p_invoice_no text default null, p_reference text default null, p_method text default null,
  p_reason_code text default null, p_against_entry_id uuid default null, p_order_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_dir text;
begin
  if v_uid is null or p_tenant_id is null or p_entry_id is null or p_kind is null then
    perform app.dues_error('deny');
  end if;
  if p_kind in ('adjustment', 'concession') then
    if not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
      perform app.dues_error('deny');
    end if;
  elsif not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_kind in ('adjustment', 'concession') then
    perform app.require_aal2();
  end if;
  v_dir := case p_kind when 'charge' then 'debit' when 'payment' then 'credit' when 'concession' then 'credit' else p_direction end;
  return app.ledger_record_core(v_uid, p_entry_id, p_tenant_id, p_kind, v_dir, p_company_id, p_contact_id, p_entry_date, p_due_date, p_amount_paise, p_invoice_no, p_reference, p_method,
                                p_reason_code, p_against_entry_id, p_order_id, 'manual');
end;
$$;
revoke all on function public.ledger_entry_record(uuid, uuid, text, uuid, uuid, date, bigint, date, text, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.ledger_entry_record(uuid, uuid, text, uuid, uuid, date, bigint, date, text, text, text, text, text, uuid, uuid) to authenticated;

create function public.ledger_entry_void(p_tenant_id uuid, p_entry_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null or p_tenant_id is null or p_entry_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  select e.kind into v_kind from public.ledger_entries e where e.id = p_entry_id and e.tenant_id = p_tenant_id;
  if v_kind in ('adjustment', 'concession') then
    perform app.require_aal2();
  end if;
  return app.ledger_void_core(v_uid, p_tenant_id, p_entry_id, array['charge', 'payment', 'adjustment', 'concession']);
end;
$$;
revoke all on function public.ledger_entry_void(uuid, uuid) from public, anon;
grant execute on function public.ledger_entry_void(uuid, uuid) to authenticated;

-- Up to 500 CLAIMS at once for companies or contacts (a fee list, an accounting export), each row {company_id | contact_id, entry_date, due_date, amount_paise, invoice_no?, reference?}. The ids are
-- derived from the batch id, so a retry of the same file adds nothing; a row that cannot be added is skipped and reported.
create function public.ledger_charges_import(p_tenant_id uuid, p_batch_id uuid, p_rows jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_row     jsonb;
  v_i       integer := 0;
  v_added   integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_id      uuid;
begin
  if v_uid is null or p_tenant_id is null or p_batch_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    perform app.dues_error('invalid');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_id := app.agent_derived_id(p_batch_id, 'charge-' || v_i::text, 'ledger_charge');
    if exists (select 1 from public.ledger_entries x where x.id = v_id) then
      continue;
    end if;
    begin
      perform app.ledger_record_core(v_uid, v_id, p_tenant_id, 'charge', 'debit', nullif(v_row ->> 'company_id', '')::uuid, nullif(v_row ->> 'contact_id', '')::uuid, (v_row ->> 'entry_date')::date,
                                     (v_row ->> 'due_date')::date, (v_row ->> 'amount_paise')::bigint, v_row ->> 'invoice_no', v_row ->> 'reference', null, null, null, null, 'import');
      v_added := v_added + 1;
    exception
      when sqlstate 'SM781' then v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'invoice_number_used');
      when sqlstate '23503' then v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'party_not_found');
      when sqlstate '22023' or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or null_value_not_allowed then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'invalid_row');
    end;
  end loop;
  return jsonb_build_object('batch_id', p_batch_id, 'added', v_added, 'skipped', v_skipped);
end;
$$;
revoke all on function public.ledger_charges_import(uuid, uuid, jsonb) from public, anon;
grant execute on function public.ledger_charges_import(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- reads (Owner, Admin, Sales; a Viewer sees no money)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.dues_statement(p_tenant_id uuid, p_company_id uuid, p_as_of date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_company_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.tenant_id = p_tenant_id) then
    perform app.dues_error('reference');
  end if;
  return app.dues_statement_json(p_tenant_id, p_company_id, coalesce(p_as_of, app.dues_today()));
end;
$$;

-- The statement of one party: a company or a contact.
create function public.ledger_statement(p_tenant_id uuid, p_company_id uuid default null, p_contact_id uuid default null, p_as_of date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_as_of, app.dues_today());
  v_acc uuid;
begin
  if auth.uid() is null or p_tenant_id is null or num_nonnulls(p_company_id, p_contact_id) <> 1 or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if (p_company_id is not null and not exists (select 1 from public.companies c where c.id = p_company_id and c.tenant_id = p_tenant_id))
     or (p_contact_id is not null and not exists (select 1 from public.contacts c where c.id = p_contact_id and c.tenant_id = p_tenant_id)) then
    perform app.dues_error('reference');
  end if;
  v_acc := app.ledger_account_of(p_tenant_id, p_company_id, p_contact_id);
  if v_acc is null then
    return app.ledger_empty_statement_json(p_company_id, p_contact_id, v_day);
  end if;
  return app.ledger_statement_json(p_tenant_id, v_acc, v_day);
end;
$$;
revoke all on function public.ledger_statement(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.ledger_statement(uuid, uuid, uuid, date) to authenticated;

-- Every company with something open, the largest first; paged by (outstanding, company id). (Job CN's list, unchanged in shape.)
create or replace function public.dues_summary(p_tenant_id uuid, p_as_of date default null, p_limit integer default 50, p_after_paise bigint default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_as_of, app.dues_today());
  v_out jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_limit is null or p_limit not between 1 and 100 or ((p_after_paise is null) <> (p_after_id is null)) then
    perform app.dues_error('invalid');
  end if;
  select coalesce(jsonb_agg(z.j || jsonb_build_object('company_name', z.company_name) order by z.out desc, z.company_id desc), '[]'::jsonb) into v_out
    from (select c.id as company_id, c.name as company_name, o.out, app.ledger_statement_json(p_tenant_id, c.acc, v_day) as j
            from (select x.id, x.name, a.id as acc from public.companies x join public.ledger_accounts a on a.tenant_id = x.tenant_id and a.company_id = x.id
                   where x.tenant_id = p_tenant_id) c
            cross join lateral (select app.ledger_outstanding(p_tenant_id, c.acc, v_day) as out) o
           where o.out > 0 and (p_after_paise is null or (o.out, c.id) < (p_after_paise, p_after_id))
           order by o.out desc, c.id desc
           limit p_limit) z;
  return v_out;
end;
$$;

-- Every party (company or contact) with something open, the largest first; paged by (outstanding, account id). `p_party` narrows to companies or contacts.
create function public.ledger_summary(p_tenant_id uuid, p_as_of date default null, p_limit integer default 50, p_after_paise bigint default null, p_after_id uuid default null, p_party text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_as_of, app.dues_today());
  v_out jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_limit is null or p_limit not between 1 and 100 or ((p_after_paise is null) <> (p_after_id is null)) or (p_party is not null and p_party not in ('company', 'contact')) then
    perform app.dues_error('invalid');
  end if;
  select coalesce(jsonb_agg(z.j || jsonb_build_object('party_kind', z.party_kind, 'party_name', z.party_name) order by z.out desc, z.acc desc), '[]'::jsonb) into v_out
    from (select a.id as acc, o.out, app.ledger_statement_json(p_tenant_id, a.id, v_day) as j,
                 case when a.company_id is not null then 'company' else 'contact' end as party_kind,
                 coalesce(co.name, ct.full_name) as party_name
            from public.ledger_accounts a
            left join public.companies co on co.tenant_id = a.tenant_id and co.id = a.company_id
            left join public.contacts ct on ct.tenant_id = a.tenant_id and ct.id = a.contact_id
            cross join lateral (select app.ledger_outstanding(p_tenant_id, a.id, v_day) as out) o
           where a.tenant_id = p_tenant_id and o.out > 0
             and (p_party is null or (p_party = 'company' and a.company_id is not null) or (p_party = 'contact' and a.contact_id is not null))
             and (p_after_paise is null or (o.out, a.id) < (p_after_paise, p_after_id))
           order by o.out desc, a.id desc
           limit p_limit) z;
  return v_out;
end;
$$;
revoke all on function public.ledger_summary(uuid, date, integer, bigint, uuid, text) from public, anon;
grant execute on function public.ledger_summary(uuid, date, integer, bigint, uuid, text) to authenticated;

-- The entries of one party, newest first (voided ones marked).
create function public.ledger_entries_list(p_tenant_id uuid, p_company_id uuid default null, p_contact_id uuid default null, p_limit integer default 100) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc uuid;
begin
  if auth.uid() is null or p_tenant_id is null or num_nonnulls(p_company_id, p_contact_id) <> 1 or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.dues_error('invalid');
  end if;
  v_acc := app.ledger_account_of(p_tenant_id, p_company_id, p_contact_id);
  return jsonb_build_object('account_id', v_acc, 'entries', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'direction', e.direction, 'amount_paise', e.amount_paise, 'entry_date', e.entry_date, 'due_date', e.due_date,
                                        'invoice_no', e.invoice_no, 'reference', e.reference, 'method', e.method, 'reason_code', e.reason_code, 'receipt_no', e.receipt_no,
                                        'against_entry_id', e.against_entry_id, 'order_id', e.order_id, 'source', e.source, 'voided', e.voided_at is not null) order by e.entry_date desc, e.id desc)
      from (select * from public.ledger_entries x where x.tenant_id = p_tenant_id and x.account_id = v_acc order by x.entry_date desc, x.id desc limit p_limit) e), '[]'::jsonb));
end;
$$;
revoke all on function public.ledger_entries_list(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.ledger_entries_list(uuid, uuid, uuid, integer) to authenticated;

-- A receipt, ready to print or to send: the number, the date, the amount, the method, who paid (the party's name), what it was set against, and the balance after it. No model is involved.
create function public.ledger_receipt_get(p_tenant_id uuid, p_entry_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e   public.ledger_entries;
  a   public.ledger_accounts;
  v_name text;
  v_biz  text;
  v_ref  text;
begin
  if auth.uid() is null or p_tenant_id is null or p_entry_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  select * into e from public.ledger_entries x where x.id = p_entry_id and x.tenant_id = p_tenant_id and x.kind = 'payment';
  if not found then
    perform app.dues_error('reference');
  end if;
  select * into a from public.ledger_accounts x where x.id = e.account_id and x.tenant_id = p_tenant_id;
  select coalesce(co.name, ct.full_name) into v_name from public.ledger_accounts x left join public.companies co on co.tenant_id = x.tenant_id and co.id = x.company_id
    left join public.contacts ct on ct.tenant_id = x.tenant_id and ct.id = x.contact_id where x.id = a.id;
  select t.name into v_biz from public.tenants t where t.id = p_tenant_id;
  select coalesce(t.invoice_no, t.reference) into v_ref from public.ledger_entries t where t.id = e.against_entry_id and t.tenant_id = p_tenant_id;
  return jsonb_build_object('receipt_no', e.receipt_no, 'received_on', e.entry_date, 'amount_paise', e.amount_paise, 'method', e.method, 'voided', e.voided_at is not null,
                            'business_name', v_biz, 'party_name', v_name, 'party_kind', case when a.company_id is not null then 'company' else 'contact' end,
                            'against', v_ref, 'balance_after_paise', app.ledger_outstanding(p_tenant_id, a.id, e.entry_date), 'recorded_at', e.recorded_at);
end;
$$;
revoke all on function public.ledger_receipt_get(uuid, uuid) from public, anon;
grant execute on function public.ledger_receipt_get(uuid, uuid) to authenticated;

-- job CN's list (invoices and payments of one company, newest first), now a view of the entries
create or replace function public.dues_ledger(p_tenant_id uuid, p_company_id uuid, p_limit integer default 100) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc uuid;
begin
  if auth.uid() is null or p_tenant_id is null or p_company_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.dues_error('invalid');
  end if;
  v_acc := app.ledger_account_of(p_tenant_id, p_company_id, null);
  return jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'invoice_date', i.entry_date, 'due_date', i.due_date, 'amount_paise', i.amount_paise,
                                                                'order_id', i.order_id, 'source', i.source, 'voided', i.voided_at is not null) order by i.entry_date desc, i.id desc)
                            from (select * from public.ledger_entries x where x.tenant_id = p_tenant_id and x.account_id = v_acc and x.kind = 'charge' order by x.entry_date desc, x.id desc limit p_limit) i), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'received_on', p.entry_date, 'amount_paise', p.amount_paise, 'method', p.method, 'invoice_id', p.against_entry_id,
                                                                'receipt_no', p.receipt_no, 'voided', p.voided_at is not null) order by p.entry_date desc, p.id desc)
                            from (select * from public.ledger_entries x where x.tenant_id = p_tenant_id and x.account_id = v_acc and x.kind = 'payment' order by x.entry_date desc, x.id desc limit p_limit) p), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the data inventory: nothing here names a person; an account points to a company or a contact, and erasing the party anonymises them while the money records stay (accounting records)
-- ---------------------------------------------------------------------------------------------------------------------------------
