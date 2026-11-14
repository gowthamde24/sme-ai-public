-- Admin console phase 2, slice 2: Stack19 support can PAUSE and RESUME a business's assistant (an incident, a billing dispute, a request), with a reason, and the pause really stops it answering calls.
--   * workspace.assistant_live gets `staff_hold` (support paused it: the shop owner cannot go live again until support resumes) and `live_before` (what to restore on resume).
--   * public.phone_line_find (the inbound call path) now reports a number as NOT answering inbound while the workspace's assistant is paused. This also makes the shop owner's own "Pause" button real for inbound calls
--     (before, the flag changed only the label). Outbound dialing is not gated by it in this slice (noted in the master list).
--   * app.assistant_set_live refuses going live while support holds it (SM992).
--   * public.admin_assistant_pause / admin_assistant_resume: owner and support, reason required (SM946), audited AND shown to the shop owner in their activity log ("Stack19 support paused your assistant").
alter table workspace.assistant_live add column staff_hold boolean not null default false;
alter table workspace.assistant_live add column live_before boolean;

-- the shop owner's activity log: the support entries now say what support did (viewed / paused / resumed)
create or replace function public.activity_log(p_tenant_id uuid, p_limit integer default 50, p_before_at timestamptz default null, p_before_key text default null, p_kind text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_next  jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind not in ('call', 'message', 'action', 'support'))
     or ((p_before_at is null) <> (p_before_key is null)) or (p_before_key is not null and p_before_key !~ '^(call|message|action|support):[0-9a-f-]{36}$') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  with src as (
    (select c.created_at as at, 'call:' || c.id::text as key,
            jsonb_build_object('key', 'call:' || c.id::text, 'kind', 'call', 'id', c.id, 'at', c.created_at, 'who', 'assistant', 'direction', c.direction, 'state', c.state,
                               'live', app.phone_call_is_live(c), 'outcome', c.outcome, 'duration_s', c.duration_s, 'summary', c.summary,
                               'contact_id', c.contact_id, 'contact_name', (select x.full_name from public.contacts x where x.tenant_id = c.tenant_id and x.id = c.contact_id),
                               'lead_id', c.lead_id, 'sandbox', c.sandbox, 'simulated', c.simulated,
                               'waiting', (c.end_reason = 'handover' and c.handled_at is null), 'undo', jsonb_build_object('state', 'none', 'until', null)) as j
       from public.phone_calls c
      where c.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'call')
        and (p_before_at is null or (c.created_at, 'call:' || c.id::text) < (p_before_at, p_before_key))
      order by c.created_at desc, c.id desc limit p_limit + 1)
    union all
    (select m.created_at, 'message:' || m.id::text,
            jsonb_build_object('key', 'message:' || m.id::text, 'kind', 'message', 'id', m.id, 'at', m.created_at, 'who', m.source, 'channel', m.channel, 'category', m.category,
                               'status', m.status, 'reason', m.reason, 'flags', m.flags,
                               'contact_id', m.contact_id, 'contact_name', (select x.full_name from public.contacts x where x.tenant_id = m.tenant_id and x.id = m.contact_id),
                               'lead_id', m.lead_id, 'scheduled_for', m.scheduled_for,
                               'waiting', (m.status = 'needs_approval'), 'undo', jsonb_build_object('state', 'none', 'until', null))
       from public.outbox_messages m
      where m.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'message')
        and (p_before_at is null or (m.created_at, 'message:' || m.id::text) < (p_before_at, p_before_key))
      order by m.created_at desc, m.id desc limit p_limit + 1)
    union all
    (select w.created_at, 'action:' || w.id::text,
            jsonb_build_object('key', 'action:' || w.id::text, 'kind', 'action', 'id', w.id, 'at', w.created_at, 'who', 'assistant', 'tool', w.tool, 'summary', w.summary,
                               'status', w.status, 'requested_by', w.requested_by, 'decided_by', w.decided_by, 'plan_id', w.plan_id,
                               'waiting', false,
                               'undo', jsonb_build_object('state', case when w.status = 'undone' then 'done'
                                                                       when w.undo is null or w.status <> 'done' then 'none'
                                                                       when w.undo_until is not null and w.undo_until < now() then 'expired'
                                                                       else 'available' end,
                                                         'until', case when w.undo is not null and w.status = 'done' then w.undo_until end))
       from public.assistant_work_actions w
      where w.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'action')
        and (p_before_at is null or (w.created_at, 'action:' || w.id::text) < (p_before_at, p_before_key))
      order by w.created_at desc, w.id desc limit p_limit + 1)
    union all
    -- every time Stack19 support looked at this business (admin_access_open writes it as customer_visible): the shop owner sees who-what-why, never a staff name
    (select a.at, 'support:' || a.id::text,
            jsonb_build_object('key', 'support:' || a.id::text, 'kind', 'support', 'id', a.id, 'at', a.at, 'who', 'support', 'summary', case a.action when 'pause' then 'Stack19 support paused your assistant' when 'resume' then 'Stack19 support resumed your assistant' else 'Stack19 support viewed your account' end,
                               'reason', admin.reason_label(a.reason_code, a.reason_text), 'waiting', false, 'undo', jsonb_build_object('state', 'none', 'until', null))
       from admin.audit a
      where a.tenant_id = p_tenant_id and a.customer_visible and (p_kind is null or p_kind = 'support')
        and (p_before_at is null or (a.at, 'support:' || a.id::text) < (p_before_at, p_before_key))
      order by a.at desc, a.id desc limit p_limit + 1)),
  page as (select s.at, s.key, s.j, row_number() over (order by s.at desc, s.key desc) as rn from src s order by s.at desc, s.key desc limit p_limit + 1)
  select coalesce(jsonb_agg(p.j order by p.rn) filter (where p.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('before_at', q.at, 'before_key', q.key) from page q where q.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1))
    into v_items, v_next
    from page p;
  return jsonb_build_object('items', v_items, 'next', v_next);
end;
$$;

-- the inbound call path
create or replace function public.phone_line_find(p_number text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n public.phone_numbers;
  v_name text;
  v_assistant text;
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  select * into n from public.phone_numbers x where x.number = p_number;
  if not found then
    return null;
  end if;
  select t.name into v_name from public.tenants t where t.id = n.tenant_id;
  v_name := coalesce(nullif(btrim(n.spoken_business_name), ''), v_name);
  select a.assistant_name into v_assistant from public.assistant_settings a where a.tenant_id = n.tenant_id;
  return jsonb_build_object('tenant_id', n.tenant_id, 'line_id', n.id, 'inbound_on', (n.inbound_on and not exists (select 1 from workspace.assistant_live l where l.workspace_id = n.tenant_id and not l.live)), 'business', v_name, 'assistant', v_assistant,
                            'provider', n.provider, 'account_ref', n.account_ref, 'external_ref', n.external_ref);
end;
$$;

-- the facts say whether support holds it (the app shows "Paused by Stack19 support")
create or replace function app.assistant_facts(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'live', coalesce((select l.live from workspace.assistant_live l where l.workspace_id = p_tenant), false),
    'ever_changed', exists (select 1 from workspace.assistant_live l where l.workspace_id = p_tenant),
    'staff_hold', coalesce((select l.staff_hold from workspace.assistant_live l where l.workspace_id = p_tenant), false),
    'business_name_ok', exists (select 1 from public.tenants t where t.id = p_tenant and char_length(btrim(t.name)) >= 2 and lower(btrim(t.name)) <> 'my business'),
    'phone_number_ok', exists (select 1 from public.phone_numbers n where n.tenant_id = p_tenant)
                       or exists (select 1 from integrations.whatsapp_accounts a where a.tenant_id = p_tenant and a.status = 'active'),
    'voice_saved', exists (select 1 from public.assistant_settings s where s.tenant_id = p_tenant),
    'rules_saved', exists (select 1 from public.talk_training t where t.tenant_id = p_tenant))
$$;
-- going live is refused while support holds the assistant
create or replace function app.assistant_set_live(p_tenant uuid, p_live boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb;
begin
  if auth.uid() is null or p_tenant is null or not app.has_tenant_role(p_tenant, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_live and exists (select 1 from workspace.assistant_live l where l.workspace_id = p_tenant and l.staff_hold) then
    raise exception 'paused by Stack19 support' using errcode = 'SM992';
  end if;
  f := app.assistant_facts(p_tenant);
  if p_live and not ((f ->> 'business_name_ok')::boolean and (f ->> 'phone_number_ok')::boolean) then
    raise exception 'the assistant needs a business name and a connected phone number' using errcode = 'SM991';
  end if;
  insert into workspace.assistant_live as l (workspace_id, live, changed_by, changed_at) values (p_tenant, p_live, auth.uid(), now())
  on conflict (workspace_id) do update set live = excluded.live, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  perform app.write_audit_event(p_tenant, case when p_live then 'assistant.went_live' else 'assistant.paused' end, 'workspace', p_tenant, null, jsonb_build_object('live', p_live));
  return app.assistant_facts(p_tenant);
end;
$$;

create function public.admin_assistant_pause(p_tenant_id uuid, p_reason_code text, p_reason_text text default null) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := nullif(btrim(coalesce(p_reason_text, '')), '');
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_tenant_id is null or p_reason_code is null or p_reason_code not in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if (p_reason_code = 'other' and v_text is null) or (v_text is not null and (char_length(v_text) not between 3 and 300 or not app.text_is_clean(v_text))) then
    raise exception 'a reason is required' using errcode = 'SM946';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.archived_at is null) then
    raise exception 'not found' using errcode = '23503';
  end if;
  insert into workspace.assistant_live as l (workspace_id, live, changed_by, changed_at, staff_hold, live_before) values (p_tenant_id, false, auth.uid(), now(), true, false)
  on conflict (workspace_id) do update set live_before = case when l.staff_hold then l.live_before else l.live end, live = false, staff_hold = true, changed_by = auth.uid(), changed_at = now();
  perform admin.log(v_staff.user_id, 'pause', p_tenant_id, null, p_reason_code, v_text, 'business', p_tenant_id::text, true);
  return admin.business_row(p_tenant_id);
end $$;

create function public.admin_assistant_resume(p_tenant_id uuid, p_reason_code text, p_reason_text text default null) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := nullif(btrim(coalesce(p_reason_text, '')), '');
  v_row   workspace.assistant_live;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_tenant_id is null or p_reason_code is null or p_reason_code not in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if (p_reason_code = 'other' and v_text is null) or (v_text is not null and (char_length(v_text) not between 3 and 300 or not app.text_is_clean(v_text))) then
    raise exception 'a reason is required' using errcode = 'SM946';
  end if;
  select * into v_row from workspace.assistant_live l where l.workspace_id = p_tenant_id for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if not v_row.staff_hold then
    raise exception 'not paused by support' using errcode = '22023';   -- the shop owner's own pause is theirs to lift
  end if;
  update workspace.assistant_live set staff_hold = false, live = coalesce(live_before, false), live_before = null, changed_by = auth.uid(), changed_at = now() where workspace_id = p_tenant_id;
  perform admin.log(v_staff.user_id, 'resume', p_tenant_id, null, p_reason_code, v_text, 'business', p_tenant_id::text, true);
  return admin.business_row(p_tenant_id);
end $$;

revoke all on function public.admin_assistant_pause(uuid, text, text), public.admin_assistant_resume(uuid, text, text) from public, anon;
grant execute on function public.admin_assistant_pause(uuid, text, text), public.admin_assistant_resume(uuid, text, text) to authenticated;
