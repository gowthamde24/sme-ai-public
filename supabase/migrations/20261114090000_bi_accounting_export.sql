-- Job BI (ADR 0073), part 1 of 4: THE ACCOUNTING EXPORT. One read function that hands the API the sales and the payments of a date range for Tally / Vyapar / CSV / XLSX files, and writes the audit
-- event of the export in the same transaction, so there is no way to take the data without a record of it.
--
--   public.export_accounting_data(tenant, export id, format, from, to)   Owner or Admin, second factor (aal2). The window is in INDIA dates (Asia/Kolkata), at most 366 days, at most 2,000 sales
--                                                                      and 5,000 payment events. Returns jsonb {from, to, orders: [...], payments: [...]}.
--
-- What is a SALE: an order the customer has accepted and that has not been lost since (state accepted, advance_requested, advance_paid, in_preparation, dispatched, delivered, closed_paid). Its date is
-- the day (India) of its `customer_accept` event. A cancelled, declined or expired order is not a sale. What is a PAYMENT: a `record_payment` (money in) or `record_refund` (money out) event, dated
-- by occurred_at (India day), for ANY order of the business, whatever its state now.
-- The figures are the quote's, in paise; the lines are the quote's; the party is the company of the lead (a business name; no contact person, no phone or e-mail leaves here). Every query is scoped by
-- tenant_id; the function is SECURITY DEFINER only so that it can write the audit event and read the tables in one place, and it checks the caller first.
--
-- SQLSTATEs: 42501 deny (not an Owner/Admin, or no JWT), 22023 invalid input, SM306 second factor needed (app.require_aal2), SM601 the window holds too much (narrow it).

create schema if not exists integrations;
revoke all on schema integrations from public, anon, authenticated, service_role;

create function app.integration_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'too_large' then raise exception 'too much data in this window' using errcode = 'SM601';
    when 'state'     then raise exception 'not in a state that allows this' using errcode = 'SM602';
    when 'mismatch'  then raise exception 'not the same file or mapping as the preview' using errcode = 'SM603';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.integration_error(text) from public;

create function public.export_accounting_data(p_tenant_id uuid, p_export_id uuid, p_format text, p_from date, p_to date) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_ts timestamptz;
  v_to_ts   timestamptz;
  v_orders  jsonb;
  v_pay     jsonb;
  v_n_ord   integer;
  v_n_pay   integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  perform app.require_aal2();
  if p_export_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365
     or p_format is null or p_format not in ('tally_masters_xml', 'tally_vouchers_xml', 'tally_zip', 'vyapar_xlsx', 'csv', 'xlsx') then
    perform app.integration_error('invalid');
  end if;
  v_from_ts := (p_from::timestamp) at time zone 'Asia/Kolkata';
  v_to_ts   := ((p_to + 1)::timestamp) at time zone 'Asia/Kolkata';

  select count(*) into v_n_ord from public.orders o
   where o.tenant_id = p_tenant_id
     and o.state in ('accepted', 'advance_requested', 'advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid')
     and exists (select 1 from public.order_events e where e.tenant_id = o.tenant_id and e.order_id = o.id and e.type = 'customer_accept' and e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts);
  select count(*) into v_n_pay from public.order_events e
   where e.tenant_id = p_tenant_id and e.type in ('record_payment', 'record_refund') and e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts;
  if v_n_ord > 2000 or v_n_pay > 5000 then
    perform app.integration_error('too_large');
  end if;

  select coalesce(jsonb_agg(x.j order by x.accepted_at, x.order_no), '[]'::jsonb) into v_orders from (
    select a.accepted_at, o.order_no,
           jsonb_build_object(
             'order_id', o.id, 'order_no', o.order_no, 'state', o.state, 'accepted_at', a.accepted_at,
             'accepted_on', (a.accepted_at at time zone 'Asia/Kolkata')::date,
             'party', case when co.erased_at is not null then 'Erased customer' else coalesce(co.name, 'Walk-in customer') end,
             'city', case when co.erased_at is not null then null else co.city end,
             'quote_no', q.quote_no, 'delivery_state', q.delivery_state, 'gst_supply', q.gst_supply,
             'merchandise_net_paise', q.merchandise_net_paise, 'item_tax_paise', q.item_tax_paise,
             'shipping_net_paise', q.shipping_net_paise, 'shipping_tax_paise', q.shipping_tax_paise,
             'total_paise', o.order_total_paise, 'advance_paise', o.advance_paise,
             'lines', coalesce((select jsonb_agg(jsonb_build_object(
                          'line_no', l.line_no, 'sku', l.sku, 'name', l.name, 'sale_unit', l.sale_unit, 'qty', l.qty,
                          'unit_price_paise', l.unit_price_applied_paise, 'net_paise', l.net_paise, 'tax_paise', l.tax_paise, 'tax_bps', l.tax_bps) order by l.line_no)
                         from public.quote_lines l where l.tenant_id = o.tenant_id and l.quote_id = o.quote_id), '[]'::jsonb)) as j
      from public.orders o
      join public.quotes q on q.tenant_id = o.tenant_id and q.id = o.quote_id
      join lateral (select min(e.occurred_at) as accepted_at from public.order_events e
                     where e.tenant_id = o.tenant_id and e.order_id = o.id and e.type = 'customer_accept') a on a.accepted_at is not null
      left join public.leads ld on ld.tenant_id = o.tenant_id and ld.id = o.lead_id
      left join public.companies co on co.tenant_id = ld.tenant_id and co.id = ld.company_id
     where o.tenant_id = p_tenant_id
       and o.state in ('accepted', 'advance_requested', 'advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid')
       and a.accepted_at >= v_from_ts and a.accepted_at < v_to_ts
  ) x;

  select coalesce(jsonb_agg(y.j order by y.occurred_at, y.order_no, y.seq), '[]'::jsonb) into v_pay from (
    select e.occurred_at, o.order_no, e.seq,
           jsonb_build_object(
             'payment_id', e.ledger_id, 'event_id', e.id, 'order_id', o.id, 'order_no', o.order_no,
             'kind', case e.type when 'record_payment' then 'payment' else 'refund' end,
             'amount_paise', e.amount_paise, 'occurred_at', e.occurred_at, 'occurred_on', (e.occurred_at at time zone 'Asia/Kolkata')::date,
             'party', case when co.erased_at is not null then 'Erased customer' else coalesce(co.name, 'Walk-in customer') end) as j
      from public.order_events e
      join public.orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
      left join public.leads ld on ld.tenant_id = o.tenant_id and ld.id = o.lead_id
      left join public.companies co on co.tenant_id = ld.tenant_id and co.id = ld.company_id
     where e.tenant_id = p_tenant_id and e.type in ('record_payment', 'record_refund') and e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts
  ) y;

  -- the record of this export, in the same transaction as the read: who (the JWT subject, by the writer), when, which window and format, how many rows. No customer data in it.
  perform app.write_audit_event(
    p_tenant_id, 'export.create', 'data_export', p_export_id, null,
    jsonb_build_object('kind', 'accounting', 'format', p_format, 'from', p_from, 'to', p_to, 'orders', v_n_ord, 'payments', v_n_pay));

  return jsonb_build_object('from', p_from, 'to', p_to, 'orders', v_orders, 'payments', v_pay);
end;
$$;
revoke all on function public.export_accounting_data(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.export_accounting_data(uuid, uuid, text, date, date) to authenticated;
comment on function public.export_accounting_data(uuid, uuid, text, date, date) is 'Job BI: the sales and payments of an India-date window for the accounting files; Owner/Admin with a second factor; writes the export audit event in the same transaction.';
