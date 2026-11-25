-- RAZORPAY TOP-UP, database half (docs/contracts/credits-topup.md). The credits wallet (1 credit = Rs 1, a top-up never expires) is topped up through a Razorpay ORDER. What this migration adds on top of billing v2's orders:
--   * top-up amounts: whole rupees only (a credit is a rupee), between the settings' minimum and maximum (Rs 100 to Rs 1,00,000 today)
--   * a payment that fails or is dismissed is recorded on its order (status `failed`, a plain-word code); the customer may still pay the SAME order later and it settles then
--   * the paid amount reported by the provider must equal the order's total (base + 18 % GST), or nothing is credited (the order says `amount_mismatch`)
--   * one payment id settles one order, once: a unique index plus the row lock on the order make a replay, a webhook-and-browser race and a double delivery credit exactly once
--   * GST invoices per financial year (April to March, India time): `S19-2627-000001` (15 characters; GST rule 46 allows 16), gapless (the counter moves in the same transaction as the invoice), the buyer's name
--     and GSTIN and the seller's details copied onto the invoice when it is issued, CGST+SGST or IGST by the two states; credit notes (`C19-2627-000001`) for refunds
--   * top-up credits never expire (the free start still carries its days)
--   * reads: the top-up orders with their state, the statement (every credit and debit with a running balance), one invoice in full
-- Nothing here calls a network. Idempotent per payment id. The refund and the low-balance item are in the next migration.

-- ------------------------------------------------------------------------------------------------------------------------------ settings
alter table pricing.settings
  add column topup_min_paise      bigint  not null default 10000    check (topup_min_paise between 100 and 100000000),
  add column topup_max_paise      bigint  not null default 10000000 check (topup_max_paise between 100 and 1000000000),
  add column low_balance_minutes  integer not null default 4        check (low_balance_minutes between 0 and 600),
  add column seller_name          text    check (seller_name is null or (char_length(seller_name) between 2 and 200 and app.text_is_clean(seller_name))),
  add column seller_gstin         text    check (seller_gstin is null or app.gstin_is_valid(seller_gstin)),
  add column seller_address       text    check (seller_address is null or (char_length(seller_address) between 5 and 400 and app.text_is_clean(seller_address))),
  add column seller_sac           text    check (seller_sac is null or seller_sac ~ '^[0-9]{6}$'),
  add check (topup_min_paise <= topup_max_paise and topup_min_paise % 100 = 0 and topup_max_paise % 100 = 0);
comment on column pricing.settings.seller_name is 'SAFE: the legal name of the company that issues the invoices (operator data, set by the owner of the product). CLEAN-EXEMPT: length CHECK and text_is_clean';
comment on column pricing.settings.seller_gstin is 'SAFE: the issuing company''s GSTIN (operator data). CLEAN-EXEMPT: validated by app.gstin_is_valid';
comment on column pricing.settings.seller_address is 'SAFE: the issuing company''s registered address (operator data). CLEAN-EXEMPT: length CHECK and text_is_clean';
comment on column pricing.settings.seller_sac is 'SAFE: the SAC code printed on the invoices (operator data). CLEAN-EXEMPT: strict pattern CHECK';

-- ------------------------------------------------------------------------------------------------------------------------------ orders
alter table pricing.orders drop constraint orders_status_check;
alter table pricing.orders add constraint orders_status_check check (status in ('created', 'failed', 'paid'));
alter table pricing.orders
  add column failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9_]{2,60}$'),
  add column failed_at    timestamptz,
  add column paid_paise   bigint check (paid_paise is null or paid_paise > 0);
comment on column pricing.orders.failure_code is 'SAFE: a closed plain word (payment_failed, dismissed, amount_mismatch ...). CLEAN-EXEMPT: strict pattern CHECK';
create unique index orders_payment_ref_uq on pricing.orders (payment_ref) where payment_ref is not null;

-- ------------------------------------------------------------------------------------------------------------------------------ refunds of a top-up (the staff functions are in the next migration)
create table pricing.refunds (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants (id) on delete restrict,
  order_id               text not null references pricing.orders (order_id),
  payment_ref            text not null check (payment_ref ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  status                 text not null check (status in ('pending', 'done', 'failed')),
  refund_paise           bigint not null check (refund_paise > 0),
  credits_reversed_paise bigint not null check (credits_reversed_paise > 0),
  gst_refund_paise       bigint not null check (gst_refund_paise >= 0 and refund_paise = credits_reversed_paise + gst_refund_paise),
  provider_ref           text check (provider_ref is null or provider_ref ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  reason_code            text not null check (reason_code in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other')),
  reason_text            text not null check (char_length(reason_text) between 3 and 300 and app.text_is_clean(reason_text)),
  staff_id               uuid not null references admin.staff (user_id) on delete restrict,
  idem_key               text not null unique check (idem_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  credit_note_number     text,
  created_at             timestamptz not null default now(),
  finished_at            timestamptz
);
comment on column pricing.refunds.payment_ref is 'SAFE: the provider''s payment id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column pricing.refunds.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.refunds.provider_ref is 'SAFE: the provider''s refund id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column pricing.refunds.reason_code is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.refunds.reason_text is 'SAFE: the staff member''s own reason in words (money always needs words). CLEAN-EXEMPT: length CHECK and text_is_clean';
comment on column pricing.refunds.idem_key is 'SAFE: an opaque idempotency key. CLEAN-EXEMPT: strict pattern CHECK';
comment on column pricing.refunds.credit_note_number is 'SAFE: our credit note number. CLEAN-EXEMPT: copied from pricing.invoices.number';
create unique index refunds_one_live_per_order on pricing.refunds (order_id) where status in ('pending', 'done');
create index refunds_tenant_idx on pricing.refunds (tenant_id, created_at desc);
alter table pricing.refunds enable row level security;
alter table pricing.refunds force row level security;
revoke all on pricing.refunds from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------------------ top-up credits never expire
create or replace function pricing.credit(p_tenant uuid, p_source text, p_ref text, p_amount bigint) returns boolean language plpgsql set search_path = '' as
$$
begin
  insert into pricing.wallet_lots (tenant_id, source, ref, amount_paise, remaining_paise, expires_at)
  values (p_tenant, p_source, p_ref, p_amount, p_amount,
          now() + case when p_source = 'topup' then interval '36500 days' else make_interval(days => (select s.lot_days from pricing.settings s)) end)
  on conflict (tenant_id, source, ref) do nothing;
  return found;
end $$;
update pricing.wallet_lots set expires_at = created_at + interval '36500 days' where source = 'topup' and expires_at < created_at + interval '36500 days';

-- ------------------------------------------------------------------------------------------------------------------------------ GST invoices
create table pricing.invoice_counters (
  series  text    not null check (series in ('INV', 'CN')),
  fy      text    not null check (fy ~ '^[0-9]{4}$'),
  last_no integer not null default 0 check (last_no >= 0),
  primary key (series, fy)
);
comment on column pricing.invoice_counters.series is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.invoice_counters.fy is 'SAFE: a financial year such as 2627 (April 2026 to March 2027). CLEAN-EXEMPT: strict pattern CHECK';
alter table pricing.invoice_counters enable row level security;
alter table pricing.invoice_counters force row level security;
revoke all on pricing.invoice_counters from public, anon, authenticated, service_role;

alter table pricing.invoices drop constraint invoices_kind_check;
alter table pricing.invoices add constraint invoices_kind_check check (kind in ('subscription', 'topup', 'payg_fee', 'credit_note'));
alter table pricing.invoices drop constraint invoices_number_check;
alter table pricing.invoices add constraint invoices_number_check check (number ~ '^(S19|C19)-[0-9]{4}-[0-9]{6}$');
alter table pricing.invoices
  add column buyer_name       text check (buyer_name is null or char_length(buyer_name) between 1 and 200),
  add column buyer_gstin      text check (buyer_gstin is null or app.gstin_is_valid(buyer_gstin)),
  add column buyer_state_code text check (buyer_state_code is null or buyer_state_code ~ '^[0-9]{2}$'),
  add column seller_name      text,
  add column seller_gstin     text check (seller_gstin is null or app.gstin_is_valid(seller_gstin)),
  add column seller_address   text,
  add column seller_sac       text check (seller_sac is null or seller_sac ~ '^[0-9]{6}$'),
  add column tax_split        text check (tax_split is null or tax_split in ('igst', 'cgst_sgst')),
  add column cgst_paise       bigint not null default 0 check (cgst_paise >= 0),
  add column sgst_paise       bigint not null default 0 check (sgst_paise >= 0),
  add column igst_paise       bigint not null default 0 check (igst_paise >= 0),
  add column against_number   text,
  add check (cgst_paise + sgst_paise + igst_paise in (0, gst_paise));
comment on column pricing.invoices.buyer_name is 'PII: the workspace name as the buyer, copied when the invoice is issued (a sole proprietor''s name may be in it). Erased with the workspace. CLEAN-EXEMPT: length CHECK, copied from the workspace name';
comment on column pricing.invoices.buyer_gstin is 'PII: the buyer''s GSTIN (holds a PAN), copied when the invoice is issued. CLEAN-EXEMPT: validated by app.gstin_is_valid';
comment on column pricing.invoices.buyer_state_code is 'SAFE: the first two digits of the buyer''s GSTIN (a state). CLEAN-EXEMPT: strict pattern CHECK';
comment on column pricing.invoices.seller_name is 'SAFE: the issuing company''s name at the time (operator data). CLEAN-EXEMPT: copied from pricing.settings';
comment on column pricing.invoices.seller_gstin is 'SAFE: the issuing company''s GSTIN at the time. CLEAN-EXEMPT: validated by app.gstin_is_valid';
comment on column pricing.invoices.seller_address is 'SAFE: the issuing company''s address at the time (operator data). CLEAN-EXEMPT: copied from pricing.settings';
comment on column pricing.invoices.seller_sac is 'SAFE: the SAC code at the time. CLEAN-EXEMPT: strict pattern CHECK';
comment on column pricing.invoices.tax_split is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.invoices.against_number is 'SAFE: on a credit note, the number of the invoice it reduces. CLEAN-EXEMPT: copied from pricing.invoices.number';

-- the financial year (April to March, India time) of a moment, as "2627"
create function pricing.fy_of(p_at timestamptz) returns text language sql immutable set search_path = '' as
$$
  select lpad((y % 100)::text, 2, '0') || lpad(((y + 1) % 100)::text, 2, '0')
    from (select (extract(year from (p_at at time zone 'Asia/Kolkata'))::integer - case when extract(month from (p_at at time zone 'Asia/Kolkata')) < 4 then 1 else 0 end) as y) s
$$;
revoke all on function pricing.fy_of(timestamptz) from public, anon, authenticated, service_role;

-- an invoice (or a credit note) for a payment: GST added on top (or the stated GST), numbered per financial year without gaps, once per (kind, payment).
-- The counter is moved only when a NEW invoice is written, in the same transaction, so a rolled-back payment leaves no hole. Callers hold a lock on what they settle (the order row, the event id).
drop function pricing.invoice(uuid, text, text, bigint);
create function pricing.invoice(p_tenant uuid, p_kind text, p_ref text, p_subtotal bigint, p_gst bigint default null, p_against text default null) returns jsonb language plpgsql set search_path = '' as
$$
declare
  v_gst      bigint := coalesce(p_gst, pricing.gst_of(p_subtotal));
  v_row      pricing.invoices;
  v_series   text := case when p_kind = 'credit_note' then 'CN' else 'INV' end;
  v_fy       text := pricing.fy_of(now());
  v_no       integer;
  v_s        pricing.settings;
  v_buyer    text;
  v_bgstin   text;
  v_bstate   text;
  v_split    text;
  v_cgst     bigint := 0;
  v_sgst     bigint := 0;
  v_igst     bigint := 0;
begin
  select * into v_row from pricing.invoices i where i.tenant_id = p_tenant and i.kind = p_kind and i.ref = p_ref;
  if not found then
    insert into pricing.invoice_counters as c (series, fy, last_no) values (v_series, v_fy, 1)
    on conflict (series, fy) do update set last_no = c.last_no + 1
    returning c.last_no into v_no;
    select * into v_s from pricing.settings;
    select left(t.name, 200) into v_buyer from public.tenants t where t.id = p_tenant;
    select b.gstin into v_bgstin from public.business_profile b where b.tenant_id = p_tenant;
    v_bstate := case when v_bgstin is not null then left(v_bgstin, 2) end;
    -- the split needs the seller's state; a buyer with no GSTIN is taken to be in the seller's state (the place of supply of an online service to a person with no GSTIN is where they are, which we do not know)
    if v_s.seller_gstin is not null and v_gst > 0 then
      v_split := case when v_bstate is null or v_bstate = left(v_s.seller_gstin, 2) then 'cgst_sgst' else 'igst' end;
      if v_split = 'igst' then
        v_igst := v_gst;
      else
        v_cgst := v_gst / 2;
        v_sgst := v_gst - v_cgst;
      end if;
    end if;
    insert into pricing.invoices (tenant_id, number, kind, ref, subtotal_paise, gst_paise, total_paise, buyer_name, buyer_gstin, buyer_state_code,
                                  seller_name, seller_gstin, seller_address, seller_sac, tax_split, cgst_paise, sgst_paise, igst_paise, against_number)
    values (p_tenant, case when v_series = 'CN' then 'C19' else 'S19' end || '-' || v_fy || '-' || lpad(v_no::text, 6, '0'), p_kind, p_ref, p_subtotal, v_gst, p_subtotal + v_gst,
            v_buyer, v_bgstin, v_bstate, v_s.seller_name, v_s.seller_gstin, v_s.seller_address, v_s.seller_sac, v_split, v_cgst, v_sgst, v_igst, p_against)
    returning * into v_row;
  end if;
  return jsonb_build_object('number', v_row.number, 'subtotal_paise', v_row.subtotal_paise, 'gst_paise', v_row.gst_paise, 'total_paise', v_row.total_paise);
end $$;
revoke all on function pricing.invoice(uuid, text, text, bigint, bigint, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------------------ create an order (the amount rules of a top-up)
create or replace function public.pricing_order_create(p_tenant_id uuid, p_order_id text, p_purpose text, p_amount_paise bigint, p_plan_id text, p_interval text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_base  bigint;
  v_plan  text := null;
  v_int   text := null;
  v_sub   pricing.subscriptions;
  v_s     pricing.settings;
begin
  perform pricing.owner_only(p_tenant_id);
  if p_order_id is null or p_order_id !~ '^[A-Za-z0-9_.:-]{3,100}$' or p_purpose not in ('topup', 'payg_fee', 'plan_change') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if p_purpose = 'topup' then
    select * into v_s from pricing.settings;
    -- a credit is a rupee: whole rupees only, between the minimum and the maximum
    if p_amount_paise is null or p_amount_paise % 100 <> 0 or p_amount_paise not between v_s.topup_min_paise and v_s.topup_max_paise then
      raise exception 'a top-up is a whole number of rupees between the minimum and the maximum' using errcode = '22023';
    end if;
    v_base := p_amount_paise;
  elsif p_purpose = 'payg_fee' then
    v_base := pricing.price_of('payg', 'monthly');
    v_plan := 'payg';
    v_int := 'monthly';
  else
    select * into v_sub from pricing.subscriptions s where s.tenant_id = p_tenant_id and s.status <> 'cancelled';
    if v_sub.tenant_id is null or pricing.price_of(p_plan_id, p_interval) is null then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    v_base := (pricing.change_quote(p_tenant_id, p_plan_id, p_interval) ->> 'amount_due_paise')::bigint;
    if v_base <= 0 then
      raise exception 'nothing to pay for this change' using errcode = '22023';
    end if;
    v_plan := p_plan_id;
    v_int := p_interval;
  end if;
  insert into pricing.orders (order_id, tenant_id, purpose, base_paise, total_paise, plan_id, interval)
  values (p_order_id, p_tenant_id, p_purpose, v_base, v_base + pricing.gst_of(v_base), v_plan, v_int)
  on conflict (order_id) do nothing;
  return (select jsonb_build_object('order_id', o.order_id, 'purpose', o.purpose, 'base_paise', o.base_paise, 'gst_paise', o.total_paise - o.base_paise, 'total_paise', o.total_paise, 'status', o.status)
            from pricing.orders o where o.order_id = p_order_id and o.tenant_id = p_tenant_id);
end $$;

-- ------------------------------------------------------------------------------------------------------------------------------ settle an order (the browser's checked payment or the signed webhook)
-- The same function for both: the order row is locked, so the browser and the webhook racing each other settle once and the loser sees a replay. A paid amount, when the caller knows it (the webhook does), must
-- equal the order's total or nothing is credited.
drop function public.pricing_order_settle(uuid, text, text);
create function pricing.order_settle(p_tenant_id uuid, p_order_id text, p_payment_ref text, p_paid_paise bigint) returns jsonb language plpgsql set search_path = '' as
$$
declare
  o     pricing.orders;
  v_sub pricing.subscriptions;
  v_start timestamptz;
begin
  select * into o from pricing.orders x where x.order_id = p_order_id and x.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if o.status = 'paid' then
    return jsonb_build_object('settled', false, 'replayed', true, 'purpose', o.purpose, 'same_payment', o.payment_ref = p_payment_ref);
  end if;
  if exists (select 1 from pricing.orders x where x.payment_ref = p_payment_ref and x.order_id <> o.order_id) then
    raise exception 'that payment already settled another order' using errcode = '22023';
  end if;
  if p_paid_paise is not null and p_paid_paise <> o.total_paise then
    update pricing.orders set status = 'failed', failure_code = 'amount_mismatch', failed_at = now() where order_id = o.order_id;
    perform app.write_audit_event(o.tenant_id, 'billing.payment_amount_mismatch', 'workspace', o.tenant_id, null, jsonb_build_object('expected_paise', o.total_paise, 'paid_paise', p_paid_paise));
    return jsonb_build_object('settled', false, 'replayed', false, 'purpose', o.purpose, 'reason', 'amount_mismatch');
  end if;
  update pricing.orders set status = 'paid', payment_ref = p_payment_ref, paid_at = now(), paid_paise = o.total_paise, failure_code = null where order_id = o.order_id;
  if o.purpose = 'topup' then
    perform pricing.credit(o.tenant_id, 'topup', p_payment_ref, o.base_paise);
    perform pricing.invoice(o.tenant_id, 'topup', p_payment_ref, o.base_paise);
    perform app.write_audit_event(o.tenant_id, 'billing.topup_paid', 'workspace', o.tenant_id, null, jsonb_build_object('credits_paise', o.base_paise, 'total_paise', o.total_paise));
  elsif o.purpose = 'payg_fee' then
    select * into v_sub from pricing.subscriptions s where s.tenant_id = o.tenant_id for update;
    v_start := case when v_sub.tenant_id is not null and v_sub.period_end > now() then v_sub.period_end else now() end;
    insert into pricing.subscriptions as s (tenant_id, plan_id, interval, status, provider, provider_ref, period_start, period_end, price_locked_until)
    values (o.tenant_id, 'payg', 'monthly', 'active', 'razorpay', null, v_start, pricing.period_end(v_start, 'monthly'), now() + make_interval(months => (select x.launch_lock_months from pricing.settings x)))
    on conflict (tenant_id) do update set plan_id = 'payg', interval = 'monthly', status = 'active', period_start = excluded.period_start, period_end = excluded.period_end, updated_at = now();
    perform pricing.invoice(o.tenant_id, 'payg_fee', p_payment_ref, o.base_paise);
  else
    perform pricing.apply_change(o.tenant_id, o.plan_id, o.interval, p_payment_ref);
  end if;
  return jsonb_build_object('settled', true, 'replayed', false, 'purpose', o.purpose);
end $$;
revoke all on function pricing.order_settle(uuid, text, text, bigint) from public, anon, authenticated, service_role;

create function public.pricing_order_settle(p_tenant_id uuid, p_order_id text, p_payment_ref text, p_paid_paise bigint default null) returns jsonb language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not (app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) or app.is_billing_webhook()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_order_id is null or p_payment_ref is null or p_payment_ref !~ '^[A-Za-z0-9_.:-]{3,100}$' or (p_paid_paise is not null and p_paid_paise <= 0) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return pricing.order_settle(p_tenant_id, p_order_id, p_payment_ref, p_paid_paise);
end $$;
revoke all on function public.pricing_order_settle(uuid, text, text, bigint) from public, anon;
grant execute on function public.pricing_order_settle(uuid, text, text, bigint) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ a payment that failed or was dismissed
-- The webhook (payment.failed, which carries the order id but not our workspace) or the Owner (the checkout was closed or reported a failure). The order stays payable: a later successful payment still settles it.
-- An unknown order, an order of another workspace and an order already paid are answered and ignored (a retry storm helps nobody).
create function public.pricing_order_failed(p_order_id text, p_code text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  o pricing.orders;
begin
  if auth.uid() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_order_id is null or p_order_id !~ '^[A-Za-z0-9_.:-]{3,100}$' or p_code is null or p_code !~ '^[a-z0-9_]{2,60}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into o from pricing.orders x where x.order_id = p_order_id and x.purpose = 'topup' for update;
  if not found or not (app.is_billing_webhook() or app.has_tenant_role(o.tenant_id, array['owner']::public.app_role[])) then
    return jsonb_build_object('recorded', false, 'reason', 'unknown_order');
  end if;
  if o.status = 'paid' then
    return jsonb_build_object('recorded', false, 'reason', 'already_paid');
  end if;
  update pricing.orders set status = 'failed', failure_code = p_code, failed_at = now() where order_id = o.order_id;
  return jsonb_build_object('recorded', true, 'reason', null);
end $$;
revoke all on function public.pricing_order_failed(text, text) from public, anon;
grant execute on function public.pricing_order_failed(text, text) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ reads (Owner, Admin)
-- the top-up orders, newest first, with the state a screen shows: paid, failed, pending (under an hour old and not paid) or abandoned (older)
create function public.pricing_topup_orders(p_tenant_id uuid, p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform pricing.deny();
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'order_id', x.order_id, 'credits_paise', x.base_paise, 'gst_paise', x.total_paise - x.base_paise, 'total_paise', x.total_paise,
            'state', case when x.status = 'paid' then 'paid' when x.status = 'failed' then 'failed' when x.created_at > now() - interval '1 hour' then 'pending' else 'abandoned' end,
            'failure_code', x.failure_code, 'created_at', x.created_at, 'paid_at', x.paid_at,
            'invoice_number', (select i.number from pricing.invoices i where i.tenant_id = x.tenant_id and i.kind = 'topup' and i.ref = x.payment_ref),
            'refunded', exists (select 1 from pricing.refunds r where r.order_id = x.order_id and r.status = 'done')) order by x.created_at desc, x.order_id desc)
          from (select * from pricing.orders o where o.tenant_id = p_tenant_id and o.purpose = 'topup' order by o.created_at desc, o.order_id desc limit p_limit) x), '[]'::jsonb);
end $$;
revoke all on function public.pricing_topup_orders(uuid, integer) from public, anon;
grant execute on function public.pricing_topup_orders(uuid, integer) to authenticated;

-- one invoice in full, for the page that prints it
create function public.pricing_invoice_detail(p_tenant_id uuid, p_number text) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  i pricing.invoices;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform pricing.deny();
  end if;
  if p_number is null or p_number !~ '^(S19|C19)-[0-9]{4}-[0-9]{6}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into i from pricing.invoices x where x.tenant_id = p_tenant_id and x.number = p_number;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  return jsonb_build_object('number', i.number, 'kind', i.kind, 'issued_at', i.issued_at, 'subtotal_paise', i.subtotal_paise, 'gst_paise', i.gst_paise, 'total_paise', i.total_paise,
    'cgst_paise', i.cgst_paise, 'sgst_paise', i.sgst_paise, 'igst_paise', i.igst_paise, 'tax_split', i.tax_split, 'against_number', i.against_number,
    'gst_percent', (select round(s.gst_bps / 100.0, 2) from pricing.settings s),
    'buyer_name', i.buyer_name, 'buyer_gstin', i.buyer_gstin, 'buyer_state_code', i.buyer_state_code,
    'seller_name', i.seller_name, 'seller_gstin', i.seller_gstin, 'seller_address', i.seller_address, 'seller_sac', i.seller_sac);
end $$;
revoke all on function public.pricing_invoice_detail(uuid, text) from public, anon;
grant execute on function public.pricing_invoice_detail(uuid, text) to authenticated;

-- the statement: every credit and debit of the wallet, newest first, each with the balance after it. credits = lots (top-up, free start, goodwill, refund-to-balance); debits = calls and searches (what was
-- really taken, not the shortfall), a refund reversal, and credits that expired. The running balance adds up to pricing.balance_of. Paged with `p_before` (the `next_before` of the previous page).
create function public.pricing_statement(p_tenant_id uuid, p_from date default null, p_to date default null, p_limit integer default 100, p_before timestamptz default null) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_from timestamptz := case when p_from is null then null else (p_from::timestamp at time zone 'Asia/Kolkata') end;
  v_to   timestamptz := case when p_to is null then null else ((p_to + 1)::timestamp at time zone 'Asia/Kolkata') end;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform pricing.deny();
  end if;
  if p_limit is null or p_limit not between 1 and 200 or (p_from is not null and p_to is not null and p_to < p_from) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return (
    with e0 as (
      select l.created_at as at, 'credit'::text as kind,
             case l.source when 'topup' then 'Top-up' when 'free_start' then 'Free start' when 'adjustment' then 'Added by Stack19' else 'Refund to your balance' end as label,
             l.amount_paise as amt, l.ref as ref,
             (select i.number from pricing.invoices i where l.source = 'topup' and i.tenant_id = l.tenant_id and i.kind = 'topup' and i.ref = l.ref) as invoice_number
        from pricing.wallet_lots l where l.tenant_id = p_tenant_id
      union all
      select u.at, 'usage', case u.kind when 'call' then 'Call' else 'Lead Finder search' end, -(u.charged_paise - u.shortfall_paise), u.ref::text, null
        from pricing.usage u where u.tenant_id = p_tenant_id and u.charged_paise - u.shortfall_paise > 0
      union all
      select r.created_at, 'refund', 'Refund of a top-up', -r.credits_reversed_paise, r.order_id, r.credit_note_number
        from pricing.refunds r where r.tenant_id = p_tenant_id and r.status in ('pending', 'done')
      union all
      select l.expires_at, 'expiry', 'Balance expired', -l.remaining_paise, l.ref, null
        from pricing.wallet_lots l where l.tenant_id = p_tenant_id and l.expires_at <= now() and l.remaining_paise > 0),
    e as (select e0.*, sum(e0.amt) over (order by e0.at, e0.kind, e0.ref rows between unbounded preceding and current row) as balance_after from e0),
    sel as (select e.* from e where (v_from is null or e.at >= v_from) and (v_to is null or e.at < v_to) and (p_before is null or e.at < p_before) order by e.at desc, e.kind desc, e.ref desc limit p_limit + 1),
    page as (select s.*, row_number() over (order by s.at desc, s.kind desc, s.ref desc) as rn from sel s)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object('at', p.at, 'kind', p.kind, 'label', p.label, 'amount_paise', p.amt, 'balance_after_paise', p.balance_after, 'ref', p.ref, 'invoice_number', p.invoice_number) order by p.rn)
                           from page p where p.rn <= p_limit), '[]'::jsonb),
      'has_more', (select count(*) > p_limit from page),
      'next_before', (select p.at from page p where p.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1)),
      'opening_paise', coalesce((select sum(x.amt) from e x where v_from is not null and x.at < v_from), 0),
      'closing_paise', coalesce((select sum(x.amt) from e x where v_to is null or x.at < v_to), 0),
      'balance_paise', pricing.balance_of(p_tenant_id)));
end $$;
revoke all on function public.pricing_statement(uuid, date, date, integer, timestamptz) from public, anon;
grant execute on function public.pricing_statement(uuid, date, date, integer, timestamptz) to authenticated;
