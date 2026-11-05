-- CALL FIRST (owner decision, 5 Nov 2026; job calls-like-a-pro part 1; docs/decisions/call-first-auto-send.md, ADR 0066 and 0108 amended):
--   a new lead is CALLED directly (within the rule's minutes, in calling hours; after hours the call is queued for the next morning, nothing is sent now). WhatsApp only when the customer asks for
--   something on WhatsApp on the call ("send photos", "send the quote", "message me") or can't talk now and agrees to WhatsApp: the call's captured field `whatsapp` = 'asked' | 'agreed'.
--   Retries follow the workspace's call settings (retry_busy, retry_no_answer, retry_call_later), or the pack's defaults (a school: fewer, wider apart). After the last unanswered call: stop, never
--   an automatic WhatsApp. Real calls stay OFF (sandbox and simulator only) until the lawyer review and registered numbers.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the retry rule of one kind: the workspace's call settings, else the pack's default (services/ai-api/app/callsettings/data/call_settings.json)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outreach_retry(p_tenant uuid, p_kind text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.settings -> p_kind from public.call_settings s
      where s.tenant_id = p_tenant and s.campaign_id is null and jsonb_typeof(s.settings -> p_kind) = 'object'),
    case when app.task_is_school(p_tenant) then
      case p_kind when 'retry_busy' then '{"count": 1, "gap_minutes": 60}' when 'retry_call_later' then '{"count": 1, "gap_minutes": 120}' else '{"count": 2, "gap_minutes": 180}' end
    else
      case p_kind when 'retry_busy' then '{"count": 2, "gap_minutes": 30}' when 'retry_call_later' then '{"count": 2, "gap_minutes": 60}' else '{"count": 3, "gap_minutes": 120}' end
    end::jsonb)
$$;
revoke all on function app.outreach_retry(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. a standing rule's first step: always a call (after hours: the next morning's call, nothing sent now)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.outreach_rule_step(r public.outreach_rules, p_t0 timestamptz, out next_action text, out next_at timestamptz, out then_action text, out then_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pol jsonb := app.outreach_pol(r.tenant_id);
  v_t   timestamptz := p_t0 + make_interval(mins => r.within_minutes);
begin
  if app.outreach_in_hours(r.tenant_id, v_t) then
    next_action := 'call'; next_at := v_t;
  else
    next_action := 'call'; next_at := app.outreach_slot(r.tenant_id, app.outreach_next_clock(p_t0, (v_pol ->> 'night_call_minute')::integer));
  end if;
end;
$$;
revoke all on function app.outreach_rule_step(public.outreach_rules, timestamptz) from public;

-- a batch's first step: `call` and `both` call first (WhatsApp only on the customer's request); `whatsapp` stays the Owner's own message campaign to a list (not a new lead)
create or replace function app.outreach_first_batch_step(p_tenant uuid, p_channel text, p_now timestamptz, out next_action text, out next_at timestamptz, out then_action text, out then_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_channel = 'whatsapp' then
    next_action := 'whatsapp'; next_at := p_now;
  else
    next_action := 'call'; next_at := app.outreach_slot(p_tenant, p_now);
  end if;
end;
$$;
revoke all on function app.outreach_first_batch_step(uuid, text, timestamptz) from public;

-- the WhatsApp-first rule kinds are gone: existing rules become "call within N minutes" (a message-only rule keeps its text, now sent only on the customer's request), new ones are refused
update public.outreach_rules set action = 'call_within_minutes' where action in ('whatsapp_first', 'whatsapp_then_call');
update public.outreach_rules set channel = 'both' where channel = 'whatsapp';

create function app.outreach_rules_call_first() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.action in ('whatsapp_first', 'whatsapp_then_call') or new.channel = 'whatsapp' then
    raise exception 'call first: a new lead is called; WhatsApp only on the customer''s request' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.outreach_rules_call_first() from public;
create trigger outreach_rules_call_first before insert or update on public.outreach_rules for each row execute function app.outreach_rules_call_first();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. a call's result: retries by kind; WhatsApp only when the customer asked or agreed (captured.whatsapp); never automatically after the last unanswered call
-- ---------------------------------------------------------------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.outreach_item_result(uuid, uuid, text, jsonb, numeric, boolean)'::regprocedure);
  v_new text := v_def;
  part  text[];
  parts text[][] := array[
    -- the new variables
    array['  v_wa_done boolean;
',
'  v_wa_done boolean;
  v_wa      text;          -- the customer on the call: ''asked'' for something on WhatsApp, or ''agreed'' to WhatsApp (captured.whatsapp); else null
  v_retry   jsonb;
'],
    -- read the customer''s WhatsApp request with the outcome
    array['v_capt := p_outcome -> ''captured'';
',
'v_capt := p_outcome -> ''captured'';
    v_wa := case when v_capt ->> ''whatsapp'' in (''asked'', ''agreed'') then v_capt ->> ''whatsapp'' end;
'],
    -- interested and asked for something on WhatsApp: the rule''s message goes now (a person is handed the lead as before)
    array['      perform app.outreach_handoff(p_tenant_id, i, v_out, v_cat, v_capt, o ->> ''goal'');
      perform app.outreach_stop(i.id, ''interested'');',
'      perform app.outreach_handoff(p_tenant_id, i, v_out, v_cat, v_capt, o ->> ''goal'');
      if v_wa is not null and (o ->> ''message_text'') is not null and i.lead_id is not null then
        update public.outreach_items set next_action = ''whatsapp'', next_at = v_now, then_action = null, then_at = null where id = i.id;
        return jsonb_build_object(''item_id'', i.id, ''status'', ''waiting'', ''next_at'', v_now, ''whatsapp'', v_wa);
      end if;
      perform app.outreach_stop(i.id, ''interested'');'],
    -- call me later: the call settings'' count and gap; agreed to WhatsApp: the message now, the call at the agreed time
    array['      if i.callbacks >= 3 then',
'      if i.callbacks >= (app.outreach_retry(p_tenant_id, ''retry_call_later'') ->> ''count'')::integer then'],
    array['      update public.outreach_items set callbacks = callbacks + 1, next_action = ''call'', next_at = app.outreach_slot(p_tenant_id, coalesce(v_cb, v_now + interval ''1 day'')), then_action = null, then_at = null where id = i.id;',
'      v_next := app.outreach_slot(p_tenant_id, coalesce(v_cb, v_now + make_interval(mins => (app.outreach_retry(p_tenant_id, ''retry_call_later'') ->> ''gap_minutes'')::integer)));
      if v_wa is not null and (o ->> ''message_text'') is not null and i.lead_id is not null then
        update public.outreach_items set callbacks = callbacks + 1, next_action = ''whatsapp'', next_at = v_now, then_action = ''call'', then_at = v_next where id = i.id;
      else
        update public.outreach_items set callbacks = callbacks + 1, next_action = ''call'', next_at = v_next, then_action = null, then_at = null where id = i.id;
      end if;'],
    -- no answer, busy, voicemail, failed: retries by kind (busy has its own count and gap); a connected call with nothing decided but a WhatsApp yes: the message, no more calls
    array['  if i.attempts < (v_pol ->> ''max_attempts'')::integer then
    v_next := app.outreach_slot(p_tenant_id, v_now + make_interval(hours => (v_pol ->> ''retry_gap_hours'')::integer));',
'  v_wa_done := exists (select 1 from public.outreach_attempts a where a.item_id = i.id and a.channel = ''whatsapp'');
  if v_wa is not null and not v_wa_done and (o ->> ''message_text'') is not null and i.lead_id is not null then
    update public.outreach_items set next_action = ''whatsapp'', next_at = v_now, then_action = null, then_at = null where id = i.id;
    return jsonb_build_object(''item_id'', i.id, ''status'', ''waiting'', ''next_at'', v_now, ''whatsapp'', v_wa);
  end if;
  v_retry := app.outreach_retry(p_tenant_id, case when p_result = ''busy'' then ''retry_busy'' else ''retry_no_answer'' end);
  if (select count(*) from public.outreach_attempts a where a.item_id = i.id and a.channel = ''call'' and ((p_result = ''busy'') = (a.result = ''busy''))) <= (v_retry ->> ''count'')::integer then
    v_next := app.outreach_slot(p_tenant_id, v_now + make_interval(mins => (v_retry ->> ''gap_minutes'')::integer));'],
    -- after the last unanswered call: stop (the automatic WhatsApp is gone)
    array['  v_wa_done := exists (select 1 from public.outreach_attempts a where a.item_id = i.id and a.channel = ''whatsapp'');
  if (v_pol ->> ''then_whatsapp'')::boolean and not v_wa_done and (o ->> ''channel'') in (''both'', ''whatsapp'') and (o ->> ''message_text'') is not null and i.lead_id is not null then
    update public.outreach_items set next_action = ''whatsapp'', next_at = v_now, then_action = null, then_at = null where id = i.id;
    return jsonb_build_object(''item_id'', i.id, ''status'', ''waiting'', ''next_at'', v_now);
  end if;
', '']
  ];
begin
  foreach part slice 1 in array parts loop
    if position(part[1] in v_new) = 0 then
      raise exception 'cf_call_first: outreach_item_result is not the one this migration expects (%)', left(part[1], 60);
    end if;
    v_new := replace(v_new, part[1], part[2]);
  end loop;
  execute v_new;
end
$do$;
