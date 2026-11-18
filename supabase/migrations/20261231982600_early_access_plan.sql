-- FREE EARLY ACCESS (owner, 18 Nov 2026; planner decision): real businesses sign up and use the product for free, with no billing at launch. What stops cost per business, in data:
--   * the plan `early_access`: its call-minute and business-message allowances are ONE ROW (`billing.plan_overrides`), editable by the operator without a new catalogue version
--     (the owner's numbers, 18 Nov: 60 call minutes and 300 business-initiated messages a month, one number; AI is fair use as in free_trial);
--   * a workspace on it never lapses (no trial clock, no read-only): the existing `tenants.billing_exempt` flag is set by the plan (a trigger), so every function that already reads it follows;
--   * the meter is now connected to the CALL path: every finished, real, non-simulated call records its seconds (30-second pulses, like the provider), a line lookup says `billing_blocked` when the
--     meter is stopped (only while the platform switch `billing_enforced` is on, as before), and the outbound and inbound call paths refuse with the closed word `billing_blocked`;
--   * `app.operator_set_new_tenant_plan('early_access')` makes new workspaces start on it (the operator runs it on the day; nothing changes until then).
-- Billing stays OFF at launch for payments; `billing_enforced` is turned on only to enforce these free allowances (staging first, the owner's OK for production).

insert into billing.plans (id) values ('early_access') on conflict do nothing;
insert into public.plan_ai_allowances (plan, daily_paise, monthly_paise) select 'early_access', a.daily_paise, a.monthly_paise from public.plan_ai_allowances a where a.plan = 'free_trial' on conflict do nothing;
insert into public.plan_voice_allowances (plan, daily_seconds, monthly_seconds) select 'early_access', v.daily_seconds, v.monthly_seconds from public.plan_voice_allowances v where v.plan = 'free_trial' on conflict do nothing;

create table billing.plan_overrides (
  plan_id           text primary key references billing.plans (id),
  call_minutes      integer not null check (call_minutes between 0 and 100000),
  whatsapp_messages integer not null check (whatsapp_messages between 0 and 1000000),
  never_lapses      boolean not null default true,
  updated_at        timestamptz not null default now()
);
comment on table billing.plan_overrides is 'Operator data: the allowances of a plan that is not in the published catalogue (free early access). SAFE: not personal data.';
alter table billing.plan_overrides enable row level security;
alter table billing.plan_overrides force row level security;
revoke all on billing.plan_overrides from public, anon, authenticated, service_role;
insert into billing.plan_overrides (plan_id, call_minutes, whatsapp_messages, never_lapses) values ('early_access', 60, 300, true);

-- the row of the plan in force: the catalogue's, else the operator's override (built as a row of the same shape, so every function that reads it follows)
alter function app.billing_plan_row(uuid) rename to billing_plan_row_catalogue;
create function app.billing_plan_row(p_tenant uuid) returns billing.plan_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r billing.plan_versions;
begin
  r := app.billing_plan_row_catalogue(p_tenant);
  if r.plan_id is not null then
    return r;
  end if;
  select (row(app.billing_current_version(), o.plan_id, 'trial', 0, jsonb_build_object('en', 'Free early access'), null, null, null, o.call_minutes, o.whatsapp_messages, 1, 1)::billing.plan_versions).* into r
    from public.tenants t join billing.plan_overrides o on o.plan_id = t.plan where t.id = p_tenant;
  return r;
end;
$$;
revoke all on function app.billing_plan_row(uuid) from public, anon, authenticated, service_role;
revoke all on function app.billing_plan_row_catalogue(uuid) from public, anon, authenticated, service_role;

-- a workspace on a plan that never lapses is exempt from the lapse (and from the trial reminders); leaving it undoes only what the plan did (a demo keeps its own flag)
create function app.tenant_plan_exempt() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from billing.plan_overrides o where o.plan_id = new.plan and o.never_lapses) then
    new.billing_exempt := true;
  elsif tg_op = 'UPDATE' and old.plan is distinct from new.plan
        and exists (select 1 from billing.plan_overrides o where o.plan_id = old.plan and o.never_lapses) and not coalesce(new.demo, false) then
    new.billing_exempt := false;
  end if;
  return new;
end;
$$;
revoke all on function app.tenant_plan_exempt() from public, anon, authenticated, service_role;
create trigger tenants_plan_exempt before insert or update of plan on public.tenants for each row execute function app.tenant_plan_exempt();

-- the call path: the seconds of every real call are metered when it ends (idempotent by the call id); a simulated call, the fake provider, and a call a standing rule placed (its own result records it) are not counted here
create function app.phone_call_metered() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.ended_at is null and new.ended_at is not null and coalesce(new.duration_s, 0) > 0 and not new.simulated and new.provider <> 'sandbox' and new.outreach_item_id is null then   -- a call a standing rule placed is recorded by its own result (scheduler_outreach_result): never twice
    perform app.billing_record(new.tenant_id, 'call_minutes', new.id, least(((new.duration_s + 29) / 30) * 30, 86400));
  end if;
  return new;
end;
$$;
revoke all on function app.phone_call_metered() from public, anon, authenticated, service_role;
create trigger phone_calls_metered after update on public.phone_calls for each row execute function app.phone_call_metered();

-- the line lookups tell the call path when the meter is stopped
do $patch$
declare
  v_def text := pg_get_functiondef('public.phone_line_find(text)'::regprocedure);
  v_old text := $q$'provider', n.provider, 'account_ref', n.account_ref, 'external_ref', n.external_ref);$q$;
  v_new text := $q$'provider', n.provider, 'account_ref', n.account_ref, 'external_ref', n.external_ref, 'billing_blocked', app.billing_stopped(n.tenant_id, 'call_minutes'));$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'phone_line_find has changed: the billing patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
do $patch$
declare
  v_def text := pg_get_functiondef('public.phone_line_for_tenant(uuid,text)'::regprocedure);
  v_old text := $q$'provider', n.provider, 'account_ref', n.account_ref, 'external_ref', n.external_ref);$q$;
  v_new text := $q$'provider', n.provider, 'account_ref', n.account_ref, 'external_ref', n.external_ref, 'billing_blocked', app.billing_stopped(n.tenant_id, 'call_minutes'));$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'phone_line_for_tenant has changed: the billing patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- operator functions (no signed-in user): the allowance row and the plan new workspaces start on
create function app.operator_set_plan_allowance(p_plan text, p_call_minutes integer, p_messages integer) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  update billing.plan_overrides set call_minutes = p_call_minutes, whatsapp_messages = p_messages, updated_at = now() where plan_id = p_plan;
  if not found then
    raise exception 'unknown plan' using errcode = '23503';
  end if;
end;
$$;
revoke all on function app.operator_set_plan_allowance(text, integer, integer) from public, anon, authenticated, service_role;

create function app.operator_set_new_tenant_plan(p_plan text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  if not exists (select 1 from billing.plans p where p.id = p_plan) then
    raise exception 'unknown plan' using errcode = '23503';
  end if;
  execute format('alter table public.tenants alter column plan set default %L', p_plan);
end;
$$;
revoke all on function app.operator_set_new_tenant_plan(text) from public, anon, authenticated, service_role;
