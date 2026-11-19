-- Proof of request, source 7 (owner, 19 Nov 2026): a PURCHASE in the last 30 days counts as a reason to call the customer back about it (feedback, delivery, care; never a sales pitch). The proof
-- gets the purchase's order id (`ref`), kept on the call row (`request_ref`). Consent is NOT part of the proof: every call also needs phone consent (app.can_contact), so a purchase without
-- consent is refused `no_consent`, and a purchase older than 30 days is no proof (`no_proof_of_request`).

alter table public.phone_calls add column request_ref uuid;
comment on column public.phone_calls.request_ref is 'SAFE: the id of the purchase (an order) that was the proof of request, when the source is purchase. CLEAN-EXEMPT: an id';

create or replace function app.call_back_proof(p_tenant uuid, p_contact uuid, p_days integer default 30) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(to_jsonb(x) - 'ord') from (
    select p.lead_id, p.source, p.at, p.ref, 1 as ord from (
      -- an arrival through a live source (first or again), not a list
      select a.lead_id, a.source_tag as source, a.received_at as at, null::uuid as ref
        from public.lead_arrivals a
       where a.tenant_id = p_tenant and a.contact_id = p_contact and a.kind in ('first', 'again')
         and a.source_tag in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'missed_calls', 'click_to_whatsapp')
      union all
      -- a lead made before arrivals were kept, from the same sources (never an import, never the owner's own entry, never a prospect)
      select l.id, l.source, l.created_at, null::uuid
        from public.leads l
       where l.tenant_id = p_tenant and l.contact_id = p_contact
         and l.source in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'missed_calls', 'click_to_whatsapp')
      union all
      -- a WhatsApp message the person sent
      select e.lead_id, 'whatsapp', e.received_at, null::uuid
        from public.enquiries e
       where e.tenant_id = p_tenant and e.contact_id = p_contact and e.channel = 'whatsapp' and e.lead_id is not null
      union all
      -- a call the person made to the business
      select c.lead_id, 'inbound_call', c.created_at, null::uuid
        from public.phone_calls c
       where c.tenant_id = p_tenant and c.contact_id = p_contact and c.direction = 'inbound' and c.state <> 'refused' and c.lead_id is not null
      union all
      -- a PURCHASE in the window (owner, 19 Nov 2026): an order of this customer that has reached money or goods (advance paid or later). The call is about the purchase (feedback, delivery, care), never a pitch; phone consent
      -- is checked separately and for every call (app.can_contact: a form tick or a recorded yes with how it was given), so a purchase without consent is refused `no_consent`. The order id is the proof.
      select o.lead_id, 'purchase', o.updated_at, o.id
        from public.orders o join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
       where o.tenant_id = p_tenant and l.contact_id = p_contact and o.state in ('advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid')
    ) p
    where p.lead_id is not null and p.at > app.outbox_now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
    order by p.at desc
    limit 1
  ) x
$$;

create or replace function public.phone_call_set_proof(p_tenant_id uuid, p_call_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_proof jsonb;
begin
  if not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  select c.contact_id into v_contact from public.phone_calls c where c.tenant_id = p_tenant_id and c.id = p_call_id;
  if v_contact is null then
    return null;
  end if;
  v_proof := app.call_back_proof(p_tenant_id, v_contact, 30);
  if v_proof is null then
    return null;
  end if;
  update public.phone_calls set request_lead_id = (v_proof ->> 'lead_id')::uuid, request_source = v_proof ->> 'source', request_at = (v_proof ->> 'at')::timestamptz, request_ref = (v_proof ->> 'ref')::uuid
   where tenant_id = p_tenant_id and id = p_call_id and request_lead_id is null;
  return v_proof;
end;
$$;
