-- T003 / 1a: faster, equivalent RLS policy pattern. No new tables, no behaviour change.
--
-- Problem (measured, see supabase/bench/rls_policy_cost.sql and ADR 0004): the T002 policies were
-- written as `(select app.is_tenant_member(tenant_id))`. That argument comes from the row being
-- tested, so Postgres cannot hoist it: the plan is a SubPlan evaluated once PER ROW OF THE TABLE
-- (every tenant's rows, not just the caller's). On 120k rows, `count(*)` took ~550 ms and a
-- parent/child join ~1.1 s for a caller who owns 400 rows.
--
-- Pattern: compute the caller's tenant list ONCE per statement, then compare the column to it.
--     tenant_id = any (((select app.my_tenant_ids()))::uuid[])
-- The subselect takes no row argument, so it becomes an InitPlan; `= ANY(array)` is index-friendly.
-- Same facts as before (memberships of auth.uid()); the helpers take no caller-supplied argument.
--
-- Contract: the helpers NEVER return NULL. No membership, no auth.uid(), a NULL or empty role list
-- all yield '{}', which matches no rows (fail closed). `x = ANY(NULL)` would also match nothing, but
-- relying on that is how policies silently stop working, so the empty array is explicit and tested.

-- ---------------------------------------------------------------------------------------------
-- New helpers
-- ---------------------------------------------------------------------------------------------
create function app.my_tenant_ids() returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.tenant_id), '{}'::uuid[])
  from public.memberships m
  where m.user_id = auth.uid()
$$;

-- Tenants where the caller holds one of the given roles.
create function app.my_tenant_ids_with_role(p_roles public.app_role[]) returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.tenant_id), '{}'::uuid[])
  from public.memberships m
  where m.user_id = auth.uid() and m.role = any (p_roles)
$$;

-- Users who share at least one tenant with the caller (for reading co-members' profiles).
create function app.my_co_member_ids() returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct theirs.user_id), '{}'::uuid[])
  from public.memberships mine
  join public.memberships theirs on theirs.tenant_id = mine.tenant_id
  where mine.user_id = auth.uid()
$$;

revoke all on function app.my_tenant_ids() from public, anon;
revoke all on function app.my_tenant_ids_with_role(public.app_role[]) from public, anon;
revoke all on function app.my_co_member_ids() from public, anon;
grant execute on function app.my_tenant_ids() to authenticated;
grant execute on function app.my_tenant_ids_with_role(public.app_role[]) to authenticated;
grant execute on function app.my_co_member_ids() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Re-express every existing policy. ALTER POLICY keeps names, roles and commands; only the
-- expressions change. Semantics are identical, and the T002 pgTAP suite must pass untouched.
-- ---------------------------------------------------------------------------------------------
alter policy tenants_select on public.tenants
  using (id = any (((select app.my_tenant_ids()))::uuid[]));

alter policy tenants_update on public.tenants
  using (id = any (((select app.my_tenant_ids_with_role(array['owner']::public.app_role[])))::uuid[]))
  with check (id = any (((select app.my_tenant_ids_with_role(array['owner']::public.app_role[])))::uuid[]));

alter policy users_select on public.users
  using (id = (select auth.uid()) or id = any (((select app.my_co_member_ids()))::uuid[]));

alter policy memberships_select on public.memberships
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));

-- Owner manages every row; Admin manages only sales/viewer rows (see ADR 0001 #4).
alter policy memberships_insert on public.memberships
  with check (
    tenant_id = any (((select app.my_tenant_ids_with_role(array['owner']::public.app_role[])))::uuid[])
    or (
      tenant_id = any (((select app.my_tenant_ids_with_role(array['admin']::public.app_role[])))::uuid[])
      and role in ('sales', 'viewer')
    )
  );

alter policy memberships_update on public.memberships
  using (
    tenant_id = any (((select app.my_tenant_ids_with_role(array['owner']::public.app_role[])))::uuid[])
    or (
      tenant_id = any (((select app.my_tenant_ids_with_role(array['admin']::public.app_role[])))::uuid[])
      and role in ('sales', 'viewer')
    )
  )
  with check (
    tenant_id = any (((select app.my_tenant_ids_with_role(array['owner']::public.app_role[])))::uuid[])
    or (
      tenant_id = any (((select app.my_tenant_ids_with_role(array['admin']::public.app_role[])))::uuid[])
      and role in ('sales', 'viewer')
    )
  );

alter policy memberships_delete on public.memberships
  using (
    tenant_id = any (((select app.my_tenant_ids_with_role(array['owner']::public.app_role[])))::uuid[])
    or (
      tenant_id = any (((select app.my_tenant_ids_with_role(array['admin']::public.app_role[])))::uuid[])
      and role in ('sales', 'viewer')
    )
  );

alter policy audit_events_select on public.audit_events
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));

-- ---------------------------------------------------------------------------------------------
-- Retire helpers nothing uses any more (smaller SECURITY DEFINER surface).
--   app.shares_tenant_with(uuid) and app.current_user_id() were only used by policies / unused.
-- KEPT: app.is_tenant_member(uuid) and app.has_tenant_role(uuid, app_role[]). They are the right
-- tool for ONE-row checks inside functions (e.g. "may this caller act on tenant X?"), never for
-- policies on multi-row tables; a catalog guard now enforces that split.
-- ---------------------------------------------------------------------------------------------
drop function app.shares_tenant_with(uuid);
drop function app.current_user_id();
