-- Job OR (owner, 30 Oct 2026): a WhatsApp lead's profile ("what they want") is read from what the customer wrote on WhatsApp.
-- Until now the words a profile is guessed from came only from `lead_arrivals` (forms, mails, imports). A WhatsApp customer's messages are `enquiries` (channel whatsapp), never arrivals, so a lead like
-- "paver blocks for 2000 sq ft" got an EMPTY profile that was then stored as "guessed". Now:
--   * app.lead_words(tenant, lead): the first arrival's message, else the first five usable WhatsApp messages of the lead (never a "[image]" placeholder). An enquiry body can hold no phone number or
--     e-mail address (its CHECK), so the words are as clean as an arrival message: the rules and the AI normaliser read them exactly as they read any other source.
--   * the Lead Desk shape (`profile.original_text`) and the list of leads whose profile is not guessed yet use it.
--   * a new WhatsApp message re-opens a rules-only guess (never an AI one, never what the owner fixed) so the next read of the lead guesses again with the new words.
--   * the empty guesses already stored for WhatsApp leads are re-opened once.

create function app.lead_words(p_tenant uuid, p_lead uuid) returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select a.message from public.lead_arrivals a where a.tenant_id = p_tenant and a.lead_id = p_lead and a.kind = 'first' and a.message is not null order by a.received_at, a.id limit 1),
    (select nullif(left(string_agg(t.body, E'\n' order by t.received_at, t.id), 1000), '')
       from (select e.body, e.received_at, e.id from public.enquiries e
              where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.body !~ '^\[[^\]]{1,40}\]$'
              order by e.received_at, e.id limit 5) t))
$$;
revoke all on function app.lead_words(uuid, uuid) from public;
comment on function app.lead_words(uuid, uuid) is 'Job OR: the words a lead''s profile is guessed from: the first arrival''s message, else the first WhatsApp messages. PII (what a person wrote).';

create or replace function app.lead_desk_json(l public.leads, p public.lead_profiles, c public.contacts, v_uid uuid, v_full boolean) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'created_by', l.created_by, 'created_via', l.created_via, 'created_at', l.created_at, 'updated_at', l.updated_at, 'archived_at', l.archived_at,
    'company_id', l.company_id, 'contact_id', l.contact_id, 'owner_user_id', l.owner_user_id, 'status', l.status, 'source', l.source, 'disqualified_reason', l.disqualified_reason,
    'is_new', not (v_uid = any (coalesce(p.opened_by, '{}'::uuid[]))),
    'needs_profile', p.normalised_at is null,
    'profile', jsonb_build_object(
      'name', c.full_name, 'phone_e164', c.phone, 'email', c.email,
      'city', p.city, 'area', p.area, 'need', p.need, 'quantity', p.quantity, 'budget', p.budget, 'timeline', p.timeline, 'urgency', p.urgency, 'language', p.language,
      'source', l.source, 'campaign', p.campaign,
      'original_text', case when v_full then app.lead_words(l.tenant_id, l.id) end,
      'confidence', coalesce(p.confidence, '{}'::jsonb),
      'duplicate_of', case when c.phone is not null and app.phone_norm(c.phone) is not null then
          (select l2.id from public.leads l2 join public.contacts c2 on c2.tenant_id = l2.tenant_id and c2.id = l2.contact_id
            where l2.tenant_id = l.tenant_id and l2.id <> l.id and l2.archived_at is null and app.phone_norm(c2.phone) = app.phone_norm(c.phone)
              and (l2.created_at, l2.id) < (l.created_at, l.id) order by l2.created_at, l2.id limit 1) end,
      'merged_count', case when v_full then (select count(*) from public.lead_arrivals a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.kind = 'repeat') else 0 end,
      'junk', case when p.junk_reason is null then to_jsonb(false) else jsonb_build_object('reason', p.junk_reason) end,
      'fixed_by_you', to_jsonb(coalesce(p.fixed, '{}'::text[]))))
$$;

create or replace function public.lead_profile_unseeded(p_tenant_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('lead_id', t.id, 'source', t.source, 'text', t.text, 'has_phone', t.has_phone, 'has_email', t.has_email) order by t.created_at desc, t.id desc)
                     from (select l.id, l.source, l.created_at,
                                  app.lead_words(l.tenant_id, l.id) as text,
                                  c.phone is not null as has_phone, c.email is not null as has_email
                             from public.leads l
                             left join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
                            where l.tenant_id = p_tenant_id and l.archived_at is null
                              and not exists (select 1 from public.lead_profiles p where p.tenant_id = l.tenant_id and p.lead_id = l.id and p.normalised_at is not null)
                            order by l.created_at desc, l.id desc
                            limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end;
$$;

revoke all on function app.lead_desk_json(public.leads, public.lead_profiles, public.contacts, uuid, boolean) from public;
revoke all on function public.lead_profile_unseeded(uuid, integer) from public, anon;
grant execute on function public.lead_profile_unseeded(uuid, integer) to authenticated;

-- a new WhatsApp message gives the rules new words: re-open a rules-only guess (the next read of the lead makes it again; an AI guess and the owner's fixed fields are left alone)
create function app.enquiry_reopens_guess() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lead_profiles p set normalised_at = null, updated_at = now()
   where p.tenant_id = new.tenant_id and p.lead_id = new.lead_id and p.normalised_by = 'rules' and p.normalised_at is not null;
  return new;
end;
$$;
revoke all on function app.enquiry_reopens_guess() from public;
create trigger enquiries_reopen_guess after insert on public.enquiries for each row when (new.channel = 'whatsapp') execute function app.enquiry_reopens_guess();

-- once: the empty guesses already stored for WhatsApp leads
update public.lead_profiles p set normalised_at = null, updated_at = now()
 where p.normalised_by = 'rules' and p.normalised_at is not null
   and exists (select 1 from public.leads l where l.tenant_id = p.tenant_id and l.id = p.lead_id and l.source = 'whatsapp')
   and app.lead_words(p.tenant_id, p.lead_id) is not null;

-- WhatsApp: a message with a phone number or an e-mail address in it is received (the details are taken out of the words, see above); until now the insert of its enquiry failed the whole call.
create or replace function public.wa_ingest_inbound(
  p_phone_number_id text, p_wamid text, p_from text, p_profile_name text, p_kind text, p_text text, p_sent_at timestamptz, p_phone_hmac text, p_hmac_version integer, p_optout boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  a         integrations.whatsapp_accounts;
  v_phone   text;
  v_norm    text;
  c         public.contacts;
  v_lead    uuid;
  v_enq     uuid := gen_random_uuid();
  v_new     boolean := false;
  v_body    text;
  v_name    text;
  v_ref     text;
  v_flagged boolean := false;
  v_has_key boolean;
  v_at      timestamptz;
  v_co      uuid := gen_random_uuid();
begin
  if not app.is_channel_agent() then
    perform app.wa_error('deny');
  end if;
  if p_wamid is null or char_length(p_wamid) not between 1 and 200 or p_from is null or p_from !~ '^[0-9]{6,15}$' or p_kind is null or p_kind !~ '^[a-z_]{2,30}$'
     or p_optout is null or p_phone_hmac is null or not app.is_hex64(p_phone_hmac) or p_hmac_version is null or p_hmac_version not between 1 and 32
     or char_length(coalesce(p_text, '')) > 4096 or char_length(coalesce(p_profile_name, '')) > 200 then
    perform app.wa_error('invalid');
  end if;
  select * into a from integrations.whatsapp_accounts x where x.phone_number_id = coalesce(p_phone_number_id, '') and x.status = 'active';
  if not found then
    return jsonb_build_object('outcome', 'unknown_account');
  end if;
  if exists (select 1 from integrations.wa_events e where e.tenant_id = a.tenant_id and e.kind = 'inbound' and e.external_id = p_wamid) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  v_phone := case when p_from ~ '^91[6-9][0-9]{9}$' then '+' || p_from else '+' || p_from end;
  v_norm := app.phone_norm(v_phone);
  v_ref := 'whatsapp:in#' || substr(encode(sha256(convert_to(p_wamid, 'UTF8')), 'hex'), 1, 24);
  v_at := least(coalesce(p_sent_at, app.outbox_now()), app.outbox_now());
  v_body := case when p_text is not null and btrim(p_text) <> '' and app.text_is_clean(p_text) then btrim(p_text)
                 when p_kind = 'text' then '[message not shown]'
                 else '[' || replace(p_kind, '_', ' ') || ']' end;
  -- an enquiry body can hold no phone number or e-mail address (its CHECK; the number is the contact's own). A customer who writes "call me on 98765 43210" used to make the whole insert fail and the message was lost:
  -- the contact details are taken out of the words and the rest is kept; if anything of them is left, the message is stored without its text.
  if app.text_has_contact(v_body) then
    v_body := btrim(regexp_replace(regexp_replace(v_body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', ' ', 'g'), '\+?[0-9][0-9 ()./-]{5,}[0-9]', ' ', 'g'));
    v_body := regexp_replace(v_body, '\s{2,}', ' ', 'g');
    if v_body = '' or app.text_has_contact(v_body) then
      v_body := '[message not shown]';
    end if;
  end if;

  begin
    select * into c from public.contacts x
     where x.tenant_id = a.tenant_id and x.erased_at is null and x.archived_at is null and x.phone is not null and v_norm is not null and app.phone_norm(x.phone) = v_norm
     order by x.created_at, x.id limit 1;
    if not found then
      v_new := true;
      v_name := nullif(btrim(coalesce(p_profile_name, '')), '');
      if v_name is null or not app.text_is_clean(v_name) then
        v_name := 'WhatsApp ' || right(v_phone, 4);
      end if;
      -- a lead with a contact needs a company: a generic one, named after nothing personal (the profile name belongs to the CONTACT, which an erasure removes; a company is never touched by it)
      insert into public.companies (id, tenant_id, name, created_via) values (v_co, a.tenant_id, 'WhatsApp customer ' || substr(replace(v_co::text, '-', ''), 1, 6), 'agent');
      insert into public.contacts (id, tenant_id, company_id, full_name, phone, created_via)
      values (gen_random_uuid(), a.tenant_id, v_co, left(v_name, 200), v_phone, 'agent') returning * into c;
      -- on the list already (a number that asked to stop, or was erased)? it is created flagged, before anything can be sent
      if app.key_active(a.tenant_id, 'phone', p_phone_hmac) then
        perform app.wa_suppress_contact(a.tenant_id, c.id, app.key_reason(a.tenant_id, 'phone', p_phone_hmac)::public.suppression_reason, v_ref, v_uid);
        v_flagged := true;
        select * into c from public.contacts x where x.id = c.id;   -- the suppression changed the row: the consent rule below must see it
      end if;
      perform app.contact_keys_record(c.id, jsonb_build_object('version', p_hmac_version, 'phone', p_phone_hmac), '{}'::jsonb, v_uid, true);
    else
      select exists (select 1 from suppression.contact_keys k where k.tenant_id = c.tenant_id and k.contact_id = c.id and k.phone_hmac is not null) into v_has_key;
      if not v_has_key then
        perform app.contact_keys_record(c.id, jsonb_build_object('version', p_hmac_version, 'phone', p_phone_hmac), '{}'::jsonb, v_uid, false);
      end if;
      v_flagged := c.suppressed_at is not null;
    end if;

    -- the lead: the contact's newest live one, or a new one
    select l.id into v_lead from public.leads l where l.tenant_id = a.tenant_id and l.contact_id = c.id and l.archived_at is null order by l.created_at desc, l.id desc limit 1;
    if v_lead is null then
      if c.company_id is null then
        -- an older phone-only contact: it gets a generic company so that it can have a lead
        insert into public.companies (id, tenant_id, name, created_via) values (v_co, a.tenant_id, 'WhatsApp customer ' || substr(replace(v_co::text, '-', ''), 1, 6), 'agent');
        update public.contacts set company_id = v_co where id = c.id returning * into c;
      end if;
      v_lead := gen_random_uuid();
      insert into public.leads (id, tenant_id, company_id, contact_id, source, created_via) values (v_lead, a.tenant_id, c.company_id, c.id, 'whatsapp', 'agent');
    end if;

    -- the customer wrote to us: that is their opt-in for WhatsApp (never over a suppression)
    if c.suppressed_at is null and c.whatsapp_consent <> 'granted' then
      update public.contacts set whatsapp_consent = 'granted' where id = c.id;
      insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
      values (a.tenant_id, c.id, 'granted', 'whatsapp', 'other', 'other', v_ref, v_uid);
    end if;

    insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, created_via) values (v_enq, a.tenant_id, v_lead, 'whatsapp', v_at, left(v_body, 4096), 'agent');

    if p_optout then
      perform app.wa_suppress_contact(a.tenant_id, c.id, 'opted_out', v_ref, v_uid);
      v_flagged := true;
    end if;
  exception when sqlstate 'SM401' then
    return jsonb_build_object('outcome', 'gate_closed');
  end;

  insert into integrations.wa_events (tenant_id, kind, external_id) values (a.tenant_id, 'inbound', p_wamid);
  perform app.write_audit_event(a.tenant_id, 'whatsapp.inbound', 'enquiry', v_enq, null,
    jsonb_build_object('new_contact', v_new, 'optout', p_optout, 'kind', p_kind, 'flagged', v_flagged));
  return jsonb_build_object('outcome', 'stored', 'tenant_id', a.tenant_id, 'contact_id', c.id, 'lead_id', v_lead, 'enquiry_id', v_enq, 'new_contact', v_new, 'optout', p_optout, 'flagged', v_flagged);
end;
$$;
revoke all on function public.wa_ingest_inbound(text, text, text, text, text, text, timestamptz, text, integer, boolean) from public, anon;
grant execute on function public.wa_ingest_inbound(text, text, text, text, text, text, timestamptz, text, integer, boolean) to authenticated;
