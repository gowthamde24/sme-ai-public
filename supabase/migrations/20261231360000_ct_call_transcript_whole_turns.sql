-- ct: a call's transcript holds one line per assistant turn (owner, 7 Nov 2026). Until now each streaming piece of the model was stored as its own line, split even inside Telugu letters. New calls write
-- whole turns (app/telephony/call_session.py). This puts the stored pieces of the calls already made back together: consecutive assistant lines less than 3 s apart were one turn. Their English lines were
-- made from the pieces, so they are dropped (a merged line has none). Caller lines, and an assistant line on its own, are left as they are.

create function app.phone_transcript_whole_turns(p_lines jsonb) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_prev jsonb;
  v_line jsonb;
  v_text text;
  v_last_t numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return p_lines;
  end if;
  for v_line in select e from jsonb_array_elements(p_lines) with ordinality t(e, o) order by o loop
    if v_prev is not null and v_prev ->> 'who' = 'assistant' and v_line ->> 'who' = 'assistant'
       and (v_line ->> 't') is not null and v_last_t is not null and (v_line ->> 't')::numeric - v_last_t < 3 then
      v_text := v_prev ->> 'text';
      -- the pieces carry their own spaces; whole sentences stored apart do not
      if v_text ~ '[.?!।]$' and (v_line ->> 'text') !~ '^[[:space:]]' then
        v_text := v_text || ' ';
      end if;
      v_prev := (v_prev || jsonb_build_object('text', v_text || (v_line ->> 'text'))) - 'text_en';
    else
      if v_prev is not null then
        v_out := v_out || jsonb_build_array(v_prev);
      end if;
      v_prev := v_line;
    end if;
    v_last_t := (v_line ->> 't')::numeric;
  end loop;
  if v_prev is not null then
    v_out := v_out || jsonb_build_array(v_prev);
  end if;
  return v_out;
end;
$$;
revoke all on function app.phone_transcript_whole_turns(jsonb) from public, anon, authenticated, service_role;

-- a finished call never changes (app.phone_calls_guard): this one repair of the stored lines is the exception, and it touches only a transcript that really has pieces in it
alter table public.phone_calls disable trigger phone_calls_guard;
update public.phone_calls c set transcript = app.phone_transcript_whole_turns(c.transcript)
 where c.transcript is not null and jsonb_array_length(app.phone_transcript_whole_turns(c.transcript)) <> jsonb_array_length(c.transcript);
alter table public.phone_calls enable trigger phone_calls_guard;
