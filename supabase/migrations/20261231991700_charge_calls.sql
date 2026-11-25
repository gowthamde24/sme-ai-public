-- Calls are charged to the wallet (25 Nov 2026; API switch BILLING_CHARGE_CALLS, OFF at deploy). The charge itself (`pricing_charge_call`, 30-second blocks rounded up, nothing for an unanswered call, one rate in and out)
-- existed since 560000 but nothing called it. This migration adds what the API needs around it:
--   1. a small DEBT for an INBOUND call that ran past an empty wallet (the wallet never goes below zero; the shortfall is remembered, up to a floor, pricing.settings.inbound_floor_paise = Rs 50),
--      paid back first by the next top-up; once the debt reaches the floor the assistant stops taking calls with AI (they are refused as billing_blocked) until credits are added;
--   2. `app.wallet_gate(tenant)`: may an OUTBOUND call start (the plan still has included minutes, or the balance covers a minute at the plan rate) and may an INBOUND call be answered (the debt is under the floor);
--      the phone line lookups carry it as `wallet` next to the old `billing_blocked`;
--   3. a billing-exempt workspace (Customer Zero, demos) is never charged and never blocked here;
--   4. `pricing_uncharged_calls`: ended, answered calls that have no charge yet (the worker's reconcile pass); sandbox and simulated calls are never charged.
-- Order of spending (unchanged, stated): the lot that expires first goes first, so the free trial credit is used before a top-up that was bought later.
-- Rollback = the API switch off; the functions are additive (the debts table can be dropped).

alter table pricing.settings add column inbound_floor_paise bigint not null default 5000 check (inbound_floor_paise between 0 and 1000000);

create table pricing.debts (
  tenant_id  uuid primary key references public.tenants (id) on delete restrict,
  owed_paise bigint not null check (owed_paise >= 0),
  updated_at timestamptz not null default now()
);
comment on table pricing.debts is 'What a workspace owes for inbound calls that ran past an empty wallet (never above the floor plus one call). Paid back first by the next credit.';
alter table pricing.debts enable row level security;
alter table pricing.debts force row level security;
revoke all on pricing.debts from public, anon, authenticated, service_role;

-- a credit pays an open debt first (only money someone paid or the operator gave: a top-up, a refund, an adjustment; the free start is used only after, it is never a debt payment)
create or replace function pricing.credit(p_tenant uuid, p_source text, p_ref text, p_amount bigint) returns boolean language plpgsql set search_path = '' as
$$
declare
  v_new boolean;
  v_owed bigint;
  v_pay bigint;
begin
  insert into pricing.wallet_lots (tenant_id, source, ref, amount_paise, remaining_paise, expires_at)
  values (p_tenant, p_source, p_ref, p_amount, p_amount, now() + make_interval(days => (select s.lot_days from pricing.settings s)))
  on conflict (tenant_id, source, ref) do nothing;
  v_new := found;
  if v_new and p_source in ('topup', 'refund', 'adjustment') then
    select d.owed_paise into v_owed from pricing.debts d where d.tenant_id = p_tenant for update;
    if coalesce(v_owed, 0) > 0 then
      v_pay := least(v_owed, p_amount);
      update pricing.wallet_lots set remaining_paise = remaining_paise - v_pay where tenant_id = p_tenant and source = p_source and ref = p_ref;
      update pricing.debts set owed_paise = owed_paise - v_pay, updated_at = now() where tenant_id = p_tenant;
    end if;
  end if;
  return v_new;
end $$;
revoke all on function pricing.credit(uuid, text, text, bigint) from public, anon, authenticated, service_role;

create function app.wallet_gate(p_tenant uuid) returns jsonb language plpgsql stable set search_path = '' as
$$
declare
  v_plan pricing.plans;
  v_sub pricing.subscriptions;
  v_used integer;
  v_owed bigint;
  v_floor bigint := (select s.inbound_floor_paise from pricing.settings s);
begin
  if exists (select 1 from public.tenants t where t.id = p_tenant and t.billing_exempt) then
    return jsonb_build_object('exempt', true, 'outbound_ok', true, 'inbound_ok', true);
  end if;
  v_plan := pricing.plan_of(p_tenant);
  select * into v_sub from pricing.subscriptions s where s.tenant_id = p_tenant and s.status <> 'cancelled';
  select coalesce(sum(u.included_half), 0) into v_used from pricing.usage u where u.tenant_id = p_tenant and u.kind = 'call' and u.at >= coalesce(v_sub.period_start, date_trunc('month', now()));
  select coalesce(d.owed_paise, 0) into v_owed from pricing.debts d where d.tenant_id = p_tenant;
  return jsonb_build_object(
    'exempt', false,
    'outbound_ok', (v_plan.included_minutes * 2 - v_used) > 0 or pricing.balance_of(p_tenant) >= v_plan.rate_paise_per_minute,
    'inbound_ok', coalesce(v_owed, 0) < v_floor);
end $$;
revoke all on function app.wallet_gate(uuid) from public, anon, authenticated, service_role;

-- the phone line lookups carry the wallet's answer (the same guarded patch as the free minutes')
do $patch$
declare
  v_def text := pg_get_functiondef('public.phone_line_find(text)'::regprocedure);
  v_old text := $q$'forward_to', app.free_minutes_forward(n.tenant_id));$q$;
  v_new text := $q$'forward_to', app.free_minutes_forward(n.tenant_id), 'wallet', app.wallet_gate(n.tenant_id));$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'phone_line_find has changed: the wallet patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
do $patch$
declare
  v_def text := pg_get_functiondef('public.phone_line_for_tenant(uuid,text)'::regprocedure);
  v_old text := $q$'forward_to', app.free_minutes_forward(n.tenant_id));$q$;
  v_new text := $q$'forward_to', app.free_minutes_forward(n.tenant_id), 'wallet', app.wallet_gate(n.tenant_id));$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'phone_line_for_tenant has changed: the wallet patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- the charge, now exempt-aware and debt-aware (same signature and answer as before, plus a closed `skipped` word)
create or replace function public.pricing_charge_call(p_tenant_id uuid, p_call_id uuid, p_seconds integer, p_answered boolean) returns jsonb language plpgsql security definer set search_path = '' as
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
  v_call  public.phone_calls;
  v_have  boolean;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_call_id is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into v_row from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'call' and u.ref = p_call_id;
  if found then
    return jsonb_build_object('charged_paise', v_row.charged_paise, 'half_minutes', v_row.half_minutes, 'included_half', v_row.included_half, 'shortfall_paise', v_row.shortfall_paise, 'replayed', true);
  end if;
  select * into v_call from public.phone_calls c where c.tenant_id = p_tenant_id and c.id = p_call_id;
  v_have := found;
  if v_have and (v_call.sandbox or v_call.simulated) then   -- tests, practice and the browser's demo call are free: no row at all
    return jsonb_build_object('charged_paise', 0, 'half_minutes', 0, 'included_half', 0, 'shortfall_paise', 0, 'replayed', false, 'skipped', 'test_call');
  end if;
  if exists (select 1 from public.tenants t where t.id = p_tenant_id and t.billing_exempt) then
    return jsonb_build_object('charged_paise', 0, 'half_minutes', 0, 'included_half', 0, 'shortfall_paise', 0, 'replayed', false, 'skipped', 'exempt');
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
  if v_short > 0 and v_have and v_call.direction = 'inbound' then   -- only a call we were obliged to answer may leave a debt; an outbound call was checked before it started
    insert into pricing.debts (tenant_id, owed_paise) values (p_tenant_id, v_short)
    on conflict (tenant_id) do update set owed_paise = pricing.debts.owed_paise + excluded.owed_paise, updated_at = now();
  end if;
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'call', p_call_id, v_units, v_incl, v_charge, v_short);
  return jsonb_build_object('charged_paise', v_charge, 'half_minutes', v_units, 'included_half', v_incl, 'shortfall_paise', v_short, 'replayed', false);
end $$;
revoke all on function public.pricing_charge_call(uuid, uuid, integer, boolean) from public, anon;
grant execute on function public.pricing_charge_call(uuid, uuid, integer, boolean) to authenticated;

-- the worker's reconcile pass: answered calls that ended at least two minutes ago and have no charge row yet (a charge that failed, or a call the server died on)
create function public.pricing_uncharged_calls(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  perform pricing.system_only();
  return coalesce((
    select jsonb_agg(jsonb_build_object('tenant_id', x.tenant_id, 'call_id', x.id, 'seconds', x.duration_s))
      from (select c.tenant_id, c.id, c.duration_s
              from public.phone_calls c
             where c.answered_at is not null and c.duration_s > 0 and c.ended_at is not null and c.ended_at < now() - interval '2 minutes' and c.ended_at > now() - interval '30 days'
               and not c.sandbox and not c.simulated
               and not exists (select 1 from pricing.usage u where u.tenant_id = c.tenant_id and u.kind = 'call' and u.ref = c.id)
               and not exists (select 1 from public.tenants t where t.id = c.tenant_id and t.billing_exempt)
             order by c.ended_at limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb);
end $$;
revoke all on function public.pricing_uncharged_calls(integer) from public, anon;
grant execute on function public.pricing_uncharged_calls(integer) to authenticated;
