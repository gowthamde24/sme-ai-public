-- Job DT (ADR 0115): THE OWNER'S FIRST REAL SIGN-IN. Three things the first run showed.
--
--   1. The second factor is OPTIONAL. app.require_aal2() (111 call sites, kept by name) no longer means "this session entered a code". It means
--        a) if the person TURNED A SECOND FACTOR ON (a verified authenticator in auth.mfa_factors), this session has entered it (aal2), and
--        b) the person SIGNED IN RECENTLY: the newest sign-in time in the signed token (the `amr` entries' timestamps, else `iat`) is within 10 minutes.
--      A person with no second factor (a Google or an e-mail sign-in alike) passes (a) and is asked only to sign in again when (b) fails. The refusal is still SQLSTATE SM306 with the sentence the
--      clients and tests already know; the API says which of the two it was before the database is reached (reauth_required / mfa_required).
--      The client-write trigger on memberships and tenants asks both too (through app.my_second_factor_on(), the one definer helper a client role may run: it answers for the caller only).
--   2. The business profile: name, business type (a business type of the packs, or "other" with a free-text label), city, phone, languages, logo. The OWNER edits it at any time, no second factor
--      (everything that shows the name reads it live). A type change inside the Lead Desk types and Other is free; into or out of a deep pack only when its data allows (SM791, DETAIL closed code).
--   3. Each member's own profile: name, language, picture (their own file in the business's private images bucket, or the Google photo by default). Max 5 MB, jpeg/png/webp (the API resizes).
--
-- SQLSTATEs: 42501 deny, 22023 invalid, SM791 type change refused (DETAIL: pack_data_present | lead_data_present | unknown_type), SM306 sign-in / second factor.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the second factor is optional; sensitive actions need a recent sign-in
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.second_factor_on(p_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified') $$;
revoke all on function app.second_factor_on(uuid) from public;

-- the same for the CALLER only, so the client-write trigger (security invoker) can ask it; it tells a person nothing but their own setting
create function app.my_second_factor_on() returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.second_factor_on(auth.uid()) $$;
revoke all on function app.my_second_factor_on() from public, anon;
grant execute on function app.my_second_factor_on() to authenticated;

-- When the person last signed in, from the SIGNED token: the newest timestamp among its `amr` entries (a password, a Google sign-in or a code entry each leave one; a token refresh does not), else `iat`.
create function app.last_signin_at() returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  c jsonb := auth.jwt();
  v bigint;
begin
  if c is null then
    return null;
  end if;
  if jsonb_typeof(c -> 'amr') = 'array' then
    select max((e ->> 'timestamp')::bigint) into v from jsonb_array_elements(c -> 'amr') e where jsonb_typeof(e) = 'object' and (e ->> 'timestamp') ~ '^[0-9]{9,11}$';
  end if;
  if v is null and (c ->> 'iat') ~ '^[0-9]{9,11}$' then
    v := (c ->> 'iat')::bigint;
  end if;
  return case when v is null then null else to_timestamp(v) end;
end;
$$;
revoke all on function app.last_signin_at() from public;

create or replace function app.require_aal2() returns void
language plpgsql
set search_path = ''
as $$
declare
  v_at timestamptz := app.last_signin_at();
begin
  -- a) a person who turned the second factor ON has entered it in this session
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' and app.second_factor_on(auth.uid()) then
    raise exception 'a second factor is required for this action' using errcode = 'SM306';
  end if;
  -- b) a recent sign-in (a token with no sign-in time at all is refused: fail closed)
  if v_at is null or v_at < now() - interval '10 minutes' then
    raise exception 'a second factor is required for this action' using errcode = 'SM306';
  end if;
end;
$$;

create or replace function app.guard_aal2_client_write() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c jsonb := auth.jwt();
  v bigint;
begin
  -- security INVOKER on purpose: current_user is the role running the statement. The same two halves as app.require_aal2(); the sign-in arithmetic is repeated here because a client role may not call
  -- app.last_signin_at().
  if current_user in ('authenticated', 'anon') then
    if jsonb_typeof(c -> 'amr') = 'array' then
      select max((e ->> 'timestamp')::bigint) into v from jsonb_array_elements(c -> 'amr') e where jsonb_typeof(e) = 'object' and (e ->> 'timestamp') ~ '^[0-9]{9,11}$';
    end if;
    if v is null and (c ->> 'iat') ~ '^[0-9]{9,11}$' then
      v := (c ->> 'iat')::bigint;
    end if;
    if v is null or to_timestamp(v) < now() - interval '10 minutes' then
      raise exception 'a second factor is required for this action' using errcode = 'SM306';
    end if;
    if coalesce(c ->> 'aal', '') <> 'aal2' and app.my_second_factor_on() then
      raise exception 'a second factor is required for this action' using errcode = 'SM306';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Where the person stands: is a second factor on, when did they sign in, is that recent enough for a sensitive action.
create function public.account_security_get() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := app.last_signin_at();
  v_provider text;
begin
  if auth.uid() is null then
    perform app.workspace_error('deny');
  end if;
  select coalesce(u.raw_app_meta_data ->> 'provider', 'email') into v_provider from auth.users u where u.id = auth.uid();
  return jsonb_build_object(
    'second_factor_on', app.second_factor_on(auth.uid()),
    'signed_in_at', v_at,
    'recent', v_at is not null and v_at >= now() - interval '10 minutes',
    'provider', case when v_provider in ('google', 'facebook') then v_provider else 'email' end);
end;
$$;
revoke all on function public.account_security_get() from public, anon;
grant execute on function public.account_security_get() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the business profile
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table packs.workspace_pack drop constraint workspace_pack_source_check;
alter table packs.workspace_pack add constraint workspace_pack_source_check check (source in ('signup', 'default', 'legacy', 'operator', 'owner'));

alter table workspace.profiles
  add column phone      text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  add column type_label text check (type_label is null or (char_length(btrim(type_label)) between 2 and 60 and app.text_is_clean(type_label))),
  add column logo_path  text check (logo_path is null or logo_path ~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');

create function app.workspace_conflict(p_reason text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the business type cannot be changed now' using errcode = 'SM791', detail = p_reason;
end;
$$;
revoke all on function app.workspace_conflict(text) from public;

-- the private bucket of one business for its images (the logo and the members' pictures), and the way back from a bucket name to the business (null for any other bucket)
create function app.images_bucket(p_tenant uuid) returns text
language sql
immutable
set search_path = ''
as $$ select 'img-' || p_tenant::text $$;
revoke all on function app.images_bucket(uuid) from public;

create function app.images_bucket_tenant(p_bucket text) returns uuid
language sql
immutable
set search_path = ''
as $$ select case when p_bucket ~ '^img-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(p_bucket, 5)::uuid else null end $$;
revoke all on function app.images_bucket_tenant(text) from public;
-- the storage rules below are evaluated as the signed-in caller, who must be able to run this one
grant execute on function app.images_bucket_tenant(text) to authenticated;

-- A deep pack is one whose modules hold its own records (the catalogue, orders, school fees); the Lead Desk types and Other are not.
create function app.pack_is_deep(p_code text, p_version integer) returns boolean
language sql
stable
set search_path = ''
as $$ select exists (select 1 from packs.pack_modules m where m.code = p_code and m.version = p_version and m.module in ('catalogue', 'orders', 'fees')) $$;
revoke all on function app.pack_is_deep(text, integer) from public;

-- the live view of the profile: the name is the workspace's own, the type is the pack it runs ("other" is the generic Lead Desk type with the Owner's own words)
create function app.workspace_business_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', t.name,
    'type', case when w.pack_code = 'general_business' then 'other' else w.pack_code end,
    'type_name', v.manifest -> 'names' ->> 'en',
    'type_label', case when w.pack_code = 'general_business' then p.type_label end,
    'city', p.town,
    'phone', p.phone,
    'languages', to_jsonb(coalesce(p.languages, '{}'::text[])),
    'logo_path', p.logo_path,
    'name_used_in', jsonb_build_array('assistant_greeting', 'voice_preview', 'call_opening', 'whatsapp_opening', 'menu_header'),
    'updated_at', p.updated_at)
  from public.tenants t
  join packs.workspace_pack w on w.tenant_id = t.id
  join packs.pack_versions v on v.code = w.pack_code and v.version = w.pack_version
  left join workspace.profiles p on p.tenant_id = t.id
  where t.id = p_tenant
$$;
revoke all on function app.workspace_business_json(uuid) from public;

create function public.workspace_business_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.workspace_business_json(p_tenant_id);
end;
$$;
revoke all on function public.workspace_business_get(uuid) from public, anon;
grant execute on function public.workspace_business_get(uuid) to authenticated;

-- Each key of the patch is optional (what is left out is kept; `null` clears city, phone). Keys: name, type, type_label, city, phone, languages. Only the Owner; no second factor, no recent sign-in:
-- the Owner may fix a name at any time.
create function public.workspace_business_set(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_city    text;
  v_phone   text;
  v_label   text;
  v_langs   text[];
  v_type    text;
  v_code    text;
  v_version integer;
  v_cur     packs.workspace_pack;
  v_changed text[] := '{}';
  v_old     text;
  v_table   text;
  v_has     boolean;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('name', 'type', 'type_label', 'city', 'phone', 'languages')) then
    perform app.workspace_error('invalid');
  end if;
  insert into workspace.profiles (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  select * into v_cur from packs.workspace_pack where tenant_id = p_tenant_id for update;

  -- the name (the workspace's own)
  if p_patch ? 'name' then
    v_name := btrim(coalesce(p_patch ->> 'name', ''));
    if jsonb_typeof(p_patch -> 'name') <> 'string' or char_length(v_name) not between 1 and 120 or not app.text_is_clean(v_name) then
      perform app.workspace_error('invalid');
    end if;
    update public.tenants set name = v_name where id = p_tenant_id;
    v_changed := array_append(v_changed, 'name');
  end if;

  -- the type: a pack code, or "other" (the generic Lead Desk type) with the Owner's own words
  if p_patch ? 'type' or p_patch ? 'type_label' then
    v_type := coalesce(p_patch ->> 'type', case when v_cur.pack_code = 'general_business' then 'other' else v_cur.pack_code end);
    if jsonb_typeof(coalesce(p_patch -> 'type', '"x"'::jsonb)) <> 'string' or v_type !~ '^[a-z][a-z0-9_]{1,30}$' then
      perform app.workspace_error('invalid');
    end if;
    v_code := case when v_type = 'other' then 'general_business' else v_type end;
    if v_code <> v_cur.pack_code then
      select max(v.version) into v_version from packs.pack_versions v where v.code = v_code and v.status in ('preview', 'published');
      if v_version is null then
        perform app.workspace_conflict('unknown_type');
      end if;
      -- out of a deep pack only when it holds none of its records; into one only when the business has no leads yet (a deep pack's screens would not show them)
      if app.pack_is_deep(v_cur.pack_code, v_cur.pack_version) and not app.pack_is_deep(v_code, v_version) then
        foreach v_table in array array['public.catalogue_items', 'public.orders', 'public.quotes', 'public.students', 'public.fee_plans'] loop
          if to_regclass(v_table) is not null then
            execute format('select exists (select 1 from %s where tenant_id = $1)', v_table) into v_has using p_tenant_id;
            if v_has then
              perform app.workspace_conflict('pack_data_present');
            end if;
          end if;
        end loop;
      end if;
      if app.pack_is_deep(v_code, v_version) and not app.pack_is_deep(v_cur.pack_code, v_cur.pack_version)
         and exists (select 1 from public.leads l where l.tenant_id = p_tenant_id) then
        perform app.workspace_conflict('lead_data_present');
      end if;
      v_old := v_cur.pack_code;
      update packs.workspace_pack set pack_code = v_code, pack_version = v_version, source = 'owner', chosen_by = v_uid, chosen_at = now() where tenant_id = p_tenant_id;
      perform app.apply_pack_fields(p_tenant_id, v_code, v_version, v_uid);
      perform app.write_audit_event(p_tenant_id, 'workspace_pack.choose', 'workspace_pack', p_tenant_id, null,
                                    jsonb_build_object('pack', v_code, 'from', v_old, 'version', v_version, 'source', 'owner'));
      v_changed := array_append(v_changed, 'type');
    end if;
    -- the words of "other": required for it, kept for no other type
    if v_code = 'general_business' then
      v_label := btrim(coalesce(case when p_patch ? 'type_label' then p_patch ->> 'type_label' else (select p.type_label from workspace.profiles p where p.tenant_id = p_tenant_id) end, ''));
      if char_length(v_label) not between 2 and 60 or not app.text_is_clean(v_label) then
        perform app.workspace_error('invalid');
      end if;
      update workspace.profiles set type_label = v_label where tenant_id = p_tenant_id;
      if p_patch ? 'type_label' then
        v_changed := array_append(v_changed, 'type_label');
      end if;
    else
      update workspace.profiles set type_label = null where tenant_id = p_tenant_id;
    end if;
  end if;

  if p_patch ? 'city' then
    v_city := nullif(btrim(coalesce(p_patch ->> 'city', '')), '');
    if p_patch -> 'city' <> 'null'::jsonb and (jsonb_typeof(p_patch -> 'city') <> 'string' or v_city is null or char_length(v_city) not between 2 and 80 or not app.text_is_clean(v_city)) then
      perform app.workspace_error('invalid');
    end if;
    update workspace.profiles set town = v_city where tenant_id = p_tenant_id;
    v_changed := array_append(v_changed, 'city');
  end if;
  if p_patch ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_patch ->> 'phone', '')), '');
    if p_patch -> 'phone' <> 'null'::jsonb and (jsonb_typeof(p_patch -> 'phone') <> 'string' or v_phone is null or v_phone !~ '^\+?[0-9 ()-]{6,20}$') then
      perform app.workspace_error('invalid');
    end if;
    update workspace.profiles set phone = v_phone where tenant_id = p_tenant_id;
    v_changed := array_append(v_changed, 'phone');
  end if;
  if p_patch ? 'languages' then
    if jsonb_typeof(p_patch -> 'languages') <> 'array' then
      perform app.workspace_error('invalid');
    end if;
    select coalesce(array_agg(distinct l order by l), '{}') into v_langs from jsonb_array_elements_text(p_patch -> 'languages') l;
    if cardinality(v_langs) not between 1 and 5 then
      perform app.workspace_error('invalid');
    end if;
    begin
      update workspace.profiles set languages = v_langs where tenant_id = p_tenant_id;
    exception when check_violation then
      perform app.workspace_error('invalid');
    end;
    v_changed := array_append(v_changed, 'languages');
  end if;

  update workspace.profiles set updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id;
  perform app.write_audit_event(p_tenant_id, 'workspace.business_saved', 'workspace', p_tenant_id, null, jsonb_build_object('changed', to_jsonb(v_changed)));
  return app.workspace_business_json(p_tenant_id);
end;
$$;
revoke all on function public.workspace_business_set(uuid, jsonb) from public, anon;
grant execute on function public.workspace_business_set(uuid, jsonb) to authenticated;

-- The logo: the API has put the file at logo/<uuid>.jpg in the business's images bucket with the caller's own token; here the reference is recorded after the database has looked at the file itself.
-- A null path removes the logo (the old file is deleted by the API).
create function public.workspace_images_ensure_bucket(p_tenant_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket text := app.images_bucket(p_tenant_id);
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (v_bucket, v_bucket, false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;
  return v_bucket;
end;
$$;
revoke all on function public.workspace_images_ensure_bucket(uuid) from public, anon;
grant execute on function public.workspace_images_ensure_bucket(uuid) to authenticated;

create function public.workspace_logo_set(p_tenant_id uuid, p_path text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_path is not null then
    if p_path !~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
       or not exists (select 1 from storage.objects o where o.bucket_id = app.images_bucket(p_tenant_id) and o.name = p_path and o.metadata ->> 'mimetype' = 'image/jpeg') then
      perform app.workspace_error('invalid');
    end if;
  end if;
  insert into workspace.profiles (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  select logo_path into v_old from workspace.profiles where tenant_id = p_tenant_id;
  update workspace.profiles set logo_path = p_path, updated_by = auth.uid(), updated_at = now() where tenant_id = p_tenant_id;
  perform app.write_audit_event(p_tenant_id, 'workspace.logo_saved', 'workspace', p_tenant_id, null, jsonb_build_object('removed', p_path is null));
  return jsonb_build_object('logo_path', p_path, 'old_path', v_old);
end;
$$;
revoke all on function public.workspace_logo_set(uuid, text) from public, anon;
grant execute on function public.workspace_logo_set(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. each member's own profile: name, language, picture
-- ---------------------------------------------------------------------------------------------------------------------------------
create table workspace.member_profiles (
  workspace_id uuid not null references public.tenants (id) on delete restrict,
  user_id      uuid not null,
  display_name text check (display_name is null or (char_length(btrim(display_name)) between 1 and 100 and app.text_is_clean(display_name))),
  language     text check (language is null or language in ('en', 'te', 'hi', 'kn', 'ta', 'ml')),
  avatar_path  text check (avatar_path is null or avatar_path ~ '^member/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id) references public.memberships (tenant_id, user_id) on delete cascade
);
alter table workspace.member_profiles enable row level security;
alter table workspace.member_profiles force row level security;
revoke all on workspace.member_profiles from public, anon, authenticated, service_role;

-- the Google photo is a Google address only (never another host)
create function app.google_picture_of(p_user uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when pic ~ '^https://[a-z0-9-]+\.googleusercontent\.com/[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]{1,500}$' then pic end
    from (select coalesce(u.raw_user_meta_data ->> 'picture', u.raw_user_meta_data ->> 'avatar_url') as pic from auth.users u where u.id = p_user) x
$$;
revoke all on function app.google_picture_of(uuid) from public;

create function app.member_profile_json(p_tenant uuid, p_user uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('user_id', p_user, 'display_name', coalesce(m.display_name, u.display_name), 'language', m.language, 'avatar_path', m.avatar_path, 'google_picture', app.google_picture_of(p_user))
    from (select 1) one
    left join workspace.member_profiles m on m.workspace_id = p_tenant and m.user_id = p_user
    left join public.users u on u.id = p_user
$$;
revoke all on function app.member_profile_json(uuid, uuid) from public;

create function public.my_profile_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.member_profile_json(p_tenant_id, auth.uid());
end;
$$;
revoke all on function public.my_profile_get(uuid) from public, anon;
grant execute on function public.my_profile_get(uuid) to authenticated;

-- Keys of the patch (all optional): display_name, language, avatar_path (null removes the picture). The path must be the caller's OWN file, already in the bucket (the API puts it there with the caller's token).
create function public.my_profile_set(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_lang   text;
  v_path   text;
  v_old    text;
begin
  if v_uid is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('display_name', 'language', 'avatar_path')) then
    perform app.workspace_error('invalid');
  end if;
  insert into workspace.member_profiles (workspace_id, user_id) values (p_tenant_id, v_uid) on conflict (workspace_id, user_id) do nothing;
  select avatar_path into v_old from workspace.member_profiles where workspace_id = p_tenant_id and user_id = v_uid;
  begin
    if p_patch ? 'display_name' then
      v_name := nullif(btrim(coalesce(p_patch ->> 'display_name', '')), '');
      if jsonb_typeof(p_patch -> 'display_name') <> 'string' or v_name is null then
        perform app.workspace_error('invalid');
      end if;
      update workspace.member_profiles set display_name = v_name where workspace_id = p_tenant_id and user_id = v_uid;
    end if;
    if p_patch ? 'language' then
      v_lang := p_patch ->> 'language';
      update workspace.member_profiles set language = v_lang where workspace_id = p_tenant_id and user_id = v_uid;
    end if;
    if p_patch ? 'avatar_path' then
      v_path := p_patch ->> 'avatar_path';
      if v_path is not null and (v_path not like 'member/' || v_uid::text || '/%'
         or not exists (select 1 from storage.objects o where o.bucket_id = app.images_bucket(p_tenant_id) and o.name = v_path and o.metadata ->> 'mimetype' = 'image/jpeg')) then
        perform app.workspace_error('invalid');
      end if;
      update workspace.member_profiles set avatar_path = v_path where workspace_id = p_tenant_id and user_id = v_uid;
    end if;
  exception when check_violation then
    perform app.workspace_error('invalid');
  end;
  update workspace.member_profiles set updated_at = now() where workspace_id = p_tenant_id and user_id = v_uid;
  return app.member_profile_json(p_tenant_id, v_uid) || jsonb_build_object('old_avatar_path', v_old);
end;
$$;
revoke all on function public.my_profile_set(uuid, jsonb) from public, anon;
grant execute on function public.my_profile_set(uuid, jsonb) to authenticated;

-- Everybody's name and picture, for the team list, the menu and the hand-off messages. Any member reads it.
create function public.people_profiles(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return (select coalesce(jsonb_agg(app.member_profile_json(p_tenant_id, m.user_id) order by m.created_at, m.user_id), '[]'::jsonb) from public.memberships m where m.tenant_id = p_tenant_id);
end;
$$;
revoke all on function public.people_profiles(uuid) from public, anon;
grant execute on function public.people_profiles(uuid) to authenticated;

-- Storage rules: a member reads the business's images bucket (that is what lets the API sign a URL in the caller's name); the Owner and Admin put and remove the logo; every member puts and removes THEIR OWN picture
-- (member/<their id>/...). Nothing else.
create policy images_objects_select on storage.objects for select to authenticated
  using (app.images_bucket_tenant(bucket_id) is not null and app.is_tenant_member(app.images_bucket_tenant(bucket_id)));
create policy images_objects_insert on storage.objects for insert to authenticated
  with check (app.images_bucket_tenant(bucket_id) is not null and (
    (name like 'logo/%' and app.has_tenant_role(app.images_bucket_tenant(bucket_id), array['owner', 'admin']::public.app_role[]))
    or (name like 'member/' || auth.uid()::text || '/%' and app.is_tenant_member(app.images_bucket_tenant(bucket_id)))));
create policy images_objects_delete on storage.objects for delete to authenticated
  using (app.images_bucket_tenant(bucket_id) is not null and (
    (name like 'logo/%' and app.has_tenant_role(app.images_bucket_tenant(bucket_id), array['owner', 'admin']::public.app_role[]))
    or (name like 'member/' || auth.uid()::text || '/%' and app.is_tenant_member(app.images_bucket_tenant(bucket_id)))));
