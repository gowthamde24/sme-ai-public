-- Job DS part E2 (night 4, ADR 0114): migration 2 of 3: the meter learns top-ups, overage and the projected run-out; invoices; purchase; auto top-up; the upgrade.
-- Job DI's meter functions (20261127090200) are extended, not copied: `app.billing_meter` is renamed `billing_meter_base` and wrapped, `app.billing_allowance`, `app.billing_stopped` and `app.billing_record`
-- are re-created (same names, same signatures). Everything here is SECURITY DEFINER with an empty search_path and closed to every client role; the public doors are in migration 3.

create function app.topup_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'used'      then raise exception 'that purchase id was used for another pack' using errcode = 'SM831';
    when 'pack'      then raise exception 'unknown pack' using errcode = 'SM832';
    when 'nosub'     then raise exception 'there is no plan to attach this to' using errcode = 'SM833';
    when 'cap'       then raise exception 'a monthly cap is required' using errcode = 'SM834';
    when 'upgrade'   then raise exception 'not an upgrade' using errcode = 'SM835';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.topup_error(text) from public;

-- ledger units: seconds for call minutes, messages for messages
create function app.topup_mult(p_kind text) returns integer
language sql
immutable
set search_path = ''
as $$ select case p_kind when 'call_minutes' then 60 else 1 end $$;
revoke all on function app.topup_mult(text) from public;

create function app.topup_cfg() returns billing.topup_config
language sql
stable
security definer
set search_path = ''
as $$ select c.* from billing.topup_config c limit 1 $$;
revoke all on function app.topup_cfg() from public, anon, authenticated, service_role;

-- a period for ANY day (a copy of job AK's window with the day as a parameter): used to close the period that just ended
create function app.billing_period_at(p_tenant uuid, p_day date, out o_start date, out o_end date) returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_anchor date;
  n        integer;
begin
  select (coalesce(t.billing_anchor_at, t.trial_started_at) at time zone 'Asia/Kolkata')::date into v_anchor from public.tenants t where t.id = p_tenant;
  if v_anchor is null then
    v_anchor := p_day;
  end if;
  n := greatest(0, (extract(year from p_day)::integer - extract(year from v_anchor)::integer) * 12 + extract(month from p_day)::integer - extract(month from v_anchor)::integer);
  while n > 0 and (v_anchor + make_interval(months => n))::date > p_day loop
    n := n - 1;
  end loop;
  o_start := (v_anchor + make_interval(months => n))::date;
  o_end   := (v_anchor + make_interval(months => n + 1))::date;
end;
$$;
revoke all on function app.billing_period_at(uuid, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. what the plan gives, what top-ups give, the allowance
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the plan's own part plus the operator's top-ups of the period (job DI's ledger), in ledger units; null = pay as you go
create function app.billing_base_total(p_tenant uuid, p_kind text) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pv billing.plan_versions := app.billing_plan_row(p_tenant);
  w  record;
  v_base bigint;
  v_top  bigint;
begin
  if pv.plan_id is null then
    return 0;   -- no plan row: fail closed
  end if;
  v_base := case p_kind when 'call_minutes' then pv.call_minutes::bigint * 60 else pv.whatsapp_messages::bigint end;
  if v_base is null then
    return null;
  end if;
  select * into w from app.billing_period(p_tenant);
  select coalesce(sum(x.units), 0) * app.topup_mult(p_kind) into v_top
    from public.billing_topups x
   where x.tenant_id = p_tenant and x.kind = p_kind
     and (x.at at time zone 'Asia/Kolkata')::date >= w.o_start and (x.at at time zone 'Asia/Kolkata')::date < w.o_end;
  return v_base + v_top;
end;
$$;
revoke all on function app.billing_base_total(uuid, text) from public, anon, authenticated, service_role;

-- the plan's part alone
create function app.billing_plan_units(p_tenant uuid, p_kind text) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind when 'call_minutes' then pv.call_minutes::bigint * 60 else pv.whatsapp_messages::bigint end from app.billing_plan_row(p_tenant) pv
$$;
revoke all on function app.billing_plan_units(uuid, text) from public, anon, authenticated, service_role;

-- unused, unexpired top-up units now (ledger units)
create function app.topup_balance(p_tenant uuid, p_kind text) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(greatest(p.units::bigint * app.topup_mult(p_kind) - coalesce((select sum(d.units) from public.billing_topup_draws d where d.tenant_id = p.tenant_id and d.purchase_id = p.id), 0), 0)), 0)::bigint
    from public.billing_topup_purchases p
   where p.tenant_id = p_tenant and p.kind = p_kind and p.expires_at > app.outbox_now()
$$;
revoke all on function app.topup_balance(uuid, text) from public, anon, authenticated, service_role;

-- units the packs gave to this period's usage (ledger units)
create function app.topup_drawn(p_tenant uuid, p_kind text) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(d.units), 0)::bigint
    from public.billing_topup_draws d, app.billing_period(p_tenant) w
   where d.tenant_id = p_tenant and d.kind = p_kind
     and (d.at at time zone 'Asia/Kolkata')::date >= w.o_start and (d.at at time zone 'Asia/Kolkata')::date < w.o_end
$$;
revoke all on function app.topup_drawn(uuid, text) from public, anon, authenticated, service_role;

-- the allowance of a kind: the plan (and the operator's top-ups) + what the packs already gave this period + what is still unused and unexpired; null = no ceiling
create or replace function app.billing_allowance(p_tenant uuid, p_kind text) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base bigint := app.billing_base_total(p_tenant, p_kind);
begin
  if v_base is null then
    return null;
  end if;
  return v_base + app.topup_drawn(p_tenant, p_kind) + app.topup_balance(p_tenant, p_kind);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. overage: units beyond the plan and every pack, billed per unit up to a monthly cap (OFF by default)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.topup_unfunded(p_tenant uuid, p_kind text) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when b.v is null then 0 else greatest(app.billing_used(p_tenant, p_kind) - b.v - app.topup_drawn(p_tenant, p_kind), 0) end
    from (select app.billing_base_total(p_tenant, p_kind) as v) b
$$;
revoke all on function app.topup_unfunded(uuid, text) from public, anon, authenticated, service_role;

create function app.topup_overage_on(p_tenant uuid, p_kind text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case p_kind when 'call_minutes' then s.overage_minutes else s.overage_messages end and s.overage_monthly_cap_paise > 0
                     from public.billing_topup_settings s where s.tenant_id = p_tenant), false)
$$;
revoke all on function app.topup_overage_on(uuid, text) from public, anon, authenticated, service_role;

-- paise per unit: the plan's pay-as-you-go rate when the owner of the product set one, else the placeholder in the configuration
create function app.topup_overage_rate(p_tenant uuid, p_kind text) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(case p_kind when 'call_minutes' then pv.price_paise_per_minute else pv.price_paise_per_message end,
                  case p_kind when 'call_minutes' then c.overage_paise_per_minute else c.overage_paise_per_message end)
    from billing.topup_config c left join lateral (select * from app.billing_plan_row(p_tenant)) pv on true
$$;
revoke all on function app.topup_overage_rate(uuid, text) from public, anon, authenticated, service_role;

-- what the overage of a kind has cost so far this period, whole paise (a started minute counts as a minute)
create function app.topup_overage_cost(p_tenant uuid, p_kind text) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.topup_overage_on(p_tenant, p_kind)
              then ((app.topup_unfunded(p_tenant, p_kind) + app.topup_mult(p_kind) - 1) / app.topup_mult(p_kind)) * app.topup_overage_rate(p_tenant, p_kind) else 0 end
$$;
revoke all on function app.topup_overage_cost(uuid, text) from public, anon, authenticated, service_role;

create function app.topup_overage_spent(p_tenant uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select app.topup_overage_cost(p_tenant, 'call_minutes') + app.topup_overage_cost(p_tenant, 'whatsapp_messages') $$;
revoke all on function app.topup_overage_spent(uuid) from public, anon, authenticated, service_role;

create function app.topup_overage_open(p_tenant uuid, p_kind text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.topup_overage_on(p_tenant, p_kind)
         and app.topup_overage_spent(p_tenant) < (select s.overage_monthly_cap_paise from public.billing_topup_settings s where s.tenant_id = p_tenant)
$$;
revoke all on function app.topup_overage_open(uuid, text) from public, anon, authenticated, service_role;

-- is a new unit of this kind really impossible now? (the meter is used up and no overage covers it); the platform switch is NOT part of this: billing_stopped adds it
create function app.billing_blocked(p_tenant uuid, p_kind text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.billing_state(app.billing_used(p_tenant, p_kind), app.billing_allowance(p_tenant, p_kind)) = 'stopped' and not app.topup_overage_open(p_tenant, p_kind)
$$;
revoke all on function app.billing_blocked(uuid, text) from public, anon, authenticated, service_role;

create or replace function app.billing_stopped(p_tenant uuid, p_kind text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.billing_enforced() and app.billing_blocked(p_tenant, p_kind)
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the projected run-out (India dates) and the meter with its new fields
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.topup_projection(p_tenant uuid, p_kind text) returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_allow bigint := app.billing_allowance(p_tenant, p_kind);
  v_used  bigint := app.billing_used(p_tenant, p_kind);
  w       record;
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_days  bigint;
  v_out   date;
begin
  if v_allow is null or v_used <= 0 then
    return null;
  end if;
  select * into w from app.billing_period(p_tenant);
  if v_used >= v_allow then
    return v_today;
  end if;
  v_days := (v_allow - v_used) * greatest(1, v_today - w.o_start + 1) / v_used;   -- whole days the rest lasts at this period's pace
  v_out := v_today + least(v_days, 4000)::integer;
  return case when v_out < w.o_end then v_out end;
end;
$$;
revoke all on function app.topup_projection(uuid, text) from public, anon, authenticated, service_role;

alter function app.billing_meter(uuid, text) rename to billing_meter_base;

create function app.billing_meter(p_tenant uuid, p_kind text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m        jsonb := app.billing_meter_base(p_tenant, p_kind);
  v_mult   numeric := app.topup_mult(p_kind);
  v_plan   bigint := app.billing_plan_units(p_tenant, p_kind);
  v_bal    bigint := app.topup_balance(p_tenant, p_kind);
  v_blocked boolean := app.billing_enforced() and app.billing_blocked(p_tenant, p_kind);
  v_state  text := m ->> 'state';
  v_proj   date := app.topup_projection(p_tenant, p_kind);
  v_exp    date;
  v_over   jsonb := null;
  v_cap    bigint;
  v_queued bigint;
begin
  if v_state = 'stopped' and app.topup_overage_open(p_tenant, p_kind) then
    v_state := 'notice';   -- the overage covers it until its monthly cap
  end if;
  select min((p.expires_at at time zone 'Asia/Kolkata')::date) into v_exp
    from public.billing_topup_purchases p
   where p.tenant_id = p_tenant and p.kind = p_kind and p.expires_at > app.outbox_now()
     and p.units::bigint * app.topup_mult(p_kind) > coalesce((select sum(d.units) from public.billing_topup_draws d where d.tenant_id = p.tenant_id and d.purchase_id = p.id), 0);
  if app.topup_overage_on(p_tenant, p_kind) then
    select s.overage_monthly_cap_paise into v_cap from public.billing_topup_settings s where s.tenant_id = p_tenant;
    v_over := jsonb_build_object('enabled', true, 'units', round(app.topup_unfunded(p_tenant, p_kind) / v_mult, 1), 'spent_paise', app.topup_overage_spent(p_tenant), 'cap_paise', v_cap,
                                 'rate_paise_per_unit', app.topup_overage_rate(p_tenant, p_kind));
  end if;
  if p_kind = 'call_minutes' then
    select count(*) into v_queued from public.outreach_items i where i.tenant_id = p_tenant and i.status = 'waiting_for_minutes';
  elsif v_blocked then
    select count(*) into v_queued from public.outbox_messages o where o.tenant_id = p_tenant and o.status = 'queued' and o.category <> 'reply_to_inbound';
  else
    v_queued := 0;
  end if;
  return m || jsonb_build_object(
    'state', v_state,
    'plan_allowance', case when v_plan is null then null else (v_plan / v_mult)::integer end,
    'topup_balance', round(v_bal / v_mult, 1),
    'next_topup_expiry', v_exp,
    'projected_run_out_on', v_proj,
    'runs_out_before_period_end', v_proj is not null,
    'blocked', v_blocked,
    'overage', v_over,
    'queued', v_queued);
end;
$$;
revoke all on function app.billing_meter(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. invoices (fake) with GST in whole paise
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.topup_gst(p_taxable bigint) returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select (p_taxable * (select c.gst_rate_bp from billing.topup_config c) + 5000) / 10000 $$;   -- half up
revoke all on function app.topup_gst(bigint) from public, anon, authenticated, service_role;

create function app.invoice_make(p_tenant uuid, p_kind text, p_description text, p_taxable bigint, p_period date) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c       billing.topup_config := app.topup_cfg();
  v_gstin text;
  v_state text;
  v_gst   bigint := app.topup_gst(p_taxable);
  v_cgst  bigint := 0;
  v_sgst  bigint := 0;
  v_igst  bigint := 0;
  v_serial integer;
  v_now   timestamptz := app.outbox_now();
  v_id    uuid := gen_random_uuid();
begin
  perform 1 from public.tenants t where t.id = p_tenant for update;   -- numbers are handed out one at a time
  select b.gstin into v_gstin from public.business_profile b where b.tenant_id = p_tenant;
  v_state := case when v_gstin is not null then left(v_gstin, 2) end;
  if v_state is not null and v_state = c.seller_state_code then
    v_cgst := v_gst / 2;
    v_sgst := v_gst - v_cgst;
  else
    v_igst := v_gst;
  end if;
  select count(*) + 1 into v_serial from public.billing_invoices i where i.tenant_id = p_tenant;
  insert into public.billing_invoices (id, tenant_id, number, kind, description, period_start, taxable_paise, gst_rate_bp, cgst_paise, sgst_paise, igst_paise, total_paise,
                                       seller_name, seller_state_code, seller_gstin, buyer_gstin, buyer_state_code, fake, payment_status, issued_at)
  values (v_id, p_tenant, 'S19-' || to_char(v_now at time zone 'Asia/Kolkata', 'YYMM') || '-' || lpad(v_serial::text, 6, '0'), p_kind, p_description, p_period, p_taxable, c.gst_rate_bp, v_cgst, v_sgst, v_igst,
          p_taxable + v_gst, c.seller_name, c.seller_state_code, c.seller_gstin, v_gstin, v_state, true, 'paid_fake', v_now);
  return v_id;
end;
$$;
revoke all on function app.invoice_make(uuid, text, text, bigint, date) from public, anon, authenticated, service_role;

create function app.invoice_json(i public.billing_invoices) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'number', i.number, 'kind', i.kind, 'description', i.description, 'issued_at', i.issued_at, 'period_start', i.period_start,
    'taxable_paise', i.taxable_paise, 'gst_rate_bp', i.gst_rate_bp, 'cgst_paise', i.cgst_paise, 'sgst_paise', i.sgst_paise, 'igst_paise', i.igst_paise, 'total_paise', i.total_paise,
    'seller', jsonb_build_object('name', i.seller_name, 'state_code', i.seller_state_code, 'gstin', i.seller_gstin),
    'buyer', jsonb_build_object('gstin', i.buyer_gstin, 'state_code', i.buyer_state_code),
    'fake', i.fake, 'payment_status', i.payment_status)
$$;
revoke all on function app.invoice_json(public.billing_invoices) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. buying a pack (manual by the Owner, or automatic); queued calls come back
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.topup_requeue(p_tenant uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.outreach_items set status = 'waiting' where tenant_id = p_tenant and status = 'waiting_for_minutes';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function app.topup_requeue(uuid) from public, anon, authenticated, service_role;

create function app.topup_purchase_json(p public.billing_topup_purchases) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'pack_code', p.pack_code, 'kind', p.kind, 'units', p.units, 'source', p.source, 'price_paise', p.price_paise,
    'total_paise', (select i.total_paise from public.billing_invoices i where i.tenant_id = p.tenant_id and i.id = p.invoice_id),
    'purchased_at', p.purchased_at, 'expires_at', p.expires_at,
    'units_left', round(greatest(p.units::bigint * app.topup_mult(p.kind) - coalesce((select sum(d.units) from public.billing_topup_draws d where d.tenant_id = p.tenant_id and d.purchase_id = p.id), 0), 0)::numeric / app.topup_mult(p.kind), 1),
    'expired', p.expires_at <= app.outbox_now(), 'invoice_id', p.invoice_id)
$$;
revoke all on function app.topup_purchase_json(public.billing_topup_purchases) from public, anon, authenticated, service_role;

create function app.topup_buy(p_tenant uuid, p_id uuid, p_pack text, p_source text, p_actor uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pk  billing.topup_packs;
  c   billing.topup_config := app.topup_cfg();
  ex  public.billing_topup_purchases;
  v_inv uuid;
  v_now timestamptz := app.outbox_now();
  p   public.billing_topup_purchases;
begin
  select * into pk from billing.topup_packs x where x.code = p_pack;
  if not found then
    perform app.topup_error('pack');
  end if;
  select * into ex from public.billing_topup_purchases x where x.tenant_id = p_tenant and x.id = p_id;
  if found then
    if ex.pack_code <> p_pack then
      perform app.topup_error('used');
    end if;
    return jsonb_build_object('created', false, 'purchase', app.topup_purchase_json(ex), 'invoice', (select app.invoice_json(i) from public.billing_invoices i where i.tenant_id = ex.tenant_id and i.id = ex.invoice_id));
  end if;
  if not exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant and s.status in ('trial_pending', 'trialing', 'active')) then
    perform app.topup_error('nosub');
  end if;
  v_inv := app.invoice_make(p_tenant, 'topup', 'Top-up: ' || pk.units || case pk.kind when 'call_minutes' then ' call minutes' else ' business messages' end, pk.price_paise, null);
  insert into public.billing_topup_purchases (id, tenant_id, pack_code, kind, units, price_paise, invoice_id, source, purchased_at, expires_at, created_by)
  values (p_id, p_tenant, pk.code, pk.kind, pk.units, pk.price_paise, v_inv, p_source, v_now, v_now + make_interval(days => c.expiry_days), p_actor) returning * into p;
  perform app.topup_requeue(p_tenant);
  return jsonb_build_object('created', true, 'purchase', app.topup_purchase_json(p), 'invoice', (select app.invoice_json(i) from public.billing_invoices i where i.tenant_id = p.tenant_id and i.id = p.invoice_id));
end;
$$;
revoke all on function app.topup_buy(uuid, uuid, text, text, uuid) from public, anon, authenticated, service_role;

-- automatic top-up: the kind is used up, the setting is on, the month's automatic purchases plus this pack (GST included) stay within the cap, and there is a plan with a payment method on file
create function app.topup_auto(p_tenant uuid, p_kind text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s      public.billing_topup_settings;
  v_pack text;
  pk     billing.topup_packs;
  v_total bigint;
  v_spent bigint;
  v_n    integer;
  w      record;
  i      integer := 0;
begin
  select * into s from public.billing_topup_settings x where x.tenant_id = p_tenant;
  if not found or s.auto_monthly_cap_paise <= 0 then
    return;
  end if;
  v_pack := case p_kind when 'call_minutes' then s.auto_minutes_pack else s.auto_messages_pack end;
  if v_pack is null then
    return;
  end if;
  select * into pk from billing.topup_packs x where x.code = v_pack and x.kind = p_kind;
  if not found or not exists (select 1 from public.billing_subscriptions b where b.tenant_id = p_tenant and b.status in ('trial_pending', 'trialing', 'active') and b.payment_method_on_file) then
    return;
  end if;
  select * into w from app.billing_period(p_tenant);
  v_total := pk.price_paise + app.topup_gst(pk.price_paise);
  while i < 3 loop
    i := i + 1;
    if app.billing_allowance(p_tenant, p_kind) is null or app.billing_used(p_tenant, p_kind) < app.billing_allowance(p_tenant, p_kind) then
      return;
    end if;
    select coalesce(sum(inv.total_paise), 0), count(*) into v_spent, v_n
      from public.billing_topup_purchases p join public.billing_invoices inv on inv.tenant_id = p.tenant_id and inv.id = p.invoice_id
     where p.tenant_id = p_tenant and p.source = 'auto' and (p.purchased_at at time zone 'Asia/Kolkata')::date >= w.o_start and (p.purchased_at at time zone 'Asia/Kolkata')::date < w.o_end;
    if v_spent + v_total > s.auto_monthly_cap_paise then
      return;
    end if;
    perform app.topup_buy(p_tenant, md5('auto:' || p_tenant::text || ':' || p_kind || ':' || w.o_start::text || ':' || (v_n + 1)::text)::uuid, v_pack, 'auto', null);
  end loop;
end;
$$;
revoke all on function app.topup_auto(uuid, text) from public, anon, authenticated, service_role;

-- usage is recorded: the ledger row, then the units the plan could not cover are drawn from the oldest unexpired pack, then an automatic top-up if the kind is used up, then the 80 and 100 percent notices
create or replace function app.billing_record(p_tenant uuid, p_kind text, p_ref uuid, p_units integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allow bigint;
  v_used  bigint;
  v_base  bigint;
  v_need  bigint;
  v_take  bigint;
  x       record;
  w       record;
begin
  insert into public.billing_usage_events (tenant_id, kind, ref_id, units) values (p_tenant, p_kind, p_ref, p_units) on conflict do nothing;
  if found then
    perform pg_advisory_xact_lock(hashtextextended('topup:' || p_tenant::text || ':' || p_kind, 0));
    v_base := app.billing_base_total(p_tenant, p_kind);
    if v_base is not null then
      v_need := app.billing_used(p_tenant, p_kind) - v_base - app.topup_drawn(p_tenant, p_kind);
      if v_need > 0 then
        for x in select p.id, greatest(p.units::bigint * app.topup_mult(p_kind) - coalesce((select sum(d.units) from public.billing_topup_draws d where d.tenant_id = p.tenant_id and d.purchase_id = p.id), 0), 0) as left_units
                   from public.billing_topup_purchases p
                  where p.tenant_id = p_tenant and p.kind = p_kind and p.expires_at > app.outbox_now()
                  order by p.purchased_at, p.id loop
          exit when v_need <= 0;
          continue when x.left_units <= 0;
          v_take := least(x.left_units, v_need);
          insert into public.billing_topup_draws (tenant_id, purchase_id, kind, units) values (p_tenant, x.id, p_kind, v_take);
          v_need := v_need - v_take;
        end loop;
      end if;
      perform app.topup_auto(p_tenant, p_kind);
    end if;
    v_allow := app.billing_allowance(p_tenant, p_kind);
    v_used  := app.billing_used(p_tenant, p_kind);
    if v_allow is not null and v_allow > 0 then
      select * into w from app.billing_period(p_tenant);
      if v_used * 100 >= v_allow * 80 then
        insert into public.billing_notices (tenant_id, kind, level, period_start) values (p_tenant, p_kind, 80, w.o_start) on conflict do nothing;
      end if;
      if v_used >= v_allow then
        insert into public.billing_notices (tenant_id, kind, level, period_start) values (p_tenant, p_kind, 100, w.o_start) on conflict do nothing;
      end if;
    end if;
  end if;
  return app.billing_meter(p_tenant, p_kind);
end;
$$;
