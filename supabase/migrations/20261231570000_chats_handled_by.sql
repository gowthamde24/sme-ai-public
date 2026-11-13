-- CHATS (13 Nov 2026, for the Chats page): who has each WhatsApp conversation (`handled_by`: needs_you | assistant | done) and a per-chat switch for the assistant (`assistant_enabled`).
--   * the switch lives with the conversation's read marker (integrations.wa_conversation_state); off = the assistant does not answer this customer's messages on its own (the auto-reply worker skips the chat
--     and a held submission is refused), a person answers
--   * `done` = a person marked the chat done and nothing newer has happened; `needs_you` = a reply waits for approval, or the switch is off and the customer wrote last; otherwise `assistant`
--   * who may: Owner, Admin and Sales (as for reading the inbox); every switch change is in the audit log

alter table integrations.wa_conversation_state add column assistant_enabled boolean not null default true;
alter table integrations.wa_conversation_state add column done_at timestamptz;
comment on column integrations.wa_conversation_state.assistant_enabled is 'SAFE: whether the assistant answers this chat on its own. CLEAN-EXEMPT: boolean';
comment on column integrations.wa_conversation_state.done_at is 'SAFE: when a person marked the chat done. CLEAN-EXEMPT: timestamp';

create function public.conversation_set_assistant(p_tenant_id uuid, p_lead_id uuid, p_enabled boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or p_enabled is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id) then
    perform app.wa_error('reference');
  end if;
  insert into integrations.wa_conversation_state as s (tenant_id, lead_id, last_read_at, assistant_enabled) values (p_tenant_id, p_lead_id, '-infinity'::timestamptz, p_enabled)
  on conflict (tenant_id, lead_id) do update set assistant_enabled = excluded.assistant_enabled;
  perform app.write_audit_event(p_tenant_id, case when p_enabled then 'chat.assistant_on' else 'chat.assistant_off' end, 'lead', p_lead_id, null, jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('lead_id', p_lead_id, 'assistant_enabled', p_enabled);
end;
$$;
revoke all on function public.conversation_set_assistant(uuid, uuid, boolean) from public, anon;
grant execute on function public.conversation_set_assistant(uuid, uuid, boolean) to authenticated;

create function public.conversation_set_done(p_tenant_id uuid, p_lead_id uuid, p_done boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or p_done is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id) then
    perform app.wa_error('reference');
  end if;
  insert into integrations.wa_conversation_state as s (tenant_id, lead_id, last_read_at, done_at) values (p_tenant_id, p_lead_id, '-infinity'::timestamptz, case when p_done then app.outbox_now() end)
  on conflict (tenant_id, lead_id) do update set done_at = excluded.done_at;
  return jsonb_build_object('lead_id', p_lead_id, 'done', p_done);
end;
$$;
revoke all on function public.conversation_set_done(uuid, uuid, boolean) from public, anon;
grant execute on function public.conversation_set_done(uuid, uuid, boolean) to authenticated;

-- the inbox and the thread carry the two new words; the auto-reply worker leaves a chat whose switch is off
create or replace function public.conversation_list(p_tenant_id uuid, p_limit integer default 50, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.wa_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.last_at desc, x.lead_id) from (
      select z.lead_id, z.last_at,
             jsonb_build_object(
               'lead_id', z.lead_id, 'contact_id', z.contact_id, 'name', z.name, 'company', z.company, 'phone', z.phone, 'last_at', z.last_at, 'last_direction', z.last_dir,
               'preview', left(z.preview, 120), 'last_inbound_at', z.last_in, 'window_open', coalesce(z.last_in > v_now - interval '24 hours', false),
               'window_expires_at', case when z.last_in > v_now - interval '24 hours' then z.last_in + interval '24 hours' end,
               'unread', z.last_in is not null and z.last_in > coalesce(z.read_at, '-infinity'::timestamptz), 'stopped', z.suppressed,
               'assistant_enabled', z.assistant_enabled,
               'handled_by', case
                 when z.done_at is not null and z.done_at >= z.last_at then 'done'
                 when exists (select 1 from public.outbox_messages w where w.tenant_id = p_tenant_id and w.lead_id = z.lead_id and w.status = 'needs_approval') then 'needs_you'
                 when not z.assistant_enabled and z.last_dir = 'in' then 'needs_you'
                 when not z.assistant_enabled then 'done'
                 else 'assistant' end) as j
        from (
          select l.id as lead_id, c.id as contact_id, c.full_name as name, co.name as company, c.phone, c.suppressed_at is not null as suppressed,
                 li.last_in, lo.last_out, st.last_read_at as read_at, coalesce(st.assistant_enabled, true) as assistant_enabled, st.done_at,
                 greatest(li.last_in, lo.last_out) as last_at,
                 case when li.last_in is not null and (lo.last_out is null or li.last_in > lo.last_out) then 'in' else 'out' end as last_dir,
                 case when li.last_in is not null and (lo.last_out is null or li.last_in > lo.last_out) then li.body else lo.body end as preview
            from public.leads l
            join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
            left join public.companies co on co.tenant_id = l.tenant_id and co.id = l.company_id
            left join integrations.wa_conversation_state st on st.tenant_id = l.tenant_id and st.lead_id = l.id
            left join lateral (select e.received_at as last_in, e.body from public.enquiries e where e.tenant_id = l.tenant_id and e.lead_id = l.id and e.channel = 'whatsapp'
                                order by e.received_at desc, e.id desc limit 1) li on true
            left join lateral (select coalesce(m.sent_at, m.created_at) as last_out, m.body from public.outbox_messages m where m.tenant_id = l.tenant_id and m.lead_id = l.id
                                and m.status in ('sent', 'queued', 'needs_approval') order by coalesce(m.sent_at, m.created_at) desc, m.id desc limit 1) lo on true
           where l.tenant_id = p_tenant_id and l.archived_at is null and c.erased_at is null and (li.last_in is not null or lo.last_out is not null)
        ) z
       where p_before is null or z.last_at < p_before
       order by z.last_at desc, z.lead_id
       limit p_limit
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.conversation_thread(p_tenant_id uuid, p_lead_id uuid, p_limit integer default 50, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_last timestamptz;
  c public.contacts;
  v_items jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.wa_error('invalid');
  end if;
  select c2.* into c from public.leads l join public.contacts c2 on c2.tenant_id = l.tenant_id and c2.id = l.contact_id where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.wa_error('reference');
  end if;
  v_last := app.wa_last_inbound(p_tenant_id, p_lead_id, v_now);
  select coalesce(jsonb_agg(y.j order by y.at desc, y.dir desc, y.id), '[]'::jsonb) into v_items from (
    select z.at, z.id, z.dir, z.j from (
      select e.received_at as at, e.id, 0 as dir,
             jsonb_build_object('direction', 'in', 'id', e.id, 'at', e.received_at, 'text', e.body) as j
        from public.enquiries e where e.tenant_id = p_tenant_id and e.lead_id = p_lead_id and e.channel = 'whatsapp'
      union all
      select coalesce(m.sent_at, m.created_at), m.id, 1,
             jsonb_build_object('direction', 'out', 'id', m.id, 'at', coalesce(m.sent_at, m.created_at), 'text', m.body, 'status', m.status, 'reason', m.reason, 'source', m.source,
                                'delivery', (select s.status from integrations.wa_message_status s where s.message_id = m.id),
                                'delivered_at', (select s.delivered_at from integrations.wa_message_status s where s.message_id = m.id),
                                'read_at', (select s.read_at from integrations.wa_message_status s where s.message_id = m.id),
                                'delivery_error', (select s.error_word from integrations.wa_message_status s where s.message_id = m.id),
                                'failure_code', m.failure_code,
                                'photos', (select count(*) from public.outbox_message_media md where md.tenant_id = m.tenant_id and md.message_id = m.id))
        from public.outbox_messages m where m.tenant_id = p_tenant_id and m.lead_id = p_lead_id
    ) z
    where p_before is null or z.at < p_before
    order by z.at desc, z.dir desc, z.id   -- at the same instant our message came after theirs
    limit p_limit
  ) y;
  return jsonb_build_object(
    'lead_id', p_lead_id, 'contact_id', c.id, 'name', c.full_name, 'phone', c.phone, 'stopped', c.suppressed_at is not null, 'whatsapp_consent', c.whatsapp_consent,
    'window_open', coalesce(v_last > v_now - interval '24 hours', false), 'window_expires_at', case when v_last > v_now - interval '24 hours' then v_last + interval '24 hours' end,
    'assistant_enabled', coalesce((select s.assistant_enabled from integrations.wa_conversation_state s where s.tenant_id = p_tenant_id and s.lead_id = p_lead_id), true),
    'handled_by', case
      when (select s.done_at from integrations.wa_conversation_state s where s.tenant_id = p_tenant_id and s.lead_id = p_lead_id) >= greatest(v_last, (select max(coalesce(m.sent_at, m.created_at)) from public.outbox_messages m where m.tenant_id = p_tenant_id and m.lead_id = p_lead_id and m.status in ('sent', 'queued', 'needs_approval'))) then 'done'
      when exists (select 1 from public.outbox_messages w where w.tenant_id = p_tenant_id and w.lead_id = p_lead_id and w.status = 'needs_approval') then 'needs_you'
      when not coalesce((select s.assistant_enabled from integrations.wa_conversation_state s where s.tenant_id = p_tenant_id and s.lead_id = p_lead_id), true) then 'needs_you'
      else 'assistant' end,
    'items', v_items);
end;
$$;

create or replace function public.scheduler_auto_reply_pending(p_limit integer default 5) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_out jsonb := '[]'::jsonb;
  r     record;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 20 then
    perform app.scheduler_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  for r in
    select e.id as enquiry_id, e.tenant_id, e.lead_id, e.body, e.received_at, l.contact_id
      from public.enquiries e
      join workspace.auto_reply a on a.workspace_id = e.tenant_id and a.enabled
      join public.leads l on l.tenant_id = e.tenant_id and l.id = e.lead_id and l.archived_at is null
     where e.channel = 'whatsapp'
       and e.received_at > v_now - interval '24 hours' and e.received_at <= v_now
       and e.body is not null and left(e.body, 1) <> '[' and char_length(btrim(e.body)) >= 1
       and not exists (select 1 from workspace.auto_reply_done d where d.enquiry_id = e.id)
       and e.received_at = (select max(x.received_at) from public.enquiries x where x.tenant_id = e.tenant_id and x.lead_id = e.lead_id and x.channel = 'whatsapp' and x.received_at <= v_now)
       and not exists (select 1 from public.outbox_messages m where m.tenant_id = e.tenant_id and m.lead_id = e.lead_id and m.created_at >= e.received_at)
       and app.agent_switches_on(e.tenant_id, 'assistant')
       and not exists (select 1 from integrations.wa_conversation_state cs where cs.tenant_id = e.tenant_id and cs.lead_id = e.lead_id and not cs.assistant_enabled)
       and (select count(*) from workspace.auto_reply_done d2 where d2.workspace_id = e.tenant_id and d2.handled_at > now() - interval '24 hours') < 200
     order by e.received_at, e.id
     limit p_limit
  loop
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'enquiry_id', r.enquiry_id, 'tenant_id', r.tenant_id, 'lead_id', r.lead_id, 'text', left(r.body, 1000), 'received_at', r.received_at,
      'business', (select t.name from public.tenants t where t.id = r.tenant_id),
      'assistant_name', coalesce((select s.assistant_name from public.assistant_settings s where s.tenant_id = r.tenant_id), 'the assistant'),
      'customer_name', (select case when c.full_name ~* '^whatsapp [0-9]+$' then null else split_part(btrim(c.full_name), ' ', 1) end from public.contacts c where c.tenant_id = r.tenant_id and c.id = r.contact_id and c.erased_at is null),
      'mention_ai', app.outbox_mention_ai(r.tenant_id),
      'history', coalesce((
         select jsonb_agg(h.turn order by h.at)
           from (select * from (
                   select e2.received_at as at, jsonb_build_object('who', 'customer', 'text', left(e2.body, 400)) as turn
                     from public.enquiries e2 where e2.tenant_id = r.tenant_id and e2.lead_id = r.lead_id and e2.channel = 'whatsapp' and e2.id <> r.enquiry_id and e2.received_at <= r.received_at and left(e2.body, 1) <> '['
                   union all
                   select m.created_at, jsonb_build_object('who', 'business', 'text', left(m.body, 400))
                     from public.outbox_messages m where m.tenant_id = r.tenant_id and m.lead_id = r.lead_id and m.status = 'sent') u
                  order by u.at desc limit 6) h), '[]'::jsonb),
      'facts', coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'text', f.text) order by f.created_at)
                           from (select * from public.knowledge_facts k where k.tenant_id = r.tenant_id and k.status = 'approved' order by k.created_at limit 40) f), '[]'::jsonb)));
  end loop;
  return v_out;
end;
$$;

create or replace function public.scheduler_auto_reply_submit(p_enquiry_id uuid, p_text text, p_language text, p_gloss_en text, p_hold boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  e     public.enquiries;
  v_msg uuid;
  v_row jsonb;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_enquiry_id is null or p_text is null or p_language is null or p_hold is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml') then
    perform app.scheduler_error('invalid');
  end if;
  select * into e from public.enquiries x where x.id = p_enquiry_id and x.channel = 'whatsapp';
  if not found or not exists (select 1 from workspace.auto_reply a where a.workspace_id = e.tenant_id and a.enabled)
     or exists (select 1 from workspace.auto_reply_done d where d.enquiry_id = e.id)
     or exists (select 1 from integrations.wa_conversation_state cs where cs.tenant_id = e.tenant_id and cs.lead_id = e.lead_id and not cs.assistant_enabled)
     or e.received_at <= v_now - interval '24 hours' then
    return jsonb_build_object('outcome', 'not_pending');
  end if;
  v_msg := md5('auto-reply:' || e.id::text)::uuid;
  begin
    v_row := app.outbox_submit_core(auth.uid(), v_msg, e.tenant_id, e.lead_id, 'whatsapp', p_text, p_language, 'reply_to_inbound', 'assistant', false, p_hold, '{}'::uuid[], false, nullif(btrim(coalesce(p_gloss_en, '')), ''));
  exception when others then
    insert into workspace.auto_reply_done (enquiry_id, workspace_id, result, note) values (e.id, e.tenant_id, 'skipped', 'refused ' || sqlstate);
    return jsonb_build_object('outcome', 'skipped', 'sqlstate', sqlstate);
  end;
  insert into workspace.auto_reply_done (enquiry_id, workspace_id, result, note, outbox_message_id)
  values (e.id, e.tenant_id, case when v_row ->> 'status' = 'needs_approval' then 'held_for_owner' else 'answered' end, v_row ->> 'reason', v_msg);
  return jsonb_build_object('outcome', 'submitted', 'message', v_row);
end;
$$;
