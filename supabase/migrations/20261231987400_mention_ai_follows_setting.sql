-- The AI line the outbox appends to the assistant's FIRST message to a customer follows the business's setting "Say 'AI assistant' when greeting" (owner decision 20 Nov 2026; default OFF),
-- stored in the Talk training document (`say_ai_when_greeting`). It replaces the 18 Nov rule (migration 20261231983200: always). A customer who ASKS whether they are talking to an AI always gets the truthful
-- answer: that is a fixed rule of the assistant's code, not a setting, and is not touched here.
create or replace function app.outbox_mention_ai(p_tenant uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select case when jsonb_typeof(t.doc -> 'say_ai_when_greeting') = 'boolean' then (t.doc ->> 'say_ai_when_greeting')::boolean end
                     from public.talk_training t where t.tenant_id = p_tenant), false)
$$;
