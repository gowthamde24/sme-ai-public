-- Google Maps: usage per SKU against the monthly FREE caps (owner, 14 Nov 2026: startup credits declined; we live on the free monthly caps of India billing: 70,000 Essentials / 35,000 Pro / 7,000 Enterprise per SKU).
--   * the ledger learns the Places SKUs as units (one unit = one request): search_ids (Text Search Essentials, IDs only), search_pro, search_enterprise, details_pro, details_enterprise. The older unit `search` (one Text
--     Search Enterprise request) is counted as search_enterprise.
--   * ops.google_caps: the free monthly cap and the alert percentage (80) of each SKU (operator data: raise a row when Google changes a cap).
--   * public.admin_usage_google(): per SKU this month: used, cap, percent, state ok | warn (80 percent and over) | over; owner and finance only (the ONLY place provider SKUs appear).
--   * public.ops_google_budget(unit): the system's check BEFORE a Google request: may one more request go without leaving the free cap? (The API stops at the cap: no spending without the owner's OK.)
--   * admin.alerts + public.ops_google_alerts_run(): at 80 percent of a monthly cap ONE alert per SKU per month (the worker sends the e-mail to the owner; the console shows it).
-- The month is the calendar month in UTC (Google's own monthly free usage resets on the 1st; a few hours of difference at the edge is covered by the alert at 80 percent).

alter table ops.provider_rates drop constraint if exists provider_rates_unit_check;
alter table ops.provider_usage drop constraint if exists provider_usage_unit_check;
alter table ops.provider_rates add constraint provider_rates_unit_check check (unit in ('second', 'character', 'token_in', 'token_out', 'message_marketing', 'message_utility', 'message_service', 'search',
  'search_ids', 'search_pro', 'search_enterprise', 'details_pro', 'details_enterprise'));
alter table ops.provider_usage add constraint provider_usage_unit_check check (unit in ('second', 'character', 'token_in', 'token_out', 'message_marketing', 'message_utility', 'message_service', 'search',
  'search_ids', 'search_pro', 'search_enterprise', 'details_pro', 'details_enterprise'));

create or replace function ops.unit_ok(p_provider text, p_unit text) returns boolean language sql immutable set search_path = '' as
$$ select case p_provider
       when 'plivo'     then p_unit = 'second'
       when 'cartesia'  then p_unit = 'character'
       when 'sarvam'    then p_unit in ('second', 'character')
       when 'anthropic' then p_unit in ('token_in', 'token_out')
       when 'meta'      then p_unit in ('message_marketing', 'message_utility', 'message_service')
       when 'google'    then p_unit in ('search', 'search_ids', 'search_pro', 'search_enterprise', 'details_pro', 'details_enterprise')
       else false end $$;

-- the rate card: what a request beyond the free cap would cost us (estimates from Google's list price at about Rs 85 a dollar; the free cap is why the real cost is usually zero)
insert into ops.provider_rates (provider, unit, cost_micro_paise, valid_from, rate_source, note) values
  ('google', 'search_ids',        0,         '2026-01-01 00:00:00+00', 'estimate', 'Text Search Essentials (IDs only): free up to the monthly cap, then Google''s list price; recorded at zero so the volume is known'),
  ('google', 'search_pro',        272000000, '2026-01-01 00:00:00+00', 'estimate', 'Text Search Pro: about USD 32 per 1,000 requests beyond the free cap'),
  ('google', 'search_enterprise', 300000000, '2026-01-01 00:00:00+00', 'estimate', 'Text Search Enterprise: about USD 35 per 1,000 requests beyond the free cap'),
  ('google', 'details_pro',       145000000, '2026-01-01 00:00:00+00', 'estimate', 'Place Details Pro: about USD 17 per 1,000 requests beyond the free cap'),
  ('google', 'details_enterprise',170000000, '2026-01-01 00:00:00+00', 'estimate', 'Place Details Enterprise: about USD 20 per 1,000 requests beyond the free cap');

create table ops.google_caps (
  unit              text primary key check (unit in ('search_ids', 'search_pro', 'search_enterprise', 'details_pro', 'details_enterprise')),
  label             text not null check (char_length(label) between 1 and 60),
  tier              text not null check (tier in ('essentials', 'pro', 'enterprise')),
  monthly_free_cap  integer not null check (monthly_free_cap between 1 and 100000000),
  alert_percent     integer not null default 80 check (alert_percent between 1 and 100)
);
comment on table ops.google_caps is 'Operator data: the free monthly cap of each Google Maps SKU (India billing) and the percentage at which the owner is alerted. SAFE: not personal data.';
comment on column ops.google_caps.unit is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list, no client can write it';
comment on column ops.google_caps.label is 'SAFE: the SKU''s name. CLEAN-EXEMPT: length CHECK, operator data';
comment on column ops.google_caps.tier is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list, no client can write it';
alter table ops.google_caps enable row level security;
alter table ops.google_caps force row level security;
revoke all on ops.google_caps from public, anon, authenticated, service_role;
insert into ops.google_caps (unit, label, tier, monthly_free_cap) values
  ('search_ids',        'Text Search Essentials (IDs only)', 'essentials', 70000),
  ('search_pro',        'Text Search Pro',                   'pro',        35000),
  ('search_enterprise', 'Text Search Enterprise',            'enterprise',  7000),
  ('details_pro',       'Place Details Pro',                 'pro',        35000),
  ('details_enterprise','Place Details Enterprise',          'enterprise',  7000);

-- this month's requests per SKU (the older unit `search` counts as search_enterprise)
create function ops.google_used(p_unit text, p_at timestamptz default now()) returns numeric language sql stable set search_path = '' as
$$ select coalesce(sum(u.units), 0) from ops.provider_usage u
    where u.provider = 'google' and (u.unit = p_unit or (p_unit = 'search_enterprise' and u.unit = 'search'))
      and u.occurred_at >= date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC' and u.occurred_at < (date_trunc('month', p_at at time zone 'UTC') + interval '1 month') at time zone 'UTC' $$;
revoke all on function ops.google_used(text, timestamptz) from public, anon, authenticated, service_role;

create function ops.google_state(p_used numeric, p_cap integer, p_alert integer) returns text language sql immutable set search_path = '' as
$$ select case when p_used >= p_cap then 'over' when p_used * 100 >= p_cap::numeric * p_alert then 'warn' else 'ok' end $$;
revoke all on function ops.google_state(numeric, integer, integer) from public, anon, authenticated, service_role;

create function public.admin_usage_google() returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_next  date := ((date_trunc('month', now() at time zone 'UTC') + interval '1 month'))::date;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  perform admin.log(v_staff.user_id, 'read', null, null, null, null, 'business', null, false);
  return jsonb_build_object('month_starts', (date_trunc('month', now() at time zone 'UTC'))::date, 'resets_on', v_next, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('unit', c.unit, 'label', c.label, 'tier', c.tier, 'used', ops.google_used(c.unit)::bigint, 'free_cap', c.monthly_free_cap, 'alert_percent', c.alert_percent,
                                        'percent', round(ops.google_used(c.unit) * 100 / c.monthly_free_cap, 1), 'state', ops.google_state(ops.google_used(c.unit), c.monthly_free_cap, c.alert_percent),
                                        'estimated_overage_paise', (select coalesce(ceil(greatest(0, ops.google_used(c.unit) - c.monthly_free_cap) * r.cost_micro_paise / 1000000.0), 0)::bigint
                                                                      from ops.provider_rates r where r.provider = 'google' and r.unit = c.unit order by r.valid_from desc limit 1)) order by c.tier desc, c.unit)
      from ops.google_caps c), '[]'::jsonb));
end $$;

-- the system's gate before a Google request: may `p_n` more requests of this SKU go without leaving the free cap? (the API stops there: spending needs the owner's OK)
create function public.ops_google_budget(p_unit text, p_n integer default 1) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_cap  integer;
  v_used numeric;
begin
  perform ops.system_only();
  select c.monthly_free_cap into v_cap from ops.google_caps c where c.unit = p_unit;
  if v_cap is null or p_n is null or p_n not between 1 and 1000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_used := ops.google_used(p_unit);
  return jsonb_build_object('unit', p_unit, 'used', v_used::bigint, 'free_cap', v_cap, 'allowed', v_used + p_n <= v_cap, 'remaining', greatest(0, v_cap - v_used)::bigint);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- alerts (staff-visible; the worker e-mails the owner once)
-- ---------------------------------------------------------------------------------------------------------------------------------
create table admin.alerts (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique check (key ~ '^[a-z0-9_.:-]{3,100}$'),
  kind          text not null check (kind in ('google_cap')),
  severity      text not null check (severity in ('warn', 'over')),
  title         text not null check (char_length(title) between 3 and 200),
  detail        text check (detail is null or char_length(detail) between 1 and 500),
  created_at    timestamptz not null default now(),
  emailed_at    timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references admin.staff (user_id) on delete restrict
);
comment on column admin.alerts.title is 'SAFE: a sentence made by code from counts and a provider SKU name; no personal data';
comment on column admin.alerts.detail is 'SAFE: a sentence made by code from counts and a provider SKU name; no personal data';
comment on column admin.alerts.key is 'SAFE: an opaque key. CLEAN-EXEMPT: strict pattern CHECK';
comment on column admin.alerts.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.alerts.severity is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table admin.alerts enable row level security;
alter table admin.alerts force row level security;
revoke all on admin.alerts from public, anon, authenticated, service_role;

-- the worker (system account) runs this every tick: it makes ONE alert per SKU per month at the alert percentage (and one more, "over", at 100), and returns the ones not yet e-mailed so they can be sent (and marked)
create function public.ops_google_alerts_run() returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  c       ops.google_caps;
  v_used  numeric;
  v_state text;
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_key   text;
  v_new   jsonb := '[]'::jsonb;
begin
  perform ops.system_only();
  for c in select * from ops.google_caps order by unit loop
    v_used := ops.google_used(c.unit);
    v_state := ops.google_state(v_used, c.monthly_free_cap, c.alert_percent);
    continue when v_state = 'ok';
    v_key := 'google:' || c.unit || ':' || v_month || ':' || v_state;
    insert into admin.alerts (key, kind, severity, title, detail)
    values (v_key, 'google_cap', v_state, case v_state when 'over' then c.label || ': the free monthly limit is used up' else c.label || ': ' || c.alert_percent || '% of the free monthly limit used' end,
            v_used::bigint || ' of ' || c.monthly_free_cap || ' requests this month. New Google Maps requests of this kind are held until the 1st unless you raise the limit.')
    on conflict (key) do nothing;
  end loop;
  -- every alert not yet e-mailed (so a failed send is tried again on the next tick, and a second run makes no second alert)
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'severity', a.severity, 'title', a.title, 'detail', a.detail) order by a.created_at), '[]'::jsonb) into v_new
    from admin.alerts a where a.kind = 'google_cap' and a.emailed_at is null;
  return jsonb_build_object('new', v_new);
end $$;

create function public.ops_alert_mark_emailed(p_ids uuid[]) returns void language plpgsql security definer set search_path = '' as
$$ begin perform ops.system_only(); update admin.alerts set emailed_at = now() where id = any (p_ids) and emailed_at is null; end $$;

-- who gets the alert e-mails: the active owner account(s) of the staff console
create function public.ops_alert_recipients() returns jsonb language plpgsql security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  return jsonb_build_object('emails', coalesce((select jsonb_agg(u.email order by u.email) from admin.staff s join auth.users u on u.id = s.user_id where s.role = 'owner' and s.active and u.email is not null), '[]'::jsonb));
end $$;

create function public.admin_alerts_list(p_include_acknowledged boolean default false) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'severity', a.severity, 'title', a.title, 'detail', a.detail, 'created_at', a.created_at,
                                                                                    'acknowledged', a.acknowledged_at is not null) order by a.created_at desc)
                                                 from (select * from admin.alerts x where (p_include_acknowledged or x.acknowledged_at is null) and (x.kind <> 'google_cap' or v_staff.role in ('owner', 'finance')) order by x.created_at desc limit 100) a), '[]'::jsonb));
end $$;

create function public.admin_alert_ack(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_id is null then raise exception 'invalid input' using errcode = '22023'; end if;
  update admin.alerts set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, v_staff.user_id) where id = p_id;
  if not found then raise exception 'not found' using errcode = '23503'; end if;
  perform admin.log(v_staff.user_id, 'status', null, null, null, null, 'business', null, false);
  return jsonb_build_object('id', p_id, 'acknowledged', true);
end $$;

revoke all on function public.admin_usage_google(), public.ops_google_budget(text, integer), public.ops_google_alerts_run(), public.ops_alert_mark_emailed(uuid[]), public.ops_alert_recipients(),
  public.admin_alerts_list(boolean), public.admin_alert_ack(uuid) from public, anon;
grant execute on function public.admin_usage_google(), public.ops_google_budget(text, integer), public.ops_google_alerts_run(), public.ops_alert_mark_emailed(uuid[]), public.ops_alert_recipients(),
  public.admin_alerts_list(boolean), public.admin_alert_ack(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Usage & cost (owner and finance): per business and overall, what we USED and what it COST us per provider against what we were PAID (invoice subtotals, no GST) in the period. Negative margins are flagged.
-- This and admin_usage_google are the only places provider names and costs appear. Costs are recorded from 13 Nov 2026 on (no back-fill): `costs_recorded_since` says so.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.admin_usage_summary(p_from date, p_to date, p_limit integer default 100) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_from  timestamptz;
  v_to    timestamptz;
  v_rev   bigint;
  v_cost  bigint;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_from := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  perform admin.log(v_staff.user_id, 'read', null, null, null, null, 'invoice', null, false);
  select coalesce(sum(i.subtotal_paise), 0) into v_rev from pricing.invoices i where i.issued_at >= v_from and i.issued_at < v_to;
  select coalesce(sum(u.cost_paise), 0) into v_cost from ops.provider_usage u where u.occurred_at >= v_from and u.occurred_at < v_to;
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'costs_recorded_since', (select min(u.occurred_at) from ops.provider_usage u),
    'totals', jsonb_build_object('revenue_paise', v_rev, 'cost_paise', v_cost, 'margin_paise', v_rev - v_cost, 'margin_percent', case when v_rev > 0 then round((v_rev - v_cost) * 100.0 / v_rev, 1) end),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('provider', x.provider, 'role', case x.provider when 'cartesia' then 'voice' when 'sarvam' then 'speech_to_text' when 'plivo' then 'calls_and_numbers' when 'anthropic' then 'ai_model'
                                                                    when 'meta' then 'whatsapp' else 'lead_search' end, 'cost_paise', x.cost, 'units', x.units) order by x.cost desc, x.provider)
                            from (select u.provider, sum(u.cost_paise) as cost, jsonb_object_agg(u.unit, u.units_sum) as units
                                    from (select provider, unit, sum(cost_paise) as cost_paise, sum(units) as units_sum from ops.provider_usage where occurred_at >= v_from and occurred_at < v_to group by provider, unit) u
                                   group by u.provider) x), '[]'::jsonb),
    'businesses', coalesce((select jsonb_agg(b.j order by (b.j ->> 'margin_paise')::bigint, b.j ->> 'name') from (
        select jsonb_build_object('tenant_id', t.id, 'name', t.name, 'demo', t.demo, 'revenue_paise', coalesce(r.rev, 0), 'cost_paise', coalesce(c.cost, 0), 'margin_paise', coalesce(r.rev, 0) - coalesce(c.cost, 0),
                                  'negative_margin', coalesce(r.rev, 0) - coalesce(c.cost, 0) < 0,
                                  'minutes', coalesce(m.minutes, 0), 'messages_sent', coalesce(g.msgs, 0), 'lead_searches', coalesce(c.searches, 0), 'ai_tokens', coalesce(c.tokens, 0),
                                  'by_provider', coalesce(c.by_provider, '{}'::jsonb)) as j
          from public.tenants t
          left join (select tenant_id, sum(subtotal_paise) as rev from pricing.invoices where issued_at >= v_from and issued_at < v_to group by tenant_id) r on r.tenant_id = t.id
          left join (select u.tenant_id, sum(u.cost_paise) as cost, sum(u.units) filter (where u.provider = 'google') as searches, sum(u.units) filter (where u.provider = 'anthropic') as tokens,
                            jsonb_object_agg(u.provider, u.pc) as by_provider
                       from (select tenant_id, provider, sum(cost_paise) as cost_paise, sum(units) as units, sum(cost_paise) as pc from ops.provider_usage where occurred_at >= v_from and occurred_at < v_to group by tenant_id, provider) u
                       group by u.tenant_id) c on c.tenant_id = t.id
          left join (select tenant_id, round(sum(duration_s) / 60.0, 1) as minutes from public.phone_calls where answered_at is not null and created_at >= v_from and created_at < v_to group by tenant_id) m on m.tenant_id = t.id
          left join (select tenant_id, count(*) as msgs from public.outbox_messages where status = 'sent' and created_at >= v_from and created_at < v_to group by tenant_id) g on g.tenant_id = t.id
         where t.archived_at is null and (coalesce(r.rev, 0) > 0 or coalesce(c.cost, 0) > 0 or coalesce(m.minutes, 0) > 0 or coalesce(g.msgs, 0) > 0)
         limit p_limit) b), '[]'::jsonb));
end $$;
revoke all on function public.admin_usage_summary(date, date, integer) from public, anon;
grant execute on function public.admin_usage_summary(date, date, integer) to authenticated;
