-- T002 / 3 of 4: RLS helpers, policies and grants. This is the isolation boundary.
--
-- Model: a user may act on a tenant only through a row in public.memberships. Every policy asks
-- the helpers below; the helpers read memberships as the function owner (SECURITY DEFINER) so the
-- memberships policy cannot recurse into itself. They take no user argument: the subject is
-- always auth.uid() from the verified JWT, never caller-supplied.
--
-- Policies call helpers as `(select app.fn(...))` so Postgres evaluates them once per statement
-- (InitPlan) instead of once per row where possible.
--
-- Pattern for a new tenant-owned table (T003+): tenant_id uuid NOT NULL REFERENCES tenants,
-- index on tenant_id, forbid_tenant_id_change trigger, ENABLE + FORCE RLS, policies TO
-- authenticated using app.is_tenant_member / app.has_tenant_role, explicit minimal GRANTs.
-- supabase/tests/database/06_catalog_guards.test.sql fails if any of that is missing.

-- ---------------------------------------------------------------------------------------------
-- Helpers (private schema `app`)
-- ---------------------------------------------------------------------------------------------
create function app.current_user_id() returns uuid
language sql
stable
set search_path = ''
as $$ select auth.uid() $$;

create function app.is_tenant_member(p_tenant_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
  )
$$;

create function app.has_tenant_role(p_tenant_id uuid, p_roles public.app_role[]) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = auth.uid() and m.role = any (p_roles)
  )
$$;

-- True when the caller and p_user_id are both members of at least one common tenant.
create function app.shares_tenant_with(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  )
$$;

revoke all on function app.current_user_id() from public, anon;
revoke all on function app.is_tenant_member(uuid) from public, anon;
revoke all on function app.has_tenant_role(uuid, public.app_role[]) from public, anon;
revoke all on function app.shares_tenant_with(uuid) from public, anon;
grant execute on function app.current_user_id() to authenticated;
grant execute on function app.is_tenant_member(uuid) to authenticated;
grant execute on function app.has_tenant_role(uuid, public.app_role[]) to authenticated;
grant execute on function app.shares_tenant_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- tenants: members read; owners rename (name only). Created only via public.create_tenant().
-- No INSERT or DELETE privilege exists for clients at all.
-- ---------------------------------------------------------------------------------------------
grant select on public.tenants to authenticated;
grant update (name) on public.tenants to authenticated;

create policy tenants_select on public.tenants
  for select to authenticated
  using ((select app.is_tenant_member(id)));

create policy tenants_update on public.tenants
  for update to authenticated
  using ((select app.has_tenant_role(id, array['owner']::public.app_role[])))
  with check ((select app.has_tenant_role(id, array['owner']::public.app_role[])));

-- ---------------------------------------------------------------------------------------------
-- users: you, plus people you share a tenant with. Profile rows are created by the signup trigger
-- only; clients may edit their own display_name and nothing else.
-- ---------------------------------------------------------------------------------------------
grant select on public.users to authenticated;
grant update (display_name) on public.users to authenticated;

create policy users_select on public.users
  for select to authenticated
  using (id = (select auth.uid()) or (select app.shares_tenant_with(id)));

create policy users_update on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- memberships
--   read   : any member of the tenant
--   write  : Owner manages everyone. Admin manages ONLY sales/viewer rows: an Admin cannot add,
--            demote or remove an Admin or an Owner, cannot promote anyone to Admin or Owner, and
--            cannot change their own row. Sales/Viewer cannot write.
--   Only `role` is updatable; tenant_id and user_id are fixed at insert (column privileges, plus
--   the forbid_tenant_id_change trigger underneath).
--   The "last owner" invariant is enforced by trigger, not policy.
-- ---------------------------------------------------------------------------------------------
grant select on public.memberships to authenticated;
grant insert (tenant_id, user_id, role) on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;
grant delete on public.memberships to authenticated;

create policy memberships_select on public.memberships
  for select to authenticated
  using ((select app.is_tenant_member(tenant_id)));

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (
    (select app.has_tenant_role(tenant_id, array['owner']::public.app_role[]))
    or ((select app.has_tenant_role(tenant_id, array['admin']::public.app_role[])) and role in ('sales', 'viewer'))
  );

-- USING judges the row as it is (an Admin cannot touch an Admin or Owner row); WITH CHECK judges
-- the row as it would become (an Admin cannot turn a row into an Admin or Owner row).
create policy memberships_update on public.memberships
  for update to authenticated
  using (
    (select app.has_tenant_role(tenant_id, array['owner']::public.app_role[]))
    or ((select app.has_tenant_role(tenant_id, array['admin']::public.app_role[])) and role in ('sales', 'viewer'))
  )
  with check (
    (select app.has_tenant_role(tenant_id, array['owner']::public.app_role[]))
    or ((select app.has_tenant_role(tenant_id, array['admin']::public.app_role[])) and role in ('sales', 'viewer'))
  );

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (
    (select app.has_tenant_role(tenant_id, array['owner']::public.app_role[]))
    or ((select app.has_tenant_role(tenant_id, array['admin']::public.app_role[])) and role in ('sales', 'viewer'))
  );

-- ---------------------------------------------------------------------------------------------
-- audit_events: Owner/Admin of the tenant may read. Nobody writes through the API.
-- ---------------------------------------------------------------------------------------------
grant select on public.audit_events to authenticated;

create policy audit_events_select on public.audit_events
  for select to authenticated
  using ((select app.has_tenant_role(tenant_id, array['owner', 'admin']::public.app_role[])));
