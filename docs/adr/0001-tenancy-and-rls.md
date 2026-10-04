# ADR 0001: Tenancy, authorization and audit (T002)

Status: accepted for milestone 1 (database). API and web integration follow in later T002 milestones.

## Decisions

1. **Authorization lives in the database.** `public.memberships (tenant_id, user_id, role)` is the single source of truth. Roles (`owner`, `admin`, `sales`, `viewer`) are not stored in JWT claims, so removing a member takes effect on the next request rather than at token expiry. `user_metadata` is user-editable and is never trusted.
2. **RLS is enabled and forced on every table; default deny.** Policies are `TO authenticated` only, and `anon` holds no privileges. Policies call helpers in a private `app` schema (`is_tenant_member`, `has_tenant_role`, `shares_tenant_with`). The helpers are `SECURITY DEFINER` with `search_path = ''` and take no user argument: the subject is always `auth.uid()`. The `app` schema is absent from `[api].schemas`, so PostgREST does not expose it.
3. **Column-level grants limit what can change.** Clients can update only `tenants.name`, `memberships.role` and `users.display_name`. `tenant_id` is immutable on every tenant-owned table, via a reusable trigger (`app.forbid_tenant_id_change`) that holds even for the table owner.
4. **Privilege escalation is closed in policy and trigger.** An Admin cannot create, modify or remove an Owner, or promote anyone to Owner. A tenant can never lose its last Owner (trigger, serialised by a row lock on the tenant).
5. **Tenants are created only by `public.create_tenant(name, slug)`.** It is `SECURITY DEFINER`, validates its input, creates the first Owner membership atomically, and is idempotent for the tenant's Owner. Clients have no INSERT or DELETE privilege on `tenants`.
6. **Audit is written by database triggers, not application code.** `audit_events` records tenant, actor (JWT subject, or `system` when there is none), action, entity, and full `old_values` / `new_values`. Owner and Admin can read their tenant's events. No client can write them. UPDATE, DELETE and TRUNCATE are blocked by privilege and by trigger. The FK to `tenants` is `ON DELETE RESTRICT`.
7. **T002 uses no service-role key.** Nothing in the repository holds it. The API (next milestone) will act with the caller's own JWT so RLS always applies.
8. **A catalog guard test polices future tables** (`supabase/tests/database/06_catalog_guards.test.sql`). Any public table with a `tenant_id` column must have forced RLS, a policy, a NOT NULL FK to `tenants`, a leading `tenant_id` index and the immutability trigger. `SECURITY DEFINER` functions must pin `search_path`. Views must be `security_invoker`. `anon` must hold no grants.

## Known limits (accepted for now)

- Roles `postgres` and `service_role` have `BYPASSRLS` in Supabase, and table owners and superusers can disable triggers. Audit is "append-only style", not tamper-proof; a hash chain or external sink is deferred.
- Deleting a tenant (and the matching export/deletion workflow) is deferred; the audit FK deliberately blocks a naive delete.
- Invitations by email, MFA, and rate limiting are out of scope for T002.
- `memberships` admin-vs-admin management is permitted (an Admin may demote a peer Admin); revisit if the product needs stricter rules.
