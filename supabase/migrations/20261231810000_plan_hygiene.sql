-- Plan hygiene (owner screenshot 14 Nov 2026): a plan with nobody to contact is never a Needs-you item, a plan nobody answered does not stay for ever, and the API says where a task came from.
--   * app.task_json: now also `origin` (`screen` | `conversation`), so the web can tell a plan made in a conversation from one typed on the Tasks screen.
--   * public.tasks_list and public.nav_counts: a `planned` task with nobody to call and nobody waiting to be asked (contacts_total 0, nobody skipped) is not listed and not counted: there is nothing to approve.
--   * public.scheduler_expire_conversation_plans: besides conversation plans after 30 minutes, the worker also cancels a `planned` task with nobody in it after 30 minutes and any plan or question nobody answered
--     for 24 hours. Nothing was ever called or sent for them.

create or replace function app.task_json(t public.tasks) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'status', t.status, 'instruction', t.instruction, 'language', t.language, 'template', t.template, 'question', t.question,
           'plan', t.plan, 'estimate', t.estimate, 'estimated_paise', t.estimated_paise, 'cap_paise', t.cap_paise, 'spent_paise', t.spent_paise, 'pause_reason', t.pause_reason,
           'plan_sha256', t.plan_sha256, 'progress', app.task_counts(t.id), 'approved_at', t.approved_at, 'finished_at', t.finished_at, 'created_at', t.created_at, 'updated_at', t.updated_at,
           'origin', t.origin)
$$;
revoke all on function app.task_json(public.tasks) from public;

-- a plan that names nobody (and nobody waits to be asked): nothing to approve
create function app.plan_is_empty(t public.tasks) returns boolean
language sql
immutable
set search_path = ''
as $$
  select t.status = 'planned' and t.plan is not null and t.plan ? 'contacts_total'
     and coalesce(nullif(t.plan ->> 'contacts_total', '')::integer, 0) = 0
     and coalesce(nullif(t.plan #>> '{consent,skipped}', '')::integer, 0) = 0
$$;
revoke all on function app.plan_is_empty(public.tasks) from public;

create or replace function public.tasks_list(p_tenant_id uuid, p_status text default null, p_limit integer default 30, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_status is not null and p_status not in ('needs_answer', 'planned', 'approved', 'running', 'paused', 'done', 'cancelled')) then
    perform app.task_error('invalid');
  end if;
  return coalesce((select jsonb_agg(app.task_json(x) order by x.created_at desc, x.id)
                     from (select * from public.tasks t where t.tenant_id = p_tenant_id and (p_status is null or t.status = p_status) and (p_before is null or t.created_at < p_before)
                              and not (t.status in ('planned', 'needs_answer') and t.origin = 'conversation')
                              and not app.plan_is_empty(t)
                            order by t.created_at desc, t.id limit p_limit) x), '[]'::jsonb);
end;
$$;

do $do$
declare
  v_def  text := pg_get_functiondef('public.nav_counts(uuid)'::regprocedure);
  v_a    text := 'k.status = ''planned'' and k.origin = ''screen'')';
begin
  if position(v_a in v_def) = 0 then
    raise exception 'plan hygiene: nav_counts is not the one this migration expects';
  end if;
  execute replace(v_def, v_a, 'k.status = ''planned'' and k.origin = ''screen'' and not app.plan_is_empty(k))');
end
$do$;

create or replace function public.scheduler_expire_conversation_plans() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if not app.is_scheduler() then
    perform app.task_error('deny');
  end if;
  select array_agg(t.id) into v_ids from public.tasks t
   where t.status in ('needs_answer', 'planned')
     and ((t.origin = 'conversation' and t.created_at < now() - interval '30 minutes')
          or (app.plan_is_empty(t) and t.created_at < now() - interval '30 minutes')
          or t.created_at < now() - interval '24 hours');
  if v_ids is null then
    return 0;
  end if;
  update public.task_contacts set status = 'skipped', skip_reason = 'cancelled', finished_at = now() where task_id = any (v_ids) and status = 'waiting';
  update public.tasks set status = 'cancelled', pause_reason = null, finished_at = now() where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;
revoke all on function public.scheduler_expire_conversation_plans() from public, anon;
grant execute on function public.scheduler_expire_conversation_plans() to authenticated;
