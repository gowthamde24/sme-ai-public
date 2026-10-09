-- Job AD / D1: the plan of a business, and a limit on how many workspaces one account may own.
--
--   tenants.plan              'free_trial' for now (the only plan that exists; a later migration adds the next one).
--   tenants.workspace_limit   how many workspaces an Owner of this business may own on this plan (1 on the free trial).
--   tenants.trial_started_at  when the trial began (existing businesses: the day this migration ran).
--
-- A client can read these three columns (the tenants SELECT grant is table-wide) but can write none of them: the UPDATE
-- grant stays on `name` alone. Only the operator (the table owner) can change a plan or a limit.
--
-- THE LIMIT is enforced below the API, by a trigger on memberships: an owner row that would take a person above the limit is
-- refused with SQLSTATE SM307, whichever way it arrives (public.create_tenant, an operator function, a direct insert by the
-- table owner). A person's allowance is the largest workspace_limit among the workspaces they already own, or the limit of the new
-- workspace if that is larger. Turning an existing owner row into the same owner again changes nothing and is not counted.
-- Concurrent attempts by one person are serialised with a per-person advisory lock, so two tabs cannot both slip under the limit.

alter table public.tenants
  add column plan             text        not null default 'free_trial' check (plan in ('free_trial')),
  add column workspace_limit  integer     not null default 1 check (workspace_limit between 1 and 100),
  add column trial_started_at timestamptz not null default now();

comment on column public.tenants.plan is 'SAFE: the plan name (free_trial); not personal data';

-- Two small functions, because the trigger must be SECURITY INVOKER (it needs to know which role runs the statement) while counting
-- a person's owner rows in OTHER workspaces needs more sight than the caller's row-level security gives.
--
--   app.owner_allowance(user, tenant)  SECURITY DEFINER. Returns how many workspaces the person already owns, other than `tenant`,
--                                      and how many their plan allows. Reads nothing but those two numbers out.
--   app.enforce_workspace_limit()      the trigger (SECURITY INVOKER).
--
-- ORDER OF REFUSALS. A BEFORE trigger runs before the row-level-security check on the new row. So when a CLIENT role writes an owner row
-- for a workspace where it is not an Owner, the trigger steps aside and lets row-level security refuse it exactly as before (42501);
-- the limit never turns a forbidden write into a different-looking error. The trusted role (postgres: create_tenant, the operator
-- functions, a direct insert) always meets the limit.
create function app.owner_allowance(p_user uuid, p_tenant uuid, out owned integer, out allowed integer)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  select count(*), coalesce(max(t.workspace_limit), 0)
    into owned, allowed
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = p_user and m.role = 'owner' and m.tenant_id <> p_tenant;
  allowed := greatest(allowed, coalesce((select t.workspace_limit from public.tenants t where t.id = p_tenant), 0));
end;
$$;
revoke all on function app.owner_allowance(uuid, uuid) from public;
grant execute on function app.owner_allowance(uuid, uuid) to authenticated;

create function app.enforce_workspace_limit() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owned   integer;
  v_allowed integer;
begin
  if new.role <> 'owner' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and old.user_id = new.user_id and old.tenant_id = new.tenant_id then
    return new; -- the same owner row: nothing is added
  end if;
  -- a client that is not an Owner of this workspace is refused by row-level security, not here
  if current_user in ('authenticated', 'anon')
     and not (select app.has_tenant_role(new.tenant_id, array['owner']::public.app_role[])) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('workspace_limit:' || new.user_id::text, 0));

  select a.owned, a.allowed into v_owned, v_allowed from app.owner_allowance(new.user_id, new.tenant_id) a;
  if v_owned >= v_allowed then
    raise exception 'workspace limit reached: this plan allows % workspace(s) per owner', v_allowed
      using errcode = 'SM307';
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_workspace_limit() from public;

create trigger memberships_enforce_workspace_limit
  before insert or update of role, user_id, tenant_id on public.memberships
  for each row execute function app.enforce_workspace_limit();
