-- The number picker (28 Nov 2026): a business picks its own VoiceLink phone number and we buy it with OUR money. The guardrails live HERE, in the database, so no route and no script can bypass them:
--   * only the workspace Owner, with a second factor (the same rule as every money or line change);
--   * the platform switch (ops.picker_settings.enabled, off until the planner turns it on) and a platform daily cap of purchases (default 5 a day, India time);
--   * the FIRST number is included in every plan; a further one only on a paid plan (a trial or the free early-access plan: one number), and never more than five;
--   * one purchase per number, ever (a number that is being bought or is ours cannot be claimed again);
--   * every claim is a row (who, which workspace, which number, how far it got, what it cost us): the audit and the daily cap are read from it.
-- The wallet floor and the price limits are enforced by the API before it spends (app/numbers/buyer.py). Nothing here calls VoiceLink.

create table ops.picker_settings (
  only_row   boolean primary key default true check (only_row),
  enabled    boolean not null default false,
  daily_cap  integer not null default 5 check (daily_cap between 1 and 50),
  updated_at timestamptz not null default now()
);
insert into ops.picker_settings default values;
comment on table ops.picker_settings is 'Platform data (not tenant data): the one switch and the daily cap of the number picker. No personal data.';
alter table ops.picker_settings enable row level security;
alter table ops.picker_settings force row level security;
revoke all on ops.picker_settings from public, anon, authenticated, service_role;

create function app.operator_set_number_picker(p_enabled boolean, p_daily_cap integer default 5) returns void language sql security definer set search_path = '' as
$$ update ops.picker_settings set enabled = p_enabled, daily_cap = p_daily_cap, updated_at = now() $$;
revoke all on function app.operator_set_number_picker(boolean, integer) from public, anon, authenticated, service_role;

create table ops.number_purchases (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  requested_by uuid not null,
  number       text not null check (number ~ '^\+91[0-9]{10}$'),
  kind         text not null check (kind in ('mobile', 'landline')),
  state        text not null default 'started' check (state in ('started', 'bought', 'mapped', 'routed', 'attached', 'failed')),
  reason       text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  cost_paise   bigint check (cost_paise is null or cost_paise between 0 and 100000000),
  order_number text check (order_number is null or char_length(order_number) <= 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index number_purchases_one_per_number on ops.number_purchases (number) where state <> 'failed';
create index number_purchases_tenant_idx on ops.number_purchases (tenant_id, created_at);
comment on table ops.number_purchases is 'Platform data about OUR purchases: which workspace claimed which number, how far the set-up got, what it cost us. The number is a business line, not a person. No credential.';
comment on column ops.number_purchases.state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column ops.number_purchases.reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed pattern';
comment on column ops.number_purchases.number is 'SAFE: a business phone number we bought. CLEAN-EXEMPT: pattern';
comment on column ops.number_purchases.order_number is 'SAFE: the provider''s order number. CLEAN-EXEMPT: bounded';
alter table ops.number_purchases enable row level security;
alter table ops.number_purchases force row level security;
revoke all on ops.number_purchases from public, anon, authenticated, service_role;

-- why a workspace cannot claim a number right now (null = it can): the ONE place the platform rules live; the claim and the screen's list both ask it
create function app.number_claim_reason(p_tenant_id uuid) returns text language plpgsql stable security definer set search_path = '' as
$$
declare
  v_set  ops.picker_settings;
  v_have integer;
  v_paid boolean;
begin
  select * into v_set from ops.picker_settings;
  if not v_set.enabled then
    return 'paused';
  end if;
  v_paid := coalesce((app.billing_plan_row(p_tenant_id)).kind, 'trial') in ('main', 'calls');
  select (select count(*) from public.phone_numbers n where n.tenant_id = p_tenant_id and n.provider = 'voicelink')
       + (select count(*) from ops.number_purchases x where x.tenant_id = p_tenant_id and x.state in ('started', 'bought', 'mapped', 'routed'))
    into v_have;
  if v_have >= 1 and not v_paid then
    return 'already_has_number';
  end if;
  if v_have >= 5 then
    return 'not_on_plan';
  end if;
  if (select count(*) from ops.number_purchases x where x.state <> 'failed' and x.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')) >= v_set.daily_cap then
    return 'daily_limit';
  end if;
  return null;
end $$;
revoke all on function app.number_claim_reason(uuid) from public, anon, authenticated, service_role;

-- the screen's list asks this first (the Owner or an Admin): null, or the closed reason
create function public.number_claim_check(p_tenant_id uuid) returns text language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  return app.number_claim_reason(p_tenant_id);
end $$;

-- the Owner starts a claim: every platform rule is checked here, atomically with the row that records it
create function public.number_claim_begin(p_tenant_id uuid, p_number text, p_kind text) returns uuid language plpgsql security definer set search_path = '' as
$$
declare
  v_reason text;
  v_id     uuid;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  perform app.require_aal2();
  if p_number is null or p_number !~ '^\+91[0-9]{10}$' or p_kind is null or p_kind not in ('mobile', 'landline') then
    perform app.phone_error('invalid');
  end if;
  v_reason := app.number_claim_reason(p_tenant_id);
  if v_reason = 'paused' then
    raise exception 'numbers cannot be added now' using errcode = 'SM933';
  elsif v_reason = 'already_has_number' then
    raise exception 'one number on this plan' using errcode = 'SM932';
  elsif v_reason = 'not_on_plan' then
    raise exception 'number limit reached' using errcode = 'SM931';
  elsif v_reason = 'daily_limit' then
    raise exception 'daily limit' using errcode = 'SM934';
  end if;
  if exists (select 1 from ops.number_purchases x where x.number = p_number and x.state <> 'failed') or exists (select 1 from public.phone_numbers n where n.number = p_number) then
    raise exception 'number taken' using errcode = 'SM935';
  end if;
  insert into ops.number_purchases (tenant_id, requested_by, number, kind) values (p_tenant_id, auth.uid(), p_number, p_kind) returning id into v_id;
  perform app.write_audit_event(p_tenant_id, 'number.claim_started', 'workspace', p_tenant_id, null, jsonb_build_object('kind', p_kind));
  return v_id;
end $$;

-- how far the claim got (the API reports each step); a finished or failed claim never moves again
create function public.number_claim_finish(p_id uuid, p_state text, p_reason text default null, p_cost_paise bigint default null, p_order_number text default null) returns void language plpgsql security definer set search_path = '' as
$$
declare
  r ops.number_purchases;
begin
  select * into r from ops.number_purchases x where x.id = p_id;
  if not found or auth.uid() is null or not app.has_tenant_role(r.tenant_id, array['owner']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  if p_state is null or p_state not in ('bought', 'mapped', 'routed', 'failed') or r.state in ('attached', 'failed') then
    perform app.phone_error('state');
  end if;
  update ops.number_purchases set state = p_state, reason = coalesce(p_reason, reason), cost_paise = coalesce(p_cost_paise, cost_paise), order_number = coalesce(p_order_number, order_number), updated_at = now() where id = p_id;
  if p_state = 'failed' then
    perform app.write_audit_event(r.tenant_id, 'number.claim_failed', 'workspace', r.tenant_id, null, jsonb_build_object('reason', coalesce(p_reason, 'unknown')));
  end if;
end $$;

-- the number works at VoiceLink (bought, given to our client, pointed at our bot): it becomes the workspace's line, with calls OFF (the Owner switches them on after a test call)
create function public.number_claim_attach(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  r ops.number_purchases;
  n public.phone_numbers;
begin
  select * into r from ops.number_purchases x where x.id = p_id;
  if not found or auth.uid() is null or not app.has_tenant_role(r.tenant_id, array['owner']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  if r.state <> 'routed' then
    perform app.phone_error('state');
  end if;
  insert into public.phone_numbers (tenant_id, number, label, inbound_on, provider) values (r.tenant_id, r.number, 'VoiceLink', false, 'voicelink') returning * into n;
  update ops.number_purchases set state = 'attached', updated_at = now() where id = p_id;
  perform app.write_audit_event(r.tenant_id, 'number.claimed', 'workspace', r.tenant_id, null, jsonb_build_object('kind', r.kind));
  return jsonb_build_object('number', n.number, 'kind', r.kind, 'inbound_on', n.inbound_on);
end $$;

-- the workspace's VoiceLink numbers and the claims in progress (any member may read)
create function public.numbers_list(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  return coalesce((select jsonb_agg(row_to_json(t)::jsonb order by t.created_at) from (
    select n.number, coalesce(x.kind, 'mobile') as kind, case when n.inbound_on then 'calls_on' else 'calls_off' end as state, n.label, n.created_at
      from public.phone_numbers n left join ops.number_purchases x on x.number = n.number and x.state = 'attached'
     where n.tenant_id = p_tenant_id and n.provider = 'voicelink'
    union all
    select x.number, x.kind, 'getting_ready', 'VoiceLink', x.created_at
      from ops.number_purchases x where x.tenant_id = p_tenant_id and x.state in ('started', 'bought', 'mapped', 'routed')) t), '[]'::jsonb);
end $$;

revoke all on function public.number_claim_check(uuid), public.number_claim_begin(uuid, text, text), public.number_claim_finish(uuid, text, text, bigint, text), public.number_claim_attach(uuid), public.numbers_list(uuid) from public, anon;
grant execute on function public.number_claim_check(uuid), public.number_claim_begin(uuid, text, text), public.number_claim_finish(uuid, text, text, bigint, text), public.number_claim_attach(uuid), public.numbers_list(uuid) to authenticated;
