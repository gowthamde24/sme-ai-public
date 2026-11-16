-- Speed-to-lead rules v2 (owner, 15 Nov 2026; docs/plans/speed-to-lead-rules-v2.md, slice R1).
--   1. WhatsApp from a standing rule is an APPROVED TEMPLATE chosen by name, never free text: `wa_first_template` (after hours, or when the first call could not start; default lead_ack) and
--      `wa_missed_template` (after the last unanswered call; default missed_call_followup). A rule with channel 'call' sends nothing, exactly as before (call first, 5 Nov 2026). `message_text` is no
--      longer accepted on a rule (old rows keep the column, unused). With no approved template in the lead's language the step is recorded as blocked and nothing is sent.
--   2. The retry ladder of a lead rule is a policy setting: `retry_steps`, default 10 minutes, then 2 hours, then the next morning at 09:30, always inside the calling hours; after the last unanswered call the
--      missed-call template, then stop (4 calls at most). Amends the 5 Nov "after the last unanswered call: stop, never an automatic WhatsApp" for rules that choose WhatsApp (channel 'both'). A "no" or STOP still stops at once.
--      Batches keep the call settings' retry rules.
--   3. Language `auto` on a rule: the lead's own language (the contact's preferred_language answer, else the script of the name), else the business's main language; resolved at call and message time.
--   4. The weekly cap of calls per customer no longer counts the calls of the SAME item (the ladder is the owner's own plan for one lead; the cap still protects against calls from other lists and rules).

-- ------------------------------------------------------------------------------------------------------------------------------
-- 1. columns
-- ------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select c.conname from pg_constraint c where c.conrelid = 'public.outreach_rules'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%language%' loop
    execute format('alter table public.outreach_rules drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.outreach_rules add constraint outreach_rules_language_check check (language in ('auto', 'en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr'));
alter table public.outreach_rules
  add column wa_first_template text check (wa_first_template is null or wa_first_template ~ '^[a-z0-9_]{1,64}$'),
  add column wa_missed_template text check (wa_missed_template is null or wa_missed_template ~ '^[a-z0-9_]{1,64}$');
comment on column public.outreach_rules.wa_first_template is 'SAFE: the NAME of an approved WhatsApp template (the first message). CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.outreach_rules.wa_missed_template is 'SAFE: the NAME of an approved WhatsApp template (after the last unanswered call). CLEAN-EXEMPT: strict pattern in a CHECK';

alter table public.outreach_attempts add column template text check (template is null or template ~ '^[a-z0-9_]{1,64}$');
comment on column public.outreach_attempts.template is 'SAFE: the NAME of the WhatsApp template a rule step used. CLEAN-EXEMPT: strict pattern in a CHECK';

create function app.outreach_ladder_ok(p jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 1 and 6
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where not coalesce(jsonb_typeof(e) = 'object' and (select count(*) from jsonb_object_keys(e)) = 1
          and (coalesce(jsonb_typeof(e -> 'after_minutes') = 'number' and (e ->> 'after_minutes') ~ '^[0-9]{1,4}$' and (e ->> 'after_minutes')::integer between 1 and 4320, false)
            or coalesce(jsonb_typeof(e -> 'next_morning_minute') = 'number' and (e ->> 'next_morning_minute') ~ '^[0-9]{1,4}$' and (e ->> 'next_morning_minute')::integer between 0 and 1439, false)), false))
$$;
revoke all on function app.outreach_ladder_ok(jsonb) from public;

alter table public.outreach_policy
  add column retry_steps jsonb not null default '[{"after_minutes": 10}, {"after_minutes": 120}, {"next_morning_minute": 570}]'::jsonb check (app.outreach_ladder_ok(retry_steps));
comment on column public.outreach_policy.retry_steps is 'SAFE: the retry steps of a lead rule (after n minutes, or the next morning at a minute of the day). CLEAN-EXEMPT: numbers only, checked by app.outreach_ladder_ok';

-- ------------------------------------------------------------------------------------------------------------------------------
-- 2. the policy: retry_steps
-- ------------------------------------------------------------------------------------------------------------------------------
create or replace function app.outreach_pol(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'night_call_minute', coalesce(p.night_call_minute, 570), 'max_attempts', coalesce(p.max_attempts, 3), 'retry_gap_hours', coalesce(p.retry_gap_hours, 18),
    'then_whatsapp', coalesce(p.then_whatsapp, true), 'whatsapp_after_hours', coalesce(p.whatsapp_after_hours, true),
    'handoff_reminder_minutes', coalesce(p.handoff_reminder_minutes, 15), 'call_paise_per_minute', coalesce(p.call_paise_per_minute, 400),
    'retry_steps', coalesce(p.retry_steps, '[{"after_minutes": 10}, {"after_minutes": 120}, {"next_morning_minute": 570}]'::jsonb))
  from (select 1) x left join public.outreach_policy p on p.tenant_id = p_tenant
$$;

create or replace function public.outreach_policy_set(p_tenant_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  perform app.require_aal2();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform app.outreach_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_settings) loop
    if k not in ('night_call_minute', 'max_attempts', 'retry_gap_hours', 'then_whatsapp', 'whatsapp_after_hours', 'handoff_reminder_minutes', 'call_paise_per_minute', 'retry_steps') then
      perform app.outreach_error('invalid');
    end if;
  end loop;
  insert into public.outreach_policy as p (tenant_id, night_call_minute, max_attempts, retry_gap_hours, then_whatsapp, whatsapp_after_hours, handoff_reminder_minutes, call_paise_per_minute, retry_steps, updated_by)
  select p_tenant_id, (d ->> 'night_call_minute')::smallint, (d ->> 'max_attempts')::smallint, (d ->> 'retry_gap_hours')::smallint, (d ->> 'then_whatsapp')::boolean,
         (d ->> 'whatsapp_after_hours')::boolean, (d ->> 'handoff_reminder_minutes')::smallint, (d ->> 'call_paise_per_minute')::integer, d -> 'retry_steps', v_uid
    from (select app.outreach_pol(p_tenant_id) || p_settings as d) x
  on conflict (tenant_id) do update set night_call_minute = excluded.night_call_minute, max_attempts = excluded.max_attempts, retry_gap_hours = excluded.retry_gap_hours,
    then_whatsapp = excluded.then_whatsapp, whatsapp_after_hours = excluded.whatsapp_after_hours, handoff_reminder_minutes = excluded.handoff_reminder_minutes,
    call_paise_per_minute = excluded.call_paise_per_minute, retry_steps = excluded.retry_steps, updated_by = excluded.updated_by, updated_at = app.outbox_now();
  return public.outreach_policy_get(p_tenant_id);
exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
  perform app.outreach_error('invalid');
  return null;
end;
$$;

-- the due time of the next call of the ladder after `p_calls` calls (1 = after the first call), moved into the calling hours; null = the ladder is used up
create function app.outreach_ladder_next(p_tenant uuid, p_steps jsonb, p_calls integer, p_now timestamptz) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_calls is null or p_calls < 1 or p_calls > jsonb_array_length(p_steps) then null
    when (p_steps -> (p_calls - 1)) ? 'after_minutes' then app.outreach_slot(p_tenant, p_now + make_interval(mins => (p_steps -> (p_calls - 1) ->> 'after_minutes')::integer))
    else app.outreach_slot(p_tenant, app.outreach_next_clock(p_now, (p_steps -> (p_calls - 1) ->> 'next_morning_minute')::integer))
  end
$$;
revoke all on function app.outreach_ladder_next(uuid, jsonb, integer, timestamptz) from public;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 3. language `auto`: the lead's own, else the business's main language
-- ------------------------------------------------------------------------------------------------------------------------------
create function app.outreach_lang(p_tenant uuid, p_contact uuid, p_lang text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pick text;
  v_name text;
begin
  if p_lang is distinct from 'auto' then
    return p_lang;
  end if;
  select coalesce(cv.value_choices[1], cv.value_text) into v_pick
    from public.custom_field_values cv join public.custom_field_defs d on d.tenant_id = cv.tenant_id and d.id = cv.field_id
   where cv.tenant_id = p_tenant and cv.contact_id = p_contact and d.entity = 'contact' and d.code = 'preferred_language' limit 1;
  if v_pick is null or v_pick not in ('en', 'te', 'hi', 'kn', 'ta') then
    select c.full_name into v_name from public.contacts c where c.tenant_id = p_tenant and c.id = p_contact;
    v_pick := case when v_name ~ '[ఀ-౿]' then 'te' when v_name ~ '[ಀ-೿]' then 'kn' when v_name ~ '[ऀ-ॿ]' then 'hi' when v_name ~ '[஀-௿]' then 'ta' end;
  end if;
  if v_pick is null then
    select s.main_language into v_pick from public.assistant_settings s where s.tenant_id = p_tenant;
  end if;
  return case when v_pick in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr') then v_pick else 'en' end;
end;
$$;
revoke all on function app.outreach_lang(uuid, uuid, text) from public;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 4. the owner of an item: a rule carries template NAMES and never message text
-- ------------------------------------------------------------------------------------------------------------------------------
create or replace function app.outreach_owner(i public.outreach_items) returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when i.batch_id is not null
    then (select jsonb_build_object('kind', 'batch', 'id', b.id, 'active', b.status = 'running', 'channel', b.channel, 'language', b.language, 'goal', b.goal, 'questions', b.questions,
             'message_text', b.message_text, 'max_calls_per_day', b.max_calls_per_day, 'max_total_minutes', b.max_total_minutes, 'approved_by', b.approved_by)
            from public.outreach_batches b where b.tenant_id = i.tenant_id and b.id = i.batch_id)
    else (select jsonb_build_object('kind', 'rule', 'id', r.id, 'active', r.active, 'channel', r.channel, 'language', r.language, 'goal', r.goal, 'questions', r.questions,
             'message_text', null, 'wa_first_template', r.wa_first_template, 'wa_missed_template', r.wa_missed_template,
             'max_calls_per_day', r.max_calls_per_day, 'max_total_minutes', r.max_total_minutes, 'approved_by', r.approved_by)
            from public.outreach_rules r where r.tenant_id = i.tenant_id and r.id = i.rule_id) end
$$;

-- the template NAME a rule item sends for a moment ('first' | 'missed'), or null when the rule sends no WhatsApp (channel call)
create function app.outreach_wa_template(p_owner jsonb, p_moment text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_owner ->> 'kind' = 'rule' and p_owner ->> 'channel' in ('both', 'whatsapp')
              then coalesce(case p_moment when 'first' then p_owner ->> 'wa_first_template' else p_owner ->> 'wa_missed_template' end,
                            case p_moment when 'first' then 'lead_ack' else 'missed_call_followup' end) end
$$;
revoke all on function app.outreach_wa_template(jsonb, text) from public;

-- the words of a template for one person (its own text with the first name and the business name filled in) and its status; no row = null, null
create function app.outreach_wa_text(p_tenant uuid, p_name text, p_lang text, p_contact uuid, out body text, out status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t integrations.wa_templates;
begin
  select * into t from integrations.wa_templates x where x.tenant_id = p_tenant and x.name = p_name and x.language = p_lang;
  if not found then
    return;
  end if;
  status := t.status;
  body := replace(replace(t.body, '{{1}}', app.wa_first_name(p_contact, p_lang)), '{{2}}', (select tn.name from public.tenants tn where tn.id = p_tenant));
end;
$$;
revoke all on function app.outreach_wa_text(uuid, text, text, uuid) from public;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 5. a rule as the API shows it: the template names and its warnings
-- ------------------------------------------------------------------------------------------------------------------------------
create function app.outreach_rule_warnings(r public.outreach_rules) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.channel in ('both', 'whatsapp') and exists (
      select 1 from (values (coalesce(r.wa_first_template, 'lead_ack')), (coalesce(r.wa_missed_template, 'missed_call_followup'))) n (name)
       where not exists (select 1 from integrations.wa_templates w
                          where w.tenant_id = r.tenant_id and w.name = n.name and w.status = 'approved'
                            and w.language = case when r.language = 'auto' then coalesce((select s.main_language from public.assistant_settings s where s.tenant_id = r.tenant_id), 'en') else r.language end))
    then '["template_not_approved"]'::jsonb else '[]'::jsonb end
$$;
revoke all on function app.outreach_rule_warnings(public.outreach_rules) from public;

create or replace function app.outreach_rule_json(r public.outreach_rules) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'source', r.source, 'action', r.action, 'within_minutes', r.within_minutes, 'goal', r.goal, 'channel', r.channel, 'language', r.language,
    'questions', r.questions, 'wa_first_template', r.wa_first_template, 'wa_missed_template', r.wa_missed_template, 'warnings', app.outreach_rule_warnings(r),
    'max_calls_per_day', r.max_calls_per_day, 'max_total_minutes', r.max_total_minutes,
    'active', r.active, 'paused_reason', r.paused_reason, 'paused_at', r.paused_at, 'approved_at', r.approved_at,
    'usage', jsonb_build_object(
      'leads', (select count(*) from public.outreach_items i where i.tenant_id = r.tenant_id and i.rule_id = r.id and i.status <> 'skipped'),
      'calls_today', (select count(*) from public.outreach_attempts a join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id
                       where i.tenant_id = r.tenant_id and i.rule_id = r.id and a.channel = 'call' and (a.at at time zone 'Asia/Kolkata')::date = (app.outbox_now() at time zone 'Asia/Kolkata')::date),
      'minutes_used', (select coalesce(sum(a.minutes), 0) from public.outreach_attempts a join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id where i.tenant_id = r.tenant_id and i.rule_id = r.id)))
$$;

-- the workspace's WhatsApp templates by name, for the rule form's pickers (name, language, status only)
create function public.outreach_rule_templates(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  return jsonb_build_object(
    'main_language', coalesce((select s.main_language from public.assistant_settings s where s.tenant_id = p_tenant_id), 'en'),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('name', w.name, 'language', w.language, 'status', w.status) order by w.name, w.language)
                             from integrations.wa_templates w where w.tenant_id = p_tenant_id and w.name in ('lead_ack', 'missed_call_followup')), '[]'::jsonb));
end;
$$;
revoke all on function public.outreach_rule_templates(uuid) from public, anon;
grant execute on function public.outreach_rule_templates(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 6. saving a rule: template names, language auto, no message text
-- ------------------------------------------------------------------------------------------------------------------------------
create or replace function public.outreach_rule_save(p_tenant_id uuid, p_doc jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := app.outbox_now();
  v_id      uuid;
  v_source  text := lower(btrim(coalesce(p_doc ->> 'source', '')));
  v_action  text := p_doc ->> 'action';
  v_within  integer := coalesce((p_doc ->> 'within_minutes')::integer, 2);
  v_goal    text := p_doc ->> 'goal';
  v_channel text := p_doc ->> 'channel';
  v_lang    text := p_doc ->> 'language';
  v_q       jsonb := coalesce(p_doc -> 'questions', '[]'::jsonb);
  v_first   text := nullif(btrim(coalesce(p_doc ->> 'wa_first_template', '')), '');
  v_missed  text := nullif(btrim(coalesce(p_doc ->> 'wa_missed_template', '')), '');
  v_calls   integer := (p_doc ->> 'max_calls_per_day')::integer;
  v_mins    integer := (p_doc ->> 'max_total_minutes')::integer;
  r         public.outreach_rules;
  q         jsonb;
  k         text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  perform app.require_aal2();
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    perform app.outreach_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_doc) loop
    if k not in ('rule_id', 'source', 'action', 'within_minutes', 'goal', 'channel', 'language', 'questions', 'wa_first_template', 'wa_missed_template', 'max_calls_per_day', 'max_total_minutes') then
      perform app.outreach_error('invalid');   -- message_text is gone: WhatsApp is a template picked by name
    end if;
  end loop;
  v_id := (p_doc ->> 'rule_id')::uuid;
  if v_id is null or v_source !~ '^[a-z0-9_.-]{1,64}$' or v_action is null or v_action not in ('call_within_minutes', 'whatsapp_first', 'whatsapp_then_call') or v_within not between 0 and 120
     or v_goal is null or v_goal not in ('site_visit', 'counselling', 'appointment', 'qualify', 'test_drive', 'site_measurement', 'quote', 'trial', 'callback', 'general')
     or v_channel is null or v_channel not in ('call', 'whatsapp', 'both') or v_lang is null or v_lang not in ('auto', 'en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr')
     or jsonb_typeof(v_q) <> 'array' or jsonb_array_length(v_q) > 8
     or (v_first is not null and v_first !~ '^[a-z0-9_]{1,64}$') or (v_missed is not null and v_missed !~ '^[a-z0-9_]{1,64}$')
     or (v_calls is not null and v_calls not between 1 and 5000) or (v_mins is not null and v_mins not between 1 and 100000)
     or (v_action in ('whatsapp_first', 'whatsapp_then_call') and v_channel = 'call') then
    perform app.outreach_error('invalid');
  end if;
  if app.task_is_school(p_tenant_id) and 'money' = any (app.outbox_content_flags(v_q::text)) then
    perform app.outreach_error('schools');
  end if;
  for q in select * from jsonb_array_elements(v_q) loop
    if jsonb_typeof(q) <> 'string' or char_length(q #>> '{}') not between 2 and 160 or not app.text_is_clean(q #>> '{}') then
      perform app.outreach_error('invalid');
    end if;
  end loop;
  if exists (select 1 from packs.workspace_pack w where w.tenant_id = p_tenant_id and w.pack_code = 'education') and v_goal not in ('counselling', 'site_visit', 'callback') then
    perform app.outreach_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('outreach_rule:' || p_tenant_id::text, 0));
  select * into r from public.outreach_rules x where x.id = v_id;
  if found then
    if r.tenant_id <> p_tenant_id then
      perform app.outreach_error('reference');
    end if;
    update public.outreach_rules set source = v_source, action = v_action, within_minutes = v_within, goal = v_goal, channel = v_channel, language = v_lang, questions = v_q, message_text = null,
           wa_first_template = v_first, wa_missed_template = v_missed,
           max_calls_per_day = v_calls, max_total_minutes = v_mins, approved_by = v_uid, approved_at = v_now where id = v_id returning * into r;
  else
    insert into public.outreach_rules (id, tenant_id, source, action, within_minutes, goal, channel, language, questions, wa_first_template, wa_missed_template, max_calls_per_day, max_total_minutes, approved_by, approved_at, last_scan_at)
    values (v_id, p_tenant_id, v_source, v_action, v_within, v_goal, v_channel, v_lang, v_q, v_first, v_missed, v_calls, v_mins, v_uid, v_now, v_now) returning * into r;
  end if;
  return app.outreach_rule_json(r);
exception when unique_violation then
  perform app.outreach_error('state');   -- one active rule per source
  return null;
when invalid_text_representation then
  perform app.outreach_error('invalid');
  return null;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 7. the first step of a rule: after hours, a rule that sends WhatsApp thanks the lead now (first template) and calls in the morning
-- ------------------------------------------------------------------------------------------------------------------------------
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
  elsif r.channel in ('both', 'whatsapp') and (v_pol ->> 'whatsapp_after_hours')::boolean then
    next_action := 'whatsapp'; next_at := p_t0;
    then_action := 'call'; then_at := app.outreach_slot(r.tenant_id, app.outreach_next_clock(p_t0, (v_pol ->> 'night_call_minute')::integer));
  else
    next_action := 'call'; next_at := app.outreach_slot(r.tenant_id, app.outreach_next_clock(p_t0, (v_pol ->> 'night_call_minute')::integer));
  end if;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 8. one pass of the dialer's work: a rule's WhatsApp step sends its TEMPLATE (never free text); a call item names the resolved language
-- ------------------------------------------------------------------------------------------------------------------------------
create or replace function public.scheduler_outreach_run(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := app.outbox_now();
  v_today0  timestamptz := date_trunc('day', app.outbox_now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  i         public.outreach_items;
  c         public.contacts;
  o         jsonb;
  u         jsonb;
  v_skip    text;
  v_work    jsonb := '[]'::jsonb;
  v_sent    integer := 0;
  v_paused  integer := 0;
  v_weekly  integer;
  v_week_cap integer;
  v_msg     text;
  v_res     jsonb;
  v_result  text;
  v_mid     uuid;
  v_lang    text;
  v_moment  text;
  v_tpl     text;
  v_tbody   text;
  v_tstatus text;
begin
  if not app.is_scheduler() then
    perform app.outreach_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.outreach_error('invalid');
  end if;
  -- a day's call cap lifts in the morning; the total-minutes cap stays until the Owner raises it
  update public.outreach_batches set status = 'running', paused_reason = null, paused_at = null where status = 'paused' and paused_reason = 'cap_calls' and paused_at < v_today0;
  update public.outreach_rules set active = true, paused_reason = null, paused_at = null where not active and paused_reason = 'cap_calls' and paused_at < v_today0;
  update public.outreach_items q set status = 'waiting' where q.status = 'waiting_for_minutes' and not app.billing_stopped(q.tenant_id, 'call_minutes');
  for i in select * from public.outreach_items x where x.status = 'waiting' and x.next_at <= v_now order by x.next_at, x.id limit p_limit for update skip locked loop
    o := app.outreach_owner(i);
    if o is null or not (o ->> 'active')::boolean or app.billing_read_only(i.tenant_id) then
      continue;
    end if;
    select * into c from public.contacts x where x.tenant_id = i.tenant_id and x.id = i.contact_id;
    v_skip := app.outreach_skip(c, case when i.next_action = 'call' then 'call' else 'whatsapp' end);
    -- a rule's WhatsApp step for someone without WhatsApp consent is passed over (recorded as blocked below), not the end of the lead: the next call still happens
    if v_skip is not null and not (i.next_action = 'whatsapp' and o ->> 'kind' = 'rule' and v_skip = 'no_consent') then
      perform app.outreach_stop(i.id, v_skip);
      continue;
    end if;
    if i.next_action = 'call' then
      if not app.outreach_in_hours(i.tenant_id, v_now) then
        update public.outreach_items set next_at = app.outreach_slot(i.tenant_id, v_now) where id = i.id;
        continue;
      end if;
      u := app.outreach_usage(i);
      if (o ->> 'max_total_minutes') is not null and (u ->> 'minutes_total')::numeric >= (o ->> 'max_total_minutes')::numeric then
        perform app.outreach_pause(o, 'cap_minutes'); v_paused := v_paused + 1; continue;
      end if;
      if (o ->> 'max_calls_per_day') is not null and (u ->> 'calls_today')::integer >= (o ->> 'max_calls_per_day')::integer then
        perform app.outreach_pause(o, 'cap_calls'); v_paused := v_paused + 1; continue;
      end if;
      v_week_cap := coalesce((select (s.settings ->> 'max_calls_per_customer_per_week')::integer from public.call_settings s where s.tenant_id = i.tenant_id and s.campaign_id is null), 2);
      -- the calls of THIS item are the owner's own ladder; the weekly cap counts the calls of every other list and rule
      select count(*) into v_weekly from public.outreach_attempts a join public.outreach_items j on j.tenant_id = a.tenant_id and j.id = a.item_id
       where j.tenant_id = i.tenant_id and j.contact_id = i.contact_id and j.id <> i.id and a.channel = 'call' and a.at > v_now - interval '7 days';
      if v_weekly >= v_week_cap then
        update public.outreach_items set next_at = app.outreach_slot(i.tenant_id, v_now + interval '1 day') where id = i.id;
        continue;
      end if;
      if app.billing_stopped(i.tenant_id, 'call_minutes') then
        update public.outreach_items set status = 'waiting_for_minutes' where id = i.id;   -- queued, not lost: it becomes waiting again on a top-up, an upgrade or the next period
        continue;
      end if;
      update public.outreach_items set next_at = v_now + interval '10 minutes' where id = i.id;   -- claimed: a crashed worker does not dial twice at once
      v_work := v_work || jsonb_build_array(jsonb_build_object(
        'item_id', i.id, 'tenant_id', i.tenant_id, 'contact_id', i.contact_id, 'lead_id', i.lead_id, 'name', c.full_name, 'phone', c.phone,
        'language', app.outreach_lang(i.tenant_id, i.contact_id, o ->> 'language'), 'goal', o ->> 'goal',
        'questions', o -> 'questions', 'attempt', app.outreach_attempt_n(i.id), 'owner_kind', o ->> 'kind', 'owner_id', o ->> 'id'));
    elsif o ->> 'kind' = 'rule' then
      -- a standing rule's WhatsApp step: an approved TEMPLATE by name in the lead's language; the first one, or the one after the last unanswered call
      v_moment := case when exists (select 1 from public.outreach_attempts a where a.item_id = i.id and a.channel = 'call' and a.result in ('no_answer', 'busy', 'voicemail')) then 'missed' else 'first' end;
      v_tpl := app.outreach_wa_template(o, v_moment);
      if i.lead_id is null or v_tpl is null then
        perform app.outreach_stop(i.id, 'no_channel');
        continue;
      end if;
      v_lang := app.outreach_lang(i.tenant_id, i.contact_id, o ->> 'language');
      select t.body, t.status into v_tbody, v_tstatus from app.outreach_wa_text(i.tenant_id, v_tpl, v_lang, i.contact_id) t;
      v_mid := md5('outreach:' || i.id::text || ':' || app.outreach_attempt_n(i.id)::text)::uuid;
      if v_skip is not null or v_tstatus is distinct from 'approved' then
        v_result := 'blocked';   -- no WhatsApp consent, or no approved template in this language: nothing is sent, and it is written down
        v_mid := null;
      else
        v_res := app.campaign_submit((o ->> 'approved_by')::uuid, v_mid, i.tenant_id, i.lead_id, v_tbody, v_lang);
        v_result := case when v_res ->> 'status' = 'blocked' then 'blocked' else 'sent' end;
        v_sent := v_sent + 1;
      end if;
      insert into public.outreach_attempts (tenant_id, item_id, n, channel, at, result, message_id, template)
      values (i.tenant_id, i.id, app.outreach_attempt_n(i.id), 'whatsapp', v_now, v_result, v_mid, v_tpl);
      if i.then_action is not null then
        update public.outreach_items set next_action = then_action, next_at = coalesce(then_at, v_now), then_action = null, then_at = null, first_touch_at = coalesce(first_touch_at, v_now), last_result = v_result where id = i.id;
      else
        update public.outreach_items set status = 'done', reason = null, next_action = null, next_at = null, first_touch_at = coalesce(first_touch_at, v_now), last_result = v_result where id = i.id;
      end if;
    else
      if i.lead_id is null or (o ->> 'message_text') is null then
        perform app.outreach_stop(i.id, 'no_channel');
        continue;
      end if;
      v_msg := replace(o ->> 'message_text', '{name}', left(split_part(btrim(c.full_name), ' ', 1), 30));
      v_mid := md5('outreach:' || i.id::text || ':' || app.outreach_attempt_n(i.id)::text)::uuid;
      v_res := app.campaign_submit((o ->> 'approved_by')::uuid, v_mid, i.tenant_id, i.lead_id, v_msg, o ->> 'language');
      v_result := case when v_res ->> 'status' = 'blocked' then 'blocked' else 'sent' end;
      insert into public.outreach_attempts (tenant_id, item_id, n, channel, at, result, message_id) values (i.tenant_id, i.id, app.outreach_attempt_n(i.id), 'whatsapp', v_now, v_result, v_mid);
      v_sent := v_sent + 1;
      if i.then_action is not null then
        update public.outreach_items set next_action = then_action, next_at = coalesce(then_at, v_now), then_action = null, then_at = null, first_touch_at = coalesce(first_touch_at, v_now), last_result = v_result where id = i.id;
      else
        update public.outreach_items set status = 'done', reason = null, next_action = null, next_at = null, first_touch_at = coalesce(first_touch_at, v_now), last_result = v_result where id = i.id;
      end if;
    end if;
  end loop;
  return jsonb_build_object('calls', v_work, 'whatsapp', v_sent, 'paused', v_paused);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 9. what happened on one call: a rule's lead follows the owner's ladder; the missed-call template after the last unanswered call
-- ------------------------------------------------------------------------------------------------------------------------------
create or replace function public.outreach_item_result(p_tenant_id uuid, p_item_id uuid, p_result text, p_outcome jsonb default null, p_minutes numeric default 0, p_stop boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := app.outbox_now();
  v_ai      boolean := app.is_scheduler();
  i         public.outreach_items;
  o         jsonb;
  v_pol     jsonb;
  v_att     uuid;
  v_n       smallint;
  v_out     uuid;
  v_cat     text;
  v_oc      text;
  v_cb      timestamptz;
  v_capt    jsonb;
  v_reason  text;
  v_next    timestamptz;
  v_wa_done boolean;
  v_wa      text;          -- the customer on the call: 'asked' for something on WhatsApp, or 'agreed' to WhatsApp (captured.whatsapp); else null
  v_retry   jsonb;
  v_calls   integer;
begin
  if v_uid is null or p_tenant_id is null or (not v_ai and not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[])) then
    perform app.outreach_error('deny');
  end if;
  if p_result is null or p_result not in ('no_answer', 'busy', 'voicemail', 'connected', 'failed') or p_minutes is null or p_minutes < 0 or p_minutes > 120 or p_stop is null then
    perform app.outreach_error('invalid');
  end if;
  select * into i from public.outreach_items x where x.tenant_id = p_tenant_id and x.id = p_item_id for update;
  if not found then
    perform app.outreach_error('reference');
  end if;
  if i.status <> 'waiting' or i.next_action <> 'call' then
    perform app.outreach_error('state');
  end if;
  o := app.outreach_owner(i);
  v_pol := app.outreach_pol(p_tenant_id);
  v_n := app.outreach_attempt_n(i.id);
  insert into public.outreach_attempts (tenant_id, item_id, n, channel, at, result, minutes) values (p_tenant_id, i.id, v_n, 'call', v_now, p_result, case when p_result = 'connected' then p_minutes else 0 end) returning id into v_att;
  if p_result = 'connected' and p_minutes > 0 then
    perform app.billing_record(p_tenant_id, 'call_minutes', v_att, greatest(1, ceil(p_minutes * 60)::integer));
  end if;
  update public.outreach_items set attempts = attempts + 1, first_touch_at = coalesce(first_touch_at, v_now), last_result = p_result where id = i.id returning * into i;
  if p_stop then
    perform app.wa_suppress_contact(p_tenant_id, i.contact_id, 'opted_out', 'call:' || replace(v_att::text, '-', ''), v_uid);
    perform app.outreach_stop(i.id, 'stopped');
    return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'stopped');
  end if;
  if p_result = 'connected' and p_outcome is not null then
    v_oc := p_outcome ->> 'outcome'; v_cat := p_outcome ->> 'category'; v_cb := (p_outcome ->> 'callback_at')::timestamptz; v_capt := p_outcome -> 'captured';
    v_wa := case when v_capt ->> 'whatsapp' in ('asked', 'agreed') then v_capt ->> 'whatsapp' end;
    if v_oc is null or v_oc not in ('positive', 'negative', 'unclear')
       or (v_cat is not null and v_cat not in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'too_costly', 'already_bought', 'call_back_later'))
       or not app.outreach_captured_ok(v_capt) or (v_cb is not null and (v_cb < v_now - interval '5 minutes' or v_cb > v_now + interval '30 days'))
       or (p_outcome ->> 'reason' is not null and (char_length(btrim(p_outcome ->> 'reason')) not between 2 and 200 or not app.text_is_clean(p_outcome ->> 'reason')))
       or not coalesce((v_oc = 'positive' and v_cat in ('interested', 'visit_booked', 'order_likely'))
                    or (v_oc = 'negative' and v_cat in ('not_interested', 'wrong_number', 'too_costly', 'already_bought'))
                    or (v_oc = 'unclear' and (v_cat is null or v_cat = 'call_back_later')), false) then
      perform app.outreach_error('invalid');
    end if;
    v_reason := app.outcome_reason(p_tenant_id, p_outcome ->> 'reason');
    insert into public.outcomes (tenant_id, contact_id, lead_id, kind, source_id, outcome, category, reason, recorded_by_kind, recorded_by, ai_outcome, ai_category, occurred_at, recorded_at)
    values (p_tenant_id, i.contact_id, i.lead_id, 'call', v_att, v_oc, v_cat, v_reason, case when v_ai then 'ai' else 'person' end, v_uid,
            case when v_ai then v_oc end, case when v_ai then v_cat end, v_now, v_now) returning id into v_out;
    if v_cb is not null or (v_capt is not null and v_capt <> '{}'::jsonb) then
      insert into public.outcome_details (outcome_id, tenant_id, callback_at, captured) values (v_out, p_tenant_id, v_cb, nullif(v_capt, '{}'::jsonb));
    end if;
    if v_cat in ('interested', 'visit_booked', 'order_likely') then
      perform app.outreach_handoff(p_tenant_id, i, v_out, v_cat, v_capt, o ->> 'goal');
      if v_wa is not null and (o ->> 'message_text') is not null and i.lead_id is not null then
        update public.outreach_items set next_action = 'whatsapp', next_at = v_now, then_action = null, then_at = null where id = i.id;
        return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', v_now, 'whatsapp', v_wa);
      end if;
      perform app.outreach_stop(i.id, 'interested');
      return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'interested');
    elsif v_cat = 'call_back_later' then
      if i.callbacks >= (app.outreach_retry(p_tenant_id, 'retry_call_later') ->> 'count')::integer then
        perform app.outreach_stop(i.id, 'attempts_used');
        return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'attempts_used');
      end if;
      v_next := app.outreach_slot(p_tenant_id, coalesce(v_cb, v_now + make_interval(mins => (app.outreach_retry(p_tenant_id, 'retry_call_later') ->> 'gap_minutes')::integer)));
      if v_wa is not null and (o ->> 'message_text') is not null and i.lead_id is not null then
        update public.outreach_items set callbacks = callbacks + 1, next_action = 'whatsapp', next_at = v_now, then_action = 'call', then_at = v_next where id = i.id;
      else
        update public.outreach_items set callbacks = callbacks + 1, next_action = 'call', next_at = v_next, then_action = null, then_at = null where id = i.id;
      end if;
      return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', (select next_at from public.outreach_items where id = i.id));
    elsif v_cat in ('not_interested', 'too_costly') then
      perform app.outreach_stop(i.id, 'refused');
      return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'refused');
    elsif v_cat = 'wrong_number' then
      perform app.outreach_stop(i.id, 'wrong_number');
      return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'wrong_number');
    elsif v_cat = 'already_bought' then
      perform app.outreach_stop(i.id, 'already_bought');
      return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'already_bought');
    end if;
  end if;
  -- no answer, busy, voicemail, failed, or connected with nothing decided: the next attempt, or WhatsApp, or stop
  v_wa_done := exists (select 1 from public.outreach_attempts a where a.item_id = i.id and a.channel = 'whatsapp');
  if o ->> 'kind' = 'rule' then
    -- a standing rule's lead: the owner's ladder (policy retry_steps), then the missed-call template, then stop
    select count(*)::integer into v_calls from public.outreach_attempts a where a.item_id = i.id and a.channel = 'call';
    v_next := app.outreach_ladder_next(p_tenant_id, v_pol -> 'retry_steps', v_calls, v_now);
    if p_result = 'failed' and v_calls = 1 and not v_wa_done and app.outreach_wa_template(o, 'first') is not null and i.lead_id is not null then
      -- the first call could not even start: the first template now, then the ladder goes on
      update public.outreach_items set next_action = 'whatsapp', next_at = v_now, then_action = case when v_next is not null then 'call' end, then_at = v_next where id = i.id;
      return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', v_now, 'whatsapp', 'first');
    end if;
    if v_next is not null then
      update public.outreach_items set next_action = 'call', next_at = v_next, then_action = null, then_at = null where id = i.id;
      return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', v_next);
    end if;
    if (v_pol ->> 'then_whatsapp')::boolean and i.lead_id is not null and app.outreach_wa_template(o, 'missed') is not null
       and exists (select 1 from public.outreach_attempts a where a.item_id = i.id and a.channel = 'call' and a.result in ('no_answer', 'busy', 'voicemail'))
       and not exists (select 1 from public.outreach_attempts a where a.item_id = i.id and a.channel = 'whatsapp' and a.template = app.outreach_wa_template(o, 'missed')) then
      update public.outreach_items set next_action = 'whatsapp', next_at = v_now, then_action = null, then_at = null where id = i.id;
      return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', v_now, 'whatsapp', 'missed');
    end if;
    perform app.outreach_stop(i.id, 'attempts_used');
    return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'attempts_used');
  end if;
  if v_wa is not null and not v_wa_done and (o ->> 'message_text') is not null and i.lead_id is not null then
    update public.outreach_items set next_action = 'whatsapp', next_at = v_now, then_action = null, then_at = null where id = i.id;
    return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', v_now, 'whatsapp', v_wa);
  end if;
  v_retry := app.outreach_retry(p_tenant_id, case when p_result = 'busy' then 'retry_busy' else 'retry_no_answer' end);
  if (select count(*) from public.outreach_attempts a where a.item_id = i.id and a.channel = 'call' and ((p_result = 'busy') = (a.result = 'busy'))) <= (v_retry ->> 'count')::integer then
    v_next := app.outreach_slot(p_tenant_id, v_now + make_interval(mins => (v_retry ->> 'gap_minutes')::integer));
    update public.outreach_items set next_action = 'call', next_at = v_next, then_action = null, then_at = null where id = i.id;
    return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', v_next);
  end if;
  perform app.outreach_stop(i.id, 'attempts_used');
  return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'attempts_used');
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
  perform app.outreach_error('invalid');
  return null;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 10. the send path: a rule's message names its template (outreach_attempts.template); everything else is unchanged
-- ------------------------------------------------------------------------------------------------------------------------------
do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_old text := $q$      select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = 'lead' and x.language = m.language and x.status = 'approved' order by x.created_at, x.id limit 1;$q$;
  v_new text := $q$      -- a standing rule's message names its template (rules v2); any other outreach message takes the lead template as before
      select w.* into t from public.outreach_attempts oa join integrations.wa_templates w on w.tenant_id = oa.tenant_id and w.name = oa.template and w.language = m.language and w.status = 'approved'
       where oa.tenant_id = m.tenant_id and oa.message_id = m.id;
      if t.id is null and not exists (select 1 from public.outreach_attempts oa where oa.tenant_id = m.tenant_id and oa.message_id = m.id and oa.template is not null) then
        select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = 'lead' and x.language = m.language and x.status = 'approved' order by x.created_at, x.id limit 1;
      end if;$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'wa_send_context has changed: the rules-v2 template patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
