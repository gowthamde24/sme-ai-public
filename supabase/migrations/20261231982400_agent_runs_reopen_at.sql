-- When the assistant takes requests again after the hourly run limit (18 Nov 2026): the owner is told a plain sentence with the time, never "could not make a plan".
-- The limit itself (30 runs per business per hour, agent_limits) is NOT changed. Returns null when the workspace is under the limit.
create function public.agent_runs_reopen_at(p_tenant_id uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := app.agent_limit('max_runs_per_hour', 0);
  v_count integer;
  v_at    timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    return null;
  end if;
  select count(*) into v_count from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour';
  if v_limit <= 0 or v_count < v_limit then
    return null;
  end if;
  -- the run that must age out for the count to drop below the limit: the (count - limit + 1)th oldest of the last hour
  select a.created_at + interval '1 hour' into v_at
    from public.agent_runs a
   where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour'
   order by a.created_at asc
  offset (v_count - v_limit) limit 1;
  return v_at;
end;
$$;
revoke all on function public.agent_runs_reopen_at(uuid) from public, anon;
grant execute on function public.agent_runs_reopen_at(uuid) to authenticated;
comment on function public.agent_runs_reopen_at(uuid) is 'When the assistant takes requests again after the hourly run limit (null: under the limit). Any member.';
