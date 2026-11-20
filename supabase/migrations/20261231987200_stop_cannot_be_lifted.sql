-- A STOP that came from the customer can never be lifted by anyone (owner, 21 Nov 2026; the second door of the do-not-call list).
-- public.lift_suppression (the CRM's old door) refuses with SM985 (stopped_by_customer) when the contact's latest suppression is `opted_out` with a WhatsApp or call reference.
-- Everything else stays as it was: an owner-added (manual) or owner-said suppression is still the Owner's to lift, with the second factor.

create or replace function public.lift_suppression(
  p_tenant_id     uuid,
  p_contact_id    uuid,
  p_evidence_type public.evidence_type,
  p_evidence_ref  text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_contact public.contacts;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_contact_id is null then
    raise exception 'tenant and contact are required' using errcode = '22023';
  end if;
  if not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'only an owner can lift a suppression' using errcode = '42501';
  end if;
  -- T010 / ADR 0020 (owner decision 4): the Owner, with a second factor
  perform app.require_aal2();
  if p_evidence_type is null or p_evidence_ref is null then
    raise exception 'lifting a suppression requires evidence' using errcode = '22023';
  end if;

  select * into v_contact from public.contacts
   where id = p_contact_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_contact.suppressed_at is null then
    return null;
  end if;

  -- owner, 21 Nov 2026: a STOP that came from the customer (on WhatsApp or on a call) can never be lifted by anyone, the Owner included. It comes off only when the customer opts back in
  -- (app.dnc_opt_in). A suppression the owner made themselves (manual, or said in chat) stays the Owner's to lift.
  if exists (select 1
               from (select e.suppression_reason::text as reason, e.evidence_ref
                       from public.consent_events e
                      where e.tenant_id = p_tenant_id and e.contact_id = p_contact_id and e.event_type = 'suppressed'
                      order by e.created_at desc, e.id desc
                      limit 1) s
              where app.dnc_reason_of(s.reason, s.evidence_ref) in ('stop_whatsapp', 'asked_on_call')) then
    perform app.jobs_error('stopped');
  end if;

  -- Only the suppression flags change. Consent columns are deliberately untouched: if the
  -- suppression withdrew consent, it stays withdrawn until a fresh record_consent grant.
  update public.contacts set suppressed_at = null, suppression_reason = null
   where id = p_contact_id;

  insert into public.consent_events
    (tenant_id, contact_id, event_type, evidence_type, evidence_ref, recorded_by)
  values
    (p_tenant_id, p_contact_id, 'suppression_lifted', p_evidence_type, p_evidence_ref, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
