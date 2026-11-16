-- Chats, closed 24-hour window (owner, 16 Nov 2026, the Kavitha Gowda chat): when the customer's window is closed a person can only send an APPROVED template. The chat offers the approved templates of the
-- customer's language with the words already filled in for this customer, and sends the one picked through the outbox (consent, STOP, quiet hours, the daily limit and the word check all apply).
--   public.conversation_templates(tenant, lead)                       Owner, Admin, Sales: [{id, name, language, purpose, preview, variables:[{key, label, value, editable:false}]}]
--   public.conversation_template_send(message, tenant, lead, template) Owner, Admin, Sales: submits the template's words as an owner message (the outbox's own answer)
-- A variable is never typed by the person (owner rule, 15 Nov): the first name and the business name are filled by the database, exactly as at send time.
-- Marketing-category templates are offered only to a customer who gave marketing consent; offers and campaign reminders are sent by campaigns, never from a chat.
-- The message that goes out IS the template's rendered words: when the outbox sends it, wa_send_context finds the template by those words (an owner message only), so an edited message is no longer a template.

create function app.wa_template_render(t integrations.wa_templates, p_tenant uuid, p_contact uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select replace(replace(t.body, '{{1}}', app.wa_first_name(p_contact, t.language)), '{{2}}', coalesce((select tn.name from public.tenants tn where tn.id = p_tenant), ''))
$$;
revoke all on function app.wa_template_render(integrations.wa_templates, uuid, uuid) from public, anon, authenticated, service_role;

-- the approved templates this chat may send now (internal: the list and the send use the same rule)
create function app.conversation_template_rows(p_tenant uuid, p_lead uuid) returns setof integrations.wa_templates
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_lang    text;
begin
  select c.* into v_contact from public.leads l join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
   where l.tenant_id = p_tenant and l.id = p_lead and l.archived_at is null and c.erased_at is null;
  if not found then
    return;
  end if;
  v_lang := coalesce((select lp.language from public.lead_profiles lp where lp.tenant_id = p_tenant and lp.lead_id = p_lead), app.outreach_lang(p_tenant, v_contact.id, 'auto'));
  return query
    select w.* from integrations.wa_templates w
     where w.tenant_id = p_tenant and w.status = 'approved' and w.language = v_lang and w.purpose in ('visit', 'followup', 'order_status', 'info', 'lead')
       and (w.category <> 'marketing' or v_contact.marketing_consent = 'granted')
     order by w.name, w.id;
end;
$$;
revoke all on function app.conversation_template_rows(uuid, uuid) from public, anon, authenticated, service_role;

create function public.conversation_templates(p_tenant_id uuid, p_lead_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  select l.contact_id into v_contact from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.outbox_error('reference');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'name', w.name, 'language', w.language, 'purpose', w.purpose, 'preview', app.wa_template_render(w, p_tenant_id, v_contact),
      'variables', (case when w.body like '%{{1}}%' then jsonb_build_array(jsonb_build_object('key', 'first_name', 'label', 'Customer first name', 'value', app.wa_first_name(v_contact, w.language), 'editable', false)) else '[]'::jsonb end)
                || (case when w.body like '%{{2}}%' then jsonb_build_array(jsonb_build_object('key', 'business_name', 'label', 'Business name', 'value', (select tn.name from public.tenants tn where tn.id = p_tenant_id), 'editable', false)) else '[]'::jsonb end))
      order by w.name, w.id)
      from app.conversation_template_rows(p_tenant_id, p_lead_id) w), '[]'::jsonb);
end;
$$;
revoke all on function public.conversation_templates(uuid, uuid) from public, anon;
grant execute on function public.conversation_templates(uuid, uuid) to authenticated;

create function public.conversation_template_send(p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_template_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_contact uuid;
  t         integrations.wa_templates;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or p_lead_id is null or p_template_id is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  select l.contact_id into v_contact from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.outbox_error('reference');
  end if;
  -- only a template this chat is offered (approved, the customer's language, marketing only with marketing consent)
  select w.* into t from app.conversation_template_rows(p_tenant_id, p_lead_id) w where w.id = p_template_id;
  if t.id is null then
    perform app.outbox_error('reference');
  end if;
  return app.outbox_submit_core(
    v_uid, p_message_id, p_tenant_id, p_lead_id, 'whatsapp', app.wa_template_render(t, p_tenant_id, v_contact), t.language,
    case t.purpose when 'visit' then 'visit' when 'followup' then 'followup' when 'order_status' then 'order_status' else 'info' end,
    'owner');
end;
$$;
revoke all on function public.conversation_template_send(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.conversation_template_send(uuid, uuid, uuid, uuid) to authenticated;

-- the sender finds the picked template by the words of an OWNER message (before the purpose rule picks the first template of a kind)
do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_old text := $q$  if m.category = 'campaign_reminder' then
    select w.* into t from public.campaign_steps s$q$;
  v_new text := $q$  if m.source = 'owner' and m.category <> 'reply_to_inbound' then
    -- a template a person picked in the chat: its rendered words ARE the message (an edited message is no longer a template)
    select w.* into t from integrations.wa_templates w
     where w.tenant_id = m.tenant_id and w.status = 'approved' and w.language = m.language and w.purpose in ('visit', 'followup', 'order_status', 'info', 'lead')
       and app.wa_template_render(w, m.tenant_id, m.contact_id) = m.body
     order by w.created_at, w.id limit 1;
  end if;
  if t.id is not null then
    null;
  elsif m.category = 'campaign_reminder' then
    select w.* into t from public.campaign_steps s$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'wa_send_context has changed: the picked-template patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
