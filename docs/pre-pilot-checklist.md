# Pre-pilot checklist

Every risk, limit or deferred item recorded in the ADRs, in one place. Nothing here blocks local development. Each item has a **gate**: the point by which it must be closed or consciously accepted in writing.

Gates: **T003** (before the next ticket builds on tenancy), **Pilot data** (before any real customer data is imported, per `docs/product.md`), **External pilot** (before a second, external tenant), **Scale** (before volume or a public launch).

Status key: `[ ]` open, `[x]` done. Add the ticket or ADR that closed it. Add new items as ADRs are written.

## Security gate carry-overs

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Benchmark RLS per-row cost.** Every policy calls a `SECURITY DEFINER` helper that probes `memberships`. Run `EXPLAIN (ANALYZE, BUFFERS)` on select, join and write paths with many tenants and ~10^5 rows per tenant-owned table; confirm the helper runs as an InitPlan; fall back to a `tenant_id IN (SELECT ...)` form if not. | ADR 0001 #4 | **T003** |
| [ ] | **CI has never run.** The `db` job (`supabase/setup-cli` pinned to 2.119.0, pgTAP, integration tests) and the web/api jobs are untested on GitHub. Push a branch, get CI green, make it a required check. | ADR 0001, 0002 | **T003** |
| [ ] | **BYPASSRLS dependency.** `postgres` (owner, runs every `SECURITY DEFINER` function) and `service_role` bypass RLS. A bug in any definer function is a cross-tenant bug. Keep the catalog guard's allow-list reviewed in every migration PR; never add a service-role key without explicit approval. | ADR 0001 #1 | Ongoing; review at every migration |
| [ ] | **Concurrent last-owner race.** Covered over HTTP against the real stack, and shown to fail if the tenant row lock is removed. Re-run when the trigger changes. | ADR 0002 | Ongoing |

## Identity and API

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Production auth config.** Set `API_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ALGORITHMS` (https only). Verify the hosted project's signing-key mode (ES256/JWKS vs legacy HS256) and that startup fails when any is missing. | ADR 0002 #1, #3 | **Pilot data** |
| [ ] | **JWKS revocation window.** A key removed from the JWKS can verify tokens for up to the 10-minute key-set cache; access tokens live 1 hour by default. Decide whether to shorten either for pilot. | ADR 0002 | **Pilot data** |
| [ ] | **API rate limiting.** None yet. Add per-user and per-IP limits (including `POST /v1/tenants` and the audit endpoint). | ADR 0002 | **External pilot** |
| [ ] | **Sync HTTP client in the threadpool.** Fine at V1 scale; revisit (async client or connection limits) if the API becomes I/O heavy. | ADR 0002 | **Scale** |
| [ ] | **MFA.** Not implemented. Owners/Admins of a tenant holding customer data should require it. | ADR 0001 #7 | **Pilot data** |
| [ ] | **Email confirmation and password policy.** The local stack has confirmations off and a 6-character minimum. Turn confirmations on and raise the minimum on the hosted project. | `supabase/config.toml` | **Pilot data** |
| [ ] | **Invitations by email.** No invite flow: members can only be added by user id. Needs a design that does not leak which emails have accounts. | ADR 0001 #7 | **External pilot** |

## Web app

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Email confirmation callback.** No `/auth/confirm` route handler exists, so turning on confirmations (required for a hosted project) would leave sign-ups unable to complete. Build it, validate its redirect target with `safeRedirectPath`, and configure the project's Site URL and redirect allow-list. | ADR 0003 | **Pilot data** |
| [ ] | **Password reset and account recovery UI.** Not built. | ADR 0003 | **Pilot data** |
| [ ] | **Security headers and CSP** (frame-ancestors, nosniff, referrer policy, a nonce-based CSP per the Next.js CSP guide). | ADR 0003 | **Pilot data** |
| [ ] | **Login abuse controls.** Only Supabase Auth's built-in rate limits. Add CAPTCHA/lockout or edge rate limiting for sign-in and sign-up. | ADR 0003 | **External pilot** |
| [ ] | **Proxy latency.** `getUser()` runs on every `/app` and `/login` request. Measure; consider verifying the JWT locally (asymmetric keys) with a short cache. | ADR 0003 | **Scale** |
| [ ] | **Production cookie and URL config.** Verify `Secure` cookies, https-only `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_API_BASE_URL`, and the deployed domain for session cookies. | ADR 0003 | **Pilot data** |
| [ ] | **Dev-tooling audit findings.** `npm audit` reports 5 high issues in dev dependencies (`braces`); production dependencies report 0. Update when upstream fixes land; keep `npm audit --omit=dev` clean. | ADR 0003 | Ongoing |
| [ ] | **Tenant-scoped pages.** `/app` lists workspaces only. Later pages must live under `/app/tenants/{id}/...` and rely on the API's 404 for foreign tenants. | ADR 0003 | **T003** |

## Data lifecycle and privacy (India: DPDP Rules 2025, TRAI)

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Audit rows vs erasure of personal data.** `audit_events` is immutable and stores whole row snapshots; `actor_user_id` is a bare uuid with no FK. Decide retention, whether actor ids are pseudonymised on erasure (a privileged, audited procedure as the one sanctioned exception to append-only), and keep personal data out of audited columns (never add email/phone to audited tables without revisiting). | ADR 0001 #3 | **Pilot data** |
| [ ] | **Account deletion vs last-owner rule.** Deleting an auth user who is the sole Owner of a tenant is refused (23514) by design. The deletion flow must first transfer ownership or run tenant closure. | ADR 0001 #2 | **Pilot data** |
| [ ] | **Tenant data export and deletion workflow.** The audit FK deliberately blocks a naive tenant delete. Required by `docs/architecture.md` before external pilots. | ADR 0001 #6, architecture.md | **External pilot** |
| [ ] | **Audit is "append-only style", not tamper-proof.** The table owner or a superuser can disable triggers. Add a hash chain or ship events to an external sink. | ADR 0001 #5 | **External pilot** |
| [ ] | **India-qualified legal review** before external production data or scaled outreach; consent and suppression state are first-class records. | architecture.md | **Pilot data** |

## Product rules to confirm

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Admin scope.** Admins manage only `sales` and `viewer`; they cannot add or remove Admins or Owners, and cannot leave a tenant themselves (an Owner must remove them). Confirm this matches how Customer Zero runs. | ADR 0001 #4, #8 | **Customer Zero** |
| [ ] | **Slug claim leak.** `create_tenant` returns 409 for a slug owned by someone else, which confirms the slug exists (nothing else). Accept, or move to server-generated slugs. | ADR 0002 | **External pilot** |

## Environment hygiene

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Secrets review.** Confirm `.env` is untracked, no secret appears in git history, and the service-role key exists nowhere in this repository or in browser bundles (guard tests cover the repo). | CLAUDE.md | **Pilot data** |
| [ ] | **Backups and restore test** for the hosted database, including audit history. | (not yet in an ADR) | **Pilot data** |
| [ ] | **Migration discipline.** Pushed migrations are append-only (CLAUDE.md). The four T002 migrations are still local-only; after the first push, changes go in new files. | CLAUDE.md | **First push** |
