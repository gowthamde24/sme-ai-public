-- Job DP part 3 (night run 26 Oct 2026): READ-ONLY EVERYWHERE, and PAYING AGAIN after a lapse.
--
--   * public.billing_resume              the Owner (second factor) chooses a plan after the trial ended unpaid, or after a cancel: a paid plan starts at once, with NO new trial
--   * app.billing_can_resume             true when the workspace has lapsed (the access date has passed, or it was cancelled) and is not exempt
--   * public.billing_get / billing_access  FULL COPIES that also say `can_resume`; billing_access also says `sending` ('on' | 'off') and `waiting_for` ('whatsapp' | null) so the API can hold the
--                                        send, AI and call paths of a workspace that is read-only OR still waiting for WhatsApp with ONE answer
--   * public.scheduler_tenants           a FULL COPY that leaves out read-only and waiting workspaces: nothing of theirs is released, reminded, planned or run by the worker (the outbox claim already held the sends)
--   * app.billing_error                  a FULL COPY with one added word: not_lapsed (SM824)
--
--   Customer Zero and the demo workspaces never lapse: app.operator_billing_exempt (job DI) is the switch; docs/runbooks/billing-exempt.md says who and how. SQLSTATEs: SM821 unknown plan, SM824 not lapsed.

create or replace function app.billing_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'    then raise exception 'invalid input' using errcode = '22023';
    when 'reference'  then raise exception 'not found' using errcode = '23503';
    when 'plan'       then raise exception 'unknown plan' using errcode = 'SM821';
    when 'started'    then raise exception 'a trial was already started' using errcode = 'SM822';
    when 'nothing'    then raise exception 'nothing to cancel' using errcode = 'SM823';
    when 'not_lapsed' then raise exception 'the plan has not lapsed' using errcode = 'SM824';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;

-- a lapsed workspace: its subscription was cancelled, or the date its access ran to has passed. An exempt workspace never lapses.
create function app.billing_can_resume(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.billing_subscriptions s join public.tenants t on t.id = s.tenant_id
     where s.tenant_id = p_tenant and not t.billing_exempt and s.status <> 'trial_pending'
       and (s.status = 'cancelled' or (app.billing_access_until(p_tenant) is not null and app.outbox_now() >= app.billing_access_until(p_tenant))))
$$;
revoke all on function app.billing_can_resume(uuid) from public, anon, authenticated, service_role;

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
    'can_resume', app.billing_can_resume(p_tenant_id),
    'whatsapp_connected_at', (select a.connected_at from integrations.whatsapp_accounts a where a.tenant_id = p_tenant_id))
    || app.billing_lapse(p_tenant_id);   -- flat: access ('full' | 'read_only'), read_only_since, delete_on, data_days_left
end;
$$;

create or replace function public.billing_access(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  return app.billing_lapse(p_tenant_id) || jsonb_build_object(
    'can_resume', app.billing_can_resume(p_tenant_id),
    'sending', case when app.billing_read_only(p_tenant_id) then 'off' else 'on' end,   -- read-only OR still waiting for WhatsApp
    'waiting_for', case when app.billing_pending(p_tenant_id) then 'whatsapp' else null end);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- paying again
-- ---------------------------------------------------------------------------------------------------------------------------------
-- The API has already registered the subscription at the provider (the FAKE one: no network, nothing real is charged). Here the plan starts: active for one month from now, no trial, the
-- first month recorded as paid (a charge_succeeded event with this reference), the old trial dates untouched. The provider's next charge is told to fall one month from now (the API does that).
create function public.billing_resume(p_tenant_id uuid, p_plan_id text, p_provider text, p_provider_ref text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v     billing.catalogue_versions;
  v_now timestamptz := app.outbox_now();
  v_price integer;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  perform app.require_aal2();
  if p_plan_id is null or p_provider is null or p_provider not in ('fake') or p_provider_ref is null or p_provider_ref !~ '^[A-Za-z0-9_-]{3,100}$' then
    perform app.billing_error('invalid');
  end if;
  select * into v from billing.catalogue_versions x order by x.version desc limit 1;
  select pv.price_paise_monthly into v_price from billing.plan_versions pv where pv.catalogue_version = v.version and pv.plan_id = p_plan_id and pv.kind in ('main', 'calls');
  if not found then
    perform app.billing_error('plan');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_tenant_id::text, 0));
  if not app.billing_can_resume(p_tenant_id) then
    perform app.billing_error('not_lapsed');
  end if;
  perform app.billing_edit(true);
  update public.billing_subscriptions
     set plan_id = p_plan_id, catalogue_version = v.version, status = 'active', provider = p_provider, provider_ref = p_provider_ref, payment_method_on_file = true,
         current_period_start = v_now, current_period_end = v_now + interval '1 month', cancel_at_period_end = false, cancelled_at = null, grace_until = null, updated_by = v_uid, updated_at = now()
   where tenant_id = p_tenant_id;
  update public.tenants set plan = p_plan_id, billing_anchor_at = v_now where id = p_tenant_id;
  perform app.billing_edit(false);
  insert into public.billing_events (tenant_id, event_id, kind, amount_paise, at) values (p_tenant_id, 'resume:' || p_provider_ref, 'charge_succeeded', coalesce(v_price, 0), v_now) on conflict do nothing;
  return public.billing_get(p_tenant_id);
end;
$$;
revoke all on function public.billing_resume(uuid, text, text, text) from public, anon;
grant execute on function public.billing_resume(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the worker leaves a read-only (or waiting) workspace alone: a full copy of job AY's function with one added condition
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.scheduler_tenants() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if not app.outbox_switch_on() then
    return '[]'::jsonb;
  end if;
  -- a business that switched automatic sending on, and a business with a message its Owner APPROVED that waits to be released (approval is the Owner's consent to send);
  -- never a business that is read-only (its trial ended unpaid) or still waiting for WhatsApp: nothing of theirs is released, reminded, planned or run
  return coalesce((select jsonb_agg(z.tenant_id order by z.tenant_id)
                     from (select s.tenant_id from public.outbox_settings s where s.auto_send_enabled
                           union
                           select m.tenant_id from public.outbox_messages m where m.status = 'queued' and m.reason = 'owner_approved') z
                    where not app.billing_read_only(z.tenant_id)), '[]'::jsonb);
end;
$$;
