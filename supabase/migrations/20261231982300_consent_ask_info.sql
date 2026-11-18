-- "Ask for consent" in one tap (planner, 18 Nov 2026): what the API needs to DRAFT the ask for one lead's contact. Read only: it writes nothing and sends nothing; the owner's tap on the preview sends it
-- through the outbox like any owner message.
--   returns {lead_id, contact_id, customer, whatsapp_consent, stopped, has_number, language, window_open, template_id}
--   template_id = the workspace's APPROVED template named consent_ask in the customer's language (null: none yet, so a customer whose 24-hour window is closed cannot be asked)
create function public.consent_ask_info(p_tenant_id uuid, p_lead_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead  public.leads;
  c       public.contacts;
  v_lang  text;
  v_tpl   uuid;
  v_now   timestamptz := app.outbox_now();
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  select * into v_lead from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.lead_error('reference');
  end if;
  select * into c from public.contacts k where k.tenant_id = p_tenant_id and k.id = v_lead.contact_id and k.erased_at is null;
  if not found then
    perform app.lead_error('reference');
  end if;
  v_lang := app.outreach_lang(p_tenant_id, c.id, 'auto');
  select w.id into v_tpl from integrations.wa_templates w where w.tenant_id = p_tenant_id and w.name = 'consent_ask' and w.language = v_lang and w.status = 'approved' order by w.created_at, w.id limit 1;
  return jsonb_build_object(
    'lead_id', v_lead.id, 'contact_id', c.id, 'customer', c.full_name, 'whatsapp_consent', c.whatsapp_consent,
    'stopped', (c.suppressed_at is not null or c.whatsapp_consent = 'withdrawn'),
    'has_number', (c.phone is not null and btrim(c.phone) <> ''),
    'language', v_lang,
    'window_open', coalesce(app.wa_last_inbound(p_tenant_id, p_lead_id, v_now) > v_now - interval '24 hours', false),
    'template_id', v_tpl);
end;
$$;
revoke all on function public.consent_ask_info(uuid, uuid) from public, anon;
grant execute on function public.consent_ask_info(uuid, uuid) to authenticated;
comment on function public.consent_ask_info(uuid, uuid) is 'Ask for consent: what the draft needs for one lead (Owner, Admin). Reads only.';
