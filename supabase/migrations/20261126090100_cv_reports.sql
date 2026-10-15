-- Job CV (night run C1, ADR 0088), migration 2 of 2: ONE REPORTS API FOR EVERY PACK. Every pack's reports have the same shape, are gated by the modules the business has, and are read by the same two calls:
--
--   public.report_catalogue(tenant)               the reports THIS business may run: a closed list of definitions, each needing a set of modules (a module that is off removes the report; no pack name is read)
--   public.report_run(tenant, code, from, to)     one report, in the one shape {report, as_of, from, to, kpis: [{key, value, unit}], tables: [{key, columns: [{key, type}], rows: [[...]]}], series: [{key, points}]}
--   public.construction_report(tenant, code, ..)  the construction pack's five: quotes (made, approved, won), revenue by product, trips per day, dues ageing, top customers
--   weekly.summary                                the existing weekly report ("This week": visits, messages, response time, the sarees whose photos went out most) in the same shape
--   education.*                                   job CR's four (public.education_report): collection, today, pending, funnel
--
-- Every figure is a sum or a count of entries a person made. A model never computes one. Who: Owner, Admin and Sales read the pack reports (they hold money and customers); the weekly summary is the Owner's and Admin's, as it has been.
-- Dates are India days. SQLSTATEs: 22023 invalid, 42501 not allowed, SM701 a module the report needs is off.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the definitions (the closed list)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.report_definitions()
returns table (code text, title_key text, win text, modules text[], roles text[])
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('weekly.summary',                 'report.weekly.summary',                 'week',  array['reports'],                                  array['owner', 'admin']),
    ('construction.quotes',            'report.construction.quotes',            'range', array['reports', 'materials'],                     array['owner', 'admin', 'sales']),
    ('construction.revenue_by_product','report.construction.revenue_by_product','range', array['reports', 'materials', 'orders'],           array['owner', 'admin', 'sales']),
    ('construction.trips_per_day',     'report.construction.trips_per_day',     'range', array['reports', 'deliveries'],                    array['owner', 'admin', 'sales']),
    ('construction.dues_ageing',       'report.construction.dues_ageing',       'day',   array['reports', 'dues', 'companies'],             array['owner', 'admin', 'sales']),
    ('construction.top_customers',     'report.construction.top_customers',     'range', array['reports', 'materials', 'orders', 'companies'], array['owner', 'admin', 'sales']),
    ('education.collection',           'report.education.collection',           'range', array['reports', 'programmes', 'fees'],            array['owner', 'admin', 'sales']),
    ('education.today',                'report.education.today',                'day',   array['reports', 'programmes', 'fees'],            array['owner', 'admin', 'sales']),
    ('education.pending',              'report.education.pending',              'day',   array['reports', 'programmes', 'fees'],            array['owner', 'admin', 'sales']),
    ('education.funnel',               'report.education.funnel',               'range', array['reports', 'programmes'],                    array['owner', 'admin', 'sales'])
  ) as d(code, title_key, win, modules, roles)
$$;
revoke all on function app.report_definitions() from public, anon, authenticated, service_role;

create function app.report_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid' then raise exception 'invalid input' using errcode = '22023';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.report_error(text) from public;

-- the role of the caller in this business as a word ('' when none)
create function app.report_role(p_tenant uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.role::text from public.memberships m where m.tenant_id = p_tenant and m.user_id = auth.uid()), '')
$$;
revoke all on function app.report_role(uuid) from public, anon, authenticated, service_role;

-- the reports this business may run, for this caller: every module of the definition on, the caller's role allowed
create function public.report_catalogue(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := app.report_role(p_tenant_id);
begin
  if auth.uid() is null or p_tenant_id is null or v_role = '' then
    perform app.report_error('deny');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', d.code, 'title_key', d.title_key, 'window', d.win, 'modules', to_jsonb(d.modules)) order by d.code)
      from app.report_definitions() d
     where v_role = any (d.roles) and not exists (select 1 from unnest(d.modules) m where not app.module_enabled(p_tenant_id, m))), '[]'::jsonb);
end;
$$;
revoke all on function public.report_catalogue(uuid) from public, anon;
grant execute on function public.report_catalogue(uuid) to authenticated;

-- the percentage of part in whole to one decimal; null when there is no whole
create function app.report_pct(p_part numeric, p_whole numeric) returns numeric
language sql
immutable
set search_path = ''
as $$ select case when coalesce(p_whole, 0) <= 0 then null else round(100.0 * p_part / p_whole, 1) end $$;
revoke all on function app.report_pct(numeric, numeric) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the construction pack's five
-- ---------------------------------------------------------------------------------------------------------------------------------
-- what every company still owes on `p_as_of`, claim by claim (the ledger's allocation rule decides which claims are open)
create function app.company_open_items(p_tenant uuid, p_as_of date) returns table (company_id uuid, open_paise bigint, due_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select a.company_id, o.open_paise, o.due_date from public.ledger_accounts a cross join lateral app.ledger_open_items(p_tenant, a.id, p_as_of) o
   where a.tenant_id = p_tenant and a.company_id is not null and o.open_paise > 0
$$;
revoke all on function app.company_open_items(uuid, date) from public, anon, authenticated, service_role;

create function public.construction_report(p_tenant_id uuid, p_code text, p_from date default null, p_to date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_to    date := coalesce(p_to, v_today);
  v_from  date;
  v_kpis  jsonb;
  v_tabs  jsonb := '[]'::jsonb;
  v_ser   jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_code is null or app.report_role(p_tenant_id) not in ('owner', 'admin', 'sales') then
    perform app.report_error('deny');
  end if;
  if p_code not in ('construction.quotes', 'construction.revenue_by_product', 'construction.trips_per_day', 'construction.dues_ageing', 'construction.top_customers')
     or v_to > v_today or (p_from is not null and p_from > v_to) or v_to - coalesce(p_from, v_to - 29) > 366 then
    perform app.report_error('invalid');
  end if;
  perform app.require_module(p_tenant_id, 'reports');
  v_from := coalesce(p_from, v_to - 29);

  if p_code = 'construction.quotes' then
    perform app.require_module(p_tenant_id, 'materials');
    with q as (
      select m.*, m.approved_at is not null and exists (select 1 from public.orders o where o.tenant_id = m.tenant_id and o.material_quote_id = m.id) as won   -- won = an APPROVED quote that became an order
        from public.material_quotes m
       where m.tenant_id = p_tenant_id and (m.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to)
    select jsonb_build_array(
             jsonb_build_object('key', 'quotes_made', 'value', count(*), 'unit', 'count'),
             jsonb_build_object('key', 'quotes_approved', 'value', count(*) filter (where approved_at is not null), 'unit', 'count'),
             jsonb_build_object('key', 'quotes_won', 'value', count(*) filter (where won), 'unit', 'count'),
             jsonb_build_object('key', 'win_rate_pct', 'value', app.report_pct(count(*) filter (where won), count(*) filter (where approved_at is not null)), 'unit', 'percent'),
             jsonb_build_object('key', 'approved_value_paise', 'value', coalesce(sum(total_paise) filter (where approved_at is not null), 0), 'unit', 'paise'),
             jsonb_build_object('key', 'won_value_paise', 'value', coalesce(sum(total_paise) filter (where won), 0), 'unit', 'paise'))
      into v_kpis from q;
    v_tabs := jsonb_build_array(jsonb_build_object('key', 'by_status',
      'columns', jsonb_build_array(jsonb_build_object('key', 'status', 'type', 'text'), jsonb_build_object('key', 'quotes', 'type', 'count'), jsonb_build_object('key', 'total_paise', 'type', 'paise')),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(z.status::text, z.n, z.total) order by z.status::text)
                          from (select m.status, count(*) as n, sum(m.total_paise) as total from public.material_quotes m
                                 where m.tenant_id = p_tenant_id and (m.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to group by m.status) z), '[]'::jsonb)));
    v_ser := jsonb_build_array(jsonb_build_object('key', 'quotes_by_day', 'points', coalesce((
      select jsonb_agg(jsonb_build_object('day', y.d, 'value', y.n) order by y.d)
        from (select (m.created_at at time zone 'Asia/Kolkata')::date as d, count(*) as n from public.material_quotes m
               where m.tenant_id = p_tenant_id and (m.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to group by 1) y), '[]'::jsonb)));

  elsif p_code = 'construction.revenue_by_product' then
    perform app.require_module(p_tenant_id, 'materials');
    perform app.require_module(p_tenant_id, 'orders');
    with won as (
      select o.* from public.orders o
       where o.tenant_id = p_tenant_id and o.material_quote_id is not null and o.state not in ('declined', 'expired', 'cancelled')
         and (o.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to)
    select jsonb_build_array(
             jsonb_build_object('key', 'orders', 'value', (select count(*) from won), 'unit', 'count'),
             jsonb_build_object('key', 'order_value_paise', 'value', (select coalesce(sum(order_total_paise), 0) from won), 'unit', 'paise'),
             jsonb_build_object('key', 'material_paise', 'value', (select coalesce(sum(l.material_paise), 0) from public.material_quote_lines l join won w on w.tenant_id = l.tenant_id and w.material_quote_id = l.quote_id), 'unit', 'paise'))
      into v_kpis;
    v_tabs := jsonb_build_array(jsonb_build_object('key', 'by_product',
      'columns', jsonb_build_array(jsonb_build_object('key', 'product', 'type', 'text'), jsonb_build_object('key', 'unit', 'type', 'text'), jsonb_build_object('key', 'quantity', 'type', 'count'), jsonb_build_object('key', 'revenue_paise', 'type', 'paise')),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(z.name, z.unit, z.qty, z.rev) order by z.rev desc, z.name)
                          from (select l.name, l.sold_per as unit, sum(l.billed_quantity) as qty, sum(l.material_paise) as rev
                                  from public.material_quote_lines l
                                  join public.orders o on o.tenant_id = l.tenant_id and o.material_quote_id = l.quote_id
                                 where o.tenant_id = p_tenant_id and o.state not in ('declined', 'expired', 'cancelled') and (o.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to
                                 group by l.catalogue_item_id, l.name, l.sold_per order by rev desc, l.name limit 50) z), '[]'::jsonb)));

  elsif p_code = 'construction.trips_per_day' then
    perform app.require_module(p_tenant_id, 'deliveries');
    select jsonb_build_array(
             jsonb_build_object('key', 'trips', 'value', count(*), 'unit', 'count'),
             jsonb_build_object('key', 'delivered', 'value', count(*) filter (where t.status = 'delivered'), 'unit', 'count'),
             jsonb_build_object('key', 'problems', 'value', count(*) filter (where t.status = 'problem'), 'unit', 'count'),
             jsonb_build_object('key', 'cancelled', 'value', count(*) filter (where t.status = 'cancelled'), 'unit', 'count'),
             jsonb_build_object('key', 'delivered_pct', 'value', app.report_pct(count(*) filter (where t.status = 'delivered'), count(*) filter (where t.status <> 'cancelled')), 'unit', 'percent'))
      into v_kpis from public.delivery_trips t where t.tenant_id = p_tenant_id and t.planned_date between v_from and v_to;
    v_tabs := jsonb_build_array(jsonb_build_object('key', 'by_status',
      'columns', jsonb_build_array(jsonb_build_object('key', 'status', 'type', 'text'), jsonb_build_object('key', 'trips', 'type', 'count')),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(z.status, z.n) order by z.status)
                          from (select t.status, count(*) as n from public.delivery_trips t where t.tenant_id = p_tenant_id and t.planned_date between v_from and v_to group by t.status) z), '[]'::jsonb)));
    v_ser := jsonb_build_array(
      jsonb_build_object('key', 'trips_by_day', 'points', coalesce((select jsonb_agg(jsonb_build_object('day', y.d, 'value', y.n) order by y.d)
                          from (select t.planned_date as d, count(*) as n from public.delivery_trips t where t.tenant_id = p_tenant_id and t.planned_date between v_from and v_to and t.status <> 'cancelled' group by 1) y), '[]'::jsonb)),
      jsonb_build_object('key', 'delivered_by_day', 'points', coalesce((select jsonb_agg(jsonb_build_object('day', y.d, 'value', y.n) order by y.d)
                          from (select t.planned_date as d, count(*) as n from public.delivery_trips t where t.tenant_id = p_tenant_id and t.planned_date between v_from and v_to and t.status = 'delivered' group by 1) y), '[]'::jsonb)));

  elsif p_code = 'construction.dues_ageing' then
    perform app.require_module(p_tenant_id, 'dues');
    perform app.require_module(p_tenant_id, 'companies');
    v_from := v_to;
    select jsonb_build_array(
             jsonb_build_object('key', 'outstanding_paise', 'value', coalesce(sum(open_paise), 0), 'unit', 'paise'),
             jsonb_build_object('key', 'overdue_paise', 'value', coalesce(sum(open_paise) filter (where due_date < v_to), 0), 'unit', 'paise'),
             jsonb_build_object('key', 'customers_owing', 'value', count(distinct company_id), 'unit', 'count'),
             jsonb_build_object('key', 'overdue_pct', 'value', app.report_pct(coalesce(sum(open_paise) filter (where due_date < v_to), 0), sum(open_paise)), 'unit', 'percent'))
      into v_kpis from app.company_open_items(p_tenant_id, v_to);
    v_tabs := jsonb_build_array(
      jsonb_build_object('key', 'ageing',
        'columns', jsonb_build_array(jsonb_build_object('key', 'bucket', 'type', 'text'), jsonb_build_object('key', 'paise', 'type', 'paise')),
        'rows', jsonb_build_array(
          jsonb_build_array('not_due', (select coalesce(sum(open_paise) filter (where due_date >= v_to), 0) from app.company_open_items(p_tenant_id, v_to))),
          jsonb_build_array('d1_30', (select coalesce(sum(open_paise) filter (where v_to - due_date between 1 and 30), 0) from app.company_open_items(p_tenant_id, v_to))),
          jsonb_build_array('d31_60', (select coalesce(sum(open_paise) filter (where v_to - due_date between 31 and 60), 0) from app.company_open_items(p_tenant_id, v_to))),
          jsonb_build_array('d61_90', (select coalesce(sum(open_paise) filter (where v_to - due_date between 61 and 90), 0) from app.company_open_items(p_tenant_id, v_to))),
          jsonb_build_array('d90_plus', (select coalesce(sum(open_paise) filter (where v_to - due_date > 90), 0) from app.company_open_items(p_tenant_id, v_to))))),
      jsonb_build_object('key', 'top_debtors',
        'columns', jsonb_build_array(jsonb_build_object('key', 'customer', 'type', 'text'), jsonb_build_object('key', 'outstanding_paise', 'type', 'paise'), jsonb_build_object('key', 'overdue_paise', 'type', 'paise')),
        'rows', coalesce((select jsonb_agg(jsonb_build_array(z.name, z.out, z.over) order by z.out desc, z.name)
                            from (select c.name, sum(i.open_paise) as out, coalesce(sum(i.open_paise) filter (where i.due_date < v_to), 0) as over
                                    from app.company_open_items(p_tenant_id, v_to) i join public.companies c on c.tenant_id = p_tenant_id and c.id = i.company_id
                                   group by c.id, c.name order by sum(i.open_paise) desc, c.name limit 10) z), '[]'::jsonb)));

  else  -- construction.top_customers
    perform app.require_module(p_tenant_id, 'materials');
    perform app.require_module(p_tenant_id, 'orders');
    perform app.require_module(p_tenant_id, 'companies');
    select jsonb_build_array(
             jsonb_build_object('key', 'customers', 'value', count(distinct l.company_id), 'unit', 'count'),
             jsonb_build_object('key', 'orders', 'value', count(*), 'unit', 'count'),
             jsonb_build_object('key', 'order_value_paise', 'value', coalesce(sum(o.order_total_paise), 0), 'unit', 'paise'))
      into v_kpis
      from public.orders o join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
     where o.tenant_id = p_tenant_id and o.state not in ('declined', 'expired', 'cancelled') and (o.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to and l.company_id is not null;
    v_tabs := jsonb_build_array(jsonb_build_object('key', 'top_customers',
      'columns', jsonb_build_array(jsonb_build_object('key', 'customer', 'type', 'text'), jsonb_build_object('key', 'orders', 'type', 'count'), jsonb_build_object('key', 'revenue_paise', 'type', 'paise')),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(z.name, z.n, z.rev) order by z.rev desc, z.name)
                          from (select c.name, count(*) as n, sum(o.order_total_paise) as rev
                                  from public.orders o join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
                                 where o.tenant_id = p_tenant_id and o.state not in ('declined', 'expired', 'cancelled') and (o.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to
                                 group by c.id, c.name order by sum(o.order_total_paise) desc, c.name limit 10) z), '[]'::jsonb)));
  end if;
  return jsonb_build_object('report', p_code, 'as_of', v_to, 'from', v_from, 'to', v_to, 'kpis', v_kpis, 'tables', v_tabs, 'series', v_ser);
end;
$$;
revoke all on function public.construction_report(uuid, text, date, date) from public, anon;
grant execute on function public.construction_report(uuid, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the weekly summary in the one shape, and the one door
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.weekly_summary_shape(p_tenant uuid, p_week_start date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w jsonb := public.weekly_report(p_tenant, p_week_start);
begin
  return jsonb_build_object(
    'report', 'weekly.summary', 'as_of', (w ->> 'week_end')::date, 'from', (w ->> 'week_start')::date, 'to', (w ->> 'week_end')::date,
    'kpis', jsonb_build_array(
      jsonb_build_object('key', 'visits_booked', 'value', (w -> 'visits' ->> 'booked')::int, 'unit', 'count'),
      jsonb_build_object('key', 'visits_arrived', 'value', (w -> 'visits' ->> 'arrived')::int, 'unit', 'count'),
      jsonb_build_object('key', 'visits_bought', 'value', (w -> 'visits' ->> 'bought')::int, 'unit', 'count'),
      jsonb_build_object('key', 'visits_no_show', 'value', (w -> 'visits' ->> 'no_show')::int, 'unit', 'count'),
      jsonb_build_object('key', 'messages_sent', 'value', (w -> 'messages' ->> 'sent')::int, 'unit', 'count'),
      jsonb_build_object('key', 'messages_waiting', 'value', (w -> 'messages' ->> 'waiting')::int, 'unit', 'count'),
      jsonb_build_object('key', 'messages_blocked', 'value', (w -> 'messages' ->> 'blocked')::int, 'unit', 'count'),
      jsonb_build_object('key', 'enquiries_asked', 'value', (w -> 'response' ->> 'asked')::int, 'unit', 'count'),
      jsonb_build_object('key', 'enquiries_answered', 'value', (w -> 'response' ->> 'answered')::int, 'unit', 'count'),
      jsonb_build_object('key', 'median_answer_seconds', 'value', (w -> 'response' ->> 'median_seconds')::bigint, 'unit', 'seconds'),
      jsonb_build_object('key', 'ai_usage_percent', 'value', (w ->> 'ai_usage_percent')::int, 'unit', 'percent')),
    'tables', jsonb_build_array(jsonb_build_object('key', 'top_items',
      'columns', jsonb_build_array(jsonb_build_object('key', 'item', 'type', 'text'), jsonb_build_object('key', 'photos_sent', 'type', 'count')),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(t ->> 'name', (t ->> 'sent')::int)) from jsonb_array_elements(w -> 'top_sarees') t), '[]'::jsonb))),
    'series', '[]'::jsonb);
end;
$$;
revoke all on function app.weekly_summary_shape(uuid, date) from public, anon, authenticated, service_role;

-- One report, by code. The definition says which modules it needs and who may read it; the builders check the same again. `p_from` is the first day (for the weekly summary: the Monday of the week, null = this week).
create function public.report_run(p_tenant_id uuid, p_code text, p_from date default null, p_to date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d record;
  v_role text := app.report_role(p_tenant_id);
  m text;
begin
  if auth.uid() is null or p_tenant_id is null or v_role = '' or p_code is null then
    perform app.report_error('deny');
  end if;
  select * into d from app.report_definitions() x where x.code = p_code;
  if not found then
    perform app.report_error('invalid');
  end if;
  if not (v_role = any (d.roles)) then
    perform app.report_error('deny');
  end if;
  foreach m in array d.modules loop
    perform app.require_module(p_tenant_id, m);
  end loop;
  if d.code = 'weekly.summary' then
    return app.weekly_summary_shape(p_tenant_id, p_from);
  elsif d.code like 'construction.%' then
    return public.construction_report(p_tenant_id, d.code, p_from, p_to);
  else
    return public.education_report(p_tenant_id, d.code, p_from, p_to);
  end if;
end;
$$;
revoke all on function public.report_run(uuid, text, date, date) from public, anon;
grant execute on function public.report_run(uuid, text, date, date) to authenticated;
