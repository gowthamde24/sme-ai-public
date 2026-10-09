-- Job AD / D3: two READ-ONLY functions for the Today screen and the office. Both are SECURITY INVOKER: they read ordinary tables, so the caller's
-- own row-level security decides every row they see. They write nothing, change no price and send nothing.
--
--   public.today_summary(tenant)   the counts and the short lists the Today screen shows: what is waiting for the caller, the money held on closed
--                                  orders, the open orders, and the last five order steps. What a person is shown depends on their role:
--                                    quote_approval     Owner, Admin    quotes that are drafts, waiting to be approved
--                                    followup_due       Owner, Admin    follow-up message drafts waiting to be approved (never sent by the system)
--                                    order_money_held   Owner          lost, expired or cancelled orders that still hold money (a refund may be owed)
--                                  The cards and the recent steps are for Owner, Admin and Sales (a Viewer reads no amount, as everywhere).
--   public.agents_status(tenant)   the facts the office screen shows about the seven helpers: whether the workspace has switched agents on, whether
--                                  a research or requirement run is running, and the latest quote, follow-up draft and order step.
--
-- Each waiting item and each recent step carries a `target` ({type, id}) so the screen knows where "Open" goes: a quote, a lead (its follow-ups),
-- or an order.
-- Both return plain facts (ids, counts, numbers, codes, timestamps). The API turns them into the screen's sentences; neither function decides
-- anything. A caller who is not a member of the tenant is refused (42501), the same answer for a tenant that does not exist.

create function public.today_summary(p_tenant_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_decider boolean;
  v_owner   boolean;
  v_reader  boolean;
  v_needs   jsonb;
  v_waiting integer;
  v_held    bigint := 0;
  v_open    integer := 0;
  v_recent  jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not (select app.is_tenant_member(p_tenant_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_decider := (select app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]));
  v_owner   := (select app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]));
  v_reader  := (select app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]));

  with items as (
    select 'quote_approval'::text as kind, qt.id, c.name as customer, c.city, 'quote_writer'::text as agent,
           qt.quote_no::text as ref, qt.total_paise as amount_paise, qt.created_at as at, 'quote'::text as target_type, qt.id as target_id
      from public.quotes qt
      left join public.leads l on l.tenant_id = qt.tenant_id and l.id = qt.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and qt.tenant_id = p_tenant_id and qt.status = 'draft'
    union all
    select 'followup_due', d.id, c.name, c.city, 'followup_desk', d.touch_number::text, null::bigint, d.created_at, 'lead', d.lead_id
      from public.followup_drafts d
      left join public.leads l on l.tenant_id = d.tenant_id and l.id = d.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and d.tenant_id = p_tenant_id and d.status = 'draft'
    union all
    select 'order_money_held', o.id, c.name, c.city, 'order_desk', o.order_no::text, g.net_paise, coalesce(o.closed_at, o.updated_at), 'order', o.id
      from public.orders o
      join public.order_ledger g on g.tenant_id = o.tenant_id and g.order_id = o.id
      left join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_owner and o.tenant_id = p_tenant_id and o.state in ('declined', 'expired', 'cancelled') and g.net_paise > 0
  ), top as (
    select * from items order by at desc, id limit 20
  )
  select (select count(*) from items)::integer,
         coalesce((select jsonb_agg(jsonb_build_object('kind', t.kind, 'id', t.id, 'customer', t.customer, 'city', t.city, 'agent', t.agent,
                                                       'ref', t.ref, 'amount_paise', t.amount_paise, 'at', t.at,
                                                       'target', jsonb_build_object('type', t.target_type, 'id', t.target_id)) order by t.at desc, t.id) from top t), '[]'::jsonb)
    into v_waiting, v_needs;

  if v_reader then
    select coalesce(sum(g.net_paise) filter (where o.state in ('declined', 'expired', 'cancelled') and g.net_paise > 0), 0)::bigint,
           count(*) filter (where o.closed_at is null)::integer
      into v_held, v_open
      from public.orders o
      join public.order_ledger g on g.tenant_id = o.tenant_id and g.order_id = o.id
     where o.tenant_id = p_tenant_id;

    select coalesce(jsonb_agg(r.j order by r.at desc, r.id desc), '[]'::jsonb)
      into v_recent
      from (select e.recorded_at as at, e.id,
                   jsonb_build_object('order_no', o.order_no, 'order_id', o.id, 'customer', c.name, 'type', e.type, 'new_state', e.new_state,
                                      'amount_paise', e.amount_paise, 'at', e.recorded_at) as j
              from public.order_events e
              join public.orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
              left join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
              left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
             where e.tenant_id = p_tenant_id
             order by e.recorded_at desc, e.id desc
             limit 5) r;
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_object('waiting', v_waiting, 'money_held_paise', v_held, 'orders_open', v_open),
    'needs_you', v_needs,
    'recent', v_recent);
end;
$$;
revoke all on function public.today_summary(uuid) from public, anon;
grant execute on function public.today_summary(uuid) to authenticated;

create function public.agents_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_switch   boolean;
  v_research jsonb;
  v_require  jsonb;
  v_quote    jsonb;
  v_followup jsonb;
  v_order    jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not (select app.is_tenant_member(p_tenant_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_switch := coalesce((select s.enabled from public.tenant_agent_settings s where s.tenant_id = p_tenant_id), false);

  -- a run is "working" while it is running and its time has not run out; the last event is the newest run that ended (else the one that started)
  select jsonb_build_object(
           'running', exists (select 1 from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name and r.status = 'running' and r.expires_at > now()),
           'last_status', (select r.status from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1),
           'last_at', (select coalesce(r.finished_at, r.created_at) from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1))
    into v_research from (select 'research'::text as name) a;
  select jsonb_build_object(
           'running', exists (select 1 from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name and r.status = 'running' and r.expires_at > now()),
           'last_status', (select r.status from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1),
           'last_at', (select coalesce(r.finished_at, r.created_at) from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1))
    into v_require from (select 'requirement'::text as name) a;

  select jsonb_build_object('last_no', q.quote_no, 'last_at', q.created_at)
    into v_quote from public.quotes q where q.tenant_id = p_tenant_id order by q.created_at desc, q.id desc limit 1;
  select jsonb_build_object('last_touch', d.touch_number, 'last_at', d.created_at)
    into v_followup from public.followup_drafts d where d.tenant_id = p_tenant_id order by d.created_at desc, d.id desc limit 1;
  select jsonb_build_object('last_type', e.type, 'last_at', e.recorded_at)
    into v_order from public.order_events e where e.tenant_id = p_tenant_id order by e.recorded_at desc, e.id desc limit 1;

  return jsonb_build_object(
    'agents_enabled', v_switch,
    'researcher', v_research,
    'requirement_analyst', v_require,
    'quote_writer', coalesce(v_quote, '{}'::jsonb),
    'followup_desk', coalesce(v_followup, '{}'::jsonb),
    'order_desk', coalesce(v_order, '{}'::jsonb));
end;
$$;
revoke all on function public.agents_status(uuid) from public, anon;
grant execute on function public.agents_status(uuid) to authenticated;
