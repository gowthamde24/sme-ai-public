-- My AI team v2, part T1 (owner approved 6 Nov 2026; docs/contracts/ai-team.md): one READ function for the day view, GET /ai-team/day.
-- Every mark is a real row of the table that records the action (lead_arrivals, prospect_searches, prospects, phone_calls, store_visits, outbox_messages, followup_drafts, outreach_handoffs, quotes,
-- material_quotes, order_events, admission_events, campaign_steps, ledger_entries, marks_send_log). The ⚑ marks (needs_owner) are, for TODAY only, exactly the items Today's "Needs you" lists (with the same
-- conditions and the same role gates as public.today_summary), each attributed to its helper, plus the visits the assistant proposed and the Lead Finder businesses waiting for the Owner. No table, no write.
-- Owner, Admin and Sales read it (a Viewer gets 42501). Names are shown as Today shows them.

create function public.ai_team_day(p_tenant_id uuid, p_date date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_decider boolean;
  v_owner   boolean;
  v_reader  boolean;
  v_india   date := (now() at time zone 'Asia/Kolkata')::date;
  v_from    timestamptz;
  v_to      timestamptz;
  v_today   boolean;
  v_school  boolean;
  v_marks   jsonb;
  v_lanes   jsonb;
  v_flow    jsonb;
  v_cost    jsonb;
  v_status  jsonb;
  v_hours   jsonb;
  v_day     text;
begin
  if auth.uid() is null or p_tenant_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_decider := app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  v_owner   := app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]);
  v_reader  := app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if not v_reader then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_india or p_date < v_india - 31 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_from   := (p_date::timestamp at time zone 'Asia/Kolkata');
  v_to     := v_from + interval '1 day';
  v_today  := p_date = v_india;
  v_school := app.module_enabled(p_tenant_id, 'programmes');

  -- ---------------------------------------------------------------------------------------------------------------- the marks: (helper, id, t, kind, seconds, label, ref_type, ref_id, needs, in_day)
  with m as (
    -- Lead catcher: a lead arrived
    select 'lead_catcher'::text as helper, 'lead_arrival:' || a.id as id, a.received_at as t, 'lead_in'::text as kind, null::integer as seconds,
           left(coalesce(k.full_name, 'A lead'), 40) || ' · ' || a.source_tag as label, 'lead'::text as ref_type, a.lead_id as ref_id, false as needs, true as in_day
      from public.lead_arrivals a
      left join public.contacts k on k.tenant_id = a.tenant_id and k.id = a.contact_id
     where a.tenant_id = p_tenant_id and a.created_at >= v_from - interval '1 hour' and a.created_at < v_to + interval '1 hour' and a.received_at >= v_from and a.received_at < v_to
    -- Lead Finder: a search ran, a business was found (and, today, one that waits for the Owner)
    union all
    select 'lead_finder', 'prospect_search:' || s.id, coalesce(s.approved_at, s.created_at), 'search', null, left(s.query, 60), 'prospect_search', s.id, false, true
      from public.prospect_searches s
     where s.tenant_id = p_tenant_id and s.created_at >= v_from - interval '1 day' and s.created_at < v_to and coalesce(s.approved_at, s.created_at) >= v_from and coalesce(s.approved_at, s.created_at) < v_to
    union all
    select 'lead_finder', 'prospect:' || p.id, p.created_at, 'found', null, left(p.name, 40) || ' · ' || p.status, 'prospect', p.id, false, true
      from public.prospects p
     where p.tenant_id = p_tenant_id and p.created_at >= v_from and p.created_at < v_to
    union all
    select 'lead_finder', 'prospect:' || p.id, p.created_at, 'found', null, left(p.name, 40) || ' · waiting for you', 'prospect', p.id, true, false
      from public.prospects p
     where v_today and v_reader and p.tenant_id = p_tenant_id and p.status = 'needs_owner' and (p.ask_after is null or p.ask_after <= now())
    -- Caller: a call (its length), a visit booked; today: asked for a person, asked for a visit, a call to approve, a paused list, a visit the assistant proposed
    union all
    select 'caller', 'phone_call:' || c.id, c.created_at, 'call', c.duration_s,
           left(coalesce(k.full_name, case c.direction when 'inbound' then 'A caller' else 'A lead' end), 40) || ' · ' || coalesce(c.category, c.outcome, c.state), 'call', c.id, false, true
      from public.phone_calls c
      left join public.contacts k on k.tenant_id = c.tenant_id and k.id = c.contact_id
     where c.tenant_id = p_tenant_id and c.created_at >= v_from and c.created_at < v_to
    union all
    select 'caller', 'phone_call:' || c.id, coalesce(c.ended_at, c.created_at), 'call', c.duration_s,
           left(coalesce(k.full_name, 'A caller'), 40) || case when c.end_reason = 'handover' then ' · asked for a person' else ' · asked for a visit' end, 'call', c.id, true, false
      from public.phone_calls c
      left join public.contacts k on k.tenant_id = c.tenant_id and k.id = c.contact_id
     where v_today and v_reader and c.tenant_id = p_tenant_id and c.handled_at is null and c.created_at >= now() - interval '7 days'
       and (c.end_reason = 'handover' or (c.captured ? 'visit_at' and coalesce(c.end_reason, '') <> 'handover'))
    union all
    select 'caller', 'call_request:' || r.id, r.created_at, 'call', null, left(coalesce(k.full_name, 'A lead'), 40) || ' · call to approve', 'lead', r.lead_id, true, false
      from public.call_requests r
      left join public.contacts k on k.tenant_id = r.tenant_id and k.id = r.contact_id
     where v_today and v_owner and r.tenant_id = p_tenant_id and r.status = 'requested'
    union all
    select 'caller', 'outreach_batch:' || b.id, coalesce(b.paused_at, b.created_at), 'call', null, left(b.name, 40) || ' · paused at the limit', 'campaign', b.id, true, false
      from public.outreach_batches b
     where v_today and v_decider and b.tenant_id = p_tenant_id and b.status = 'paused' and b.paused_reason in ('cap_calls', 'cap_minutes')
    union all
    select 'caller', 'store_visit:' || v.id, v.created_at, 'visit', null, left(coalesce(k.full_name, 'A customer'), 40) || ' · ' || to_char(v.starts_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'),
           'visit', v.id, false, true
      from public.store_visits v
      left join public.contacts k on k.tenant_id = v.tenant_id and k.id = v.contact_id
     where v.tenant_id = p_tenant_id and v.created_at >= v_from and v.created_at < v_to
    union all
    select 'caller', 'store_visit:' || v.id, v.created_at, 'visit', null, left(coalesce(k.full_name, 'A customer'), 40) || ' · visit to confirm', 'visit', v.id, true, false
      from public.store_visits v
      left join public.contacts k on k.tenant_id = v.tenant_id and k.id = v.contact_id
     where v_today and v_reader and v.tenant_id = p_tenant_id and v.status = 'booked' and v.source = 'assistant' and v.starts_at >= now() and v.starts_at < now() + interval '61 days'
    -- Follow-ups (and, for a school, fee reminders and notices): a message sent; a follow-up drafted; today: a draft or a message to approve, a hot lead waiting
    union all
    select case when cp.kind = 'fee_due' and v_school then 'fee_reminders' when cp.kind in ('event', 'exam', 'holiday') and v_school then 'notices' else 'followups' end,
           'outbox_message:' || o.id, o.sent_at, case when cp.kind = 'fee_due' and v_school then 'fee_reminder' when cp.kind in ('event', 'exam', 'holiday') and v_school then 'notice' else 'message' end, null,
           left(coalesce(k.full_name, 'A customer'), 40) || ' · ' || o.category, 'lead', o.lead_id, false, true
      from public.outbox_messages o
      left join public.contacts k on k.tenant_id = o.tenant_id and k.id = o.contact_id
      left join public.campaign_steps st on st.tenant_id = o.tenant_id and st.outbox_message_id = o.id
      left join public.campaigns cp on cp.tenant_id = st.tenant_id and cp.id = st.campaign_id
     where o.tenant_id = p_tenant_id and o.created_at >= v_from - interval '14 days' and o.created_at < v_to and o.status = 'sent' and o.sent_at >= v_from and o.sent_at < v_to
    union all
    select 'followups', 'followup_draft:' || d.id, d.created_at, 'followup_due', null, left(coalesce(c.name, 'A lead'), 40) || ' · follow-up ' || d.touch_number, 'lead', d.lead_id, false, true
      from public.followup_drafts d
      left join public.leads l on l.tenant_id = d.tenant_id and l.id = d.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where d.tenant_id = p_tenant_id and d.created_at >= v_from and d.created_at < v_to and not (v_today and v_decider and d.status = 'draft')
    union all
    select 'followups', 'followup_draft:' || d.id, d.created_at, 'followup_due', null, left(coalesce(c.name, 'A lead'), 40) || ' · follow-up to approve', 'lead', d.lead_id, true, d.created_at >= v_from
      from public.followup_drafts d
      left join public.leads l on l.tenant_id = d.tenant_id and l.id = d.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_today and v_decider and d.tenant_id = p_tenant_id and d.status = 'draft'
    union all
    select 'followups', 'outbox_message:' || o.id, o.created_at, 'message', null, left(coalesce(k.full_name, 'A customer'), 40) || ' · message to approve', 'lead', o.lead_id, true, false
      from public.outbox_messages o
      left join public.contacts k on k.tenant_id = o.tenant_id and k.id = o.contact_id
     where v_today and v_decider and o.tenant_id = p_tenant_id and o.status = 'needs_approval'
    union all
    select 'followups', 'outreach_handoff:' || h.id, h.notified_at, 'followup_due', null, left(coalesce(k.full_name, 'A hot lead'), 40) || ' · hot lead waiting', 'lead', h.lead_id, true, false
      from public.outreach_handoffs h
      left join public.contacts k on k.tenant_id = h.tenant_id and k.id = h.contact_id
     where v_today and v_reader and h.tenant_id = p_tenant_id and (v_decider or h.assigned_to = auth.uid()) and h.acted_at is null and h.reminder_sent_at is not null
    -- Quote writer: made, approved; today: one to approve
    union all
    select 'quote_writer', 'quote:' || q.id, q.created_at, 'quote', null, left(coalesce(c.name, 'A customer'), 40) || ' · ' || q.quote_no, 'quote', q.id, false, true
      from public.quotes q
      left join public.leads l on l.tenant_id = q.tenant_id and l.id = q.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where q.tenant_id = p_tenant_id and q.created_at >= v_from and q.created_at < v_to and not (v_today and v_decider and q.status = 'draft')
    union all
    select 'quote_writer', 'quote:' || q.id, q.created_at, 'quote', null, left(coalesce(c.name, 'A customer'), 40) || ' · ' || q.quote_no || ' · to approve', 'quote', q.id, true, q.created_at >= v_from
      from public.quotes q
      left join public.leads l on l.tenant_id = q.tenant_id and l.id = q.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_today and v_decider and q.tenant_id = p_tenant_id and q.status = 'draft'
    union all
    select 'quote_writer', 'quote_approved:' || q.id, q.approved_at, 'quote_approved', null, left(coalesce(c.name, 'A customer'), 40) || ' · ' || q.quote_no, 'quote', q.id, false, true
      from public.quotes q
      left join public.leads l on l.tenant_id = q.tenant_id and l.id = q.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where q.tenant_id = p_tenant_id and q.created_at >= v_from - interval '31 days' and q.created_at < v_to and q.approved_at >= v_from and q.approved_at < v_to
    union all
    select 'quote_writer', 'material_quote:' || q.id, q.created_at, 'quote', null, 'Material quote' || case when q.status = 'draft' and v_today and v_decider then ' · to approve' else '' end, 'quote', q.id,
           v_today and v_decider and q.status = 'draft', q.created_at >= v_from
      from public.material_quotes q
     where q.tenant_id = p_tenant_id and ((q.created_at >= v_from and q.created_at < v_to) or (v_today and v_decider and q.status = 'draft'))
    -- Order desk: every step of an order; today: money still held on a closed order (the Owner)
    union all
    select 'order_desk', 'order_event:' || e.id, e.recorded_at, 'order', null, 'Order ' || o.order_no || ' · ' || e.new_state, 'order', e.order_id, false, true
      from public.order_events e
      join public.orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
     where e.tenant_id = p_tenant_id and e.recorded_at >= v_from and e.recorded_at < v_to
    union all
    select 'order_desk', 'order:' || o.id, coalesce(o.closed_at, o.updated_at), 'order', null, 'Order ' || o.order_no || ' · money held', 'order', o.id, true, false
      from public.orders o
      join public.order_ledger g on g.tenant_id = o.tenant_id and g.order_id = o.id
     where v_today and v_owner and o.tenant_id = p_tenant_id and o.state in ('declined', 'expired', 'cancelled') and g.net_paise > 0
    -- School: admissions moved, fee payments, notices and marks messages; today: a campaign to approve, fees overdue
    union all
    select 'admissions', 'admission_event:' || e.id, e.at, case when e.stage = 'admitted' then 'admission' when e.stage = 'campus_visit' then 'visit' else 'lead_in' end, null,
           left(coalesce(k.full_name, 'A family'), 40) || ' · ' || e.stage, 'student', a.id, false, true
      from public.admission_events e
      join public.admissions a on a.tenant_id = e.tenant_id and a.id = e.admission_id
      left join public.contacts k on k.tenant_id = a.tenant_id and k.id = a.contact_id
     where v_school and e.tenant_id = p_tenant_id and e.created_at >= v_from - interval '1 day' and e.created_at < v_to + interval '1 day' and e.at >= v_from and e.at < v_to
    union all
    select 'fee_reminders', 'ledger_entry:' || x.id, x.recorded_at, 'payment', null, 'Payment recorded', 'campaign', x.id, false, true
      from public.ledger_entries x
     where v_school and v_decider and x.tenant_id = p_tenant_id and x.kind = 'payment' and x.voided_at is null and x.recorded_at >= v_from and x.recorded_at < v_to
    union all
    select 'notices', 'marks_send:' || s.id, s.sent_at, 'notice', null, 'Marks message', 'campaign', s.batch_id, false, true
      from public.marks_send_log s
     where v_school and s.tenant_id = p_tenant_id and s.status = 'sent' and s.created_at >= v_from - interval '1 day' and s.created_at < v_to and s.sent_at >= v_from and s.sent_at < v_to
    union all
    select case when cp.kind = 'fee_due' and v_school then 'fee_reminders' when cp.kind in ('event', 'exam', 'holiday') and v_school then 'notices' else 'followups' end,
           'campaign:' || cp.id, cp.updated_at, case when cp.kind = 'fee_due' and v_school then 'fee_reminder' when cp.kind in ('event', 'exam', 'holiday') and v_school then 'notice' else 'message' end, null,
           left(cp.name, 40) || ' · to approve', 'campaign', cp.id, true, false
      from public.campaigns cp
     where v_today and v_decider and cp.tenant_id = p_tenant_id and cp.status = 'draft'
    union all
    select 'fee_reminders', 'fees_overdue:' || p_tenant_id, now(), 'fee_reminder', null, f.students || ' students with fees overdue', 'campaign', p_tenant_id, true, false
      from app.today_fees_overdue(p_tenant_id) f
     where v_today and v_decider and f.students > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('helper', helper, 'id', id, 't', t, 'kind', kind, 'seconds', seconds, 'label', label, 'ref_type', ref_type, 'ref_id', ref_id, 'needs', needs, 'in_day', in_day)), '[]'::jsonb)
    into v_marks
    from m
   where t is not null;

  -- ---------------------------------------------------------------------------------------------------------------- live status (today only)
  if v_today then
    v_status := jsonb_build_object(
      'caller_busy', (select jsonb_build_object('who', left(coalesce(k.full_name, 'a caller'), 40), 'since', coalesce(c.answered_at, c.created_at))
                        from public.phone_calls c left join public.contacts k on k.tenant_id = c.tenant_id and k.id = c.contact_id
                       where c.tenant_id = p_tenant_id and c.state in ('ringing', 'in_progress') and c.created_at >= now() - interval '2 hours'
                       order by c.created_at desc limit 1),
      'caller_due', (select jsonb_build_object('count', count(*), 'at', min(i.next_at)) from public.outreach_items i
                      where i.tenant_id = p_tenant_id and i.status = 'waiting' and i.next_action = 'call' and i.next_at is not null),
      'followups_due', (select jsonb_build_object('count', count(*), 'at', min(o.scheduled_for)) from public.outbox_messages o
                         where o.tenant_id = p_tenant_id and o.status = 'queued' and o.scheduled_for is not null));
  end if;

  -- ---------------------------------------------------------------------------------------------------------------- the flow strip
  if v_school then
    v_flow := jsonb_build_object('steps', jsonb_build_array(
      jsonb_build_object('key', 'enquiries', 'count', (select count(*) from public.admission_events e where e.tenant_id = p_tenant_id and e.stage = 'enquiry' and e.at >= v_from and e.at < v_to)),
      jsonb_build_object('key', 'called', 'count', (select count(distinct coalesce(c.contact_id, c.id)) from public.phone_calls c where c.tenant_id = p_tenant_id and c.created_at >= v_from and c.created_at < v_to)),
      jsonb_build_object('key', 'campus_visits', 'count', (select count(*) from public.admission_events e where e.tenant_id = p_tenant_id and e.stage = 'campus_visit' and e.at >= v_from and e.at < v_to)),
      jsonb_build_object('key', 'admissions', 'count', (select count(*) from public.admission_events e where e.tenant_id = p_tenant_id and e.stage = 'admitted' and e.at >= v_from and e.at < v_to))),
      'extra', case when v_decider then jsonb_build_array(jsonb_build_object('key', 'fees_collected', 'count',
                 (select count(*) from public.ledger_entries x where x.tenant_id = p_tenant_id and x.kind = 'payment' and x.voided_at is null and x.recorded_at >= v_from and x.recorded_at < v_to))) else '[]'::jsonb end);
  else
    v_flow := jsonb_build_object('steps', jsonb_build_array(
      jsonb_build_object('key', 'leads_in', 'count', (select count(*) from public.lead_arrivals a where a.tenant_id = p_tenant_id and a.kind = 'first' and a.created_at >= v_from - interval '1 hour' and a.created_at < v_to + interval '1 hour' and a.received_at >= v_from and a.received_at < v_to)),
      jsonb_build_object('key', 'called', 'count', (select count(distinct coalesce(c.contact_id, c.id)) from public.phone_calls c where c.tenant_id = p_tenant_id and c.direction = 'outbound' and c.created_at >= v_from and c.created_at < v_to)),
      jsonb_build_object('key', 'interested', 'count', (select count(*) from public.phone_calls c where c.tenant_id = p_tenant_id and c.created_at >= v_from and c.created_at < v_to and c.category in ('interested', 'visit_booked', 'order_likely'))),
      jsonb_build_object('key', 'quotes', 'count', (select count(*) from public.quotes q where q.tenant_id = p_tenant_id and q.created_at >= v_from and q.created_at < v_to)
                                                  + (select count(*) from public.material_quotes q where q.tenant_id = p_tenant_id and q.created_at >= v_from and q.created_at < v_to)),
      jsonb_build_object('key', 'orders', 'count', (select count(*) from public.orders o where o.tenant_id = p_tenant_id and o.created_at >= v_from and o.created_at < v_to))),
      'extra', '[]'::jsonb);
  end if;

  -- ---------------------------------------------------------------------------------------------------------------- what the day cost (Owner, Admin)
  if v_decider then
    v_cost := jsonb_build_object(
      'calls_paise', (select coalesce(sum(c.cost_paise), 0) from public.phone_calls c where c.tenant_id = p_tenant_id and c.created_at >= v_from and c.created_at < v_to),
      'calls_seconds', (select coalesce(sum(c.duration_s), 0) from public.phone_calls c where c.tenant_id = p_tenant_id and c.created_at >= v_from and c.created_at < v_to),
      'search_paise', (select coalesce(sum(s.cost_paise), 0) from public.prospect_searches s where s.tenant_id = p_tenant_id and s.approved_at >= v_from and s.approved_at < v_to),
      'messages', (select count(*) from public.outbox_messages o where o.tenant_id = p_tenant_id and o.created_at >= v_from - interval '14 days' and o.created_at < v_to and o.status = 'sent' and o.sent_at >= v_from and o.sent_at < v_to),
      'ai_micros', case when v_today then (select coalesce(sum(coalesce(r.settled_micros, r.reserved_micros)), 0) from public.agent_cost_reservations r where r.tenant_id = p_tenant_id and r.created_at >= v_from and r.created_at < v_to) end,
      'ai_cap_micros', case when v_today then app.agent_daily_cap(p_tenant_id) end);
  end if;

  -- ---------------------------------------------------------------------------------------------------------------- the business's hours for that weekday (store hours), else 9:00-20:00
  v_day := lower(to_char(p_date, 'Dy'));
  v_hours := (select s.weekly_hours -> v_day from public.store_settings s where s.tenant_id = p_tenant_id);

  return jsonb_build_object('date', p_date, 'now', now(), 'today', v_today, 'school', v_school,
                            'modules', jsonb_build_object('lead_finder', app.module_enabled(p_tenant_id, 'lead_finder'), 'quotes', app.module_enabled(p_tenant_id, 'quotes')),
                            'numbers', jsonb_build_object(
                              'caller', (select jsonb_build_object('calls', count(*), 'connected', count(*) filter (where c.answered_at is not null),
                                                                   'interested', count(*) filter (where c.category in ('interested', 'visit_booked', 'order_likely')), 'seconds', coalesce(sum(c.duration_s), 0))
                                           from public.phone_calls c where c.tenant_id = p_tenant_id and c.created_at >= v_from and c.created_at < v_to),
                              'lead_sources', (select coalesce(jsonb_agg(jsonb_build_object('source', z.source_tag, 'count', z.n) order by z.n desc, z.source_tag), '[]'::jsonb)
                                                 from (select a.source_tag, count(*) as n from public.lead_arrivals a
                                                        where a.tenant_id = p_tenant_id and a.created_at >= v_from - interval '1 hour' and a.created_at < v_to + interval '1 hour' and a.received_at >= v_from and a.received_at < v_to
                                                        group by a.source_tag) z)), 'role', case when v_owner then 'owner' when v_decider then 'admin' else 'sales' end,
                            'hours', v_hours, 'marks', v_marks, 'status', v_status, 'flow', v_flow, 'cost', v_cost);
end;
$$;

revoke all on function public.ai_team_day(uuid, date) from public, anon;
grant execute on function public.ai_team_day(uuid, date) to authenticated;
