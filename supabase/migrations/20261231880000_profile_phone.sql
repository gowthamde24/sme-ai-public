-- Owner, 14 Nov 2026: "me / myself / my number / send Gowtham" must resolve to the signed-in owner's own phone from their profile, never ask for it.
--
-- The member's OWN phone lives on their workspace profile (workspace.member_profiles, one row per member and workspace), next to their name. It is shown to that member only: `my_profile_get` and
-- `my_profile_set` return it for the caller, and the team list (`people_profiles`, built on app.member_profile_json) does NOT carry it. It is set by the member themselves, signed in, in their own profile
-- (patch key `phone`): `phone_confirmed_at` records that they entered it while signed in. (A code sent to the number is the stronger check; it is not built.) The assistant reads it with
-- `task_my_phone` (the caller's own name and number, or nothing) and never asks for it in the chat.

alter table workspace.member_profiles
  add column phone text check (phone is null or phone ~ '^\+(00[0-9]{10,13}|[1-9][0-9]{9,14})$'),
  add column phone_confirmed_at timestamptz;
comment on column workspace.member_profiles.phone is 'PII: the member''s own phone number (E.164), set by that member in their own profile; shown to that member only. Goes with the membership. CLEAN-EXEMPT: strict pattern CHECK';
comment on column workspace.member_profiles.phone_confirmed_at is 'SAFE: when the member entered the number, signed in. CLEAN-EXEMPT: timestamp';

-- one number in one shape: "98480 12345", "+91 98480-12345", "919848012345" -> +919848012345
create function app.profile_phone_clean(p_raw text) returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when v ~ '^[6-9][0-9]{9}$' then '+91' || v
           when v ~ '^91[6-9][0-9]{9}$' then '+' || v
           when v ~ '^\+(00[0-9]{10,13}|[1-9][0-9]{9,14})$' then v   -- +00 is the test-number convention of the demo workspaces
           else null
         end
    from (select regexp_replace(coalesce(p_raw, ''), '[^0-9+]', '', 'g') as v) x
$$;
revoke all on function app.profile_phone_clean(text) from public;

create or replace function public.my_profile_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.member_profile_json(p_tenant_id, auth.uid())
         || (select jsonb_build_object('phone', m.phone, 'phone_confirmed', m.phone_confirmed_at is not null)
               from (select 1) one left join workspace.member_profiles m on m.workspace_id = p_tenant_id and m.user_id = auth.uid());
end;
$$;
revoke all on function public.my_profile_get(uuid) from public, anon;
grant execute on function public.my_profile_get(uuid) to authenticated;

-- my_profile_set: the same function with one more key (`phone`: a number, or null to remove it) and the caller's own number in its answer
do $patch$
declare
  v_def text := pg_get_functiondef('public.my_profile_set(uuid, jsonb)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def, $a$'address_as', 'preferred_chat_language')) then$a$, $a$'address_as', 'preferred_chat_language', 'phone')) then$a$);
  if v_new = v_def then raise exception 'my_profile_set: key list not found'; end if;
  v_def := v_new;
  v_new := replace(v_def, $a$  v_pcl    text;$a$, $a$  v_pcl    text;
  v_phone  text;$a$);
  if v_new = v_def then raise exception 'my_profile_set: declare not found'; end if;
  v_def := v_new;
  v_new := replace(v_def, $a$    if p_patch ? 'avatar_path' then$a$, $a$    if p_patch ? 'phone' then
      if jsonb_typeof(p_patch -> 'phone') not in ('string', 'null') then
        perform app.workspace_error('invalid');
      end if;
      v_phone := case when jsonb_typeof(p_patch -> 'phone') = 'null' then null else app.profile_phone_clean(p_patch ->> 'phone') end;
      if jsonb_typeof(p_patch -> 'phone') = 'string' and v_phone is null then
        perform app.workspace_error('invalid');
      end if;
      update workspace.member_profiles set phone = v_phone, phone_confirmed_at = case when v_phone is null then null else now() end where workspace_id = p_tenant_id and user_id = v_uid;
    end if;
    if p_patch ? 'avatar_path' then$a$);
  if v_new = v_def then raise exception 'my_profile_set: avatar branch not found'; end if;
  v_def := v_new;
  v_new := replace(v_def, $a$return app.member_profile_json(p_tenant_id, v_uid) || jsonb_build_object('old_avatar_path', v_old);$a$,
                   $a$return app.member_profile_json(p_tenant_id, v_uid) || jsonb_build_object('old_avatar_path', v_old)
         || (select jsonb_build_object('phone', m.phone, 'phone_confirmed', m.phone_confirmed_at is not null) from workspace.member_profiles m where m.workspace_id = p_tenant_id and m.user_id = v_uid);$a$);
  if v_new = v_def then raise exception 'my_profile_set: return not found'; end if;
  execute v_new;
end
$patch$;

-- the assistant: the caller's own name and number ("send me", "my number", "send Gowtham"), or nothing. Never anyone else's.
create function public.task_my_phone(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'deny' using errcode = '42501';
  end if;
  select coalesce(m.display_name, u.display_name) as name, m.phone into r
    from public.users u left join workspace.member_profiles m on m.workspace_id = p_tenant_id and m.user_id = u.id
   where u.id = auth.uid();
  return jsonb_build_object('name', r.name, 'phone', r.phone);
end;
$$;
revoke all on function public.task_my_phone(uuid) from public, anon;
grant execute on function public.task_my_phone(uuid) to authenticated;
