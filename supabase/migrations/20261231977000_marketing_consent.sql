-- Marketing consent, per customer (owner-approved plan docs/plans/textiles-campaigns-marketing.md, slice S1; owner's addition 15 Nov 2026).
--   * `unknown` means NO marketing, always. A customer's service consent (visit and order updates) is a different thing and is never touched here.
--   * Granted by: the customer's own WhatsApp reply to an opt-in question, a separate tick on a form, an import that carries a proof, or the owner recording it (verbal or written).
--     An OWNER-RECORDED grant needs a short "how given" note (free text, clean, 2 to 160 characters, for example "said yes in shop"), WHO recorded it and WHEN; all three are kept on the contact and shown on the customer.
--   * Withdrawn by: STOP (every suppression of a contact withdraws it first), the customer's own link, or the owner.
--   * Every change is audited by the contact's existing audit trigger (who, when, old and new values; the note is stripped from the audit trail like the other personal text).
--   * Erasing a contact clears the note and withdraws the consent (trigger); erasing a workspace clears every note (erasure registry, tenant scope).
-- This slice is the database only. The campaign kind that USES the consent (S2) and the API and screens (S3, S4) follow.

alter table public.contacts
  add column marketing_consent text not null default 'unknown' check (marketing_consent in ('unknown', 'granted', 'withdrawn')),
  add column marketing_consent_at timestamptz,
  add column marketing_consent_via text check (marketing_consent_via in ('whatsapp_reply', 'form_tick', 'owner_recorded', 'import_with_proof', 'stop_reply', 'customer_link', 'erasure')),
  add column marketing_consent_by uuid,
  add column marketing_consent_note text check (marketing_consent_note is null or (char_length(btrim(marketing_consent_note)) between 2 and 160 and app.text_is_clean(marketing_consent_note)));
alter table public.contacts
  add constraint contacts_marketing_consent_consistent check (
    (marketing_consent = 'unknown' and marketing_consent_at is null and marketing_consent_via is null and marketing_consent_by is null and marketing_consent_note is null)
    or (marketing_consent in ('granted', 'withdrawn') and marketing_consent_at is not null and marketing_consent_via is not null)),
  add constraint contacts_marketing_consent_owner_note check (
    not (marketing_consent = 'granted' and marketing_consent_via = 'owner_recorded') or (marketing_consent_note is not null and marketing_consent_by is not null)),
  add constraint contacts_marketing_consent_granted_via check (
    marketing_consent <> 'granted' or marketing_consent_via in ('whatsapp_reply', 'form_tick', 'owner_recorded', 'import_with_proof'));
comment on column public.contacts.marketing_consent is 'SAFE: a closed word (unknown | granted | withdrawn). CLEAN-EXEMPT: closed CHECK list';
comment on column public.contacts.marketing_consent_via is 'SAFE: a closed word (how it was given or withdrawn). CLEAN-EXEMPT: closed CHECK list';
comment on column public.contacts.marketing_consent_at is 'SAFE: when marketing consent was given or withdrawn';
comment on column public.contacts.marketing_consent_by is 'SAFE: the staff member who recorded it (a user id; null when the customer did it themselves)';
comment on column public.contacts.marketing_consent_note is 'PII: the short "how given" note an owner typed when recording marketing consent (for example "said yes in shop"); free text, up to 160 characters';

-- the audit trail never holds the note
drop trigger audit_contacts on public.contacts;
create trigger audit_contacts after insert or update or delete on public.contacts
  for each row execute function app.audit_row_change('contact', 'full_name,email,phone,job_title,marketing_consent_note');

-- workspace erasure clears every note (the contact's own erasure is the trigger below)
insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set) values
  ('contacts', 'marketing_consent_note', 'tenant', 'tombstone', 'erased:1', null);

create function app.contacts_marketing_on_erase() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    new.marketing_consent_note := null;
    if new.marketing_consent <> 'unknown' then
      new.marketing_consent := 'withdrawn';
      new.marketing_consent_via := 'erasure';
      new.marketing_consent_at := now();
      new.marketing_consent_by := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.contacts_marketing_on_erase() from public;
create trigger contacts_marketing_on_erase before update of erased_at on public.contacts
  for each row execute function app.contacts_marketing_on_erase();

-- ------------------------------------------------------------------------------------------------------------------------------
-- the state of one contact, as JSON (what the screens show)
-- ------------------------------------------------------------------------------------------------------------------------------
create function app.marketing_consent_json(c public.contacts) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('state', c.marketing_consent, 'at', c.marketing_consent_at, 'via', c.marketing_consent_via,
                            'by', c.marketing_consent_by, 'note', c.marketing_consent_note)
$$;
revoke all on function app.marketing_consent_json(public.contacts) from public;

create function public.marketing_consent_get(p_tenant_id uuid, p_contact_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.contacts;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_contact_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'your role cannot read marketing consent' using errcode = '42501';
  end if;
  select * into c from public.contacts x where x.id = p_contact_id and x.tenant_id = p_tenant_id;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  return app.marketing_consent_json(c);
end;
$$;
revoke all on function public.marketing_consent_get(uuid, uuid) from public, anon;
grant execute on function public.marketing_consent_get(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------
-- the owner (or staff) records that the customer said yes: a note is required; who and when are kept
-- ------------------------------------------------------------------------------------------------------------------------------
create function public.marketing_consent_set(p_tenant_id uuid, p_contact_id uuid, p_note text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_note text := btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g'));
  c      public.contacts;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_contact_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'your role cannot record marketing consent' using errcode = '42501';
  end if;
  if char_length(v_note) not between 2 and 160 or not app.text_is_clean(v_note) then
    raise exception 'a short note on how the customer agreed is required (2 to 160 characters)' using errcode = '22023';
  end if;
  select * into c from public.contacts x where x.id = p_contact_id and x.tenant_id = p_tenant_id for update;
  if not found or c.erased_at is not null then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  if c.suppressed_at is not null or c.whatsapp_consent = 'withdrawn' then
    raise exception 'this customer asked us to stop' using errcode = '55000';
  end if;
  update public.contacts set marketing_consent = 'granted', marketing_consent_at = now(), marketing_consent_via = 'owner_recorded', marketing_consent_by = v_uid, marketing_consent_note = v_note
   where id = c.id returning * into c;
  return app.marketing_consent_json(c);
end;
$$;
revoke all on function public.marketing_consent_set(uuid, uuid, text) from public, anon;
grant execute on function public.marketing_consent_set(uuid, uuid, text) to authenticated;

-- the owner (or staff) records that the customer no longer wants marketing (a note is optional)
create function public.marketing_consent_withdraw(p_tenant_id uuid, p_contact_id uuid, p_note text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  c      public.contacts;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_contact_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'your role cannot record marketing consent' using errcode = '42501';
  end if;
  if v_note is not null and (char_length(v_note) not between 2 and 160 or not app.text_is_clean(v_note)) then
    raise exception 'the note must be 2 to 160 characters' using errcode = '22023';
  end if;
  select * into c from public.contacts x where x.id = p_contact_id and x.tenant_id = p_tenant_id for update;
  if not found or c.erased_at is not null then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  update public.contacts set marketing_consent = 'withdrawn', marketing_consent_at = now(), marketing_consent_via = 'owner_recorded', marketing_consent_by = v_uid, marketing_consent_note = v_note
   where id = c.id returning * into c;
  return app.marketing_consent_json(c);
end;
$$;
revoke all on function public.marketing_consent_withdraw(uuid, uuid, text) from public, anon;
grant execute on function public.marketing_consent_withdraw(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------
-- the system's own ways (no client can call these): the customer's WhatsApp reply, a form tick, an import with proof; and STOP
-- ------------------------------------------------------------------------------------------------------------------------------
create function app.marketing_consent_grant_system(p_tenant uuid, p_contact uuid, p_via text) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  c public.contacts;
begin
  if p_via is null or p_via not in ('whatsapp_reply', 'form_tick', 'import_with_proof') then
    raise exception 'unknown way of giving consent' using errcode = '22023';
  end if;
  select * into c from public.contacts x where x.id = p_contact and x.tenant_id = p_tenant for update;
  if not found or c.erased_at is not null or c.suppressed_at is not null or c.whatsapp_consent = 'withdrawn' then
    return false;
  end if;
  update public.contacts set marketing_consent = 'granted', marketing_consent_at = now(), marketing_consent_via = p_via, marketing_consent_by = null, marketing_consent_note = null where id = c.id;
  return true;
end;
$$;
revoke all on function app.marketing_consent_grant_system(uuid, uuid, text) from public;

create function app.marketing_consent_withdraw_system(p_tenant uuid, p_contact uuid, p_via text) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_via is null or p_via not in ('stop_reply', 'customer_link') then
    raise exception 'unknown way of withdrawing consent' using errcode = '22023';
  end if;
  update public.contacts set marketing_consent = 'withdrawn', marketing_consent_at = now(), marketing_consent_via = p_via, marketing_consent_by = null, marketing_consent_note = null
   where id = p_contact and tenant_id = p_tenant and marketing_consent = 'granted';
  return found;
end;
$$;
revoke all on function app.marketing_consent_withdraw_system(uuid, uuid, text) from public;

-- every suppression of a contact (STOP, a complaint, a legal hold) withdraws marketing first
do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_suppress_contact(uuid, uuid, public.suppression_reason, text, uuid)'::regprocedure);
  v_old text := $q$  foreach v_ch in array enum_range(null::public.consent_channel) loop$q$;
  v_new text := $q$  perform app.marketing_consent_withdraw_system(p_tenant, c.id, 'stop_reply');
  foreach v_ch in array enum_range(null::public.consent_channel) loop$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'wa_suppress_contact has changed: the marketing-consent patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
