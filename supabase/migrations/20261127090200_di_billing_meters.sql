-- Job DI (night run C1, ADR 0092), migration 3 of 3: USAGE METERS, the enforcement hooks and the subscription state of the (fake) billing provider. Needs migration 1 (the catalogue tables) and 2 (the plans data).
--
-- What is metered, and only this: AI CALL MINUTES and BUSINESS-INITIATED WHATSAPP MESSAGES, per workspace and per billing period (India time; the period is the workspace's month window of the AI fair-use meter,
-- app.ai_month_window, so both start on the same day). AI itself is "included, fair use": its allowances (plan_ai_allowances) are unchanged and never shown.
--
--   public.billing_usage_events  the ledger: units used (SECONDS for calls, 1 for a message), one row per call or message (a retry counts once), written only by the functions below
--   public.billing_topups        minutes or messages added to the period's allowance (operator only for now: no purchase flow exists)
--   public.billing_notices       one row per kind, level (80 or 100) and period: the notice EVENT, made once
--   public.billing_subscriptions the state of a workspace's subscription at the (fake) provider: trialing, active, past_due, cancelled
--   public.billing_events        the provider events that were applied (idempotent by event id)
--
-- Enforcement (a platform switch `billing_enforced`, OFF until the owner of the product turns it on with app.operator_set_billing_enforced; the meters and notices run either way):
--   at 80 percent one notice; at 100 percent (or when the plan includes none) that kind STOPS for the workspace until a top-up or the next period.
--   * business-initiated WhatsApp messages: the claim of the outbox (app.outbox_claim_due_core) does not hand them out, so they stay QUEUED (nothing is lost, and a reply inside the customer's 24-hour window is not held);
--   * call minutes: public.billing_check_usage tells the call start whether it may begin.
--   Quotes, orders, follow-ups and customers never stop. AI fair use is unchanged.
-- Who: Owner and Admin read; the Owner (second factor) starts a trial and cancels; the CHANNEL principal (the registered worker account that also receives webhooks) records call usage and applies provider events; the operator
-- adds top-ups and switches enforcement. Nobody writes a table directly.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM821 unknown plan, SM822 a trial was already started, SM823 nothing to cancel, SM306 second factor.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the switch, and plan ids as data (the old CHECK lists become references to the catalogue)
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.platform_flags drop constraint platform_flags_key_check;
alter table public.platform_flags add constraint platform_flags_key_check
  check (key in ('agents_enabled', 'selftest_enabled', 'research_enabled', 'requirement_enabled', 'assistant_enabled', 'outbox_enabled', 'billing_enforced'));
insert into public.platform_flags (key, enabled) values ('billing_enforced', false);

alter table public.tenants drop constraint tenants_plan_check;
alter table public.tenants add constraint tenants_plan_fkey foreign key (plan) references billing.plans (id);
alter table public.plan_ai_allowances drop constraint plan_ai_allowances_plan_check;
alter table public.plan_ai_allowances add constraint plan_ai_allowances_plan_fkey foreign key (plan) references billing.plans (id);
alter table public.plan_voice_allowances drop constraint plan_voice_allowances_plan_check;
alter table public.plan_voice_allowances add constraint plan_voice_allowances_plan_fkey foreign key (plan) references billing.plans (id);
-- the calls-only plans: the internal AI allowance is a PLACEHOLDER equal to Starter's (never shown to an owner); no voice notes (a calls-only plan includes no business messages)
insert into public.plan_ai_allowances (plan, daily_paise, monthly_paise)
  select p.id, a.daily_paise, a.monthly_paise from billing.plans p, public.plan_ai_allowances a where a.plan = 'starter' and p.id in ('calls_payg', 'calls_300', 'calls_1000');
insert into public.plan_voice_allowances (plan, daily_seconds, monthly_seconds) values ('calls_payg', 0, 0), ('calls_300', 0, 0), ('calls_1000', 0, 0);

create function app.billing_enforced() returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce((select f.enabled from public.platform_flags f where f.key = 'billing_enforced'), false) $$;
revoke all on function app.billing_enforced() from public, anon, authenticated, service_role;

create function app.operator_set_billing_enforced(p_enabled boolean) returns void
language sql
set search_path = ''
as $$ update public.platform_flags set enabled = p_enabled where key = 'billing_enforced' $$;
revoke all on function app.operator_set_billing_enforced(boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.billing_subscriptions (
  tenant_id            uuid primary key references public.tenants (id) on delete restrict,
  plan_id              text not null references billing.plans (id),
  catalogue_version    integer not null references billing.catalogue_versions (version),
  status               text not null check (status in ('trialing', 'active', 'past_due', 'cancelled')),
  provider             text not null check (provider in ('fake')),
  provider_ref         text not null check (provider_ref ~ '^[A-Za-z0-9_-]{3,100}$'),
  payment_method_on_file boolean not null,
  trial_started_at     timestamptz not null,
  trial_ends_at        timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at         timestamptz,
  grace_until          timestamptz,
  updated_by           uuid,
  updated_at           timestamptz not null default now(),
  created_at           timestamptz not null default now()
);
comment on column public.billing_subscriptions.plan_id is 'SAFE: a plan id from the catalogue (foreign key). CLEAN-EXEMPT: foreign key to a closed list';
comment on column public.billing_subscriptions.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.billing_subscriptions.provider is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.billing_subscriptions.provider_ref is 'SAFE: the provider''s subscription reference, an opaque token (no card or UPI detail is ever stored). CLEAN-EXEMPT: charset-limited CHECK';
comment on column public.billing_subscriptions.updated_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';

create table public.billing_events (
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  event_id     text not null check (event_id ~ '^[A-Za-z0-9_:.-]{3,100}$'),
  kind         text not null check (kind in ('trial_started', 'charge_succeeded', 'charge_failed', 'halted', 'cancel_requested', 'cancelled')),
  amount_paise integer check (amount_paise between 0 and 100000000),
  at           timestamptz not null,
  primary key (tenant_id, event_id)
);
comment on column public.billing_events.event_id is 'SAFE: the provider''s event id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column public.billing_events.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.billing_usage_events (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  kind      text not null check (kind in ('call_minutes', 'whatsapp_messages')),
  ref_id    uuid not null,
  units     integer not null check (units between 1 and 86400),
  at        timestamptz not null default app.outbox_now(),   -- the clock seam of the outbox: a test pins it, the real time is the same thing
  primary key (tenant_id, kind, ref_id)
);
create index billing_usage_events_window_idx on public.billing_usage_events (tenant_id, kind, at);
comment on column public.billing_usage_events.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.billing_topups (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  id        uuid not null,
  kind      text not null check (kind in ('call_minutes', 'whatsapp_messages')),
  units     integer not null check (units between 1 and 1000000),   -- MINUTES for call_minutes, messages for whatsapp_messages
  at        timestamptz not null default app.outbox_now(),
  primary key (tenant_id, id)
);
comment on column public.billing_topups.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.billing_notices (
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  kind         text not null check (kind in ('call_minutes', 'whatsapp_messages')),
  level        smallint not null check (level in (80, 100)),
  period_start date not null,
  at           timestamptz not null default app.outbox_now(),
  primary key (tenant_id, kind, level, period_start)
);
comment on column public.billing_notices.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

do $$
declare t text;
begin
  foreach t in array array['billing_subscriptions', 'billing_events', 'billing_usage_events', 'billing_topups', 'billing_notices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'']::public.app_role[])))::uuid[]))', t);
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$I for each row execute function app.forbid_tenant_id_change()', t);
  end loop;
end $$;
create trigger audit_billing_subscriptions after insert or update or delete on public.billing_subscriptions for each row execute function app.audit_row_change('billing_subscription', '');
create trigger audit_billing_events after insert on public.billing_events for each row execute function app.audit_row_change('billing_event', '');
create trigger audit_billing_topups after insert on public.billing_topups for each row execute function app.audit_row_change('billing_topup', '');
create trigger audit_billing_usage_events after insert on public.billing_usage_events for each row execute function app.audit_row_change('billing_usage_event', '');
create trigger audit_billing_notices after insert on public.billing_notices for each row execute function app.audit_row_change('billing_notice', '');
create index billing_subscriptions_plan_idx on public.billing_subscriptions (plan_id);
create index billing_subscriptions_catalogue_idx on public.billing_subscriptions (catalogue_version);

-- the ledgers are written once and never changed or deleted; the subscription is never deleted
create function app.billing_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name <> 'billing_subscriptions' or tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'billing records are never changed or deleted' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.billing_edit', true), '') <> 'on' then
    raise exception 'a subscription changes only through its functions' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.billing_rows_guard() from public;
create trigger billing_subscriptions_guard before update or delete on public.billing_subscriptions for each row execute function app.billing_rows_guard();
create trigger billing_events_guard before update or delete on public.billing_events for each row execute function app.billing_rows_guard();
create trigger billing_usage_events_guard before update or delete on public.billing_usage_events for each row execute function app.billing_rows_guard();
create trigger billing_topups_guard before update or delete on public.billing_topups for each row execute function app.billing_rows_guard();
create trigger billing_notices_guard before update or delete on public.billing_notices for each row execute function app.billing_rows_guard();
create trigger billing_events_no_truncate before truncate on public.billing_events for each statement execute function app.billing_rows_guard();
create trigger billing_usage_events_no_truncate before truncate on public.billing_usage_events for each statement execute function app.billing_rows_guard();
create trigger billing_topups_no_truncate before truncate on public.billing_topups for each statement execute function app.billing_rows_guard();
create trigger billing_notices_no_truncate before truncate on public.billing_notices for each statement execute function app.billing_rows_guard();
create trigger billing_subscriptions_no_truncate before truncate on public.billing_subscriptions for each statement execute function app.billing_rows_guard();
create function app.billing_edit(p_open boolean) returns void
language sql
set search_path = ''
as $$ select set_config('app.billing_edit', case when p_open then 'on' else '' end, true) $$;
revoke all on function app.billing_edit(boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. helpers: errors, the plan in force, the period, the allowance, what was used, the meter
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.billing_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'plan'      then raise exception 'unknown plan' using errcode = 'SM821';
    when 'started'   then raise exception 'a trial was already started' using errcode = 'SM822';
    when 'nothing'   then raise exception 'nothing to cancel' using errcode = 'SM823';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.billing_error(text) from public;

-- the newest catalogue version
create function app.billing_current_version() returns integer
language sql
stable
security definer
set search_path = ''
as $$ select max(v.version) from billing.catalogue_versions v $$;
revoke all on function app.billing_current_version() from public, anon, authenticated, service_role;

-- the row of the plan IN FORCE for a workspace: tenants.plan (kept in step with the subscription by app.billing_apply), in the catalogue version the subscription was made under, else the newest that has the plan
create function app.billing_plan_row(p_tenant uuid) returns billing.plan_versions
language sql
stable
security definer
set search_path = ''
as $$
  select pv.*
    from public.tenants t
    left join public.billing_subscriptions s on s.tenant_id = t.id
    join billing.plan_versions pv on pv.plan_id = t.plan and pv.catalogue_version <= coalesce(s.catalogue_version, app.billing_current_version())
   where t.id = p_tenant
   order by pv.catalogue_version desc
   limit 1
$$;
revoke all on function app.billing_plan_row(uuid) from public, anon, authenticated, service_role;

create function app.billing_plan_json(pv billing.plan_versions) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', pv.plan_id, 'kind', pv.kind, 'sort', pv.sort, 'name', pv.name,
    'price_paise_monthly', pv.price_paise_monthly, 'price_paise_per_minute', pv.price_paise_per_minute, 'price_paise_per_message', pv.price_paise_per_message, 'price_set', pv.price_paise_monthly is not null,
    'allowances', jsonb_build_object('call_minutes', pv.call_minutes, 'whatsapp_messages', pv.whatsapp_messages),
    'limits', jsonb_build_object('users', pv.users, 'workspaces', pv.workspaces),
    'ai', 'included_fair_use')
$$;
revoke all on function app.billing_plan_json(billing.plan_versions) from public, anon, authenticated, service_role;

-- the period: the workspace's month window in India dates (the same as the AI fair-use window); `win_end` is the day AFTER the last day
create function app.billing_period(p_tenant uuid, out o_start date, out o_end date) returns record
language sql
stable
security definer
set search_path = ''
as $$ select w.win_start, w.win_end from app.ai_month_window(p_tenant) w $$;
revoke all on function app.billing_period(uuid) from public, anon, authenticated, service_role;

-- the allowance of a kind in LEDGER units (seconds for calls, messages), top-ups of the period included; null = no ceiling (pay as you go)
create function app.billing_allowance(p_tenant uuid, p_kind text) returns bigint
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
  select coalesce(sum(x.units), 0) * case p_kind when 'call_minutes' then 60 else 1 end into v_top
    from public.billing_topups x
   where x.tenant_id = p_tenant and x.kind = p_kind
     and (x.at at time zone 'Asia/Kolkata')::date >= w.o_start and (x.at at time zone 'Asia/Kolkata')::date < w.o_end;
  return v_base + v_top;
end;
$$;
revoke all on function app.billing_allowance(uuid, text) from public, anon, authenticated, service_role;

create function app.billing_used(p_tenant uuid, p_kind text) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(x.units), 0)::bigint
    from public.billing_usage_events x, app.billing_period(p_tenant) w
   where x.tenant_id = p_tenant and x.kind = p_kind
     and (x.at at time zone 'Asia/Kolkata')::date >= w.o_start and (x.at at time zone 'Asia/Kolkata')::date < w.o_end
$$;
revoke all on function app.billing_used(uuid, text) from public, anon, authenticated, service_role;

-- the state of a kind: 'ok' under 80 percent, 'notice' from 80, 'stopped' at 100 percent or when none is included. Integer arithmetic only.
create function app.billing_state(p_used bigint, p_allowance bigint) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_allowance is null then 'ok'
              when p_allowance <= 0 or p_used >= p_allowance then 'stopped'
              when p_used * 100 >= p_allowance * 80 then 'notice'
              else 'ok' end
$$;
revoke all on function app.billing_state(bigint, bigint) from public, anon, authenticated, service_role;

-- the meter as the API shows it (minutes with one decimal; counts of messages)
create function app.billing_meter(p_tenant uuid, p_kind text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_used  bigint := app.billing_used(p_tenant, p_kind);
  v_allow bigint := app.billing_allowance(p_tenant, p_kind);
  v_div   numeric := case p_kind when 'call_minutes' then 60 else 1 end;
  v_top   bigint;
  w       record;
begin
  select * into w from app.billing_period(p_tenant);
  select coalesce(sum(x.units), 0) into v_top from public.billing_topups x
   where x.tenant_id = p_tenant and x.kind = p_kind
     and (x.at at time zone 'Asia/Kolkata')::date >= w.o_start and (x.at at time zone 'Asia/Kolkata')::date < w.o_end;
  return jsonb_build_object(
    'kind', p_kind,
    'unit', case p_kind when 'call_minutes' then 'minutes' else 'messages' end,
    'used', round(v_used / v_div, 1),
    'allowance', case when v_allow is null then null else (v_allow / v_div)::integer end,
    'remaining', case when v_allow is null then null else round(greatest(v_allow - v_used, 0) / v_div, 1) end,
    'percent', case when v_allow is null then null when v_allow <= 0 then 100 else least(100, (v_used * 100 / v_allow))::integer end,
    'state', app.billing_state(v_used, v_allow),
    'included', v_allow is null or v_allow > 0,
    'topup', v_top);
end;
$$;
revoke all on function app.billing_meter(uuid, text) from public, anon, authenticated, service_role;

-- is a kind stopped for this workspace right now? Only while the platform switch is on.
create function app.billing_stopped(p_tenant uuid, p_kind text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.billing_enforced() and app.billing_state(app.billing_used(p_tenant, p_kind), app.billing_allowance(p_tenant, p_kind)) = 'stopped'
$$;
revoke all on function app.billing_stopped(uuid, text) from public, anon, authenticated, service_role;

create function app.billing_notices_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'level', n.level, 'period_start', n.period_start, 'at', n.at) order by n.at, n.kind, n.level), '[]'::jsonb)
    from public.billing_notices n, app.billing_period(p_tenant) w
   where n.tenant_id = p_tenant and n.period_start = w.o_start
$$;
revoke all on function app.billing_notices_json(uuid) from public, anon, authenticated, service_role;

create function app.billing_period_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('start', w.o_start, 'end', (w.o_end - 1), 'timezone', 'Asia/Kolkata',
                            'days_left', greatest(0, w.o_end - (app.outbox_now() at time zone 'Asia/Kolkata')::date))
    from app.billing_period(p_tenant) w
$$;
revoke all on function app.billing_period_json(uuid) from public, anon, authenticated, service_role;

create function app.billing_usage_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select jsonb_build_object('call_minutes', app.billing_meter(p_tenant, 'call_minutes'), 'whatsapp_messages', app.billing_meter(p_tenant, 'whatsapp_messages')) $$;
revoke all on function app.billing_usage_json(uuid) from public, anon, authenticated, service_role;

create function app.billing_subscription_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', s.status, 'plan_id', s.plan_id, 'provider', s.provider, 'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
                            'cancel_at_period_end', s.cancel_at_period_end, 'grace_until', s.grace_until, 'payment_method_on_file', s.payment_method_on_file)
    from public.billing_subscriptions s where s.tenant_id = p_tenant
$$;
revoke all on function app.billing_subscription_json(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. recording usage: the ledger row and, when a line is crossed, the notice (once per kind, level and period)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.billing_record(p_tenant uuid, p_kind text, p_ref uuid, p_units integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allow bigint;
  v_used  bigint;
  w       record;
begin
  insert into public.billing_usage_events (tenant_id, kind, ref_id, units) values (p_tenant, p_kind, p_ref, p_units) on conflict do nothing;
  if found then
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
revoke all on function app.billing_record(uuid, text, uuid, integer) from public, anon, authenticated, service_role;

-- a business-initiated WhatsApp message is counted when it is SENT. A reply inside the customer's 24-hour window (category reply_to_inbound) is not business-initiated and is never counted.
create function app.billing_count_message() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' and new.category <> 'reply_to_inbound' then
    perform app.billing_record(new.tenant_id, 'whatsapp_messages', new.id, 1);
  end if;
  return new;
end;
$$;
revoke all on function app.billing_count_message() from public;
create trigger outbox_messages_billing_count after update of status on public.outbox_messages for each row execute function app.billing_count_message();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. the hold: the claim of the outbox does not hand out a business-initiated message while the kind is stopped (a full copy of the job BR version plus ONE condition in the select)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.outbox_claim_due_core(p_tenant_id uuid, p_limit integer, p_approved_only boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now  timestamptz := app.outbox_now();
  v_out  jsonb := '[]'::jsonb;
  r      public.outbox_messages;
  c      public.contacts;
  v_hard text;
  v_held boolean;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_approved_only is null then
    perform app.outbox_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  v_held := app.billing_stopped(p_tenant_id, 'whatsapp_messages');   -- job DI: 100 percent of the period's business-initiated messages (or none included)
  for r in
    select * from public.outbox_messages x
     where x.tenant_id = p_tenant_id and x.status = 'queued' and (x.scheduled_for is null or x.scheduled_for <= v_now)
       and (not p_approved_only or x.reason = 'owner_approved')
       and (x.claimed_at is null or x.claimed_at < v_now - interval '2 minutes')
       and (not v_held or x.category = 'reply_to_inbound')
     order by x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    if app.outbox_in_quiet_hours(v_now, p_tenant_id) then
      update public.outbox_messages set scheduled_for = app.outbox_next_open(v_now, p_tenant_id) where id = r.id;
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || coalesce(r.contact_id::text, r.id::text), 0));
    select * into c from public.contacts x where x.id = r.contact_id and x.tenant_id = p_tenant_id;
    v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, r.id, v_now) end;
    if v_hard is not null then
      update public.outbox_messages set status = 'blocked', reason = v_hard, scheduled_for = null where id = r.id;
      continue;
    end if;
    update public.outbox_messages set claimed_at = v_now, attempts = attempts + 1 where id = r.id returning * into r;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language,
      'attempts', r.attempts, 'wa', app.wa_send_context(r, v_now),
      'media', coalesce((select jsonb_agg(jsonb_build_object('photo_id', ph.id, 'bucket', ph.bucket, 'path', ph.path, 'content_type', ph.content_type) order by md.position)
                           from public.outbox_message_media md join public.catalogue_photos ph on ph.tenant_id = md.tenant_id and ph.id = md.photo_id and ph.removed_at is null
                          where md.tenant_id = r.tenant_id and md.message_id = r.id), '[]'::jsonb)));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. what the API reads
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the catalogue (any signed-in user)
create function public.billing_plans() returns jsonb
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
    'trial', jsonb_build_object('days', v.trial_days, 'payment_method_at_start', v.payment_method_at_start, 'grace_days_after_failed_payment', v.grace_days),
    'plans', coalesce((select jsonb_agg(app.billing_plan_json(pv) order by pv.sort) from billing.plan_versions pv where pv.catalogue_version = v.version), '[]'::jsonb));
end;
$$;
revoke all on function public.billing_plans() from public, anon;
grant execute on function public.billing_plans() to authenticated;

create function public.billing_get(p_tenant_id uuid) returns jsonb
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
    'can_start_trial', not exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id));
end;
$$;
revoke all on function public.billing_get(uuid) from public, anon;
grant execute on function public.billing_get(uuid) to authenticated;

create function public.billing_usage_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  return jsonb_build_object('period', app.billing_period_json(p_tenant_id), 'usage', app.billing_usage_json(p_tenant_id), 'notices', app.billing_notices_json(p_tenant_id));
end;
$$;
revoke all on function public.billing_usage_get(uuid) from public, anon;
grant execute on function public.billing_usage_get(uuid) to authenticated;

-- may this kind begin now? (the call start asks; the answer is the meter plus `allowed`). Any member who can start work may ask.
create function public.billing_check_usage(p_tenant_id uuid, p_kind text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not (app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) or app.is_channel_agent()) then
    perform app.billing_error('deny');
  end if;
  if p_kind is null or p_kind not in ('call_minutes', 'whatsapp_messages') then
    perform app.billing_error('invalid');
  end if;
  return jsonb_build_object('allowed', not app.billing_stopped(p_tenant_id, p_kind), 'meter', app.billing_meter(p_tenant_id, p_kind));
end;
$$;
revoke all on function public.billing_check_usage(uuid, text) from public, anon;
grant execute on function public.billing_check_usage(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. what the CHANNEL principal writes (the worker account that also receives webhooks): call usage, and the provider's events
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.billing_record_usage(p_tenant_id uuid, p_kind text, p_ref_id uuid, p_units integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_channel_agent() then
    perform app.billing_error('deny');
  end if;
  -- only call seconds come from outside; a WhatsApp message is counted by the outbox itself when it is sent
  if p_tenant_id is null or p_kind is distinct from 'call_minutes' or p_ref_id is null or p_units is null or p_units not between 1 and 86400
     or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    perform app.billing_error('invalid');
  end if;
  return app.billing_record(p_tenant_id, p_kind, p_ref_id, p_units);
end;
$$;
revoke all on function public.billing_record_usage(uuid, text, uuid, integer) from public, anon;
grant execute on function public.billing_record_usage(uuid, text, uuid, integer) to authenticated;

-- one provider event, applied once (the event id is the idempotency key). Kinds: charge_succeeded (the plan chosen starts), charge_failed (past due, a grace period), halted (the provider gave up: back to the trial plan),
-- cancelled (the provider confirms the end).
create function app.billing_apply(p_tenant uuid, p_event_id text, p_kind text, p_amount_paise integer, p_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s billing.catalogue_versions;
  sub public.billing_subscriptions;
  v_trial text;
  v_grace integer;
begin
  select * into sub from public.billing_subscriptions x where x.tenant_id = p_tenant for update;
  if not found then
    perform app.billing_error('reference');
  end if;
  insert into public.billing_events (tenant_id, event_id, kind, amount_paise, at) values (p_tenant, p_event_id, p_kind, p_amount_paise, p_at) on conflict do nothing;
  if not found then
    return app.billing_subscription_json(p_tenant);   -- seen before: nothing changes
  end if;
  select * into s from billing.catalogue_versions x where x.version = sub.catalogue_version;
  v_trial := s.trial_plan;
  v_grace := s.grace_days;
  perform app.billing_edit(true);
  if sub.status = 'cancelled' and p_kind <> 'cancelled' then
    null;   -- a cancelled subscription is never revived by a late event
  elsif p_kind = 'charge_succeeded' then
    update public.billing_subscriptions
       set status = 'active', current_period_start = p_at, current_period_end = p_at + interval '1 month', grace_until = null, updated_at = now()
     where tenant_id = p_tenant;
    update public.tenants set plan = sub.plan_id, billing_anchor_at = p_at where id = p_tenant;
  elsif p_kind = 'charge_failed' then
    update public.billing_subscriptions set status = 'past_due', grace_until = coalesce(grace_until, p_at + make_interval(days => v_grace)), updated_at = now() where tenant_id = p_tenant;
  elsif p_kind in ('halted', 'cancelled') then
    update public.billing_subscriptions set status = 'cancelled', cancelled_at = coalesce(cancelled_at, p_at), grace_until = null, payment_method_on_file = false, updated_at = now() where tenant_id = p_tenant;
    update public.tenants set plan = v_trial where id = p_tenant;
  end if;
  perform app.billing_edit(false);
  return app.billing_subscription_json(p_tenant);
end;
$$;
revoke all on function app.billing_apply(uuid, text, text, integer, timestamptz) from public, anon, authenticated, service_role;

create function public.billing_apply_event(p_tenant_id uuid, p_event_id text, p_kind text, p_amount_paise integer, p_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_channel_agent() then
    perform app.billing_error('deny');
  end if;
  if p_tenant_id is null or p_event_id is null or p_event_id !~ '^[A-Za-z0-9_:.-]{3,100}$' or p_kind is null or p_kind not in ('charge_succeeded', 'charge_failed', 'halted', 'cancelled')
     or p_at is null or (p_kind = 'charge_succeeded' and (p_amount_paise is null or p_amount_paise < 0)) then
    perform app.billing_error('invalid');
  end if;
  return app.billing_apply(p_tenant_id, p_event_id, p_kind, p_amount_paise, p_at);
end;
$$;
revoke all on function public.billing_apply_event(uuid, text, text, integer, timestamptz) from public, anon;
grant execute on function public.billing_apply_event(uuid, text, text, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. what the Owner does: start the trial (a payment method on file, nothing charged), and cancel
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.billing_start_trial(p_tenant_id uuid, p_plan_id text, p_provider text, p_provider_ref text) returns jsonb
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
  values (p_tenant_id, p_plan_id, v.version, 'trialing', p_provider, p_provider_ref, true, v_now, v_now + make_interval(days => v.trial_days), v_uid);
  perform app.billing_edit(false);
  insert into public.billing_events (tenant_id, event_id, kind, at) values (p_tenant_id, 'trial_started:' || p_provider_ref, 'trial_started', v_now);
  return public.billing_get(p_tenant_id);
end;
$$;
revoke all on function public.billing_start_trial(uuid, text, text, text) from public, anon;
grant execute on function public.billing_start_trial(uuid, text, text, text) to authenticated;

-- the provider's reference of the subscription, for the API to cancel it at the provider BEFORE the database records the cancel (an opaque token; no card or UPI detail exists here). Owner only.
create function public.billing_subscription_ref(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  return coalesce((select jsonb_build_object('provider', s.provider, 'provider_ref', s.provider_ref, 'status', s.status, 'trial_ends_at', s.trial_ends_at) from public.billing_subscriptions s where s.tenant_id = p_tenant_id), 'null'::jsonb);
end;
$$;
revoke all on function public.billing_subscription_ref(uuid) from public, anon;
grant execute on function public.billing_subscription_ref(uuid) to authenticated;

-- cancel: during the trial, or after a failed payment, the subscription ends at once and nothing is ever charged; an active plan ends at the end of the paid period
create function public.billing_cancel(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  sub   public.billing_subscriptions;
  v_now timestamptz := app.outbox_now();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  perform app.require_aal2();
  select * into sub from public.billing_subscriptions s where s.tenant_id = p_tenant_id for update;
  if not found or sub.status = 'cancelled' then
    perform app.billing_error('nothing');
  end if;
  perform app.billing_edit(true);
  if sub.status in ('trialing', 'past_due') then
    -- no paid period is running (the trial, or a payment that failed): it ends at once; a plan that was paid for goes back to the base plan
    update public.billing_subscriptions set status = 'cancelled', cancelled_at = v_now, payment_method_on_file = false, cancel_at_period_end = false, grace_until = null, updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id;
    update public.tenants set plan = (select c.trial_plan from billing.catalogue_versions c where c.version = sub.catalogue_version) where id = p_tenant_id;
    insert into public.billing_events (tenant_id, event_id, kind, at) values (p_tenant_id, 'cancelled:' || sub.provider_ref, 'cancelled', v_now) on conflict do nothing;
  else
    update public.billing_subscriptions set cancel_at_period_end = true, updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id;
    insert into public.billing_events (tenant_id, event_id, kind, at) values (p_tenant_id, 'cancel_requested:' || sub.provider_ref, 'cancel_requested', v_now) on conflict do nothing;
  end if;
  perform app.billing_edit(false);
  return public.billing_get(p_tenant_id);
end;
$$;
revoke all on function public.billing_cancel(uuid) from public, anon;
grant execute on function public.billing_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. the operator: a top-up (minutes or messages added to the period; no purchase flow exists yet)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.operator_billing_topup(p_tenant uuid, p_topup_id uuid, p_kind text, p_units integer) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('call_minutes', 'whatsapp_messages') or p_units is null or p_units <= 0 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into public.billing_topups (tenant_id, id, kind, units) values (p_tenant, p_topup_id, p_kind, p_units) on conflict do nothing;
end;
$$;
revoke all on function app.operator_billing_topup(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
