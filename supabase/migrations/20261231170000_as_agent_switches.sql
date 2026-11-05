-- A switch per helper, per workspace (C2's sidebar v2 "My AI team"; owner job 5 Nov 2026; docs/contracts/agents-switches.md). Until now an agent ran when three things were on: the platform flag,
-- the workspace's switch (tenant_agent_settings) and the agent type's platform flag / allow-list. This adds the FOURTH: the workspace's own switch for that helper (default on). It is ENFORCED where
-- every run starts (app.agent_switches_on), so a helper switched off cannot run: no decorative switch.

create table public.tenant_agent_switches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id),
  agent_name  text not null references public.agent_definitions (agent_name),
  enabled     boolean not null,
  updated_by  uuid not null,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, agent_name)
);
create index tenant_agent_switches_agent_idx on public.tenant_agent_switches (agent_name);
comment on table public.tenant_agent_switches is 'A workspace''s own on/off for one helper (agent type); no row = on. Written only by agent_switch_set (Owner).';
comment on column public.tenant_agent_switches.agent_name is 'SAFE: the agent type. CLEAN-EXEMPT: foreign key to agent_definitions';
comment on column public.tenant_agent_switches.updated_by is 'SAFE: the id of the Owner who switched it. CLEAN-EXEMPT: uuid';

alter table public.tenant_agent_switches enable row level security;
alter table public.tenant_agent_switches force row level security;
revoke all on public.tenant_agent_switches from public, anon, authenticated, service_role;
create trigger tenant_agent_switches_forbid_tenant_id_change before update on public.tenant_agent_switches for each row execute function app.forbid_tenant_id_change();
grant select on public.tenant_agent_switches to authenticated;
create policy tenant_agent_switches_select on public.tenant_agent_switches for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger audit_tenant_agent_switches after insert or update or delete on public.tenant_agent_switches for each row execute function app.audit_row_change('tenant_agent_switch', '');

-- the four switches (the fourth is new: the workspace's own switch for this helper; no row = on)
create or replace function app.agent_switches_on(p_tenant uuid, p_agent text) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select f.enabled from public.platform_flags f where f.key = 'agents_enabled'), false)
     and coalesce((select s.enabled from public.tenant_agent_settings s where s.tenant_id = p_tenant), false)
     and coalesce((
           select (d.requires_flag is null or coalesce((select f.enabled from public.platform_flags f where f.key = d.requires_flag), false))
              and (d.allowed_tenants is null or p_tenant = any (d.allowed_tenants))
             from public.agent_definitions d where d.agent_name = p_agent), false)
     and coalesce((select w.enabled from public.tenant_agent_switches w where w.tenant_id = p_tenant and w.agent_name = p_agent), true)
$$;

-- the helpers with a real switch, their state and why a switch is locked (Owner, Admin)
create function public.agent_switches_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_platform  boolean := coalesce((select f.enabled from public.platform_flags f where f.key = 'agents_enabled'), false);
  v_workspace boolean := coalesce((select s.enabled from public.tenant_agent_settings s where s.tenant_id = p_tenant_id), false);
  v_day_start timestamptz := (app.quote_today()::timestamp at time zone 'Asia/Kolkata');
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'agent', d.agent_name,
             'enabled', coalesce(w.enabled, true),
             'can_switch', v_platform and type_on,
             'reason_locked', case when not v_platform or not type_on then 'platform' when not v_workspace then 'workspace_off' end,
             'running', app.agent_switches_on(p_tenant_id, d.agent_name),
             'done_today', (select count(*) from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = d.agent_name and r.status = 'succeeded' and r.finished_at >= v_day_start)::integer)
           order by d.agent_name)
      from (select d0.*, ((d0.requires_flag is null or coalesce((select f.enabled from public.platform_flags f where f.key = d0.requires_flag), false))
                          and (d0.allowed_tenants is null or p_tenant_id = any (d0.allowed_tenants))) as type_on
              from public.agent_definitions d0 where d0.agent_name in ('assistant', 'research', 'requirement')) d
      left join public.tenant_agent_switches w on w.tenant_id = p_tenant_id and w.agent_name = d.agent_name
  ), '[]'::jsonb);
end;
$$;

-- switch one helper on or off for this workspace (Owner; switching off is always safe, so no second factor)
create function public.agent_switch_set(p_tenant_id uuid, p_agent text, p_enabled boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_agent is null or p_agent not in ('assistant', 'research', 'requirement') or p_enabled is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into public.tenant_agent_switches (tenant_id, agent_name, enabled, updated_by) values (p_tenant_id, p_agent, p_enabled, auth.uid())
  on conflict (tenant_id, agent_name) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  return (select x from jsonb_array_elements(public.agent_switches_get(p_tenant_id)) x where x ->> 'agent' = p_agent);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.agent_switches_get(uuid)', 'public.agent_switch_set(uuid, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
