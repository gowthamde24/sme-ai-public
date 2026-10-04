# ADR 0004: RLS policy pattern (T003, milestone 1a)

Status: accepted. Corrects ADR 0001 #4 and replaces the T002 policy expressions via a new migration
(`20261005090000_t003_rls_policy_pattern.sql`). No tables or behaviour changed.

## Context

ADR 0001 wrapped helper calls as `(select app.is_tenant_member(tenant_id))` on the belief that Postgres would evaluate them once per statement (an InitPlan). **That belief was wrong.** The argument is a column of the row being tested, so the subselect is correlated and cannot be hoisted: the plan shows `Filter: (SubPlan 1)` with `loops=120000`. The helper runs once per row of the whole table, across all tenants, not just the caller's rows.

`supabase/bench/rls_policy_cost.sql` measures it (`make bench-rls`; one rolled-back transaction, local stack only). Pattern **A** is the T002 pattern; **B** is the shipped one. Milliseconds, best of three for reads, caller owns about 400 rows:

| 300 tenants, 120k rows | A (per-row helper) | B (once per statement) |
| --- | --- | --- |
| `count(*)` whole table | 539 | 0.18 |
| parent-child join count | 1,125 | 0.39 |
| list 50 newest in one tenant | 0.28 | 0.18 |
| primary-key lookup | 0.04 | 0.04 |
| update all rows of the tenant | 79 | 26 |
| users: `count(*)` with co-member check (50k people) | 328 | 0.11 |

At 1,000 tenants and 500k rows, A's `count(*)` took 2,313 ms and the join 4,305 ms (it grows with the whole table); B stayed at 0.21 and 0.50 ms. A user in 5 tenants costs B about 3x one tenant and still stays at about a millisecond. Queries filtered by `tenant_id` hide the problem (0.3 ms either way), which is why it stayed unnoticed. Bulk inserts of 2,000 rows were noisy across runs (17 to 245 ms, no consistent winner); updates were consistently 2 to 3x faster with B.

## Decision

1. **Policies compare the row's tenant to a list computed once per statement:**
   `tenant_id = any (((select app.my_tenant_ids()))::uuid[])`. The subselect takes no row argument, so it is an InitPlan, and `= ANY(array)` uses the `tenant_id` index (bitmap index scan in the plans).
2. **Three helpers**, all `SECURITY DEFINER`, `STABLE`, `search_path = ''`, executable by `authenticated` only, with no caller-supplied argument (the subject is always `auth.uid()`):
   - `app.my_tenant_ids()`
   - `app.my_tenant_ids_with_role(roles[])`, used for write policies and audit
   - `app.my_co_member_ids()`, used for reading co-members' profiles
3. **They never return NULL.** No membership, no `auth.uid()`, a NULL role list or an empty one all give `'{}'`, which matches no rows (fail closed). `coalesce(array_agg(...), '{}')` makes that explicit instead of relying on `x = ANY(NULL)` being unknown; tests assert it for every case.
4. **One-row checks keep the old helpers.** `app.is_tenant_member(uuid)` and `app.has_tenant_role(uuid, roles[])` remain for function bodies ("may the caller act on tenant X?"), never for policies on multi-row tables. `app.shares_tenant_with` and `app.current_user_id` were unused after the change and were dropped.
5. **Semantics are unchanged.** The T002 pgTAP suite (432 assertions) passes without edits. Admins still manage only `sales` and `viewer` rows, audit is still Owner/Admin-only, and so on.

## Enforcement (so the next tables cannot regress)

`06_catalog_guards.test.sql` now fails if:
- any policy on any public table mentions `is_tenant_member`, `has_tenant_role` or `shares_tenant_with`;
- any policy on a tenant-owned table does not use `my_tenant_ids*`;
- any public table with RLS plans a `SubPlan` for `select *` as a signed-in user, or does not plan an `InitPlan`;
- an unlisted function is executable by `authenticated` (allow-list updated), or `anon` can execute any of ours.

`09_policy_pattern.test.sql` covers the helper contract: never NULL, exact role filtering, no role carry-over for a user who is Owner of A and Viewer of B, co-member counts, and immediate revocation (a removed membership leaves the list in the same statement-visible state, no cached claims). Mutation runs that each fail a test: a policy reverted to a per-row helper, a helper that may return NULL, a role-blind helper, `USING (true)`, `anon` granted execute, and a helper that ignores the caller.

## Consequences and limits

- New tenant-owned tables copy exactly this pattern. Composite foreign keys (T003 1b) matter for correctness; this ADR is about cost.
- The helper still costs one indexed probe of `memberships` per statement. A caller who belongs to thousands of tenants would carry a large array; not a V1 concern, revisit if it appears.
- `my_co_member_ids()` materialises every co-member id per statement. Fine for the `users` table; do not reuse it for large tenant-owned tables.
- Insert timings are noisy on this laptop (WAL and checkpoints dominate); re-measure on production-like hardware before the pilot.
- A statement sees the membership list as of its start. Within one statement a concurrent revocation is not visible, which is the normal read-committed behaviour for any policy.
