-- Job AI (owner, 10-11 Nov 2026): the "mention that I'm an AI assistant in the greeting" switch (workspace.opening_settings, ADR 0116, default ON) now also reaches the PHONE path.
--   public.phone_mention_ai_for_call(tenant)   the scheduler account (the phone line runs as it) reads the workspace's switch for a call; a read only; no row = ON
-- Nothing else changes: who may set the switch, the audit of every change, and the per-campaign override stay as they are (migration 20261211090200).
-- The line itself keeps the honest-answer rule whatever the switch says, and stores whether the opening really said it was an AI (phone_calls.ai_disclosed).

create function public.phone_mention_ai_for_call(p_tenant_id uuid) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select s.mention_ai from workspace.opening_settings s
                    where s.workspace_id = p_tenant_id and s.campaign_key = '00000000-0000-0000-0000-000000000000'), true);
end;
$$;

revoke all on function public.phone_mention_ai_for_call(uuid) from public, anon;
grant execute on function public.phone_mention_ai_for_call(uuid) to authenticated;
