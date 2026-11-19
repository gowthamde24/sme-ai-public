-- "Continue the chat" (owner, 18 Nov 2026): a utility template that restarts a chat whose 24 hours are over. Its three variables are structured values the DATABASE fills, never typed:
--   {{1}} the customer's first name, {{2}} the business name, {{3}} what the customer asked about (the lead's profile `need`, when it is a short clean label; else the fallback "our products", "మా products" in Telugu).
-- A chat offers it like any approved template of purpose followup (consent, STOP, quiet hours, the daily limit and the word check all apply); it is never offered or sent with a blank {{3}} (the fallback is always there).
-- Nothing is switched on by this migration: the template exists only when a business seeds it as a draft and the OWNER submits it to Meta himself (Chats > Templates).

create function app.wa_continue_label(p_tenant uuid, p_lead uuid, p_language text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select btrim(lp.need) from public.lead_profiles lp where lp.tenant_id = p_tenant and lp.lead_id = p_lead and lp.need is not null and app.offer_label_problem(btrim(lp.need)) is null),
    case when p_language = 'te' then 'మా products' else 'our products' end)
$$;
revoke all on function app.wa_continue_label(uuid, uuid, text) from public, anon, authenticated, service_role;

-- the third value of any template for a lead: what the customer asked about for "Continue the chat", else a visit's date and time
create function app.wa_third_for(t integrations.wa_templates, p_tenant uuid, p_lead uuid, p_message uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when t.name = 'continue_chat' then app.wa_continue_label(p_tenant, p_lead, t.language) else app.wa_visit_label(p_tenant, p_lead, p_message) end
$$;
revoke all on function app.wa_third_for(integrations.wa_templates, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- the sender and the offers read their third value through the same helper
create or replace function app.wa_third_value(t integrations.wa_templates, m public.outbox_messages) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when t.purpose = 'offer'
              then (select c.offer_label from public.campaign_steps s join public.campaigns c on c.tenant_id = s.tenant_id and c.id = s.campaign_id
                     where s.tenant_id = m.tenant_id and s.outbox_message_id = m.id)
              else app.wa_third_for(t, m.tenant_id, m.lead_id, m.id) end
$$;

do $patch$
declare
  v_def text;
  v_new text;
  v_old text;
begin
  -- the sender finds a chat template by the words of an owner message: with the same third value the chat showed
  v_def := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_old := $q$app.wa_template_render(w, m.tenant_id, m.contact_id, app.wa_visit_label(m.tenant_id, m.lead_id, m.id)) = m.body$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'wa_send_context has changed: the continue-chat patch no longer fits';
  end if;
  execute replace(v_def, v_old, $q$app.wa_template_render(w, m.tenant_id, m.contact_id, app.wa_third_for(w, m.tenant_id, m.lead_id, m.id)) = m.body$q$);

  -- the chat offers the template (always: it has its fallback) with its value
  v_def := pg_get_functiondef('app.conversation_template_rows(uuid, uuid)'::regprocedure);
  v_old := $q$(w.body not like '%{{3}}%' or v_visit is not null)$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'conversation_template_rows has changed: the continue-chat patch no longer fits';
  end if;
  execute replace(v_def, v_old, $q$(w.body not like '%{{3}}%' or v_visit is not null or w.name = 'continue_chat')$q$);

  v_def := pg_get_functiondef('public.conversation_templates(uuid, uuid)'::regprocedure);
  v_new := v_def;
  foreach v_old in array array[
    $q$app.wa_template_render(w, p_tenant_id, v_contact, v_visit)$q$,
    $q$jsonb_build_object('key', 'visit_time', 'label', 'Visit date and time', 'value', v_visit, 'editable', false)$q$] loop
    if position(v_old in v_new) = 0 then
      raise exception 'conversation_templates has changed: the continue-chat patch no longer fits';
    end if;
  end loop;
  v_new := replace(v_new, $q$app.wa_template_render(w, p_tenant_id, v_contact, v_visit)$q$, $q$app.wa_template_render(w, p_tenant_id, v_contact, app.wa_third_for(w, p_tenant_id, p_lead_id, null))$q$);
  v_new := replace(v_new, $q$jsonb_build_object('key', 'visit_time', 'label', 'Visit date and time', 'value', v_visit, 'editable', false)$q$,
                   $q$jsonb_build_object('key', case when w.name = 'continue_chat' then 'asked_about' else 'visit_time' end, 'label', case when w.name = 'continue_chat' then 'What the customer asked about' else 'Visit date and time' end, 'value', app.wa_third_for(w, p_tenant_id, p_lead_id, null), 'editable', false)$q$);
  execute v_new;

  v_def := pg_get_functiondef('public.conversation_template_send(uuid, uuid, uuid, uuid)'::regprocedure);
  v_old := $q$app.wa_template_render(t, p_tenant_id, v_contact, app.wa_visit_label(p_tenant_id, p_lead_id, null))$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'conversation_template_send has changed: the continue-chat patch no longer fits';
  end if;
  execute replace(v_def, v_old, $q$app.wa_template_render(t, p_tenant_id, v_contact, app.wa_third_for(t, p_tenant_id, p_lead_id, null))$q$);
end;
$patch$;
