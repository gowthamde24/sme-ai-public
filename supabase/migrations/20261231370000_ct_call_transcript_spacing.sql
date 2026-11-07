-- ct: a space where a Latin word meets an Indian-script word, in the assistant's stored lines (owner, 7 Nov 2026: "నుంచిAI assistant ని"). The earlier calls' lines were stored as streaming pieces whose
-- leading spaces had been trimmed, so the repair (20261231360000) joined some words together. New calls keep their spaces (app/text_spacing.py). Only a Latin LETTER next to an Indian letter or vowel
-- sign is separated; digits, joiners and punctuation are left alone. Caller lines and every English line (text_en) are untouched.

create function app.phone_transcript_space_scripts(p_lines jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_lines is null or jsonb_typeof(p_lines) <> 'array' then p_lines
    else coalesce((
      select jsonb_agg(
               case when e ->> 'who' = 'assistant' and (e ->> 'text') is not null
                    then jsonb_set(e, '{text}', to_jsonb(regexp_replace(regexp_replace(e ->> 'text', '([A-Za-z])([ऀ-෿])', '\1 \2', 'g'), '([ऀ-෿])([A-Za-z])', '\1 \2', 'g')))
                    else e end
               order by o)
        from jsonb_array_elements(p_lines) with ordinality t(e, o)), '[]'::jsonb)
  end
$$;
revoke all on function app.phone_transcript_space_scripts(jsonb) from public, anon, authenticated, service_role;

alter table public.phone_calls disable trigger phone_calls_guard;
update public.phone_calls c set transcript = app.phone_transcript_space_scripts(c.transcript)
 where c.transcript is not null and app.phone_transcript_space_scripts(c.transcript) is distinct from c.transcript;
alter table public.phone_calls enable trigger phone_calls_guard;
