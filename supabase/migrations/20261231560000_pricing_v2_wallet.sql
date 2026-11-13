-- BILLING V2, part P1: the owner's FINAL pricing of 13 Nov 2026 (docs/plans/billing-v2-final-pricing.md), in the database. A clean module in its own schema, next to billing v1, behind the API flag PRICING_V2.
--   pricing.plans            the three plans as DATA: monthly price, included minutes, the rate after them, numbers, Lead Finder terms (paise). Yearly = ten months' price (two months free).
--   pricing.subscriptions    a workspace's plan, monthly or yearly, its period, the launch price lock (12 months)
--   pricing.wallet_lots      the balance in PAISE (1 credit = Rs 1): a lot per credit (free start, top-up, refund, adjustment), spent oldest-expiring first; top-ups carry 90 days
--   pricing.usage            what was charged: one row per call or search (idempotent per call / search id)
--   pricing.invoices         one row per payment, with GST (18 percent, added on top, rounded to the paisa)
--   pricing.free_starts      the free Rs 50: once per workspace and once per verified phone (its keyed hash)
-- Rules in the functions: a call is billed per 30 seconds (1 to 30 s = one unit, 31 to 60 s = two ...); an unanswered call is Rs 0; the plan's included minutes first, then the rate after them
-- (half the per-minute rate per unit); a search: the first one in a month is free, a plan with Lead Finder is unlimited (fair use), any other costs the extra-search price.
-- No client role touches a table. Reads: public.pricing_catalogue (anyone), public.pricing_balance (any member). Writes on behalf of the system (a finished call, a payment): the worker or the channel account.

create schema pricing;
revoke all on schema pricing from public, anon, authenticated, service_role;
comment on schema pricing is 'Billing v2 (13 Nov 2026): the final pricing. No client role has usage; the functions are public.pricing_*.';

create table pricing.plans (
  id                     text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  sort                   integer not null,
  name                   text not null check (char_length(name) between 1 and 60),
  monthly_paise          bigint not null check (monthly_paise between 0 and 100000000),
  yearly_paise           bigint not null check (yearly_paise between 0 and 1000000000),
  included_minutes       integer not null check (included_minutes between 0 and 100000),
  rate_paise_per_minute  integer not null check (rate_paise_per_minute between 0 and 100000),
  numbers_included       integer not null check (numbers_included between 0 and 100),
  lead_finder            boolean not null,
  free_searches_month    integer not null check (free_searches_month between 0 and 100000),
  extra_search_paise     integer not null check (extra_search_paise between 0 and 1000000),
  fee_by_order           boolean not null,
  check (rate_paise_per_minute % 2 = 0),
  check (yearly_paise = monthly_paise * 10)
);
comment on table pricing.plans is 'Operator data: the plans of 13 Nov 2026. SAFE: not personal data.';
comment on column pricing.plans.id is 'SAFE: a plan id. CLEAN-EXEMPT: strict pattern CHECK';
comment on column pricing.plans.name is 'SAFE: the plan''s name. CLEAN-EXEMPT: length CHECK, operator data';
insert into pricing.plans (id, sort, name, monthly_paise, yearly_paise, included_minutes, rate_paise_per_minute, numbers_included, lead_finder, free_searches_month, extra_search_paise, fee_by_order) values
  ('payg',              10, 'Pay as you go',                 49900,  499000,    0, 500, 1, false,   1, 4900, true),
  ('sales_assistant',   20, 'Sales Assistant',              199900, 1999000,  500, 450, 1, false,   1, 4900, false),
  ('sales_lead_finder', 30, 'Sales Assistant + Lead Finder', 599900, 5999000, 1500, 400, 3, true, 300,    0, false);

create table pricing.settings (
  one                 boolean primary key default true check (one),
  gst_bps             integer not null check (gst_bps between 0 and 10000),
  free_start_paise    bigint not null check (free_start_paise between 0 and 100000000),
  lot_days            integer not null check (lot_days between 1 and 3650),
  launch_lock_months  integer not null check (launch_lock_months between 0 and 60)
);
comment on table pricing.settings is 'Operator data: GST, the free start, how long a credit lasts, the launch price lock. SAFE: not personal data.';
insert into pricing.settings (gst_bps, free_start_paise, lot_days, launch_lock_months) values (1800, 5000, 90, 12);

create table pricing.subscriptions (
  tenant_id            uuid primary key references public.tenants (id) on delete restrict,
  plan_id              text not null references pricing.plans (id),
  interval             text not null check (interval in ('monthly', 'yearly')),
  status               text not null check (status in ('active', 'past_due', 'cancelled')),
  provider             text not null check (provider in ('fake', 'razorpay')),
  provider_ref         text check (provider_ref ~ '^[A-Za-z0-9_.-]{3,100}$'),
  period_start         timestamptz not null,
  period_end           timestamptz not null,
  price_locked_until   timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at           timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  check (period_end > period_start)
);
comment on column pricing.subscriptions.plan_id is 'SAFE: a plan id (foreign key). CLEAN-EXEMPT: foreign key to a closed list';
comment on column pricing.subscriptions.interval is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.subscriptions.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.subscriptions.provider is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.subscriptions.provider_ref is 'SAFE: the provider''s subscription reference, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
alter table pricing.subscriptions enable row level security;
alter table pricing.subscriptions force row level security;
revoke all on pricing.subscriptions from public, anon, authenticated, service_role;

create table pricing.wallet_lots (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  source          text not null check (source in ('free_start', 'topup', 'refund', 'adjustment')),
  ref             text not null check (ref ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  amount_paise    bigint not null check (amount_paise > 0),
  remaining_paise bigint not null check (remaining_paise >= 0),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  unique (tenant_id, source, ref),
  check (remaining_paise <= amount_paise)
);
comment on column pricing.wallet_lots.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.wallet_lots.ref is 'SAFE: the payment provider''s payment id or our own idempotency word, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
create index wallet_lots_spend_idx on pricing.wallet_lots (tenant_id, expires_at) where remaining_paise > 0;
alter table pricing.wallet_lots enable row level security;
alter table pricing.wallet_lots force row level security;
revoke all on pricing.wallet_lots from public, anon, authenticated, service_role;

create table pricing.usage (
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  kind             text not null check (kind in ('call', 'search')),
  ref              uuid not null,
  half_minutes     integer not null check (half_minutes between 0 and 20000),
  included_half    integer not null check (included_half between 0 and 20000),
  charged_paise    bigint not null check (charged_paise >= 0),
  shortfall_paise  bigint not null default 0 check (shortfall_paise >= 0),
  at               timestamptz not null default now(),
  primary key (tenant_id, kind, ref),
  check (included_half <= half_minutes)
);
comment on column pricing.usage.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create index usage_period_idx on pricing.usage (tenant_id, kind, at);
alter table pricing.usage enable row level security;
alter table pricing.usage force row level security;
revoke all on pricing.usage from public, anon, authenticated, service_role;

create table pricing.invoices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  number         text not null unique check (number ~ '^S19-[0-9]{4}-[0-9]{6}$'),
  kind           text not null check (kind in ('subscription', 'topup', 'payg_fee')),
  ref            text not null check (ref ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  gst_paise      bigint not null check (gst_paise >= 0),
  total_paise    bigint not null check (total_paise = subtotal_paise + gst_paise),
  issued_at      timestamptz not null default now(),
  unique (tenant_id, kind, ref)
);
comment on column pricing.invoices.number is 'SAFE: our invoice number. CLEAN-EXEMPT: strict pattern CHECK';
comment on column pricing.invoices.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.invoices.ref is 'SAFE: the payment provider''s id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
create sequence pricing.invoice_seq;
alter table pricing.invoices enable row level security;
alter table pricing.invoices force row level security;
revoke all on pricing.invoices from public, anon, authenticated, service_role;

create table pricing.free_starts (
  tenant_id  uuid primary key references public.tenants (id) on delete restrict,
  phone_hash text unique check (phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$'),
  granted_at timestamptz not null default now()
);
comment on column pricing.free_starts.phone_hash is 'PII: the keyed hash of the verified phone number (never the number), so one phone cannot collect the free start twice. CLEAN-EXEMPT: strict anchored hex pattern';
alter table pricing.free_starts enable row level security;
alter table pricing.free_starts force row level security;
revoke all on pricing.free_starts from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- pure rules
-- ---------------------------------------------------------------------------------------------------------------------------------
-- GST added on top of an amount, rounded to the paisa (half up)
create function pricing.gst_of(p_subtotal bigint) returns bigint language sql immutable set search_path = '' as
$$ select ((p_subtotal * (select s.gst_bps from pricing.settings s) + 5000) / 10000)::bigint $$;

-- units of 30 seconds: 1 to 30 s is one, 31 to 60 s is two; nothing for a call that was not answered
create function pricing.half_minutes_of(p_seconds integer, p_answered boolean) returns integer language sql immutable set search_path = '' as
$$ select case when not coalesce(p_answered, false) or p_seconds is null or p_seconds <= 0 then 0 else ((p_seconds + 29) / 30)::integer end $$;

-- what changing plan mid-period costs or credits: the unused share of the old price taken back, the same share of the new price charged; never below zero
create function pricing.prorate(p_old_paise bigint, p_new_paise bigint, p_days_left integer, p_days_in_period integer) returns bigint language sql immutable set search_path = '' as
$$ select ((p_new_paise - p_old_paise) * greatest(p_days_left, 0) / greatest(p_days_in_period, 1))::bigint $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- who may
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pricing.deny() returns void language plpgsql set search_path = '' as $$ begin raise exception 'not allowed' using errcode = '42501'; end $$;
create function pricing.system_only() returns void language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null or not (app.is_scheduler() or app.is_channel_agent()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;
revoke all on function pricing.deny(), pricing.system_only() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the catalogue and the balance
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.pricing_catalogue() returns jsonb language sql stable security definer set search_path = '' as
$$ select jsonb_build_object(
     'gst_percent', (select round(s.gst_bps / 100.0, 2) from pricing.settings s),
     'free_start_paise', (select s.free_start_paise from pricing.settings s),
     'lot_days', (select s.lot_days from pricing.settings s),
     'plans', (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'monthly_paise', p.monthly_paise, 'yearly_paise', p.yearly_paise, 'included_minutes', p.included_minutes,
                  'rate_paise_per_minute', p.rate_paise_per_minute, 'numbers_included', p.numbers_included, 'lead_finder', p.lead_finder, 'free_searches_month', p.free_searches_month,
                  'extra_search_paise', p.extra_search_paise) order by p.sort) from pricing.plans p)) $$;
revoke all on function public.pricing_catalogue() from public;
grant execute on function public.pricing_catalogue() to authenticated;

create function pricing.balance_of(p_tenant uuid) returns bigint language sql stable set search_path = '' as
$$ select coalesce(sum(l.remaining_paise), 0)::bigint from pricing.wallet_lots l where l.tenant_id = p_tenant and l.expires_at > now() $$;
revoke all on function pricing.balance_of(uuid) from public, anon, authenticated, service_role;

-- the plan whose terms apply: the subscription's, else pay as you go
create function pricing.plan_of(p_tenant uuid) returns pricing.plans language sql stable set search_path = '' as
$$ select p.* from pricing.plans p where p.id = coalesce((select s.plan_id from pricing.subscriptions s where s.tenant_id = p_tenant and s.status <> 'cancelled'), 'payg') $$;
revoke all on function pricing.plan_of(uuid) from public, anon, authenticated, service_role;

create function public.pricing_balance(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_plan pricing.plans;
  v_sub  pricing.subscriptions;
  v_bal  bigint;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform pricing.deny();
  end if;
  v_plan := pricing.plan_of(p_tenant_id);
  select * into v_sub from pricing.subscriptions s where s.tenant_id = p_tenant_id;
  v_bal := pricing.balance_of(p_tenant_id);
  return jsonb_build_object('balance_paise', v_bal, 'plan_id', v_plan.id, 'plan_name', v_plan.name, 'rate_paise_per_minute', v_plan.rate_paise_per_minute,
    'minutes_estimate', case when v_plan.rate_paise_per_minute > 0 then (v_bal / v_plan.rate_paise_per_minute)::integer else 0 end,
    'included_minutes', v_plan.included_minutes,
    'included_half_used', coalesce((select sum(u.included_half) from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'call' and u.at >= coalesce(v_sub.period_start, date_trunc('month', now()))), 0),
    'free_start_granted', exists (select 1 from pricing.free_starts f where f.tenant_id = p_tenant_id),
    'free_start_left_paise', coalesce((select sum(l.remaining_paise) from pricing.wallet_lots l where l.tenant_id = p_tenant_id and l.source = 'free_start' and l.expires_at > now()), 0),
    'subscription', case when v_sub.tenant_id is null then null else jsonb_build_object('interval', v_sub.interval, 'status', v_sub.status, 'period_end', v_sub.period_end,
                      'cancel_at_period_end', v_sub.cancel_at_period_end, 'price_locked_until', v_sub.price_locked_until) end);
end;
$$;
revoke all on function public.pricing_balance(uuid) from public, anon;
grant execute on function public.pricing_balance(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- credits in
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pricing.credit(p_tenant uuid, p_source text, p_ref text, p_amount bigint) returns boolean language plpgsql set search_path = '' as
$$
begin
  insert into pricing.wallet_lots (tenant_id, source, ref, amount_paise, remaining_paise, expires_at)
  values (p_tenant, p_source, p_ref, p_amount, p_amount, now() + make_interval(days => (select s.lot_days from pricing.settings s)))
  on conflict (tenant_id, source, ref) do nothing;
  return found;
end $$;
revoke all on function pricing.credit(uuid, text, text, bigint) from public, anon, authenticated, service_role;

-- the free start: Rs 50 of usage on sign-up, no card; once per workspace and once per verified phone (its keyed hash)
create function public.pricing_free_start_grant(p_tenant_id uuid, p_phone_hash text default null) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_amount bigint := (select s.free_start_paise from pricing.settings s);
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform pricing.deny();
  end if;
  if p_phone_hash is not null and p_phone_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if exists (select 1 from pricing.free_starts f where f.tenant_id = p_tenant_id) then
    return jsonb_build_object('granted', false, 'reason', 'already_granted', 'balance_paise', pricing.balance_of(p_tenant_id));
  end if;
  if p_phone_hash is not null and exists (select 1 from pricing.free_starts f where f.phone_hash = p_phone_hash) then
    return jsonb_build_object('granted', false, 'reason', 'phone_used', 'balance_paise', pricing.balance_of(p_tenant_id));
  end if;
  insert into pricing.free_starts (tenant_id, phone_hash) values (p_tenant_id, p_phone_hash);
  perform pricing.credit(p_tenant_id, 'free_start', 'free_start', v_amount);
  perform app.write_audit_event(p_tenant_id, 'billing.free_start_granted', 'workspace', p_tenant_id, null, jsonb_build_object('paise', v_amount));
  return jsonb_build_object('granted', true, 'reason', null, 'balance_paise', pricing.balance_of(p_tenant_id));
end $$;
revoke all on function public.pricing_free_start_grant(uuid, text) from public, anon;
grant execute on function public.pricing_free_start_grant(uuid, text) to authenticated;

-- an invoice for a payment: GST added on top, numbered, once per payment
create function pricing.invoice(p_tenant uuid, p_kind text, p_ref text, p_subtotal bigint) returns jsonb language plpgsql set search_path = '' as
$$
declare
  v_gst bigint := pricing.gst_of(p_subtotal);
  v_row pricing.invoices;
begin
  insert into pricing.invoices (tenant_id, number, kind, ref, subtotal_paise, gst_paise, total_paise)
  values (p_tenant, 'S19-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('pricing.invoice_seq')::text, 6, '0'), p_kind, p_ref, p_subtotal, v_gst, p_subtotal + v_gst)
  on conflict (tenant_id, kind, ref) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from pricing.invoices i where i.tenant_id = p_tenant and i.kind = p_kind and i.ref = p_ref;
  end if;
  return jsonb_build_object('number', v_row.number, 'subtotal_paise', v_row.subtotal_paise, 'gst_paise', v_row.gst_paise, 'total_paise', v_row.total_paise);
end $$;
revoke all on function pricing.invoice(uuid, text, text, bigint) from public, anon, authenticated, service_role;

-- a top-up paid (the payment provider's signed event, applied by the worker): the BASE amount goes into the wallet, GST is added on top for the invoice; the same payment twice changes nothing
create function public.pricing_topup_credit(p_tenant_id uuid, p_payment_ref text, p_amount_paise bigint) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_new boolean;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_payment_ref is null or p_payment_ref !~ '^[A-Za-z0-9_.:-]{3,100}$' or p_amount_paise is null or p_amount_paise not between 100 and 100000000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_new := pricing.credit(p_tenant_id, 'topup', p_payment_ref, p_amount_paise);
  return jsonb_build_object('credited', v_new, 'balance_paise', pricing.balance_of(p_tenant_id), 'invoice', pricing.invoice(p_tenant_id, 'topup', p_payment_ref, p_amount_paise));
end $$;
revoke all on function public.pricing_topup_credit(uuid, text, bigint) from public, anon;
grant execute on function public.pricing_topup_credit(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- credits out
-- ---------------------------------------------------------------------------------------------------------------------------------
-- spend p_paise from the lots that expire first; returns what could NOT be taken (the shortfall)
create function pricing.spend(p_tenant uuid, p_paise bigint) returns bigint language plpgsql set search_path = '' as
$$
declare
  v_left bigint := p_paise;
  r record;
  v_take bigint;
begin
  for r in select l.id, l.remaining_paise from pricing.wallet_lots l where l.tenant_id = p_tenant and l.remaining_paise > 0 and l.expires_at > now() order by l.expires_at, l.created_at, l.id for update loop
    exit when v_left <= 0;
    v_take := least(r.remaining_paise, v_left);
    update pricing.wallet_lots set remaining_paise = remaining_paise - v_take where id = r.id;
    v_left := v_left - v_take;
  end loop;
  return greatest(v_left, 0);
end $$;
revoke all on function pricing.spend(uuid, bigint) from public, anon, authenticated, service_role;

-- a finished call, billed: per 30 seconds, nothing if unanswered, the included minutes of the plan's period first, then half the plan's per-minute rate per unit. The same call twice changes nothing.
create function public.pricing_charge_call(p_tenant_id uuid, p_call_id uuid, p_seconds integer, p_answered boolean) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_plan  pricing.plans;
  v_sub   pricing.subscriptions;
  v_units integer := pricing.half_minutes_of(p_seconds, p_answered);
  v_used  integer;
  v_incl  integer;
  v_paid  integer;
  v_charge bigint;
  v_short bigint := 0;
  v_row   pricing.usage;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_call_id is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into v_row from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'call' and u.ref = p_call_id;
  if found then
    return jsonb_build_object('charged_paise', v_row.charged_paise, 'half_minutes', v_row.half_minutes, 'included_half', v_row.included_half, 'shortfall_paise', v_row.shortfall_paise, 'replayed', true);
  end if;
  v_plan := pricing.plan_of(p_tenant_id);
  select * into v_sub from pricing.subscriptions s where s.tenant_id = p_tenant_id and s.status <> 'cancelled';
  select coalesce(sum(u.included_half), 0) into v_used from pricing.usage u
   where u.tenant_id = p_tenant_id and u.kind = 'call' and u.at >= coalesce(v_sub.period_start, date_trunc('month', now()));
  v_incl := least(v_units, greatest(v_plan.included_minutes * 2 - v_used, 0));
  v_paid := v_units - v_incl;
  v_charge := v_paid::bigint * (v_plan.rate_paise_per_minute / 2);
  if v_charge > 0 then
    v_short := pricing.spend(p_tenant_id, v_charge);
  end if;
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'call', p_call_id, v_units, v_incl, v_charge, v_short);
  return jsonb_build_object('charged_paise', v_charge, 'half_minutes', v_units, 'included_half', v_incl, 'shortfall_paise', v_short, 'replayed', false);
end $$;
revoke all on function public.pricing_charge_call(uuid, uuid, integer, boolean) from public, anon;
grant execute on function public.pricing_charge_call(uuid, uuid, integer, boolean) to authenticated;

-- may a call start? the plan still has included minutes, or the balance covers at least one minute
create function public.pricing_can_start_call(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_plan pricing.plans;
  v_sub  pricing.subscriptions;
  v_used integer;
begin
  perform pricing.system_only();
  v_plan := pricing.plan_of(p_tenant_id);
  select * into v_sub from pricing.subscriptions s where s.tenant_id = p_tenant_id and s.status <> 'cancelled';
  select coalesce(sum(u.included_half), 0) into v_used from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'call' and u.at >= coalesce(v_sub.period_start, date_trunc('month', now()));
  return jsonb_build_object('allowed', (v_plan.included_minutes * 2 - v_used) > 0 or pricing.balance_of(p_tenant_id) >= v_plan.rate_paise_per_minute, 'balance_paise', pricing.balance_of(p_tenant_id));
end $$;
revoke all on function public.pricing_can_start_call(uuid) from public, anon;
grant execute on function public.pricing_can_start_call(uuid) to authenticated;

-- a Lead Finder search: the first in a calendar month (India) is free; a plan with Lead Finder is unlimited up to its fair-use number; any other costs the plan's extra-search price
create function public.pricing_charge_search(p_tenant_id uuid, p_search_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_plan   pricing.plans;
  v_month  timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_n      integer;
  v_charge bigint := 0;
  v_short  bigint := 0;
  v_row    pricing.usage;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_search_id is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into v_row from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'search' and u.ref = p_search_id;
  if found then
    return jsonb_build_object('charged_paise', v_row.charged_paise, 'free', v_row.charged_paise = 0, 'shortfall_paise', v_row.shortfall_paise, 'replayed', true);
  end if;
  v_plan := pricing.plan_of(p_tenant_id);
  select count(*) into v_n from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'search' and u.at >= v_month;
  if v_n >= v_plan.free_searches_month then
    v_charge := v_plan.extra_search_paise;
    if v_charge = 0 and v_plan.lead_finder then
      raise exception 'fair use limit reached' using errcode = 'SM992';
    end if;
  end if;
  if v_charge > 0 then
    v_short := pricing.spend(p_tenant_id, v_charge);
  end if;
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'search', p_search_id, 0, 0, v_charge, v_short);
  return jsonb_build_object('charged_paise', v_charge, 'free', v_charge = 0, 'shortfall_paise', v_short, 'replayed', false);
end $$;
revoke all on function public.pricing_charge_search(uuid, uuid) from public, anon;
grant execute on function public.pricing_charge_search(uuid, uuid) to authenticated;
