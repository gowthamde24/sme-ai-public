-- Job AY (ADR 0069): the Main agent may cite a catalogue item as a source (find_catalogue_items). public.assistant_save_reply is replaced as a full copy of the job AS definition with one more word in the
-- list of source types (test_migration_copies.py pins that nothing else changed). A new migration; earlier files are not edited. The grants of the function are kept by "create or replace".

create or replace function public.assistant_save_reply(
  p_run_id uuid, p_message_id uuid, p_body text, p_language text, p_sources jsonb, p_drafts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.agent_runs;
  m      public.assistant_messages;
  v_seq  integer;
  v_body text := btrim(coalesce(p_body, ''));
begin
  r := app.agent_open_run(p_run_id);
  if r.conversation_id is null or p_message_id is null or char_length(v_body) not between 1 and 12000
     or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn', 'ta'))
     or not app.assistant_pairs_ok(coalesce(p_sources, '[]'::jsonb), array['quote', 'lead', 'enquiry', 'order', 'company', 'customer', 'price_item', 'followup_draft', 'reply_draft', 'outbox_message', 'call_request', 'store_visit', 'catalogue_item'])
     or not app.assistant_pairs_ok(coalesce(p_drafts, '[]'::jsonb), array['quote', 'followup_draft', 'reply_draft', 'enquiry', 'store_visit']) then
    perform app.agent_state_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant:' || r.conversation_id::text, 0));
  select * into m from public.assistant_messages x where x.id = p_message_id;
  if found then
    if m.tenant_id <> r.tenant_id or m.run_id is distinct from r.id or m.role <> 'assistant' then
      raise exception 'message id already used' using errcode = '23505', constraint = 'assistant_messages_pkey', table = 'assistant_messages', schema = 'public';
    end if;
    return jsonb_build_object('replayed', true, 'message_id', m.id, 'seq', m.seq);
  end if;
  select coalesce(max(x.seq), 0) + 1 into v_seq from public.assistant_messages x where x.tenant_id = r.tenant_id and x.conversation_id = r.conversation_id;
  insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, language, sources, drafts, run_id, created_by)
  values (p_message_id, r.tenant_id, r.conversation_id, v_seq, 'assistant', v_body, p_language, coalesce(p_sources, '[]'::jsonb), coalesce(p_drafts, '[]'::jsonb), r.id, r.started_by);
  update public.assistant_conversations set updated_at = now() where tenant_id = r.tenant_id and id = r.conversation_id;
  return jsonb_build_object('replayed', false, 'message_id', p_message_id, 'seq', v_seq);
end;
$$;
