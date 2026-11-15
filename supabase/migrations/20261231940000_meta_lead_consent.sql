-- Meta Lead Ads consent per lead (owner decision, 15 Nov 2026): the lead form carries a disclaimer with a REQUIRED checkbox ("I agree that <business> may call or WhatsApp me about my enquiry").
-- For every lead the worker stores the evidence (form id, the exact disclaimer text the form showed, the checkbox key and answer, the time) and, when the box is ticked, grants consent for the phone
-- and WhatsApp channels in the consent ledger (basis explicit_consent, evidence web_form, reference meta_form:<form id>-<leadgen id>). No checkbox on the form, or not ticked: nothing is granted and
-- the lead stays "ask first" (the ledger is untouched). Calling limits, quiet hours and the daily limit are NOT touched: they apply as for any granted consent.
create table public.lead_consent_evidence (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  lead_id         uuid not null,
  contact_id      uuid not null,
  source_tag      text not null check (source_tag = 'meta_lead_ads'),
  form_id         text not null check (form_id ~ '^[0-9]{1,30}$'),
  leadgen_id      text not null check (leadgen_id ~ '^[0-9]{1,30}$'),
  disclaimer_text text check (disclaimer_text is null or (char_length(disclaimer_text) between 1 and 800 and app.text_is_clean(disclaimer_text))),
  checkbox_key    text check (checkbox_key is null or checkbox_key ~ '^[A-Za-z0-9_.-]{1,60}$'),
  ticked          boolean,
  recorded_at     timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  unique (tenant_id, source_tag, leadgen_id),
  -- a contact with consent history can never be hard-deleted: erasure is anonymise-in-place (same rule as the ledger)
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id)
);
create index lead_consent_evidence_lead_idx on public.lead_consent_evidence (tenant_id, lead_id, recorded_at desc);
create index lead_consent_evidence_contact_idx on public.lead_consent_evidence (tenant_id, contact_id);
comment on table public.lead_consent_evidence is 'Meta lead form consent evidence, one row per lead (append-only in practice: written once by scheduler_lead_meta_consent). The wording the form showed and the answer; ticked is null when the form has no consent checkbox. No contact detail.';
comment on column public.lead_consent_evidence.form_id is 'SAFE: Meta''s form number, digits only. CLEAN-EXEMPT: pattern CHECK';
comment on column public.lead_consent_evidence.leadgen_id is 'SAFE: Meta''s lead number, digits only. CLEAN-EXEMPT: pattern CHECK';
comment on column public.lead_consent_evidence.disclaimer_text is 'SAFE: the business''s own fixed form wording (title, text, checkbox label), never a person''s answer.';
comment on column public.lead_consent_evidence.checkbox_key is 'SAFE: the form''s checkbox key. CLEAN-EXEMPT: pattern CHECK';
comment on column public.lead_consent_evidence.source_tag is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table public.lead_consent_evidence enable row level security;
alter table public.lead_consent_evidence force row level security;
revoke all on public.lead_consent_evidence from public, anon, authenticated, service_role;
grant select on public.lead_consent_evidence to authenticated;
create policy lead_consent_evidence_select on public.lead_consent_evidence for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create trigger lead_consent_evidence_forbid_tenant_id_change before update on public.lead_consent_evidence for each row execute function app.forbid_tenant_id_change();
create trigger lead_consent_evidence_no_update before update on public.lead_consent_evidence for each row execute function app.append_only();
create trigger lead_consent_evidence_no_delete before delete on public.lead_consent_evidence for each row execute function app.append_only();
create trigger audit_lead_consent_evidence after insert or update or delete on public.lead_consent_evidence for each row execute function app.audit_row_change('lead_consent_evidence', '');

-- the worker's door (the secret address is checked by its hash, as for the arrival itself): up to 20 items of {leadgen_id, form_id, disclaimer, checkbox_key, ticked}
create function public.scheduler_lead_meta_consent(p_token_hash text, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s          public.lead_sources;
  v_item     jsonb;
  v_ext      text;
  v_form     text;
  v_lead     uuid;
  v_contact  public.contacts;
  v_ticked   boolean;
  v_ref      text;
  v_channel  public.consent_channel;
  v_current  public.consent_status;
  v_recorded integer := 0;
  v_granted  integer := 0;
  v_ask      integer := 0;
  v_new      integer;
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    perform app.lead_error('invalid');
  end if;
  select * into s from public.lead_sources x where x.token_hash = p_token_hash and x.status = 'active' and x.kind = 'meta_lead_ads';
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    v_ext := left(btrim(coalesce(v_item ->> 'leadgen_id', '')), 30);
    v_form := left(btrim(coalesce(v_item ->> 'form_id', '')), 30);
    continue when v_ext !~ '^[0-9]{1,30}$' or v_form !~ '^[0-9]{1,30}$';
    select i.lead_id into v_lead from integrations.lead_items i where i.tenant_id = s.tenant_id and i.source_tag = 'meta_lead_ads' and i.external_id = v_ext;
    continue when v_lead is null;
    select k.* into v_contact from public.leads l join public.contacts k on k.tenant_id = l.tenant_id and k.id = l.contact_id where l.tenant_id = s.tenant_id and l.id = v_lead;
    continue when not found;
    v_ticked := case when jsonb_typeof(v_item -> 'ticked') = 'boolean' then (v_item ->> 'ticked')::boolean else null end;
    insert into public.lead_consent_evidence (tenant_id, lead_id, contact_id, source_tag, form_id, leadgen_id, disclaimer_text, checkbox_key, ticked)
    values (s.tenant_id, v_lead, v_contact.id, 'meta_lead_ads', v_form, v_ext, app.lead_clean_text(v_item ->> 'disclaimer', 800),
            case when coalesce(v_item ->> 'checkbox_key', '') ~ '^[A-Za-z0-9_.-]{1,60}$' then v_item ->> 'checkbox_key' else null end, v_ticked)
    on conflict (tenant_id, source_tag, leadgen_id) do nothing;
    get diagnostics v_new = row_count;
    continue when v_new = 0;   -- a replay: nothing is recorded or granted twice
    v_recorded := v_recorded + 1;
    if v_ticked is true and v_contact.suppressed_at is null and v_contact.erased_at is null then
      v_ref := 'meta_form:' || v_form || '-' || v_ext;
      foreach v_channel in array array['phone', 'whatsapp']::public.consent_channel[] loop
        v_current := case v_channel when 'phone' then v_contact.phone_consent else v_contact.whatsapp_consent end;
        continue when v_current = 'granted';
        if v_channel = 'phone' then
          update public.contacts set phone_consent = 'granted' where id = v_contact.id;
        else
          update public.contacts set whatsapp_consent = 'granted' where id = v_contact.id;
        end if;
        insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
        values (s.tenant_id, v_contact.id, 'granted', v_channel, 'explicit_consent', 'web_form', v_ref, null);
      end loop;
      v_granted := v_granted + 1;
    else
      v_ask := v_ask + 1;
    end if;
  end loop;
  return jsonb_build_object('status', 'recorded', 'recorded', v_recorded, 'granted', v_granted, 'ask_first', v_ask);
end;
$$;
revoke all on function public.scheduler_lead_meta_consent(text, jsonb) from public, anon;
grant execute on function public.scheduler_lead_meta_consent(text, jsonb) to authenticated;
