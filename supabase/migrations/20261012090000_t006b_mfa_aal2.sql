-- T006b / M3a: a second factor (aal2) for Owners and Admins on privileged actions (ADR 0016).
--
--   app.require_aal2()               raises SM306 "a second factor is required for this action" unless the request's token says aal2.
--                                    A token with no aal claim is refused (fail closed). Executable by its owner only.
--   erasure functions                request_erasure, execute_erasure (preview included) and cancel_erasure check it AFTER the caller's
--                                    role in the tenant is proven, so a stranger still gets the generic 42501 and learns nothing about
--                                    the session's level; and BEFORE idempotency / replay, so a password-only session is never handed
--                                    a stored result. Same bodies as 20261010090100 apart from that line (and execute_erasure keeps its
--                                    300 s statement timeout, which CREATE OR REPLACE would otherwise drop).
--   set_tenant_agents_enabled        the same, after its role check.
--   app.guard_aal2_client_write()    a trigger on memberships (insert, update, delete) and tenants (update): a write made through a CLIENT
--                                    role (authenticated / anon) without aal2 is refused with SM306. RLS filters non-owners first, so
--                                    Sales and Viewers see "0 rows", not this error. The trusted role is not caught: create_tenant,
--                                    the signup trigger and the operator functions run as postgres.
--   app.operator_reset_mfa(email, reason)
--                                    operator only (no request identity). Removes the person's TOTP factors AND ends all their sessions
--                                    (a lost device may be in someone else's hands); the reason (20+ characters) is audited in every
--                                    workspace the person belongs to. The person signs in with the password and enrols again.

create function app.require_aal2() returns void
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'a second factor is required for this action' using errcode = 'SM306';
  end if;
end;
$$;
revoke all on function app.require_aal2() from public;

create function app.guard_aal2_client_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- security INVOKER on purpose: current_user is the role running the statement
  if current_user in ('authenticated', 'anon') and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'a second factor is required for this action' using errcode = 'SM306';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_aal2_client_write() from public;
create trigger memberships_guard_aal2 before insert or update or delete on public.memberships
  for each row execute function app.guard_aal2_client_write();
create trigger tenants_guard_aal2 before update on public.tenants
  for each row execute function app.guard_aal2_client_write();

create or replace function public.set_tenant_agents_enabled(p_tenant_id uuid, p_enabled boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_enabled is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  perform app.require_aal2();
  insert into public.tenant_agent_settings as s (tenant_id, enabled, updated_by, updated_at)
  values (p_tenant_id, p_enabled, v_uid, now())
  on conflict (tenant_id) do update set enabled = excluded.enabled, updated_by = v_uid, updated_at = now();
  return jsonb_build_object('tenant_id', p_tenant_id, 'enabled', p_enabled);
end;
$$;

create or replace function public.request_erasure(
  p_request_id uuid,
  p_tenant_id  uuid,
  p_scope      text,
  p_subject_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope public.erasure_scope;
  r public.erasure_requests;
begin
  -- 1. who: an Owner or Admin of that tenant. Everything before this line answers the generic refusal.
  if auth.uid() is null or p_request_id is null or p_tenant_id is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.erasure_deny();
  end if;
  -- the second factor (ADR 0016): asked only of a caller whose role is already proven
  perform app.require_aal2();
  -- 2. what
  if p_scope is null or p_scope not in ('contact', 'company', 'tenant') then
    perform app.erasure_state_error('invalid');
  end if;
  v_scope := p_scope::public.erasure_scope;
  if (v_scope = 'tenant') <> (p_subject_id is null) then
    perform app.erasure_state_error('invalid');
  end if;
  if v_scope = 'contact' and not exists (select 1 from public.contacts where id = p_subject_id and tenant_id = p_tenant_id) then
    perform app.erasure_state_error('reference');
  end if;
  if v_scope = 'company' and not exists (select 1 from public.companies where id = p_subject_id and tenant_id = p_tenant_id) then
    perform app.erasure_state_error('reference');
  end if;
  -- 3. idempotency
  perform pg_advisory_xact_lock(hashtextextended('erasure:' || p_tenant_id::text, 0));
  select * into r from public.erasure_requests where id = p_request_id;
  if found then
    if r.tenant_id = p_tenant_id and r.scope = v_scope and r.subject_id is not distinct from p_subject_id then
      return app.erasure_json(r, true);
    end if;
    perform app.erasure_state_error('used');
  end if;
  begin
    insert into public.erasure_requests (id, tenant_id, scope, subject_id, requested_by, execute_after)
    values (p_request_id, p_tenant_id, v_scope, p_subject_id, auth.uid(),
            case when v_scope = 'tenant' then now() + interval '24 hours' else now() end)
    returning * into r;
  exception when unique_violation then
    perform app.erasure_state_error('used');
  end;
  return app.erasure_json(r, false);
end;
$$;

create or replace function public.cancel_erasure(p_request_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.erasure_requests;
begin
  select * into r from public.erasure_requests where id = p_request_id;
  if auth.uid() is null or not found
     or not app.has_tenant_role(r.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.erasure_deny();
  end if;
  perform app.require_aal2();
  perform pg_advisory_xact_lock(hashtextextended('erasure:' || r.tenant_id::text, 0));
  select * into r from public.erasure_requests where id = p_request_id for update;
  if r.status = 'cancelled' then
    return app.erasure_json(r, true);
  elsif r.status = 'executed' then
    perform app.erasure_state_error('SM303');
  elsif r.status <> 'pending' then
    perform app.erasure_state_error('SM301');
  end if;
  update public.erasure_requests set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
   where id = r.id returning * into r;
  return app.erasure_json(r, false);
end;
$$;

create or replace function public.execute_erasure(p_request_id uuid, p_dry_run boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '300s'
as $$
declare
  r public.erasure_requests;
  v_body jsonb;
  v_result jsonb;
  v_note constant text :=
    'Erasure is complete for structured data and for exact identifiers (e-mail address, phone number, website host). '
    'Names are matched only when a whole field equals the name; free text that merely contains a name is listed under review '
    'and left unchanged, and the Owner decides. Files already exported or downloaded, and backups, are outside this procedure.';
begin
  select * into r from public.erasure_requests where id = p_request_id;
  if auth.uid() is null or not found or not app.has_tenant_role(r.tenant_id, array['owner']::public.app_role[]) then
    perform app.erasure_deny();
  end if;
  -- the second factor (ADR 0016), before the stored result of an executed request could be handed back
  perform app.require_aal2();
  -- one erasure at a time per workspace; re-read the row once the lock is held
  perform pg_advisory_xact_lock(hashtextextended('erasure:' || r.tenant_id::text, 0));
  select * into r from public.erasure_requests where id = p_request_id for update;

  if r.status = 'executed' then
    return r.result || jsonb_build_object('replayed', true);
  elsif r.status = 'cancelled' then
    perform app.erasure_state_error('SM304');
  elsif r.status <> 'pending' then
    perform app.erasure_state_error('SM301');
  end if;
  if r.scope = 'tenant' and not p_dry_run and now() < r.execute_after then
    perform app.erasure_state_error('SM302');
  end if;

  begin
    -- open the door (condition b): the setting names this request and the request says 'executing'
    perform set_config('app.erasure_request', r.id::text, true);
    update public.erasure_requests set status = 'executing' where id = r.id;

    v_body := case r.scope
                when 'contact' then app.erase_contact(r)
                when 'company' then app.erase_company(r)
                else app.erase_tenant(r)
              end;
    v_result := v_body || jsonb_build_object(
      'request_id', r.id,
      'scope', r.scope,
      'status', case when p_dry_run then 'dry_run' else 'executed' end,
      'dry_run', p_dry_run,
      'exports_logged', (select count(*) from public.data_exports e where e.tenant_id = r.tenant_id),
      'note', v_note);

    if p_dry_run then
      -- unwind everything done above (rows, audit rows, the status); the answer travels in the exception text
      raise exception '%', v_result::text using errcode = 'SM399';
    end if;

    update public.erasure_requests
       set status = 'executed', executed_by = auth.uid(), executed_at = now(), result = v_result
     where id = r.id;
  exception when sqlstate 'SM399' then
    return sqlerrm::jsonb;
  end;

  perform set_config('app.erasure_request', '', true);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

create function app.operator_reset_mfa(p_email text, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user    uuid;
  v_factors int;
  t         record;
begin
  if auth.uid() is not null then
    raise exception 'operator function' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 or char_length(p_reason) > 200 or not app.text_is_clean(p_reason) then
    raise exception 'a reason of at least 20 characters is required' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'no such account' using errcode = '23503';
  end if;
  select count(*) into v_factors from auth.mfa_factors f where f.user_id = v_user;
  delete from auth.mfa_factors where user_id = v_user;
  delete from auth.sessions where user_id = v_user;
  for t in select m.tenant_id from public.memberships m where m.user_id = v_user loop
    perform app.write_audit_event(t.tenant_id, 'mfa.operator_reset', 'user', v_user, null,
                                  jsonb_build_object('factors_removed', v_factors), jsonb_build_object('reason', p_reason));
  end loop;
end;
$$;
revoke all on function app.operator_reset_mfa(text, text) from public, anon, authenticated, service_role;
