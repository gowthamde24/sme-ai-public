-- BILLING V2, part P3 (orders): one-time payments at the provider (Razorpay ORDERS): a wallet top-up, the pay-as-you-go monthly fee (Rs 499) and the prorated amount of an upgrade. The API creates the order at
-- the provider and records it HERE first (what it is for and what it is worth); when the provider says it was paid (the browser returns its signature, or the signed webhook says order.paid) the order is SETTLED
-- exactly once: the wallet is credited / the period is extended / the plan is changed, and the GST invoice is written. Trusting the stored order, not the caller, is what stops a paid Rs 100 from becoming Rs 10,000.
--   pricing.orders              one row per order: purpose, base (what the customer gets), total (base + 18 % GST, what the provider charges), plan and interval for a change, paid or not
--   public.pricing_order_create the Owner: validates the amounts by purpose, stores the order, answers the total to charge
--   public.pricing_order_settle the Owner (after the browser's checked signature) or the system (the webhook): idempotent per order

create table pricing.orders (
  order_id    text primary key check (order_id ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  purpose     text not null check (purpose in ('topup', 'payg_fee', 'plan_change')),
  base_paise  bigint not null check (base_paise > 0),
  total_paise bigint not null check (total_paise >= base_paise),
  plan_id     text references pricing.plans (id),
  interval    text check (interval in ('monthly', 'yearly')),
  status      text not null default 'created' check (status in ('created', 'paid')),
  payment_ref text check (payment_ref ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  created_at  timestamptz not null default now(),
  paid_at     timestamptz,
  check ((status = 'paid') = (payment_ref is not null and paid_at is not null))
);
comment on column pricing.orders.order_id is 'SAFE: the payment provider''s order id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column pricing.orders.purpose is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.orders.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.orders.payment_ref is 'SAFE: the payment provider''s payment id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column pricing.orders.interval is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.orders.plan_id is 'SAFE: a plan id (foreign key). CLEAN-EXEMPT: foreign key to a closed list';
create index orders_tenant_idx on pricing.orders (tenant_id, created_at desc);
alter table pricing.orders enable row level security;
alter table pricing.orders force row level security;
revoke all on pricing.orders from public, anon, authenticated, service_role;

create function public.pricing_order_create(p_tenant_id uuid, p_order_id text, p_purpose text, p_amount_paise bigint, p_plan_id text, p_interval text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_base  bigint;
  v_plan  text := null;
  v_int   text := null;
  v_sub   pricing.subscriptions;
begin
  perform pricing.owner_only(p_tenant_id);
  if p_order_id is null or p_order_id !~ '^[A-Za-z0-9_.:-]{3,100}$' or p_purpose not in ('topup', 'payg_fee', 'plan_change') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if p_purpose = 'topup' then
    if p_amount_paise is null or p_amount_paise not between 10000 and 10000000 then
      raise exception 'a top-up is between Rs 100 and Rs 1,00,000' using errcode = '22023';
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
revoke all on function public.pricing_order_create(uuid, text, text, bigint, text, text) from public, anon;
grant execute on function public.pricing_order_create(uuid, text, text, bigint, text, text) to authenticated;

create function public.pricing_order_settle(p_tenant_id uuid, p_order_id text, p_payment_ref text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  o     pricing.orders;
  v_sub pricing.subscriptions;
  v_start timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not (app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) or app.is_scheduler() or app.is_channel_agent()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_order_id is null or p_payment_ref is null or p_payment_ref !~ '^[A-Za-z0-9_.:-]{3,100}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into o from pricing.orders x where x.order_id = p_order_id and x.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if o.status = 'paid' then
    return jsonb_build_object('settled', false, 'replayed', true, 'purpose', o.purpose);
  end if;
  update pricing.orders set status = 'paid', payment_ref = p_payment_ref, paid_at = now() where order_id = o.order_id;
  if o.purpose = 'topup' then
    perform pricing.credit(o.tenant_id, 'topup', p_payment_ref, o.base_paise);
    perform pricing.invoice(o.tenant_id, 'topup', p_payment_ref, o.base_paise);
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
revoke all on function public.pricing_order_settle(uuid, text, text) from public, anon;
grant execute on function public.pricing_order_settle(uuid, text, text) to authenticated;

-- the invoices of a workspace (Owner, Admin), newest first
create function public.pricing_invoices(p_tenant_id uuid, p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform pricing.deny();
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('number', i.number, 'kind', i.kind, 'subtotal_paise', i.subtotal_paise, 'gst_paise', i.gst_paise, 'total_paise', i.total_paise, 'issued_at', i.issued_at) order by i.issued_at desc, i.number desc)
                     from (select * from pricing.invoices x where x.tenant_id = p_tenant_id order by x.issued_at desc, x.number desc limit p_limit) i), '[]'::jsonb);
end $$;
revoke all on function public.pricing_invoices(uuid, integer) from public, anon;
grant execute on function public.pricing_invoices(uuid, integer) to authenticated;
