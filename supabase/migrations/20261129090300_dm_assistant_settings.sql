-- Job DM (C1 part, owner decision 25 Oct 2026, evening), migration 3: THE AI ASSISTANT'S SETTINGS, per workspace, as data (Settings > AI assistant). Extends job DJ's voice data.
--
--   public.assistant_settings            one row per workspace, made by the first save (until then the API shows the DEFAULTS of the business type: packages/assistant/assistant.json, so an owner can skip the screen)
--   voice.voice_personas                 which voice speaks a persona (female warm, female clear, male calm, male lively) in which language: the operator's catalogue (fake voices for all four today; a real voice
--                                        is added after a native speaker listened, docs/runbooks/voice-notes-real.md)
--   public.assistant_settings_get/_save  the Owner and Admin read it; the Owner saves it with a second factor. A save also hands the SPEED and the CALLING HOURS to the voice-note settings (job CV) and the PERSONA's voice
--                                        per language to the voice choices, when that business has voice notes: one setting, used by calls and by voice replies.
--   public.assistant_voices              the four personas and, per language, whether a voice exists for it
--   The words "AI assistant" are always said: the spoken introduction is composed in code from fixed wording ("{name}, the AI assistant of {business}") and is not a stored field; the name cannot carry markup.
--   No child data: nothing here refers to a student.
--   THE SCHOOL RULE (owner, 25 Oct 2026): an education workspace's assistant never discusses dues, fees or marks, offers no discount and has no order limit. Those go only as fixed template messages from the school's
--   records. The save refuses any setting that would allow it, and the answer says which fields are locked (app.assistant_locked).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the voices of the four personas
-- ---------------------------------------------------------------------------------------------------------------------------------
create table voice.voice_personas (
  persona    text not null check (persona in ('female_warm', 'female_clear', 'male_calm', 'male_lively')),
  language   text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  voice_code text not null,
  primary key (persona, language),
  foreign key (voice_code, language) references voice.voices (code, language)
);
insert into voice.voice_personas (persona, language, voice_code)
select p, l, 'fake-' || l from unnest(array['female_warm', 'female_clear', 'male_calm', 'male_lively']) p cross join unnest(array['en', 'te', 'hi', 'kn', 'ta']) l;
alter table voice.voice_personas enable row level security;
alter table voice.voice_personas force row level security;
revoke all on voice.voice_personas from public, anon, authenticated, service_role;

-- the operator maps a persona to a voice (after a native speaker listened); a persona the table has no row for in a language is "not available" there
create function app.operator_set_voice_persona(p_persona text, p_language text, p_voice_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  insert into voice.voice_personas (persona, language, voice_code) values (p_persona, p_language, p_voice_code)
  on conflict (persona, language) do update set voice_code = excluded.voice_code;
end;
$$;
revoke all on function app.operator_set_voice_persona(text, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the settings
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.assistant_settings (
  tenant_id                 uuid primary key references public.tenants (id) on delete restrict,
  assistant_name            text not null check (char_length(assistant_name) between 1 and 24 and app.text_is_clean(assistant_name) and assistant_name ~ '^[^<>{}@/\\|]+$'),
  voice_persona             text not null check (voice_persona in ('female_warm', 'female_clear', 'male_calm', 'male_lively')),
  main_language             text not null check (main_language in ('en', 'te', 'hi', 'kn', 'ta')),
  auto_switch_language      boolean not null,
  allow_english_mixing      boolean not null,
  style                     text not null check (style in ('warm', 'respectful', 'quick')),
  speed                     numeric(3, 2) not null check (speed between 0.75 and 1.25),
  may_answer_prices         boolean not null,
  may_book_visits           boolean not null,
  may_send_media            boolean not null,
  may_talk_dues             boolean not null,
  max_discount_percent      smallint not null check (max_discount_percent between 0 and 50),
  handover_owner_asked      boolean not null,
  handover_upset            boolean not null,
  handover_order_above_paise bigint check (handover_order_above_paise is null or handover_order_above_paise between 1 and 100000000000),
  call_days                 smallint[] not null check (cardinality(call_days) between 1 and 7 and call_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  call_from_minute          smallint not null check (call_from_minute between 540 and 1260 and call_from_minute % 15 = 0),
  call_to_minute            smallint not null check (call_to_minute between 540 and 1260 and call_to_minute % 15 = 0),
  updated_by                uuid,
  updated_at                timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  check (call_from_minute < call_to_minute)
);
comment on column public.assistant_settings.assistant_name is 'The name the assistant gives itself on calls ("Vani"): chosen by the owner, not a person''s data. Clean text; no markup characters.';
comment on column public.assistant_settings.voice_persona is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_settings.main_language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_settings.style is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table public.assistant_settings enable row level security;
alter table public.assistant_settings force row level security;
revoke all on public.assistant_settings from public, anon, authenticated, service_role;
grant select on public.assistant_settings to authenticated;
create policy assistant_settings_select on public.assistant_settings for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger assistant_settings_forbid_tenant_id_change before update on public.assistant_settings for each row execute function app.forbid_tenant_id_change();
create trigger audit_assistant_settings after insert or update or delete on public.assistant_settings for each row execute function app.audit_row_change('assistant_settings', '');

create function app.assistant_settings_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'assistant settings are never deleted' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.assistant_edit', true), '') <> 'on' then
    raise exception 'assistant settings change only through their function' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.assistant_settings_guard() from public;
create trigger assistant_settings_guard before update or delete on public.assistant_settings for each row execute function app.assistant_settings_guard();
create trigger assistant_settings_no_truncate before truncate on public.assistant_settings for each statement execute function app.assistant_settings_guard();

create function app.assistant_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid' then raise exception 'invalid input' using errcode = '22023';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.assistant_error(text) from public;

create function app.assistant_json(a public.assistant_settings) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', a.assistant_name, 'voice_persona', a.voice_persona, 'main_language', a.main_language, 'auto_switch_language', a.auto_switch_language, 'allow_english_mixing', a.allow_english_mixing,
    'style', a.style, 'speed', a.speed, 'may_answer_prices', a.may_answer_prices, 'may_book_visits', a.may_book_visits, 'may_send_media', a.may_send_media, 'may_talk_dues', a.may_talk_dues,
    'max_discount_percent', a.max_discount_percent, 'handover_owner_asked', a.handover_owner_asked, 'handover_upset', a.handover_upset, 'handover_order_above_paise', a.handover_order_above_paise,
    'call_days', to_jsonb(a.call_days), 'call_from_minute', a.call_from_minute, 'call_to_minute', a.call_to_minute)
$$;
revoke all on function app.assistant_json(public.assistant_settings) from public, anon, authenticated, service_role;

-- the fields a business type may not change, with the value they are held at: a school's assistant does not talk about dues, fees or marks (so no prices), gives no discount and has no order limit
create function app.assistant_locked(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from packs.workspace_pack w where w.tenant_id = p_tenant and w.pack_code = 'education')
              then jsonb_build_object('may_talk_dues', false, 'may_answer_prices', false, 'max_discount_percent', 0, 'handover_order_above_paise', null)
              else '{}'::jsonb end
$$;
revoke all on function app.assistant_locked(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. read
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.assistant_settings;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.assistant_error('deny');
  end if;
  select * into a from public.assistant_settings x where x.tenant_id = p_tenant_id;
  return jsonb_build_object(
    'saved', found,
    'settings', case when found then app.assistant_json(a) else null end,
    'updated_at', case when found then a.updated_at else null end,
    'business_name', (select t.name from public.tenants t where t.id = p_tenant_id),
    'business_type', coalesce((select w.pack_code from packs.workspace_pack w where w.tenant_id = p_tenant_id), 'textiles'),
    'locked', app.assistant_locked(p_tenant_id),
    'voice_notes', app.module_enabled(p_tenant_id, 'voice_notes'));
end;
$$;
revoke all on function public.assistant_settings_get(uuid) from public, anon;
grant execute on function public.assistant_settings_get(uuid) to authenticated;

-- the four personas and, per language, whether a voice exists for each and whether it is a machine voice with no human behind it
create function public.assistant_voices(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.assistant_error('deny');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('persona', p.persona, 'language', p.language, 'voice_code', p.voice_code, 'synthetic', v.synthetic) order by p.persona, p.language)
      from voice.voice_personas p join voice.voices v on v.code = p.voice_code and v.language = p.language and v.active), '[]'::jsonb);
end;
$$;
revoke all on function public.assistant_voices(uuid) from public, anon;
grant execute on function public.assistant_voices(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. save (Owner, second factor). Every field is required, no other key is allowed.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_settings_save(p_tenant_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_keys  text[] := array['name', 'voice_persona', 'main_language', 'auto_switch_language', 'allow_english_mixing', 'style', 'speed', 'may_answer_prices', 'may_book_visits', 'may_send_media',
                          'may_talk_dues', 'max_discount_percent', 'handover_owner_asked', 'handover_upset', 'handover_order_above_paise', 'call_days', 'call_from_minute', 'call_to_minute'];
  v_days  smallint[];
  a       public.assistant_settings;
  r       record;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.assistant_error('deny');
  end if;
  perform app.require_aal2();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_settings) k where k <> all (v_keys))
     or exists (select 1 from unnest(v_keys) k where not p_settings ? k)
     or jsonb_typeof(p_settings -> 'call_days') <> 'array'
     -- the kinds of value: text, true/false, numbers (Postgres would read "yes" as true and "1" as a number: not here)
     or exists (select 1 from unnest(array['name', 'voice_persona', 'main_language', 'style']) k where jsonb_typeof(p_settings -> k) <> 'string')
     or exists (select 1 from unnest(array['auto_switch_language', 'allow_english_mixing', 'may_answer_prices', 'may_book_visits', 'may_send_media', 'may_talk_dues', 'handover_owner_asked', 'handover_upset']) k
                 where jsonb_typeof(p_settings -> k) <> 'boolean')
     or exists (select 1 from unnest(array['speed', 'max_discount_percent', 'call_from_minute', 'call_to_minute']) k where jsonb_typeof(p_settings -> k) <> 'number')
     or jsonb_typeof(p_settings -> 'handover_order_above_paise') not in ('number', 'null')
     or exists (select 1 from jsonb_array_elements(p_settings -> 'call_days') d where jsonb_typeof(d) <> 'number') then
    perform app.assistant_error('invalid');
  end if;
  -- the school rule: whatever the locked fields are held at, the save must say the same
  if exists (select 1 from jsonb_each(app.assistant_locked(p_tenant_id)) l where p_settings -> l.key is distinct from l.value) then
    perform app.assistant_error('invalid');
  end if;
  begin
    select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into v_days from jsonb_array_elements_text(p_settings -> 'call_days') d;
    perform set_config('app.assistant_edit', 'on', true);
    insert into public.assistant_settings (
      tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media, may_talk_dues,
      max_discount_percent, handover_owner_asked, handover_upset, handover_order_above_paise, call_days, call_from_minute, call_to_minute, updated_by)
    values (
      p_tenant_id, btrim(p_settings ->> 'name'), p_settings ->> 'voice_persona', p_settings ->> 'main_language', (p_settings ->> 'auto_switch_language')::boolean, (p_settings ->> 'allow_english_mixing')::boolean,
      p_settings ->> 'style', (p_settings ->> 'speed')::numeric, (p_settings ->> 'may_answer_prices')::boolean, (p_settings ->> 'may_book_visits')::boolean, (p_settings ->> 'may_send_media')::boolean,
      (p_settings ->> 'may_talk_dues')::boolean, (p_settings ->> 'max_discount_percent')::smallint, (p_settings ->> 'handover_owner_asked')::boolean, (p_settings ->> 'handover_upset')::boolean,
      case when jsonb_typeof(p_settings -> 'handover_order_above_paise') = 'null' then null else (p_settings ->> 'handover_order_above_paise')::bigint end,
      v_days, (p_settings ->> 'call_from_minute')::smallint, (p_settings ->> 'call_to_minute')::smallint, v_uid)
    on conflict (tenant_id) do update set
      assistant_name = excluded.assistant_name, voice_persona = excluded.voice_persona, main_language = excluded.main_language, auto_switch_language = excluded.auto_switch_language,
      allow_english_mixing = excluded.allow_english_mixing, style = excluded.style, speed = excluded.speed, may_answer_prices = excluded.may_answer_prices, may_book_visits = excluded.may_book_visits,
      may_send_media = excluded.may_send_media, may_talk_dues = excluded.may_talk_dues, max_discount_percent = excluded.max_discount_percent, handover_owner_asked = excluded.handover_owner_asked,
      handover_upset = excluded.handover_upset, handover_order_above_paise = excluded.handover_order_above_paise, call_days = excluded.call_days, call_from_minute = excluded.call_from_minute,
      call_to_minute = excluded.call_to_minute, updated_by = excluded.updated_by, updated_at = app.outbox_now()
    returning * into a;
    perform set_config('app.assistant_edit', '', true);
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value or not_null_violation or datatype_mismatch then
    perform set_config('app.assistant_edit', '', true);
    perform app.assistant_error('invalid');
  end;
  -- one setting, used by calls and by voice replies: when this business has voice notes, the speed, the calling hours and the persona's voice follow
  if app.module_enabled(p_tenant_id, 'voice_notes') then
    perform app.voice_edit(true);
    update public.voice_settings set speed = a.speed, call_from_hour = (a.call_from_minute / 60)::smallint, call_to_hour = least(21, ceil(a.call_to_minute / 60.0))::smallint, updated_by = v_uid, updated_at = app.outbox_now()
     where tenant_id = p_tenant_id;
    for r in select p.language, p.voice_code from voice.voice_personas p join voice.voices v on v.code = p.voice_code and v.language = p.language and v.active where p.persona = a.voice_persona loop
      insert into public.voice_choices (tenant_id, language, voice_code, updated_by) values (p_tenant_id, r.language, r.voice_code, v_uid)
      on conflict (tenant_id, language) do update set voice_code = excluded.voice_code, updated_by = excluded.updated_by, updated_at = app.outbox_now();
    end loop;
    perform app.voice_edit(false);
  end if;
  return public.assistant_settings_get(p_tenant_id);
end;
$$;
revoke all on function public.assistant_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.assistant_settings_save(uuid, jsonb) to authenticated;
