-- The assistant does the work: Settings -> Activity (docs/contracts/assistant-tools.md section 3). The action log (public.assistant_work_actions, migration 20261229090000) as a list, newest first,
-- for the Owner and an Admin: what the assistant changed, on whose request, from which chat message, and whether it can still be undone. READ ONLY; no table, no column. The stored undo itself
-- (a settings snapshot, an inverse route) is never returned: only whether an undo is available, done, expired or none.

create function public.assistant_actions_list(p_tenant_id uuid, p_since timestamptz default null, p_before timestamptz default null, p_limit integer default 50, p_action_id uuid default null, p_plan_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    perform app.aw_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.at desc, x.id desc)
      from (
        select a.created_at as at, a.id,
               jsonb_build_object(
                 'action_id', a.id, 'plan_id', a.plan_id, 'step_no', a.step_no, 'tool', a.tool, 'summary', a.summary, 'changed', a.changed,
                 'requested_by', a.requested_by, 'decided_by', a.decided_by, 'message_id', a.message_id, 'at', a.created_at, 'status', a.status, 'error', a.error,
                 'undo', case when a.status = 'undone' then 'done'
                              when a.undo is null or a.status <> 'done' then 'none'
                              when a.undo_until is not null and a.undo_until < now() then 'expired'
                              else 'available' end,
                 'undone_at', a.undone_at) as item
          from public.assistant_work_actions a
         where a.tenant_id = p_tenant_id
           and (p_since is null or a.created_at >= p_since)
           and (p_before is null or a.created_at < p_before)
           and (p_action_id is null or a.id = p_action_id)
           and (p_plan_id is null or a.plan_id = p_plan_id)
         order by a.created_at desc, a.id desc
         limit p_limit
      ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.assistant_actions_list(uuid, timestamptz, timestamptz, integer, uuid, uuid) from public, anon;
grant execute on function public.assistant_actions_list(uuid, timestamptz, timestamptz, integer, uuid, uuid) to authenticated;
comment on function public.assistant_actions_list(uuid, timestamptz, timestamptz, integer, uuid, uuid) is 'Settings -> Activity: the assistant''s action log, newest first (Owner, Admin). Never the stored undo, only its state. p_action_id: one entry (its undo); p_plan_id: one plan''s entries (its Undo skips what was undone one by one).';
