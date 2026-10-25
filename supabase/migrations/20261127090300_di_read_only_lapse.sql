-- Job DI (night run C1, ADR 0092 addendum, owner decision 25 Oct 2026), migration 4: when a TRIAL ENDS UNPAID the workspace becomes READ-ONLY.
--
--   Read-only: signing in, viewing and exporting stay; sending, AI, calls and every other change stop. The data is kept for 90 days; reminder e-mails go at day 1, 30, 60 and 83 of read-only; at day 90 the
--   workspace is DUE FOR DELETION (it is listed; the deletion itself is the operator's existing erasure, not automated here). Everything below is behind the existing platform switch `billing_enforced`
--   (OFF by default): with the switch off every workspace is `full` whatever its dates say, no reminder is due and nothing is held.
--
--   tenants.billing_exempt                 a workspace that never lapses (Customer Zero, the demos, a business paid for by other means); set by app.operator_billing_exempt
--   app.billing_access_until(tenant)       when the access paid for or promised ends (null = no end): the end of the 30-day trial, of the grace period after a failed payment, of the paid period
--   app.billing_lapse(tenant)              {access: full | read_only, read_only_since, delete_on, data_days_left} (always `full` while the switch is off or the workspace is exempt)
--   public.billing_access(tenant)          the same for ANY member (the API gate and the web banner read it)
--   public.billing_get                     a full copy plus the four keys of the lapse (`access` is the plain word full | read_only)
--   app.outbox_claim_due_core              a full copy: while read-only NOTHING is handed out (not even a reply), the messages stay queued
--   public.billing_lapse_reminders         which reminder (day 1, 30, 60, 83) went to which workspace, once
--   public.scheduler_billing_reminders_due / _mark   the worker asks which e-mails are due (with the Owners' addresses) and marks one sent; only the registered scheduler account
--   app.billing_deletion_due()             the workspaces past day 90 (the operator erases them with the existing erasure process after looking)
-- A workspace without a subscription lapses 30 days after it was made (its trial); a trialing one one day after its trial ends (the first charge is expected then); a past-due one when its grace period ends;
-- a cancelled one when the access it had paid or been promised ends (a cancel during the trial keeps the rest of the trial).

alter table public.tenants add column billing_exempt boolean not null default false;
comment on column public.tenants.billing_exempt is 'SAFE: a flag set by the operator. CLEAN-EXEMPT: boolean';

create table public.billing_lapse_reminders (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  day       smallint not null check (day in (1, 30, 60, 83)),
  sent_at   timestamptz not null default app.outbox_now(),
  primary key (tenant_id, day)
);
alter table public.billing_lapse_reminders enable row level security;
alter table public.billing_lapse_reminders force row level security;
revoke all on public.billing_lapse_reminders from public, anon, authenticated, service_role;
grant select on public.billing_lapse_reminders to authenticated;
create policy billing_lapse_reminders_select on public.billing_lapse_reminders for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger billing_lapse_reminders_forbid_tenant_id_change before update on public.billing_lapse_reminders for each row execute function app.forbid_tenant_id_change();
create trigger audit_billing_lapse_reminders after insert on public.billing_lapse_reminders for each row execute function app.audit_row_change('billing_lapse_reminder', '');
create trigger billing_lapse_reminders_guard before update or delete on public.billing_lapse_reminders for each row execute function app.billing_rows_guard();
create trigger billing_lapse_reminders_no_truncate before truncate on public.billing_lapse_reminders for each statement execute function app.billing_rows_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the state
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.billing_access_until(p_tenant uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t   public.tenants;
  s   public.billing_subscriptions;
  v_days integer;
begin
  select * into t from public.tenants x where x.id = p_tenant;
  if not found then
    return null;
  end if;
  select * into s from public.billing_subscriptions x where x.tenant_id = p_tenant;
  if not found then
    select c.trial_days into v_days from billing.catalogue_versions c order by c.version desc limit 1;
    return t.trial_started_at + make_interval(days => coalesce(v_days, 30));
  end if;
  return case s.status
    when 'active'   then case when s.cancel_at_period_end then s.current_period_end else null end
    when 'trialing' then s.trial_ends_at + interval '1 day'
    when 'past_due' then coalesce(s.grace_until, s.current_period_end, s.trial_ends_at)
    else coalesce(s.current_period_end, s.trial_ends_at, s.cancelled_at)
  end;
end;
$$;
revoke all on function app.billing_access_until(uuid) from public, anon, authenticated, service_role;

create function app.billing_lapse(p_tenant uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
  v_now   timestamptz := app.outbox_now();
begin
  if not app.billing_enforced() or exists (select 1 from public.tenants t where t.id = p_tenant and t.billing_exempt) then
    return jsonb_build_object('access', 'full', 'read_only_since', null, 'delete_on', null, 'data_days_left', null);
  end if;
  v_until := app.billing_access_until(p_tenant);
  if v_until is null or v_now < v_until then
    return jsonb_build_object('access', 'full', 'read_only_since', null, 'delete_on', null, 'data_days_left', null);
  end if;
  return jsonb_build_object('access', 'read_only', 'read_only_since', (v_until at time zone 'Asia/Kolkata')::date,
                            'delete_on', ((v_until + interval '90 days') at time zone 'Asia/Kolkata')::date,
                            'data_days_left', greatest(0, ceil(extract(epoch from (v_until + interval '90 days' - v_now)) / 86400)::integer));
end;
$$;
revoke all on function app.billing_lapse(uuid) from public, anon, authenticated, service_role;

create function app.billing_read_only(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.billing_lapse(p_tenant) ->> 'access' = 'read_only' $$;
revoke all on function app.billing_read_only(uuid) from public, anon, authenticated, service_role;

create function public.billing_access(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  return app.billing_lapse(p_tenant_id);
end;
$$;
revoke all on function public.billing_access(uuid) from public, anon;
grant execute on function public.billing_access(uuid) to authenticated;

-- the plan screen's answer, with the access state in it (a full copy of the migration 3 function plus the four flat keys of app.billing_lapse)
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
    'can_start_trial', not exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id))
    || app.billing_lapse(p_tenant_id);   -- flat: access ('full' | 'read_only'), read_only_since, delete_on, data_days_left
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. read-only stops sending: the claim of the outbox hands out nothing (a full copy of migration 3's function plus the read-only condition)
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
  if app.billing_read_only(p_tenant_id) then
    return v_out;   -- job DI: the trial ended unpaid; read-only: nothing is sent, nothing is lost
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
-- 3. the reminders (the worker; only the registered scheduler account) and the deletion list
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Which reminder is due for each read-only workspace: the LATEST of day 1, 30, 60, 83 that has come and has not been marked. A worker that was down for weeks sends the latest one, not all of them.
create function public.scheduler_billing_reminders_due(p_limit integer default 50) returns jsonb
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
               ((x.until at time zone 'Asia/Kolkata')::date)::text as read_only_since,
               (((x.until + interval '90 days') at time zone 'Asia/Kolkata')::date)::text as delete_on,
               coalesce((select jsonb_agg(u.email order by u.email) from public.memberships m join auth.users u on u.id = m.user_id
                          where m.tenant_id = t.id and m.role = 'owner' and u.email is not null), '[]'::jsonb) as emails
          from public.tenants t
          cross join lateral (select app.billing_access_until(t.id) as until) x0
          cross join lateral (
            select x0.until as until, max(dd.day) as day
              from unnest(array[1, 30, 60, 83]) as dd(day)
             where x0.until is not null and not t.billing_exempt and v_now >= x0.until + make_interval(days => dd.day)
               and not exists (select 1 from public.billing_lapse_reminders r where r.tenant_id = t.id and r.day >= dd.day)
          ) x
         where x.day is not null and v_now < x.until + interval '90 days'
         order by t.id
         limit p_limit
      ) d), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_billing_reminders_due(integer) from public, anon;
grant execute on function public.scheduler_billing_reminders_due(integer) to authenticated;

-- mark a reminder sent; the earlier days are marked with it (they are no longer due)
create function public.scheduler_billing_reminder_mark(p_tenant_id uuid, p_day integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.billing_error('deny');
  end if;
  if p_tenant_id is null or p_day is null or p_day not in (1, 30, 60, 83) or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    perform app.billing_error('invalid');
  end if;
  insert into public.billing_lapse_reminders (tenant_id, day) select p_tenant_id, d from unnest(array[1, 30, 60, 83]::smallint[]) as d where d <= p_day on conflict do nothing;
  return jsonb_build_object('marked', p_day);
end;
$$;
revoke all on function public.scheduler_billing_reminder_mark(uuid, integer) from public, anon;
grant execute on function public.scheduler_billing_reminder_mark(uuid, integer) to authenticated;

-- the workspaces whose 90 days are over (empty while the switch is off). The operator erases them with the existing erasure process after looking; nothing deletes by itself.
create function app.billing_deletion_due() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenant_id', t.id, 'read_only_since', (app.billing_access_until(t.id) at time zone 'Asia/Kolkata')::date) order by t.id), '[]'::jsonb)
    from public.tenants t
   where app.billing_enforced() and not t.billing_exempt and app.billing_access_until(t.id) is not null and app.outbox_now() >= app.billing_access_until(t.id) + interval '90 days'
$$;
revoke all on function app.billing_deletion_due() from public, anon, authenticated, service_role;

create function app.operator_billing_exempt(p_tenant uuid, p_exempt boolean) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  update public.tenants set billing_exempt = coalesce(p_exempt, false) where id = p_tenant;
end;
$$;
revoke all on function app.operator_billing_exempt(uuid, boolean) from public, anon, authenticated, service_role;
