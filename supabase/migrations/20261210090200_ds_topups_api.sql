-- Job DS part E2 (night 4, ADR 0114): migration 3 of 3: the doors (Owner / Admin), the worker's calls, Today's "Needs you", and the outreach functions that learn the status waiting_for_minutes.
-- Public functions: SECURITY DEFINER, empty search_path, no anon. Owner and Admin read; the Owner with a second factor changes anything. The payment is FAKE and is made by the API's provider before these run.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. reading: packs, balance, settings, history; invoices
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.topup_settings_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'auto_minutes_pack', s.auto_minutes_pack, 'auto_messages_pack', s.auto_messages_pack, 'auto_monthly_cap_paise', coalesce(s.auto_monthly_cap_paise, 0),
    'overage_minutes', coalesce(s.overage_minutes, false), 'overage_messages', coalesce(s.overage_messages, false), 'overage_monthly_cap_paise', coalesce(s.overage_monthly_cap_paise, 0),
    'overage_rate_paise_per_minute', app.topup_overage_rate(p_tenant, 'call_minutes'), 'overage_rate_paise_per_message', app.topup_overage_rate(p_tenant, 'whatsapp_messages'),
    'auto_spent_paise', (select coalesce(sum(inv.total_paise), 0) from public.billing_topup_purchases p join public.billing_invoices inv on inv.tenant_id = p.tenant_id and inv.id = p.invoice_id, app.billing_period(p_tenant) w
                          where p.tenant_id = p_tenant and p.source = 'auto' and (p.purchased_at at time zone 'Asia/Kolkata')::date >= w.o_start and (p.purchased_at at time zone 'Asia/Kolkata')::date < w.o_end),
    'overage_spent_paise', app.topup_overage_spent(p_tenant))
  from (select 1) one left join public.billing_topup_settings s on s.tenant_id = p_tenant
$$;
revoke all on function app.topup_settings_json(uuid) from public, anon, authenticated, service_role;

create function app.topup_lots_json(p_tenant uuid, p_kind text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('units', round(app.topup_balance(p_tenant, p_kind)::numeric / app.topup_mult(p_kind), 1),
    'lots', coalesce((select jsonb_agg(jsonb_build_object('purchase_id', x.id, 'units_left', x.left_units, 'purchased_at', x.purchased_at, 'expires_at', x.expires_at) order by x.purchased_at, x.id)
                        from (select p.id, p.purchased_at, p.expires_at,
                                     round(greatest(p.units::bigint * app.topup_mult(p_kind) - coalesce((select sum(d.units) from public.billing_topup_draws d where d.tenant_id = p.tenant_id and d.purchase_id = p.id), 0), 0)::numeric / app.topup_mult(p_kind), 1) as left_units
                                from public.billing_topup_purchases p where p.tenant_id = p_tenant and p.kind = p_kind and p.expires_at > app.outbox_now()) x
                       where x.left_units > 0), '[]'::jsonb))
$$;
revoke all on function app.topup_lots_json(uuid, text) from public, anon, authenticated, service_role;

create function public.billing_topups_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c billing.topup_config := app.topup_cfg();
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.topup_error('deny');
  end if;
  return jsonb_build_object(
    'packs', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'kind', k.kind, 'units', k.units, 'price_paise', k.price_paise, 'gst_rate_bp', c.gst_rate_bp, 'gst_paise', app.topup_gst(k.price_paise),
                                                           'total_paise', k.price_paise + app.topup_gst(k.price_paise), 'price_is_placeholder', c.price_is_placeholder) order by k.sort) from billing.topup_packs k), '[]'::jsonb),
    'balance', jsonb_build_object('call_minutes', app.topup_lots_json(p_tenant_id, 'call_minutes'), 'whatsapp_messages', app.topup_lots_json(p_tenant_id, 'whatsapp_messages')),
    'settings', app.topup_settings_json(p_tenant_id),
    'history', coalesce((select jsonb_agg(app.topup_purchase_json(h) order by h.purchased_at desc, h.id) from (select * from public.billing_topup_purchases p where p.tenant_id = p_tenant_id order by p.purchased_at desc, p.id limit 20) h), '[]'::jsonb));
end;
$$;
revoke all on function public.billing_topups_get(uuid) from public, anon;
grant execute on function public.billing_topups_get(uuid) to authenticated;

create function public.billing_invoices_list(p_tenant_id uuid, p_limit integer default 50, p_after_at timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.topup_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.topup_error('invalid');
  end if;
  return coalesce((select jsonb_agg(app.invoice_json(x) order by x.issued_at desc, x.id desc)
                     from (select * from public.billing_invoices i where i.tenant_id = p_tenant_id and (p_after_at is null or (i.issued_at, i.id) < (p_after_at, p_after_id))
                            order by i.issued_at desc, i.id desc limit p_limit) x), '[]'::jsonb);
end;
$$;
revoke all on function public.billing_invoices_list(uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.billing_invoices_list(uuid, integer, timestamptz, uuid) to authenticated;

create function public.billing_invoice_get(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.billing_invoices;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.topup_error('deny');
  end if;
  select * into i from public.billing_invoices x where x.tenant_id = p_tenant_id and x.id = p_id;
  if not found then
    perform app.topup_error('reference');
  end if;
  return app.invoice_json(i);
end;
$$;
revoke all on function public.billing_invoice_get(uuid, uuid) from public, anon;
grant execute on function public.billing_invoice_get(uuid, uuid) to authenticated;

-- the usage view gains the number of calls waiting for minutes
create or replace function public.billing_usage_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  return jsonb_build_object('period', app.billing_period_json(p_tenant_id), 'usage', app.billing_usage_json(p_tenant_id), 'notices', app.billing_notices_json(p_tenant_id),
                            'queued_calls', (select count(*) from public.outreach_items i where i.tenant_id = p_tenant_id and i.status = 'waiting_for_minutes'));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. changing: buy a pack, the settings, the upgrade (Owner + second factor)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.billing_topup_buy(p_tenant_id uuid, p_purchase_id uuid, p_pack_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     jsonb;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.topup_error('deny');
  end if;
  perform app.require_aal2();
  if p_purchase_id is null or p_pack_code is null or p_pack_code !~ '^[a-z0-9_]{3,30}$' then
    perform app.topup_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_tenant_id::text, 0));
  r := app.topup_buy(p_tenant_id, p_purchase_id, p_pack_code, 'manual', v_uid);
  return r || jsonb_build_object('usage', app.billing_usage_json(p_tenant_id));
end;
$$;
revoke all on function public.billing_topup_buy(uuid, uuid, text) from public, anon;
grant execute on function public.billing_topup_buy(uuid, uuid, text) to authenticated;

create function public.billing_topup_settings_set(p_tenant_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k text;
  v_am text; v_as text; v_cap bigint; v_om boolean; v_os boolean; v_ocap bigint;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.topup_error('deny');
  end if;
  perform app.require_aal2();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform app.topup_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_settings) loop
    if k not in ('auto_minutes_pack', 'auto_messages_pack', 'auto_monthly_cap_paise', 'overage_minutes', 'overage_messages', 'overage_monthly_cap_paise') then
      perform app.topup_error('invalid');
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p_settings)) <> 6 then
    perform app.topup_error('invalid');
  end if;
  if jsonb_typeof(p_settings -> 'overage_minutes') <> 'boolean' or jsonb_typeof(p_settings -> 'overage_messages') <> 'boolean'
     or jsonb_typeof(p_settings -> 'auto_monthly_cap_paise') <> 'number' or jsonb_typeof(p_settings -> 'overage_monthly_cap_paise') <> 'number'
     or jsonb_typeof(p_settings -> 'auto_minutes_pack') not in ('string', 'null') or jsonb_typeof(p_settings -> 'auto_messages_pack') not in ('string', 'null') then
    perform app.topup_error('invalid');
  end if;
  v_am := p_settings ->> 'auto_minutes_pack'; v_as := p_settings ->> 'auto_messages_pack';
  v_cap := (p_settings ->> 'auto_monthly_cap_paise')::numeric::bigint; v_ocap := (p_settings ->> 'overage_monthly_cap_paise')::numeric::bigint;
  v_om := (p_settings ->> 'overage_minutes')::boolean; v_os := (p_settings ->> 'overage_messages')::boolean;
  if v_cap < 0 or v_cap > 1000000000 or v_ocap < 0 or v_ocap > 1000000000 then
    perform app.topup_error('invalid');
  end if;
  if (v_am is not null and not exists (select 1 from billing.topup_packs x where x.code = v_am and x.kind = 'call_minutes'))
     or (v_as is not null and not exists (select 1 from billing.topup_packs x where x.code = v_as and x.kind = 'whatsapp_messages')) then
    perform app.topup_error('pack');
  end if;
  if ((v_am is not null or v_as is not null) and v_cap = 0) or ((v_om or v_os) and v_ocap = 0) then
    perform app.topup_error('cap');
  end if;
  insert into public.billing_topup_settings (tenant_id, auto_minutes_pack, auto_messages_pack, auto_monthly_cap_paise, overage_minutes, overage_messages, overage_monthly_cap_paise, updated_by, updated_at)
  values (p_tenant_id, v_am, v_as, v_cap, v_om, v_os, v_ocap, v_uid, app.outbox_now())
  on conflict (tenant_id) do update set auto_minutes_pack = excluded.auto_minutes_pack, auto_messages_pack = excluded.auto_messages_pack, auto_monthly_cap_paise = excluded.auto_monthly_cap_paise,
    overage_minutes = excluded.overage_minutes, overage_messages = excluded.overage_messages, overage_monthly_cap_paise = excluded.overage_monthly_cap_paise, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform app.topup_requeue(p_tenant_id);   -- an overage that now covers the queue lets it go (the worker looks again before it calls)
  return app.topup_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.billing_topup_settings_set(uuid, jsonb) from public, anon;
grant execute on function public.billing_topup_settings_set(uuid, jsonb) to authenticated;

-- the pro-rata of a mid-month upgrade (whole paise, half up), computed in one place for the preview and the upgrade
create function app.upgrade_calc(p_tenant uuid, p_plan text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sub  public.billing_subscriptions;
  cur  billing.plan_versions;
  tgt  billing.plan_versions;
  w    record;
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_days integer;
  v_left integer;
  v_set  boolean;
  v_pro  bigint;
  v_note text;
begin
  select * into sub from public.billing_subscriptions s where s.tenant_id = p_tenant;
  if not found or sub.status not in ('trial_pending', 'trialing', 'active') then
    perform app.topup_error('nosub');
  end if;
  select * into tgt from billing.plan_versions pv where pv.plan_id = p_plan and pv.kind in ('main', 'calls') and pv.catalogue_version <= sub.catalogue_version order by pv.catalogue_version desc limit 1;
  if not found then
    perform app.billing_error('plan');
  end if;
  select * into cur from billing.plan_versions pv where pv.plan_id = sub.plan_id and pv.catalogue_version <= sub.catalogue_version order by pv.catalogue_version desc limit 1;
  if tgt.sort <= cur.sort then
    perform app.topup_error('upgrade');
  end if;
  select * into w from app.billing_period(p_tenant);
  v_days := w.o_end - w.o_start;
  v_left := greatest(0, w.o_end - v_today);
  v_set := tgt.price_paise_monthly is not null and cur.price_paise_monthly is not null;
  if sub.status <> 'active' then
    v_pro := 0;
    v_note := 'Nothing is charged during the trial. The plan you chose changes now and starts after the trial.';
  elsif v_set then
    v_pro := (greatest(tgt.price_paise_monthly - cur.price_paise_monthly, 0)::bigint * v_left * 2 + v_days) / (2 * v_days);
    v_note := 'Pro-rata for the days left in this period. The new allowance applies now.';
  else
    v_pro := null;
    v_note := 'Prices are not set yet: nothing is charged and a zero-rupee test invoice is recorded. The new allowance applies now.';
  end if;
  return jsonb_build_object('from_plan_id', sub.plan_id, 'to_plan_id', tgt.plan_id, 'subscription_status', sub.status, 'price_set', v_set, 'days_in_period', v_days, 'days_left', v_left,
    'prorated_paise', v_pro, 'gst_paise', case when v_pro is null then null else app.topup_gst(v_pro) end, 'total_paise', case when v_pro is null then null else v_pro + app.topup_gst(v_pro) end,
    'new_allowances', jsonb_build_object('call_minutes', tgt.call_minutes, 'whatsapp_messages', tgt.whatsapp_messages), 'effective', 'now', 'note', v_note,
    'to_plan_name', tgt.name ->> 'en');
end;
$$;
revoke all on function app.upgrade_calc(uuid, text) from public, anon, authenticated, service_role;

create function public.billing_upgrade_preview(p_tenant_id uuid, p_plan_id text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.topup_error('deny');
  end if;
  if p_plan_id is null or p_plan_id !~ '^[a-z][a-z0-9_]{1,30}$' then
    perform app.topup_error('invalid');
  end if;
  return app.upgrade_calc(p_tenant_id, p_plan_id) - 'to_plan_name' - 'subscription_status';
end;
$$;
revoke all on function public.billing_upgrade_preview(uuid, text) from public, anon;
grant execute on function public.billing_upgrade_preview(uuid, text) to authenticated;

create function public.billing_upgrade(p_tenant_id uuid, p_plan_id text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c     jsonb;
  w     record;
  v_inv uuid;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.topup_error('deny');
  end if;
  perform app.require_aal2();
  if p_plan_id is null or p_plan_id !~ '^[a-z][a-z0-9_]{1,30}$' then
    perform app.topup_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_tenant_id::text, 0));
  c := app.upgrade_calc(p_tenant_id, p_plan_id);
  perform app.billing_edit(true);
  update public.billing_subscriptions set plan_id = c ->> 'to_plan_id', updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id;
  if c ->> 'subscription_status' = 'active' then
    update public.tenants set plan = c ->> 'to_plan_id' where id = p_tenant_id;   -- the new allowance applies at once; billing_anchor_at (the period) does not move
  end if;
  perform app.billing_edit(false);
  if c ->> 'subscription_status' = 'active' then
    select * into w from app.billing_period(p_tenant_id);
    v_inv := app.invoice_make(p_tenant_id, 'upgrade', 'Upgrade to ' || (c ->> 'to_plan_name') || ' (pro-rata, ' || (c ->> 'days_left') || ' days left)', coalesce((c ->> 'prorated_paise')::bigint, 0), w.o_start);
  end if;
  perform app.topup_requeue(p_tenant_id);
  return jsonb_build_object('billing', public.billing_get(p_tenant_id), 'invoice', (select app.invoice_json(i) from public.billing_invoices i where i.tenant_id = p_tenant_id and i.id = v_inv));
end;
$$;
revoke all on function public.billing_upgrade(uuid, text) from public, anon;
grant execute on function public.billing_upgrade(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the worker: close the period (one overage invoice), and the alerts
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.topup_overage_cost_in(p_tenant uuid, p_kind text, p_start date, p_end date) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pv billing.plan_versions := app.billing_plan_row(p_tenant);
  v_base bigint;
  v_used bigint;
  v_leg  bigint;
  v_drawn bigint;
  v_unf  bigint;
begin
  v_base := case p_kind when 'call_minutes' then pv.call_minutes::bigint * 60 else pv.whatsapp_messages::bigint end;
  if v_base is null then
    return 0;
  end if;
  select coalesce(sum(x.units), 0) into v_used from public.billing_usage_events x
   where x.tenant_id = p_tenant and x.kind = p_kind and (x.at at time zone 'Asia/Kolkata')::date >= p_start and (x.at at time zone 'Asia/Kolkata')::date < p_end;
  select coalesce(sum(x.units), 0) * app.topup_mult(p_kind) into v_leg from public.billing_topups x
   where x.tenant_id = p_tenant and x.kind = p_kind and (x.at at time zone 'Asia/Kolkata')::date >= p_start and (x.at at time zone 'Asia/Kolkata')::date < p_end;
  select coalesce(sum(d.units), 0) into v_drawn from public.billing_topup_draws d
   where d.tenant_id = p_tenant and d.kind = p_kind and (d.at at time zone 'Asia/Kolkata')::date >= p_start and (d.at at time zone 'Asia/Kolkata')::date < p_end;
  v_unf := greatest(v_used - v_base - v_leg - v_drawn, 0);
  return ((v_unf + app.topup_mult(p_kind) - 1) / app.topup_mult(p_kind)) * app.topup_overage_rate(p_tenant, p_kind);
end;
$$;
revoke all on function app.topup_overage_cost_in(uuid, text, date, date) from public, anon, authenticated, service_role;

-- once a period has ended, the overage of that period goes on ONE invoice (capped at the Owner's monthly cap); only while the platform's billing switch is on
create function public.scheduler_billing_topup_tick(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s     record;
  cur   record;
  prv   record;
  v_amt bigint;
  v_n   integer := 0;
begin
  if not app.is_scheduler() then
    perform app.topup_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.topup_error('invalid');
  end if;
  if not app.billing_enforced() then
    return jsonb_build_object('invoices', 0);
  end if;
  for s in select x.* from public.billing_topup_settings x join public.tenants t on t.id = x.tenant_id
            where (x.overage_minutes or x.overage_messages) and x.overage_monthly_cap_paise > 0 and not t.billing_exempt order by x.tenant_id limit p_limit loop
    select * into cur from app.billing_period(s.tenant_id);
    select * into prv from app.billing_period_at(s.tenant_id, cur.o_start - 1);
    if exists (select 1 from public.billing_invoices i where i.tenant_id = s.tenant_id and i.kind = 'overage' and i.period_start = prv.o_start) then
      continue;
    end if;
    v_amt := (case when s.overage_minutes then app.topup_overage_cost_in(s.tenant_id, 'call_minutes', prv.o_start, prv.o_end) else 0 end)
           + (case when s.overage_messages then app.topup_overage_cost_in(s.tenant_id, 'whatsapp_messages', prv.o_start, prv.o_end) else 0 end);
    v_amt := least(v_amt, s.overage_monthly_cap_paise);
    if v_amt > 0 then
      perform app.invoice_make(s.tenant_id, 'overage', 'Overage for the period starting ' || to_char(prv.o_start, 'DD Mon YYYY'), v_amt, prv.o_start);
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('invoices', v_n);
end;
$$;
revoke all on function public.scheduler_billing_topup_tick(integer) from public, anon;
grant execute on function public.scheduler_billing_topup_tick(integer) to authenticated;

-- the alerts still to send: one row per workspace, kind and level of THIS period, with the channels not yet used (e-mail, WhatsApp to the owner). Level 80 is dropped when 100 exists. Only while billing is on.
create function public.scheduler_usage_alerts_due(p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.topup_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.topup_error('invalid');
  end if;
  if not app.billing_enforced() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(d)::jsonb)
      from (
        select t.id as tenant_id, t.name as tenant_name, n.kind, n.level, n.period_start::text as period_start,
               app.topup_projection(t.id, n.kind)::text as projected_run_out_on,
               (app.billing_meter(t.id, n.kind) ->> 'queued')::integer as queued,
               'en'::text as language,
               coalesce((select jsonb_agg(u.email order by u.email) from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = t.id and m.role = 'owner' and u.email is not null), '[]'::jsonb) as emails,
               (select jsonb_agg(ch order by ch) from unnest(array['email', 'whatsapp']) ch
                 where not exists (select 1 from public.billing_alert_sends a where a.tenant_id = n.tenant_id and a.kind = n.kind and a.level = n.level and a.period_start = n.period_start and a.channel = ch)) as channels
          from public.billing_notices n
          join public.tenants t on t.id = n.tenant_id
          cross join lateral app.billing_period(t.id) w
         where n.period_start = w.o_start and not t.billing_exempt
           and (n.level = 100 or not exists (select 1 from public.billing_notices n2 where n2.tenant_id = n.tenant_id and n2.kind = n.kind and n2.period_start = n.period_start and n2.level = 100))
           and exists (select 1 from unnest(array['email', 'whatsapp']) ch
                        where not exists (select 1 from public.billing_alert_sends a where a.tenant_id = n.tenant_id and a.kind = n.kind and a.level = n.level and a.period_start = n.period_start and a.channel = ch))
         order by n.at, n.tenant_id, n.kind, n.level
         limit p_limit
      ) d), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_usage_alerts_due(integer) from public, anon;
grant execute on function public.scheduler_usage_alerts_due(integer) to authenticated;

create function public.scheduler_usage_alert_mark(p_tenant_id uuid, p_kind text, p_level integer, p_period_start date, p_channel text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.topup_error('deny');
  end if;
  if p_tenant_id is null or p_kind is null or p_kind not in ('call_minutes', 'whatsapp_messages') or p_level is null or p_level not in (80, 100) or p_period_start is null
     or p_channel is null or p_channel not in ('email', 'whatsapp')
     or not exists (select 1 from public.billing_notices n where n.tenant_id = p_tenant_id and n.kind = p_kind and n.level = p_level and n.period_start = p_period_start) then
    perform app.topup_error('invalid');
  end if;
  insert into public.billing_alert_sends (tenant_id, kind, level, period_start, channel) values (p_tenant_id, p_kind, p_level, p_period_start, p_channel) on conflict do nothing;
  return jsonb_build_object('marked', p_channel);
end;
$$;
revoke all on function public.scheduler_usage_alert_mark(uuid, text, integer, date, text) from public, anon;
grant execute on function public.scheduler_usage_alert_mark(uuid, text, integer, date, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Today's "Needs you": "your minutes are at 80 percent / used up" (Owner, Admin; only while billing is on). today_summary runs as the caller, so the notices are read by a helper
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.today_usage_items(p_tenant uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[]) or not app.billing_enforced() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', case when n.level = 100 then 'topup_empty' else 'topup_low' end, 'id', md5('usage:' || n.tenant_id::text || ':' || n.kind || ':' || n.level::text || ':' || n.period_start::text)::uuid,
                                        'ref', n.kind, 'at', n.at) order by n.at)
      from public.billing_notices n, app.billing_period(p_tenant) w
     where n.tenant_id = p_tenant and n.period_start = w.o_start
       and (n.level = 100 or not exists (select 1 from public.billing_notices n2 where n2.tenant_id = n.tenant_id and n2.kind = n.kind and n2.period_start = n.period_start and n2.level = 100))
       and (n.level = 80 or app.topup_balance(p_tenant, n.kind) = 0)), '[]'::jsonb);
end;
$$;
revoke all on function app.today_usage_items(uuid) from public;
grant execute on function app.today_usage_items(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin

do $$
declare
  v_def text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_new text;
  v_marker constant text := E'\n  ), top as (';
begin
  if position(v_marker in v_def) = 0 or position('topup_empty' in v_def) > 0 then
    raise exception 'ds_topups: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, E'\n    union all\n'
    || E'    select u.kind, u.id, ''Your plan''::text, null::text, ''followup_desk'', u.ref, null::bigint, u.at, ''billing'', p_tenant_id\n'
    || E'      from jsonb_to_recordset(app.today_usage_items(p_tenant_id)) as u(kind text, id uuid, ref text, at timestamptz)\n'
    || E'     where v_decider'
    || v_marker);
  execute v_new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. job DR A3's functions learn the status waiting_for_minutes (re-created from their own definitions; every other line is exactly as before)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  -- the owner's counts: a call waiting for minutes is still waiting; it is also shown on its own
  v_def := pg_get_functiondef('app.outreach_progress(public.outreach_batches)'::regprocedure);
  v_new := replace(v_def, $s$and i.status = 'waiting'),$s$, $s$and i.status in ('waiting', 'waiting_for_minutes')),
    'waiting_for_minutes', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'waiting_for_minutes'),$s$);
  if v_new = v_def then raise exception 'ds_topups: outreach_progress is not the one this migration expects'; end if;
  execute v_new;

  -- excluding a person also stops a call that waits for minutes
  v_def := pg_get_functiondef('public.outreach_batch_exclude(uuid, uuid, uuid[])'::regprocedure);
  v_new := replace(v_def, $s$contact_id = any (p_contact_ids) and status = 'waiting';$s$, $s$contact_id = any (p_contact_ids) and status in ('waiting', 'waiting_for_minutes');$s$);
  if v_new = v_def then raise exception 'ds_topups: outreach_batch_exclude is not the one this migration expects'; end if;
  execute v_new;

  -- cancelling a batch stops them too
  v_def := pg_get_functiondef('public.outreach_batch_state(uuid, uuid, text)'::regprocedure);
  v_new := replace(v_def, $s$and status in ('waiting', 'planned');$s$, $s$and status in ('waiting', 'waiting_for_minutes', 'planned');$s$);
  if v_new = v_def then raise exception 'ds_topups: outreach_batch_state is not the one this migration expects'; end if;
  execute v_new;

  -- a call result uses minutes: the connected seconds are recorded on the meter (idempotent on the attempt)
  v_def := pg_get_functiondef('public.outreach_item_result(uuid, uuid, text, jsonb, numeric, boolean)'::regprocedure);
  v_new := replace(v_def, $s$case when p_result = 'connected' then p_minutes else 0 end) returning id into v_att;$s$,
    $s$case when p_result = 'connected' then p_minutes else 0 end) returning id into v_att;
  if p_result = 'connected' and p_minutes > 0 then
    perform app.billing_record(p_tenant_id, 'call_minutes', v_att, greatest(1, ceil(p_minutes * 60)::integer));
  end if;$s$);
  if v_new = v_def then raise exception 'ds_topups: outreach_item_result is not the one this migration expects'; end if;
  execute v_new;

  -- the worker: calls that come back (a top-up, an upgrade, the next period), and a call with no minutes left WAITS FOR MINUTES instead of being held an hour
  v_def := pg_get_functiondef('public.scheduler_outreach_run(integer)'::regprocedure);
  v_new := replace(v_def, $s$for i in select * from public.outreach_items x where x.status = 'waiting' and x.next_at <= v_now$s$,
    $s$update public.outreach_items q set status = 'waiting' where q.status = 'waiting_for_minutes' and not app.billing_stopped(q.tenant_id, 'call_minutes');
  for i in select * from public.outreach_items x where x.status = 'waiting' and x.next_at <= v_now$s$);
  if v_new = v_def then raise exception 'ds_topups: scheduler_outreach_run (loop) is not the one this migration expects'; end if;
  v_def := v_new;
  v_new := replace(v_def, $s$update public.outreach_items set next_at = v_now + interval '1 hour' where id = i.id;
        continue;$s$, $s$update public.outreach_items set status = 'waiting_for_minutes' where id = i.id;   -- queued, not lost: it becomes waiting again on a top-up, an upgrade or the next period
        continue;$s$);
  if v_new = v_def then raise exception 'ds_topups: scheduler_outreach_run (stop) is not the one this migration expects'; end if;
  execute v_new;
end;
$$;
