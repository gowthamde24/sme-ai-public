-- ct: one timeline per customer (app v4, part 3; owner 6 Nov 2026; C2's request #1): every call, message, quote, visit, order, follow-up and outcome of one lead, newest first, each as
-- {kind, at, text, target, detail}. SECURITY INVOKER: it reads the tables as the signed-in member, so every table's own row-level security decides what is there (a member of another workspace
-- gets nothing). Read only. Text is cut to 200 characters; amounts stay in paise.

create function public.customer_timeline(p_tenant_id uuid, p_lead_id uuid, p_before timestamptz default null, p_limit integer default 50) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with items as (
    select 'call'::text as kind, coalesce(c.ended_at, c.answered_at, c.created_at) as at,
           left(coalesce(nullif(btrim(c.summary), ''), c.outcome, c.state), 200) as text,
           jsonb_build_object('type', 'phone_call', 'id', c.id) as target,
           jsonb_build_object('direction', c.direction, 'duration_s', c.duration_s, 'outcome', c.outcome, 'recorded', c.recorded, 'simulated', c.simulated) as detail
      from public.phone_calls c where c.tenant_id = p_tenant_id and c.lead_id = p_lead_id
    union all
    select 'message_in', e.received_at, left(coalesce(nullif(btrim(e.body), ''), e.subject, ''), 200), jsonb_build_object('type', 'enquiry', 'id', e.id),
           jsonb_build_object('channel', e.channel)
      from public.enquiries e where e.tenant_id = p_tenant_id and e.lead_id = p_lead_id and e.archived_at is null
    union all
    select 'arrival', a.received_at, left(coalesce(nullif(btrim(a.message), ''), a.source_tag, a.kind), 200), jsonb_build_object('type', 'lead', 'id', a.lead_id),
           jsonb_build_object('source', a.source_tag, 'how', a.kind)
      from public.lead_arrivals a where a.tenant_id = p_tenant_id and a.lead_id = p_lead_id
    union all
    select 'message_out', coalesce(o.sent_at, o.created_at), left(coalesce(o.body, ''), 200), jsonb_build_object('type', 'outbox_message', 'id', o.id),
           jsonb_build_object('channel', o.channel, 'status', o.status, 'category', o.category)
      from public.outbox_messages o where o.tenant_id = p_tenant_id and o.lead_id = p_lead_id
    union all
    select 'quote', coalesce(q.approved_at, q.created_at), 'Quote ' || q.quote_no, jsonb_build_object('type', 'quote', 'id', q.id),
           jsonb_build_object('status', q.status, 'total_paise', q.total_paise)
      from public.quotes q where q.tenant_id = p_tenant_id and q.lead_id = p_lead_id
    union all
    select 'quote', coalesce(m.approved_at, m.created_at), 'Quote ' || m.quote_no, jsonb_build_object('type', 'material_quote', 'id', m.id),
           jsonb_build_object('status', m.status, 'total_paise', m.total_paise)
      from public.material_quotes m where m.tenant_id = p_tenant_id and m.lead_id = p_lead_id
    union all
    select 'visit', coalesce(v.starts_at, v.created_at), left(coalesce(nullif(btrim(v.purpose), ''), 'Visit'), 200), jsonb_build_object('type', 'visit', 'id', v.id),
           jsonb_build_object('status', v.status, 'starts_at', v.starts_at, 'outcome', v.outcome)
      from public.store_visits v where v.tenant_id = p_tenant_id and v.lead_id = p_lead_id
    union all
    select 'order', r.created_at, 'Order ' || r.order_no, jsonb_build_object('type', 'order', 'id', r.id),
           jsonb_build_object('state', r.state, 'total_paise', r.order_total_paise)
      from public.orders r where r.tenant_id = p_tenant_id and r.lead_id = p_lead_id
    union all
    select 'follow_up', t.occurred_at, t.channel::text || ' ' || t.direction::text, jsonb_build_object('type', 'lead', 'id', t.lead_id),
           jsonb_build_object('channel', t.channel, 'direction', t.direction)
      from public.lead_touches t where t.tenant_id = p_tenant_id and t.lead_id = p_lead_id
    union all
    select 'outcome', u.occurred_at, coalesce(u.category, u.outcome), jsonb_build_object('type', 'lead', 'id', u.lead_id),
           jsonb_build_object('outcome', u.outcome, 'category', u.category, 'source', u.kind, 'corrected', u.corrected_at is not null)
      from public.outcomes u where u.tenant_id = p_tenant_id and u.lead_id = p_lead_id
  ), page as (
    select * from items
     where at is not null and (p_before is null or at < p_before)
     order by at desc, kind
     limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'at', at, 'text', text, 'target', target, 'detail', detail) order by at desc, kind), '[]'::jsonb) from page
$$;
revoke all on function public.customer_timeline(uuid, uuid, timestamptz, integer) from public, anon;
grant execute on function public.customer_timeline(uuid, uuid, timestamptz, integer) to authenticated;
