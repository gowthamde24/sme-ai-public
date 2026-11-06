-- pl: the line's business name and the assistant's name come from its workspace (owner, 6 Nov 2026: "The business name comes from the workspace; the AI disclosure is always there"; "The name
-- comes from the workspace setting (default Priya; the owner can rename it)"). The telephony worker's lookup of a rung number now also returns the workspace's name and the assistant's name
-- (Settings > Assistant; null when never set, and the API says Priya), which the opening line and the model use (the voice says it as written; app/pronunciation/brand.py keeps a brand like "Stack19" in English).
-- Same function, same guard (the scheduler principal only), one more key.
-- the name a call SAYS (owner, 6 Nov 2026: "Make sure the test call says 'Stack Nineteen', not 'Stack Nineteen Owner Test'. If the workspace name is not a good spoken name, use a separate
-- 'spoken business name' setting (falling back to the workspace name)"). Kept on the line, written by the operator like the line itself; null means the workspace's name.
alter table public.phone_numbers add column spoken_business_name text
  check (spoken_business_name is null or (char_length(btrim(spoken_business_name)) between 1 and 60 and app.text_is_clean(spoken_business_name) and spoken_business_name ~ '^[^<>{}@/\\|]+$'));
comment on column public.phone_numbers.spoken_business_name is 'SAFE: the business name as a call on this line says it (the operator''s entry, e.g. "Stack19"); null means the workspace name.';

create or replace function public.phone_line_find(p_number text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n public.phone_numbers;
  v_name text;
  v_assistant text;
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  select * into n from public.phone_numbers x where x.number = p_number;
  if not found then
    return null;
  end if;
  select t.name into v_name from public.tenants t where t.id = n.tenant_id;
  v_name := coalesce(nullif(btrim(n.spoken_business_name), ''), v_name);
  select a.assistant_name into v_assistant from public.assistant_settings a where a.tenant_id = n.tenant_id;
  return jsonb_build_object('tenant_id', n.tenant_id, 'inbound_on', n.inbound_on, 'business', v_name, 'assistant', v_assistant);
end;
$$;
revoke all on function public.phone_line_find(text) from public, anon;
grant execute on function public.phone_line_find(text) to authenticated;
