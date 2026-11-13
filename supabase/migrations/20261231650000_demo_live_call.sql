-- "Start demo" (owner, 13 Nov 2026): a DEMO workspace may make a labelled live call at any hour, so the owner can test the live strip in the evening in Germany (it is night in India then).
--   public.demo_start_live_call(tenant)  Owner or Admin of a workspace the operator flagged `demo`: makes ONE live call to a synthetic customer of that workspace (a +00 number: nobody can dial it), simulated and sandboxed
--                                        (the app labels those), live for about 10 minutes. Called again while one is live it returns the same call. Any other workspace: refused (42501), however the caller asks.
--   public.demo_end_live_call(tenant)    the same two roles end it now (completed, with a plain simulated-call summary).
--   public.phone_calls_close_orphans     the worker no longer treats a simulated sandbox call as a ghost after 4 minutes of silence (it has no phone server to beat); at 15 minutes it ends it as COMPLETED with the
--                                        simulated-call summary (not failed). Every other call is closed exactly as before.
-- SQLSTATEs: 42501 not allowed (not Owner/Admin, not this workspace, not a demo workspace), 22023 the workspace has no synthetic customer to call.

create function public.demo_start_live_call(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_demo boolean;
  v_call uuid;
  v_contact uuid;
  v_lead uuid;
  v_lang text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  select t.demo into v_demo from public.tenants t where t.id = p_tenant_id and t.archived_at is null;
  if v_demo is not true then
    perform app.phone_error('deny');
  end if;
  -- one at a time: a demo call that is still live is the answer
  select c.id into v_call from public.phone_calls c
   where c.tenant_id = p_tenant_id and c.simulated and c.sandbox and c.state = 'in_progress' and c.created_at > now() - interval '10 minutes' order by c.created_at desc limit 1;
  if v_call is not null then
    return jsonb_build_object('call_id', v_call, 'started', false);
  end if;
  -- a synthetic customer of this workspace: a +00 number (an unassigned country code), changing from day to day
  select ct.id, l.id, coalesce(lp.language, 'en') into v_contact, v_lead, v_lang
    from public.contacts ct
    join public.leads l on l.tenant_id = ct.tenant_id and l.contact_id = ct.id and l.archived_at is null
    left join public.lead_profiles lp on lp.tenant_id = l.tenant_id and lp.lead_id = l.id
   where ct.tenant_id = p_tenant_id and ct.archived_at is null and ct.erased_at is null and ct.phone like '+00 %'
   order by md5(ct.id::text || (now() at time zone 'UTC')::date::text || extract(minute from now())::text) limit 1;
  if v_contact is null then
    perform app.phone_error('invalid');
  end if;
  v_call := gen_random_uuid();
  insert into public.phone_calls (id, tenant_id, direction, state, contact_id, lead_id, purpose, language, provider, sandbox, simulated, recorded, ai_disclosed, created_by, answered_at, heartbeat_at, created_at, updated_at)
  values (v_call, p_tenant_id, 'outbound', 'in_progress', v_contact, v_lead, 'visit_reminder', case when v_lang in ('te', 'kn', 'hi', 'en') then v_lang else 'en' end, 'sandbox', true, true, false, true, v_uid,
          now() - interval '20 seconds', now() + interval '4 minutes', now() - interval '30 seconds', now());   -- the beat is dated ahead so the strip stays live for the whole 10 minutes
  return jsonb_build_object('call_id', v_call, 'started', true);
end;
$$;
revoke all on function public.demo_start_live_call(uuid) from public, anon;
grant execute on function public.demo_start_live_call(uuid) to authenticated;

create function public.demo_end_live_call(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[])
     or not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.demo and t.archived_at is null) then
    perform app.phone_error('deny');
  end if;
  with closed as (
    update public.phone_calls c
       set state = 'completed', ended_at = now(), end_reason = 'goodbye', outcome = 'unclear', summary = 'A simulated demo call: nobody was called.',
           duration_s = greatest(1, extract(epoch from now() - coalesce(c.answered_at, c.created_at))::integer)
     where c.tenant_id = p_tenant_id and c.simulated and c.sandbox and c.state = 'in_progress'
    returning 1)
  select count(*) into v_n from closed;
  return jsonb_build_object('ended', v_n);
end;
$$;
revoke all on function public.demo_end_live_call(uuid) from public, anon;
grant execute on function public.demo_end_live_call(uuid) to authenticated;

-- the worker: a real call that goes silent or runs past 15 minutes is a ghost (failed), as before; a simulated sandbox call has no phone server to beat, so only its age ends it, as a completed simulated call
create or replace function public.phone_calls_close_orphans(p_stale_seconds integer default 240) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_sim integer;
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  if p_stale_seconds is null or p_stale_seconds not between 60 and 900 then
    perform app.phone_error('invalid');
  end if;
  with closed as (
    update public.phone_calls c
       set state = 'failed', ended_at = now(), end_reason = 'error', outcome = 'failed',
           duration_s = greatest(0, extract(epoch from now() - coalesce(c.answered_at, c.created_at))::integer)
     where c.state in ('ringing', 'in_progress') and not (c.simulated and c.sandbox)
       and (coalesce(c.heartbeat_at, c.answered_at, c.created_at) < now() - make_interval(secs => p_stale_seconds) or c.created_at < now() - interval '15 minutes')
    returning 1)
  select count(*) into v_n from closed;
  with closed as (
    update public.phone_calls c
       set state = 'completed', ended_at = now(), end_reason = 'goodbye', outcome = 'unclear', summary = 'A simulated demo call: nobody was called.',
           duration_s = greatest(1, extract(epoch from now() - coalesce(c.answered_at, c.created_at))::integer)
     where c.state = 'in_progress' and c.simulated and c.sandbox and c.created_at < now() - interval '15 minutes'
    returning 1)
  select count(*) into v_sim from closed;
  return v_n + v_sim;
end;
$$;
