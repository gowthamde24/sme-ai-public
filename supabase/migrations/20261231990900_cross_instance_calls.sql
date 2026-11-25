-- Running more than one API instance (24 Nov 2026; reports/api-scaling-safety.md). A live call lives on the instance that answered it; two things must not depend on that:
--   1. HOW MANY calls are live platform-wide (the concurrent-call limit): counted from the database (app.phone_call_is_live), not from one process's memory.
--   2. WHISPER and HANG UP from the owner: the request may reach another instance, so it is written here as a command and the instance that holds the call picks it up (about every second), does it, and says so.
-- Take-over (a live audio stream to the owner's browser) cannot move between instances; it keeps answering "call_not_here" there and the web retries the connection.
-- The words of a whisper stay only until the instance takes them: the claim returns them and clears them. Rollback = drop schema telephony cascade and the three functions.

create schema if not exists telephony;
revoke all on schema telephony from public, anon, authenticated, service_role;

create table telephony.call_commands (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  call_id     uuid not null,
  kind        text not null check (kind in ('whisper', 'hang_up')),
  body        text check (body is null or char_length(body) between 1 and 500),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  done_at     timestamptz,
  ok          boolean,
  check (kind <> 'hang_up' or body is null),
  check (kind <> 'whisper' or body is not null)
);
create index call_commands_call_idx on telephony.call_commands (call_id, created_at) where claimed_at is null;
create index call_commands_tenant_idx on telephony.call_commands (tenant_id, created_at desc);
comment on table telephony.call_commands is 'A whisper or a hang-up asked for a live call that may be on another API instance. Written by public.call_command_push, taken by the instance that holds the call. The words of a whisper are cleared when taken.';
comment on column telephony.call_commands.body is 'PII: the owner''s words to the assistant (500 characters at most); cleared the moment the instance takes it. CLEAN-EXEMPT: length CHECK';
alter table telephony.call_commands enable row level security;
alter table telephony.call_commands force row level security;
revoke all on telephony.call_commands from public, anon, authenticated, service_role;

-- 1. platform-wide live calls (system accounts: the phone server's own account)
create function public.phone_live_count() returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform ops.system_only();
  return (select count(*)::integer from public.phone_calls c where app.phone_call_is_live(c));
end $$;
revoke all on function public.phone_live_count() from public, anon;
grant execute on function public.phone_live_count() to authenticated;

-- 2. the owner asks (Owner and Admin of the call's workspace; the call must be live)
create function public.call_command_push(p_tenant_id uuid, p_call_id uuid, p_kind text, p_body text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('whisper', 'hang_up') or (p_kind = 'whisper') <> (p_body is not null and btrim(p_body) <> '') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.phone_calls c where c.tenant_id = p_tenant_id and c.id = p_call_id and app.phone_call_is_live(c)) then
    return jsonb_build_object('queued', false, 'reason', 'not_live');
  end if;
  insert into telephony.call_commands (id, tenant_id, call_id, kind, body, created_by) values (v_id, p_tenant_id, p_call_id, p_kind, nullif(btrim(p_body), ''), auth.uid());
  delete from telephony.call_commands where created_at < now() - interval '1 day';
  return jsonb_build_object('queued', true, 'id', v_id);
end $$;
revoke all on function public.call_command_push(uuid, uuid, text, text) from public, anon;
grant execute on function public.call_command_push(uuid, uuid, text, text) to authenticated;

-- did the instance do it? (the one who asked)
create function public.call_command_status(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c telephony.call_commands;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into c from telephony.call_commands x where x.id = p_id and x.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('done', false, 'ok', false, 'known', false);
  end if;
  return jsonb_build_object('done', c.done_at is not null, 'ok', coalesce(c.ok, false), 'known', true);
end $$;
revoke all on function public.call_command_status(uuid, uuid) from public, anon;
grant execute on function public.call_command_status(uuid, uuid) to authenticated;

-- the instance that holds calls asks for their commands (system accounts); each command is handed out once and its words are cleared
create function public.call_command_claim(p_call_ids uuid[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform ops.system_only();
  if p_call_ids is null or cardinality(p_call_ids) = 0 or cardinality(p_call_ids) > 200 then
    return '[]'::jsonb;
  end if;
  with picked as (
    select c.id, c.body as words from telephony.call_commands c
     where c.call_id = any (p_call_ids) and c.claimed_at is null and c.created_at > now() - interval '30 seconds'
     order by c.created_at for update skip locked limit 50),
  upd as (
    update telephony.call_commands c set claimed_at = now(), body = case when c.kind = 'whisper' then '-' else null end
      from picked p where c.id = p.id returning c.id, c.tenant_id, c.call_id, c.kind, p.words)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'tenant_id', u.tenant_id, 'call_id', u.call_id, 'kind', u.kind, 'body', u.words)), '[]'::jsonb) into v_out from upd u;
  return v_out;
end $$;
revoke all on function public.call_command_claim(uuid[]) from public, anon;
grant execute on function public.call_command_claim(uuid[]) to authenticated;

create function public.call_command_finish(p_id uuid, p_ok boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform ops.system_only();
  update telephony.call_commands set done_at = now(), ok = coalesce(p_ok, false) where id = p_id and claimed_at is not null and done_at is null;
end $$;
revoke all on function public.call_command_finish(uuid, boolean) from public, anon;
grant execute on function public.call_command_finish(uuid, boolean) to authenticated;
