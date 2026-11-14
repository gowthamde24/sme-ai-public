-- "Ask first" in Needs you (owner, 14 Nov 2026): plans leave out people whose consent is not known ("12 people need to agree first · Ask by WhatsApp / I confirm"). The API lists them, the owner asks or confirms.
--   * task_contacts.asked_at: when a WhatsApp ask was submitted for that person (a message is not consent: the person stays "need to agree" until consent is recorded).
--   * tasks.ask_first_dismissed_at: the Owner closes the item without asking (it goes away; nobody is called).
--   * app.ask_first_rows(tenant): per task, the people left out as `no_consent` whose consent for the plan's channel is STILL not granted (and not withdrawn: those are never asked), the plan made in the last 14 days, not cancelled, not dismissed;
--     a plan proposed in a conversation and not answered yet is the card's business and is not here.
--   * public.task_ask_first(tenant): the list for the Owner and Admins. app.ask_first_count: its size, in the badge (nav_counts lead_desk_waiting).
--   * public.task_mark_asked / public.task_ask_first_dismiss: the two writes.

alter table public.task_contacts add column asked_at timestamptz;
comment on column public.task_contacts.asked_at is 'SAFE: a time. CLEAN-EXEMPT: timestamptz';
alter table public.tasks add column ask_first_dismissed_at timestamptz;
comment on column public.tasks.ask_first_dismissed_at is 'SAFE: a time. CLEAN-EXEMPT: timestamptz';

create function app.ask_first_rows(p_tenant uuid) returns table (task_id uuid, goal text, channel text, status text, created_at timestamptz, people integer, asked integer)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.plan ->> 'goal', t.plan ->> 'channel', t.status, t.created_at,
         count(*)::integer, (count(*) filter (where c.asked_at is not null))::integer
    from public.tasks t
    join public.task_contacts c on c.task_id = t.id and c.tenant_id = t.tenant_id
    join public.contacts k on k.tenant_id = c.tenant_id and k.id = c.contact_id
   where t.tenant_id = p_tenant and t.status <> 'cancelled' and t.ask_first_dismissed_at is null and t.created_at > now() - interval '14 days'
     and not (t.origin = 'conversation' and t.status in ('planned', 'needs_answer')) and t.plan is not null
     and c.status = 'skipped' and c.skip_reason = 'no_consent' and k.erased_at is null and k.suppressed_at is null
     and (case when t.plan ->> 'channel' in ('call', 'both') then k.phone_consent else k.whatsapp_consent end) = 'unknown'
   group by t.id, t.plan, t.status, t.created_at
$$;
revoke all on function app.ask_first_rows(uuid) from public, anon, authenticated, service_role;

create function app.ask_first_count(p_tenant uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$ select count(*)::integer from app.ask_first_rows(p_tenant) $$;
revoke all on function app.ask_first_count(uuid) from public, anon, authenticated, service_role;

create function public.task_ask_first(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('task_id', r.task_id, 'goal', r.goal, 'channel', r.channel, 'status', r.status, 'created_at', r.created_at,
                                                                                    'people', r.people, 'asked', r.asked) order by r.created_at desc, r.task_id)
                                                 from app.ask_first_rows(p_tenant_id) r), '[]'::jsonb));
end;
$$;
revoke all on function public.task_ask_first(uuid) from public, anon;
grant execute on function public.task_ask_first(uuid) to authenticated;

create function public.task_mark_asked(p_tenant_id uuid, p_task_id uuid, p_contact_ids uuid[]) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_contact_ids is null or cardinality(p_contact_ids) not between 1 and 500 then
    perform app.task_error('invalid');
  end if;
  update public.task_contacts set asked_at = now() where tenant_id = p_tenant_id and task_id = p_task_id and contact_id = any (p_contact_ids) and skip_reason = 'no_consent' and asked_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.task_mark_asked(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.task_mark_asked(uuid, uuid, uuid[]) to authenticated;

create function public.task_ask_first_dismiss(p_tenant_id uuid, p_task_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  update public.tasks set ask_first_dismissed_at = coalesce(ask_first_dismissed_at, now()) where id = p_task_id and tenant_id = p_tenant_id;
  if not found then
    perform app.task_error('reference');
  end if;
  perform app.write_audit_event(p_tenant_id, 'task.ask_first_dismissed', 'task', p_task_id, null, '{}'::jsonb);
end;
$$;
revoke all on function public.task_ask_first_dismiss(uuid, uuid) from public, anon;
grant execute on function public.task_ask_first_dismiss(uuid, uuid) to authenticated;

-- the sidebar badge counts them too (it must equal what Today shows)
do $do$
declare
  v_def text := pg_get_functiondef('public.nav_counts(uuid)'::regprocedure);
  v_a   text := '(case when v_owner then (select count(*) from public.outreach_batches b where';
begin
  if position(v_a in v_def) = 0 then
    raise exception 'ask first: nav_counts is not the one this migration expects';
  end if;
  execute replace(v_def, v_a, '(case when v_owner then app.ask_first_count(p_tenant_id) + (select count(*) from public.outreach_batches b where');
end
$do$;
