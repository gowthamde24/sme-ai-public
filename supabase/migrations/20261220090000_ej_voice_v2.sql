-- Job voice system v2 (owner, 29 Oct 2026): the assistant's voice is the owner's choice in EVERY language the product speaks.
--   * the workspace has a GENDER (female by default; one switch): public.call_voice_gender_set flips it and clears every per-language choice (a choice is always a voice of the workspace's gender, so after a flip they all go back to the new gender's defaults)
--   * the per-language choice (workspace.call_voice_choices) now also takes Tamil and Malayalam
--   * public.call_voice_get answers {choices, gender}
-- The CATALOGUE (which voices exist, their gender, language and style) stays data of the API (services/ai-api/app/conversation/data/voices.json); the API checks that a chosen voice is of that language AND of the workspace's gender.
-- Nothing here speaks or sends anything. SQLSTATEs as before: 42501 deny, 22023 invalid.

alter table workspace.call_voice_choices drop constraint call_voice_choices_language_check;
alter table workspace.call_voice_choices add constraint call_voice_choices_language_check check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml'));

create table workspace.call_voice_gender (
  workspace_id uuid primary key references public.tenants (id) on delete restrict,
  gender       text not null check (gender in ('female', 'male')),
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
alter table workspace.call_voice_gender enable row level security;
alter table workspace.call_voice_gender force row level security;
revoke all on workspace.call_voice_gender from public, anon, authenticated, service_role;

create or replace function app.call_voice_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'choices', coalesce((select jsonb_object_agg(c.language, c.voice_id) from workspace.call_voice_choices c where c.workspace_id = p_tenant), '{}'::jsonb),
    'gender', coalesce((select g.gender from workspace.call_voice_gender g where g.workspace_id = p_tenant), 'female'))
$$;
revoke all on function app.call_voice_json(uuid) from public;

create or replace function public.call_voice_set(p_tenant_id uuid, p_language text, p_voice_id text) returns jsonb
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
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml') or (p_voice_id is not null and p_voice_id !~ '^[a-z]{2}-[a-z0-9_]{2,40}$') or (p_voice_id is not null and left(p_voice_id, 2) <> p_language) then
    perform app.workspace_error('invalid');
  end if;
  select c.voice_id into v_old from workspace.call_voice_choices c where c.workspace_id = p_tenant_id and c.language = p_language;
  if p_voice_id is null then
    delete from workspace.call_voice_choices where workspace_id = p_tenant_id and language = p_language;
  else
    insert into workspace.call_voice_choices as c (workspace_id, language, voice_id, updated_by, updated_at)
    values (p_tenant_id, p_language, p_voice_id, auth.uid(), now())
    on conflict (workspace_id, language) do update set voice_id = excluded.voice_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  perform app.write_audit_event(p_tenant_id, 'assistant.call_voice_changed', 'workspace', p_tenant_id,
    jsonb_build_object('language', p_language, 'voice_id', v_old), jsonb_build_object('language', p_language, 'voice_id', p_voice_id));
  return app.call_voice_json(p_tenant_id);
end;
$$;
revoke all on function public.call_voice_set(uuid, text, text) from public, anon;
grant execute on function public.call_voice_set(uuid, text, text) to authenticated;

create function public.call_voice_gender_set(p_tenant_id uuid, p_gender text) returns jsonb
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
  if p_gender is null or p_gender not in ('female', 'male') then
    perform app.workspace_error('invalid');
  end if;
  select coalesce((select g.gender from workspace.call_voice_gender g where g.workspace_id = p_tenant_id), 'female') into v_old;
  insert into workspace.call_voice_gender as g (workspace_id, gender, updated_by, updated_at) values (p_tenant_id, p_gender, auth.uid(), now())
  on conflict (workspace_id) do update set gender = excluded.gender, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  if v_old is distinct from p_gender then
    delete from workspace.call_voice_choices where workspace_id = p_tenant_id;   -- every choice was a voice of the old gender: back to the new gender's defaults
  end if;
  perform app.write_audit_event(p_tenant_id, 'assistant.call_voice_gender_changed', 'workspace', p_tenant_id, jsonb_build_object('gender', v_old), jsonb_build_object('gender', p_gender));
  return app.call_voice_json(p_tenant_id);
end;
$$;
revoke all on function public.call_voice_gender_set(uuid, text) from public, anon;
grant execute on function public.call_voice_gender_set(uuid, text) to authenticated;
comment on function public.call_voice_gender_set(uuid, text) is 'Voice v2: the workspace''s voice gender (female or male); a change clears the per-language choices. Owner or Admin; audited.';
