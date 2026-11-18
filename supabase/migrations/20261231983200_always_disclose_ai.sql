-- The assistant ALWAYS says it is an AI (owner, 18 Nov 2026): the Owner's "mention that I am an AI assistant" switch (workspace.opening_settings.mention_ai) is still stored and read, and ignored.
-- The API ignores it for calls and the opening line; this is the same rule for the assistant's WhatsApp messages: they are always labelled.
create or replace function app.outbox_mention_ai(p_tenant uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select true
$$;
