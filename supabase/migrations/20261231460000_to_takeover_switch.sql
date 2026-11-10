-- Job TO: THE LIVE TAKE-OVER SAFETY SWITCH (owner decision, 10 Nov 2026; the lawyer's answer was VERBAL and is not yet confirmed in writing).
--
--   workspace.call_takeover_settings   one row per business: may an Owner or Admin listen in / take over a LIVE call? Default OFF (no row = off).
--   public.call_takeover_get           any member reads it
--   public.call_takeover_set           OWNER only; every change is in the audit log with the old and the new value (who and when are the audit event's own actor and time)
--   public.call_takeover_event         Owner or Admin: one audit entry per take-over session event (start, whisper, hang_up, end) of a call of this business
--
-- Nothing here stores audio, and no event stores a word that was said: an event carries its name and, at most, a duration in seconds or the number of characters of a whisper.
-- A 'start' is refused by the database itself while the business has the switch off (the API refuses first; this is the second lock).
-- SQLSTATEs: 42501 deny, 22023 invalid.

create table workspace.call_takeover_settings (
  workspace_id uuid primary key references public.tenants (id) on delete restrict,
  enabled      boolean not null default false,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
alter table workspace.call_takeover_settings enable row level security;
alter table workspace.call_takeover_settings force row level security;
revoke all on workspace.call_takeover_settings from public, anon, authenticated, service_role;
comment on table workspace.call_takeover_settings is 'Job TO: the business''s switch for live take-over (default OFF). No personal data. Owner writes through call_takeover_set only; every change is audited.';

create function app.call_takeover_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce((select s.enabled from workspace.call_takeover_settings s where s.workspace_id = p_tenant), false),
    'updated_at', (select s.updated_at from workspace.call_takeover_settings s where s.workspace_id = p_tenant))
$$;
revoke all on function app.call_takeover_json(uuid) from public;

create function public.call_takeover_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.call_takeover_json(p_tenant_id);
end;
$$;
revoke all on function public.call_takeover_get(uuid) from public, anon;
grant execute on function public.call_takeover_get(uuid) to authenticated;

create function public.call_takeover_set(p_tenant_id uuid, p_enabled boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_enabled is null then
    perform app.workspace_error('invalid');
  end if;
  select s.enabled into v_old from workspace.call_takeover_settings s where s.workspace_id = p_tenant_id;
  v_old := coalesce(v_old, false);
  insert into workspace.call_takeover_settings as s (workspace_id, enabled, updated_by, updated_at)
  values (p_tenant_id, p_enabled, auth.uid(), now())
  on conflict (workspace_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  if v_old is distinct from p_enabled then
    perform app.write_audit_event(p_tenant_id, 'calls.takeover_setting_changed', 'workspace', p_tenant_id,
      jsonb_build_object('enabled', v_old), jsonb_build_object('enabled', p_enabled));
  end if;
  return app.call_takeover_json(p_tenant_id);
end;
$$;
revoke all on function public.call_takeover_set(uuid, boolean) from public, anon;
grant execute on function public.call_takeover_set(uuid, boolean) to authenticated;

-- One audit entry per session event. `p_detail` may carry only `duration_s` (0 to 86400) and `text_chars` (0 to 1000); anything else is dropped. No word that was said is ever stored.
create function public.call_takeover_event(p_tenant_id uuid, p_call_id uuid, p_event text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_event is null or p_event not in ('start', 'whisper', 'hang_up', 'end') or p_call_id is null
     or not exists (select 1 from public.phone_calls c where c.id = p_call_id and c.tenant_id = p_tenant_id) then
    perform app.workspace_error('invalid');
  end if;
  if p_event = 'start' and not coalesce((select s.enabled from workspace.call_takeover_settings s where s.workspace_id = p_tenant_id), false) then
    perform app.workspace_error('deny');   -- the business has not switched take-over on
  end if;
  v_new := jsonb_build_object('event', p_event);
  if jsonb_typeof(p_detail) = 'object' then
    if (p_detail ->> 'duration_s') ~ '^[0-9]{1,5}$' and (p_detail ->> 'duration_s')::integer <= 86400 then
      v_new := v_new || jsonb_build_object('duration_s', (p_detail ->> 'duration_s')::integer);
    end if;
    if (p_detail ->> 'text_chars') ~ '^[0-9]{1,4}$' and (p_detail ->> 'text_chars')::integer <= 1000 then
      v_new := v_new || jsonb_build_object('text_chars', (p_detail ->> 'text_chars')::integer);
    end if;
  end if;
  perform app.write_audit_event(p_tenant_id, 'calls.takeover_' || p_event, 'phone_call', p_call_id, null, v_new);
end;
$$;
revoke all on function public.call_takeover_event(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.call_takeover_event(uuid, uuid, text, jsonb) to authenticated;
