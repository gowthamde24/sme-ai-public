-- Job voice-picker (owner decision 28 Oct): each workspace chooses the voice its assistant uses on calls and in previews, per language.
--
--   workspace.call_voice_choices    one row per (workspace, language): the catalogue id of the chosen voice (no row = the default)
--   public.call_voice_get    any member
--   public.call_voice_set    Owner or Admin; a null id clears the choice (back to the default); every change is audited with the old and new id
--
-- The CATALOGUE (which voices exist) is data of the API (services/ai-api/app/conversation/data/voices.json), not a table: the API refuses an id that is not in it, and a stale or unknown id stored here is ignored when a
-- call is made (the default speaks), so a voice removed from the catalogue breaks nothing. No second factor is asked (it is a setting like the opening line). SQLSTATEs: 42501 deny, 22023 invalid.

create table workspace.call_voice_choices (
  workspace_id uuid not null references public.tenants (id) on delete restrict,
  language     text not null check (language in ('en', 'te', 'hi', 'kn')),
  voice_id     text not null check (voice_id ~ '^[a-z]{2}-[a-z0-9_]{2,40}$'),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, language)
);
alter table workspace.call_voice_choices enable row level security;
alter table workspace.call_voice_choices force row level security;
revoke all on workspace.call_voice_choices from public, anon, authenticated, service_role;

create function app.call_voice_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('choices', coalesce((select jsonb_object_agg(c.language, c.voice_id) from workspace.call_voice_choices c where c.workspace_id = p_tenant), '{}'::jsonb))
$$;
revoke all on function app.call_voice_json(uuid) from public;

create function public.call_voice_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.call_voice_json(p_tenant_id);
end;
$$;
revoke all on function public.call_voice_get(uuid) from public, anon;
grant execute on function public.call_voice_get(uuid) to authenticated;

create function public.call_voice_set(p_tenant_id uuid, p_language text, p_voice_id text) returns jsonb
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
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn') or (p_voice_id is not null and p_voice_id !~ '^[a-z]{2}-[a-z0-9_]{2,40}$') or (p_voice_id is not null and left(p_voice_id, 2) <> p_language) then
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
