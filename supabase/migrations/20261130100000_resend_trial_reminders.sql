-- Job RESEND (26 Oct 2026): the trial reminder e-mails, and the language of the reminders.
--
--   public.billing_trial_reminders          which trial reminders (day 11, day 13) were sent to which workspace; written only by the scheduler's function
--   public.scheduler_billing_trial_due      the Owners to e-mail: a trialing workspace on day 11 (3 days left) and day 13 (1 day left) of its trial; the latest unmarked day only
--   public.scheduler_billing_trial_mark     the scheduler marks a day sent
--   public.scheduler_billing_pending_due    a FULL COPY of job DM's function that also says `language` (en, te or hi: the AI assistant's main language when it is one of those, else en)
--
--   Like every billing reminder: only while the platform's billing switch is on, never for an exempt workspace, and the sender decides whether anything leaves (fake / Resend).
--   The days count from the trial's start: trial_ends_at minus the catalogue's trial days.

create table public.billing_trial_reminders (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  day       smallint not null check (day in (11, 13)),
  sent_at   timestamptz not null default app.outbox_now(),
  primary key (tenant_id, day)
);
alter table public.billing_trial_reminders enable row level security;
alter table public.billing_trial_reminders force row level security;
revoke all on public.billing_trial_reminders from public, anon, authenticated, service_role;
grant select on public.billing_trial_reminders to authenticated;
create policy billing_trial_reminders_select on public.billing_trial_reminders for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger billing_trial_reminders_forbid_tenant_id_change before update on public.billing_trial_reminders for each row execute function app.forbid_tenant_id_change();
create trigger audit_billing_trial_reminders after insert on public.billing_trial_reminders for each row execute function app.audit_row_change('billing_trial_reminder', '');
create trigger billing_trial_reminders_guard before update or delete on public.billing_trial_reminders for each row execute function app.billing_rows_guard();
create trigger billing_trial_reminders_no_truncate before truncate on public.billing_trial_reminders for each statement execute function app.billing_rows_guard();

create function app.billing_mail_language(p_tenant uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select a.main_language from public.assistant_settings a where a.tenant_id = p_tenant and a.main_language in ('en', 'te', 'hi')), 'en') $$;
revoke all on function app.billing_mail_language(uuid) from public, anon, authenticated, service_role;

create function public.scheduler_billing_trial_due(p_limit integer default 50) returns jsonb
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
        select t.id as tenant_id, t.name as tenant_name, x.day, app.billing_mail_language(t.id) as language,
               coalesce((select jsonb_agg(u.email order by u.email) from public.memberships m join auth.users u on u.id = m.user_id
                          where m.tenant_id = t.id and m.role = 'owner' and u.email is not null), '[]'::jsonb) as emails
          from public.billing_subscriptions s
          join public.tenants t on t.id = s.tenant_id
          join billing.catalogue_versions c on c.version = s.catalogue_version
          cross join lateral (
            select max(dd.day) as day
              from unnest(array[11, 13]) as dd(day)
             where v_now >= s.trial_ends_at - make_interval(days => c.trial_days) + make_interval(days => dd.day)
               and not exists (select 1 from public.billing_trial_reminders r where r.tenant_id = t.id and r.day >= dd.day)
          ) x
         where s.status = 'trialing' and s.trial_ends_at is not null and v_now < s.trial_ends_at and not t.billing_exempt and x.day is not null
         order by t.id
         limit p_limit
      ) d), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_billing_trial_due(integer) from public, anon;
grant execute on function public.scheduler_billing_trial_due(integer) to authenticated;

create function public.scheduler_billing_trial_mark(p_tenant_id uuid, p_day integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.billing_error('deny');
  end if;
  if p_tenant_id is null or p_day is null or p_day not in (11, 13) or not exists (select 1 from public.billing_subscriptions s where s.tenant_id = p_tenant_id and s.status = 'trialing') then
    perform app.billing_error('invalid');
  end if;
  insert into public.billing_trial_reminders (tenant_id, day) select p_tenant_id, d from unnest(array[11, 13]::smallint[]) as d where d <= p_day on conflict do nothing;
  return jsonb_build_object('marked', p_day);
end;
$$;
revoke all on function public.scheduler_billing_trial_mark(uuid, integer) from public, anon;
grant execute on function public.scheduler_billing_trial_mark(uuid, integer) to authenticated;

-- a full copy of job DM's function with one added column
create or replace function public.scheduler_billing_pending_due(p_limit integer default 50) returns jsonb
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
        select t.id as tenant_id, t.name as tenant_name, x.day, app.billing_mail_language(t.id) as language,
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
