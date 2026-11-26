-- AI employees, calls (26 Nov 2026): (1) a finished call may still be TAGGED with the employee that took it (the guard lets `ai_employee_id` change, like `assistant_name`), (2) the scheduler's tag function,
-- (3) `employee_runtime` also falls back to the default employee when the named employee is outside its OWN hours (an employee's hours only narrow the legal window; outside them the default answers).
do $do$
declare
  v_def text := pg_get_functiondef('app.phone_calls_guard()'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def, '''assistant_name'',', '''assistant_name'', ''ai_employee_id'',');
  if v_new = v_def then
    raise exception 'phone_calls_guard: anchor not found';
  end if;
  execute v_new;
end
$do$;

create function public.employee_call_tag(p_tenant_id uuid, p_call_id uuid, p_employee_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_scheduler() or p_tenant_id is null or p_call_id is null or p_employee_id is null then
    perform app.employee_error('deny');
  end if;
  update public.phone_calls set ai_employee_id = p_employee_id
   where tenant_id = p_tenant_id and id = p_call_id and ai_employee_id is null
     and exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant_id and e.id = p_employee_id);
end;
$$;
revoke all on function public.employee_call_tag(uuid, uuid, uuid) from public, anon;
grant execute on function public.employee_call_tag(uuid, uuid, uuid) to authenticated;

create or replace function public.employee_runtime(p_tenant_id uuid, p_employee_id uuid default null, p_line text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_employee_id;
  v_json jsonb;
  v_now timestamp := now() at time zone 'Asia/Kolkata';
  v_min integer := extract(hour from v_now)::integer * 60 + extract(minute from v_now)::integer;
begin
  if auth.uid() is null or not app.is_scheduler() or p_tenant_id is null then
    perform app.employee_error('deny');
  end if;
  if v_id is null and p_line is not null then
    select n.ai_employee_id into v_id from public.phone_numbers n where n.tenant_id = p_tenant_id and n.number = p_line;
  end if;
  -- an employee that is not on never answers; one outside its own (narrower) hours does not either: the default employee does
  if v_id is not null and not exists (
       select 1 from public.ai_employees e
        where e.tenant_id = p_tenant_id and e.id = v_id and e.status = 'on'
          and (e.hours is null
               or (extract(isodow from v_now)::integer in (select jsonb_array_elements_text(e.hours -> 'days')::integer)
                   and v_min >= (e.hours ->> 'from_minute')::integer and v_min < (e.hours ->> 'to_minute')::integer))) then
    v_id := null;
  end if;
  if v_id is null then
    select e.id into v_id from public.ai_employees e where e.tenant_id = p_tenant_id and e.is_default and e.status <> 'archived';
  end if;
  if v_id is null then
    return null;
  end if;
  v_json := app.employee_json(p_tenant_id, v_id);
  return v_json - 'calls_today' - 'created_at' - 'updated_at';
end;
$$;
