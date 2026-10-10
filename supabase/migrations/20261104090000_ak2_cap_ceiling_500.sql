-- Job AK follow-up (owner decision): the hard wall on a workspace's daily AI cap moves from 20.00 to 500.00.
--
-- The wall is the same four places as before, all moved together (a hard wall, not a default: plans stay far below it):
--   agent_limits   daily_cost_micros            <= 500,000,000   (the operator default)
--   tenant_agent_settings.daily_cost_cap_micros  0 .. 500,000,000 (the workspace's own cap)
--   public.set_tenant_daily_cost_cap             refuses above 500,000,000 with 23514 'value not allowed' (Owner only, second factor, audited: unchanged)
--   plan_ai_allowances.daily_paise               <= 50,000 paise (= 500.00), so a plan can never grant more than the wall
-- Nothing else changes: the default stays 2.00, no existing row moves, no table is added. Amounts are millionths (1,000,000 = 1.00).

alter table public.agent_limits drop constraint agent_limits_daily_cost_ceiling_chk;
alter table public.agent_limits add constraint agent_limits_daily_cost_ceiling_chk
  check (limit_key <> 'daily_cost_micros' or limit_value <= 500000000);

alter table public.tenant_agent_settings drop constraint tenant_agent_settings_daily_cost_cap_chk;
alter table public.tenant_agent_settings add constraint tenant_agent_settings_daily_cost_cap_chk
  check (daily_cost_cap_micros is null or daily_cost_cap_micros between 0 and 500000000);
comment on column public.tenant_agent_settings.daily_cost_cap_micros is
  'The tenant''s own daily cost cap in millionths of the billing currency (NULL = the plan''s daily allowance, else the operator default in agent_limits). 0 .. 500000000 (500.00).';

alter table public.plan_ai_allowances add constraint plan_ai_allowances_daily_under_wall_chk check (daily_paise <= 50000);

create or replace function public.set_tenant_daily_cost_cap(p_tenant_id uuid, p_cap_micros bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  perform app.require_aal2();
  if p_cap_micros is not null and (p_cap_micros < 0 or p_cap_micros > 500000000) then
    perform app.agent_state_error('value');
  end if;
  insert into public.tenant_agent_settings as s (tenant_id, daily_cost_cap_micros, updated_by, updated_at)
  values (p_tenant_id, p_cap_micros, v_uid, now())
  on conflict (tenant_id) do update set daily_cost_cap_micros = excluded.daily_cost_cap_micros, updated_by = v_uid, updated_at = now();
  return jsonb_build_object('tenant_id', p_tenant_id, 'daily_cost_cap_micros', app.agent_daily_cap(p_tenant_id));
end;
$$;
