-- Visit templates carry the visit's date and time (owner decision, 16 Nov 2026): visit_reminder and visit_confirmation have a third variable {{3}} = the visit's date and time in India time ("Sat 22 Nov, 11:00 AM").
-- The value is the database's, never typed: for a reminder or a confirmation message it is the visit that message belongs to (store_visits.reminder_message_id / confirmation_message_id); for a template a person picks in a chat
-- it is the customer's next booked or confirmed visit. With no visit there is no value, and a template that needs one is neither offered in a chat nor sent (it is never sent with a blank).
-- The sender also picks visit_reminder for a reminder and visit_confirmation for a confirmation (before, the first template of the purpose was taken, whichever it was).

create function app.wa_visit_label(p_tenant uuid, p_lead uuid, p_message uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select to_char(v.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM')
    from public.store_visits v
   where v.tenant_id = p_tenant and v.lead_id = p_lead
     and (coalesce(p_message in (v.confirmation_message_id, v.reminder_message_id), false) or (v.status in ('booked', 'confirmed') and v.starts_at > app.outbox_now()))
   order by coalesce(p_message in (v.confirmation_message_id, v.reminder_message_id), false) desc, v.starts_at
   limit 1
$$;
revoke all on function app.wa_visit_label(uuid, uuid, uuid) from public, anon, authenticated, service_role;

drop function app.wa_template_render(integrations.wa_templates, uuid, uuid);
create function app.wa_template_render(t integrations.wa_templates, p_tenant uuid, p_contact uuid, p_third text default null) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select replace(replace(replace(t.body, '{{1}}', app.wa_first_name(p_contact, t.language)), '{{2}}', coalesce((select tn.name from public.tenants tn where tn.id = p_tenant), '')), '{{3}}', coalesce(p_third, ''))
$$;
revoke all on function app.wa_template_render(integrations.wa_templates, uuid, uuid, text) from public, anon, authenticated, service_role;

-- the templates a chat may send now: a template that needs a visit's time only when the customer has a visit coming
create or replace function app.conversation_template_rows(p_tenant uuid, p_lead uuid) returns setof integrations.wa_templates
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_lang    text;
  v_visit   text := app.wa_visit_label(p_tenant, p_lead, null);
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
       and (w.body not like '%{{3}}%' or v_visit is not null)
     order by w.name, w.id;
end;
$$;

create or replace function public.conversation_templates(p_tenant_id uuid, p_lead_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_visit   text;
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  select l.contact_id into v_contact from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.outbox_error('reference');
  end if;
  v_visit := app.wa_visit_label(p_tenant_id, p_lead_id, null);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'name', w.name, 'language', w.language, 'purpose', w.purpose, 'preview', app.wa_template_render(w, p_tenant_id, v_contact, v_visit),
      'variables', (case when w.body like '%{{1}}%' then jsonb_build_array(jsonb_build_object('key', 'first_name', 'label', 'Customer first name', 'value', app.wa_first_name(v_contact, w.language), 'editable', false)) else '[]'::jsonb end)
                || (case when w.body like '%{{2}}%' then jsonb_build_array(jsonb_build_object('key', 'business_name', 'label', 'Business name', 'value', (select tn.name from public.tenants tn where tn.id = p_tenant_id), 'editable', false)) else '[]'::jsonb end)
                || (case when w.body like '%{{3}}%' then jsonb_build_array(jsonb_build_object('key', 'visit_time', 'label', 'Visit date and time', 'value', v_visit, 'editable', false)) else '[]'::jsonb end))
      order by w.name, w.id)
      from app.conversation_template_rows(p_tenant_id, p_lead_id) w), '[]'::jsonb);
end;
$$;

create or replace function public.conversation_template_send(p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_template_id uuid) returns jsonb
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
  select w.* into t from app.conversation_template_rows(p_tenant_id, p_lead_id) w where w.id = p_template_id;
  if t.id is null then
    perform app.outbox_error('reference');
  end if;
  return app.outbox_submit_core(
    v_uid, p_message_id, p_tenant_id, p_lead_id, 'whatsapp', app.wa_template_render(t, p_tenant_id, v_contact, app.wa_visit_label(p_tenant_id, p_lead_id, null)), t.language,
    case t.purpose when 'visit' then 'visit' when 'followup' then 'followup' when 'order_status' then 'order_status' else 'info' end,
    'owner');
end;
$$;

-- the sender: the visit's time as the third value, the right visit template for a reminder or a confirmation, and no template at all when it needs a visit's time and has none
do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_new text;
  v_old1 text := $q$and app.wa_template_render(w, m.tenant_id, m.contact_id) = m.body$q$;
  v_new1 text := $q$and app.wa_template_render(w, m.tenant_id, m.contact_id, app.wa_visit_label(m.tenant_id, m.lead_id, m.id)) = m.body$q$;
  v_old2 text := $q$select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = v_purpose and x.language = m.language and x.status = 'approved'
       order by x.created_at, x.id limit 1;$q$;
  v_new2 text := $q$select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = v_purpose and x.language = m.language and x.status = 'approved'
       order by (x.name = case when exists (select 1 from public.store_visits sv where sv.tenant_id = m.tenant_id and sv.reminder_message_id = m.id) then 'visit_reminder'
                               when exists (select 1 from public.store_visits sv where sv.tenant_id = m.tenant_id and sv.confirmation_message_id = m.id) then 'visit_confirmation' end) desc nulls last, x.created_at, x.id limit 1;$q$;
  v_old3 text := $q$(select tn.name from public.tenants tn where tn.id = m.tenant_id))) else '{}'::jsonb end$q$;
  v_new3 text := $q$(select tn.name from public.tenants tn where tn.id = m.tenant_id)) || case when t.body like '%{{3}}%' then jsonb_build_array(app.wa_visit_label(m.tenant_id, m.lead_id, m.id)) else '[]'::jsonb end) else '{}'::jsonb end$q$;
  v_old4 text := $q$  return jsonb_build_object(
    'phone_number_id', a.phone_number_id,$q$;
  v_new4 text := $q$  if t.id is not null and t.body like '%{{3}}%' and app.wa_visit_label(m.tenant_id, m.lead_id, m.id) is null then
    t := null;   -- a template that needs a visit's time is never sent with a blank
  end if;
  return jsonb_build_object(
    'phone_number_id', a.phone_number_id,$q$;
begin
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 or position(v_old3 in v_def) = 0 or position(v_old4 in v_def) = 0 then
    raise exception 'wa_send_context has changed: the visit-time patch no longer fits';
  end if;
  v_new := replace(replace(replace(replace(v_def, v_old1, v_new1), v_old2, v_new2), v_old3, v_new3), v_old4, v_new4);
  execute v_new;
end;
$patch$;
