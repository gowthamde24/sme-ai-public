-- PROOF OF REQUEST for a call-back (owner, 18 Nov 2026, the three answers accepted as proposed in docs/plans/outbound-proof-of-request.md):
--   a call-back to a customer needs a request the PERSON made, found by the database and not typed by anyone:
--     * the sources that count (they asked): the business's website form, a Meta lead ad, a Google Ads lead form, a portal e-mail (IndiaMART, JustDial, 99acres, MagicBricks, Housing), a forwarded e-mail,
--       a missed call, an ad that opens WhatsApp, a WhatsApp message the person sent, and a call the person made to the business;
--     * at most 30 days old;
--     * a list the business imported, pasted or uploaded NEVER counts, nor a lead the owner typed in, nor a Lead Finder prospect.
--   The call row keeps which lead, which source and when (copied at placing time, so the record survives a later edit of the lead). A live call without a proof is refused `no_proof_of_request`.
--   NOTHING is switched on by this migration: live calls stay refused (`live_not_confirmed` / `no_consent`) exactly as before; sandbox calls to the owner's own phone are unchanged.

alter table public.phone_calls add column request_lead_id uuid, add column request_source text, add column request_at timestamptz;
comment on column public.phone_calls.request_lead_id is 'SAFE: an internal id: the lead whose request this call-back answers';
comment on column public.phone_calls.request_source is 'SAFE: a closed word: the source tag of that request (website_form, meta_lead_ads, ...). CLEAN-EXEMPT: closed list';
comment on column public.phone_calls.request_at is 'SAFE: a timestamp: when the person asked';

do $patch$
declare
  r record;
  v_def text;
begin
  for r in select c.conname, pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.phone_calls'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%telephony_off%' loop
    v_def := r.d;
    if position($q$'no_consent'$q$ in v_def) = 0 then
      raise exception 'the refuse_reason list has changed: the proof patch no longer fits';
    end if;
    execute format('alter table public.phone_calls drop constraint %I', r.conname);
    execute format('alter table public.phone_calls add constraint %I %s', r.conname, replace(v_def, $q$'no_consent'$q$, $q$'no_consent', 'no_proof_of_request'$q$));
  end loop;
end;
$patch$;

-- the proof of a contact: the newest request of the allowed kind within the window (days), or null
create function app.call_back_proof(p_tenant uuid, p_contact uuid, p_days integer default 30) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(x) - 'ord' from (
    select p.lead_id, p.source, p.at, 1 as ord from (
      -- an arrival through a live source (first or again), not a list
      select a.lead_id, a.source_tag as source, a.received_at as at
        from public.lead_arrivals a
       where a.tenant_id = p_tenant and a.contact_id = p_contact and a.kind in ('first', 'again')
         and a.source_tag in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'missed_calls', 'click_to_whatsapp')
      union all
      -- a lead made before arrivals were kept, from the same sources (never an import, never the owner's own entry, never a prospect)
      select l.id, l.source, l.created_at
        from public.leads l
       where l.tenant_id = p_tenant and l.contact_id = p_contact
         and l.source in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'missed_calls', 'click_to_whatsapp')
      union all
      -- a WhatsApp message the person sent
      select e.lead_id, 'whatsapp', e.received_at
        from public.enquiries e
       where e.tenant_id = p_tenant and e.contact_id = p_contact and e.channel = 'whatsapp' and e.lead_id is not null
      union all
      -- a call the person made to the business
      select c.lead_id, 'inbound_call', c.created_at
        from public.phone_calls c
       where c.tenant_id = p_tenant and c.contact_id = p_contact and c.direction = 'inbound' and c.state <> 'refused' and c.lead_id is not null
    ) p
    where p.lead_id is not null and p.at > app.outbox_now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
    order by p.at desc
    limit 1
  ) x
$$;
revoke all on function app.call_back_proof(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- what the call path asks (the Owner or Admin of the workspace, or the phone server): the proof of a lead's contact, or null
create function public.call_back_proof(p_tenant_id uuid, p_lead_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not (app.is_scheduler() or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[])) then
    perform app.phone_error('deny');
  end if;
  select l.contact_id into v_contact from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if v_contact is null then
    return null;
  end if;
  return app.call_back_proof(p_tenant_id, v_contact, 30);
end;
$$;
revoke all on function public.call_back_proof(uuid, uuid) from public, anon;
grant execute on function public.call_back_proof(uuid, uuid) to authenticated;
comment on function public.call_back_proof(uuid, uuid) is 'The proof of request of a lead''s contact for a call-back: {lead_id, source, at} or null. Owner, Admin, the phone server.';

-- the call row keeps the proof (recomputed here, never taken from the caller)
create function public.phone_call_set_proof(p_tenant_id uuid, p_call_id uuid) returns jsonb
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
  update public.phone_calls set request_lead_id = (v_proof ->> 'lead_id')::uuid, request_source = v_proof ->> 'source', request_at = (v_proof ->> 'at')::timestamptz
   where tenant_id = p_tenant_id and id = p_call_id and request_lead_id is null;
  return v_proof;
end;
$$;
revoke all on function public.phone_call_set_proof(uuid, uuid) from public, anon;
grant execute on function public.phone_call_set_proof(uuid, uuid) to authenticated;
comment on function public.phone_call_set_proof(uuid, uuid) is 'Keeps the proof of request on a call row (the database finds it again from the call''s contact). Same writers as phone_call_begin.';
