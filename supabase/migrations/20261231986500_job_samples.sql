-- The spoken samples of the job cards (owner decision 19-20 Nov 2026, spend cap Rs 350): ONE short recording per business-type template and language, made once from the template's own words and kept here, so the
-- New job sheet can play it ("hear what it says") without asking the voice service again. Platform data, not tenant data: it holds invented example words (no customer, no business of ours) and the sound of them.
--   * written only by the system (the scheduler account the API's generator signs in as): ops_job_sample_put keeps one row per (pack, template, language); the same words again change nothing (the hash of the words decides);
--   * the characters sent to the voice service are counted here and the database REFUSES to go past the cap (ops_job_sample_put raises when the total would pass it): the money limit does not rest on a script's good behaviour;
--   * read by every signed-in person (the template list shows a sample only when one exists); nobody reads the table directly.

create table ops.job_samples (
  pack          text not null check (pack ~ '^[a-z][a-z0-9_]{1,30}$'),
  template_id   text not null check (template_id ~ '^[a-z][a-z0-9_]{2,40}$'),
  language      text not null check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr')),
  text_sha256   text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  chars         integer not null check (chars between 1 and 2000),
  content_type  text not null check (content_type ~ '^audio/[a-z0-9.+-]{2,30}$'),
  audio         bytea not null check (octet_length(audio) between 1 and 2000000),
  created_at    timestamptz not null default now(),
  primary key (pack, template_id, language)
);
comment on table ops.job_samples is 'Platform data (not tenant data): the spoken sample of a job template in one language, made from invented example words; no personal data.';
comment on column ops.job_samples.text_sha256 is 'SAFE: a hash of the example words. CLEAN-EXEMPT: pattern CHECK';
comment on column ops.job_samples.chars is 'SAFE: a count. CLEAN-EXEMPT: range CHECK';
comment on column ops.job_samples.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column ops.job_samples.pack is 'SAFE: a business type id. CLEAN-EXEMPT: pattern CHECK';
comment on column ops.job_samples.template_id is 'SAFE: a job template id. CLEAN-EXEMPT: pattern CHECK';
comment on column ops.job_samples.audio is 'SAFE: the sound of invented example words. CLEAN-EXEMPT: size CHECK';
comment on column ops.job_samples.created_at is 'SAFE: a time. CLEAN-EXEMPT: a time';
comment on column ops.job_samples.content_type is 'SAFE: an audio type. CLEAN-EXEMPT: pattern CHECK';
alter table ops.job_samples enable row level security;
alter table ops.job_samples force row level security;
revoke all on ops.job_samples from public, anon, authenticated, service_role;

-- the system's view: what exists (keys, hash, characters) and the total spent so far
create function public.ops_job_sample_index() returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  return jsonb_build_object(
    'total_chars', coalesce((select sum(s.chars) from ops.job_samples s), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('pack', s.pack, 'template_id', s.template_id, 'language', s.language, 'sha256', s.text_sha256, 'chars', s.chars) order by s.pack, s.template_id, s.language) from ops.job_samples s), '[]'::jsonb));
end $$;
revoke all on function public.ops_job_sample_index() from public, anon;
grant execute on function public.ops_job_sample_index() to authenticated;

-- one sample (p_cap_chars: the total characters all samples together may ever hold; the call is refused when this one would pass it). Replacing a sample with other words counts the new characters again (they were spent again).
create function public.ops_job_sample_put(p_pack text, p_template_id text, p_language text, p_text_sha256 text, p_chars integer, p_content_type text, p_audio_b64 text, p_cap_chars integer) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_old   ops.job_samples;
  v_total bigint;
  v_audio bytea;
begin
  perform ops.system_only();
  if p_cap_chars is null or p_cap_chars not between 1 and 200000 or p_audio_b64 is null or char_length(p_audio_b64) > 3000000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  begin
    v_audio := decode(p_audio_b64, 'base64');
  exception when others then
    raise exception 'invalid input' using errcode = '22023';
  end;
  select * into v_old from ops.job_samples s where s.pack = p_pack and s.template_id = p_template_id and s.language = p_language;
  if found and v_old.text_sha256 = p_text_sha256 then
    return jsonb_build_object('stored', false, 'reason', 'same_words', 'total_chars', (select sum(chars) from ops.job_samples));
  end if;
  select coalesce(sum(s.chars), 0) into v_total from ops.job_samples s;
  if v_total + p_chars > p_cap_chars then
    raise exception 'spend cap reached' using errcode = 'SM980';
  end if;
  insert into ops.job_samples as s (pack, template_id, language, text_sha256, chars, content_type, audio)
  values (p_pack, p_template_id, p_language, p_text_sha256, p_chars, p_content_type, v_audio)
  on conflict (pack, template_id, language) do update set text_sha256 = excluded.text_sha256, chars = s.chars + excluded.chars, content_type = excluded.content_type, audio = excluded.audio, created_at = now();
  return jsonb_build_object('stored', true, 'total_chars', (select sum(chars) from ops.job_samples));
end $$;
revoke all on function public.ops_job_sample_put(text, text, text, text, integer, text, text, integer) from public, anon;
grant execute on function public.ops_job_sample_put(text, text, text, text, integer, text, text, integer) to authenticated;

-- every signed-in person: which samples exist (the template list marks them) and one sample's sound
create function public.job_sample_list() returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('pack', s.pack, 'template_id', s.template_id, 'language', s.language, 'sha8', left(s.text_sha256, 8)) order by s.pack, s.template_id, s.language) from ops.job_samples s), '[]'::jsonb);
end $$;
revoke all on function public.job_sample_list() from public, anon;
grant execute on function public.job_sample_list() to authenticated;

create function public.job_sample_get(p_pack text, p_template_id text, p_language text) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  s ops.job_samples;
begin
  if auth.uid() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into s from ops.job_samples x where x.pack = p_pack and x.template_id = p_template_id and x.language = p_language;
  if not found then
    return null;
  end if;
  return jsonb_build_object('sha8', left(s.text_sha256, 8), 'content_type', s.content_type, 'audio_b64', encode(s.audio, 'base64'));
end $$;
revoke all on function public.job_sample_get(text, text, text) from public, anon;
grant execute on function public.job_sample_get(text, text, text) to authenticated;
