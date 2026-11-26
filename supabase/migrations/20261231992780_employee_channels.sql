-- WhatsApp (and every channel) is OPTIONAL (owner product rule, 26 Nov 2026): a CHANNEL is a responsibility of an AI employee the owner turns on, not a default part of the product.
--   responsibilities `channel_phone` (answers phone calls), `channel_whatsapp` (replies on WhatsApp), `channel_web_chat` (replies to website chat); `follow_up` and the other jobs are as before.
--   the workspace's channels are DERIVED: a channel is on only when at least one employee that is ON has it; `whatsapp_connection` says whether the number is connected.
--   a NEW workspace's default employee answers the phone only; the workspaces that exist today keep what they have (their default employee gets phone and WhatsApp), so nothing changes for them.
--   an employee with `channel_whatsapp` and no active WhatsApp account carries `needs: [{channel: whatsapp, step: connect_whatsapp | activate_whatsapp}]` instead of an error.

create function app.workspace_channels(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'phone', exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant and e.status = 'on' and 'channel_phone' = any (e.responsibilities)),
    'whatsapp', exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant and e.status = 'on' and 'channel_whatsapp' = any (e.responsibilities)),
    'web_chat', exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant and e.status = 'on' and 'channel_web_chat' = any (e.responsibilities)),
    'whatsapp_connection', jsonb_build_object(
      'status', coalesce((select w.status from integrations.whatsapp_accounts w where w.tenant_id = p_tenant), 'none'),
      'connected', coalesce((select w.status = 'active' from integrations.whatsapp_accounts w where w.tenant_id = p_tenant), false),
      'next_step', case coalesce((select w.status from integrations.whatsapp_accounts w where w.tenant_id = p_tenant), 'none') when 'none' then 'connect_whatsapp' when 'active' then null else 'activate_whatsapp' end))
$$;
revoke all on function app.workspace_channels(uuid) from public, anon, authenticated, service_role;

create or replace function app.employee_json(p_tenant uuid, p_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'name', case when e.is_default then coalesce(nullif(btrim(a.assistant_name), ''), e.name) else e.name end,
    'role_code', e.role_code, 'role_title', e.role_title, 'status', e.status, 'is_default', e.is_default,
    'responsibilities', to_jsonb(e.responsibilities), 'extra_instructions', e.extra_instructions,
    'languages', to_jsonb(e.languages), 'auto_switch_language', e.auto_switch_language, 'allow_english_mixing', e.allow_english_mixing,
    'style', e.style, 'speed', e.speed, 'opening_line', e.opening_line, 'autonomy', e.autonomy, 'ask_first', to_jsonb(e.ask_first),
    'hours', e.hours, 'never_say', to_jsonb(e.never_say), 'phone_number_id', e.phone_number_id, 'whatsapp_number_ref', e.whatsapp_number_ref,
    'persona_in', case when e.is_default then 'my_assistant' else 'employee' end,
    'voices', case when e.is_default then coalesce((select jsonb_object_agg(v.language, v.voice_code) from public.voice_choices v where v.tenant_id = e.tenant_id), '{}'::jsonb)
                   else coalesce((select jsonb_object_agg(v.language, v.voice_code) from public.ai_employee_voices v where v.tenant_id = e.tenant_id and v.employee_id = e.id), '{}'::jsonb) end,
    'calls_today', (select count(*) from public.phone_calls c where c.tenant_id = e.tenant_id and c.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
                       and (c.ai_employee_id = e.id or (e.is_default and c.ai_employee_id is null))),
    'channels', jsonb_build_object('phone', 'channel_phone' = any (e.responsibilities), 'whatsapp', 'channel_whatsapp' = any (e.responsibilities), 'web_chat', 'channel_web_chat' = any (e.responsibilities)),
    'needs', case when 'channel_whatsapp' = any (e.responsibilities) and coalesce((select w.status from integrations.whatsapp_accounts w where w.tenant_id = e.tenant_id), 'none') <> 'active'
                  then jsonb_build_array(jsonb_build_object('channel', 'whatsapp', 'step', case coalesce((select w.status from integrations.whatsapp_accounts w where w.tenant_id = e.tenant_id), 'none') when 'none' then 'connect_whatsapp' else 'activate_whatsapp' end))
                  else '[]'::jsonb end,
    'created_at', e.created_at, 'updated_at', e.updated_at)
    from public.ai_employees e left join public.assistant_settings a on a.tenant_id = e.tenant_id and e.is_default
   where e.tenant_id = p_tenant and e.id = p_id
$$;
create or replace function public.employees_list(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.employee_error('deny');
  end if;
  perform app.employees_ensure_default(p_tenant_id);
  return jsonb_build_object('employees', coalesce((select jsonb_agg(app.employee_json(e.tenant_id, e.id) order by e.is_default desc, e.sort_order, e.created_at, e.id)
                                                    from public.ai_employees e where e.tenant_id = p_tenant_id and e.status <> 'archived'), '[]'::jsonb),
                            'limit', app.employee_cap(p_tenant_id), 'channels', app.workspace_channels(p_tenant_id));
end;
$$;
create function public.workspace_channels(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.employee_error('deny');
  end if;
  perform app.employees_ensure_default(p_tenant_id);
  return app.workspace_channels(p_tenant_id);
end;
$$;
revoke all on function public.workspace_channels(uuid) from public, anon;
grant execute on function public.workspace_channels(uuid) to authenticated;

-- the employee that answers a CHANNEL (the scheduler's account): the default employee when it has the channel and is on, else the first other employee that is on and has it; null: nobody does, and the channel does nothing
create function public.employee_for_channel(p_tenant_id uuid, p_channel text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not app.is_scheduler() or p_tenant_id is null or p_channel is null or p_channel not in ('phone', 'whatsapp', 'web_chat') then
    perform app.employee_error('deny');
  end if;
  select e.id into v_id from public.ai_employees e
   where e.tenant_id = p_tenant_id and e.status = 'on' and ('channel_' || p_channel) = any (e.responsibilities)
   order by e.is_default desc, e.sort_order, e.created_at limit 1;
  if v_id is null then
    return null;
  end if;
  return app.employee_json(p_tenant_id, v_id) - 'calls_today' - 'created_at' - 'updated_at';
end;
$$;
revoke all on function public.employee_for_channel(uuid, text) from public, anon;
grant execute on function public.employee_for_channel(uuid, text) to authenticated;

-- a new workspace's default employee answers the phone only
create or replace function app.employees_ensure_default(p_tenant uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_lang text;
  v_name text;
begin
  select e.id into v_id from public.ai_employees e where e.tenant_id = p_tenant and e.is_default and e.status <> 'archived';
  if found then
    return v_id;
  end if;
  select nullif(btrim(a.assistant_name), ''), a.main_language into v_name, v_lang from public.assistant_settings a where a.tenant_id = p_tenant;
  v_id := gen_random_uuid();
  insert into public.ai_employees (id, tenant_id, name, role_code, status, is_default, languages, ask_first, responsibilities)
  values (v_id, p_tenant, left(coalesce(v_name, 'Assistant'), 24), 'receptionist', 'on', true,
          case when v_lang in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr') then array[v_lang] else array['en'] end,
          '{send_message,make_call,give_discount,promise_date}', array['channel_phone', 'enquiry_reply', 'faq_answers'])
  on conflict do nothing;
  select e.id into v_id from public.ai_employees e where e.tenant_id = p_tenant and e.is_default and e.status <> 'archived';
  return v_id;
end;
$$;

-- the workspaces that exist today keep what they have: their default employee answers the phone and WhatsApp
update public.ai_employees e set responsibilities = e.responsibilities || array(select x from unnest(array['channel_phone', 'channel_whatsapp']) x where not (x = any (e.responsibilities)))
 where e.is_default and e.status <> 'archived';
