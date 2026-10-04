-- T002 / 2 of 4: append-only audit trail.
--
-- Writers: only app.write_audit_event(), called by DB triggers (so app code cannot skip it) and by
-- no client role. Readers: Owner/Admin of the tenant (policy in migration 3).
-- "Append-only style": application roles have no UPDATE/DELETE/TRUNCATE privilege, and triggers
-- block those operations for the table owner as well. A superuser can still disable triggers; a
-- hash chain / external sink is a later hardening step (see ADR).

create table public.audit_events (
  id            bigint generated always as identity primary key,
  -- RESTRICT: a tenant with history cannot be deleted out from under its audit trail.
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  -- No FK: the trail must outlive the user. NULL for system actors.
  actor_user_id uuid,
  actor_type    text not null check (actor_type in ('user', 'system', 'agent')),
  action        text not null,   -- '<entity>.<create|update|delete>'
  entity_type   text not null,
  entity_id     uuid,
  old_values    jsonb,           -- row BEFORE the change (null for create)
  new_values    jsonb,           -- row AFTER the change (null for delete)
  metadata      jsonb not null default '{}'::jsonb,
  request_id    text,            -- X-Request-Id when the change came through PostgREST
  created_at    timestamptz not null default now()
);

create index audit_events_tenant_created_idx on public.audit_events (tenant_id, created_at desc);

create trigger audit_events_forbid_tenant_id_change
  before update on public.audit_events
  for each row execute function app.forbid_tenant_id_change();

-- Append-only enforcement (applies to every role, including the table owner).
create function app.audit_events_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end;
$$;

revoke all on function app.audit_events_append_only() from public;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function app.audit_events_append_only();
create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function app.audit_events_append_only();
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function app.audit_events_append_only();

-- The one writer. Not executable by any client role. Actor comes from the JWT subject; with no JWT
-- (migrations, seeds, future trusted workers) the event is attributed to 'system'.
create function app.write_audit_event(
  p_tenant_id   uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_old         jsonb,
  p_new         jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_request_id text;
begin
  begin
    v_request_id := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id';
  exception when others then
    v_request_id := null;
  end;

  insert into public.audit_events (
    tenant_id, actor_user_id, actor_type, action, entity_type, entity_id,
    old_values, new_values, request_id
  ) values (
    p_tenant_id,
    v_uid,
    case when v_uid is null then 'system' else 'user' end,
    p_action,
    p_entity_type,
    p_entity_id,
    p_old,
    p_new,
    v_request_id
  );
end;
$$;

revoke all on function app.write_audit_event(uuid, text, text, uuid, jsonb, jsonb) from public, anon, authenticated;

-- Generic row-change recorder: records full BEFORE/AFTER rows. Skips updates that only touched
-- updated_at. Trigger argument 0 is the entity type ('tenant', 'membership').
create function app.audit_row_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new    jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row    jsonb := coalesce(v_new, v_old);
  v_entity text  := tg_argv[0];
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  perform app.write_audit_event(
    -- a tenant row is its own tenant; every other audited table carries tenant_id
    (case when tg_table_name = 'tenants' then v_row ->> 'id' else v_row ->> 'tenant_id' end)::uuid,
    v_entity || '.' || case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    v_entity,
    (v_row ->> 'id')::uuid,
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app.audit_row_change() from public;

-- Tenants are never deleted by clients, and a delete would be refused by the audit FK anyway.
create trigger audit_tenants
  after insert or update on public.tenants
  for each row execute function app.audit_row_change('tenant');

create trigger audit_memberships
  after insert or update or delete on public.memberships
  for each row execute function app.audit_row_change('membership');

alter table public.audit_events enable row level security;
alter table public.audit_events force  row level security;
revoke all on public.audit_events from public, anon, authenticated;
