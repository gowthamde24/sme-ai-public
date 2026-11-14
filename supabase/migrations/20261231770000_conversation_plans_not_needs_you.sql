-- A plan the assistant PROPOSES in a conversation (typed chat, composer or Talk live) lives in that conversation's card and waits for the owner's yes (30 minutes). It must never turn up as a
-- "Needs you" item or in the sidebar badge (owner, 14 Nov 2026: a raw Talk live sentence appeared as a Needs-you "Review" item: it was a plan proposed from that sentence and never answered).
--   * tasks.origin: `screen` (planned on the Tasks screen or "Ask the assistant" form: the owner meant it, it waits in Needs you) or `conversation` (proposed inside a conversation).
--   * public.task_mark_conversation(tenant, task): the API marks a plan it made for a conversation, while it is still being planned.
--   * public.tasks_list: a `planned` task of origin `conversation` is not listed (it is the card's business; an answered one has another status and is listed as before).
--   * nav_counts: the same rule for the badge; and a plan paused at the day's call limit (pause_reason daily_limit) is counted like one paused at its spending cap.

alter table public.tasks add column origin text not null default 'screen' check (origin in ('screen', 'conversation'));
comment on column public.tasks.origin is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create function public.task_mark_conversation(p_tenant_id uuid, p_task_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  update public.tasks set origin = 'conversation' where id = p_task_id and tenant_id = p_tenant_id and status in ('needs_answer', 'planned');
  if not found then
    perform app.task_error('reference');
  end if;
end;
$$;
revoke all on function public.task_mark_conversation(uuid, uuid) from public, anon;
grant execute on function public.task_mark_conversation(uuid, uuid) to authenticated;

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
                              and not (t.status = 'planned' and t.origin = 'conversation')
                            order by t.created_at desc, t.id limit p_limit) x), '[]'::jsonb);
end;
$$;

do $do$
declare
  v_def  text := pg_get_functiondef('public.nav_counts(uuid)'::regprocedure);
  v_a    text := 'select count(*) from public.tasks k where k.tenant_id = p_tenant_id and k.status = ''planned'')';
  v_b    text := 'k.status = ''paused'' and k.pause_reason = ''cap'')';
begin
  if position(v_a in v_def) = 0 or position(v_b in v_def) = 0 then
    raise exception 'conversation plans: nav_counts is not the one this migration expects';
  end if;
  execute replace(replace(v_def, v_a, 'select count(*) from public.tasks k where k.tenant_id = p_tenant_id and k.status = ''planned'' and k.origin = ''screen'')'),
                  v_b, 'k.status = ''paused'' and k.pause_reason in (''cap'', ''daily_limit''))');
end
$do$;
