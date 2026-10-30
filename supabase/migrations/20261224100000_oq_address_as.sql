-- No gendered address (owner, 30 Oct): the assistant never says sir / madam (ಸರ್, मैडम, சார் ...) unless the person chose how to be addressed.
-- `address_as` is that choice, set by the member in their own profile ("How should I address you?"): a word or two, free text, optional. Empty = the neutral forms only.
alter table workspace.member_profiles add column address_as text
  check (address_as is null or (char_length(btrim(address_as)) between 1 and 30 and app.text_is_clean(address_as)));
comment on column workspace.member_profiles.address_as is 'SAFE: how this member wants the assistant to address them (a word or two they typed, e.g. Sir, Madam, Anna); optional';

create or replace function app.member_profile_json(p_tenant uuid, p_user uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('user_id', p_user, 'display_name', coalesce(m.display_name, u.display_name), 'language', m.language, 'avatar_path', m.avatar_path, 'google_picture', app.google_picture_of(p_user), 'address_as', m.address_as)
    from (select 1) one
    left join workspace.member_profiles m on m.workspace_id = p_tenant and m.user_id = p_user
    left join public.users u on u.id = p_user
$$;
revoke all on function app.member_profile_json(uuid, uuid) from public;

-- Keys of the patch (all optional): display_name, language, avatar_path (null removes the picture), address_as (null or empty clears it). The path must be the caller's OWN file, already in the bucket.
create or replace function public.my_profile_set(p_tenant_id uuid, p_patch jsonb) returns jsonb
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
  v_addr   text;
begin
  if v_uid is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('display_name', 'language', 'avatar_path', 'address_as')) then
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
    if p_patch ? 'address_as' then
      v_addr := nullif(btrim(coalesce(p_patch ->> 'address_as', '')), '');
      if jsonb_typeof(p_patch -> 'address_as') not in ('string', 'null') then
        perform app.workspace_error('invalid');
      end if;
      update workspace.member_profiles set address_as = v_addr where workspace_id = p_tenant_id and user_id = v_uid;
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
