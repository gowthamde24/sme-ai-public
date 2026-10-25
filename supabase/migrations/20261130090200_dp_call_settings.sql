-- Job DP part 4 (night run 26 Oct 2026): CALL SETTINGS AS DATA.
--
--   How the assistant behaves on the phone, per workspace, with an override per campaign. Telephony does not exist yet: nothing here places a call. The settings are what a dialer will read.
--
--   public.call_settings          one row per workspace (campaign_id null) and one per campaign override (campaign_id set); the document is validated by the database, strictly
--   public.call_handover_rules    who takes over for which topic (a named person's phone): PII, so a table of its own, in the erasure registry
--   app.call_settings_validate    the one validator: every key, every type, every range, every list limit; unknown keys are refused
--   app.call_settings_locked      what a business type may not change (a school: no sales calls, none about dues or fees)
--   public.call_settings_get / _save                         the workspace's settings: Owner or Admin reads, the Owner (second factor) saves
--   public.call_settings_campaign_get / _save / _clear       one campaign's override (a partial document; null or absent = inherit)
--
--   Not overridable per campaign: holidays, handover and the allowed purposes (they belong to the business). Calling hours: `hours` null = the AI assistant's own days and hours (public.assistant_settings).
--   SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM306 second factor needed.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.call_settings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  campaign_id uuid,
  -- the validated document (without the handover rules, which hold phone numbers and live in their own table)
  settings    jsonb not null check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 20000),
  updated_by  uuid not null,
  updated_at  timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id)
);
create unique index call_settings_workspace_key on public.call_settings (tenant_id) where campaign_id is null;
create unique index call_settings_campaign_key on public.call_settings (tenant_id, campaign_id) where campaign_id is not null;
comment on table public.call_settings is 'Job DP part 4: how the assistant behaves on calls, per workspace and per campaign. Written only by the Owner''s functions; validated by app.call_settings_validate.';
comment on column public.call_settings.settings is 'SAFE: a document of numbers, switches, closed words, pronunciations of business names and key words; validated by app.call_settings_validate (clean text, limits). CLEAN-EXEMPT: validated document';

create table public.call_handover_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  topic       text not null check (topic in ('pricing', 'payment', 'delivery', 'complaint', 'visit', 'other')),
  person_name text not null check (char_length(person_name) between 1 and 40 and app.text_is_clean(person_name)),
  phone       text check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  updated_by  uuid not null,
  updated_at  timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  unique (tenant_id, topic)
);
comment on column public.call_handover_rules.topic is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.call_handover_rules.person_name is 'PII: the name of the person who takes over calls on this topic (a team member). Erased with the workspace.';
comment on column public.call_handover_rules.phone is 'PII: that person''s phone number. Erased with the workspace.';

do $$
declare
  t text;
begin
  foreach t in array array['call_settings', 'call_handover_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]))$p$, t || '_select', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
create trigger audit_call_settings after insert or update or delete on public.call_settings for each row execute function app.audit_row_change('call_settings', '');
create trigger audit_call_handover_rules after insert or update or delete on public.call_handover_rules for each row execute function app.audit_row_change('call_handover_rule', 'person_name,phone');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('call_handover_rules', 'person_name', 'tenant', 'tombstone', 'erased:1'),
  ('call_handover_rules', 'phone',       'tenant', 'null',      'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the validator
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.call_settings_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.call_settings_error(text) from public;

-- a whole number of the given range and step
create function app.cs_int(v jsonb, lo integer, hi integer, step integer) returns boolean
language sql
immutable
set search_path = ''
as $$ select jsonb_typeof(v) = 'number' and v::text ~ '^[0-9]{1,6}$' and (v::text)::integer between lo and hi and (v::text)::integer % step = 0 $$;
revoke all on function app.cs_int(jsonb, integer, integer, integer) from public;

create function app.cs_enum(v jsonb, p_allowed text[]) returns boolean
language sql
immutable
set search_path = ''
as $$ select jsonb_typeof(v) = 'string' and (v #>> '{}') = any (p_allowed) $$;
revoke all on function app.cs_enum(jsonb, text[]) from public;

-- text that is spoken or listened for: 1 to p_max characters, clean, and none of < > { } @ / \ | or a control character
create function app.cs_text(v jsonb, p_min integer, p_max integer) returns boolean
language sql
immutable
set search_path = ''
as $$ select jsonb_typeof(v) = 'string' and char_length(v #>> '{}') between p_min and p_max and (v #>> '{}') = btrim(v #>> '{}') and app.text_is_clean(v #>> '{}') and (v #>> '{}') !~ '[<>{}@/\\|[:cntrl:]]' $$;
revoke all on function app.cs_text(jsonb, integer, integer) from public;

create function app.cs_keys(v jsonb, p_keys text[]) returns boolean
language sql
immutable
set search_path = ''
as $$ select jsonb_typeof(v) = 'object' and coalesce((select array_agg(k order by k) from jsonb_object_keys(v) k), '{}'::text[]) = (select array_agg(k order by k) from unnest(p_keys) k) $$;
revoke all on function app.cs_keys(jsonb, text[]) from public;

create function app.cs_retry(v jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$ select app.cs_keys(v, array['count', 'gap_minutes']) and app.cs_int(v -> 'count', 0, 5, 1) and app.cs_int(v -> 'gap_minutes', 5, 1440, 5) $$;
revoke all on function app.cs_retry(jsonb) from public;

create function app.cs_hours(v jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select app.cs_keys(v, array['days', 'from_minute', 'to_minute'])
     and jsonb_typeof(v -> 'days') = 'array' and jsonb_array_length(v -> 'days') between 1 and 7
     and not exists (select 1 from jsonb_array_elements(v -> 'days') d where not app.cs_int(d, 1, 7, 1))
     and (select count(distinct d) from jsonb_array_elements(v -> 'days') d) = jsonb_array_length(v -> 'days')
     and app.cs_int(v -> 'from_minute', 540, 1260, 15) and app.cs_int(v -> 'to_minute', 540, 1260, 15)
     and (v ->> 'from_minute')::integer < (v ->> 'to_minute')::integer
$$;
revoke all on function app.cs_hours(jsonb) from public;

create function app.cs_pronunciations(v jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 50
     and not exists (select 1 from jsonb_array_elements(v) e where not (app.cs_keys(e, array['written', 'spoken']) and app.cs_text(e -> 'written', 1, 40) and app.cs_text(e -> 'spoken', 1, 60)))
     and (select count(distinct lower(e ->> 'written')) from jsonb_array_elements(v) e) = jsonb_array_length(v)
$$;
revoke all on function app.cs_pronunciations(jsonb) from public;

create function app.cs_keywords(v jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 100
     and not exists (select 1 from jsonb_array_elements(v) e where not app.cs_text(e, 2, 40))
     and (select count(distinct lower(e #>> '{}')) from jsonb_array_elements(v) e) = jsonb_array_length(v)
$$;
revoke all on function app.cs_keywords(jsonb) from public;

-- the keys of the workspace document and of a campaign's override
create function app.call_settings_validate(p jsonb, p_partial boolean) returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  c_full constant text[] := array['retry_busy', 'retry_no_answer', 'retry_call_later', 'concurrent_calls', 'detect_voicemail', 'voicemail_action', 'detect_phone_menu', 'phone_menu_action',
    'silence_timeout_seconds', 'max_call_seconds', 'interruption_sensitivity', 'listening_sounds', 'pronunciations', 'keywords', 'hours', 'holidays', 'max_calls_per_customer_per_week',
    'auto_pause_refusals_per_hour', 'contact_memory', 'handover', 'allowed_purposes'];
  c_part constant text[] := array['retry_busy', 'retry_no_answer', 'retry_call_later', 'concurrent_calls', 'detect_voicemail', 'voicemail_action', 'detect_phone_menu', 'phone_menu_action',
    'silence_timeout_seconds', 'max_call_seconds', 'interruption_sensitivity', 'listening_sounds', 'pronunciations', 'keywords', 'hours', 'max_calls_per_customer_per_week',
    'auto_pause_refusals_per_hour', 'auto_pause_off', 'contact_memory'];
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  k text;
  v jsonb;
  e jsonb;
  d date;
  n integer;
  v_ok boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    perform app.call_settings_error('invalid');
  end if;
  if p_partial then
    if exists (select 1 from jsonb_object_keys(p) x where x <> all (c_part)) then
      perform app.call_settings_error('invalid');
    end if;
  elsif not app.cs_keys(p, c_full) then
    perform app.call_settings_error('invalid');
  end if;
  for k, v in select * from jsonb_each(p) loop
    if jsonb_typeof(v) = 'null' then
      if p_partial or k in ('hours', 'auto_pause_refusals_per_hour') then
        continue;   -- inherit (a campaign), or "follow the AI assistant" / "never pause" (the workspace)
      end if;
      perform app.call_settings_error('invalid');
    end if;
    -- (a CASE expression cannot sit inside the IF itself: plpgsql would end the condition at the first THEN)
    v_ok := case k
      when 'retry_busy'                      then app.cs_retry(v)
      when 'retry_no_answer'                 then app.cs_retry(v)
      when 'retry_call_later'                then app.cs_retry(v)
      when 'concurrent_calls'                then app.cs_int(v, 1, 20, 1)
      when 'detect_voicemail'                then jsonb_typeof(v) = 'boolean'
      when 'detect_phone_menu'               then jsonb_typeof(v) = 'boolean'
      when 'listening_sounds'                then jsonb_typeof(v) = 'boolean'
      when 'contact_memory'                  then jsonb_typeof(v) = 'boolean'
      when 'auto_pause_off'                  then jsonb_typeof(v) = 'boolean'
      when 'voicemail_action'                then app.cs_enum(v, array['hang_up', 'leave_message', 'retry_later'])
      when 'phone_menu_action'               then app.cs_enum(v, array['hang_up', 'retry_later'])
      when 'interruption_sensitivity'        then app.cs_enum(v, array['low', 'medium', 'high'])
      when 'silence_timeout_seconds'         then app.cs_int(v, 3, 30, 1)
      when 'max_call_seconds'                then app.cs_int(v, 30, 1800, 30)
      when 'max_calls_per_customer_per_week' then app.cs_int(v, 1, 14, 1)
      when 'auto_pause_refusals_per_hour'    then app.cs_int(v, 3, 100, 1)
      when 'pronunciations'                  then app.cs_pronunciations(v)
      when 'keywords'                        then app.cs_keywords(v)
      when 'hours'                           then app.cs_hours(v)
      when 'holidays'                        then jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 60
      when 'handover'                        then jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 8
      when 'allowed_purposes'                then jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and 5
      else false end;
    if not coalesce(v_ok, false) then
      perform app.call_settings_error('invalid');
    end if;
  end loop;
  if p_partial and (p ->> 'auto_pause_off') = 'true' and jsonb_typeof(p -> 'auto_pause_refusals_per_hour') = 'number' then
    perform app.call_settings_error('invalid');   -- "off" and a number together
  end if;
  if not p_partial then
    -- holidays: real days, from yesterday to 400 days ahead, each once
    n := 0;
    for e in select * from jsonb_array_elements(p -> 'holidays') loop
      if jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        perform app.call_settings_error('invalid');
      end if;
      begin
        d := (e #>> '{}')::date;
      exception when others then
        perform app.call_settings_error('invalid');
      end;
      if to_char(d, 'YYYY-MM-DD') <> (e #>> '{}') or d < v_today - 1 or d > v_today + 400 then
        perform app.call_settings_error('invalid');
      end if;
      n := n + 1;
    end loop;
    if (select count(distinct x) from jsonb_array_elements_text(p -> 'holidays') x) <> n then
      perform app.call_settings_error('invalid');
    end if;
    -- handover: a topic goes to one person; a name and a number
    if exists (select 1 from jsonb_array_elements(p -> 'handover') h
                where not (app.cs_keys(h, array['topic', 'person_name', 'phone']) and app.cs_enum(h -> 'topic', array['pricing', 'payment', 'delivery', 'complaint', 'visit', 'other'])
                           and app.cs_text(h -> 'person_name', 1, 40) and jsonb_typeof(h -> 'phone') = 'string' and (h ->> 'phone') ~ '^\+?[0-9]{7,15}$'))
       or (select count(distinct h ->> 'topic') from jsonb_array_elements(p -> 'handover') h) <> jsonb_array_length(p -> 'handover') then
      perform app.call_settings_error('invalid');
    end if;
    -- purposes: closed words, each once
    if exists (select 1 from jsonb_array_elements(p -> 'allowed_purposes') a
                where not app.cs_enum(a, array['sales_followup', 'payment_reminder', 'admission_followup', 'visit_reminder', 'event_reminder']))
       or (select count(distinct a) from jsonb_array_elements(p -> 'allowed_purposes') a) <> jsonb_array_length(p -> 'allowed_purposes') then
      perform app.call_settings_error('invalid');
    end if;
  end if;
end;
$$;
revoke all on function app.call_settings_validate(jsonb, boolean) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. what a business type may not change
-- ---------------------------------------------------------------------------------------------------------------------------------
-- a school never makes sales calls and never calls about dues or fees (owner decision 25 Oct 2026): its purposes are held to admissions, visits and events
create function app.call_settings_locked(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from packs.workspace_pack w where w.tenant_id = p_tenant and w.pack_code = 'education')
              then jsonb_build_object('allowed_purposes', jsonb_build_array('admission_followup', 'visit_reminder', 'event_reminder'))
              else '{}'::jsonb end
$$;
revoke all on function app.call_settings_locked(uuid) from public, anon, authenticated, service_role;

-- the saved document with its handover rules put back in
create function app.call_settings_doc(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.settings || jsonb_build_object('handover', coalesce((select jsonb_agg(jsonb_build_object('topic', h.topic, 'person_name', h.person_name, 'phone', coalesce(h.phone, '')) order by h.topic)
                                                              from public.call_handover_rules h where h.tenant_id = p_tenant), '[]'::jsonb))
    from public.call_settings s where s.tenant_id = p_tenant and s.campaign_id is null
$$;
revoke all on function app.call_settings_doc(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the workspace's settings
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.call_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.call_settings;
  a public.assistant_settings;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.call_settings_error('deny');
  end if;
  select * into s from public.call_settings x where x.tenant_id = p_tenant_id and x.campaign_id is null;
  select * into a from public.assistant_settings x where x.tenant_id = p_tenant_id;
  return jsonb_build_object(
    'saved', s.id is not null,
    'settings', case when s.id is not null then app.call_settings_doc(p_tenant_id) else null end,
    'updated_at', s.updated_at,
    'business_type', coalesce((select w.pack_code from packs.workspace_pack w where w.tenant_id = p_tenant_id), 'textiles'),
    'locked', app.call_settings_locked(p_tenant_id),
    'assistant_hours', case when a.tenant_id is not null then jsonb_build_object('days', to_jsonb(a.call_days), 'from_minute', a.call_from_minute, 'to_minute', a.call_to_minute) else null end);
end;
$$;
revoke all on function public.call_settings_get(uuid) from public, anon;
grant execute on function public.call_settings_get(uuid) to authenticated;

create function public.call_settings_save(p_tenant_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_locked jsonb;
  v_body   jsonb;
  h        jsonb;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.call_settings_error('deny');
  end if;
  perform app.require_aal2();
  perform app.call_settings_validate(p_settings, false);
  v_locked := app.call_settings_locked(p_tenant_id);
  if v_locked ? 'allowed_purposes' and not ((p_settings -> 'allowed_purposes') <@ (v_locked -> 'allowed_purposes')) then
    perform app.call_settings_error('invalid');   -- the school rule: no sales calls, none about dues or fees
  end if;
  perform pg_advisory_xact_lock(hashtextextended('call_settings:' || p_tenant_id::text, 0));
  v_body := p_settings - 'handover';
  insert into public.call_settings (tenant_id, campaign_id, settings, updated_by) values (p_tenant_id, null, v_body, v_uid)
  on conflict (tenant_id) where campaign_id is null do update set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = app.outbox_now();
  delete from public.call_handover_rules r where r.tenant_id = p_tenant_id;
  for h in select * from jsonb_array_elements(p_settings -> 'handover') loop
    insert into public.call_handover_rules (tenant_id, topic, person_name, phone, updated_by) values (p_tenant_id, h ->> 'topic', h ->> 'person_name', h ->> 'phone', v_uid);
  end loop;
  return public.call_settings_get(p_tenant_id);
end;
$$;
revoke all on function public.call_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.call_settings_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. one campaign's override
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.call_settings_campaign_get(p_tenant_id uuid, p_campaign_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.call_settings;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.call_settings_error('deny');
  end if;
  if p_campaign_id is null or not exists (select 1 from public.campaigns c where c.tenant_id = p_tenant_id and c.id = p_campaign_id) then
    perform app.call_settings_error('reference');
  end if;
  select * into s from public.call_settings x where x.tenant_id = p_tenant_id and x.campaign_id = p_campaign_id;
  return jsonb_build_object('campaign_id', p_campaign_id, 'saved', s.id is not null, 'overrides', case when s.id is not null then s.settings else null end, 'updated_at', s.updated_at);
end;
$$;
revoke all on function public.call_settings_campaign_get(uuid, uuid) from public, anon;
grant execute on function public.call_settings_campaign_get(uuid, uuid) to authenticated;

-- a partial document: absent or null = inherit. An empty override removes it.
create function public.call_settings_campaign_save(p_tenant_id uuid, p_campaign_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_body jsonb;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.call_settings_error('deny');
  end if;
  perform app.require_aal2();
  if p_campaign_id is null or not exists (select 1 from public.campaigns c where c.tenant_id = p_tenant_id and c.id = p_campaign_id) then
    perform app.call_settings_error('reference');
  end if;
  perform app.call_settings_validate(p_settings, true);
  v_body := jsonb_strip_nulls(p_settings);
  perform pg_advisory_xact_lock(hashtextextended('call_settings:' || p_tenant_id::text || ':' || p_campaign_id::text, 0));
  if v_body = '{}'::jsonb then
    delete from public.call_settings s where s.tenant_id = p_tenant_id and s.campaign_id = p_campaign_id;
  else
    insert into public.call_settings (tenant_id, campaign_id, settings, updated_by) values (p_tenant_id, p_campaign_id, v_body, v_uid)
    on conflict (tenant_id, campaign_id) where campaign_id is not null do update set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = app.outbox_now();
  end if;
  return public.call_settings_campaign_get(p_tenant_id, p_campaign_id);
end;
$$;
revoke all on function public.call_settings_campaign_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.call_settings_campaign_save(uuid, uuid, jsonb) to authenticated;

create function public.call_settings_campaign_clear(p_tenant_id uuid, p_campaign_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.call_settings_error('deny');
  end if;
  perform app.require_aal2();
  if p_campaign_id is null or not exists (select 1 from public.campaigns c where c.tenant_id = p_tenant_id and c.id = p_campaign_id) then
    perform app.call_settings_error('reference');
  end if;
  delete from public.call_settings s where s.tenant_id = p_tenant_id and s.campaign_id = p_campaign_id;
  return public.call_settings_campaign_get(p_tenant_id, p_campaign_id);
end;
$$;
revoke all on function public.call_settings_campaign_clear(uuid, uuid) from public, anon;
grant execute on function public.call_settings_campaign_clear(uuid, uuid) to authenticated;
