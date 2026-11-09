-- al: "Everything it did" (one merged timeline) and "Limits" (what the assistant does alone and what waits for the Owner), owner job 9 Nov 2026.
--   * public.activity_log: ONE paged timeline of the phone calls, the WhatsApp messages (outbox) and the assistant's changes (assistant_work_actions), newest first, Owner and Admin. READ ONLY, no table, no column.
--     Each item says who did it, what state it is in, whether it waits for the Owner, and whether it can be undone. Only an assistant change can have an undo; a call and a message never can (they are
--     over, or sent): the flag says so ("none"), it is never invented. No message text is returned.
--   * public.limits_get: what the workspace's REAL settings say, per kind of action: "alone" or "needs_ok", whether it is locked (some always ask: quotes, price changes, money, deleting, and any message about
--     money, a promise or a complaint), the numbers (a discount, a daily message limit, a big-order limit), the quiet hours of messages and of calls, and the off switch. Nothing is stored here.
--   * public.limits_tighten: the Owner can only make a limit TIGHTER, in one call, all or nothing: switch the workspace off, stop automatic messages, lower a number, shorten the hours, stop an assistant
--     permission. Anything that would loosen is refused and nothing changes; making it looser stays in the existing settings pages (with their second factor).

-- the limits as the real settings give them (no check of the caller: the two public functions below do it)
create function app.limits_json(p_tenant uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a        public.assistant_settings;
  o        public.outbox_settings;
  v_has_o  boolean;
  v_has_a  boolean;
  v_auto   boolean;
  v_hours  jsonb := app.outreach_hours(p_tenant);
  v_kinds  jsonb := '[]'::jsonb;
  v_caps   jsonb := '[]'::jsonb;
begin
  select * into o from public.outbox_settings x where x.tenant_id = p_tenant;
  v_has_o := found;
  select * into a from public.assistant_settings x where x.tenant_id = p_tenant;
  v_has_a := found;
  v_auto := coalesce(o.auto_send_enabled, false);

  -- WhatsApp messages
  v_kinds := v_kinds || jsonb_build_array(
    jsonb_build_object('kind', 'message_routine', 'field', 'messages_alone', 'mode', case when v_auto then 'alone' else 'needs_ok' end, 'locked', false, 'locked_reason', null, 'can_tighten', v_auto,
                       'source', 'outbox_settings'),
    jsonb_build_object('kind', 'message_other', 'field', null, 'mode', 'needs_ok', 'locked', true, 'locked_reason', 'always_asks', 'can_tighten', false, 'source', 'policy'),
    jsonb_build_object('kind', 'message_sensitive', 'field', null, 'mode', 'needs_ok', 'locked', true, 'locked_reason', 'always_asks', 'can_tighten', false, 'source', 'policy'));
  -- what the assistant may do on a call (a "no" means it hands the matter to a person)
  if v_has_a then
    v_kinds := v_kinds || jsonb_build_array(
      jsonb_build_object('kind', 'call_prices', 'field', 'call_prices', 'mode', case when a.may_answer_prices then 'alone' else 'needs_ok' end, 'locked', false, 'locked_reason', null, 'can_tighten', a.may_answer_prices, 'source', 'assistant_settings'),
      jsonb_build_object('kind', 'call_visits', 'field', 'call_visits', 'mode', case when a.may_book_visits then 'alone' else 'needs_ok' end, 'locked', false, 'locked_reason', null, 'can_tighten', a.may_book_visits, 'source', 'assistant_settings'),
      jsonb_build_object('kind', 'call_media', 'field', 'call_media', 'mode', case when a.may_send_media then 'alone' else 'needs_ok' end, 'locked', false, 'locked_reason', null, 'can_tighten', a.may_send_media, 'source', 'assistant_settings'),
      jsonb_build_object('kind', 'call_dues', 'field', 'call_dues', 'mode', case when a.may_talk_dues then 'alone' else 'needs_ok' end, 'locked', false, 'locked_reason', null, 'can_tighten', a.may_talk_dues, 'source', 'assistant_settings'));
  end if;
  -- what always waits for the Owner, whatever is set
  v_kinds := v_kinds || jsonb_build_array(
    jsonb_build_object('kind', 'quote_send', 'field', null, 'mode', 'needs_ok', 'locked', true, 'locked_reason', 'always_asks', 'can_tighten', false, 'source', 'policy'),
    jsonb_build_object('kind', 'price_change', 'field', null, 'mode', 'needs_ok', 'locked', true, 'locked_reason', 'always_asks', 'can_tighten', false, 'source', 'policy'),
    jsonb_build_object('kind', 'payment', 'field', null, 'mode', 'needs_ok', 'locked', true, 'locked_reason', 'always_asks', 'can_tighten', false, 'source', 'policy'),
    jsonb_build_object('kind', 'delete_data', 'field', null, 'mode', 'needs_ok', 'locked', true, 'locked_reason', 'always_asks', 'can_tighten', false, 'source', 'policy'));

  -- the numbers (lower is tighter)
  v_caps := v_caps || jsonb_build_array(
    jsonb_build_object('key', 'messages_per_customer_per_day', 'field', 'message_daily_limit', 'value', coalesce(o.per_customer_daily_limit, 3), 'unit', 'messages', 'can_tighten', coalesce(o.per_customer_daily_limit, 3) > 1, 'source', 'outbox_settings'));
  if v_has_a then
    v_caps := v_caps || jsonb_build_array(
      jsonb_build_object('key', 'call_discount_percent', 'field', 'call_discount_percent', 'value', a.max_discount_percent, 'unit', 'percent', 'can_tighten', a.max_discount_percent > 0, 'source', 'assistant_settings'),
      jsonb_build_object('key', 'call_big_order_paise', 'field', 'call_big_order_paise', 'value', a.handover_order_above_paise, 'unit', 'paise', 'can_tighten', coalesce(a.handover_order_above_paise, 100000000000) > 1, 'source', 'assistant_settings'));
  end if;

  return jsonb_build_object(
    'workspace', jsonb_build_object('on', coalesce((select s.enabled from public.tenant_agent_settings s where s.tenant_id = p_tenant), false), 'field', 'workspace_on',
                                    'platform_on', coalesce((select f.enabled from public.platform_flags f where f.key = 'agents_enabled'), false)),
    'assistant_saved', v_has_a,
    'kinds', v_kinds,
    'caps', v_caps,
    'quiet_hours', jsonb_build_object(
      'messages', jsonb_build_object('start_hour', coalesce(o.quiet_start_hour, 21), 'end_hour', coalesce(o.quiet_end_hour, 9), 'field', 'message_quiet_hours', 'source', 'outbox_settings'),
      'calls', jsonb_build_object('days', v_hours -> 'days', 'from_minute', v_hours -> 'from_minute', 'to_minute', v_hours -> 'to_minute', 'holidays', v_hours -> 'holidays',
                                  'source', v_hours ->> 'from', 'field', 'call_hours', 'can_tighten', (v_hours ->> 'from') = 'assistant')));
end;
$$;
revoke all on function app.limits_json(uuid) from public, anon, authenticated, service_role;

create function public.limits_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.limits_json(p_tenant_id);
end;
$$;
revoke all on function public.limits_get(uuid) from public, anon;
grant execute on function public.limits_get(uuid) to authenticated;

-- the Owner makes a limit tighter (all or nothing). Answer: {"ok": true, "limits": ...} or {"ok": false, "reason": "would_loosen" | "unknown_field" | "invalid" | "not_saved" | "limits_elsewhere", "field": ...}
create function public.limits_tighten(p_tenant_id uuid, p_changes jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  k         text;
  v         jsonb;
  a         public.assistant_settings;
  o         public.outbox_settings;
  v_has_a   boolean;
  v_agents  boolean;
  v_hours   jsonb := null;
  -- the new values (null = unchanged)
  n_agents_off boolean := false;
  n_auto    boolean;
  n_limit   integer;
  n_qs      integer;
  n_qe      integer;
  n_prices  boolean; n_visits boolean; n_media boolean; n_dues boolean;
  n_disc    integer;
  n_big     bigint;
  n_days    smallint[];
  n_from    integer;
  n_to      integer;
  v_big_set boolean := false;
  v_o_changed boolean := false;
  v_a_changed boolean := false;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or (select count(*) from jsonb_object_keys(p_changes)) not between 1 and 12 then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', null);
  end if;
  select * into a from public.assistant_settings x where x.tenant_id = p_tenant_id;
  v_has_a := found;
  select * into o from public.outbox_settings x where x.tenant_id = p_tenant_id;
  if not found then
    o.auto_send_enabled := false; o.per_customer_daily_limit := 3; o.quiet_start_hour := 21; o.quiet_end_hour := 9;
  end if;
  v_agents := coalesce((select s.enabled from public.tenant_agent_settings s where s.tenant_id = p_tenant_id), false);
  v_hours := app.outreach_hours(p_tenant_id);

  for k, v in select * from jsonb_each(p_changes) loop
    case k
      when 'workspace_on' then
        if jsonb_typeof(v) <> 'boolean' then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
        if (v #>> '{}')::boolean and not v_agents then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
        n_agents_off := v_agents and not (v #>> '{}')::boolean;
      when 'messages_alone' then
        if jsonb_typeof(v) <> 'boolean' then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
        if (v #>> '{}')::boolean and not o.auto_send_enabled then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
        if o.auto_send_enabled and not (v #>> '{}')::boolean then n_auto := false; end if;
      when 'message_daily_limit' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,3}$' or (v #>> '{}')::integer not between 1 and 20 then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
        if (v #>> '{}')::integer > o.per_customer_daily_limit then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
        if (v #>> '{}')::integer < o.per_customer_daily_limit then n_limit := (v #>> '{}')::integer; end if;
      when 'message_quiet_hours' then
        if jsonb_typeof(v) <> 'object' or exists (select 1 from jsonb_object_keys(v) kk where kk not in ('start_hour', 'end_hour')) or (select count(*) from jsonb_object_keys(v)) = 0 then
          return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k);
        end if;
        if v ? 'start_hour' then
          if jsonb_typeof(v -> 'start_hour') <> 'number' or (v ->> 'start_hour') !~ '^[0-9]{1,2}$' or (v ->> 'start_hour')::integer not between 19 and 23 then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
          if (v ->> 'start_hour')::integer > o.quiet_start_hour then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
          if (v ->> 'start_hour')::integer < o.quiet_start_hour then n_qs := (v ->> 'start_hour')::integer; end if;
        end if;
        if v ? 'end_hour' then
          if jsonb_typeof(v -> 'end_hour') <> 'number' or (v ->> 'end_hour') !~ '^[0-9]{1,2}$' or (v ->> 'end_hour')::integer not between 7 and 10 then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
          if (v ->> 'end_hour')::integer < o.quiet_end_hour then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
          if (v ->> 'end_hour')::integer > o.quiet_end_hour then n_qe := (v ->> 'end_hour')::integer; end if;
        end if;
      when 'call_prices', 'call_visits', 'call_media', 'call_dues' then
        if jsonb_typeof(v) <> 'boolean' then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
        if not v_has_a then return jsonb_build_object('ok', false, 'reason', 'not_saved', 'field', k); end if;
        if (v #>> '{}')::boolean and not (case k when 'call_prices' then a.may_answer_prices when 'call_visits' then a.may_book_visits when 'call_media' then a.may_send_media else a.may_talk_dues end) then
          return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k);
        end if;
        if not (v #>> '{}')::boolean then
          case k when 'call_prices' then n_prices := false; when 'call_visits' then n_visits := false; when 'call_media' then n_media := false; else n_dues := false; end case;
        end if;
      when 'call_discount_percent' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,2}$' or (v #>> '{}')::integer not between 0 and 50 then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
        if not v_has_a then return jsonb_build_object('ok', false, 'reason', 'not_saved', 'field', k); end if;
        if (v #>> '{}')::integer > a.max_discount_percent then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
        if (v #>> '{}')::integer < a.max_discount_percent then n_disc := (v #>> '{}')::integer; end if;
      when 'call_big_order_paise' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,12}$' or (v #>> '{}')::bigint not between 1 and 100000000000 then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
        if not v_has_a then return jsonb_build_object('ok', false, 'reason', 'not_saved', 'field', k); end if;
        if a.handover_order_above_paise is not null and (v #>> '{}')::bigint > a.handover_order_above_paise then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
        if a.handover_order_above_paise is null or (v #>> '{}')::bigint < a.handover_order_above_paise then n_big := (v #>> '{}')::bigint; v_big_set := true; end if;
      when 'call_hours' then
        if jsonb_typeof(v) <> 'object' or exists (select 1 from jsonb_object_keys(v) kk where kk not in ('days', 'from_minute', 'to_minute')) or (select count(*) from jsonb_object_keys(v)) = 0 then
          return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k);
        end if;
        if not v_has_a then return jsonb_build_object('ok', false, 'reason', 'not_saved', 'field', k); end if;
        if (v_hours ->> 'from') <> 'assistant' then return jsonb_build_object('ok', false, 'reason', 'limits_elsewhere', 'field', k); end if;
        if v ? 'days' then
          if jsonb_typeof(v -> 'days') <> 'array' or jsonb_array_length(v -> 'days') not between 1 and 7
             or exists (select 1 from jsonb_array_elements(v -> 'days') e where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[1-7]$') then
            return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k);
          end if;
          n_days := array(select distinct (e #>> '{}')::smallint from jsonb_array_elements(v -> 'days') e order by 1);
          if not (n_days <@ a.call_days) then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
          if n_days = (select array_agg(d order by d) from unnest(a.call_days) d) then n_days := null; end if;
        end if;
        if v ? 'from_minute' then
          if jsonb_typeof(v -> 'from_minute') <> 'number' or (v ->> 'from_minute') !~ '^[0-9]{3,4}$' or (v ->> 'from_minute')::integer not between 540 and 1260 or (v ->> 'from_minute')::integer % 15 <> 0 then
            return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k);
          end if;
          if (v ->> 'from_minute')::integer < a.call_from_minute then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
          if (v ->> 'from_minute')::integer > a.call_from_minute then n_from := (v ->> 'from_minute')::integer; end if;
        end if;
        if v ? 'to_minute' then
          if jsonb_typeof(v -> 'to_minute') <> 'number' or (v ->> 'to_minute') !~ '^[0-9]{3,4}$' or (v ->> 'to_minute')::integer not between 540 and 1260 or (v ->> 'to_minute')::integer % 15 <> 0 then
            return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k);
          end if;
          if (v ->> 'to_minute')::integer > a.call_to_minute then return jsonb_build_object('ok', false, 'reason', 'would_loosen', 'field', k); end if;
          if (v ->> 'to_minute')::integer < a.call_to_minute then n_to := (v ->> 'to_minute')::integer; end if;
        end if;
        if coalesce(n_from, a.call_from_minute) >= coalesce(n_to, a.call_to_minute) then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', k); end if;
      else
        return jsonb_build_object('ok', false, 'reason', 'unknown_field', 'field', left(k, 40));
    end case;
  end loop;

  -- every change is a tightening: apply them together
  if n_agents_off then
    update public.tenant_agent_settings set enabled = false, updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id;
  end if;
  v_o_changed := n_auto is not null or n_limit is not null or n_qs is not null or n_qe is not null;
  if v_o_changed then
    insert into public.outbox_settings (tenant_id, auto_send_enabled, per_customer_daily_limit, quiet_start_hour, quiet_end_hour, updated_by)
    values (p_tenant_id, coalesce(n_auto, o.auto_send_enabled), coalesce(n_limit, o.per_customer_daily_limit), coalesce(n_qs, o.quiet_start_hour), coalesce(n_qe, o.quiet_end_hour), v_uid)
    on conflict (tenant_id) do update
      set auto_send_enabled = excluded.auto_send_enabled, per_customer_daily_limit = excluded.per_customer_daily_limit,
          quiet_start_hour = excluded.quiet_start_hour, quiet_end_hour = excluded.quiet_end_hour, updated_by = v_uid, updated_at = now();
  end if;
  v_a_changed := n_prices is not null or n_visits is not null or n_media is not null or n_dues is not null or n_disc is not null or v_big_set or n_days is not null or n_from is not null or n_to is not null;
  if v_a_changed then
    perform set_config('app.assistant_edit', 'on', true);
    update public.assistant_settings s
       set may_answer_prices = coalesce(n_prices, s.may_answer_prices), may_book_visits = coalesce(n_visits, s.may_book_visits),
           may_send_media = coalesce(n_media, s.may_send_media), may_talk_dues = coalesce(n_dues, s.may_talk_dues),
           max_discount_percent = coalesce(n_disc, s.max_discount_percent),
           handover_order_above_paise = case when v_big_set then n_big else s.handover_order_above_paise end,
           call_days = coalesce(n_days, s.call_days), call_from_minute = coalesce(n_from, s.call_from_minute)::smallint, call_to_minute = coalesce(n_to, s.call_to_minute)::smallint,
           updated_by = v_uid, updated_at = now()
     where s.tenant_id = p_tenant_id;
    perform set_config('app.assistant_edit', '', true);
  end if;
  return jsonb_build_object('ok', true, 'limits', app.limits_json(p_tenant_id));
end;
$$;
revoke all on function public.limits_tighten(uuid, jsonb) from public, anon;
grant execute on function public.limits_tighten(uuid, jsonb) to authenticated;

-- Everything it did: calls, messages and assistant changes in one newest-first timeline (Owner, Admin), a page at a time. The next page is asked with the last item's `at` and `key`.
create function public.activity_log(p_tenant_id uuid, p_limit integer default 50, p_before_at timestamptz default null, p_before_key text default null, p_kind text default null) returns jsonb
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
  if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind not in ('call', 'message', 'action'))
     or ((p_before_at is null) <> (p_before_key is null)) or (p_before_key is not null and p_before_key !~ '^(call|message|action):[0-9a-f-]{36}$') then
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
      order by w.created_at desc, w.id desc limit p_limit + 1)),
  page as (select s.at, s.key, s.j, row_number() over (order by s.at desc, s.key desc) as rn from src s order by s.at desc, s.key desc limit p_limit + 1)
  select coalesce(jsonb_agg(p.j order by p.rn) filter (where p.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('before_at', q.at, 'before_key', q.key) from page q where q.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1))
    into v_items, v_next
    from page p;
  return jsonb_build_object('items', v_items, 'next', v_next);
end;
$$;
revoke all on function public.activity_log(uuid, integer, timestamptz, text, text) from public, anon;
grant execute on function public.activity_log(uuid, integer, timestamptz, text, text) to authenticated;
