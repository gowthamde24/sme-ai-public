-- T003 / 1d: two business-rule errors get their own SQLSTATE so callers never have to match message
-- text, and a suppressed contact cannot be granted consent.
--
--   SM001  opportunity: won and lost are terminal (reopen first)
--   SM002  contact is suppressed; lift the suppression first (granting consent)
--
-- 'SM' is not a class Postgres uses. Withdrawals stay allowed on suppressed AND archived contacts:
-- "stop contacting me" must always be recordable.

-- F2: the terminal-transition error (was 23514 + message text)
create or replace function app.guard_opportunity_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.closed_at := case when new.status in ('won', 'lost') then now() end;
    return new;
  end if;

  if new.status = old.status then
    new.closed_at := old.closed_at;
  elsif old.status = 'open' then
    new.closed_at := now();                      -- open -> won | lost
  elsif new.status = 'open' then                   -- reopen
    if auth.uid() is not null
       and not app.has_tenant_role(new.tenant_id, array['owner', 'admin']::public.app_role[]) then
      raise exception 'only an owner or admin can reopen a closed opportunity' using errcode = '42501';
    end if;
    new.closed_at := null;
    new.lost_reason := null;
  else                                             -- won <-> lost
    raise exception 'won and lost are terminal: reopen the opportunity first' using errcode = 'SM001';
  end if;
  return new;
end;
$$;

-- F1: no grant while suppressed. Everything else is exactly the 1c body.
create or replace function public.record_consent(
  p_tenant_id     uuid,
  p_contact_id    uuid,
  p_channel       public.consent_channel,
  p_status        public.consent_status,
  p_basis         public.consent_basis default null,
  p_evidence_type public.evidence_type default null,
  p_evidence_ref  text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_contact public.contacts;
  v_current public.consent_status;
  v_event   public.consent_event_type;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_contact_id is null or p_channel is null or p_status is null then
    raise exception 'tenant, contact, channel and status are required' using errcode = '22023';
  end if;
  if not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'your role cannot record consent' using errcode = '42501';
  end if;
  if p_status not in ('granted', 'withdrawn') then
    raise exception 'status must be granted or withdrawn' using errcode = '22023';
  end if;
  if p_status = 'granted' and (p_basis is null or p_evidence_type is null or p_evidence_ref is null) then
    raise exception 'granting consent requires a basis, an evidence type and an evidence reference'
      using errcode = '22023';
  end if;

  select * into v_contact from public.contacts
   where id = p_contact_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if p_status = 'granted' and v_contact.suppressed_at is not null then
    raise exception 'contact is suppressed; lift the suppression first' using errcode = 'SM002';
  end if;

  v_current := case p_channel
                 when 'email' then v_contact.email_consent
                 when 'whatsapp' then v_contact.whatsapp_consent
                 when 'phone' then v_contact.phone_consent
               end;
  v_event := p_status::text::public.consent_event_type;

  if v_current = p_status then
    select e.id into v_id from public.consent_events e
     where e.tenant_id = p_tenant_id and e.contact_id = p_contact_id
       and e.channel = p_channel and e.event_type = v_event
     order by e.created_at desc, e.id desc limit 1;
    return v_id;
  end if;

  if p_channel = 'email' then
    update public.contacts set email_consent = p_status where id = p_contact_id;
  elsif p_channel = 'whatsapp' then
    update public.contacts set whatsapp_consent = p_status where id = p_contact_id;
  elsif p_channel = 'phone' then
    update public.contacts set phone_consent = p_status where id = p_contact_id;
  else
    raise exception 'unsupported channel' using errcode = '22023';
  end if;

  insert into public.consent_events
    (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
  values
    (p_tenant_id, p_contact_id, v_event, p_channel, p_basis, p_evidence_type, p_evidence_ref, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
