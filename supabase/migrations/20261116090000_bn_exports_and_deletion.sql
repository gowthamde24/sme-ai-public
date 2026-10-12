-- Job BN (ADR 0075), part 1 of 2: "DOWNLOAD MY DATA" and "DELETE MY ACCOUNT / MY WORKSPACE". The person's rights under the Digital Personal Data Protection Act (access, erasure), built on what exists: the files go
-- through Supabase Storage (private bucket, signed link that lasts minutes), the workspace erasure is the existing erasure function behind a cooling-off.
--
--   privacy.data_exports                  private schema: one row per export (who, which scope, status, size, hash, where the file is, when it expires). No data in it.
--   public.data_export_request / get / list / begin / finish / link   the requester's own exports (Owner + second factor for a WORKSPACE export). The file is made by the API with the person's own token, uploaded to the
--                                         private bucket `exp-<user id>` and signed for 5 minutes at a time. It expires after 24 hours; the AW worker deletes the file.
--   public.data_export_person_data()      what the account itself holds about the signed-in person (profile, memberships, acceptances, the trail of their own actions, their own chat): the API puts it in the zip
--   privacy.deletion_requests             a request to delete an ACCOUNT or a WORKSPACE, with a 14-day cooling-off
--   public.deletion_request / cancel / list / execute_workspace       the person's own; the workspace one calls the existing erasure functions (request at once, execute after the cooling-off)
--   public.privacy_worker_execute_account_deletions / privacy_worker_expired_exports / privacy_worker_export_cleaned   the AW worker's part (the database decides; the worker carries out)
--
-- SQLSTATEs: 42501 deny, 22023 invalid, 23503 not found, SM306 second factor, SM611 the person is the only Owner of a workspace, SM612 still in the cooling-off, SM613 not in a state that allows this, SM614 too many requests,
-- SM615 the confirmation does not match.

create schema privacy;
revoke all on schema privacy from public, anon, authenticated, service_role;

create function app.privacy_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'    then raise exception 'invalid input' using errcode = '22023';
    when 'reference'  then raise exception 'not found' using errcode = '23503';
    when 'sole_owner' then raise exception 'you are the only owner of a workspace' using errcode = 'SM611';
    when 'cooling'    then raise exception 'still in the cooling-off period' using errcode = 'SM612';
    when 'state'      then raise exception 'not in a state that allows this' using errcode = 'SM613';
    when 'rate'       then raise exception 'too many requests' using errcode = 'SM614';
    when 'confirm'    then raise exception 'the confirmation does not match' using errcode = 'SM615';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.privacy_error(text) from public;

-- a delete that the retention clean-up does (and nothing else) may do on tables that are append-only for everybody else: it sets the setting for its own transaction, inside a function the database owner runs
create function app.retention_purging() returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(current_setting('app.retention_purge', true), '') = 'on' and current_user = 'postgres' $$;
revoke all on function app.retention_purging() from public;

create or replace function app.audit_events_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.retention_purging() then
    return old;   -- only the retention clean-up, for the age the Owner chose (job BN)
  end if;
  raise exception 'audit_events is append-only' using errcode = '42501';
end;
$$;

create or replace function app.scheduler_forbid_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.retention_purging() then
    return old;
  end if;
  raise exception 'scheduler rows are never deleted' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. data exports
-- ---------------------------------------------------------------------------------------------------------------------------------
create table privacy.data_exports (
  id           uuid primary key,
  user_id      uuid not null,
  tenant_id    uuid references public.tenants (id) on delete restrict,
  scope        text not null check (scope in ('person', 'workspace')),
  status       text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed', 'expired')),
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  ready_at     timestamptz,
  expires_at   timestamptz,
  size_bytes   bigint check (size_bytes between 0 and 52428800),
  sha256       text check (sha256 ~ '^[0-9a-f]{64}$'),
  object_bucket text,
  object_path  text,
  error_code   text check (error_code in ('too_large', 'source_unreadable', 'storage', 'internal')),
  downloads    integer not null default 0 check (downloads >= 0),
  cleaned_at   timestamptz,
  check ((scope = 'workspace') = (tenant_id is not null)),
  check (status <> 'ready' or (expires_at is not null and sha256 is not null and object_path is not null and size_bytes is not null))
);
create index data_exports_user_idx on privacy.data_exports (user_id, requested_at desc);
create index data_exports_expiry_idx on privacy.data_exports (expires_at) where cleaned_at is null and object_path is not null;
alter table privacy.data_exports enable row level security;
alter table privacy.data_exports force row level security;
revoke all on privacy.data_exports from public, anon, authenticated, service_role;
comment on table privacy.data_exports is 'Job BN: one row per "download my data" export. No data is in it: ids, status, size and hash only.';

create function app.data_export_json(e privacy.data_exports) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', e.id, 'scope', e.scope, 'tenant_id', e.tenant_id, 'status', e.status, 'requested_at', e.requested_at, 'ready_at', e.ready_at, 'expires_at', e.expires_at,
                            'size_bytes', e.size_bytes, 'sha256', e.sha256, 'error_code', e.error_code, 'downloads', e.downloads)
$$;
revoke all on function app.data_export_json(privacy.data_exports) from public;

-- the audit event of an export: in the workspace for a workspace export, in every workspace the person belongs to for a personal one. Counts and words only.
create function app.data_export_audit(e privacy.data_exports, p_action text) returns void
language plpgsql
set search_path = ''
as $$
declare
  t uuid;
begin
  if e.tenant_id is not null then
    perform app.write_audit_event(e.tenant_id, p_action, 'data_export', e.id, null, jsonb_build_object('scope', e.scope));
  else
    for t in select m.tenant_id from public.memberships m where m.user_id = e.user_id loop
      perform app.write_audit_event(t, p_action, 'data_export', e.id, null, jsonb_build_object('scope', e.scope));
    end loop;
  end if;
end;
$$;
revoke all on function app.data_export_audit(privacy.data_exports, text) from public;

-- the private bucket of a person's exports and its rules: the person reads, adds and removes their own; the worker may remove an EXPIRED one
create function app.export_bucket_owner(p_bucket text) returns uuid
language sql
immutable
set search_path = ''
as $$ select case when p_bucket ~ '^exp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(p_bucket, 5)::uuid else null end $$;
revoke all on function app.export_bucket_owner(text) from public;
grant execute on function app.export_bucket_owner(text) to authenticated;

create function app.worker_may_delete_export(p_bucket text, p_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_scheduler()
     and exists (select 1 from privacy.data_exports e
                  where e.object_bucket = p_bucket and e.object_path = p_name and e.cleaned_at is null and e.expires_at is not null and e.expires_at < app.outbox_now())
$$;
revoke all on function app.worker_may_delete_export(text, text) from public, anon, service_role;
grant execute on function app.worker_may_delete_export(text, text) to authenticated;

-- (the worker may SEE an expired file too: Storage looks an object up with the caller's rights before it deletes it)
create policy exports_objects_select on storage.objects for select to authenticated
  using (app.export_bucket_owner(bucket_id) is not null and (app.export_bucket_owner(bucket_id) = (select auth.uid()) or app.worker_may_delete_export(bucket_id, name)));
create policy exports_objects_insert on storage.objects for insert to authenticated
  with check (app.export_bucket_owner(bucket_id) is not null and app.export_bucket_owner(bucket_id) = (select auth.uid()));
create policy exports_objects_delete on storage.objects for delete to authenticated
  using (app.export_bucket_owner(bucket_id) is not null and (app.export_bucket_owner(bucket_id) = (select auth.uid()) or app.worker_may_delete_export(bucket_id, name)));

create function public.data_export_ensure_bucket() returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket text;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  v_bucket := 'exp-' || auth.uid()::text;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (v_bucket, v_bucket, false, 52428800, array['application/zip'])
  on conflict (id) do nothing;
  return v_bucket;
end;
$$;
revoke all on function public.data_export_ensure_bucket() from public, anon;
grant execute on function public.data_export_ensure_bucket() to authenticated;

create function public.data_export_request(p_export_id uuid, p_scope text, p_tenant_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  e privacy.data_exports;
begin
  if v_uid is null then
    perform app.privacy_error('deny');
  end if;
  if p_export_id is null or p_scope is null or p_scope not in ('person', 'workspace') or (p_scope = 'workspace') <> (p_tenant_id is not null) then
    perform app.privacy_error('invalid');
  end if;
  if p_scope = 'workspace' then
    if not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
      perform app.privacy_error('deny');
    end if;
    perform app.require_aal2();
  end if;
  select * into e from privacy.data_exports x where x.id = p_export_id;
  if found then
    if e.user_id <> v_uid or e.scope <> p_scope or e.tenant_id is distinct from p_tenant_id then
      perform app.privacy_error('invalid');
    end if;
    return app.data_export_json(e);   -- a retry of the same request
  end if;
  -- an export that never finished (the process died) is given up after 30 minutes, so it cannot block the next one for ever
  update privacy.data_exports x set status = 'failed', error_code = 'internal'
   where x.user_id = v_uid and x.status in ('queued', 'running') and x.requested_at < app.outbox_now() - interval '30 minutes';
  if exists (select 1 from privacy.data_exports x where x.user_id = v_uid and x.status in ('queued', 'running')) then
    perform app.privacy_error('state');
  end if;
  if (select count(*) from privacy.data_exports x where x.user_id = v_uid and x.requested_at > app.outbox_now() - interval '24 hours') >= 5 then
    perform app.privacy_error('rate');
  end if;
  insert into privacy.data_exports (id, user_id, tenant_id, scope, requested_at) values (p_export_id, v_uid, p_tenant_id, p_scope, app.outbox_now()) returning * into e;
  perform app.data_export_audit(e, 'data_export.requested');
  return app.data_export_json(e);
end;
$$;
revoke all on function public.data_export_request(uuid, text, uuid) from public, anon;
grant execute on function public.data_export_request(uuid, text, uuid) to authenticated;

create function public.data_export_get(p_export_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e privacy.data_exports;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select * into e from privacy.data_exports x where x.id = p_export_id and x.user_id = auth.uid();
  if not found then
    perform app.privacy_error('reference');
  end if;
  return app.data_export_json(e);
end;
$$;
revoke all on function public.data_export_get(uuid) from public, anon;
grant execute on function public.data_export_get(uuid) to authenticated;

create function public.data_export_list() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.data_export_json(x) order by x.requested_at desc, x.id) from (select * from privacy.data_exports e where e.user_id = auth.uid() order by e.requested_at desc, e.id limit 20) x), '[]'::jsonb);
end;
$$;
revoke all on function public.data_export_list() from public, anon;
grant execute on function public.data_export_list() to authenticated;

create function public.data_export_begin(p_export_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e privacy.data_exports;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select * into e from privacy.data_exports x where x.id = p_export_id and x.user_id = auth.uid() for update;
  if not found then
    perform app.privacy_error('reference');
  end if;
  if e.status = 'running' then
    return app.data_export_json(e);
  end if;
  if e.status <> 'queued' then
    perform app.privacy_error('state');
  end if;
  update privacy.data_exports set status = 'running', started_at = app.outbox_now() where id = e.id returning * into e;
  return app.data_export_json(e);
end;
$$;
revoke all on function public.data_export_begin(uuid) from public, anon;
grant execute on function public.data_export_begin(uuid) to authenticated;

create function public.data_export_finish(p_export_id uuid, p_ok boolean, p_size bigint, p_sha256 text, p_error text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e privacy.data_exports;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select * into e from privacy.data_exports x where x.id = p_export_id and x.user_id = auth.uid() for update;
  if not found then
    perform app.privacy_error('reference');
  end if;
  if e.status not in ('running', 'queued') then
    perform app.privacy_error('state');
  end if;
  if p_ok is null then
    perform app.privacy_error('invalid');
  end if;
  begin
    if p_ok then
      update privacy.data_exports
         set status = 'ready', ready_at = app.outbox_now(), expires_at = app.outbox_now() + interval '24 hours', size_bytes = p_size, sha256 = p_sha256,
             object_bucket = 'exp-' || e.user_id::text, object_path = e.id::text || '.zip'
       where id = e.id returning * into e;
      perform app.data_export_audit(e, 'data_export.ready');
    else
      update privacy.data_exports set status = 'failed', error_code = coalesce(p_error, 'internal') where id = e.id returning * into e;
    end if;
  exception when check_violation then
    perform app.privacy_error('invalid');
  end;
  return app.data_export_json(e);
end;
$$;
revoke all on function public.data_export_finish(uuid, boolean, bigint, text, text) from public, anon;
grant execute on function public.data_export_finish(uuid, boolean, bigint, text, text) to authenticated;

-- the person asks for a download link: counted and audited here; the API then asks Storage to sign the file for a few minutes
create function public.data_export_link(p_export_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e privacy.data_exports;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select * into e from privacy.data_exports x where x.id = p_export_id and x.user_id = auth.uid() for update;
  if not found then
    perform app.privacy_error('reference');
  end if;
  if e.status <> 'ready' or e.expires_at <= app.outbox_now() then
    perform app.privacy_error('state');
  end if;
  update privacy.data_exports set downloads = downloads + 1 where id = e.id returning * into e;
  perform app.data_export_audit(e, 'data_export.downloaded');
  return jsonb_build_object('bucket', e.object_bucket, 'path', e.object_path, 'expires_at', e.expires_at, 'size_bytes', e.size_bytes, 'sha256', e.sha256);
end;
$$;
revoke all on function public.data_export_link(uuid) from public, anon;
grant execute on function public.data_export_link(uuid) to authenticated;

-- what the ACCOUNT holds about the signed-in person (not the workspaces' business records: those are the workspace export, for an Owner). The trail is the person's own actions: when, what kind, which kind of record; no values.
create function public.data_export_person_data() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform app.privacy_error('deny');
  end if;
  return jsonb_build_object(
    'account', (select jsonb_build_object('id', u.id, 'email', a.email, 'display_name', u.display_name, 'created_at', u.created_at)
                  from public.users u join auth.users a on a.id = u.id where u.id = v_uid),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('workspace', t.name, 'workspace_id', t.id, 'role', m.role, 'since', m.created_at) order by m.created_at)
                               from public.memberships m join public.tenants t on t.id = m.tenant_id where m.user_id = v_uid), '[]'::jsonb),
    'terms_at_sign_up', (select jsonb_build_object('terms_version', ta.terms_version, 'accepted_at', ta.accepted_at) from public.terms_acceptances ta where ta.user_id = v_uid),
    'policy_acceptances', coalesce((select jsonb_agg(jsonb_build_object('kind', pa.kind, 'version', pa.version, 'accepted_at', pa.accepted_at, 'via', pa.via) order by pa.accepted_at)
                                      from integrations.policy_acceptances pa where pa.user_id = v_uid), '[]'::jsonb),
    'calendar_feeds', coalesce((select jsonb_agg(jsonb_build_object('workspace_id', c.tenant_id, 'made_at', c.created_at, 'last_used_at', c.last_used_at, 'revoked_at', c.revoked_at) order by c.created_at)
                                  from integrations.calendar_tokens c where c.user_id = v_uid), '[]'::jsonb),
    'my_actions', coalesce((select jsonb_agg(jsonb_build_object('at', x.created_at, 'workspace_id', x.tenant_id, 'action', x.action, 'record_type', x.entity_type) order by x.created_at desc)
                              from (select * from public.audit_events a where a.actor_user_id = v_uid order by a.created_at desc limit 5000) x), '[]'::jsonb),
    'my_assistant_chat', coalesce((select jsonb_agg(jsonb_build_object('at', x.created_at, 'workspace_id', x.tenant_id, 'conversation_id', x.conversation_id, 'role', x.role, 'text', x.body) order by x.created_at)
                                     from (select * from public.assistant_messages am where am.created_by = v_uid order by am.created_at desc limit 5000) x), '[]'::jsonb),
    'my_exports', coalesce((select jsonb_agg(app.data_export_json(e) order by e.requested_at desc) from privacy.data_exports e where e.user_id = v_uid), '[]'::jsonb),
    'my_deletion_requests', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'status', d.status, 'requested_at', d.requested_at, 'execute_after', d.execute_after) order by d.requested_at)
                                        from privacy.deletion_requests d where d.user_id = v_uid), '[]'::jsonb));
end;
$$;
revoke all on function public.data_export_person_data() from public, anon;
grant execute on function public.data_export_person_data() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. deletion of an account or a workspace, after a cooling-off
-- ---------------------------------------------------------------------------------------------------------------------------------
create table privacy.deletion_requests (
  id                 uuid primary key,
  kind               text not null check (kind in ('account', 'workspace')),
  user_id            uuid not null,
  tenant_id          uuid references public.tenants (id) on delete restrict,
  status             text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'executed', 'blocked')),
  requested_at       timestamptz not null default now(),
  execute_after      timestamptz not null,
  cancelled_at       timestamptz,
  executed_at        timestamptz,
  blocked_reason     text check (blocked_reason in ('sole_owner', 'internal')),
  check ((kind = 'workspace') = (tenant_id is not null)),
  check (execute_after > requested_at),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'executed') = (executed_at is not null))
);
create unique index deletion_one_open_account_idx on privacy.deletion_requests (user_id) where kind = 'account' and status = 'scheduled';
create unique index deletion_one_open_workspace_idx on privacy.deletion_requests (tenant_id) where kind = 'workspace' and status = 'scheduled';
alter table privacy.deletion_requests enable row level security;
alter table privacy.deletion_requests force row level security;
revoke all on privacy.deletion_requests from public, anon, authenticated, service_role;
comment on table privacy.deletion_requests is 'Job BN: a request to delete an account or a workspace; nothing happens before execute_after. No personal data.';

create function app.deletion_cooling_off() returns interval language sql immutable set search_path = '' as $$ select interval '14 days' $$;
revoke all on function app.deletion_cooling_off() from public;

create function app.deletion_json(d privacy.deletion_requests) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', d.id, 'kind', d.kind, 'tenant_id', d.tenant_id, 'status', d.status, 'requested_at', d.requested_at, 'execute_after', d.execute_after,
                            'cancelled_at', d.cancelled_at, 'executed_at', d.executed_at, 'blocked_reason', d.blocked_reason)
$$;
revoke all on function app.deletion_json(privacy.deletion_requests) from public;

-- the workspaces where this person is the ONLY Owner
create function app.sole_owner_tenants(p_user uuid) returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(m.tenant_id), '{}') from public.memberships m
   where m.user_id = p_user and m.role = 'owner'
     and not exists (select 1 from public.memberships o where o.tenant_id = m.tenant_id and o.role = 'owner' and o.user_id <> p_user)
$$;
revoke all on function app.sole_owner_tenants(uuid) from public;

create function public.deletion_request(p_id uuid, p_kind text, p_tenant_id uuid default null, p_confirm text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  d privacy.deletion_requests;
  v_after timestamptz := app.outbox_now() + app.deletion_cooling_off();
begin
  if v_uid is null then
    perform app.privacy_error('deny');
  end if;
  if p_id is null or p_kind is null or p_kind not in ('account', 'workspace') or (p_kind = 'workspace') <> (p_tenant_id is not null) or p_confirm is null then
    perform app.privacy_error('invalid');
  end if;
  select * into d from privacy.deletion_requests x where x.id = p_id;
  if found then
    if d.user_id <> v_uid or d.kind <> p_kind or d.tenant_id is distinct from p_tenant_id then
      perform app.privacy_error('invalid');
    end if;
    return app.deletion_json(d);   -- a retry
  end if;
  if p_kind = 'workspace' then
    if not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
      perform app.privacy_error('deny');
    end if;
    perform app.require_aal2();
    if btrim(p_confirm) <> (select t.name from public.tenants t where t.id = p_tenant_id) then
      perform app.privacy_error('confirm');
    end if;
  else
    if exists (select 1 from public.memberships m where m.user_id = v_uid and m.role in ('owner', 'admin')) then
      perform app.require_aal2();
    end if;
    if lower(btrim(p_confirm)) <> lower((select a.email from auth.users a where a.id = v_uid)) then
      perform app.privacy_error('confirm');
    end if;
    if cardinality(app.sole_owner_tenants(v_uid)) > 0 then
      perform app.privacy_error('sole_owner');
    end if;
  end if;
  begin
    insert into privacy.deletion_requests (id, kind, user_id, tenant_id, requested_at, execute_after) values (p_id, p_kind, v_uid, p_tenant_id, app.outbox_now(), v_after) returning * into d;
  exception when unique_violation then
    perform app.privacy_error('state');   -- one open request at a time
  end;
  if p_kind = 'workspace' then
    -- the existing erasure request (tenant scope) is made now, so its own 24-hour wait passes during the cooling-off; nothing is erased until deletion_execute_workspace
    perform public.request_erasure(p_id, p_tenant_id, 'tenant', null);
    perform app.write_audit_event(p_tenant_id, 'deletion.requested', 'deletion_request', p_id, null, jsonb_build_object('kind', 'workspace', 'execute_after', v_after));
  else
    perform app.write_audit_event(m.tenant_id, 'deletion.requested', 'deletion_request', p_id, null, jsonb_build_object('kind', 'account', 'execute_after', v_after))
       from public.memberships m where m.user_id = v_uid;
  end if;
  return app.deletion_json(d);
end;
$$;
revoke all on function public.deletion_request(uuid, text, uuid, text) from public, anon;
grant execute on function public.deletion_request(uuid, text, uuid, text) to authenticated;

create function public.deletion_cancel(p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d privacy.deletion_requests;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select * into d from privacy.deletion_requests x where x.id = p_id and x.user_id = auth.uid() for update;
  if not found then
    perform app.privacy_error('reference');
  end if;
  if d.status = 'cancelled' then
    return app.deletion_json(d);
  end if;
  if d.status <> 'scheduled' then
    perform app.privacy_error('state');
  end if;
  if d.kind = 'workspace' then
    perform public.cancel_erasure(d.id);
    perform app.write_audit_event(d.tenant_id, 'deletion.cancelled', 'deletion_request', d.id, null, '{}'::jsonb);
  else
    perform app.write_audit_event(m.tenant_id, 'deletion.cancelled', 'deletion_request', d.id, null, '{}'::jsonb) from public.memberships m where m.user_id = d.user_id;
  end if;
  update privacy.deletion_requests set status = 'cancelled', cancelled_at = app.outbox_now() where id = d.id returning * into d;
  return app.deletion_json(d);
end;
$$;
revoke all on function public.deletion_cancel(uuid) from public, anon;
grant execute on function public.deletion_cancel(uuid) to authenticated;

create function public.deletion_list(p_tenant_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  if p_tenant_id is not null and not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.deletion_json(x) order by x.requested_at desc, x.id)
                     from (select * from privacy.deletion_requests d
                            where (p_tenant_id is null and d.user_id = auth.uid()) or (p_tenant_id is not null and d.tenant_id = p_tenant_id)
                            order by d.requested_at desc, d.id limit 20) x), '[]'::jsonb);
end;
$$;
revoke all on function public.deletion_list(uuid) from public, anon;
grant execute on function public.deletion_list(uuid) to authenticated;

-- after the cooling-off, the Owner (second factor) runs the EXISTING erasure of the whole workspace, in this one call
create function public.deletion_execute_workspace(p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d privacy.deletion_requests;
  v_result jsonb;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select * into d from privacy.deletion_requests x where x.id = p_id and x.kind = 'workspace' for update;
  if not found or not app.has_tenant_role(d.tenant_id, array['owner']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  perform app.require_aal2();
  if d.status <> 'scheduled' then
    perform app.privacy_error('state');
  end if;
  if app.outbox_now() < d.execute_after then
    perform app.privacy_error('cooling');
  end if;
  v_result := public.execute_erasure(d.id, false);
  update privacy.deletion_requests set status = 'executed', executed_at = app.outbox_now() where id = d.id;
  perform app.write_audit_event(d.tenant_id, 'deletion.executed', 'deletion_request', d.id, null, jsonb_build_object('kind', 'workspace'));
  return jsonb_build_object('deletion', (select app.deletion_json(x) from privacy.deletion_requests x where x.id = d.id), 'erasure', v_result);
end;
$$;
revoke all on function public.deletion_execute_workspace(uuid) from public, anon;
grant execute on function public.deletion_execute_workspace(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the worker's part (the scheduler principal only)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.privacy_worker_execute_account_deletions(p_limit integer default 10) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d privacy.deletion_requests;
  v_done integer := 0;
  v_blocked integer := 0;
  t uuid;
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.privacy_error('invalid');
  end if;
  for d in select * from privacy.deletion_requests x where x.kind = 'account' and x.status = 'scheduled' and x.execute_after <= app.outbox_now() order by x.execute_after, x.id limit p_limit for update skip locked loop
    if cardinality(app.sole_owner_tenants(d.user_id)) > 0 then
      update privacy.deletion_requests set status = 'blocked', blocked_reason = 'sole_owner' where id = d.id;
      v_blocked := v_blocked + 1;
      continue;
    end if;
    begin
      for t in select m.tenant_id from public.memberships m where m.user_id = d.user_id loop
        perform app.write_audit_event(t, 'account.deleted', 'user', d.user_id, null, '{}'::jsonb);
      end loop;
      -- the account's own files are removed by the clean-up below (their rows stay: ids and sizes, no personal data)
      update privacy.data_exports set expires_at = least(coalesce(expires_at, app.outbox_now()), app.outbox_now() - interval '1 second') where user_id = d.user_id and cleaned_at is null and object_path is not null;
      update privacy.grievances set submitted_by = null where submitted_by = d.user_id;   -- what they wrote stays with the workspace, without their id
      delete from auth.users where id = d.user_id;   -- cascades: the profile, the memberships, the sign-up records, the feeds, the acceptances
      update privacy.deletion_requests set status = 'executed', executed_at = app.outbox_now() where id = d.id;
      v_done := v_done + 1;
    exception when others then
      update privacy.deletion_requests set status = 'blocked', blocked_reason = 'internal' where id = d.id;
      v_blocked := v_blocked + 1;
    end;
  end loop;
  return jsonb_build_object('executed', v_done, 'blocked', v_blocked);
end;
$$;
revoke all on function public.privacy_worker_execute_account_deletions(integer) from public, anon;
grant execute on function public.privacy_worker_execute_account_deletions(integer) to authenticated;

create function public.privacy_worker_expired_exports(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.privacy_error('invalid');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'bucket', x.object_bucket, 'path', x.object_path) order by x.expires_at, x.id)
                     from (select * from privacy.data_exports e where e.cleaned_at is null and e.object_path is not null and e.expires_at < app.outbox_now() order by e.expires_at, e.id limit p_limit) x), '[]'::jsonb);
end;
$$;
revoke all on function public.privacy_worker_expired_exports(integer) from public, anon;
grant execute on function public.privacy_worker_expired_exports(integer) to authenticated;

create function public.privacy_worker_export_cleaned(p_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  update privacy.data_exports set cleaned_at = app.outbox_now(), status = case when status = 'ready' then 'expired' else status end where id = p_id and cleaned_at is null;
end;
$$;
revoke all on function public.privacy_worker_export_cleaned(uuid) from public, anon;
grant execute on function public.privacy_worker_export_cleaned(uuid) to authenticated;
