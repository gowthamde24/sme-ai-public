-- Hand over to a person (owner, 5 Nov 2026; job calls-like-a-pro part 4): a caller who asks for a person (or presses 1) hears "someone from the team will call you back" and the call ends with
-- end_reason = 'handover'. Until someone marks it handled, Today's "Needs you" shows it as `person_requested` ("call back: asked for a person"), for the Owner, an Admin and Sales, for 7 days.
-- A real transfer to a member's phone needs real calls, which stay OFF (sandbox and simulator only): the callback is the path for now.

alter table public.phone_calls add column handled_at timestamptz, add column handled_by uuid;
comment on column public.phone_calls.handled_at is 'SAFE: when a person marked a hand-over call as dealt with (called back). CLEAN-EXEMPT: timestamp';
comment on column public.phone_calls.handled_by is 'SAFE: the id of the member who marked it. CLEAN-EXEMPT: uuid';
alter table public.phone_calls add constraint phone_calls_handled_pair check ((handled_at is null) = (handled_by is null));
create index phone_calls_handover_idx on public.phone_calls (tenant_id, created_at desc) where end_reason = 'handover' and handled_at is null;

-- a finished call still does not change, except its "handled" mark (set once, by phone_call_handled)
create or replace function app.phone_calls_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'calls are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.state in ('completed', 'no_answer', 'busy', 'voicemail', 'failed', 'refused', 'cancelled') and not app.erasure_running(old.tenant_id)
       and ((to_jsonb(old) - 'handled_at' - 'handled_by' - 'updated_at') is distinct from (to_jsonb(new) - 'handled_at' - 'handled_by' - 'updated_at') or old.handled_at is not null) then
      raise exception 'a finished call does not change' using errcode = 'SM961';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- a person called the customer back (Owner, Admin, Sales)
create function public.phone_call_handled(p_tenant_id uuid, p_call_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into c from public.phone_calls x where x.tenant_id = p_tenant_id and x.id = p_call_id for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if c.handled_at is null then
    update public.phone_calls set handled_at = now(), handled_by = auth.uid() where id = c.id returning * into c;
  end if;
  return jsonb_build_object('call_id', c.id, 'handled_at', c.handled_at);
end;
$$;
revoke all on function public.phone_call_handled(uuid, uuid) from public, anon;
grant execute on function public.phone_call_handled(uuid, uuid) to authenticated;

-- Today: the hand-over calls not dealt with yet (the same function, one more kind; everything else unchanged)
do $do$
declare
  v_def text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_new text;
  v_anchor text := '  ), top as (';
begin
  if position(v_anchor in v_def) = 0 or position('person_requested' in v_def) > 0 then
    raise exception 'ho_person_requested: today_summary is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_anchor, '    union all
    select ''person_requested'', pc.id, coalesce(k.full_name, ''A caller''), null::text, ''followup_desk'', ''call'', null::bigint, coalesce(pc.ended_at, pc.created_at), ''phone_call'', pc.id
      from public.phone_calls pc
      left join public.contacts k on k.tenant_id = pc.tenant_id and k.id = pc.contact_id
     where v_reader and pc.tenant_id = p_tenant_id and pc.end_reason = ''handover'' and pc.handled_at is null and pc.created_at >= now() - interval ''7 days''
' || v_anchor);
  execute v_new;
end
$do$;
