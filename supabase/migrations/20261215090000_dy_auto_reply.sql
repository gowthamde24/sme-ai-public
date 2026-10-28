-- Job DY (28 Oct 2026): THE ASSISTANT ANSWERS A CUSTOMER'S WHATSAPP MESSAGE ON ITS OWN (the owner's standing rule, decision-auto-send-policy: approve once, not per message).
--
--   workspace.auto_reply         one row per workspace: the Owner's switch (off until the Owner turns it on, with the second factor; every change is audited)
--   workspace.auto_reply_done    one row per customer message that was looked at: answered, held for the Owner, or skipped (and why); a message is looked at ONCE
--   public.auto_reply_get / _set                       any member reads; the Owner (second factor) switches
--   public.scheduler_auto_reply_pending(limit)         the registered worker only: the messages that wait for an answer, with what the model may see (the business, the customer's first name, the last turns, the APPROVED facts)
--   public.scheduler_auto_reply_submit(...) / _skip    the registered worker only: hand the model's reply to the OUTBOX as an assistant message, or record that nothing was sent
--
-- THE RULES (in code, never a model). The reply is an ordinary outbox message (source `assistant`, category `reply_to_inbound`), so EVERY per-message rule applies: STOP, the customer's consent, the 24-hour window, the
-- daily limit per customer, the kill switches, the first-message AI line, and the content flags: a price, a discount or a promise makes it WAIT FOR THE OWNER (needs_approval). The worker also sends it to the Owner when it
-- is unsure or the customer asks for a person (p_hold: the outbox's `uncertain`). Only the customer's NEWEST message is answered, only within 24 hours of it, only when nobody (a person or the assistant) has already written
-- since, only while the platform switches (agents, assistant, outbox) are on, and at most 200 a workspace a day. Nothing here reads or writes anything outside the workspace.
-- SQLSTATEs: 42501 deny, 22023 invalid.

create table workspace.auto_reply (
  workspace_id uuid primary key references public.tenants (id) on delete restrict,
  enabled      boolean not null default false,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
alter table workspace.auto_reply enable row level security;
alter table workspace.auto_reply force row level security;
revoke all on workspace.auto_reply from public, anon, authenticated, service_role;

create table workspace.auto_reply_done (
  enquiry_id       uuid primary key,
  workspace_id     uuid not null references public.tenants (id) on delete restrict,
  result           text not null check (result in ('answered', 'held_for_owner', 'skipped')),
  note             text check (note is null or char_length(note) <= 60),
  outbox_message_id uuid,
  handled_at       timestamptz not null default now()
);
create index auto_reply_done_day_idx on workspace.auto_reply_done (workspace_id, handled_at);
alter table workspace.auto_reply_done enable row level security;
alter table workspace.auto_reply_done force row level security;
revoke all on workspace.auto_reply_done from public, anon, authenticated, service_role;

create function app.auto_reply_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce((select a.enabled from workspace.auto_reply a where a.workspace_id = p_tenant), false),
    'changed_at', (select a.changed_at from workspace.auto_reply a where a.workspace_id = p_tenant),
    'answered_today', (select count(*) from workspace.auto_reply_done d where d.workspace_id = p_tenant and d.result = 'answered' and d.handled_at > now() - interval '24 hours'),
    'held_today', (select count(*) from workspace.auto_reply_done d where d.workspace_id = p_tenant and d.result = 'held_for_owner' and d.handled_at > now() - interval '24 hours'),
    'daily_limit', 200,
    'rules', jsonb_build_array('answers_within_24_hours', 'asks_you_before_prices_and_promises', 'hands_over_when_unsure_or_asked_for_a_person'))
$$;
revoke all on function app.auto_reply_json(uuid) from public;

create function public.auto_reply_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.auto_reply_json(p_tenant_id);
end;
$$;
revoke all on function public.auto_reply_get(uuid) from public, anon;
grant execute on function public.auto_reply_get(uuid) to authenticated;

create function public.auto_reply_set(p_tenant_id uuid, p_enabled boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  perform app.require_aal2();
  if p_enabled is null then
    perform app.workspace_error('invalid');
  end if;
  select a.enabled into v_old from workspace.auto_reply a where a.workspace_id = p_tenant_id;
  insert into workspace.auto_reply as a (workspace_id, enabled, changed_by, changed_at) values (p_tenant_id, p_enabled, auth.uid(), now())
  on conflict (workspace_id) do update set enabled = excluded.enabled, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  perform app.write_audit_event(p_tenant_id, 'assistant.auto_reply_changed', 'workspace', p_tenant_id,
    jsonb_build_object('enabled', coalesce(v_old, false)), jsonb_build_object('enabled', p_enabled));
  return app.auto_reply_json(p_tenant_id);
end;
$$;
revoke all on function public.auto_reply_set(uuid, boolean) from public, anon;
grant execute on function public.auto_reply_set(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the worker's two reads and two writes
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.scheduler_auto_reply_pending(p_limit integer default 5) returns jsonb
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
revoke all on function public.scheduler_auto_reply_pending(integer) from public, anon;
grant execute on function public.scheduler_auto_reply_pending(integer) to authenticated;

create function public.scheduler_auto_reply_submit(p_enquiry_id uuid, p_text text, p_language text, p_gloss_en text, p_hold boolean) returns jsonb
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
revoke all on function public.scheduler_auto_reply_submit(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.scheduler_auto_reply_submit(uuid, text, text, text, boolean) to authenticated;

create function public.scheduler_auto_reply_skip(p_enquiry_id uuid, p_note text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.enquiries;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_enquiry_id is null or p_note is null or char_length(p_note) not between 1 and 60 then
    perform app.scheduler_error('invalid');
  end if;
  select * into e from public.enquiries x where x.id = p_enquiry_id and x.channel = 'whatsapp';
  if not found then
    return jsonb_build_object('outcome', 'not_pending');
  end if;
  insert into workspace.auto_reply_done (enquiry_id, workspace_id, result, note) values (e.id, e.tenant_id, 'skipped', p_note) on conflict (enquiry_id) do nothing;
  return jsonb_build_object('outcome', 'skipped');
end;
$$;
revoke all on function public.scheduler_auto_reply_skip(uuid, text) from public, anon;
grant execute on function public.scheduler_auto_reply_skip(uuid, text) to authenticated;
