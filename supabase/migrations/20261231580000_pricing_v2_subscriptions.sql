-- BILLING V2, part P3 (database half): subscribing, changing plan mid-period (prorated), cancelling, the pay-as-you-go monthly fee, and the payment provider's subscription events, in the owner's final
-- pricing (docs/plans/billing-v2-final-pricing.md). Payments happen at the provider (Razorpay TEST); these functions record what happened, once per payment, and write the GST invoice.
--   * subscribe: the Owner, after the provider confirmed the first payment; the period runs a month (or a year); the launch price is locked for 12 months; the invoice is the plan's price + 18 % GST
--   * change plan: a QUOTE first (what is due now: the unused share of the old price taken back from the new price, never below zero), then APPLY with the provider's payment id; a downgrade credits the
--     difference to the wallet as a lot. The data is never touched: only the plan changes.
--   * the provider's events (the worker applies them): a charge extends the period and invoices it, `halted` marks the subscription past due, `cancelled` ends it
--   * pay as you go: the Rs 499 monthly fee is a one-time ORDER each month; `pricing_payg_fee_paid` extends its period and invoices it
-- Everything is idempotent per payment id.

alter table pricing.subscriptions drop constraint subscriptions_provider_check;
alter table pricing.subscriptions add constraint subscriptions_provider_check check (provider in ('fake', 'razorpay'));

create function pricing.period_end(p_from timestamptz, p_interval text) returns timestamptz language sql immutable set search_path = '' as
$$ select case when p_interval = 'yearly' then p_from + interval '1 year' else p_from + interval '1 month' end $$;
revoke all on function pricing.period_end(timestamptz, text) from public, anon, authenticated, service_role;

create function pricing.price_of(p_plan text, p_interval text) returns bigint language sql stable set search_path = '' as
$$ select case when p_interval = 'yearly' then p.yearly_paise else p.monthly_paise end from pricing.plans p where p.id = p_plan $$;
revoke all on function pricing.price_of(text, text) from public, anon, authenticated, service_role;

create function pricing.owner_only(p_tenant uuid) returns void language plpgsql set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant is null or not app.has_tenant_role(p_tenant, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;
revoke all on function pricing.owner_only(uuid) from public, anon, authenticated, service_role;

-- subscribe (after the provider confirmed the first payment)
create function public.pricing_subscribe(p_tenant_id uuid, p_plan_id text, p_interval text, p_provider text, p_provider_ref text, p_payment_ref text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_price bigint;
  v_now   timestamptz := now();
begin
  perform pricing.owner_only(p_tenant_id);
  if p_plan_id is null or p_interval not in ('monthly', 'yearly') or p_provider not in ('fake', 'razorpay') or p_payment_ref is null or p_payment_ref !~ '^[A-Za-z0-9_.:-]{3,100}$'
     or (p_provider_ref is not null and p_provider_ref !~ '^[A-Za-z0-9_.-]{3,100}$') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_price := pricing.price_of(p_plan_id, p_interval);
  if v_price is null then
    raise exception 'unknown plan' using errcode = 'SM821';
  end if;
  if exists (select 1 from pricing.invoices i where i.tenant_id = p_tenant_id and i.kind = 'subscription' and i.ref = p_payment_ref) then
    return public.pricing_balance(p_tenant_id) || jsonb_build_object('replayed', true);
  end if;
  insert into pricing.subscriptions as s (tenant_id, plan_id, interval, status, provider, provider_ref, period_start, period_end, price_locked_until)
  values (p_tenant_id, p_plan_id, p_interval, 'active', p_provider, p_provider_ref, v_now, pricing.period_end(v_now, p_interval), v_now + make_interval(months => (select x.launch_lock_months from pricing.settings x)))
  on conflict (tenant_id) do update set plan_id = excluded.plan_id, interval = excluded.interval, status = 'active', provider = excluded.provider, provider_ref = excluded.provider_ref,
    period_start = excluded.period_start, period_end = excluded.period_end, cancel_at_period_end = false, updated_at = v_now;
  perform pricing.invoice(p_tenant_id, 'subscription', p_payment_ref, v_price);
  perform app.write_audit_event(p_tenant_id, 'billing.subscribed', 'workspace', p_tenant_id, null, jsonb_build_object('plan', p_plan_id, 'interval', p_interval));
  return public.pricing_balance(p_tenant_id) || jsonb_build_object('replayed', false);
end $$;
revoke all on function public.pricing_subscribe(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.pricing_subscribe(uuid, text, text, text, text, text) to authenticated;

-- what changing plan costs RIGHT NOW (the owner reads it before agreeing; nothing changes)
create function pricing.change_quote(p_tenant_id uuid, p_plan_id text, p_interval text) returns jsonb language plpgsql stable set search_path = '' as
$$
declare
  v_sub   pricing.subscriptions;
  v_old   bigint;
  v_new   bigint;
  v_left  integer;
  v_total integer;
  v_delta bigint;
begin
  select * into v_sub from pricing.subscriptions s where s.tenant_id = p_tenant_id and s.status <> 'cancelled';
  v_new := pricing.price_of(p_plan_id, p_interval);
  if v_sub.tenant_id is null or v_new is null or p_interval not in ('monthly', 'yearly') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_old := pricing.price_of(v_sub.plan_id, v_sub.interval);
  v_left := greatest(extract(day from v_sub.period_end - now())::integer, 0);
  v_total := greatest(extract(day from v_sub.period_end - v_sub.period_start)::integer, 1);
  v_delta := pricing.prorate(v_old, v_new, v_left, v_total);
  return jsonb_build_object('from_plan', v_sub.plan_id, 'to_plan', p_plan_id, 'days_left', v_left, 'days_in_period', v_total, 'amount_due_paise', greatest(v_delta, 0),
    'gst_paise', pricing.gst_of(greatest(v_delta, 0)), 'total_due_paise', greatest(v_delta, 0) + pricing.gst_of(greatest(v_delta, 0)), 'credit_paise', greatest(-v_delta, 0));
end $$;
revoke all on function pricing.change_quote(uuid, text, text) from public, anon, authenticated, service_role;

create function public.pricing_change_quote(p_tenant_id uuid, p_plan_id text, p_interval text) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  perform pricing.owner_only(p_tenant_id);
  return pricing.change_quote(p_tenant_id, p_plan_id, p_interval);
end $$;
revoke all on function public.pricing_change_quote(uuid, text, text) from public, anon;
grant execute on function public.pricing_change_quote(uuid, text, text) to authenticated;

-- apply the change (an upgrade after the provider took the amount; a downgrade needs no payment and its credit goes to the wallet). Once per payment id / change id.
-- pricing.apply_change does the work for the Owner's direct call AND for an order the system settles (pricing_order_settle).
create function pricing.apply_change(p_tenant uuid, p_plan_id text, p_interval text, p_payment_ref text) returns jsonb language plpgsql set search_path = '' as
$$
declare
  q jsonb;
  v_due bigint;
begin
  if p_payment_ref is null or p_payment_ref !~ '^[A-Za-z0-9_.:-]{3,100}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if exists (select 1 from pricing.invoices i where i.tenant_id = p_tenant and i.kind = 'subscription' and i.ref = p_payment_ref)
     or exists (select 1 from pricing.wallet_lots l where l.tenant_id = p_tenant and l.source = 'adjustment' and l.ref = p_payment_ref) then
    return jsonb_build_object('replayed', true);
  end if;
  q := pricing.change_quote(p_tenant, p_plan_id, p_interval);
  v_due := (q ->> 'amount_due_paise')::bigint;
  update pricing.subscriptions set plan_id = p_plan_id, interval = p_interval, updated_at = now() where tenant_id = p_tenant;
  if v_due > 0 then
    perform pricing.invoice(p_tenant, 'subscription', p_payment_ref, v_due);
  elsif (q ->> 'credit_paise')::bigint > 0 then
    perform pricing.credit(p_tenant, 'adjustment', p_payment_ref, (q ->> 'credit_paise')::bigint);
  end if;
  perform app.write_audit_event(p_tenant, 'billing.plan_changed', 'workspace', p_tenant, null, jsonb_build_object('plan', p_plan_id, 'interval', p_interval));
  return jsonb_build_object('replayed', false);
end $$;
revoke all on function pricing.apply_change(uuid, text, text, text) from public, anon, authenticated, service_role;

create function public.pricing_change_apply(p_tenant_id uuid, p_plan_id text, p_interval text, p_payment_ref text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  r jsonb;
begin
  perform pricing.owner_only(p_tenant_id);
  r := pricing.apply_change(p_tenant_id, p_plan_id, p_interval, p_payment_ref);
  return public.pricing_balance(p_tenant_id) || r;
end $$;
revoke all on function public.pricing_change_apply(uuid, text, text, text) from public, anon;
grant execute on function public.pricing_change_apply(uuid, text, text, text) to authenticated;

-- cancel at the end of the period that is paid for (nothing is refunded; the data stays)
create function public.pricing_cancel(p_tenant_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
begin
  perform pricing.owner_only(p_tenant_id);
  update pricing.subscriptions set cancel_at_period_end = true, updated_at = now() where tenant_id = p_tenant_id and status <> 'cancelled';
  perform app.write_audit_event(p_tenant_id, 'billing.cancel_requested', 'workspace', p_tenant_id, null, '{}'::jsonb);
  -- the API tells the provider too (it needs the reference, which no screen is given)
  return public.pricing_balance(p_tenant_id) || coalesce((select jsonb_build_object('provider', s.provider, 'provider_ref', s.provider_ref) from pricing.subscriptions s where s.tenant_id = p_tenant_id), '{}'::jsonb);
end $$;
revoke all on function public.pricing_cancel(uuid) from public, anon;
grant execute on function public.pricing_cancel(uuid) to authenticated;

-- the provider's events (applied by the worker): a charge extends the period and is invoiced; a halt marks past due; a cancel ends it. Once per event id.
create table pricing.events (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  event_id  text not null check (event_id ~ '^[A-Za-z0-9_:.-]{3,120}$'),
  kind      text not null check (kind in ('charge_succeeded', 'charge_failed', 'halted', 'cancelled', 'payg_fee')),
  at        timestamptz not null default now(),
  primary key (tenant_id, event_id)
);
comment on column pricing.events.event_id is 'SAFE: the provider''s event id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column pricing.events.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table pricing.events enable row level security;
alter table pricing.events force row level security;
revoke all on pricing.events from public, anon, authenticated, service_role;

create function public.pricing_provider_event(p_tenant_id uuid, p_event_id text, p_kind text, p_amount_paise bigint) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_sub pricing.subscriptions;
  v_n   integer;
  v_start timestamptz;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_event_id is null or p_event_id !~ '^[A-Za-z0-9_:.-]{3,120}$' or p_kind not in ('charge_succeeded', 'charge_failed', 'halted', 'cancelled', 'payg_fee') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into pricing.events (tenant_id, event_id, kind) values (p_tenant_id, p_event_id, p_kind) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('applied', false, 'replayed', true);
  end if;
  select * into v_sub from pricing.subscriptions s where s.tenant_id = p_tenant_id for update;
  if v_sub.tenant_id is null then
    return jsonb_build_object('applied', false, 'replayed', false, 'reason', 'no_subscription');
  end if;
  if p_kind in ('charge_succeeded', 'payg_fee') then
    v_start := case when v_sub.period_end > now() then v_sub.period_end else now() end;
    update pricing.subscriptions set status = 'active', period_start = v_start, period_end = pricing.period_end(v_start, v_sub.interval), updated_at = now() where tenant_id = p_tenant_id;
    perform pricing.invoice(p_tenant_id, case when p_kind = 'payg_fee' then 'payg_fee' else 'subscription' end, p_event_id,
                            coalesce(p_amount_paise, pricing.price_of(v_sub.plan_id, v_sub.interval)));
  elsif p_kind = 'halted' or p_kind = 'charge_failed' then
    update pricing.subscriptions set status = 'past_due', updated_at = now() where tenant_id = p_tenant_id;
  elsif p_kind = 'cancelled' then
    update pricing.subscriptions set status = 'cancelled', updated_at = now() where tenant_id = p_tenant_id;
  end if;
  return jsonb_build_object('applied', true, 'replayed', false);
end $$;
revoke all on function public.pricing_provider_event(uuid, text, text, bigint) from public, anon;
grant execute on function public.pricing_provider_event(uuid, text, text, bigint) to authenticated;
