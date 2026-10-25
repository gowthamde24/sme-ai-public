-- Job DP part 5 (night run 26 Oct 2026): THE OWNER'S OWN VOICE, WITH CONSENT.
--
--   Only the workspace Owner (second factor) can start. A 15 to 60 second sample and a recorded consent sentence ("I, <name>, allow Stack19 to create an AI voice of me for <shop>") are stored in a private
--   bucket of the workspace; the name, the time and the workspace are recorded; the cloned voice (a FAKE provider today) becomes selectable in the AI assistant's settings as the persona `own_voice`.
--   The assistant still says it is the AI assistant (the introduction is fixed wording, not a field). "Delete my voice" removes the provider voice, the sample and the consent audio.
--
--   public.own_voices                 one row per voice made (at most one live at a time); after a deletion only the id, the workspace, who consented and when, and the day it was deleted remain: no name, no sentence, no file
--   app.ovc_bucket / app.ovc_bucket_tenant   the workspace's private bucket `ovc-<tenant id>` and the rules of its objects (the Owner only)
--   public.own_voice_sentence         the exact sentence to read aloud
--   public.own_voice_ensure_bucket    the Owner makes the bucket (the API then uploads the two recordings with the Owner's own token)
--   public.own_voice_begin            checks the sentence, the two files and the durations; records the consent (status pending)
--   public.own_voice_ready / _failed  the API says what the provider did
--   public.own_voice_get / _private   the status for the screen; the files and the provider's id for the deletion
--   public.own_voice_deleted          after the provider voice and both files are gone: the personal data goes, the voice stops being selectable, an assistant that used it falls back to a stock voice
--   public.assistant_settings_save / assistant_voices   FULL COPIES that know the persona `own_voice` (selectable only while the workspace's own voice is ready)
--
--   SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM306 second factor needed, SM831 a voice already exists, SM832 a recording is missing or is not audio, SM833 the sentence is not the one to read.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the table
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.ovc_bucket(p_tenant uuid) returns text
language sql
immutable
set search_path = ''
as $$ select 'ovc-' || p_tenant::text $$;
revoke all on function app.ovc_bucket(uuid) from public;

create table public.own_voices (
  id               uuid primary key,
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  status           text not null check (status in ('pending', 'ready', 'failed', 'deleted')),
  -- the consenting person's name and the exact sentence they read: personal data, gone when the voice is deleted
  consenting_name  text check (consenting_name is null or (char_length(consenting_name) between 2 and 80 and app.text_is_clean(consenting_name) and consenting_name ~ '^[^<>{}@/\\|]+$')),
  consent_sentence text check (consent_sentence is null or (char_length(consent_sentence) between 20 and 300 and app.text_is_clean(consent_sentence))),
  consent_version  smallint not null default 1,
  consented_by     uuid not null,
  consented_at     timestamptz not null,
  bucket           text check (bucket is null or bucket = app.ovc_bucket(tenant_id)),
  sample_path      text check (sample_path is null or sample_path ~ '^[0-9a-f-]{36}/sample\.(webm|ogg|wav|mp3|m4a|mp4)$'),
  sample_seconds   numeric(4, 1) check (sample_seconds is null or sample_seconds between 15 and 60),
  sample_bytes     integer check (sample_bytes is null or sample_bytes between 1 and 10485760),
  consent_path     text check (consent_path is null or consent_path ~ '^[0-9a-f-]{36}/consent\.(webm|ogg|wav|mp3|m4a|mp4)$'),
  consent_seconds  numeric(4, 1) check (consent_seconds is null or consent_seconds between 2 and 30),
  consent_bytes    integer check (consent_bytes is null or consent_bytes between 1 and 3145728),
  provider         text not null default 'fake' check (provider in ('fake')),
  provider_voice_id text check (provider_voice_id is null or provider_voice_id ~ '^[A-Za-z0-9_-]{3,100}$'),
  created_at       timestamptz not null default app.outbox_now(),
  ready_at         timestamptz,
  deleted_at       timestamptz,
  unique (tenant_id, id),
  check (status = 'deleted' or (consenting_name is not null and consent_sentence is not null and bucket is not null and sample_path is not null and consent_path is not null)),
  check (status <> 'deleted' or (consenting_name is null and consent_sentence is null and sample_path is null and consent_path is null and provider_voice_id is null and deleted_at is not null)),
  check ((status = 'ready') = (ready_at is not null and provider_voice_id is not null) or status in ('deleted', 'failed'))
);
create unique index own_voices_live_key on public.own_voices (tenant_id) where status in ('pending', 'ready');
create index own_voices_keyset_idx on public.own_voices (tenant_id, created_at desc, id desc);
comment on table public.own_voices is 'Job DP part 5: a workspace Owner''s own voice, made with a recorded consent. The recordings live in the private bucket ovc-<tenant>; after a deletion no personal data and no file remain.';
comment on column public.own_voices.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.own_voices.provider is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.own_voices.consenting_name is 'PII: the name of the person whose voice it is (the Owner). Erased with the workspace and when the voice is deleted.';
comment on column public.own_voices.consent_sentence is 'PII: the sentence that person read aloud (it holds their name). Erased with the workspace and when the voice is deleted.';
comment on column public.own_voices.provider_voice_id is 'SAFE: the provider''s opaque id of the cloned voice. CLEAN-EXEMPT: charset-limited CHECK';
comment on column public.own_voices.sample_path is 'SAFE: a storage path made of ids. CLEAN-EXEMPT: pattern CHECK';
comment on column public.own_voices.consent_path is 'SAFE: a storage path made of ids. CLEAN-EXEMPT: pattern CHECK';
comment on column public.own_voices.bucket is 'SAFE: the workspace''s bucket name, made of its id. CLEAN-EXEMPT: equals app.ovc_bucket(tenant_id)';

alter table public.own_voices enable row level security;
alter table public.own_voices force row level security;
revoke all on public.own_voices from public, anon, authenticated, service_role;
grant select on public.own_voices to authenticated;
create policy own_voices_select on public.own_voices for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger own_voices_forbid_tenant_id_change before update on public.own_voices for each row execute function app.forbid_tenant_id_change();
create trigger audit_own_voices after insert or update on public.own_voices for each row execute function app.audit_row_change('own_voice', 'consenting_name,consent_sentence');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('own_voices', 'consenting_name',  'tenant', 'null', 'erased:1'),
  ('own_voices', 'consent_sentence', 'tenant', 'null', 'erased:1'),
  ('own_voices', 'consenting_name',  'sweep',  'substring', 'erased:1'),
  ('own_voices', 'consent_sentence', 'sweep',  'substring', 'erased:1');

-- a row is never deleted; a ready or failed or pending row changes only through the functions below
create function app.own_voices_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'a voice record is never deleted' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.consented_by is distinct from old.consented_by or new.consented_at is distinct from old.consented_at
     or new.created_at is distinct from old.created_at or (old.status = 'deleted' and new.status <> 'deleted') then
    raise exception 'a voice keeps its owner, its consent and its time' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.own_voices_guard() from public;
create trigger own_voices_guard before update or delete on public.own_voices for each row execute function app.own_voices_guard();
create trigger own_voices_no_truncate before truncate on public.own_voices for each statement execute function app.own_voices_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the bucket and its rules
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.ovc_bucket_tenant(p_bucket text) returns uuid
language sql
immutable
set search_path = ''
as $$ select case when p_bucket ~ '^ovc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(p_bucket, 5)::uuid else null end $$;
revoke all on function app.ovc_bucket_tenant(text) from public;
grant execute on function app.ovc_bucket_tenant(text) to authenticated;

-- the two recordings are the Owner's alone: nobody else can hear them, not even an Admin
create policy ovc_objects_select on storage.objects for select to authenticated
  using (app.ovc_bucket_tenant(bucket_id) is not null and app.has_tenant_role(app.ovc_bucket_tenant(bucket_id), array['owner']::public.app_role[]));
create policy ovc_objects_insert on storage.objects for insert to authenticated
  with check (app.ovc_bucket_tenant(bucket_id) is not null and app.has_tenant_role(app.ovc_bucket_tenant(bucket_id), array['owner']::public.app_role[]));
create policy ovc_objects_delete on storage.objects for delete to authenticated
  using (app.ovc_bucket_tenant(bucket_id) is not null and app.has_tenant_role(app.ovc_bucket_tenant(bucket_id), array['owner']::public.app_role[]));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.ovc_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'exists'    then raise exception 'a voice already exists' using errcode = 'SM831';
    when 'files'     then raise exception 'a recording is missing or is not audio' using errcode = 'SM832';
    when 'sentence'  then raise exception 'that is not the sentence to read' using errcode = 'SM833';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.ovc_error(text) from public;

-- the codes of the voices a workspace's own voice has in each language (voice.voices): own-<first 8 of the workspace id>-<language>
create function app.ovc_voice_code(p_tenant uuid, p_language text) returns text
language sql
immutable
set search_path = ''
as $$ select 'own-' || substr(p_tenant::text, 1, 8) || '-' || p_language $$;
revoke all on function app.ovc_voice_code(uuid, text) from public, anon, authenticated, service_role;

create function app.ovc_json(o public.own_voices) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', o.id, 'status', o.status, 'consenting_name', o.consenting_name, 'consented_at', o.consented_at, 'sample_seconds', o.sample_seconds,
                            'consent_seconds', o.consent_seconds, 'ready_at', o.ready_at, 'deleted_at', o.deleted_at,
                            'languages', case when o.status = 'ready' then '["en", "te", "hi", "kn"]'::jsonb else '[]'::jsonb end)
$$;
revoke all on function app.ovc_json(public.own_voices) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. reading
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the sentence to read, exactly as the database will check it
create function public.own_voice_sentence(p_tenant_id uuid, p_name text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.ovc_error('deny');
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 80 or not app.text_is_clean(p_name) or p_name !~ '^[^<>{}@/\\|]+$' then
    perform app.ovc_error('invalid');
  end if;
  return 'I, ' || btrim(p_name) || ', allow Stack19 to create an AI voice of me for ' || (select t.name from public.tenants t where t.id = p_tenant_id);
end;
$$;
revoke all on function public.own_voice_sentence(uuid, text) from public, anon;
grant execute on function public.own_voice_sentence(uuid, text) to authenticated;

-- the latest record that is not a deleted one, else the latest deleted one, else {status: none}. Owner and Admin (no file paths here).
create function public.own_voice_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.own_voices;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.ovc_error('deny');
  end if;
  select * into o from public.own_voices x where x.tenant_id = p_tenant_id order by (x.status in ('pending', 'ready')) desc, x.created_at desc, x.id desc limit 1;
  if not found then
    return jsonb_build_object('status', 'none', 'languages', '[]'::jsonb);
  end if;
  return app.ovc_json(o);
end;
$$;
revoke all on function public.own_voice_get(uuid) from public, anon;
grant execute on function public.own_voice_get(uuid) to authenticated;

-- what the API needs to take a voice down: the live record's files and the provider's id. Owner only.
create function public.own_voice_private(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.own_voices;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.ovc_error('deny');
  end if;
  select * into o from public.own_voices x where x.tenant_id = p_tenant_id and x.status in ('pending', 'ready', 'failed') order by x.created_at desc limit 1;
  if not found then
    return 'null'::jsonb;
  end if;
  return jsonb_build_object('id', o.id, 'status', o.status, 'bucket', o.bucket, 'sample_path', o.sample_path, 'consent_path', o.consent_path, 'provider', o.provider, 'provider_voice_id', o.provider_voice_id);
end;
$$;
revoke all on function public.own_voice_private(uuid) from public, anon;
grant execute on function public.own_voice_private(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. making a voice
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.own_voice_ensure_bucket(p_tenant_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket text := app.ovc_bucket(p_tenant_id);
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.ovc_error('deny');
  end if;
  perform app.require_aal2();
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (v_bucket, v_bucket, false, 10485760, array['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'video/webm', 'video/mp4'])
  on conflict (id) do nothing;
  return v_bucket;
end;
$$;
revoke all on function public.own_voice_ensure_bucket(uuid) from public, anon;
grant execute on function public.own_voice_ensure_bucket(uuid) to authenticated;

-- The API has uploaded the two recordings (with the Owner's own token). Here the consent is recorded, after the database has looked at both files itself.
create function public.own_voice_begin(
  p_tenant_id uuid, p_id uuid, p_name text, p_sentence text, p_sample_path text, p_sample_seconds numeric, p_consent_path text, p_consent_seconds numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_bucket  text := app.ovc_bucket(p_tenant_id);
  v_sample  storage.objects;
  v_consent storage.objects;
  o         public.own_voices;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.ovc_error('deny');
  end if;
  perform app.require_aal2();
  if p_id is null or p_name is null or p_sentence is null or p_sample_path is null or p_consent_path is null or p_sample_seconds is null or p_consent_seconds is null
     or p_sample_seconds not between 15 and 60 or p_consent_seconds not between 2 and 30
     or p_sample_path !~ ('^' || p_id::text || '/sample\.(webm|ogg|wav|mp3|m4a|mp4)$') or p_consent_path !~ ('^' || p_id::text || '/consent\.(webm|ogg|wav|mp3|m4a|mp4)$') then
    perform app.ovc_error('invalid');
  end if;
  -- the sentence is the one the database would have given (name and business filled in), word for word
  if p_sentence <> public.own_voice_sentence(p_tenant_id, p_name) then
    perform app.ovc_error('sentence');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ownvoice:' || p_tenant_id::text, 0));
  if exists (select 1 from public.own_voices x where x.tenant_id = p_tenant_id and x.status in ('pending', 'ready')) then
    perform app.ovc_error('exists');
  end if;
  select * into v_sample from storage.objects s where s.bucket_id = v_bucket and s.name = p_sample_path;
  select * into v_consent from storage.objects s where s.bucket_id = v_bucket and s.name = p_consent_path;
  if v_sample.id is null or v_consent.id is null
     or coalesce(v_sample.metadata ->> 'mimetype', '') !~ '^(audio/|video/(webm|mp4))' or coalesce(v_consent.metadata ->> 'mimetype', '') !~ '^(audio/|video/(webm|mp4))' then
    perform app.ovc_error('files');
  end if;
  begin
    insert into public.own_voices (id, tenant_id, status, consenting_name, consent_sentence, consented_by, consented_at, bucket, sample_path, sample_seconds, sample_bytes, consent_path, consent_seconds, consent_bytes)
    values (p_id, p_tenant_id, 'pending', btrim(p_name), p_sentence, v_uid, app.outbox_now(), v_bucket, p_sample_path, p_sample_seconds, (v_sample.metadata ->> 'size')::integer, p_consent_path, p_consent_seconds, (v_consent.metadata ->> 'size')::integer)
    returning * into o;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    perform app.ovc_error('invalid');
  end;
  return app.ovc_json(o);
end;
$$;
revoke all on function public.own_voice_begin(uuid, uuid, text, text, text, numeric, text, numeric) from public, anon;
grant execute on function public.own_voice_begin(uuid, uuid, text, text, text, numeric, text, numeric) to authenticated;

-- the provider made the voice: it becomes selectable (one voice per language, none of them "synthetic": a person stands behind it, and the Owner's consent is the review)
create function public.own_voice_ready(p_tenant_id uuid, p_id uuid, p_provider text, p_provider_voice_id text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.own_voices;
  l text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.ovc_error('deny');
  end if;
  perform app.require_aal2();
  if p_id is null or p_provider is null or p_provider <> 'fake' or p_provider_voice_id is null or p_provider_voice_id !~ '^[A-Za-z0-9_-]{3,100}$' then
    perform app.ovc_error('invalid');
  end if;
  select * into o from public.own_voices x where x.tenant_id = p_tenant_id and x.id = p_id and x.status = 'pending' for update;
  if not found then
    perform app.ovc_error('reference');
  end if;
  foreach l in array array['en', 'te', 'hi', 'kn'] loop
    insert into voice.voices (code, provider, language, label, synthetic, reviewed_by, reviewed_at)
    values (app.ovc_voice_code(p_tenant_id, l), p_provider, l, 'Your own voice', false, 'the Owner''s recorded consent', app.outbox_now())
    on conflict (code) do update set active = true, label = excluded.label, synthetic = false, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
  end loop;
  update public.own_voices set status = 'ready', provider_voice_id = p_provider_voice_id, ready_at = app.outbox_now() where id = o.id returning * into o;
  return app.ovc_json(o);
end;
$$;
revoke all on function public.own_voice_ready(uuid, uuid, text, text) from public, anon;
grant execute on function public.own_voice_ready(uuid, uuid, text, text) to authenticated;

-- the provider refused: the attempt is over and its recordings are taken away (the API removes the files)
create function public.own_voice_failed(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.own_voices;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.ovc_error('deny');
  end if;
  perform app.require_aal2();
  update public.own_voices set status = 'failed' where tenant_id = p_tenant_id and id = p_id and status = 'pending' returning * into o;
  if not found then
    perform app.ovc_error('reference');
  end if;
  return app.ovc_json(o);
end;
$$;
revoke all on function public.own_voice_failed(uuid, uuid) from public, anon;
grant execute on function public.own_voice_failed(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. "delete my voice": after the API removed the provider voice and both recordings
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.own_voice_deleted(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.own_voices;
  l text;
  v_default text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.ovc_error('deny');
  end if;
  perform app.require_aal2();
  select * into o from public.own_voices x where x.tenant_id = p_tenant_id and x.id = p_id and x.status in ('pending', 'ready', 'failed') for update;
  if not found then
    perform app.ovc_error('reference');
  end if;
  -- the recordings must really be gone before the record says so
  if exists (select 1 from storage.objects s where s.bucket_id = o.bucket and s.name in (o.sample_path, o.consent_path)) then
    perform app.ovc_error('files');
  end if;
  -- an assistant that spoke with this voice goes back to a stock one, and so do the voice notes
  if exists (select 1 from public.assistant_settings a where a.tenant_id = p_tenant_id and a.voice_persona = 'own_voice') then
    perform set_config('app.assistant_edit', 'on', true);
    update public.assistant_settings set voice_persona = 'female_warm', updated_at = app.outbox_now() where tenant_id = p_tenant_id;
    perform set_config('app.assistant_edit', '', true);
  end if;
  perform app.voice_edit(true);
  foreach l in array array['en', 'te', 'hi', 'kn'] loop
    select p.voice_code into v_default from voice.voice_personas p where p.persona = 'female_warm' and p.language = l;
    if v_default is not null then
      update public.voice_choices set voice_code = v_default, updated_at = app.outbox_now() where tenant_id = p_tenant_id and language = l and voice_code = app.ovc_voice_code(p_tenant_id, l);
    else
      delete from public.voice_choices where tenant_id = p_tenant_id and language = l and voice_code = app.ovc_voice_code(p_tenant_id, l);
    end if;
  end loop;
  perform app.voice_edit(false);
  -- the voice stops being selectable (the usage ledger keeps its rows, so the catalogue row is switched off, not removed)
  update voice.voices v set active = false where v.code in (select app.ovc_voice_code(p_tenant_id, x) from unnest(array['en', 'te', 'hi', 'kn']) x);
  update public.own_voices
     set status = 'deleted', consenting_name = null, consent_sentence = null, sample_path = null, consent_path = null, bucket = null, provider_voice_id = null, deleted_at = app.outbox_now()
   where id = o.id returning * into o;
  return app.ovc_json(o);
end;
$$;
revoke all on function public.own_voice_deleted(uuid, uuid) from public, anon;
grant execute on function public.own_voice_deleted(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. selectable in Settings > AI assistant
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.assistant_settings drop constraint assistant_settings_voice_persona_check;
alter table public.assistant_settings add constraint assistant_settings_voice_persona_check check (voice_persona in ('female_warm', 'female_clear', 'male_calm', 'male_lively', 'own_voice'));

-- the personas, and per language whether a voice exists: the four stock ones, and `own_voice` while THIS workspace's own voice is ready (a full copy of job DM's function)
create or replace function public.assistant_voices(p_tenant_id uuid) returns jsonb
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
    select jsonb_agg(x.j order by x.persona, x.language) from (
      select p.persona, p.language, jsonb_build_object('persona', p.persona, 'language', p.language, 'voice_code', p.voice_code, 'synthetic', v.synthetic) as j
        from voice.voice_personas p join voice.voices v on v.code = p.voice_code and v.language = p.language and v.active
      union all
      select 'own_voice', v.language, jsonb_build_object('persona', 'own_voice', 'language', v.language, 'voice_code', v.code, 'synthetic', v.synthetic)
        from voice.voices v
       where v.active and v.code in (select app.ovc_voice_code(p_tenant_id, x) from unnest(array['en', 'te', 'hi', 'kn']) x)
         and exists (select 1 from public.own_voices o where o.tenant_id = p_tenant_id and o.status = 'ready')) x), '[]'::jsonb);
end;
$$;

-- a full copy of job DM's save with two changes: the persona `own_voice` is accepted only while the workspace's own voice is ready, and the voice notes follow it with the workspace's own voice codes
create or replace function public.assistant_settings_save(p_tenant_id uuid, p_settings jsonb) returns jsonb
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
  -- the Owner's own voice is selectable only while it is ready (job DP part 5)
  if p_settings ->> 'voice_persona' = 'own_voice' and not exists (select 1 from public.own_voices o where o.tenant_id = p_tenant_id and o.status = 'ready') then
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
    if a.voice_persona = 'own_voice' then
      for r in select v.language, v.code as voice_code from voice.voices v where v.active and v.code in (select app.ovc_voice_code(p_tenant_id, x) from unnest(array['en', 'te', 'hi', 'kn']) x) loop
        insert into public.voice_choices (tenant_id, language, voice_code, updated_by) values (p_tenant_id, r.language, r.voice_code, v_uid)
        on conflict (tenant_id, language) do update set voice_code = excluded.voice_code, updated_by = excluded.updated_by, updated_at = app.outbox_now();
      end loop;
    else
      for r in select p.language, p.voice_code from voice.voice_personas p join voice.voices v on v.code = p.voice_code and v.language = p.language and v.active where p.persona = a.voice_persona loop
        insert into public.voice_choices (tenant_id, language, voice_code, updated_by) values (p_tenant_id, r.language, r.voice_code, v_uid)
        on conflict (tenant_id, language) do update set voice_code = excluded.voice_code, updated_by = excluded.updated_by, updated_at = app.outbox_now();
      end loop;
    end if;
    perform app.voice_edit(false);
  end if;
  return public.assistant_settings_get(p_tenant_id);
end;
$$;
