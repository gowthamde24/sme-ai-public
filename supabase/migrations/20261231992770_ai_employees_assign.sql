-- AI employees, assignment (26 Nov 2026): a task and a job (what the owner asks to be done) can name the employee that does it; none = the default employee.
--   public.employee_assign(tenant, kind, id, employee)   Owner/Admin: kind 'task' | 'job'; employee null takes the assignment away
--   public.task_employee(tenant, task)                   the employee a task's calls are made by (any member; null: the default one), for the dialer that places them
create function public.employee_assign(p_tenant_id uuid, p_kind text, p_id uuid, p_employee_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.employee_error('deny');
  end if;
  if p_kind is null or p_kind not in ('task', 'job') then
    perform app.employee_error('invalid');
  end if;
  if p_employee_id is not null and not exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant_id and e.id = p_employee_id and e.status <> 'archived') then
    perform app.employee_error('reference');
  end if;
  if p_kind = 'task' then
    update public.tasks set ai_employee_id = p_employee_id where tenant_id = p_tenant_id and id = p_id and status not in ('done', 'cancelled');
  else
    update public.jobs_meta set ai_employee_id = p_employee_id, updated_at = now() where tenant_id = p_tenant_id and id = p_id;
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    perform app.employee_error('reference');
  end if;
  return jsonb_build_object('kind', p_kind, 'id', p_id, 'employee_id', p_employee_id);
end;
$$;
revoke all on function public.employee_assign(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.employee_assign(uuid, text, uuid, uuid) to authenticated;

create function public.task_employee(p_tenant_id uuid, p_task_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp uuid;
begin
  if auth.uid() is null or p_tenant_id is null or p_task_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.employee_error('deny');
  end if;
  select t.ai_employee_id into v_emp from public.tasks t where t.tenant_id = p_tenant_id and t.id = p_task_id;
  if v_emp is null or not exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant_id and e.id = v_emp and e.status = 'on') then
    return null;   -- the default employee does it
  end if;
  return app.employee_json(p_tenant_id, v_emp) - 'calls_today' - 'created_at' - 'updated_at';
end;
$$;
revoke all on function public.task_employee(uuid, uuid) from public, anon;
grant execute on function public.task_employee(uuid, uuid) to authenticated;
