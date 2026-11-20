-- Smaller samples (planner, 21 Nov 2026): the stored job-card samples are 24 kHz WAV (about 480 KB each); a phone should fetch about 55 KB of MP3. The system account (the scheduler the API's tools sign in as)
-- may REPLACE the sound and the content type of a sample whose words are the same (the same hash); nothing else changes: no characters are counted again (no voice credits are spent), the link and its 8-character hash stay.
create function public.ops_job_sample_recode(p_pack text, p_template_id text, p_language text, p_text_sha256 text, p_content_type text, p_audio_b64 text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_audio bytea;
begin
  perform ops.system_only();
  if p_audio_b64 is null or char_length(p_audio_b64) > 3000000 or p_content_type is null or p_content_type !~ '^audio/[a-z0-9.+-]{2,30}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  begin
    v_audio := decode(p_audio_b64, 'base64');
  exception when others then
    raise exception 'invalid input' using errcode = '22023';
  end;
  if v_audio is null or octet_length(v_audio) not between 1 and 2000000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  update ops.job_samples s set audio = v_audio, content_type = p_content_type
   where s.pack = p_pack and s.template_id = p_template_id and s.language = p_language and s.text_sha256 = p_text_sha256;
  if not found then
    return jsonb_build_object('recoded', false, 'reason', 'unknown_sample');
  end if;
  return jsonb_build_object('recoded', true, 'bytes', octet_length(v_audio));
end $$;
revoke all on function public.ops_job_sample_recode(text, text, text, text, text, text) from public, anon;
grant execute on function public.ops_job_sample_recode(text, text, text, text, text, text) to authenticated;
