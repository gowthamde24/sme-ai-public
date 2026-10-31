-- Job OR (owner, 31 Oct 2026): the live activity feed ("Live now": what the assistant is doing right now). GET /assistant/activity reads this.
-- Only real in-flight work, nothing historical, no message content, no phone number leaves except as the contact's own name/number for the display rule (the API turns it into a display name):
--   call            a call task contact in progress (task_contacts.status = in_progress), since it was claimed
--   whatsapp_reply  a reply to a customer's message drafted, waiting for approval, queued or sent in the last 60 s
--   follow_up       a follow-up queued, waiting for approval or sent in the last 60 s
--   quote_draft     a quote the assistant drafted in the last 60 s
--   lead_read       a lead the AI lead reader read in the last 60 s
-- Any member of the workspace may ask; a Viewer gets the work without who. At most 20 items, priority order (call, whatsapp_reply, follow_up, quote_draft, lead_read), newest first inside a type.

create function public.assistant_activity(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_full boolean;
  v_now  timestamptz := now();
  v_out  jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  v_full := app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', z.type, 'name', case when v_full then z.name end, 'phone', case when v_full then z.phone end, 'started_at', z.started_at,
           'elapsed_s', greatest(0, floor(extract(epoch from v_now - z.started_at)))::int, 'target_kind', z.target_kind, 'target_id', z.target_id)
         order by z.prio, z.started_at desc), '[]'::jsonb)
    into v_out
    from (
      select * from (
        select 1 as prio, 'call'::text as type, c.full_name as name, c.phone, tc.claimed_at as started_at, 'task'::text as target_kind, tc.task_id as target_id
          from public.task_contacts tc
          left join public.contacts c on c.tenant_id = tc.tenant_id and c.id = tc.contact_id and c.erased_at is null
         where tc.tenant_id = p_tenant_id and tc.status = 'in_progress' and tc.claimed_at is not null
        union all
        select 2, 'whatsapp_reply', c.full_name, c.phone, coalesce(m.sent_at, m.created_at), 'conversation', m.lead_id
          from public.outbox_messages m
          left join public.contacts c on c.tenant_id = m.tenant_id and c.id = m.contact_id and c.erased_at is null
         where m.tenant_id = p_tenant_id and m.category = 'reply_to_inbound' and m.status in ('queued', 'needs_approval', 'sent') and coalesce(m.sent_at, m.created_at) > v_now - interval '60 seconds'
        union all
        select 3, 'follow_up', c.full_name, c.phone, coalesce(m.sent_at, m.created_at), 'conversation', m.lead_id
          from public.outbox_messages m
          left join public.contacts c on c.tenant_id = m.tenant_id and c.id = m.contact_id and c.erased_at is null
         where m.tenant_id = p_tenant_id and m.category = 'followup' and m.status in ('queued', 'needs_approval', 'sent') and coalesce(m.sent_at, m.created_at) > v_now - interval '60 seconds'
        union all
        select 4, 'quote_draft', c.full_name, c.phone, q.created_at, 'quote', q.id
          from public.quotes q
          join public.leads l on l.tenant_id = q.tenant_id and l.id = q.lead_id
          left join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id and c.erased_at is null
         where q.tenant_id = p_tenant_id and q.status = 'draft' and q.created_via = 'agent' and q.created_at > v_now - interval '60 seconds'
        union all
        select 5, 'lead_read', c.full_name, c.phone, p.ai_read_at, 'lead', p.lead_id
          from public.lead_profiles p
          join public.leads l on l.tenant_id = p.tenant_id and l.id = p.lead_id
          left join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id and c.erased_at is null
         where p.tenant_id = p_tenant_id and p.ai_read_at is not null and p.ai_read_at > v_now - interval '60 seconds'
      ) u
      order by u.prio, u.started_at desc
      limit 20
    ) z;
  return v_out;
end;
$$;
revoke all on function public.assistant_activity(uuid) from public, anon;
grant execute on function public.assistant_activity(uuid) to authenticated;
comment on function public.assistant_activity(uuid) is 'Job OR: what the assistant is doing right now in this workspace (calls in progress, replies and follow-ups of the last minute, quotes drafted, leads read). No message text. PII: the contact name and number of each item, for the display rule; a Viewer gets none.';
