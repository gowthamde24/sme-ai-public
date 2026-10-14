-- Job CN (wave 2, C1, ADR 0085), migration 4 of 7: DUES (receivables) GROUNDWORK for the `dues` module. Invoices stay in the owner's accounting system (Tally, Vyapar): here they are ENTERED or IMPORTED per
-- customer, payments are RECORDED, and the database says what each customer owes, how old it is and whether a new order would pass the customer's credit limit. The full shared ledger (reminders, campaigns,
-- fee ledger for education) is job CP; this design is kept reusable: a ledger is "claims in, receipts in, FIFO allocation out", with no reference to what was sold.
--
--   public.customer_invoices      one row per invoice the owner entered or imported: the owner's invoice number, date, due date, the amount in paise, an optional link to an order. Never changed; a mistake is VOIDED.
--   public.customer_payments      one row per payment received: date, amount, method, an optional invoice. Never changed; a mistake is VOIDED. An advance (a payment before the invoice) is allowed: the balance
--                                 of a customer who has paid more than was invoiced is shown as a credit, and counts as nothing owed.
--   public.customer_credit_limits one limit per customer (the Owner's, with a second factor, as every money rule here).
--   app.dues_open_items           the ONE place the allocation rule lives: payments are applied to the OLDEST invoice first (by invoice date, then id); what is left of each invoice is its open amount.
--   public.dues_statement         one customer: invoiced, paid, balance, credit, the open amount by age since the invoice date (0-30, 31-60, 61-90, 90+ days) and how much is past its due date.
--   public.dues_summary           every customer with something open, largest first.
--   public.credit_check           before a new order: the limit, what is owed now, what it would be with the new amount, and whether that passes (a WARNING: the owner decides).
--
-- Who: Owner, Admin and Sales read and record (money is not shown to a Viewer); Owner and Admin void; the Owner, with a second factor, sets a credit limit. Nobody writes a table directly: every write is a
-- SECURITY DEFINER function that proves the role first. The module `dues` must be on (SM701). A model never reads these tables.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, 23505 id reused for another record, SM701 module off, SM781 the invoice number is already used for this business, SM782 already voided.

create function app.dues_error(p_kind text) returns void
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
revoke all on function app.dues_error(text) from public;

create table public.customer_invoices (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  company_id   uuid not null,
  invoice_no   text not null check (invoice_no ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$'),
  invoice_date date not null check (invoice_date between date '2020-01-01' and date '2100-12-31'),
  due_date     date not null check (due_date between date '2020-01-01' and date '2100-12-31'),
  amount_paise bigint not null check (amount_paise between 1 and 100000000000),
  order_id     uuid,
  source       text not null check (source in ('manual', 'import')),
  recorded_by  uuid not null,
  recorded_at  timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  check (due_date >= invoice_date),
  check ((voided_at is null) = (voided_by is null))
);
create unique index customer_invoices_number_key on public.customer_invoices (tenant_id, lower(invoice_no)) where voided_at is null;
create index customer_invoices_company_idx on public.customer_invoices (tenant_id, company_id, invoice_date, id);
create index customer_invoices_order_idx on public.customer_invoices (tenant_id, order_id) where order_id is not null;
comment on column public.customer_invoices.invoice_no is 'SAFE: the owner''s own invoice number (letters, digits, / . _ - and spaces). CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.customer_invoices.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.customer_payments (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  company_id   uuid not null,
  received_on  date not null check (received_on between date '2020-01-01' and date '2100-12-31'),
  amount_paise bigint not null check (amount_paise between 1 and 100000000000),
  method       text not null check (method in ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')),
  invoice_id   uuid,
  recorded_by  uuid not null,
  recorded_at  timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.customer_invoices (tenant_id, id),
  check ((voided_at is null) = (voided_by is null))
);
create index customer_payments_company_idx on public.customer_payments (tenant_id, company_id, received_on, id);
create index customer_payments_invoice_idx on public.customer_payments (tenant_id, invoice_id) where invoice_id is not null;
comment on column public.customer_payments.method is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.customer_credit_limits (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  company_id   uuid not null,
  limit_paise  bigint not null check (limit_paise between 0 and 100000000000),
  set_by       uuid not null,
  set_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, company_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id)
);

-- invoices and payments never change except to be voided (once); nothing is deleted
create function app.dues_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'dues rows are never deleted: void them' using errcode = '42501';
  end if;
  if old.voided_at is not null or (to_jsonb(new) - 'voided_at' - 'voided_by') is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by') then
    raise exception 'an invoice or a payment changes only by being voided, once' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.dues_rows_guard() from public;
create trigger customer_invoices_guard before update or delete on public.customer_invoices for each row execute function app.dues_rows_guard();
create trigger customer_payments_guard before update or delete on public.customer_payments for each row execute function app.dues_rows_guard();
create trigger customer_invoices_no_truncate before truncate on public.customer_invoices for each statement execute function app.dues_rows_guard();
create trigger customer_payments_no_truncate before truncate on public.customer_payments for each statement execute function app.dues_rows_guard();
create trigger customer_credit_limits_forbid_tenant_id_change before update on public.customer_credit_limits for each row execute function app.forbid_tenant_id_change();
create trigger customer_invoices_forbid_tenant_id_change before update on public.customer_invoices for each row execute function app.forbid_tenant_id_change();
create trigger customer_payments_forbid_tenant_id_change before update on public.customer_payments for each row execute function app.forbid_tenant_id_change();
create trigger module_guard before insert on public.customer_invoices for each row execute function app.module_guard('dues');
create trigger module_guard before insert on public.customer_payments for each row execute function app.module_guard('dues');
create trigger module_guard before insert on public.customer_credit_limits for each row execute function app.module_guard('dues');
create trigger audit_customer_invoices after insert or update or delete on public.customer_invoices for each row execute function app.audit_row_change('customer_invoice', '');
create trigger audit_customer_payments after insert or update or delete on public.customer_payments for each row execute function app.audit_row_change('customer_payment', '');
create trigger audit_customer_credit_limits after insert or update or delete on public.customer_credit_limits for each row execute function app.audit_row_change('customer_credit_limit', '');

do $$
declare t text;
begin
  foreach t in array array['customer_invoices', 'customer_payments', 'customer_credit_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the allocation rule and the statement
-- ---------------------------------------------------------------------------------------------------------------------------------
-- What is left of each live invoice on `p_as_of`: the payments received up to that day (live ones) are applied to the OLDEST invoice first (invoice date, then id). Invoices dated after p_as_of are not yet owed.
create function app.dues_open_items(p_tenant uuid, p_company uuid, p_as_of date)
returns table (invoice_id uuid, invoice_no text, invoice_date date, due_date date, amount_paise bigint, open_paise bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with paid as (
    select coalesce(sum(p.amount_paise), 0)::bigint as total from public.customer_payments p
     where p.tenant_id = p_tenant and p.company_id = p_company and p.voided_at is null and p.received_on <= p_as_of),
  inv as (
    select i.id, i.invoice_no, i.invoice_date, i.due_date, i.amount_paise,
           sum(i.amount_paise) over (order by i.invoice_date, i.id rows between unbounded preceding and current row)::bigint as running
      from public.customer_invoices i
     where i.tenant_id = p_tenant and i.company_id = p_company and i.voided_at is null and i.invoice_date <= p_as_of)
  select inv.id, inv.invoice_no, inv.invoice_date, inv.due_date, inv.amount_paise,
         least(inv.amount_paise, greatest(0::bigint, inv.running - paid.total))::bigint
    from inv cross join paid
   order by inv.invoice_date, inv.id
$$;
revoke all on function app.dues_open_items(uuid, uuid, date) from public;

-- what a customer owes on `p_as_of` (never negative): the number the quote engine and the credit check read
create function app.dues_outstanding(p_tenant uuid, p_company uuid, p_as_of date) returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(sum(open_paise), 0)::bigint from app.dues_open_items(p_tenant, p_company, p_as_of) $$;
revoke all on function app.dues_outstanding(uuid, uuid, date) from public;

create function app.dues_statement_json(p_tenant uuid, p_company uuid, p_as_of date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invoiced bigint;
  v_paid     bigint;
  v_limit    bigint;
  v_out      bigint;
  v_b        jsonb;
  v_overdue  bigint;
  v_open     jsonb;
begin
  select coalesce(sum(i.amount_paise), 0) into v_invoiced from public.customer_invoices i
   where i.tenant_id = p_tenant and i.company_id = p_company and i.voided_at is null and i.invoice_date <= p_as_of;
  select coalesce(sum(p.amount_paise), 0) into v_paid from public.customer_payments p
   where p.tenant_id = p_tenant and p.company_id = p_company and p.voided_at is null and p.received_on <= p_as_of;
  select l.limit_paise into v_limit from public.customer_credit_limits l where l.tenant_id = p_tenant and l.company_id = p_company;
  select coalesce(sum(o.open_paise), 0),
         jsonb_build_object(
           'd0_30',    coalesce(sum(o.open_paise) filter (where p_as_of - o.invoice_date <= 30), 0),
           'd31_60',   coalesce(sum(o.open_paise) filter (where p_as_of - o.invoice_date between 31 and 60), 0),
           'd61_90',   coalesce(sum(o.open_paise) filter (where p_as_of - o.invoice_date between 61 and 90), 0),
           'd90_plus', coalesce(sum(o.open_paise) filter (where p_as_of - o.invoice_date > 90), 0)),
         coalesce(sum(o.open_paise) filter (where o.due_date < p_as_of), 0),
         coalesce(jsonb_agg(jsonb_build_object('invoice_id', o.invoice_id, 'invoice_no', o.invoice_no, 'invoice_date', o.invoice_date, 'due_date', o.due_date,
                                               'amount_paise', o.amount_paise, 'open_paise', o.open_paise, 'age_days', p_as_of - o.invoice_date,
                                               'overdue_days', greatest(0, p_as_of - o.due_date)) order by o.invoice_date, o.invoice_id) filter (where o.open_paise > 0), '[]'::jsonb)
    into v_out, v_b, v_overdue, v_open
    from app.dues_open_items(p_tenant, p_company, p_as_of) o;
  return jsonb_build_object(
    'company_id', p_company, 'as_of', p_as_of, 'invoiced_paise', v_invoiced, 'paid_paise', v_paid, 'outstanding_paise', v_out,
    'credit_paise', greatest(0::bigint, v_paid - v_invoiced), 'overdue_paise', v_overdue, 'ageing', v_b, 'open_invoices', v_open,
    'credit_limit_paise', v_limit, 'over_limit', v_limit is not null and v_out > v_limit);
end;
$$;
revoke all on function app.dues_statement_json(uuid, uuid, date) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- writes
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.dues_today() returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
revoke all on function app.dues_today() from public;

-- Enter one invoice. The caller's id makes a retry safe (the same id with the same figures replays; other figures conflict). The invoice number is unique among live invoices (case-insensitive).
create function public.invoice_record(
  p_invoice_id uuid, p_tenant_id uuid, p_company_id uuid, p_invoice_no text, p_invoice_date date, p_due_date date, p_amount_paise bigint, p_order_id uuid default null, p_source text default 'manual'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_no  text := btrim(coalesce(p_invoice_no, ''));
  v_old public.customer_invoices;
begin
  if v_uid is null or p_tenant_id is null or p_invoice_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_company_id is null or p_invoice_date is null or p_due_date is null or p_amount_paise is null or p_source is null or p_source not in ('manual', 'import') then
    perform app.dues_error('invalid');
  end if;
  select * into v_old from public.customer_invoices x where x.id = p_invoice_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.company_id <> p_company_id or v_old.invoice_no <> v_no or v_old.invoice_date <> p_invoice_date or v_old.due_date <> p_due_date
       or v_old.amount_paise <> p_amount_paise or v_old.order_id is distinct from p_order_id then
      perform app.dues_error('conflict');
    end if;
    return jsonb_build_object('invoice_id', v_old.id, 'replayed', true);
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.tenant_id = p_tenant_id and c.erased_at is null) then
    perform app.dues_error('reference');
  end if;
  if p_order_id is not null and not exists (select 1 from public.orders o where o.id = p_order_id and o.tenant_id = p_tenant_id) then
    perform app.dues_error('reference');
  end if;
  begin
    insert into public.customer_invoices (id, tenant_id, company_id, invoice_no, invoice_date, due_date, amount_paise, order_id, source, recorded_by)
    values (p_invoice_id, p_tenant_id, p_company_id, v_no, p_invoice_date, p_due_date, p_amount_paise, p_order_id, p_source, v_uid);
  exception
    when check_violation then perform app.dues_error('invalid');
    when unique_violation then perform app.dues_error('number');
  end;
  return jsonb_build_object('invoice_id', p_invoice_id, 'replayed', false);
end;
$$;
revoke all on function public.invoice_record(uuid, uuid, uuid, text, date, date, bigint, uuid, text) from public, anon;
grant execute on function public.invoice_record(uuid, uuid, uuid, text, date, date, bigint, uuid, text) to authenticated;

-- Import up to 500 invoices at once (an export from the owner's accounting system, read by the API). Each row is [company_id, invoice_no, invoice_date, due_date, amount_paise] as an object; a row whose invoice number is
-- already used (or whose customer is not this business's) is SKIPPED and reported, never an error for the rest. The ids are derived from the batch id, so a retry of the same file adds nothing.
create function public.invoices_import(p_tenant_id uuid, p_batch_id uuid, p_rows jsonb) returns jsonb
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
  v_no      text;
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
    v_no := btrim(coalesce(v_row ->> 'invoice_no', ''));
    if exists (select 1 from public.customer_invoices x where x.id = v_id) then
      continue;  -- a retry of the same file: this row was added before
    end if;
    begin
      insert into public.customer_invoices (id, tenant_id, company_id, invoice_no, invoice_date, due_date, amount_paise, source, recorded_by)
      select v_id, p_tenant_id, c.id, v_no, (v_row ->> 'invoice_date')::date, (v_row ->> 'due_date')::date, (v_row ->> 'amount_paise')::bigint, 'import', v_uid
        from public.companies c where c.id = (v_row ->> 'company_id')::uuid and c.tenant_id = p_tenant_id and c.erased_at is null;
      if found then
        v_added := v_added + 1;
      else
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'customer_not_found');
      end if;
    exception
      when unique_violation then v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'invoice_number_used');
      when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'invalid_row');
    end;
  end loop;
  return jsonb_build_object('batch_id', p_batch_id, 'added', v_added, 'skipped', v_skipped);
end;
$$;
revoke all on function public.invoices_import(uuid, uuid, jsonb) from public, anon;
grant execute on function public.invoices_import(uuid, uuid, jsonb) to authenticated;

create function public.invoice_void(p_tenant_id uuid, p_invoice_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  x     public.customer_invoices;
begin
  if v_uid is null or p_tenant_id is null or p_invoice_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  select * into x from public.customer_invoices i where i.id = p_invoice_id and i.tenant_id = p_tenant_id for update;
  if not found then
    perform app.dues_error('reference');
  end if;
  if x.voided_at is not null then
    perform app.dues_error('voided');
  end if;
  update public.customer_invoices set voided_at = now(), voided_by = v_uid where id = x.id;
  return jsonb_build_object('invoice_id', x.id, 'voided', true);
end;
$$;
revoke all on function public.invoice_void(uuid, uuid) from public, anon;
grant execute on function public.invoice_void(uuid, uuid) to authenticated;

create function public.payment_record(
  p_payment_id uuid, p_tenant_id uuid, p_company_id uuid, p_received_on date, p_amount_paise bigint, p_method text, p_invoice_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.customer_payments;
begin
  if v_uid is null or p_tenant_id is null or p_payment_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_company_id is null or p_received_on is null or p_amount_paise is null or p_method is null then
    perform app.dues_error('invalid');
  end if;
  select * into v_old from public.customer_payments x where x.id = p_payment_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.company_id <> p_company_id or v_old.received_on <> p_received_on or v_old.amount_paise <> p_amount_paise
       or v_old.method <> p_method or v_old.invoice_id is distinct from p_invoice_id then
      perform app.dues_error('conflict');
    end if;
    return jsonb_build_object('payment_id', v_old.id, 'replayed', true);
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.tenant_id = p_tenant_id and c.erased_at is null) then
    perform app.dues_error('reference');
  end if;
  if p_invoice_id is not null and not exists (select 1 from public.customer_invoices i where i.id = p_invoice_id and i.tenant_id = p_tenant_id and i.company_id = p_company_id) then
    perform app.dues_error('reference');
  end if;
  if p_received_on > app.dues_today() + 1 then
    perform app.dues_error('invalid');  -- a payment is never dated in the future
  end if;
  begin
    insert into public.customer_payments (id, tenant_id, company_id, received_on, amount_paise, method, invoice_id, recorded_by)
    values (p_payment_id, p_tenant_id, p_company_id, p_received_on, p_amount_paise, p_method, p_invoice_id, v_uid);
  exception when check_violation then
    perform app.dues_error('invalid');
  end;
  return jsonb_build_object('payment_id', p_payment_id, 'replayed', false);
end;
$$;
revoke all on function public.payment_record(uuid, uuid, uuid, date, bigint, text, uuid) from public, anon;
grant execute on function public.payment_record(uuid, uuid, uuid, date, bigint, text, uuid) to authenticated;

create function public.payment_void(p_tenant_id uuid, p_payment_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  x     public.customer_payments;
begin
  if v_uid is null or p_tenant_id is null or p_payment_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  select * into x from public.customer_payments p where p.id = p_payment_id and p.tenant_id = p_tenant_id for update;
  if not found then
    perform app.dues_error('reference');
  end if;
  if x.voided_at is not null then
    perform app.dues_error('voided');
  end if;
  update public.customer_payments set voided_at = now(), voided_by = v_uid where id = x.id;
  return jsonb_build_object('payment_id', x.id, 'voided', true);
end;
$$;
revoke all on function public.payment_void(uuid, uuid) from public, anon;
grant execute on function public.payment_void(uuid, uuid) to authenticated;

-- The Owner sets (or changes) a customer's credit limit, with a second factor; null removes it.
create function public.credit_limit_set(p_tenant_id uuid, p_company_id uuid, p_limit_paise bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_company_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  perform app.require_aal2();
  if p_limit_paise is not null and p_limit_paise not between 0 and 100000000000 then
    perform app.dues_error('invalid');
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.tenant_id = p_tenant_id and c.erased_at is null) then
    perform app.dues_error('reference');
  end if;
  if p_limit_paise is null then
    delete from public.customer_credit_limits l where l.tenant_id = p_tenant_id and l.company_id = p_company_id;  -- the audit trail keeps what it was
    return jsonb_build_object('company_id', p_company_id, 'limit_paise', null);
  end if;
  insert into public.customer_credit_limits (tenant_id, company_id, limit_paise, set_by) values (p_tenant_id, p_company_id, p_limit_paise, v_uid)
  on conflict (tenant_id, company_id) do update set limit_paise = excluded.limit_paise, set_by = excluded.set_by, set_at = now();
  return jsonb_build_object('company_id', p_company_id, 'limit_paise', p_limit_paise);
end;
$$;
revoke all on function public.credit_limit_set(uuid, uuid, bigint) from public, anon;
grant execute on function public.credit_limit_set(uuid, uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- reads (Owner, Admin, Sales)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.dues_statement(p_tenant_id uuid, p_company_id uuid, p_as_of date default null) returns jsonb
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
revoke all on function public.dues_statement(uuid, uuid, date) from public, anon;
grant execute on function public.dues_statement(uuid, uuid, date) to authenticated;

-- Every customer with something open, the largest first; paged by (outstanding, company id).
create function public.dues_summary(p_tenant_id uuid, p_as_of date default null, p_limit integer default 50, p_after_paise bigint default null, p_after_id uuid default null) returns jsonb
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
    from (select c.id as company_id, c.name as company_name, o.out, app.dues_statement_json(p_tenant_id, c.id, v_day) as j
            from (select x.id, x.name from public.companies x
                   where x.tenant_id = p_tenant_id
                     and exists (select 1 from public.customer_invoices i where i.tenant_id = x.tenant_id and i.company_id = x.id and i.voided_at is null)) c
            cross join lateral (select app.dues_outstanding(p_tenant_id, c.id, v_day) as out) o
           where o.out > 0 and (p_after_paise is null or (o.out, c.id) < (p_after_paise, p_after_id))
           order by o.out desc, c.id desc
           limit p_limit) z;
  return v_out;
end;
$$;
revoke all on function public.dues_summary(uuid, date, integer, bigint, uuid) from public, anon;
grant execute on function public.dues_summary(uuid, date, integer, bigint, uuid) to authenticated;

-- Before a new order: would this amount take the customer over the limit? A WARNING, never a block.
create function public.credit_check(p_tenant_id uuid, p_company_id uuid, p_new_amount_paise bigint) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit bigint;
  v_out   bigint;
begin
  if auth.uid() is null or p_tenant_id is null or p_company_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_new_amount_paise is null or p_new_amount_paise not between 0 and 100000000000
     or not exists (select 1 from public.companies c where c.id = p_company_id and c.tenant_id = p_tenant_id) then
    perform app.dues_error('invalid');
  end if;
  select l.limit_paise into v_limit from public.customer_credit_limits l where l.tenant_id = p_tenant_id and l.company_id = p_company_id;
  v_out := app.dues_outstanding(p_tenant_id, p_company_id, app.dues_today());
  return jsonb_build_object('company_id', p_company_id, 'credit_limit_paise', v_limit, 'outstanding_paise', v_out, 'new_amount_paise', p_new_amount_paise,
                            'would_be_paise', v_out + p_new_amount_paise, 'has_limit', v_limit is not null, 'exceeded', v_limit is not null and v_out + p_new_amount_paise > v_limit);
end;
$$;
revoke all on function public.credit_check(uuid, uuid, bigint) from public, anon;
grant execute on function public.credit_check(uuid, uuid, bigint) to authenticated;

-- the list reads (invoices and payments of one customer, newest first)
create function public.dues_ledger(p_tenant_id uuid, p_company_id uuid, p_limit integer default 100) returns jsonb
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
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.dues_error('invalid');
  end if;
  return jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'invoice_date', i.invoice_date, 'due_date', i.due_date, 'amount_paise', i.amount_paise,
                                                                'order_id', i.order_id, 'source', i.source, 'voided', i.voided_at is not null) order by i.invoice_date desc, i.id desc)
                            from (select * from public.customer_invoices x where x.tenant_id = p_tenant_id and x.company_id = p_company_id order by x.invoice_date desc, x.id desc limit p_limit) i), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'received_on', p.received_on, 'amount_paise', p.amount_paise, 'method', p.method, 'invoice_id', p.invoice_id,
                                                                'voided', p.voided_at is not null) order by p.received_on desc, p.id desc)
                            from (select * from public.customer_payments x where x.tenant_id = p_tenant_id and x.company_id = p_company_id order by x.received_on desc, x.id desc limit p_limit) p), '[]'::jsonb));
end;
$$;
revoke all on function public.dues_ledger(uuid, uuid, integer) from public, anon;
grant execute on function public.dues_ledger(uuid, uuid, integer) to authenticated;
