-- PRICING V3, part 3 (the rules that write): charging a call, a Lead Finder search and a WhatsApp message from the ONE rupee wallet; the queue for a call that cannot start; the optional spending limit per
-- feature; the optional automatic top-up; the business numbers (1 included, Rs 299 a month for each extra, a released number held 30 days); the 80 % / 100 % warnings given once.
-- Who may: the system accounts (scheduler, channel agent; the billing webhook account for a payment) report usage and ask the gate; the Owner sets the limits, the auto top-up and the numbers.
-- Every charge is idempotent per call / search / message / number-month id. A workspace on early_access is charged NOTHING (its usage is still recorded); Lead Finder searches for it are counted by
-- the early-access meter (billing.plan_overrides), which this file does not touch.
-- Closed SQLSTATEs: SM993 the spending limit of the feature is reached, SM994 the wallet cannot pay for it, SM995 the workspace is read-only.

create function pricing.v3_lock(p_tenant uuid) returns void language plpgsql set search_path = '' as
$$ begin perform pg_advisory_xact_lock(hashtextextended('pricing3:' || p_tenant::text, 0)); end $$;
revoke all on function pricing.v3_lock(uuid) from public, anon, authenticated, service_role;

-- refuse with the closed word of the gate's reason
create function pricing.v3_refuse(p_gate jsonb) returns void language plpgsql set search_path = '' as
$$
begin
  if (p_gate ->> 'allowed')::boolean then
    return;
  end if;
  case p_gate ->> 'reason'
    when 'limit_reached' then raise exception 'spending limit reached' using errcode = 'SM993';
    when 'wallet_empty' then raise exception 'wallet empty' using errcode = 'SM994';
    else raise exception 'workspace read-only' using errcode = 'SM995';
  end case;
end $$;
revoke all on function pricing.v3_refuse(jsonb) from public, anon, authenticated, service_role;

-- the Rs 299 of an extra number's month: checks the limit and the wallet FIRST, then takes it
create function pricing.v3_take_extra(p_tenant uuid, p_ref uuid) returns bigint language plpgsql set search_path = '' as
$$
declare
  v_price bigint := (select s.extra_number_paise from pricing.settings_v3 s);
  v_lim   bigint := pricing.v3_limit_of(p_tenant, 'numbers');
begin
  if v_lim is not null and pricing.v3_spent(p_tenant, 'number') + v_price > v_lim then
    raise exception 'spending limit reached' using errcode = 'SM993';
  end if;
  if pricing.balance_of(p_tenant) < v_price then
    raise exception 'wallet empty' using errcode = 'SM994';
  end if;
  perform pricing.spend(p_tenant, v_price);
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant, 'number', p_ref, 0, 0, v_price, 0);
  return v_price;
end $$;
revoke all on function pricing.v3_take_extra(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- usage, charged from the wallet
-- ---------------------------------------------------------------------------------------------------------------------------------
-- a finished call: per 30 seconds; unanswered = Rs 0; the plan's included minutes of the window first, then Rs 5 a minute (half per unit). The same call twice changes nothing.
create function public.pricing_v3_charge_call(p_tenant_id uuid, p_call_id uuid, p_seconds integer, p_answered boolean) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  t        pricing.plan_terms;
  v_units  integer := pricing.half_minutes_of(p_seconds, p_answered);
  v_used   integer;
  v_incl   integer;
  v_charge bigint;
  v_short  bigint := 0;
  v_row    pricing.usage;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_call_id is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  select * into v_row from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'call' and u.ref = p_call_id;
  if found then
    return jsonb_build_object('charged_paise', v_row.charged_paise, 'billed_half_minutes', v_row.half_minutes, 'included_half', v_row.included_half, 'shortfall_paise', v_row.shortfall_paise, 'replayed', true);
  end if;
  if pricing.v3_exempt(p_tenant_id) then   -- free early access: counted, never charged
    insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'call', p_call_id, v_units, v_units, 0, 0);
    return jsonb_build_object('charged_paise', 0, 'billed_half_minutes', v_units, 'included_half', v_units, 'shortfall_paise', 0, 'replayed', false);
  end if;
  t := pricing.v3_terms(p_tenant_id);
  select coalesce(sum(u.included_half), 0) into v_used from pricing.usage u
   where u.tenant_id = p_tenant_id and u.kind = 'call' and u.at >= (select w.w_start from pricing.v3_window(p_tenant_id) w);
  v_incl := least(v_units, greatest(t.included_minutes * 2 - v_used, 0));
  v_charge := (v_units - v_incl)::bigint * (t.minute_paise / 2);
  if v_charge > 0 then
    v_short := pricing.spend(p_tenant_id, v_charge);
  end if;
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'call', p_call_id, v_units, v_incl, v_charge, v_short);
  return jsonb_build_object('charged_paise', v_charge, 'billed_half_minutes', v_units, 'included_half', v_incl, 'shortfall_paise', v_short, 'replayed', false);
end $$;
revoke all on function public.pricing_v3_charge_call(uuid, uuid, integer, boolean) from public, anon;
grant execute on function public.pricing_v3_charge_call(uuid, uuid, integer, boolean) to authenticated;

-- a Lead Finder search (asked BEFORE it runs): the plan's free searches of the window (2 / 10 / 100), then Rs 49 / 39 / 29 from the wallet. Refused (SM993, SM994, SM995) when the limit is reached, the
-- wallet cannot pay or the workspace is read-only; a free search is never refused for money.
create function public.pricing_v3_charge_search(p_tenant_id uuid, p_search_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  t        pricing.plan_terms;
  v_n      integer;
  v_charge bigint := 0;
  v_row    pricing.usage;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_search_id is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  select * into v_row from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'search' and u.ref = p_search_id;
  if found then
    return jsonb_build_object('charged_paise', v_row.charged_paise, 'free', v_row.charged_paise = 0, 'replayed', true);
  end if;
  if pricing.v3_exempt(p_tenant_id) then
    insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'search', p_search_id, 0, 0, 0, 0);
    return jsonb_build_object('charged_paise', 0, 'free', true, 'replayed', false);
  end if;
  perform pricing.v3_refuse(pricing.v3_gate(p_tenant_id, 'lead_finder'));
  t := pricing.v3_terms(p_tenant_id);
  select count(*) into v_n from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'search' and u.at >= (select w.w_start from pricing.v3_window(p_tenant_id) w);
  if v_n >= t.free_searches_month then
    v_charge := t.search_paise;
    perform pricing.spend(p_tenant_id, v_charge);
  end if;
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'search', p_search_id, 0, 0, v_charge, 0);
  return jsonb_build_object('charged_paise', v_charge, 'free', v_charge = 0, 'replayed', false);
end $$;
revoke all on function public.pricing_v3_charge_search(uuid, uuid) from public, anon;
grant execute on function public.pricing_v3_charge_search(uuid, uuid) to authenticated;

-- a business-initiated WhatsApp message, at Meta's own cost (the caller reports the cost in paise; no mark-up is added here, ever). A reply inside the 24-hour window costs nothing (report 0).
create function public.pricing_v3_charge_whatsapp(p_tenant_id uuid, p_message_id uuid, p_cost_paise bigint) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_charge bigint;
  v_short  bigint := 0;
  v_row    pricing.usage;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_message_id is null or p_cost_paise is null or p_cost_paise not between 0 and 1000000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  select * into v_row from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'whatsapp' and u.ref = p_message_id;
  if found then
    return jsonb_build_object('charged_paise', v_row.charged_paise, 'shortfall_paise', v_row.shortfall_paise, 'replayed', true);
  end if;
  v_charge := case when pricing.v3_exempt(p_tenant_id) then 0 else p_cost_paise end;
  if v_charge > 0 then
    v_short := pricing.spend(p_tenant_id, v_charge);
  end if;
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'whatsapp', p_message_id, 0, 0, v_charge, v_short);
  return jsonb_build_object('charged_paise', v_charge, 'shortfall_paise', v_short, 'replayed', false);
end $$;
revoke all on function public.pricing_v3_charge_whatsapp(uuid, uuid, bigint) from public, anon;
grant execute on function public.pricing_v3_charge_whatsapp(uuid, uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the gate, and the queue for calls
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.pricing_v3_feature_gate(p_tenant_id uuid, p_feature text) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_feature not in ('calls', 'lead_finder', 'numbers', 'whatsapp') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return pricing.v3_gate(p_tenant_id, p_feature);
end $$;
revoke all on function public.pricing_v3_feature_gate(uuid, text) from public, anon;
grant execute on function public.pricing_v3_feature_gate(uuid, text) to authenticated;

-- may this call start? If not, it is QUEUED (once per call ref), never a lost lead
create function public.pricing_v3_call_gate(p_tenant_id uuid, p_call_ref uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  g jsonb;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_call_ref is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  g := pricing.v3_gate(p_tenant_id, 'calls');
  if (g ->> 'allowed')::boolean then
    update pricing.queued_calls q set status = 'released', resolved_at = now() where q.tenant_id = p_tenant_id and q.ref = p_call_ref and q.status = 'queued';
    return jsonb_build_object('allowed', true, 'queued', false, 'reason', null, 'balance_paise', g -> 'balance_paise');
  end if;
  insert into pricing.queued_calls (tenant_id, ref, reason) values (p_tenant_id, p_call_ref, g ->> 'reason')
  on conflict (tenant_id, ref) do update set reason = excluded.reason, status = 'queued', resolved_at = null, created_at = case when pricing.queued_calls.status = 'queued' then pricing.queued_calls.created_at else now() end;
  return jsonb_build_object('allowed', false, 'queued', true, 'reason', g ->> 'reason', 'balance_paise', g -> 'balance_paise');
end $$;
revoke all on function public.pricing_v3_call_gate(uuid, uuid) from public, anon;
grant execute on function public.pricing_v3_call_gate(uuid, uuid) to authenticated;

-- the queued calls that may run now (oldest first, no more than the wallet and the included minutes can start); calls waiting longer than 7 days are let go
create function public.pricing_v3_queue_release(p_tenant_id uuid, p_limit integer default 50) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  st        pricing.settings_v3;
  t         pricing.plan_terms;
  g         jsonb;
  v_cap     integer;
  v_left    bigint;
  v_refs    jsonb := '[]'::jsonb;
  v_expired integer;
begin
  perform pricing.system_only();
  if p_tenant_id is null or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  select * into st from pricing.settings_v3;
  update pricing.queued_calls q set status = 'expired', resolved_at = now() where q.tenant_id = p_tenant_id and q.status = 'queued' and q.created_at < now() - make_interval(days => st.queue_days);
  get diagnostics v_expired = row_count;
  g := pricing.v3_gate(p_tenant_id, 'calls');
  if (g ->> 'allowed')::boolean then
    t := pricing.v3_terms(p_tenant_id);
    v_left := greatest(t.included_minutes::bigint * 2 - coalesce((select sum(u.included_half) from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'call'
                       and u.at >= (select w.w_start from pricing.v3_window(p_tenant_id) w)), 0), 0) / 2;
    v_cap := case when pricing.v3_exempt(p_tenant_id) then p_limit
                  else least(p_limit, greatest((v_left + (g ->> 'balance_paise')::bigint / greatest(t.minute_paise, 1))::integer, 1)) end;
    with picked as (
      select q.id from pricing.queued_calls q where q.tenant_id = p_tenant_id and q.status = 'queued' order by q.created_at, q.id limit v_cap for update),
    done as (
      update pricing.queued_calls q set status = 'released', resolved_at = now() from picked where q.id = picked.id returning q.ref, q.created_at)
    select coalesce(jsonb_agg(d.ref order by d.created_at, d.ref), '[]'::jsonb) into v_refs from done d;
  end if;
  return jsonb_build_object('released', v_refs, 'expired', v_expired, 'waiting', (select count(*) from pricing.queued_calls q where q.tenant_id = p_tenant_id and q.status = 'queued'));
end $$;
revoke all on function public.pricing_v3_queue_release(uuid, integer) from public, anon;
grant execute on function public.pricing_v3_queue_release(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the Owner's own settings: a spending limit per feature, the automatic top-up
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.pricing_v3_limit_set(p_tenant_id uuid, p_feature text, p_limit_paise bigint) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  st pricing.settings_v3;
begin
  perform pricing.owner_only(p_tenant_id);
  select * into st from pricing.settings_v3;
  if p_feature not in ('calls', 'lead_finder', 'numbers', 'whatsapp') or (p_limit_paise is not null and p_limit_paise not between st.limit_min_paise and st.limit_max_paise) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if p_limit_paise is null then
    delete from pricing.feature_limits f where f.tenant_id = p_tenant_id and f.feature = p_feature;
  else
    insert into pricing.feature_limits (tenant_id, feature, limit_paise) values (p_tenant_id, p_feature, p_limit_paise)
    on conflict (tenant_id, feature) do update set limit_paise = excluded.limit_paise, updated_at = now();
  end if;
  perform app.write_audit_event(p_tenant_id, 'billing.limit_set', 'workspace', p_tenant_id, null, jsonb_build_object('feature', p_feature, 'limit_paise', p_limit_paise));
  return jsonb_build_object('feature', p_feature, 'limit_paise', p_limit_paise);
end $$;
revoke all on function public.pricing_v3_limit_set(uuid, text, bigint) from public, anon;
grant execute on function public.pricing_v3_limit_set(uuid, text, bigint) to authenticated;

create function public.pricing_v3_auto_topup_set(p_tenant_id uuid, p_enabled boolean, p_amount_paise bigint, p_below_paise bigint, p_monthly_limit_paise bigint) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  st pricing.settings_v3;
begin
  perform pricing.owner_only(p_tenant_id);
  select * into st from pricing.settings_v3;
  if p_enabled is null or p_amount_paise is null or p_below_paise is null or p_monthly_limit_paise is null
     or p_amount_paise not between st.topup_min_paise and st.topup_max_paise or p_below_paise not between 0 and st.topup_max_paise
     or p_monthly_limit_paise < p_amount_paise or p_monthly_limit_paise > st.limit_max_paise then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into pricing.auto_topups (tenant_id, enabled, amount_paise, below_paise, monthly_limit_paise) values (p_tenant_id, p_enabled, p_amount_paise, p_below_paise, p_monthly_limit_paise)
  on conflict (tenant_id) do update set enabled = excluded.enabled, amount_paise = excluded.amount_paise, below_paise = excluded.below_paise, monthly_limit_paise = excluded.monthly_limit_paise, updated_at = now();
  perform app.write_audit_event(p_tenant_id, 'billing.auto_topup_set', 'workspace', p_tenant_id, null,
                                jsonb_build_object('enabled', p_enabled, 'amount_paise', p_amount_paise, 'below_paise', p_below_paise, 'monthly_limit_paise', p_monthly_limit_paise));
  return jsonb_build_object('enabled', p_enabled, 'amount_paise', p_amount_paise, 'below_paise', p_below_paise, 'monthly_limit_paise', p_monthly_limit_paise);
end $$;
revoke all on function public.pricing_v3_auto_topup_set(uuid, boolean, bigint, bigint, bigint) from public, anon;
grant execute on function public.pricing_v3_auto_topup_set(uuid, boolean, bigint, bigint, bigint) to authenticated;

-- is an automatic top-up due now? (switched on, the balance below the line, and this month's automatic top-ups plus this one within the monthly limit)
create function public.pricing_v3_auto_topup_due(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  a       pricing.auto_topups;
  v_spent bigint;
  v_bal   bigint;
begin
  perform pricing.system_only();
  select * into a from pricing.auto_topups x where x.tenant_id = p_tenant_id;
  v_bal := pricing.balance_of(p_tenant_id);
  if not found or not a.enabled then
    return jsonb_build_object('due', false, 'reason', 'off', 'amount_paise', null, 'balance_paise', v_bal);
  end if;
  if v_bal >= a.below_paise then
    return jsonb_build_object('due', false, 'reason', 'balance_ok', 'amount_paise', null, 'balance_paise', v_bal);
  end if;
  select coalesce(sum(r.amount_paise), 0) into v_spent from pricing.auto_topup_runs r
   where r.tenant_id = p_tenant_id and r.at >= (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
  if v_spent + a.amount_paise > a.monthly_limit_paise then
    return jsonb_build_object('due', false, 'reason', 'monthly_limit', 'amount_paise', null, 'balance_paise', v_bal);
  end if;
  return jsonb_build_object('due', true, 'reason', null, 'amount_paise', a.amount_paise, 'balance_paise', v_bal);
end $$;
revoke all on function public.pricing_v3_auto_topup_due(uuid) from public, anon;
grant execute on function public.pricing_v3_auto_topup_due(uuid) to authenticated;

-- an automatic top-up was paid at the provider: credited once per payment, invoiced with GST on top, never beyond the monthly limit
create function public.pricing_v3_auto_topup_record(p_tenant_id uuid, p_payment_ref text, p_amount_paise bigint) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  a       pricing.auto_topups;
  v_spent bigint;
  v_new   integer;
begin
  perform pricing.system_or_webhook();
  if p_tenant_id is null or p_payment_ref is null or p_payment_ref !~ '^[A-Za-z0-9_.:-]{3,100}$' or p_amount_paise is null or p_amount_paise not between 10000 and 100000000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  select * into a from pricing.auto_topups x where x.tenant_id = p_tenant_id and x.enabled;
  if not found then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if exists (select 1 from pricing.auto_topup_runs r where r.tenant_id = p_tenant_id and r.payment_ref = p_payment_ref) then
    return jsonb_build_object('credited', false, 'replayed', true, 'balance_paise', pricing.balance_of(p_tenant_id));
  end if;
  select coalesce(sum(r.amount_paise), 0) into v_spent from pricing.auto_topup_runs r
   where r.tenant_id = p_tenant_id and r.at >= (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
  if v_spent + p_amount_paise > a.monthly_limit_paise then
    raise exception 'spending limit reached' using errcode = 'SM993';
  end if;
  insert into pricing.auto_topup_runs (tenant_id, payment_ref, amount_paise) values (p_tenant_id, p_payment_ref, p_amount_paise) on conflict do nothing;
  get diagnostics v_new = row_count;
  perform pricing.credit(p_tenant_id, 'topup', p_payment_ref, p_amount_paise);
  perform pricing.invoice(p_tenant_id, 'topup', p_payment_ref, p_amount_paise);
  return jsonb_build_object('credited', v_new = 1, 'replayed', false, 'balance_paise', pricing.balance_of(p_tenant_id));
end $$;
revoke all on function public.pricing_v3_auto_topup_record(uuid, text, bigint) from public, anon;
grant execute on function public.pricing_v3_auto_topup_record(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- warnings at 80 % and 100 %: each given once per level and period
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.pricing_v3_warnings_take(p_tenant_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  x     jsonb;
  v_n   integer;
  v_out jsonb := '[]'::jsonb;
begin
  perform pricing.system_only();
  if p_tenant_id is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  for x in select e from jsonb_array_elements(pricing.v3_warnings(p_tenant_id)) e loop
    insert into pricing.warning_marks (tenant_id, scope, level, period_key) values (p_tenant_id, x ->> 'scope', (x ->> 'level')::integer, x ->> 'period_key') on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      v_out := v_out || (x - 'period_key');
    end if;
  end loop;
  return jsonb_build_object('new', v_out);
end $$;
revoke all on function public.pricing_v3_warnings_take(uuid) from public, anon;
grant execute on function public.pricing_v3_warnings_take(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the business numbers: 1 included, Rs 299 a month for each extra (unlimited count), a released number held 30 days
-- ---------------------------------------------------------------------------------------------------------------------------------
-- a number taken at the provider is recorded (the Owner; the API has rented it first). An extra number takes its first month from the wallet NOW and is refused when the wallet cannot pay (SM994) or the limit is reached (SM993).
create function public.pricing_v3_number_taken(p_tenant_id uuid, p_number text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  r        pricing.number_rentals;
  v_id     uuid := gen_random_uuid();
  v_extra  boolean;
  v_paid   timestamptz := null;
  v_charge bigint := 0;
begin
  perform pricing.owner_only(p_tenant_id);
  if p_number is null or p_number !~ '^\+[0-9]{8,15}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  select * into r from pricing.number_rentals x where x.tenant_id = p_tenant_id and x.number = p_number and x.status in ('active', 'held') for update;
  if found and r.status = 'active' then
    return jsonb_build_object('rental_id', r.id, 'number', r.number, 'extra', r.extra, 'charged_paise', 0, 'paid_until', r.paid_until, 'replayed', true);
  elsif found then
    return public.pricing_v3_number_reclaim(p_tenant_id, p_number);   -- a number still on hold comes back, it is not a new one
  end if;
  v_extra := not pricing.v3_exempt(p_tenant_id)
             and (select count(*) from pricing.number_rentals x where x.tenant_id = p_tenant_id and x.status = 'active') >= (select (pricing.plan_of(p_tenant_id)).numbers_included);
  if v_extra then
    v_charge := pricing.v3_take_extra(p_tenant_id, v_id);
    v_paid := now() + interval '1 month';
  end if;
  insert into pricing.number_rentals (id, tenant_id, number, status, extra, paid_until) values (v_id, p_tenant_id, p_number, 'active', v_extra, v_paid);
  perform app.write_audit_event(p_tenant_id, 'billing.number_taken', 'workspace', p_tenant_id, null, jsonb_build_object('extra', v_extra, 'charged_paise', v_charge));
  return jsonb_build_object('rental_id', v_id, 'number', p_number, 'extra', v_extra, 'charged_paise', v_charge, 'paid_until', v_paid, 'replayed', false);
end $$;
revoke all on function public.pricing_v3_number_taken(uuid, text) from public, anon;
grant execute on function public.pricing_v3_number_taken(uuid, text) to authenticated;

-- a number the business gives back: held 30 days (nothing more is charged; the month already paid is not refunded), then it is let go
create function public.pricing_v3_number_released(p_tenant_id uuid, p_number text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  r       pricing.number_rentals;
  v_until timestamptz;
begin
  perform pricing.owner_only(p_tenant_id);
  perform pricing.v3_lock(p_tenant_id);
  select * into r from pricing.number_rentals x where x.tenant_id = p_tenant_id and x.number = p_number and x.status in ('active', 'held') for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if r.status = 'held' then
    return jsonb_build_object('number', r.number, 'hold_until', r.hold_until, 'replayed', true);
  end if;
  v_until := now() + make_interval(days => (select s.number_hold_days from pricing.settings_v3 s));
  update pricing.number_rentals set status = 'held', released_at = now(), hold_until = v_until where id = r.id;
  perform app.write_audit_event(p_tenant_id, 'billing.number_released', 'workspace', p_tenant_id, null, jsonb_build_object('hold_until', v_until));
  return jsonb_build_object('number', r.number, 'hold_until', v_until, 'replayed', false);
end $$;
revoke all on function public.pricing_v3_number_released(uuid, text) from public, anon;
grant execute on function public.pricing_v3_number_released(uuid, text) to authenticated;

-- the business takes a held number back within its 30 days (the same number; an extra one is paid for again only if the month it paid has run out)
create function public.pricing_v3_number_reclaim(p_tenant_id uuid, p_number text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  r        pricing.number_rentals;
  v_extra  boolean;
  v_paid   timestamptz;
  v_charge bigint := 0;
begin
  perform pricing.owner_only(p_tenant_id);
  perform pricing.v3_lock(p_tenant_id);
  select * into r from pricing.number_rentals x where x.tenant_id = p_tenant_id and x.number = p_number and x.status in ('active', 'held') for update;
  if not found or (r.status = 'held' and r.hold_until <= now()) then
    raise exception 'not found' using errcode = '23503';
  end if;
  if r.status = 'active' then
    return jsonb_build_object('rental_id', r.id, 'number', r.number, 'extra', r.extra, 'charged_paise', 0, 'paid_until', r.paid_until, 'replayed', true);
  end if;
  v_extra := not pricing.v3_exempt(p_tenant_id)
             and (select count(*) from pricing.number_rentals x where x.tenant_id = p_tenant_id and x.status = 'active') >= (select (pricing.plan_of(p_tenant_id)).numbers_included);
  v_paid := case when v_extra then r.paid_until end;
  if v_extra and (v_paid is null or v_paid <= now()) then
    v_charge := pricing.v3_take_extra(p_tenant_id, gen_random_uuid());
    v_paid := now() + interval '1 month';
  end if;
  update pricing.number_rentals set status = 'active', extra = v_extra, paid_until = v_paid, released_at = null, hold_until = null where id = r.id;
  perform app.write_audit_event(p_tenant_id, 'billing.number_reclaimed', 'workspace', p_tenant_id, null, jsonb_build_object('extra', v_extra, 'charged_paise', v_charge));
  return jsonb_build_object('rental_id', r.id, 'number', r.number, 'extra', v_extra, 'charged_paise', v_charge, 'paid_until', v_paid, 'replayed', false);
end $$;
revoke all on function public.pricing_v3_number_reclaim(uuid, text) from public, anon;
grant execute on function public.pricing_v3_number_reclaim(uuid, text) to authenticated;

-- the month's tick for one business (the worker): an extra number whose month is up takes Rs 299 again; one the wallet cannot pay (or whose limit is reached) is put on hold like a released one (30 days);
-- a number whose hold has run out is let go. The answer lists the numbers so the caller can switch the line off / give it back at the provider.
create function public.pricing_v3_numbers_renew(p_tenant_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  r         record;
  v_renewed jsonb := '[]'::jsonb;
  v_lapsed  jsonb := '[]'::jsonb;
  v_gone    jsonb := '[]'::jsonb;
  v_new     timestamptz;
  v_hold    integer := (select s.number_hold_days from pricing.settings_v3 s);
begin
  perform pricing.system_only();
  if p_tenant_id is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pricing.v3_lock(p_tenant_id);
  for r in update pricing.number_rentals x set status = 'gone' where x.tenant_id = p_tenant_id and x.status = 'held' and x.hold_until <= now() returning x.number loop
    v_gone := v_gone || to_jsonb(r.number);
  end loop;
  if not pricing.v3_exempt(p_tenant_id) then
    for r in select x.id, x.number, x.paid_until from pricing.number_rentals x where x.tenant_id = p_tenant_id and x.status = 'active' and x.extra and x.paid_until <= now() order by x.started_at, x.id for update loop
      begin
        perform pricing.v3_take_extra(p_tenant_id, md5(r.id::text || '|' || r.paid_until::text)::uuid);
        v_new := r.paid_until + interval '1 month';
        if v_new <= now() then
          v_new := now() + interval '1 month';
        end if;
        update pricing.number_rentals set paid_until = v_new where id = r.id;
        v_renewed := v_renewed || to_jsonb(r.number);
      exception when sqlstate 'SM993' or sqlstate 'SM994' then
        update pricing.number_rentals set status = 'held', released_at = now(), hold_until = now() + make_interval(days => v_hold) where id = r.id;
        v_lapsed := v_lapsed || to_jsonb(r.number);
      end;
    end loop;
  end if;
  return jsonb_build_object('renewed', v_renewed, 'lapsed', v_lapsed, 'let_go', v_gone);
end $$;
revoke all on function public.pricing_v3_numbers_renew(uuid) from public, anon;
grant execute on function public.pricing_v3_numbers_renew(uuid) to authenticated;
