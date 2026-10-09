-- Job AD / review fix 2: "AI usage today" is the Asia/Kolkata day, not the UTC day.
--
--   public.ai_usage_today(tenant)   Owner or Admin (the generic refusal for anyone else, like agent_cost_summary): the daily cap and what the tenant has
--                                   spent today, in micros, where "today" runs from midnight to midnight in India. A call counts at its settled cost, or
--                                   at its reservation while it is still open (the same rule the cap uses). A call belongs to the day it was authorised.
--
-- Nothing else changes. The cap itself is still ENFORCED per UTC day (agent_reserve_cost, agent_day_spend); this is only what the screen shows, so the
-- figure "left" is the cap less today's spend in India and can be zero while the database still allows a call on the UTC day. SECURITY DEFINER because
-- the reservations table has no client grant; the role is proven first, from the tenant given.

create function public.ai_usage_today(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day   date := app.quote_today(); -- the Asia/Kolkata date
  v_start timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  v_start := (v_day::timestamp at time zone 'Asia/Kolkata');
  return jsonb_build_object(
    'day', v_day,
    'cap_micros', app.agent_daily_cap(p_tenant_id),
    'spent_micros', (select coalesce(sum(coalesce(x.settled_micros, x.reserved_micros)), 0)
                       from public.agent_cost_reservations x
                      where x.tenant_id = p_tenant_id and x.created_at >= v_start and x.created_at < v_start + interval '1 day'));
end;
$$;
revoke all on function public.ai_usage_today(uuid) from public, anon;
grant execute on function public.ai_usage_today(uuid) to authenticated;
