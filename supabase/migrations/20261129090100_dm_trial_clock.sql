-- Job DM (C1 part, owner decision 25 Oct 2026, evening), migration 2: THE TRIAL IS 14 DAYS, COUNTED FROM THE DAY THE WORKSPACE'S WHATSAPP IS CONNECTED (not from sign-up).
--
--   billing.catalogue_versions.trial_starts_on      'sign_up' (version 1: 30 days from the start) | 'whatsapp_connected' (version 2: 14 days from the day WhatsApp was connected)
--   billing.catalogue_versions.setup_days           how long a workspace that has not connected WhatsApp yet may set up before it lapses (30; only the trial clock waits, nothing else)
--   integrations.whatsapp_accounts.connected_at    the day the number first became ACTIVE (a trigger sets it once and never moves it; existing active accounts: their last change)
--   public.billing_subscriptions.provider_clock_set_at   when the provider was told the day the trial ends (the worker does it; see scheduler_billing_trial_clocks_due)
--   app.billing_trial_clock(tenant, at)            the trigger's act: a TRIALING subscription that waited for WhatsApp gets trial_ends_at = connected_at + its version's trial days
--   public.billing_start_trial                     a full copy: trial_ends_at is the connected day + 14 days when WhatsApp is connected already, NULL ("waiting for WhatsApp") when not
--   app.billing_access_until                       a full copy: a trialing subscription still waiting lapses after the setup days; a workspace without a subscription lapses 14 days after WhatsApp was connected
--                                                  (or the setup days after it was made, if it never connected)
--   app.billing_subscription_json, public.billing_plans, public.billing_get   full copies that SAY it: trial_waiting_for_whatsapp, the rules (starts_on, setup days) and whatsapp_connected_at
--   public.scheduler_billing_trial_clocks_due / _mark   the worker tells the provider the day the trial ends (so the first charge falls on it) and marks it done
-- Everything about the READ-ONLY state stays behind the platform switch `billing_enforced` (OFF): the clock itself is only data and changes nothing a workspace can feel.

alter table billing.catalogue_versions add column trial_starts_on text not null default 'sign_up' check (trial_starts_on in ('sign_up', 'whatsapp_connected'));
alter table billing.catalogue_versions add column setup_days integer not null default 30 check (setup_days between 1 and 90);
comment on column billing.catalogue_versions.trial_starts_on is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

alter table public.billing_subscriptions add column provider_clock_set_at timestamptz;

alter table public.billing_events drop constraint billing_events_kind_check;
alter table public.billing_events add constraint billing_events_kind_check check (kind in ('trial_started', 'trial_clock_started', 'charge_succeeded', 'charge_failed', 'halted', 'cancel_requested', 'cancelled'));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the day WhatsApp was connected
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table integrations.whatsapp_accounts add column connected_at timestamptz;
update integrations.whatsapp_accounts set connected_at = updated_at where status = 'active' and connected_at is null;
comment on column integrations.whatsapp_accounts.connected_at is 'The first moment the number was ACTIVE. Set once by a trigger and never moved (a number switched off and on again keeps its first day). The 14-day trial counts from here.';

create function app.wa_connected_at_set() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.connected_at is not null then
    new.connected_at := old.connected_at;   -- never moved
  elsif new.status = 'active' and new.connected_at is null then
    new.connected_at := app.outbox_now();
  elsif new.status <> 'active' and tg_op = 'INSERT' then
    new.connected_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app.wa_connected_at_set() from public;
create trigger whatsapp_accounts_connected_at before insert or update on integrations.whatsapp_accounts for each row execute function app.wa_connected_at_set();

-- the trial of a workspace that was WAITING for WhatsApp starts its 14 days now
create function app.billing_trial_clock(p_tenant uuid, p_at timestamptz) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform app.billing_edit(true);
  update public.billing_subscriptions s
     set trial_ends_at = p_at + make_interval(days => v.trial_days), updated_at = app.outbox_now()
    from billing.catalogue_versions v
   where v.version = s.catalogue_version and s.tenant_id = p_tenant and s.status = 'trialing' and s.trial_ends_at is null and v.trial_starts_on = 'whatsapp_connected';
  get diagnostics n = row_count;
  perform app.billing_edit(false);
  if n > 0 then
    insert into public.billing_events (tenant_id, event_id, kind, at) values (p_tenant, 'trial_clock:' || p_tenant::text, 'trial_clock_started', p_at) on conflict do nothing;
  end if;
end;
$$;
revoke all on function app.billing_trial_clock(uuid, timestamptz) from public, anon, authenticated, service_role;

create function app.wa_connected_billing() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.connected_at is not null then
    perform app.billing_trial_clock(new.tenant_id, new.connected_at);
  end if;
  return null;
end;
$$;
revoke all on function app.wa_connected_billing() from public;
create trigger whatsapp_accounts_billing_clock after insert or update on integrations.whatsapp_accounts for each row execute function app.wa_connected_billing();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. starting the trial (a full copy of migration 20261127090200's function; ONE term changes: trial_ends_at)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.billing_start_trial(p_tenant_id uuid, p_plan_id text, p_provider text, p_provider_ref text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v     billing.catalogue_versions;
  v_now timestamptz := app.outbox_now();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  perform app.require_aal2();
  if p_plan_id is null or p_provider is null or p_provider not in ('fake') or p_provider_ref is null or p_provider_ref !~ '^[A-Za-z0-9_-]{3,100}$' then
    perform app.billing_error('invalid');
  end if;
  select * into v from billing.catalogue_versions x order by x.version desc limit 1;
  if not exists (select 1 from billing.plan_versions pv where pv.catalogue_version = v.version and pv.plan_id = p_plan_id and pv.kind in ('main', 'calls')) then
    perform app.billing_error('plan');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_tenant_id::text, 0));
  if exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id) then
    perform app.billing_error('started');
  end if;
  perform app.billing_edit(true);
  insert into public.billing_subscriptions (tenant_id, plan_id, catalogue_version, status, provider, provider_ref, payment_method_on_file, trial_started_at, trial_ends_at, updated_by)
  values (p_tenant_id, p_plan_id, v.version, 'trialing', p_provider, p_provider_ref, true, v_now,
          case when v.trial_starts_on = 'whatsapp_connected'
               then (select a.connected_at + make_interval(days => v.trial_days) from integrations.whatsapp_accounts a where a.tenant_id = p_tenant_id and a.connected_at is not null)   -- null = waiting for WhatsApp
               else v_now + make_interval(days => v.trial_days) end,
          v_uid);
  perform app.billing_edit(false);
  insert into public.billing_events (tenant_id, event_id, kind, at) values (p_tenant_id, 'trial_started:' || p_provider_ref, 'trial_started', v_now);
  return public.billing_get(p_tenant_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. when the access ends (a full copy of migration 20261127090300's function; the two lines that read the trial change)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.billing_access_until(p_tenant uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t   public.tenants;
  s   public.billing_subscriptions;
  v   billing.catalogue_versions;
  v_connected timestamptz;
begin
  select * into t from public.tenants x where x.id = p_tenant;
  if not found then
    return null;
  end if;
  select * into s from public.billing_subscriptions x where x.tenant_id = p_tenant;
  if not found then
    select * into v from billing.catalogue_versions c order by c.version desc limit 1;
    select a.connected_at into v_connected from integrations.whatsapp_accounts a where a.tenant_id = p_tenant;
    if v.trial_starts_on = 'whatsapp_connected' then
      -- the 14 days count from the day WhatsApp was connected; a workspace that has not connected has the setup days from the day it was made
      return case when v_connected is not null then v_connected + make_interval(days => v.trial_days) else t.trial_started_at + make_interval(days => v.setup_days) end;
    end if;
    return t.trial_started_at + make_interval(days => coalesce(v.trial_days, 30));
  end if;
  select * into v from billing.catalogue_versions c where c.version = s.catalogue_version;
  return case s.status
    when 'active'   then case when s.cancel_at_period_end then s.current_period_end else null end
    when 'trialing' then case when s.trial_ends_at is null then s.trial_started_at + make_interval(days => coalesce(v.setup_days, 30)) else s.trial_ends_at + interval '1 day' end
    when 'past_due' then coalesce(s.grace_until, s.current_period_end, s.trial_ends_at)
    else coalesce(s.current_period_end, s.trial_ends_at, s.cancelled_at)
  end;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. what the screens are told (three full copies, each with the added keys named)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.billing_subscription_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', s.status, 'plan_id', s.plan_id, 'provider', s.provider, 'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
                            'cancel_at_period_end', s.cancel_at_period_end, 'grace_until', s.grace_until, 'payment_method_on_file', s.payment_method_on_file,
                            'trial_waiting_for_whatsapp', s.status = 'trialing' and s.trial_ends_at is null)
    from public.billing_subscriptions s where s.tenant_id = p_tenant
$$;

create or replace function public.billing_plans() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v billing.catalogue_versions;
begin
  if auth.uid() is null then
    perform app.billing_error('deny');
  end if;
  select * into v from billing.catalogue_versions x order by x.version desc limit 1;
  return jsonb_build_object(
    'catalogue_version', v.version, 'status', v.status, 'currency', 'INR',
    'trial', jsonb_build_object('days', v.trial_days, 'payment_method_at_start', v.payment_method_at_start, 'grace_days_after_failed_payment', v.grace_days,
                                'starts_on', v.trial_starts_on, 'setup_days_without_whatsapp', v.setup_days),
    'plans', coalesce((select jsonb_agg(app.billing_plan_json(pv) order by pv.sort) from billing.plan_versions pv where pv.catalogue_version = v.version), '[]'::jsonb));
end;
$$;

create or replace function public.billing_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pv billing.plan_versions;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  pv := app.billing_plan_row(p_tenant_id);
  return jsonb_build_object(
    'plan', app.billing_plan_json(pv),
    'subscription', app.billing_subscription_json(p_tenant_id),
    'period', app.billing_period_json(p_tenant_id),
    'usage', app.billing_usage_json(p_tenant_id),
    'notices', app.billing_notices_json(p_tenant_id),
    'can_start_trial', not exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id),
    'whatsapp_connected_at', (select a.connected_at from integrations.whatsapp_accounts a where a.tenant_id = p_tenant_id))
    || app.billing_lapse(p_tenant_id);   -- flat: access ('full' | 'read_only'), read_only_since, delete_on, data_days_left
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. the worker tells the provider the day the trial ends (the first charge falls on it)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.scheduler_billing_trial_clocks_due(p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.billing_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.billing_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('tenant_id', s.tenant_id, 'provider', s.provider, 'provider_ref', s.provider_ref, 'trial_ends_at', s.trial_ends_at) order by s.trial_ends_at, s.tenant_id)
      from (select * from public.billing_subscriptions x where x.status = 'trialing' and x.trial_ends_at is not null and x.provider_clock_set_at is null order by x.trial_ends_at, x.tenant_id limit p_limit) s), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_billing_trial_clocks_due(integer) from public, anon;
grant execute on function public.scheduler_billing_trial_clocks_due(integer) to authenticated;

create function public.scheduler_billing_trial_clock_mark(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.billing_error('deny');
  end if;
  if p_tenant_id is null or not exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id) then
    perform app.billing_error('invalid');
  end if;
  perform app.billing_edit(true);
  update public.billing_subscriptions set provider_clock_set_at = app.outbox_now() where tenant_id = p_tenant_id and provider_clock_set_at is null;
  perform app.billing_edit(false);
  return jsonb_build_object('marked', true);
end;
$$;
revoke all on function public.scheduler_billing_trial_clock_mark(uuid) from public, anon;
grant execute on function public.scheduler_billing_trial_clock_mark(uuid) to authenticated;
