-- Part A3, fix found by the demo seed (part B2): the report counted only leads that had an outreach item, so a source whose leads nobody had called yet was missing. Now every lead that arrived in the window counts
-- under its source (the cost per lead, the volume), with what the outreach did for it. The function is replaced whole (its signature, grants and callers do not change).

create or replace function public.outreach_report(p_tenant_id uuid, p_from date, p_to date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_from  date := coalesce(p_from, v_today - 29);
  v_to    date := coalesce(p_to, v_today);
  v_pol   jsonb;
  v_raw   jsonb;
  v_rows  jsonb;
  v_total jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  if v_to < v_from or v_to - v_from > 366 then
    perform app.outreach_error('invalid');
  end if;
  v_pol := app.outreach_pol(p_tenant_id);
  -- one row per LEAD that arrived in the window (every lead of a source counts, called or not), with what the outreach did for it
  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_raw from (
    select coalesce(l.source, '(none)') as source,
           count(*) as leads,
           percentile_cont(0.5) within group (order by it.ft_s) filter (where it.ft_s is not null) as ft,
           coalesce(sum(att.calls), 0)::bigint as calls,
           coalesce(sum(att.connected), 0)::bigint as connected,
           count(*) filter (where it.interested)::bigint as interested,
           coalesce(sum(bk.bookings), 0)::bigint as bookings,
           coalesce(sum(att.minutes), 0)::numeric as minutes,
           (coalesce(max(sc.cost_per_lead_paise), 0) * count(*))::bigint as lead_cost
      from public.leads l
      left join lateral (select min(extract(epoch from (i.first_touch_at - i.arrival_at))) filter (where i.first_touch_at is not null) as ft_s,
                                count(*) filter (where i.reason = 'interested') > 0 as interested
                           from public.outreach_items i where i.tenant_id = l.tenant_id and i.lead_id = l.id and i.status <> 'skipped') it on true
      left join lateral (select count(*) filter (where a.channel = 'call') as calls,
                                count(*) filter (where a.channel = 'call' and a.result = 'connected') as connected,
                                coalesce(sum(a.minutes), 0) as minutes
                           from public.outreach_attempts a join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id
                          where i.tenant_id = l.tenant_id and i.lead_id = l.id) att on true
      left join lateral (select count(*) as bookings
                           from public.outcomes oc
                           join public.outreach_attempts a on a.tenant_id = oc.tenant_id and a.id = oc.source_id
                           join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id
                          where i.tenant_id = l.tenant_id and i.lead_id = l.id and oc.category = 'visit_booked') bk on true
      left join public.lead_source_costs sc on sc.tenant_id = l.tenant_id and sc.source = l.source
     where l.tenant_id = p_tenant_id and l.archived_at is null and (l.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to
     group by coalesce(l.source, '(none)')) g;
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', r.source, 'leads', r.leads, 'first_touch_median_seconds', round(r.ft)::bigint, 'calls', r.calls,
           'connected_rate', case when r.calls > 0 then round(r.connected::numeric / r.calls, 3) else 0 end,
           'interested_pct', case when r.connected > 0 then round(100.0 * r.interested / r.connected, 1) else 0 end,
           'bookings', r.bookings, 'call_cost_paise', round(r.minutes * (v_pol ->> 'call_paise_per_minute')::numeric)::bigint, 'lead_cost_paise', r.lead_cost,
           'cost_per_booking_paise', case when r.bookings > 0 then round((r.minutes * (v_pol ->> 'call_paise_per_minute')::numeric + r.lead_cost) / r.bookings)::bigint end) order by r.source), '[]'::jsonb)
    into v_rows from jsonb_to_recordset(v_raw) as r(source text, leads bigint, ft numeric, calls bigint, connected bigint, interested bigint, bookings bigint, minutes numeric, lead_cost bigint);
  select jsonb_build_object(
           'leads', coalesce(sum(r.leads), 0), 'calls', coalesce(sum(r.calls), 0),
           'connected_rate', case when sum(r.calls) > 0 then round(sum(r.connected)::numeric / sum(r.calls), 3) else 0 end,
           'interested_pct', case when sum(r.connected) > 0 then round(100.0 * sum(r.interested) / sum(r.connected), 1) else 0 end,
           'bookings', coalesce(sum(r.bookings), 0), 'call_cost_paise', round(coalesce(sum(r.minutes), 0) * (v_pol ->> 'call_paise_per_minute')::numeric)::bigint, 'lead_cost_paise', coalesce(sum(r.lead_cost), 0),
           'cost_per_booking_paise', case when sum(r.bookings) > 0 then round((coalesce(sum(r.minutes), 0) * (v_pol ->> 'call_paise_per_minute')::numeric + coalesce(sum(r.lead_cost), 0)) / sum(r.bookings))::bigint end)
    into v_total from jsonb_to_recordset(v_raw) as r(source text, leads bigint, ft numeric, calls bigint, connected bigint, interested bigint, bookings bigint, minutes numeric, lead_cost bigint);
  return jsonb_build_object('from_day', v_from, 'to_day', v_to, 'by_source', v_rows, 'total', v_total);
end;
$$;
revoke all on function public.outreach_report(uuid, date, date) from public, anon;
grant execute on function public.outreach_report(uuid, date, date) to authenticated;
