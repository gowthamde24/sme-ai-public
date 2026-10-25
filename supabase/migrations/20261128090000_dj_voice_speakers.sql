-- Job DJ (night run C1, ADR 0093): real voice notes groundwork. The voice a business chooses for a language is DATA (voice.voices and public.voice_choices, job CV); this adds the one thing a real provider needs
-- that the data did not hold: the provider's SPEAKER name for a voice (Sarvam's Bulbul speakers are lower case names such as `shubh`), and what the worker's plan hands the hook: the voice's provider and speaker.
--
--   voice.voices.speaker                 the provider's name for the voice (null for the synthetic voices of the fake provider)
--   app.operator_register_voice(...)     the ONE way to add a voice: the operator names the provider, the language, the speaker and (for a real voice) who listened and when. A real voice nobody has listened to
--                                        is refused by the table's own CHECK (job CV): `synthetic or (reviewed_by is not null and reviewed_at is not null)`.
--   public.scheduler_voice_plan          a full copy of the job CV function plus two keys in the answer: 'provider' and 'speaker' of the chosen voice. The worker refuses a voice whose provider is not the one it is configured
--                                        with (a reviewed Sarvam voice is never spoken by the fake provider and the other way round).
-- No voice is added here: which Bulbul speaker suits Telugu, Hindi, Kannada and English is a decision of a native speaker who listens (docs/runbooks/voice-notes-real.md).

alter table voice.voices add column speaker text check (speaker is null or speaker ~ '^[a-z][a-z0-9_]{1,39}$');
comment on column voice.voices.speaker is 'SAFE: the provider''s name for the voice, from the operator''s catalogue. CLEAN-EXEMPT: charset-limited CHECK';

create function app.operator_register_voice(p_code text, p_provider text, p_language text, p_label text, p_speaker text, p_reviewed_by text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  if p_provider = 'fake' or p_speaker is null then
    raise exception 'a real voice names its provider and its speaker' using errcode = '22023';
  end if;
  insert into voice.voices (code, provider, language, label, synthetic, speaker, reviewed_by, reviewed_at)
  values (p_code, p_provider, p_language, p_label, false, p_speaker, p_reviewed_by, case when p_reviewed_by is null then null else now() end);
end;
$$;
revoke all on function app.operator_register_voice(text, text, text, text, text, text) from public, anon, authenticated, service_role;

create or replace function public.scheduler_voice_plan(p_tenant_id uuid, p_message_id uuid) returns jsonb
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
  vv      voice.voices;
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
  select * into vv from voice.voices x where x.code = v_voice and x.language = m.language;
  return jsonb_build_object('voice', true, 'voice_code', v_voice, 'provider', vv.provider, 'speaker', vv.speaker, 'speed', s.speed, 'language', m.language, 'text', v_text, 'chars', char_length(v_text));
end;
$$;
