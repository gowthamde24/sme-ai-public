-- Rebuild a test workspace (owner answer 1 to the Lead Finder report, 4 Nov 2026): NO purge (the append-only tables stay append-only). The operator ARCHIVES the old test workspace and a fresh one
-- is provisioned (scripts/rebuild_owner_test.py, which runs scripts/seed_owner_test.py's phases for a new helper account). docs/runbooks/rebuild-test-workspace.md.
--
--   tenants.archived_at / archived_reason     set only by the operator
--   app.operator_archive_workspace(t, why)    operator only (no signed-in caller), a reason of 20+ characters; refuses a workspace whose real-data gate is OPEN (real data is never archived this way:
--                                             a test workspace is synthetic) and a demo workspace (the demos are rebuilt by their own seed). The name gains " (archived YYYY-MM-DD)", so a seed that finds a
--                                             workspace by its name finds the fresh one. Idempotent.
--   app.operator_unarchive_workspace(t, why)  operator only: undoes it (the name is left as it is)
--   READ-ONLY                                 app.billing_read_only (FULL COPY + archived): nothing is sent, released, planned or run by the worker; public.billing_access (FULL COPY + archived): the API's
--                                             gate refuses every change and spend with 403 workspace_read_only, and the screens show the read-only banner. Viewing and exporting stay.
--                                             app.billing_lapse is NOT changed: an archived workspace gets no "your plan ended" reminder and is never on the 90-day deletion list.
--   HIDDEN                                    the switcher (GET /v1/me) leaves archived workspaces out (the API's filter); a direct link still opens it, read-only.

alter table public.tenants add column archived_at timestamptz;
alter table public.tenants add column archived_reason text check (archived_reason is null or (char_length(btrim(archived_reason)) between 20 and 300 and app.text_is_clean(archived_reason)));
comment on column public.tenants.archived_at is 'SAFE: when the operator archived the workspace (read-only, hidden from the switcher); null = in use. CLEAN-EXEMPT: timestamptz';
comment on column public.tenants.archived_reason is 'SAFE: the operator''s reason for archiving (fixed wording, no personal data)';

create function app.operator_archive_workspace(p_tenant uuid, p_reason text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  t public.tenants;
  v_name text;
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 20 and 300 or not app.text_is_clean(p_reason) then
    raise exception 'a reason of 20 to 300 characters is required' using errcode = '22023';
  end if;
  select * into t from public.tenants z where z.id = p_tenant for update;
  if not found then
    raise exception 'no such workspace' using errcode = '23503';
  end if;
  if t.archived_at is not null then
    return jsonb_build_object('tenant_id', t.id, 'name', t.name, 'archived_at', t.archived_at, 'archived', false);
  end if;
  if exists (select 1 from public.tenant_data_policy p where p.tenant_id = t.id and p.real_data_allowed) then
    raise exception 'the real-data gate of this workspace is open: it is not archived this way' using errcode = '42501';
  end if;
  if t.demo then
    raise exception 'a demo workspace is rebuilt by its own seed, not archived' using errcode = '42501';
  end if;
  v_name := left(btrim(t.name), 120 - char_length(' (archived 2026-01-01)')) || ' (archived ' || to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') || ')';
  update public.tenants set archived_at = now(), archived_reason = btrim(p_reason), name = v_name where id = t.id;
  return jsonb_build_object('tenant_id', t.id, 'name', v_name, 'archived_at', now(), 'archived', true);
end;
$$;
revoke all on function app.operator_archive_workspace(uuid, text) from public, anon, authenticated, service_role;

create function app.operator_unarchive_workspace(p_tenant uuid, p_reason text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  t public.tenants;
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 20 and 300 or not app.text_is_clean(p_reason) then
    raise exception 'a reason of 20 to 300 characters is required' using errcode = '22023';
  end if;
  update public.tenants set archived_at = null, archived_reason = null where id = p_tenant returning * into t;
  if not found then
    raise exception 'no such workspace' using errcode = '23503';
  end if;
  return jsonb_build_object('tenant_id', t.id, 'name', t.name, 'archived', false);
end;
$$;
revoke all on function app.operator_unarchive_workspace(uuid, text) from public, anon, authenticated, service_role;

create function app.workspace_archived(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.tenants t where t.id = p_tenant and t.archived_at is not null) $$;
revoke all on function app.workspace_archived(uuid) from public, anon, authenticated, service_role;

-- FULL COPY of 20261129090400 (dm_trial_pending), one added test: an archived workspace
create or replace function app.billing_read_only(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.billing_lapse(p_tenant) ->> 'access' = 'read_only' or app.billing_pending(p_tenant) or app.workspace_archived(p_tenant) $$;

-- FULL COPY of 20261130090100 (dp_readonly_gate); an archived workspace answers `access: read_only` (the API gate holds every change) and `archived: true`, with no lapse dates
create or replace function public.billing_access(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.billing_error('deny');
  end if;
  if app.workspace_archived(p_tenant_id) then
    return jsonb_build_object('access', 'read_only', 'read_only_since', (select (t.archived_at at time zone 'Asia/Kolkata')::date from public.tenants t where t.id = p_tenant_id),
                              'delete_on', null, 'data_days_left', null, 'can_resume', false, 'sending', 'off', 'waiting_for', null, 'archived', true);
  end if;
  return app.billing_lapse(p_tenant_id) || jsonb_build_object(
    'can_resume', app.billing_can_resume(p_tenant_id),
    'sending', case when app.billing_read_only(p_tenant_id) then 'off' else 'on' end,   -- read-only OR still waiting for WhatsApp
    'waiting_for', case when app.billing_pending(p_tenant_id) then 'whatsapp' else null end,
    'archived', false);
end;
$$;
revoke all on function public.billing_access(uuid) from public, anon;
grant execute on function public.billing_access(uuid) to authenticated;

-- FULL COPY of 20261031090000 (ad_d1_plan_and_workspace_limit): an ARCHIVED workspace no longer counts against the Owner's allowance (the fresh test workspace replaces it; the archived one is read-only)
create or replace function app.owner_allowance(p_user uuid, p_tenant uuid, out owned integer, out allowed integer)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  select count(*) filter (where t.archived_at is null), coalesce(max(t.workspace_limit), 0)
    into owned, allowed
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = p_user and m.role = 'owner' and m.tenant_id <> p_tenant;
  allowed := greatest(allowed, coalesce((select t.workspace_limit from public.tenants t where t.id = p_tenant), 0));
end;
$$;
revoke all on function app.owner_allowance(uuid, uuid) from public;
grant execute on function app.owner_allowance(uuid, uuid) to authenticated;
