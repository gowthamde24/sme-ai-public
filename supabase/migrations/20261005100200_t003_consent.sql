-- T003 / 1b-3: consent ledger, consent functions, can_contact.
--
-- Consent and suppression are first-class, auditable records (docs/architecture.md):
--   * contacts.*_consent / suppressed_at / suppression_reason hold the CURRENT state. No client
--     grant covers them (migration 2). They change only through the three SECURITY DEFINER
--     functions below, which check the caller's role, check the contact belongs to the stated
--     tenant, update the state and append a ledger row in one transaction.
--   * consent_events is the append-only history. It contains no personal data: ids, enums, and an
--     OPAQUE evidence reference. There is no free-text evidence column on purpose: free text
--     would defeat a PII-free ledger.
--   * app.can_contact() is the single read-only gate future outreach code must call. Nothing in
--     this repository sends anything.
--
-- Not legal advice: the consent model has NOT had India-qualified review (pre-pilot checklist).

create type public.consent_channel as enum ('email', 'whatsapp', 'phone');
create type public.consent_event_type as enum ('granted', 'withdrawn', 'suppressed', 'suppression_lifted');
create type public.consent_basis as enum ('explicit_consent', 'contractual', 'legitimate_use', 'other');
create type public.evidence_type as enum ('web_form', 'email_reply', 'verbal', 'written', 'imported', 'other');

-- Generic append-only guard (same behaviour as audit_events, reusable for later ledgers).
create function app.append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function app.append_only() from public;

create table public.consent_events (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  contact_id         uuid not null,
  event_type         public.consent_event_type not null,
  channel            public.consent_channel,
  basis              public.consent_basis,
  evidence_type      public.evidence_type,
  -- Short OPAQUE reference to evidence kept elsewhere (a form submission id, a file key, a ticket
  -- number). It must not contain personal data; the character set below rules out spaces, '@' and
  -- most of what a name or an address would need.
  evidence_ref       text check (char_length(evidence_ref) <= 120 and evidence_ref ~ '^[A-Za-z0-9._:/#-]+$'),
  suppression_reason public.suppression_reason,
  recorded_by        uuid,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  -- A contact with consent history can never be hard-deleted: erasure is anonymise-in-place.
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  check ((evidence_type is null) = (evidence_ref is null)),
  check (event_type not in ('granted', 'withdrawn') or channel is not null),
  check (event_type not in ('suppressed', 'suppression_lifted') or channel is null),
  check (event_type <> 'granted' or (basis is not null and evidence_ref is not null)),
  check (event_type <> 'suppressed' or suppression_reason is not null),
  check (event_type <> 'suppression_lifted' or evidence_ref is not null)
);
comment on column public.consent_events.evidence_ref is
  'PII: opaque reference only, never personal data (kept off the audit trail by name; the ledger itself is the record)';

create index consent_events_tenant_created_idx on public.consent_events (tenant_id, created_at desc, id);
create index consent_events_contact_idx        on public.consent_events (tenant_id, contact_id, created_at desc);

create trigger consent_events_forbid_tenant_id_change
  before update on public.consent_events
  for each row execute function app.forbid_tenant_id_change();
create trigger consent_events_no_update before update on public.consent_events
  for each row execute function app.append_only();
create trigger consent_events_no_delete before delete on public.consent_events
  for each row execute function app.append_only();
create trigger consent_events_no_truncate before truncate on public.consent_events
  for each statement execute function app.append_only();

create trigger audit_consent_events after insert or update or delete on public.consent_events
  for each row execute function app.audit_row_change('consent_event', 'evidence_ref');

alter table public.consent_events enable row level security;
alter table public.consent_events force row level security;
revoke all on public.consent_events from public, anon, authenticated;
grant select on public.consent_events to authenticated;
create policy consent_events_select on public.consent_events
  for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
-- No INSERT / UPDATE / DELETE policy and no such grant: the functions below are the only writers.

-- ---------------------------------------------------------------------------------------------
-- Functions (SECURITY DEFINER, empty search_path). Shared preamble for each:
--   1. authenticated caller; 2. caller holds an allowed role IN THE STATED TENANT (one-row helper);
--   3. the contact exists in that tenant (otherwise 'not found', whether it is absent or foreign).
-- ---------------------------------------------------------------------------------------------

-- Sales+ : record that a contact granted or withdrew consent for a channel.
-- Granting requires a basis AND evidence (type + opaque reference). Idempotent: repeating the
-- current state returns the existing ledger row instead of adding a duplicate.
create function public.record_consent(
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
                 else v_contact.phone_consent
               end;
  v_event := p_status::text::public.consent_event_type;

  if v_current = p_status then
    -- Retry / repeat: nothing to change. Hand back the latest matching ledger row.
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
  else
    update public.contacts set phone_consent = p_status where id = p_contact_id;
  end if;

  insert into public.consent_events
    (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
  values
    (p_tenant_id, p_contact_id, v_event, p_channel, p_basis, p_evidence_type, p_evidence_ref, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- Sales+ : mark a contact do-not-contact (any channel). Idempotent.
create function public.suppress_contact(
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
  v_uid     uuid := auth.uid();
  v_contact public.contacts;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'your role cannot suppress contacts' using errcode = '42501';
  end if;

  select * into v_contact from public.contacts
   where id = p_contact_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_contact.suppressed_at is not null then
    select e.id into v_id from public.consent_events e
     where e.tenant_id = p_tenant_id and e.contact_id = p_contact_id and e.event_type = 'suppressed'
     order by e.created_at desc, e.id desc limit 1;
    return v_id;
  end if;

  update public.contacts set suppressed_at = now(), suppression_reason = p_reason
   where id = p_contact_id;

  insert into public.consent_events
    (tenant_id, contact_id, event_type, suppression_reason, evidence_type, evidence_ref, recorded_by)
  values
    (p_tenant_id, p_contact_id, 'suppressed', p_reason, p_evidence_type, p_evidence_ref, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- Admin+ ONLY : lift a suppression. Evidence is mandatory. A no-op (returns NULL) if the contact
-- is not suppressed.
create function public.lift_suppression(
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

-- The one gate outreach code must call before contacting anyone: consent granted for the channel,
-- not suppressed, not archived, and the contact actually has that kind of address. SECURITY
-- INVOKER on purpose: it reads through RLS, so a caller can only ask about contacts of their own
-- tenants (anything else answers false), and it needs no elevated privilege.
create function app.can_contact(p_contact_id uuid, p_channel public.consent_channel) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select case p_channel
              when 'email' then c.email_consent = 'granted' and c.email is not null
              when 'whatsapp' then c.whatsapp_consent = 'granted' and c.phone is not null
              else c.phone_consent = 'granted' and c.phone is not null
            end
            and c.suppressed_at is null
            and c.archived_at is null
       from public.contacts c
      where c.id = p_contact_id),
    false)
$$;

revoke all on function public.record_consent(uuid, uuid, public.consent_channel, public.consent_status, public.consent_basis, public.evidence_type, text) from public, anon;
revoke all on function public.suppress_contact(uuid, uuid, public.suppression_reason, public.evidence_type, text) from public, anon;
revoke all on function public.lift_suppression(uuid, uuid, public.evidence_type, text) from public, anon;
revoke all on function app.can_contact(uuid, public.consent_channel) from public, anon;
grant execute on function public.record_consent(uuid, uuid, public.consent_channel, public.consent_status, public.consent_basis, public.evidence_type, text) to authenticated;
grant execute on function public.suppress_contact(uuid, uuid, public.suppression_reason, public.evidence_type, text) to authenticated;
grant execute on function public.lift_suppression(uuid, uuid, public.evidence_type, text) to authenticated;
grant execute on function app.can_contact(uuid, public.consent_channel) to authenticated;
