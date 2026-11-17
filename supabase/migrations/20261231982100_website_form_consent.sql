-- The Website form carries consent per lead, like Meta's lead form (owner, 17 Nov 2026). The hosted form and the pasted snippet have a REQUIRED checkbox "I agree that {business} may call or WhatsApp me about my enquiry"; a
-- submission that ticked it is stored WITH its consent in the same transaction (phone and WhatsApp consent granted, with the wording the form showed, the time, and the checkbox), exactly as a Meta lead form's. A submission with no
-- tick (an old embed, a form tool that does not send it) stays ask-first: no automatic WhatsApp or call. A form tool may send the same field (`consent`: yes/true/on); the wording stored is always the server's, never the sender's.
--   * public.lead_consent_evidence takes the source tags `website_form` and `webhook` besides `meta_lead_ads` (one per submission: form_id 0, leadgen_id a number the database makes).
--   * app.web_consent_apply(...) stores the evidence and grants phone and WhatsApp consent when ticked (a stopped or erased customer is never re-consented), called from the intake for a live website or webhook row.
--   * public.scheduler_lead_form_info(token hash) tells the worker's API the business name of an active website form (for the wording on the hosted form and the snippet); nothing else.

do $$
declare
  r record;
begin
  for r in select c.conname from pg_constraint c where c.conrelid = 'public.lead_consent_evidence'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%source_tag%' loop
    execute format('alter table public.lead_consent_evidence drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.lead_consent_evidence add constraint lead_consent_evidence_source_tag_check check (source_tag in ('meta_lead_ads', 'website_form', 'webhook'));

create function app.web_consent_apply(p_tenant uuid, p_lead uuid, p_contact uuid, p_tag text, p_item jsonb) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_ticked  boolean := case when jsonb_typeof(p_item -> 'ticked') = 'boolean' then (p_item ->> 'ticked')::boolean else null end;
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
  insert into public.lead_consent_evidence (tenant_id, lead_id, contact_id, source_tag, form_id, leadgen_id, disclaimer_text, checkbox_key, ticked)
  values (p_tenant, p_lead, p_contact, p_tag, '0', v_leadgen, app.lead_clean_text(p_item ->> 'disclaimer', 800),
          case when coalesce(p_item ->> 'checkbox_key', '') ~ '^[A-Za-z0-9_.-]{1,60}$' then p_item ->> 'checkbox_key' else null end, v_ticked);
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
revoke all on function app.web_consent_apply(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- the intake: a live website or webhook row that carries the consent object stores it with the lead, before the "ask first" flag is worked out
do $patch$
declare
  v_def text := pg_get_functiondef('app.lead_intake_core(uuid, uuid, text, uuid, jsonb, boolean)'::regprocedure);
  v_old text := $q$      v_flag_noc := not exists (select 1 from public.contacts k where k.id = v_contact.id and k.whatsapp_consent = 'granted');$q$;
  v_new text := $q$      if p_live and p_tag in ('website_form', 'webhook') and jsonb_typeof(v_row -> 'consent') = 'object' then
        perform app.web_consent_apply(p_tenant, v_lead, v_contact.id, p_tag, v_row -> 'consent');
      end if;
      v_flag_noc := not exists (select 1 from public.contacts k where k.id = v_contact.id and k.whatsapp_consent = 'granted');$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'lead_intake_core has changed: the website consent patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- the business name for the wording of the hosted form and the snippet
create function public.scheduler_lead_form_info(p_token_hash text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    perform app.lead_error('invalid');
  end if;
  select t.name into v_name from public.lead_sources s join public.tenants t on t.id = s.tenant_id where s.token_hash = p_token_hash and s.kind = 'website_form' and s.status = 'active';
  return case when v_name is null then '{}'::jsonb else jsonb_build_object('business', left(v_name, 100)) end;
end;
$$;
revoke all on function public.scheduler_lead_form_info(text) from public, anon;
grant execute on function public.scheduler_lead_form_info(text) to authenticated;
