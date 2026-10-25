-- Job DM (C1 part, owner decision 25 Oct 2026, evening, after C2's questions), migration 4: A WORKSPACE THAT CHOSE A PLAN BUT HAS NOT CONNECTED WHATSAPP IS `trial_pending`.
--
--   Status `trial_pending`: the plan is chosen and the payment method is on file, but the 14 days have not begun (they begin on the day WhatsApp is connected). trial_ends_at is null, the answer says
--   `trial_waiting_for: "whatsapp"`, and NOTHING IS CHARGED. The workspace can set up everything (catalogue, customers, AI assistant settings): it is `access: full`. SENDING, AI CALLS and CAMPAIGN SENDS
--   stay off until WhatsApp is connected (the outbox claim hands out nothing, the call start is refused; messages stay queued, nothing is lost). When WhatsApp becomes active the status turns `trialing`.
--   It never becomes read-only for waiting. If WhatsApp is still not connected 30, 60 and 90 days after the plan was chosen, the Owners are sent a reminder e-mail (the FAKE sender sends nothing).
--   All of this is behind the existing platform switch `billing_enforced` (OFF by default): with the switch off nothing is held and no reminder is due; the status and the answer are data only.
--
--   public.billing_subscriptions.status        gains `trial_pending` (a trial with no end date yet is converted)
--   app.billing_pending(tenant)                the hold: the switch is on, the workspace is not exempt and its subscription is trial_pending
--   app.billing_stopped, app.billing_read_only full copies that ALSO answer true for a pending workspace (the claim of the outbox and the call start already ask them)
--   public.billing_start_trial                 a full copy: no connected WhatsApp = trial_pending
--   app.billing_trial_clock                    a full copy: connecting turns trial_pending into trialing with its end date
--   app.billing_access_until                   a full copy: trial_pending never lapses by waiting
--   public.billing_cancel                      a full copy: a pending trial is cancelled at once, like a running one
--   app.billing_subscription_json              a full copy: `trial_waiting_for` ("whatsapp" | null) replaces the boolean of migration 2
--   public.billing_pending_reminders + the scheduler's due/mark functions

alter table public.billing_subscriptions drop constraint billing_subscriptions_status_check;
alter table public.billing_subscriptions add constraint billing_subscriptions_status_check check (status in ('trial_pending', 'trialing', 'active', 'past_due', 'cancelled'));
select app.billing_edit(true);
update public.billing_subscriptions set status = 'trial_pending' where status = 'trialing' and trial_ends_at is null;
select app.billing_edit(false);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the hold
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.billing_pending(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.billing_enforced()
     and not exists (select 1 from public.tenants t where t.id = p_tenant and t.billing_exempt)
     and exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant and s.status = 'trial_pending')
$$;
revoke all on function app.billing_pending(uuid) from public, anon, authenticated, service_role;

-- a full copy of migration 20261127090200's function + the pending hold (every kind is stopped while the workspace waits for WhatsApp)
create or replace function app.billing_stopped(p_tenant uuid, p_kind text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.billing_pending(p_tenant)
      or (app.billing_enforced() and app.billing_state(app.billing_used(p_tenant, p_kind), app.billing_allowance(p_tenant, p_kind)) = 'stopped')
$$;

-- a full copy of migration 20261127090300's function + the pending hold (the outbox claim hands out nothing, not even a reply)
create or replace function app.billing_read_only(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.billing_lapse(p_tenant) ->> 'access' = 'read_only' or app.billing_pending(p_tenant) $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. starting, connecting, cancelling
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
  v_end timestamptz;
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
  v_end := case when v.trial_starts_on = 'whatsapp_connected'
                then (select a.connected_at + make_interval(days => v.trial_days) from integrations.whatsapp_accounts a where a.tenant_id = p_tenant_id and a.connected_at is not null)   -- null = waiting for WhatsApp
                else v_now + make_interval(days => v.trial_days) end;
  perform app.billing_edit(true);
  insert into public.billing_subscriptions (tenant_id, plan_id, catalogue_version, status, provider, provider_ref, payment_method_on_file, trial_started_at, trial_ends_at, updated_by)
  values (p_tenant_id, p_plan_id, v.version, case when v_end is null then 'trial_pending' else 'trialing' end, p_provider, p_provider_ref, true, v_now, v_end, v_uid);
  perform app.billing_edit(false);
  insert into public.billing_events (tenant_id, event_id, kind, at) values (p_tenant_id, 'trial_started:' || p_provider_ref, 'trial_started', v_now);
  return public.billing_get(p_tenant_id);
end;
$$;

create or replace function app.billing_trial_clock(p_tenant uuid, p_at timestamptz) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform app.billing_edit(true);
  update public.billing_subscriptions s
     set status = 'trialing', trial_ends_at = p_at + make_interval(days => v.trial_days), updated_at = app.outbox_now()
    from billing.catalogue_versions v
   where v.version = s.catalogue_version and s.tenant_id = p_tenant and s.status = 'trial_pending' and s.trial_ends_at is null and v.trial_starts_on = 'whatsapp_connected';
  get diagnostics n = row_count;
  perform app.billing_edit(false);
  if n > 0 then
    insert into public.billing_events (tenant_id, event_id, kind, at) values (p_tenant, 'trial_clock:' || p_tenant::text, 'trial_clock_started', p_at) on conflict do nothing;
  end if;
end;
$$;

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
      return case when v_connected is not null then v_connected + make_interval(days => v.trial_days) else t.trial_started_at + make_interval(days => v.setup_days) end;
    end if;
    return t.trial_started_at + make_interval(days => coalesce(v.trial_days, 30));
  end if;
  return case s.status
    when 'active'        then case when s.cancel_at_period_end then s.current_period_end else null end
    when 'trial_pending' then null   -- waiting for WhatsApp never makes a workspace read-only: it is reminded instead (public.scheduler_billing_pending_due)
    when 'trialing'      then s.trial_ends_at + interval '1 day'
    when 'past_due'      then coalesce(s.grace_until, s.current_period_end, s.trial_ends_at)
    else coalesce(s.current_period_end, s.trial_ends_at, s.cancelled_at)
  end;
end;
$$;

create or replace function public.billing_cancel(p_tenant_id uuid) returns jsonb
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
  if sub.status in ('trial_pending', 'trialing', 'past_due') then
    -- no paid period is running (a trial that waits or runs, or a payment that failed): it ends at once; a plan that was paid for goes back to the base plan
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

create or replace function app.billing_subscription_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', s.status, 'plan_id', s.plan_id, 'provider', s.provider, 'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
                            'cancel_at_period_end', s.cancel_at_period_end, 'grace_until', s.grace_until, 'payment_method_on_file', s.payment_method_on_file,
                            'trial_waiting_for', case when s.status = 'trial_pending' then 'whatsapp' else null end)
    from public.billing_subscriptions s where s.tenant_id = p_tenant
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. still waiting after 30, 60 and 90 days: a reminder e-mail to the Owners (the FAKE sender sends nothing). Only while the platform's billing switch is on.
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.billing_pending_reminders (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  day       smallint not null check (day in (30, 60, 90)),
  sent_at   timestamptz not null default app.outbox_now(),
  primary key (tenant_id, day)
);
alter table public.billing_pending_reminders enable row level security;
alter table public.billing_pending_reminders force row level security;
revoke all on public.billing_pending_reminders from public, anon, authenticated, service_role;
grant select on public.billing_pending_reminders to authenticated;
create policy billing_pending_reminders_select on public.billing_pending_reminders for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger billing_pending_reminders_forbid_tenant_id_change before update on public.billing_pending_reminders for each row execute function app.forbid_tenant_id_change();
create trigger audit_billing_pending_reminders after insert on public.billing_pending_reminders for each row execute function app.audit_row_change('billing_pending_reminder', '');
create trigger billing_pending_reminders_guard before update or delete on public.billing_pending_reminders for each row execute function app.billing_rows_guard();
create trigger billing_pending_reminders_no_truncate before truncate on public.billing_pending_reminders for each statement execute function app.billing_rows_guard();

-- the LATEST of day 30, 60, 90 (counted from the day the plan was chosen) that has come and has not been marked; nothing after day 120
create function public.scheduler_billing_pending_due(p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
begin
  if not app.is_scheduler() then
    perform app.billing_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.billing_error('invalid');
  end if;
  if not app.billing_enforced() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(d)::jsonb)
      from (
        select t.id as tenant_id, t.name as tenant_name, x.day,
               coalesce((select jsonb_agg(u.email order by u.email) from public.memberships m join auth.users u on u.id = m.user_id
                          where m.tenant_id = t.id and m.role = 'owner' and u.email is not null), '[]'::jsonb) as emails
          from public.billing_subscriptions s
          join public.tenants t on t.id = s.tenant_id
          cross join lateral (
            select max(dd.day) as day
              from unnest(array[30, 60, 90]) as dd(day)
             where v_now >= s.trial_started_at + make_interval(days => dd.day)
               and not exists (select 1 from public.billing_pending_reminders r where r.tenant_id = t.id and r.day >= dd.day)
          ) x
         where s.status = 'trial_pending' and not t.billing_exempt and x.day is not null and v_now < s.trial_started_at + interval '120 days'
         order by t.id
         limit p_limit
      ) d), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_billing_pending_due(integer) from public, anon;
grant execute on function public.scheduler_billing_pending_due(integer) to authenticated;

create function public.scheduler_billing_pending_mark(p_tenant_id uuid, p_day integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.billing_error('deny');
  end if;
  if p_tenant_id is null or p_day is null or p_day not in (30, 60, 90) or not exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id and s.status = 'trial_pending') then
    perform app.billing_error('invalid');
  end if;
  insert into public.billing_pending_reminders (tenant_id, day) select p_tenant_id, d from unnest(array[30, 60, 90]::smallint[]) as d where d <= p_day on conflict do nothing;
  return jsonb_build_object('marked', p_day);
end;
$$;
revoke all on function public.scheduler_billing_pending_mark(uuid, integer) from public, anon;
grant execute on function public.scheduler_billing_pending_mark(uuid, integer) to authenticated;
