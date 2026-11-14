-- Admin console phase 2, slice 4: unmasking. The support view shows end-customers as "P•••••• N••••" / "+•• ••••• ••210". To see the real name and number, support gives a SECOND reason (always in words, typed
-- after the first one, with the business's profile access still open) and it is logged as its own audit row (`unmask`), shown to the shop owner ("Stack19 support looked at your customers' contact details").
-- One call = one unmasked list (the same ten recent calls and ten recent chats as the support view); nothing is remembered, so each look needs its own reason. No message text, no transcript either way.

create or replace function public.activity_log(p_tenant_id uuid, p_limit integer default 50, p_before_at timestamptz default null, p_before_key text default null, p_kind text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_next  jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind not in ('call', 'message', 'action', 'support'))
     or ((p_before_at is null) <> (p_before_key is null)) or (p_before_key is not null and p_before_key !~ '^(call|message|action|support):[0-9a-f-]{36}$') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  with src as (
    (select c.created_at as at, 'call:' || c.id::text as key,
            jsonb_build_object('key', 'call:' || c.id::text, 'kind', 'call', 'id', c.id, 'at', c.created_at, 'who', 'assistant', 'direction', c.direction, 'state', c.state,
                               'live', app.phone_call_is_live(c), 'outcome', c.outcome, 'duration_s', c.duration_s, 'summary', c.summary,
                               'contact_id', c.contact_id, 'contact_name', (select x.full_name from public.contacts x where x.tenant_id = c.tenant_id and x.id = c.contact_id),
                               'lead_id', c.lead_id, 'sandbox', c.sandbox, 'simulated', c.simulated,
                               'waiting', (c.end_reason = 'handover' and c.handled_at is null), 'undo', jsonb_build_object('state', 'none', 'until', null)) as j
       from public.phone_calls c
      where c.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'call')
        and (p_before_at is null or (c.created_at, 'call:' || c.id::text) < (p_before_at, p_before_key))
      order by c.created_at desc, c.id desc limit p_limit + 1)
    union all
    (select m.created_at, 'message:' || m.id::text,
            jsonb_build_object('key', 'message:' || m.id::text, 'kind', 'message', 'id', m.id, 'at', m.created_at, 'who', m.source, 'channel', m.channel, 'category', m.category,
                               'status', m.status, 'reason', m.reason, 'flags', m.flags,
                               'contact_id', m.contact_id, 'contact_name', (select x.full_name from public.contacts x where x.tenant_id = m.tenant_id and x.id = m.contact_id),
                               'lead_id', m.lead_id, 'scheduled_for', m.scheduled_for,
                               'waiting', (m.status = 'needs_approval'), 'undo', jsonb_build_object('state', 'none', 'until', null))
       from public.outbox_messages m
      where m.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'message')
        and (p_before_at is null or (m.created_at, 'message:' || m.id::text) < (p_before_at, p_before_key))
      order by m.created_at desc, m.id desc limit p_limit + 1)
    union all
    (select w.created_at, 'action:' || w.id::text,
            jsonb_build_object('key', 'action:' || w.id::text, 'kind', 'action', 'id', w.id, 'at', w.created_at, 'who', 'assistant', 'tool', w.tool, 'summary', w.summary,
                               'status', w.status, 'requested_by', w.requested_by, 'decided_by', w.decided_by, 'plan_id', w.plan_id,
                               'waiting', false,
                               'undo', jsonb_build_object('state', case when w.status = 'undone' then 'done'
                                                                       when w.undo is null or w.status <> 'done' then 'none'
                                                                       when w.undo_until is not null and w.undo_until < now() then 'expired'
                                                                       else 'available' end,
                                                         'until', case when w.undo is not null and w.status = 'done' then w.undo_until end))
       from public.assistant_work_actions w
      where w.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'action')
        and (p_before_at is null or (w.created_at, 'action:' || w.id::text) < (p_before_at, p_before_key))
      order by w.created_at desc, w.id desc limit p_limit + 1)
    union all
    -- every time Stack19 support looked at this business (admin_access_open writes it as customer_visible): the shop owner sees who-what-why, never a staff name
    (select a.at, 'support:' || a.id::text,
            jsonb_build_object('key', 'support:' || a.id::text, 'kind', 'support', 'id', a.id, 'at', a.at, 'who', 'support', 'summary', case a.action when 'pause' then 'Stack19 support paused your assistant' when 'resume' then 'Stack19 support resumed your assistant' when 'credit' then 'Stack19 added a goodwill credit to your balance' when 'unmask' then 'Stack19 support looked at your customers'' contact details' else 'Stack19 support viewed your account' end,
                               'reason', admin.reason_label(a.reason_code, a.reason_text), 'waiting', false, 'undo', jsonb_build_object('state', 'none', 'until', null))
       from admin.audit a
      where a.tenant_id = p_tenant_id and a.customer_visible and (p_kind is null or p_kind = 'support')
        and (p_before_at is null or (a.at, 'support:' || a.id::text) < (p_before_at, p_before_key))
      order by a.at desc, a.id desc limit p_limit + 1)),
  page as (select s.at, s.key, s.j, row_number() over (order by s.at desc, s.key desc) as rn from src s order by s.at desc, s.key desc limit p_limit + 1)
  select coalesce(jsonb_agg(p.j order by p.rn) filter (where p.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('before_at', q.at, 'before_key', q.key) from page q where q.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1))
    into v_items, v_next
    from page p;
  return jsonb_build_object('items', v_items, 'next', v_next);
end;
$$;

create function public.admin_business_unmask(p_tenant_id uuid, p_access_id uuid, p_reason_code text, p_reason_text text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := btrim(coalesce(p_reason_text, ''));
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_tenant_id is null or p_access_id is null or p_reason_code is null or p_reason_code not in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if not exists (select 1 from admin.access_grants g where g.id = p_access_id and g.staff_id = v_staff.user_id and g.tenant_id = p_tenant_id and g.scope = 'profile' and g.expires_at > now()) then
    raise exception 'an access with a reason is required' using errcode = 'SM944';
  end if;
  -- the second reason is always in words
  if char_length(v_text) not between 3 and 300 or not app.text_is_clean(v_text) then
    raise exception 'a reason is required' using errcode = 'SM946';
  end if;
  perform admin.log(v_staff.user_id, 'unmask', p_tenant_id, 'unmask', p_reason_code, v_text, 'business', p_tenant_id::text, true);
  return jsonb_build_object(
    'recent_calls', coalesce((select jsonb_agg(x.j order by x.at desc) from (
        select c.created_at as at, jsonb_build_object('id', c.id, 'customer', k.full_name, 'customer_phone', k.phone) as j
          from public.phone_calls c left join public.contacts k on k.tenant_id = c.tenant_id and k.id = c.contact_id
         where c.tenant_id = p_tenant_id order by c.created_at desc limit 10) x), '[]'::jsonb),
    'recent_chats', coalesce((select jsonb_agg(y.j order by y.at desc) from (
        select z.last_at as at, jsonb_build_object('lead_id', z.lead_id, 'customer', k.full_name, 'customer_phone', k.phone) as j
          from (select e.lead_id, max(e.received_at) as last_at from public.enquiries e where e.tenant_id = p_tenant_id and e.channel = 'whatsapp' and e.lead_id is not null group by e.lead_id order by 2 desc limit 10) z
          join public.leads l on l.tenant_id = p_tenant_id and l.id = z.lead_id
          left join public.contacts k on k.tenant_id = p_tenant_id and k.id = l.contact_id) y), '[]'::jsonb));
end $$;
revoke all on function public.admin_business_unmask(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_business_unmask(uuid, uuid, text, text) to authenticated;
