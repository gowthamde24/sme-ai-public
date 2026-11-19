-- Consent evidence for a connected tool (owner, 18 Nov 2026): a webhook or form tool that says "consent: true" is believed only when it brings the evidence, the wording the person saw (`consent_text`) and
-- when they agreed (`consent_at`), and the form or page name when it has one. Without them the lead stays ask-first, the same standard as our own form's tick (which stores the wording it showed).
--   * public.lead_consent_evidence gets `consent_given_at` (when the person agreed, as the sender says) and `form_name` (the form or page, as the sender names it).
--   * app.web_consent_apply grants nothing for a tick that has no wording (a backstop behind the API's own check).
alter table public.lead_consent_evidence add column consent_given_at timestamptz, add column form_name text check (form_name is null or (char_length(form_name) between 1 and 80 and app.text_is_clean(form_name)));
comment on column public.lead_consent_evidence.consent_given_at is 'SAFE: a timestamp: when the person agreed, as the connected tool says (a hosted form: the time we received it)';
comment on column public.lead_consent_evidence.form_name is 'SAFE: the form or page the tool says the person ticked on, a short label the business chose.';

create or replace function app.web_consent_apply(p_tenant uuid, p_lead uuid, p_contact uuid, p_tag text, p_item jsonb) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_ticked  boolean := case when jsonb_typeof(p_item -> 'ticked') = 'boolean' then (p_item ->> 'ticked')::boolean else null end;
  v_given   timestamptz;
  v_form    text := nullif(btrim(coalesce(p_item ->> 'form_name', '')), '');
  v_leadgen text := ((('x' || left(md5(gen_random_uuid()::text), 15))::bit(60))::bigint)::text;
  v_ref     text;
  v_channel public.consent_channel;
  v_current public.consent_status;
begin
  if p_tag not in ('website_form', 'webhook') or jsonb_typeof(p_item) <> 'object' then
    return 'skip';
  end if;
  select k.* into v_contact from public.contacts k where k.tenant_id = p_tenant and k.id = p_contact;
  if not found then
    return 'skip';
  end if;
  begin
    v_given := nullif(p_item ->> 'given_at', '')::timestamptz;
  exception when others then
    v_given := null;
  end;
  insert into public.lead_consent_evidence (tenant_id, lead_id, contact_id, source_tag, form_id, leadgen_id, disclaimer_text, checkbox_key, ticked, consent_given_at, form_name)
  values (p_tenant, p_lead, p_contact, p_tag, '0', v_leadgen, app.lead_clean_text(p_item ->> 'disclaimer', 800),
          case when coalesce(p_item ->> 'checkbox_key', '') ~ '^[A-Za-z0-9_.-]{1,60}$' then p_item ->> 'checkbox_key' else null end, v_ticked, v_given,
          case when v_form is not null and char_length(v_form) <= 80 and app.text_is_clean(v_form) then v_form else null end);
  -- the evidence is the wording the person saw: a tick WITHOUT it grants nothing (owner, 18 Nov 2026: a connected tool's "consent: true" is only its own say-so)
  if v_ticked is true and app.lead_clean_text(p_item ->> 'disclaimer', 800) is null then
    return 'ask';
  end if;
  if v_ticked is true and v_contact.suppressed_at is null and v_contact.erased_at is null then
    v_ref := 'web_form:' || left(replace(p_lead::text, '-', ''), 12) || '-' || v_leadgen;
    foreach v_channel in array array['phone', 'whatsapp']::public.consent_channel[] loop
      v_current := case v_channel when 'phone' then v_contact.phone_consent else v_contact.whatsapp_consent end;
      continue when v_current = 'granted';
      if v_channel = 'phone' then
        update public.contacts set phone_consent = 'granted' where id = v_contact.id;
      else
        update public.contacts set whatsapp_consent = 'granted' where id = v_contact.id;
      end if;
      insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
      values (p_tenant, v_contact.id, 'granted', v_channel, 'explicit_consent', 'web_form', v_ref, null);
    end loop;
    return 'granted';
  end if;
  return 'ask';
end;
$$;
