-- Job CV (night run C1, ADR 0088, ADR 0084 part 4: V1 and V2), migration 1 of 2: VOICE NOTES. A reminder or an announcement can go to a guardian as a short WhatsApp AUDIO message, made by text to speech, with the
-- AI-disclosure line spoken first. Only the fake text-to-speech exists (no paid service, no key); the provider sits behind the interface of job BD.
--
--   voice.voices            (operator) the voices a business may choose from: code, provider, language, label, who listened (a native speaker) and when; a voice nobody has reviewed is usable only if it is SYNTHETIC (the fake)
--   voice.disclosures       (operator) the spoken disclosure line per language and version, with one slot for the business's name: `draft` until a native speaker has read it, `reviewed` after. A draft is spoken only in a
--                           workspace that holds synthetic data (the real-data gate is closed); a reviewed wording is spoken anywhere
--   public.voice_settings   per business (Owner, second factor): switched on or off, the speed, the call hours (09:00 to 21:00 at the widest; kept for the later call feature, unused by notes), recording off for ever
--   public.voice_choices    per business and language: which voice
--   public.campaign_voice   per campaign: voice notes on or off (the approval binds to it: a change sends the campaign back to draft)
--   public.voice_note_usage the fair-use LEDGER: the seconds of every note and preview, one row per message (a retry counts once)
--   public.plan_voice_allowances  seconds a day and a month per plan (placeholders: the owner decides the numbers); 80 percent warns, 100 percent PAUSES voice (the text message still goes: nothing is lost)
--
-- What the worker does (scheduler_voice_plan / scheduler_voice_record): at the moment it hands a campaign message to the channel it asks whether the message is a voice note; if so it makes the audio from the SAME text
-- the Owner approved (preceded by the spoken disclosure), sends it as audio, and records the seconds. If anything is missing (the module, the switch, a voice for the language, a usable disclosure, the allowance) the
-- message goes as text, as before. The audio is made at send time and is NOT stored.
-- Who: Owner (second factor) sets the switch, the speed and the voices; Owner and Admin read them; Owner, Admin and Sales switch a campaign's voice and read its state. Nobody writes a table directly.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM701 the module `voice_notes` is off, SM306 second factor.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the module owns tables now
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table packs.modules disable trigger modules_immutable;
update packs.modules set guard = 'tables', description = 'WhatsApp audio reminders and announcements: voice settings, the spoken AI disclosure, the fair-use ledger of audio seconds' where code = 'voice_notes';
alter table packs.modules enable trigger modules_immutable;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the operator's catalogues (no client role can read or write them)
-- ---------------------------------------------------------------------------------------------------------------------------------
create schema voice;
revoke all on schema voice from public, anon, authenticated, service_role;

create table voice.voices (
  code        text primary key check (code ~ '^[a-z][a-z0-9_-]{2,39}$'),
  provider    text not null check (provider in ('fake', 'sarvam', 'bhashini', 'google', 'ai4bharat')),
  language    text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  label       text not null check (char_length(label) between 1 and 80),
  synthetic   boolean not null default false,
  reviewed_by text check (char_length(reviewed_by) between 1 and 120),
  reviewed_at timestamptz,
  active      boolean not null default true,
  unique (code, language),
  check (synthetic or (reviewed_by is not null and reviewed_at is not null))
);
insert into voice.voices (code, provider, language, label, synthetic) values
  ('fake-en', 'fake', 'en', 'Synthetic English (no human voice)', true),
  ('fake-te', 'fake', 'te', 'Synthetic Telugu (no human voice)', true),
  ('fake-hi', 'fake', 'hi', 'Synthetic Hindi (no human voice)', true),
  ('fake-kn', 'fake', 'kn', 'Synthetic Kannada (no human voice)', true),
  ('fake-ta', 'fake', 'ta', 'Synthetic Tamil (no human voice)', true);

create table voice.disclosures (
  language    text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  version     integer not null check (version >= 1),
  status      text not null check (status in ('draft', 'reviewed')),
  text        text not null check (char_length(text) between 10 and 300 and (char_length(text) - char_length(replace(text, '{{business}}', ''))) = char_length('{{business}}')),
  reviewed_by text check (char_length(reviewed_by) between 1 and 120),
  reviewed_at timestamptz,
  primary key (language, version),
  check ((status = 'reviewed') = (reviewed_by is not null and reviewed_at is not null))
);
-- first drafts: each waits for a native speaker (ADR 0084 part 4: "every voice, disclosure line and script in each language")
insert into voice.disclosures (language, version, status, text) values
  ('en', 1, 'draft', 'This is an automated voice message from the AI assistant of {{business}}.'),
  ('hi', 1, 'draft', 'यह {{business}} के AI सहायक की ओर से एक स्वचालित वॉइस संदेश है।'),
  ('te', 1, 'draft', 'ఇది {{business}} యొక్క AI సహాయకుడి నుండి వచ్చిన ఆటోమేటిక్ వాయిస్ సందేశం.'),
  ('kn', 1, 'draft', 'ಇದು {{business}} ಅವರ AI ಸಹಾಯಕರಿಂದ ಬಂದ ಸ್ವಯಂಚಾಲಿತ ಧ್ವನಿ ಸಂದೇಶ.'),
  ('ta', 1, 'draft', 'இது {{business}} நிறுவனத்தின் AI உதவியாளரிடமிருந்து வரும் தானியங்கி குரல் செய்தி.');
revoke all on all tables in schema voice from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. a business's settings, choices, campaign switch and ledger
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.voice_settings (
  tenant_id      uuid primary key references public.tenants (id) on delete restrict,
  enabled        boolean not null default false,
  speed          numeric(3, 2) not null default 1.00 check (speed between 0.75 and 1.25),
  call_from_hour smallint not null default 9 check (call_from_hour between 9 and 21),
  call_to_hour   smallint not null default 21 check (call_to_hour between 9 and 21),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  check (call_from_hour < call_to_hour)
);

create table public.voice_choices (
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  language   text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  voice_code text not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (tenant_id, language),
  foreign key (voice_code, language) references voice.voices (code, language)
);
create index voice_choices_voice_idx on public.voice_choices (voice_code, language);
create index voice_choices_keyset_idx on public.voice_choices (tenant_id, created_at desc, language);
comment on column public.voice_choices.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.voice_choices.voice_code is 'SAFE: a code from the operator''s catalogue (foreign key). CLEAN-EXEMPT: a foreign key to the closed list';

create table public.campaign_voice (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  campaign_id uuid not null,
  enabled     boolean not null default false,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (tenant_id, campaign_id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id)
);
create index campaign_voice_keyset_idx on public.campaign_voice (tenant_id, created_at desc, campaign_id);

create table public.voice_note_usage (
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  ref_id     uuid not null,
  kind       text not null check (kind in ('note', 'preview')),
  seconds    integer not null check (seconds between 1 and 600),
  chars      integer not null check (chars between 1 and 2000),
  voice_code text not null,
  language   text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  at         timestamptz not null default app.outbox_now(),   -- the clock seam of the outbox: a test pins it, the real time is the same thing
  primary key (tenant_id, ref_id),
  foreign key (voice_code, language) references voice.voices (code, language)
);
create index voice_note_usage_at_idx on public.voice_note_usage (tenant_id, at);
create index voice_note_usage_voice_idx on public.voice_note_usage (voice_code, language);
comment on column public.voice_note_usage.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.voice_note_usage.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.voice_note_usage.voice_code is 'SAFE: a code from the operator''s catalogue (foreign key). CLEAN-EXEMPT: a foreign key to the closed list';

create table public.plan_voice_allowances (
  plan            text primary key check (plan in ('free_trial', 'starter', 'growth', 'business')),
  daily_seconds   integer not null check (daily_seconds between 0 and 86400),
  monthly_seconds integer not null check (monthly_seconds between 0 and 2678400),
  updated_at      timestamptz not null default now()
);
-- PLACEHOLDERS: the owner decides the numbers (ADR 0084 "not decided here: the exact fair-use numbers"); the operator edits them
insert into public.plan_voice_allowances (plan, daily_seconds, monthly_seconds) values ('free_trial', 120, 1200), ('starter', 300, 6000), ('growth', 900, 18000), ('business', 2400, 48000);
revoke all on public.plan_voice_allowances from public, anon, authenticated, service_role;
alter table public.plan_voice_allowances enable row level security;
alter table public.plan_voice_allowances force row level security;

do $$
declare t text;
begin
  foreach t in array array['voice_settings', 'voice_choices', 'campaign_voice', 'voice_note_usage'] loop
    execute format('create trigger module_guard before insert on public.%I for each row execute function app.module_guard(%L)', t, 'voice_notes');
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'']::public.app_role[])))::uuid[]))', t);
  end loop;
end $$;
create trigger voice_settings_forbid_tenant_id_change before update on public.voice_settings for each row execute function app.forbid_tenant_id_change();
create trigger voice_choices_forbid_tenant_id_change before update on public.voice_choices for each row execute function app.forbid_tenant_id_change();
create trigger campaign_voice_forbid_tenant_id_change before update on public.campaign_voice for each row execute function app.forbid_tenant_id_change();
create trigger voice_note_usage_forbid_tenant_id_change before update on public.voice_note_usage for each row execute function app.forbid_tenant_id_change();
create trigger audit_voice_settings after insert or update or delete on public.voice_settings for each row execute function app.audit_row_change('voice_settings', '');
create trigger audit_voice_choices after insert or update or delete on public.voice_choices for each row execute function app.audit_row_change('voice_choice', '');
create trigger audit_campaign_voice after insert or update or delete on public.campaign_voice for each row execute function app.audit_row_change('campaign_voice', '');
create trigger audit_voice_note_usage after insert on public.voice_note_usage for each row execute function app.audit_row_change('voice_note_usage', '');

-- the ledger is written once per message and never changed; settings and choices are never deleted
create function app.voice_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') and tg_table_name <> 'voice_choices' then
    raise exception 'voice records are never deleted' using errcode = '42501';
  end if;
  if tg_table_name = 'voice_note_usage' then
    raise exception 'the voice ledger is never changed' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.voice_edit', true), '') <> 'on' and tg_op <> 'TRUNCATE' then
    raise exception 'voice settings change only through their functions' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function app.voice_rows_guard() from public;
create trigger voice_settings_guard before update or delete on public.voice_settings for each row execute function app.voice_rows_guard();
create trigger voice_settings_no_truncate before truncate on public.voice_settings for each statement execute function app.voice_rows_guard();
create trigger voice_choices_guard before update or delete on public.voice_choices for each row execute function app.voice_rows_guard();
create trigger campaign_voice_guard before update or delete on public.campaign_voice for each row execute function app.voice_rows_guard();
create trigger campaign_voice_no_truncate before truncate on public.campaign_voice for each statement execute function app.voice_rows_guard();
create trigger voice_note_usage_guard before update or delete on public.voice_note_usage for each row execute function app.voice_rows_guard();
create trigger voice_note_usage_no_truncate before truncate on public.voice_note_usage for each statement execute function app.voice_rows_guard();
create function app.voice_edit(p_open boolean) returns void
language sql
set search_path = ''
as $$ select set_config('app.voice_edit', case when p_open then 'on' else '' end, true) $$;
revoke all on function app.voice_edit(boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. helpers: errors, the spoken line, the fair-use state
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.voice_error(p_kind text) returns void
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
revoke all on function app.voice_error(text) from public;

-- the disclosure line to speak for a business in a language: the newest REVIEWED wording, else the newest DRAFT; `usable` says whether it may be spoken (a reviewed one anywhere; a draft only while the workspace holds
-- synthetic data). The business's name fills the one slot.
create function app.voice_disclosure(p_tenant uuid, p_language text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('language', d.language, 'version', d.version, 'status', d.status,
                               'text', replace(d.text, '{{business}}', (select t.name from public.tenants t where t.id = p_tenant)),
                               'usable', d.status = 'reviewed' or not app.real_data_gate_open(p_tenant))
       from voice.disclosures d where d.language = p_language order by (d.status = 'reviewed') desc, d.version desc limit 1),
    jsonb_build_object('language', p_language, 'version', null, 'status', null, 'text', null, 'usable', false))
$$;
revoke all on function app.voice_disclosure(uuid, text) from public, anon, authenticated, service_role;

-- the allowance of a business (seconds a day, a month); no plan row = 0 (fail closed)
create function app.voice_allowance(p_tenant uuid, out o_daily integer, out o_monthly integer) returns record
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(a.daily_seconds, 0), coalesce(a.monthly_seconds, 0)
    from (select 1) x left join public.tenants t on t.id = p_tenant left join public.plan_voice_allowances a on a.plan = t.plan
$$;
revoke all on function app.voice_allowance(uuid) from public, anon, authenticated, service_role;

-- the seconds used today and this month (India time) and the state: ok < 80 percent, warn from 80, paused from 100 of either window
create function app.voice_usage_state(p_tenant uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day    date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_dsec   integer;
  v_msec   integer;
  v_daily  integer;
  v_month  integer;
  v_dp     integer;
  v_mp     integer;
begin
  select a.o_daily, a.o_monthly into v_daily, v_month from app.voice_allowance(p_tenant) a;
  select coalesce(sum(u.seconds) filter (where (u.at at time zone 'Asia/Kolkata')::date = v_day), 0),
         coalesce(sum(u.seconds) filter (where date_trunc('month', u.at at time zone 'Asia/Kolkata') = date_trunc('month', v_day::timestamp)), 0)
    into v_dsec, v_msec from public.voice_note_usage u where u.tenant_id = p_tenant and u.at >= (date_trunc('month', v_day::timestamp) at time zone 'Asia/Kolkata');
  v_dp := case when v_daily <= 0 then 100 else least(999, (v_dsec * 100) / v_daily) end;
  v_mp := case when v_month <= 0 then 100 else least(999, (v_msec * 100) / v_month) end;
  return jsonb_build_object('today_seconds', v_dsec, 'month_seconds', v_msec, 'day_percent', v_dp, 'month_percent', v_mp,
                            'state', case when greatest(v_dp, v_mp) >= 100 then 'paused' when greatest(v_dp, v_mp) >= 80 then 'warn' else 'ok' end);
end;
$$;
revoke all on function app.voice_usage_state(uuid) from public, anon, authenticated, service_role;

-- what a campaign's approval binds to for its voice: nothing while it is off (so a campaign approved before this job keeps its hash), else the voice and the wording
create function app.campaign_voice_sig(p_tenant uuid, p_campaign uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select 'on:' || coalesce(v.voice_code, '-') || ':' || coalesce((app.voice_disclosure(p_tenant, c.language) ->> 'version'), '-') || ':' || coalesce((app.voice_disclosure(p_tenant, c.language) ->> 'status'), '-')
                     from public.campaign_voice cv join public.campaigns c on c.tenant_id = cv.tenant_id and c.id = cv.campaign_id
                     left join public.voice_choices v on v.tenant_id = c.tenant_id and v.language = c.language
                    where cv.tenant_id = p_tenant and cv.campaign_id = p_campaign and cv.enabled), '')
$$;
revoke all on function app.campaign_voice_sig(uuid, uuid) from public, anon, authenticated, service_role;

-- job CP's content hash, a FULL COPY with ONE added term: the voice signature (empty while voice is off, so every hash made before this job stays valid)
create or replace function app.campaign_content_sha(p_tenant uuid, p_campaign uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(
           concat_ws('|', c.kind, c.language, coalesce(c.wa_template_id::text, ''), coalesce((select w.body from integrations.wa_templates w where w.tenant_id = c.tenant_id and w.id = c.wa_template_id), ''),
                     c.message_text, c.steps::text, coalesce(c.call_after_step::text, ''), c.call_wait_hours::text)
           || '#' || coalesce((select string_agg(r.row_hash, ',' order by r.contact_id, r.due_date) from public.campaign_recipients r where r.tenant_id = c.tenant_id and r.campaign_id = c.id), '')
           || case when app.campaign_voice_sig(c.tenant_id, c.id) = '' then '' else '#voice=' || app.campaign_voice_sig(c.tenant_id, c.id) end, 'UTF8')), 'hex')
    from public.campaigns c where c.tenant_id = p_tenant and c.id = p_campaign
$$;
revoke all on function app.campaign_content_sha(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. the Owner's and Admin's calls
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.voice_settings_json(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce(s.enabled, false), 'speed', coalesce(s.speed, 1.00), 'call_from_hour', coalesce(s.call_from_hour, 9), 'call_to_hour', coalesce(s.call_to_hour, 21), 'recording', false,
    'choices', coalesce((select jsonb_object_agg(c.language, c.voice_code) from public.voice_choices c where c.tenant_id = p_tenant), '{}'::jsonb),
    'updated_at', s.updated_at)
  from (select 1) x left join public.voice_settings s on s.tenant_id = p_tenant
$$;
revoke all on function app.voice_settings_json(uuid) from public, anon, authenticated, service_role;

create function public.voice_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  return app.voice_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.voice_settings_get(uuid) from public, anon;
grant execute on function public.voice_settings_get(uuid) to authenticated;

-- Switch voice notes on or off and set the speed and the call hours (Owner, second factor). Recording is off for ever (the setting does not exist).
create function public.voice_settings_set(p_tenant_id uuid, p_enabled boolean, p_speed numeric, p_call_from_hour integer, p_call_to_hour integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  perform app.require_aal2();
  if p_enabled is null or p_speed is null or p_call_from_hour is null or p_call_to_hour is null or p_speed not between 0.75 and 1.25
     or p_call_from_hour not between 9 and 21 or p_call_to_hour not between 9 and 21 or p_call_from_hour >= p_call_to_hour then
    perform app.voice_error('invalid');
  end if;
  perform app.voice_edit(true);
  insert into public.voice_settings (tenant_id, enabled, speed, call_from_hour, call_to_hour, updated_by) values (p_tenant_id, p_enabled, p_speed, p_call_from_hour, p_call_to_hour, v_uid)
  on conflict (tenant_id) do update set enabled = excluded.enabled, speed = excluded.speed, call_from_hour = excluded.call_from_hour, call_to_hour = excluded.call_to_hour, updated_by = v_uid;
  perform app.voice_edit(false);
  return app.voice_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.voice_settings_set(uuid, boolean, numeric, integer, integer) from public, anon;
grant execute on function public.voice_settings_set(uuid, boolean, numeric, integer, integer) to authenticated;

-- the voices a business may choose from (the operator's active, usable ones)
create function public.voice_voices_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  return coalesce((select jsonb_agg(jsonb_build_object('code', v.code, 'language', v.language, 'label', v.label, 'synthetic', v.synthetic) order by v.language, v.code)
                     from voice.voices v where v.active), '[]'::jsonb);
end;
$$;
revoke all on function public.voice_voices_list(uuid) from public, anon;
grant execute on function public.voice_voices_list(uuid) to authenticated;

-- choose the voice for a language (Owner, second factor); a null code removes the choice
create function public.voice_choice_set(p_tenant_id uuid, p_language text, p_voice_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  perform app.require_aal2();
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta') then
    perform app.voice_error('invalid');
  end if;
  perform app.voice_edit(true);
  if p_voice_code is null then
    delete from public.voice_choices where tenant_id = p_tenant_id and language = p_language;
  else
    if not exists (select 1 from voice.voices v where v.code = p_voice_code and v.language = p_language and v.active) then
      perform app.voice_edit(false);
      perform app.voice_error('reference');
    end if;
    insert into public.voice_choices (tenant_id, language, voice_code, updated_by) values (p_tenant_id, p_language, p_voice_code, v_uid)
    on conflict (tenant_id, language) do update set voice_code = excluded.voice_code, updated_by = v_uid, updated_at = now();
  end if;
  perform app.voice_edit(false);
  return app.voice_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.voice_choice_set(uuid, text, text) from public, anon;
grant execute on function public.voice_choice_set(uuid, text, text) to authenticated;

-- the spoken disclosure line for a language, as the business would speak it
create function public.voice_disclosure_get(p_tenant_id uuid, p_language text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta') then
    perform app.voice_error('invalid');
  end if;
  return app.voice_disclosure(p_tenant_id, p_language);
end;
$$;
revoke all on function public.voice_disclosure_get(uuid, text) from public, anon;
grant execute on function public.voice_disclosure_get(uuid, text) to authenticated;

-- the fair use of the audio, in seconds and percent (never in rupees or tokens)
create function public.voice_usage_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  return app.voice_usage_state(p_tenant_id);
end;
$$;
revoke all on function public.voice_usage_get(uuid) from public, anon;
grant execute on function public.voice_usage_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. a campaign's voice switch
-- ---------------------------------------------------------------------------------------------------------------------------------
-- what stands between a campaign and a voice note, as closed words: the business's switch, a voice for the campaign's language, a wording that may be spoken, the allowance
create function app.campaign_voice_issues(p_tenant uuid, p_language text) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when not coalesce((select s.enabled from public.voice_settings s where s.tenant_id = p_tenant), false) then 'voice_off' end,
    case when not exists (select 1 from public.voice_choices c where c.tenant_id = p_tenant and c.language = p_language) then 'no_voice_for_language' end,
    case when not coalesce((app.voice_disclosure(p_tenant, p_language) ->> 'usable')::boolean, false) then 'disclosure_not_reviewed' end,
    case when app.voice_usage_state(p_tenant) ->> 'state' = 'paused' then 'allowance_used' end], null)
$$;
revoke all on function app.campaign_voice_issues(uuid, text) from public, anon, authenticated, service_role;

create function public.campaign_voice_get(p_tenant_id uuid, p_campaign_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  if auth.uid() is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  perform app.require_module(p_tenant_id, 'campaigns');
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id;
  if not found then
    perform app.voice_error('reference');
  end if;
  return jsonb_build_object('campaign_id', c.id, 'enabled', coalesce((select v.enabled from public.campaign_voice v where v.tenant_id = p_tenant_id and v.campaign_id = c.id), false),
                            'language', c.language, 'voice_code', (select v.voice_code from public.voice_choices v where v.tenant_id = p_tenant_id and v.language = c.language),
                            'disclosure', app.voice_disclosure(p_tenant_id, c.language), 'issues', to_jsonb(app.campaign_voice_issues(p_tenant_id, c.language)),
                            'usage', app.voice_usage_state(p_tenant_id));
end;
$$;
revoke all on function public.campaign_voice_get(uuid, uuid) from public, anon;
grant execute on function public.campaign_voice_get(uuid, uuid) to authenticated;

-- Switch voice notes on or off for a campaign (Owner, Admin, Sales, like any edit of a campaign). It is part of what the Owner approves: a change sends an approved campaign back to draft.
create function public.campaign_voice_set(p_tenant_id uuid, p_campaign_id uuid, p_enabled boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c     public.campaigns;
  v_was boolean;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or p_enabled is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  perform app.require_module(p_tenant_id, 'campaigns');
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then
    perform app.voice_error('reference');
  end if;
  if c.status in ('done', 'cancelled') then
    raise exception 'the campaign is finished' using errcode = 'SM801';
  end if;
  select v.enabled into v_was from public.campaign_voice v where v.tenant_id = p_tenant_id and v.campaign_id = p_campaign_id;
  if v_was is distinct from p_enabled and not (v_was is null and not p_enabled) then
    perform app.voice_edit(true);
    insert into public.campaign_voice (tenant_id, campaign_id, enabled, updated_by) values (p_tenant_id, p_campaign_id, p_enabled, v_uid)
    on conflict (tenant_id, campaign_id) do update set enabled = excluded.enabled, updated_by = v_uid, updated_at = now();
    perform app.voice_edit(false);
    perform app.campaign_reset(p_tenant_id, p_campaign_id, 'content_changed');
  end if;
  return public.campaign_voice_get(p_tenant_id, p_campaign_id) || jsonb_build_object('changed', v_was is distinct from p_enabled and not (v_was is null and not p_enabled));
end;
$$;
revoke all on function public.campaign_voice_set(uuid, uuid, boolean) from public, anon;
grant execute on function public.campaign_voice_set(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. the preview: one short synthesis, under the fair-use ledger, at most ten an hour
-- ---------------------------------------------------------------------------------------------------------------------------------
-- The plan for a preview (Owner, Admin): the voice, the speed and the disclosure line to speak, or the reason there is none. The API makes the audio and then calls voice_preview_record.
create function public.voice_preview_plan(p_tenant_id uuid, p_language text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.voice_settings;
  v_voice text;
  v_dis jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta') then
    perform app.voice_error('invalid');
  end if;
  select * into s from public.voice_settings x where x.tenant_id = p_tenant_id;
  select c.voice_code into v_voice from public.voice_choices c where c.tenant_id = p_tenant_id and c.language = p_language;
  v_dis := app.voice_disclosure(p_tenant_id, p_language);
  return case
    when v_voice is null then jsonb_build_object('ok', false, 'reason', 'no_voice_for_language')
    when not (v_dis ->> 'usable')::boolean then jsonb_build_object('ok', false, 'reason', 'disclosure_not_reviewed')
    when app.voice_usage_state(p_tenant_id) ->> 'state' = 'paused' then jsonb_build_object('ok', false, 'reason', 'allowance_used')
    when (select count(*) from public.voice_note_usage u where u.tenant_id = p_tenant_id and u.kind = 'preview' and u.at > app.outbox_now() - interval '1 hour') >= 10 then jsonb_build_object('ok', false, 'reason', 'too_many_previews')
    else jsonb_build_object('ok', true, 'voice_code', v_voice, 'speed', coalesce(s.speed, 1.00), 'language', p_language, 'text', v_dis ->> 'text')
  end;
end;
$$;
revoke all on function public.voice_preview_plan(uuid, text) from public, anon;
grant execute on function public.voice_preview_plan(uuid, text) to authenticated;

-- Record a preview that was made (at most 20 seconds each). The id is the caller's: a retry counts once.
create function public.voice_preview_record(p_tenant_id uuid, p_preview_id uuid, p_language text, p_seconds integer, p_chars integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voice text;
begin
  if auth.uid() is null or p_tenant_id is null or p_preview_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.voice_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'voice_notes');
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta') or p_seconds is null or p_seconds not between 1 and 20 or p_chars is null or p_chars not between 1 and 600 then
    perform app.voice_error('invalid');
  end if;
  select c.voice_code into v_voice from public.voice_choices c where c.tenant_id = p_tenant_id and c.language = p_language;
  if v_voice is null then
    perform app.voice_error('reference');
  end if;
  insert into public.voice_note_usage (tenant_id, ref_id, kind, seconds, chars, voice_code, language) values (p_tenant_id, p_preview_id, 'preview', p_seconds, p_chars, v_voice, p_language) on conflict do nothing;
  return app.voice_usage_state(p_tenant_id);
end;
$$;
revoke all on function public.voice_preview_record(uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.voice_preview_record(uuid, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. the worker's two calls (the registered scheduler account only)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Is this campaign message a voice note, and what is spoken? The text is the message's own, the disclosure line first. Anything missing = {"voice": false}: the message goes as text, as before.
create function public.scheduler_voice_plan(p_tenant_id uuid, p_message_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m       public.outbox_messages;
  s       public.voice_settings;
  v_voice text;
  v_dis   jsonb;
  v_body  text;
  v_text  text;
begin
  if not app.is_scheduler() then
    perform app.voice_error('deny');
  end if;
  if p_tenant_id is null or p_message_id is null or not app.module_enabled(p_tenant_id, 'voice_notes') then
    return jsonb_build_object('voice', false, 'reason', 'module_off');
  end if;
  select * into s from public.voice_settings x where x.tenant_id = p_tenant_id;
  if not found or not s.enabled then
    return jsonb_build_object('voice', false, 'reason', 'voice_off');
  end if;
  select * into m from public.outbox_messages x where x.tenant_id = p_tenant_id and x.id = p_message_id;
  if not found or m.channel <> 'whatsapp' or m.category <> 'campaign_reminder' then
    return jsonb_build_object('voice', false, 'reason', 'not_a_campaign_message');
  end if;
  if not exists (select 1 from public.campaign_steps cs join public.campaign_voice cv on cv.tenant_id = cs.tenant_id and cv.campaign_id = cs.campaign_id and cv.enabled
                  where cs.tenant_id = p_tenant_id and cs.outbox_message_id = p_message_id) then
    return jsonb_build_object('voice', false, 'reason', 'campaign_text_only');
  end if;
  select c.voice_code into v_voice from public.voice_choices c where c.tenant_id = p_tenant_id and c.language = m.language;
  if v_voice is null then
    return jsonb_build_object('voice', false, 'reason', 'no_voice_for_language');
  end if;
  v_dis := app.voice_disclosure(p_tenant_id, m.language);
  if not (v_dis ->> 'usable')::boolean then
    return jsonb_build_object('voice', false, 'reason', 'disclosure_not_reviewed');
  end if;
  if app.voice_usage_state(p_tenant_id) ->> 'state' = 'paused' then
    return jsonb_build_object('voice', false, 'reason', 'allowance_used');
  end if;
  -- the message's own words: the outbox may have appended its first-message line, which the spoken disclosure replaces
  v_body := case when m.disclosure_added then left(m.body, greatest(0, char_length(m.body) - char_length(E'\n\n' || app.outbox_disclosure(m.language)))) else m.body end;
  v_text := (v_dis ->> 'text') || ' ' || v_body;
  if char_length(v_text) > 600 then
    return jsonb_build_object('voice', false, 'reason', 'too_long');
  end if;
  return jsonb_build_object('voice', true, 'voice_code', v_voice, 'speed', s.speed, 'language', m.language, 'text', v_text, 'chars', char_length(v_text));
end;
$$;
revoke all on function public.scheduler_voice_plan(uuid, uuid) from public, anon;
grant execute on function public.scheduler_voice_plan(uuid, uuid) to authenticated;

-- Record the seconds of a note that was made. One row per message: a repeat (the claim lapsed and the message came round again) counts once.
create function public.scheduler_voice_record(p_tenant_id uuid, p_message_id uuid, p_language text, p_voice_code text, p_seconds integer, p_chars integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.voice_error('deny');
  end if;
  if p_tenant_id is null or p_message_id is null or p_language is null or p_voice_code is null or p_seconds is null or p_seconds not between 1 and 600 or p_chars is null or p_chars not between 1 and 2000 then
    perform app.voice_error('invalid');
  end if;
  if not exists (select 1 from public.outbox_messages m where m.tenant_id = p_tenant_id and m.id = p_message_id) then
    perform app.voice_error('reference');
  end if;
  begin
    insert into public.voice_note_usage (tenant_id, ref_id, kind, seconds, chars, voice_code, language) values (p_tenant_id, p_message_id, 'note', p_seconds, p_chars, p_voice_code, p_language) on conflict do nothing;
  exception when foreign_key_violation then
    perform app.voice_error('reference');
  end;
  return app.voice_usage_state(p_tenant_id);
end;
$$;
revoke all on function public.scheduler_voice_record(uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.scheduler_voice_record(uuid, uuid, text, text, integer, integer) to authenticated;
