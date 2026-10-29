-- Job EF: an "active conversation" (quiet hours do not hold a reply to a customer who wrote recently, job DX) is now TWO HOURS wide, not 30 minutes. Found on staging: the owner's reply to a customer who had
-- written 62 minutes earlier waited 8 hours for 09:00. Only the window changes; the helper keeps its rules (a follow-up is never inside a conversation; only WhatsApp messages of that lead count).
create or replace function app.outbox_active_conversation(p_tenant uuid, p_lead uuid, p_category text, p_at timestamptz) returns boolean
language sql
stable
set search_path = ''
as $$
  select p_category is distinct from 'followup'
     and coalesce(greatest(
           (select max(e.received_at) from public.enquiries e where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_at),
           (select max(t.occurred_at) from public.lead_touches t where t.tenant_id = p_tenant and t.lead_id = p_lead and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at <= p_at)
         ) >= p_at - interval '2 hours', false)
$$;
revoke all on function app.outbox_active_conversation(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
