-- Pronunciation (job pronunciation-quality): the owner's own words and how they should SOUND, layered on top of the shared lexicon shipped with the API.
--
--   workspace.pronunciation_words   one row per (workspace, word): the word as written, a respelling an engine can read ("sounds like"), the language it is for (null = every language), where it came from
--                                   (owner typed it, or the weekly review suggested it), and the spoken message the owner flagged with "Mispronounced?" (an id only, never the words).
--   public.pronunciation_list       any member: the workspace's words
--   public.pronunciation_set        Owner or Admin: add a word or change it (one row per word, any case); at most 200 words a workspace
--   public.pronunciation_delete     Owner or Admin: remove one
-- No second factor (a spelling is not a sensitive change). SQLSTATEs: 42501 deny, 22023 invalid.

create table workspace.pronunciation_words (
  workspace_id      uuid not null references public.tenants (id) on delete restrict,
  id                uuid not null default gen_random_uuid(),
  word              text not null check (char_length(btrim(word)) between 1 and 60 and app.text_is_clean(word)),
  sounds_like       text not null check (char_length(btrim(sounds_like)) between 1 and 80 and app.text_is_clean(sounds_like)),
  language          text check (language is null or language in ('en', 'te', 'hi', 'kn', 'ta', 'ml')),
  source            text not null default 'owner' check (source in ('owner', 'suggested')),
  reason_message_id uuid,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (workspace_id, id)
);
create unique index pronunciation_words_word_key on workspace.pronunciation_words (workspace_id, lower(btrim(word)));
alter table workspace.pronunciation_words enable row level security;
alter table workspace.pronunciation_words force row level security;
revoke all on workspace.pronunciation_words from public, anon, authenticated, service_role;

create function app.pronunciation_json(r workspace.pronunciation_words) returns jsonb
language sql
immutable
set search_path = ''
as $$ select jsonb_build_object('id', r.id, 'word', r.word, 'sounds_like', r.sounds_like, 'language', r.language, 'source', r.source) $$;
revoke all on function app.pronunciation_json(workspace.pronunciation_words) from public;

create function public.pronunciation_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.pronunciation_json(w) order by lower(w.word), w.id) from workspace.pronunciation_words w where w.workspace_id = p_tenant_id), '[]'::jsonb);
end;
$$;
revoke all on function public.pronunciation_list(uuid) from public, anon;
grant execute on function public.pronunciation_list(uuid) to authenticated;

create function public.pronunciation_set(p_tenant_id uuid, p_word text, p_sounds_like text, p_language text, p_message_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_word  text := btrim(coalesce(p_word, ''));
  v_sound text := btrim(coalesce(p_sounds_like, ''));
  r       workspace.pronunciation_words;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if char_length(v_word) not between 1 and 60 or char_length(v_sound) not between 1 and 80 or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml')) then
    perform app.workspace_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pronunciation:' || p_tenant_id::text, 0));
  if not exists (select 1 from workspace.pronunciation_words w where w.workspace_id = p_tenant_id and lower(btrim(w.word)) = lower(v_word))
     and (select count(*) from workspace.pronunciation_words w where w.workspace_id = p_tenant_id) >= 200 then
    perform app.workspace_error('invalid');
  end if;
  begin
    insert into workspace.pronunciation_words as w (workspace_id, word, sounds_like, language, source, reason_message_id, created_by)
    values (p_tenant_id, v_word, v_sound, p_language, 'owner', p_message_id, auth.uid())
    on conflict (workspace_id, lower(btrim(word))) do update
      set word = excluded.word, sounds_like = excluded.sounds_like, language = excluded.language, source = 'owner',
          reason_message_id = coalesce(excluded.reason_message_id, w.reason_message_id), updated_at = now()
    returning * into r;
  exception when check_violation then
    perform app.workspace_error('invalid');
  end;
  return app.pronunciation_json(r);
end;
$$;
revoke all on function public.pronunciation_set(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.pronunciation_set(uuid, text, text, text, uuid) to authenticated;

create function public.pronunciation_delete(p_tenant_id uuid, p_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gone integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  delete from workspace.pronunciation_words w where w.workspace_id = p_tenant_id and w.id = p_id;
  get diagnostics v_gone = row_count;
  return v_gone > 0;
end;
$$;
revoke all on function public.pronunciation_delete(uuid, uuid) from public, anon;
grant execute on function public.pronunciation_delete(uuid, uuid) to authenticated;
