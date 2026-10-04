-- T003 / 1c: review changes R1-R4 on top of 1b. (1b is not pushed yet, so these could have amended
-- it; they are a new migration so migration history is append-only from the first commit.)
--
-- R1 suppress_contact withdraws consent for the "stop contacting me" reasons; a lifted suppression
--    never revives consent.
-- R2 explicit NULL guards in all three consent functions (no silent fall-through).
-- R3 leads cannot be inserted with a chosen status.
-- R4 evidence_ref is a typed reference, "<kind>:<token>".

-- ---------------------------------------------------------------------------------------------
-- R4: typed-prefix evidence reference
-- ---------------------------------------------------------------------------------------------
alter table public.consent_events drop constraint consent_events_evidence_ref_check;
alter table public.consent_events add constraint consent_events_evidence_ref_check
  check (evidence_ref ~ '^[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}$');

comment on column public.consent_events.evidence_ref is
  'PII: typed opaque reference "<kind>:<token>" (e.g. form:8841, ticket:2201) to evidence kept elsewhere. '
  'The format makes accidental personal data unlikely; it does NOT prevent it. Classified PII so it is '
  'never copied into audit_events by value. Erasure overwrites it with a tombstone (e.g. erased:1) '
  'through a controlled exception to append-only.';

-- ---------------------------------------------------------------------------------------------
-- R3: records start in their initial state
-- ---------------------------------------------------------------------------------------------
revoke insert (status) on public.leads from authenticated;
-- opportunities.status was never in the INSERT grant; asserted by tests.

-- ---------------------------------------------------------------------------------------------
-- R1 + R2: suppress_contact
--   * reasons opted_out / complained / legal also withdraw every channel that is 'granted', in the
--     same transaction, with one 'withdrawn' ledger row per changed channel;
--   * bounced / manual only suppress (consent state untouched, as before);
--   * a repeat with the same (or a weaker) reason is a no-op; a withdrawing reason arriving on a
--     contact suppressed for a non-withdrawing one upgrades the reason and withdraws consent.
-- ---------------------------------------------------------------------------------------------
create or replace function public.suppress_contact(
  p_tenant_id     uuid,
  p_contact_id    uuid,
  p_reason        public.suppression_reason,
  p_evidence_type public.evidence_type default null,
  p_evidence_ref  text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_contact   public.contacts;
  v_id        uuid;
  v_withdraws boolean;
  v_was_withdrawing boolean;
  v_new_event boolean;
  v_ch        public.consent_channel;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_contact_id is null or p_reason is null then
    raise exception 'tenant, contact and reason are required' using errcode = '22023';
  end if;
  if not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'your role cannot suppress contacts' using errcode = '42501';
  end if;

  select * into v_contact from public.contacts
   where id = p_contact_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  v_withdraws := p_reason in ('opted_out', 'complained', 'legal');
  v_was_withdrawing := v_contact.suppression_reason in ('opted_out', 'complained', 'legal');
  -- a new 'suppressed' ledger row is needed when nothing is suppressed yet, or when a withdrawing
  -- reason upgrades a non-withdrawing one
  v_new_event := v_contact.suppressed_at is null or (v_withdraws and not v_was_withdrawing);

  if not v_new_event and not (v_withdraws
        and 'granted' in (v_contact.email_consent, v_contact.whatsapp_consent, v_contact.phone_consent)) then
    -- complete no-op (retry): hand back the latest suppression row
    select e.id into v_id from public.consent_events e
     where e.tenant_id = p_tenant_id and e.contact_id = p_contact_id and e.event_type = 'suppressed'
     order by e.created_at desc, e.id desc limit 1;
    return v_id;
  end if;

  -- One UPDATE: suppression state and (for withdrawing reasons) every granted channel.
  update public.contacts set
    suppressed_at      = coalesce(suppressed_at, now()),
    suppression_reason = case when v_new_event then p_reason else suppression_reason end,
    email_consent      = case when v_withdraws and email_consent = 'granted' then 'withdrawn' else email_consent end,
    whatsapp_consent   = case when v_withdraws and whatsapp_consent = 'granted' then 'withdrawn' else whatsapp_consent end,
    phone_consent      = case when v_withdraws and phone_consent = 'granted' then 'withdrawn' else phone_consent end
   where id = p_contact_id;

  if v_new_event then
    insert into public.consent_events
      (tenant_id, contact_id, event_type, suppression_reason, evidence_type, evidence_ref, recorded_by)
    values
      (p_tenant_id, p_contact_id, 'suppressed', p_reason, p_evidence_type, p_evidence_ref, v_uid)
    returning id into v_id;
  else
    select e.id into v_id from public.consent_events e
     where e.tenant_id = p_tenant_id and e.contact_id = p_contact_id and e.event_type = 'suppressed'
     order by e.created_at desc, e.id desc limit 1;
  end if;

  if v_withdraws then
    foreach v_ch in array enum_range(null::public.consent_channel) loop
      if (case v_ch when 'email' then v_contact.email_consent
                    when 'whatsapp' then v_contact.whatsapp_consent
                    else v_contact.phone_consent end) = 'granted' then
        insert into public.consent_events
          (tenant_id, contact_id, event_type, channel, evidence_type, evidence_ref, recorded_by)
        values
          (p_tenant_id, p_contact_id, 'withdrawn', v_ch, p_evidence_type, p_evidence_ref, v_uid);
      end if;
    end loop;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- R2: record_consent and lift_suppression get the same explicit NULL guards.
-- (lift_suppression never touches consent columns, so a lifted suppression cannot revive consent.)
-- ---------------------------------------------------------------------------------------------
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
    raise exception 'unsupported channel' using errcode = '22023';   -- a future enum value must be handled explicitly
  end if;

  insert into public.consent_events
    (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
  values
    (p_tenant_id, p_contact_id, v_event, p_channel, p_basis, p_evidence_type, p_evidence_ref, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

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
  if not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'only an owner or admin can lift a suppression' using errcode = '42501';
  end if;
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
