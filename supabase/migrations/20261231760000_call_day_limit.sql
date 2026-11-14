-- A real per-day call limit per business (owner decision, 14 Nov 2026): default 100 calls a day, editable by the Owner in Rules, shown on plan cards, enforced by the server.
--   * outbox_settings.max_calls_per_day (1 to 5000, default 100): the business's own limit. It lives with the other auto-send rules.
--   * app.calls_used_today(tenant): calls made today (India day): the people a plan has already called (done or failed) plus the outbound phone calls that were really placed.
--   * public.task_call_limit(tenant): {limit, used, remaining}: any member that plans (owner, admin, sales).
--   * public.task_call_limit_set(tenant, limit): the Owner (a clear confirmation in the app, no authenticator code: owner, 14 Nov 2026); audited with who and when.
--   * public.task_pause_daily_limit(tenant, task): the runner stops a plan when the day's limit is used up (status paused, pause_reason daily_limit); the Owner resumes it another day.

alter table public.outbox_settings add column max_calls_per_day integer not null default 100 check (max_calls_per_day between 1 and 5000);
comment on column public.outbox_settings.max_calls_per_day is 'SAFE: a count. CLEAN-EXEMPT: integer';

alter table public.tasks drop constraint tasks_pause_reason_check;
alter table public.tasks add constraint tasks_pause_reason_check check (pause_reason in ('cap', 'owner', 'daily_limit'));

create function app.calls_used_today(p_tenant uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.task_contacts c join public.tasks t on t.id = c.task_id and t.tenant_id = c.tenant_id
      where c.tenant_id = p_tenant and c.status in ('done', 'failed') and t.plan ->> 'channel' in ('call', 'both')
        and (c.finished_at at time zone 'Asia/Kolkata')::date = (app.outbox_now() at time zone 'Asia/Kolkata')::date)
    + (select count(*) from public.phone_calls p
        where p.tenant_id = p_tenant and p.direction = 'outbound' and p.refuse_reason is null
          and (p.created_at at time zone 'Asia/Kolkata')::date = (app.outbox_now() at time zone 'Asia/Kolkata')::date)
  )::integer
$$;
revoke all on function app.calls_used_today(uuid) from public, anon, authenticated, service_role;

create function app.calls_limit_of(p_tenant uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select s.max_calls_per_day from public.outbox_settings s where s.tenant_id = p_tenant), 100) $$;
revoke all on function app.calls_limit_of(uuid) from public, anon, authenticated, service_role;

create function public.task_call_limit(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used  integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  v_limit := app.calls_limit_of(p_tenant_id);
  v_used := app.calls_used_today(p_tenant_id);
  return jsonb_build_object('limit', v_limit, 'used', v_used, 'remaining', greatest(0, v_limit - v_used), 'default_limit', 100);
end;
$$;
revoke all on function public.task_call_limit(uuid) from public, anon;
grant execute on function public.task_call_limit(uuid) to authenticated;

create function public.task_call_limit_set(p_tenant_id uuid, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 5000 then
    perform app.task_error('invalid');
  end if;
  insert into public.outbox_settings (tenant_id, max_calls_per_day, updated_by) values (p_tenant_id, p_limit, v_uid)
  on conflict (tenant_id) do update set max_calls_per_day = excluded.max_calls_per_day, updated_by = v_uid, updated_at = now();
  perform app.write_audit_event(p_tenant_id, 'calls.day_limit', 'outbox_settings', p_tenant_id, null, jsonb_build_object('limit', p_limit));
  return public.task_call_limit(p_tenant_id);
end;
$$;
revoke all on function public.task_call_limit_set(uuid, integer) from public, anon;
grant execute on function public.task_call_limit_set(uuid, integer) to authenticated;

-- the runner stops a plan whose calls would go beyond today's limit; nothing is lost (the people still waiting stay waiting), the Owner resumes it another day
create function public.task_pause_daily_limit(p_tenant_id uuid, p_task_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task:' || p_task_id::text, 0));
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.task_error('reference');
  end if;
  if t.status in ('approved', 'running') then
    update public.tasks set status = 'paused', pause_reason = 'daily_limit' where id = t.id returning * into t;
    perform app.write_audit_event(p_tenant_id, 'task.daily_limit', 'task', t.id, null, '{}'::jsonb);
  end if;
  return app.task_json(t);
end;
$$;
revoke all on function public.task_pause_daily_limit(uuid, uuid) from public, anon;
grant execute on function public.task_pause_daily_limit(uuid, uuid) to authenticated;

-- the people list of a plan also names each person's lead (an id, no personal data): "ask first" writes to people through their lead
create or replace function app.task_contact_json(c public.task_contacts, k public.contacts) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'contact_id', c.contact_id, 'lead_id', c.lead_id, 'name', case when k.erased_at is not null then 'erased' else k.full_name end,
           'phone_last4', case when k.erased_at is not null or k.phone is null then null else right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 4) end,
           'status', case when c.status = 'waiting' then 'waiting' else c.status end, 'skip_reason', c.skip_reason, 'outcome', c.outcome, 'outcome_category', c.category,
           'captured', c.captured, 'summary', c.summary, 'message_status', c.message_status, 'simulated', c.simulated)
$$;
