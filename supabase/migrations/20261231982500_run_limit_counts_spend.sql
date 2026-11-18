-- The hourly cap counts requests that SPEND model money (planner, 18 Nov 2026; the number 30 and the daily cost allowance are unchanged):
--   * the door `max_runs_per_hour` (30) counts the runs of the last hour that used the model (cost_micros_used > 0); a fixed answer, a settings shortcut or a refusal costs nothing and does not use it up;
--   * a backstop of 120 runs an hour of ANY kind (key `max_runs_per_hour_any`, default 120 in code) keeps a loop from hammering;
--   * light-mode runs stay outside both, as before.
-- Staging, last 3 days: 419 runs for 419 owner messages (one run per message), 160 of them cost nothing.
do $patch$
declare
  v_def text := pg_get_functiondef('public.start_agent_run(uuid,uuid,text,text,text,uuid,text,jsonb,integer,jsonb)'::regprocedure);
  v_old text := $q$     or (select count(*) from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and not a.light)
       >= app.agent_limit('max_runs_per_hour', 0) then$q$;
  v_new text := $q$     or (select count(*) from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and not a.light and a.cost_micros_used > 0)
       >= app.agent_limit('max_runs_per_hour', 0)
     or (select count(*) from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and not a.light)
       >= app.agent_limit('max_runs_per_hour_any', 120) then$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'start_agent_run has changed: the spend-limit patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- when the assistant takes requests again: the later of the doors that are closed
create or replace function public.agent_runs_reopen_at(p_tenant_id uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_spend_limit integer := app.agent_limit('max_runs_per_hour', 0);
  v_any_limit   integer := app.agent_limit('max_runs_per_hour_any', 120);
  v_spend       integer;
  v_any         integer;
  v_at_spend    timestamptz;
  v_at_any      timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    return null;
  end if;
  select count(*) filter (where a.cost_micros_used > 0), count(*) into v_spend, v_any
    from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and not a.light;
  if v_spend_limit > 0 and v_spend >= v_spend_limit then
    -- the run that must age out for the spending count to drop below the limit: the (count - limit + 1)th oldest of the last hour
    select a.created_at + interval '1 hour' into v_at_spend
      from public.agent_runs a
     where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and not a.light and a.cost_micros_used > 0
     order by a.created_at asc offset (v_spend - v_spend_limit) limit 1;
  end if;
  if v_any_limit > 0 and v_any >= v_any_limit then
    select a.created_at + interval '1 hour' into v_at_any
      from public.agent_runs a
     where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and not a.light
     order by a.created_at asc offset (v_any - v_any_limit) limit 1;
  end if;
  return greatest(v_at_spend, v_at_any);   -- null when neither door is closed
end;
$$;
