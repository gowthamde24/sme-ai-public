-- Job BY (ADR 0077), part 1 of 3: THE TEAM. How a person joins a workspace, changes role, leaves or is removed: the design of docs/plans/members-and-invitations.md (owner decisions of 2026-10-06), built.
--
--   team.invitations             a one-time code (the SHA-256 of the normalised 100-bit code is kept, never the code), the role (admin, sales or viewer: NEVER owner), a short label, 7 days by default
--   team.invitation_attempts     one row per FAILED presentation of a code: five an hour lock the caller out
--   public.create_invitation / accept_invitation / revoke_invitation / list_invitations
--   public.change_member_role / remove_member / team_members
--   app.operator_add_owner_exception   replaced as a full copy: at most 3 Owners in a workspace
--
-- What is NOT done here (stated in the ADR and the report): the client write grants of `memberships` are NOT revoked yet (plan decision 12). Every integration fixture, the MFA tests and the
-- rehearsal driver still add members by a direct write; revoking now would break them all. The functions below are the way to do it from the app; the revoke is a follow-up migration once the fixtures use them.
--
-- SQLSTATEs: 42501 deny, 22023 invalid, 23505 an id used with other content, SM306 second factor, SM240..SM248 below.
--   SM242 this role cannot be invited or changed by the caller (owner can never be invited; an Admin cannot grant admin)   SM243 no such member   SM244 the workspace must keep an Owner
--   SM245 you cannot change your own role   SM246 too many pending invitations (20)   SM247 already a member (only after the code is proven valid)   SM248 the invitation is not pending
--   (SM240 "code not valid" and SM241 "too many wrong codes" are RESULTS of accept_invitation, never raised: a raise would roll back the failed-attempt row.)

create schema team;
revoke all on schema team from public, anon, authenticated, service_role;

create function app.invite_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'      then raise exception 'invalid input' using errcode = '22023';
    when 'duplicate'    then raise exception 'already used' using errcode = '23505';
    when 'role'         then raise exception 'this role cannot be invited or changed by you' using errcode = 'SM242';
    when 'no_member'    then raise exception 'no such member' using errcode = 'SM243';
    when 'keep_owner'   then raise exception 'the workspace must keep an owner' using errcode = 'SM244';
    when 'own_role'     then raise exception 'you cannot change your own role' using errcode = 'SM245';
    when 'too_many'     then raise exception 'too many pending invitations' using errcode = 'SM246';
    when 'already'      then raise exception 'already a member' using errcode = 'SM247';
    when 'not_pending'  then raise exception 'the invitation is not pending' using errcode = 'SM248';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.invite_error(text) from public;

create table team.invitations (
  id          uuid primary key,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  role        text not null check (role in ('admin', 'sales', 'viewer')),
  code_sha256 text not null unique check (code_sha256 ~ '^[0-9a-f]{64}$'),
  -- "for the new cutter": it cannot carry a phone number or an address (a run of 7 digits, an at sign)
  label       text check (char_length(label) between 1 and 60 and label !~ '[0-9]{7,}' and label !~ '@' and app.text_is_clean(label)),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_by  uuid,
  revoked_at  timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check ((status = 'accepted') = (accepted_by is not null and accepted_at is not null)),
  check ((status = 'revoked') = (revoked_by is not null and revoked_at is not null))
);
create index invitations_tenant_idx on team.invitations (tenant_id, created_at desc);
alter table team.invitations enable row level security;
alter table team.invitations force row level security;
revoke all on team.invitations from public, anon, authenticated, service_role;
comment on column team.invitations.label is 'PII-adjacent free text (a short note such as "for the new cutter"); cleared when the workspace is erased.';

create table team.invitation_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index invitation_attempts_idx on team.invitation_attempts (user_id, at);
alter table team.invitation_attempts enable row level security;
alter table team.invitation_attempts force row level security;
revoke all on team.invitation_attempts from public, anon, authenticated, service_role;

-- the code: case folded, hyphens and spaces out, the Crockford look-alikes mapped (O->0, I and L->1), exactly 20 symbols of the alphabet; null for anything else (U is not in the alphabet)
create function app.invite_code_normalise(p_code text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_code is null or char_length(p_code) > 64 then
    return null;
  end if;
  v := translate(upper(regexp_replace(p_code, '[\s-]+', '', 'g')), 'OIL', '011');
  return case when v ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{20}$' then v else null end;
end;
$$;
revoke all on function app.invite_code_normalise(text) from public;

create function app.invite_code_hash(p_normalised text) returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p_normalised, 'UTF8')), 'hex') $$;
revoke all on function app.invite_code_hash(text) from public;

-- 100 random bits as 20 Crockford base32 symbols, in four groups of five
create function app.invite_code_make() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bits bit(104) := ('x' || encode(extensions.gen_random_bytes(13), 'hex'))::bit(104);
  v_out text := '';
  i integer;
begin
  for i in 0 .. 19 loop
    v_out := v_out || substr(v_alphabet, (substring(v_bits from i * 5 + 1 for 5)::integer) + 1, 1);
  end loop;
  return substr(v_out, 1, 5) || '-' || substr(v_out, 6, 5) || '-' || substr(v_out, 11, 5) || '-' || substr(v_out, 16, 5);
end;
$$;
revoke all on function app.invite_code_make() from public;

create function app.invitation_json(i team.invitations) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'role', i.role, 'label', i.label, 'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
                            'created_at', i.created_at, 'expires_at', i.expires_at, 'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at)
$$;
revoke all on function app.invitation_json(team.invitations) from public;

create function public.create_invitation(p_id uuid, p_tenant_id uuid, p_role text, p_days integer, p_label text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_days integer := coalesce(p_days, 7);
  v_code text;
  i team.invitations;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.invite_error('deny');
  end if;
  perform app.require_aal2();
  v_is_owner := app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]);
  if p_id is null or p_role is null or v_days not between 1 and 30 then
    perform app.invite_error('invalid');
  end if;
  if p_role = 'owner' or p_role not in ('admin', 'sales', 'viewer') or (p_role = 'admin' and not v_is_owner) then
    perform app.invite_error('role');
  end if;
  select * into i from team.invitations x where x.id = p_id;
  if found then
    if i.tenant_id <> p_tenant_id or i.created_by <> v_uid or i.role <> p_role or i.label is distinct from v_label then
      perform app.invite_error('duplicate');
    end if;
    return app.invitation_json(i) || jsonb_build_object('code', null, 'replayed', true);   -- the code is never shown again: revoke and make a new one
  end if;
  if (select count(*) from team.invitations x where x.tenant_id = p_tenant_id and x.status = 'pending' and x.expires_at > now()) >= 20 then
    perform app.invite_error('too_many');
  end if;
  v_code := app.invite_code_make();
  begin
    insert into team.invitations (id, tenant_id, role, code_sha256, label, created_by, expires_at)
    values (p_id, p_tenant_id, p_role, app.invite_code_hash(app.invite_code_normalise(v_code)), v_label, v_uid, now() + make_interval(days => v_days))
    returning * into i;
  exception when check_violation then
    perform app.invite_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'invitation.created', 'invitation', i.id, null, jsonb_build_object('role', i.role, 'days', v_days));
  return app.invitation_json(i) || jsonb_build_object('code', v_code, 'replayed', false);
end;
$$;
revoke all on function public.create_invitation(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.create_invitation(uuid, uuid, text, integer, text) to authenticated;

-- A person presents a code. NEVER raises on a wrong one (a raise would roll back the failed-attempt row). Unknown, expired, used, revoked and other-workspace codes take the same path and give the same answer.
create function public.accept_invitation(p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_norm text;
  i team.invitations;
  t public.tenants;
begin
  if v_uid is null then
    perform app.invite_error('deny');
  end if;
  delete from team.invitation_attempts a where a.at < now() - interval '24 hours';
  if (select count(*) from team.invitation_attempts a where a.user_id = v_uid and a.at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'locked');   -- the code is not even looked at
  end if;
  v_norm := app.invite_code_normalise(p_code);
  if v_norm is not null then
    select * into i from team.invitations x where x.code_sha256 = app.invite_code_hash(v_norm) for update;
  end if;
  if v_norm is null or i.id is null or i.status <> 'pending' or i.expires_at <= now() then
    insert into team.invitation_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid');
  end if;
  -- the code is PROVEN valid: now the specific refusals may be told
  if i.role = 'admin' then
    perform app.require_aal2();
  end if;
  if exists (select 1 from public.memberships m where m.tenant_id = i.tenant_id and m.user_id = v_uid) then
    perform app.invite_error('already');
  end if;
  insert into public.memberships (tenant_id, user_id, role) values (i.tenant_id, v_uid, i.role::public.app_role);
  update team.invitations set status = 'accepted', accepted_by = v_uid, accepted_at = now() where id = i.id;
  perform app.write_audit_event(i.tenant_id, 'invitation.accepted', 'invitation', i.id, null, jsonb_build_object('role', i.role));
  select * into t from public.tenants x where x.id = i.tenant_id;
  return jsonb_build_object('status', 'joined', 'tenant_id', t.id, 'tenant_name', t.name, 'role', i.role);
end;
$$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

create function public.revoke_invitation(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  i team.invitations;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.invite_error('deny');
  end if;
  perform app.require_aal2();
  select * into i from team.invitations x where x.id = p_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.invite_error('no_member');
  end if;
  if i.role = 'admin' and not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.invite_error('role');
  end if;
  if i.status = 'revoked' then
    return app.invitation_json(i);
  end if;
  if i.status <> 'pending' then
    perform app.invite_error('not_pending');
  end if;
  update team.invitations set status = 'revoked', revoked_by = v_uid, revoked_at = now() where id = i.id returning * into i;
  perform app.write_audit_event(p_tenant_id, 'invitation.revoked', 'invitation', i.id, null, jsonb_build_object('role', i.role));
  return app.invitation_json(i);
end;
$$;
revoke all on function public.revoke_invitation(uuid, uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid, uuid) to authenticated;

create function public.list_invitations(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.invite_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.invitation_json(x) || jsonb_build_object('created_by_name', (select u.display_name from public.users u where u.id = x.created_by)) order by x.created_at desc, x.id)
                     from (select * from team.invitations i where i.tenant_id = p_tenant_id order by i.created_at desc, i.id limit 100) x), '[]'::jsonb);
end;
$$;
revoke all on function public.list_invitations(uuid) from public, anon;
grant execute on function public.list_invitations(uuid) to authenticated;

-- the closed reasons of a role change or a removal
create function app.member_reason_ok(p_reason text) returns boolean
language sql
immutable
set search_path = ''
as $$ select coalesce(p_reason in ('left', 'role_changed', 'no_longer_works_here', 'access_no_longer_needed', 'security_concern', 'other'), false) $$;
revoke all on function app.member_reason_ok(text) from public;

create function public.change_member_role(p_tenant_id uuid, p_user_id uuid, p_role text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  m public.memberships;
  v_old text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.invite_error('deny');
  end if;
  perform app.require_aal2();
  v_is_owner := app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]);
  if p_user_id is null or p_role is null or not app.member_reason_ok(p_reason) then
    perform app.invite_error('invalid');
  end if;
  if p_user_id = v_uid then
    perform app.invite_error('own_role');
  end if;
  if p_role not in ('admin', 'sales', 'viewer') then
    perform app.invite_error('role');   -- owner can never be granted here
  end if;
  select * into m from public.memberships x where x.tenant_id = p_tenant_id and x.user_id = p_user_id for update;
  if not found then
    perform app.invite_error('no_member');
  end if;
  v_old := m.role::text;
  if v_old = 'owner' then
    perform app.invite_error('role');   -- a change FROM owner is the operator's
  end if;
  -- an Admin changes sales <-> viewer only
  if not v_is_owner and (v_old not in ('sales', 'viewer') or p_role not in ('sales', 'viewer')) then
    perform app.invite_error('role');
  end if;
  if v_old = p_role then
    return jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', false);
  end if;
  update public.memberships set role = p_role::public.app_role where id = m.id;
  perform app.write_audit_event(p_tenant_id, 'member.role_changed', 'membership', m.id, jsonb_build_object('role', v_old), jsonb_build_object('role', p_role), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', true);
end;
$$;
revoke all on function public.change_member_role(uuid, uuid, text, text) from public, anon;
grant execute on function public.change_member_role(uuid, uuid, text, text) to authenticated;

-- A member leaves (anyone but the only Owner) or is removed (an Owner: any Admin, Sales or Viewer; an Admin: Sales or Viewer). Access ends at once in the database (every policy reads memberships); the open work is
-- tidied in the same transaction and the result is COUNTS only.
create function public.remove_member(p_tenant_id uuid, p_user_id uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_leaving boolean;
  v_is_owner boolean;
  m public.memberships;
  v_leads integer; v_opps integer; v_runs integer; v_inv integer;
begin
  if v_uid is null or p_tenant_id is null or p_user_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.invite_error('deny');
  end if;
  v_leaving := p_user_id = v_uid;
  if not app.member_reason_ok(p_reason) or (v_leaving and p_reason <> 'left') or (not v_leaving and p_reason = 'left') then
    perform app.invite_error('invalid');
  end if;
  v_is_owner := app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]);
  if not v_leaving then
    if not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
      perform app.invite_error('deny');
    end if;
    perform app.require_aal2();
  end if;
  select * into m from public.memberships x where x.tenant_id = p_tenant_id and x.user_id = p_user_id for update;
  if not found then
    perform app.invite_error('no_member');
  end if;
  if m.role = 'owner' then
    -- an Owner is never removed from the app (the operator's job); an Owner cannot leave either while they are the only one
    if v_leaving and not exists (select 1 from public.memberships o where o.tenant_id = p_tenant_id and o.role = 'owner' and o.user_id <> v_uid) then
      perform app.invite_error('keep_owner');
    end if;
    if not v_leaving then
      perform app.invite_error('role');
    end if;
  elsif not v_leaving and not v_is_owner and m.role not in ('sales', 'viewer') then
    perform app.invite_error('role');   -- an Admin removes Sales and Viewers only
  end if;

  update public.leads set owner_user_id = null where tenant_id = p_tenant_id and owner_user_id = p_user_id;
  get diagnostics v_leads = row_count;
  update public.opportunities set owner_user_id = null where tenant_id = p_tenant_id and owner_user_id = p_user_id;
  get diagnostics v_opps = row_count;
  update public.agent_runs set status = 'cancelled', cancel_requested_at = now(), cancelled_by = v_uid, finished_at = now(), error_code = 'cancelled'
   where tenant_id = p_tenant_id and started_by = p_user_id and status = 'running';
  get diagnostics v_runs = row_count;
  update team.invitations set status = 'revoked', revoked_by = v_uid, revoked_at = now() where tenant_id = p_tenant_id and created_by = p_user_id and status = 'pending';
  get diagnostics v_inv = row_count;
  delete from public.memberships where id = m.id;
  perform app.write_audit_event(p_tenant_id, 'member.removed', 'membership', m.id, jsonb_build_object('role', m.role::text), null,
                                jsonb_build_object('reason', p_reason, 'leads_unassigned', v_leads, 'opportunities_unassigned', v_opps, 'runs_cancelled', v_runs, 'invitations_revoked', v_inv));
  return jsonb_build_object('user_id', p_user_id, 'removed', true, 'leads_unassigned', v_leads, 'opportunities_unassigned', v_opps, 'runs_cancelled', v_runs, 'invitations_revoked', v_inv);
end;
$$;
revoke all on function public.remove_member(uuid, uuid, text) from public, anon;
grant execute on function public.remove_member(uuid, uuid, text) to authenticated;

-- the team: who, in what role, since when (any member); Owner and Admin also see how many invitations wait
create function public.team_members(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_decider boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.invite_error('deny');
  end if;
  v_decider := app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', u.display_name, 'role', m.role, 'joined_at', m.created_at, 'is_you', m.user_id = auth.uid())
                                           order by case m.role when 'owner' then 0 when 'admin' then 1 when 'sales' then 2 else 3 end, m.created_at, m.user_id)
                           from public.memberships m left join public.users u on u.id = m.user_id where m.tenant_id = p_tenant_id), '[]'::jsonb),
    'pending_invitations', case when v_decider then (select count(*) from team.invitations i where i.tenant_id = p_tenant_id and i.status = 'pending' and i.expires_at > now()) end);
end;
$$;
revoke all on function public.team_members(uuid) from public, anon;
grant execute on function public.team_members(uuid) to authenticated;

-- the Owner role is created only here (plan decision 2); at most three Owners in a workspace (plan section 3.1). A full copy of the T006b function plus the cap.
create or replace function app.operator_add_owner_exception(p_tenant_slug text, p_email text, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user   uuid;
  v_member uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator function' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 or char_length(p_reason) > 200 or not app.text_is_clean(p_reason) then
    raise exception 'a reason of at least 20 characters is required' using errcode = '22023';
  end if;
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'unknown workspace' using errcode = '23503';
  end if;
  v_user := app.accepted_account_id(p_email);
  if exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = v_user) then
    raise exception 'already a member: change the role in the dashboard, not here' using errcode = '23505';
  end if;
  if (select count(*) from public.memberships m where m.tenant_id = v_tenant and m.role = 'owner') >= 3 then
    raise exception 'a workspace has at most three owners' using errcode = '22023';
  end if;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_user, 'owner') returning id into v_member;
  perform app.write_audit_event(v_tenant, 'membership.operator_added_owner', 'membership', v_member, null,
                                jsonb_build_object('role', 'owner'), jsonb_build_object('reason', p_reason));
end;
$$;

-- when a workspace is erased, the labels of its invitations go too
create function app.invitations_erase_on_tenant_erasure() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope = 'tenant' and new.status = 'executed' and old.status is distinct from 'executed' then
    update team.invitations set label = null where tenant_id = new.tenant_id and label is not null;
  end if;
  return new;
end;
$$;
revoke all on function app.invitations_erase_on_tenant_erasure() from public;
create trigger erasure_requests_erase_invitations after update on public.erasure_requests
  for each row execute function app.invitations_erase_on_tenant_erasure();
