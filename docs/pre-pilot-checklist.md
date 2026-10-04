# Pre-pilot checklist

Every risk, limit or deferred item recorded in the ADRs, in one place. Nothing here blocks local development. Each item has a **gate**: the point by which it must be closed or consciously accepted in writing.

Gates: **T003** (before the next ticket builds on tenancy), **Pilot data** (before any real customer data is imported, per `docs/product.md`), **External pilot** (before a second, external tenant), **Scale** (before volume or a public launch).

Status key: `[ ]` open, `[x]` done. Add the ticket or ADR that closed it. Add new items as ADRs are written.

## Security gate carry-overs

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [x] | **Benchmark RLS per-row cost.** Measured in T003 1a: the T002 pattern ran the helper once per table row (550 ms to 4 s on 120k to 500k rows); replaced by the once-per-statement pattern (0.2 to 0.5 ms). Re-run `make bench-rls` on production-like hardware before the pilot. | ADR 0001 #4, ADR 0004 | **T003** (closed in 1a) |
| [x] | **CI has never run.** Closed after T002: CI is green on GitHub (the lockfile and Node pin were fixed in `89edc4a`). | ADR 0001, 0002 | **T003** |
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

## CRM, consent and personal data (T003)

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Erasure must tombstone `consent_events.evidence_ref`.** The ledger is append-only, and a typed reference (`<kind>:<token>`) can still point at something person-linked. The erasure procedure overwrites it with a tombstone matching the same pattern (e.g. `erased:1`) through ONE controlled, audited exception to append-only (a privileged function, `evidence_ref` only). Build and test that exception as part of the anonymise procedure. | ADR 0005 #3 | **Before T012** (part of the erasure hard gate) |
| [ ] | **Free-text columns policy.** Free text defaults to PII (audited by field name only). Review each `SAFE:` classification when columns are added or loosened, and re-check that `products.attributes` (4 KB jsonb) and `companies.name` stay free of personal data (sole proprietors name their companies after themselves). Guards enforce classification, not truth. | ADR 0005 #1 | Ongoing; **Pilot data** |
| [ ] | **Legal review of the consent model.** Channels (email, whatsapp, phone), the basis list (`explicit_consent`, `contractual`, `legitimate_use`, `other`), who may record/lift, ledger retention, and `can_contact` semantics against DPDP Rules 2025 and TRAI rules. | ADR 0005 #2 | **Pilot data** |
| [ ] | **Anonymise-in-place procedure for contacts and linked free text** (leads.source, disqualified_reason, opportunities.title, lost_reason, products.description, company tags). Must be privileged, audited by field name, tested, and cover backups. Clients can only archive. | ADR 0005 #3 | **Before T012** |
| [ ] | **Importer / agent provenance.** `created_via` accepts `import` / `agent` only from trusted server code via `set local app.created_via`. The first ticket that adds an importer or agent must use that path, test it, and keep clients on `manual`. | ADR 0005 #5 | First importer/agent ticket |
| [ ] | **SECURITY DEFINER code that inserts CRM rows must set `app.created_via` explicitly.** Inside a definer function `current_user` is the owner, so the provenance trigger falls back to the GUC (default `manual`). A future importer/agent path that forgets to set it would be mislabelled `manual`. Add a test per such function. | ADR 0005 #5 | First importer/agent ticket |
| [ ] | **Archived contacts keep their unique email.** Decide whether re-creating an archived contact's address should be possible (partial unique index) once the anonymise procedure exists. | ADR 0005 limits | **Pilot data** |
| [ ] | **Terminal opportunities are only status-locked.** Decide whether won/lost opportunities should freeze other fields. | ADR 0005 limits | **Customer Zero** |

## Evidence model (T004)

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Erasure/anonymise must reach evidence, claims and links.** `evidence.url`, `.snippet`, `.reference` and `claims.value` are PII-classified, immutable (only `archived_at` changes) and found by following `evidence_links` from the person's records (company / lead / claim). The anonymise procedure must (a) enumerate evidence by link, (b) overwrite those columns through ONE privileged, audited exception to `app.guard_immutable_record` (replace the function in its own migration), (c) relax the "url or reference" CHECK with an `erased_at` marker, (d) treat evidence shared by several targets as erased for all, and (e) include evidence with no link (milestone 2 creates evidence and its link atomically to avoid orphans). Test it like the consent tombstone. | ADR 0008 #8 | **Before T012** (part of the erasure hard gate) |
| [ ] | **ADR on the agent write path (identity and permission model for non-human actors) is a precondition for the T005 plan.** Decide between a per-tenant agent principal with a membership, short-lived delegation tokens minted by the API, or a SECURITY DEFINER write function authenticated by a signed run token. Never a service-role key. T004 only keeps all options open (`created_via = agent`, nullable `created_by`, writer-declared `retrieved_at`, `reference = run:<uuid>`). | ADR 0008 #9 | **Before the T005 plan** |
| [ ] | **Agent prompts must treat evidence as data.** Snippets, URLs and claim values are stored verbatim and may contain instructions. Any prompt built from them must delimit them as untrusted data and ignore embedded instructions (CLAUDE.md #6); add an eval for it in the agent ticket. | ADR 0008 #5 | First agent ticket |
| [ ] | **Claims shape is provisional.** Revisit predicate, value and the 4-level confidence when the research agent produces real claims; decide whether "confidence above `unverified` requires an evidence link" belongs in the atomic agent write function. | ADR 0008 #2 | First agent ticket |
| [ ] | **Writer-declared `provider` / `retrieved_at` are not verified**, and there is no per-tenant quota or rate limit on evidence rows. | ADR 0008 limits | **External pilot** |

## CRM API (T003 milestone 2)

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Proxy / CDN / load-balancer logs must drop query strings.** The API redacts its own access log, but `?q=<a person's name>` is still in the request line any front-end component sees. Configure every hop, and consider moving search to a POST body. | ADR 0006 #10 | **Pilot data** |
| [ ] | **Rate limiting and request-size limits** for the CRM endpoints (list, create, consent actions; large bodies, bulk creation loops). | ADR 0002, 0006 | **External pilot** |
| [ ] | **Production access-log redaction.** The filter attaches to `uvicorn.access` when the app is created. Verify it under the real process manager (gunicorn/uvicorn workers) and that no other access logger is enabled. | ADR 0006 #10 | **Pilot data** |
| [x] | **Dedicated SQLSTATE for the opportunity terminal-state error** (SM001) and for granting consent to a suppressed contact (SM002); the API no longer matches message text. | ADR 0006 | closed in 1d |
| [ ] | **Contacts expose e-mail and phone to every role** (including Viewer). Decide whether some roles should see masked values. | ADR 0006 limits | **Customer Zero** |
| [ ] | **Read-then-write race on archived rows** (`PATCH` checks `archived_at`, the database does not enforce "no edits while archived"). Add a trigger if it matters. | ADR 0006 limits | **Customer Zero** |

## 1d / direct data-layer access (T003)

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Review hosted rate limits before ANY `supabase config push`.** `supabase/config.toml` carries local-only values (e.g. `sign_in_sign_ups = 200`, email confirmations off, 6-character passwords). Pushing this file to a hosted project would apply them. Prefer configuring hosted Auth by hand or from a separate, reviewed file. | config.toml comment | **Pilot data** (before the first config push) |
| [ ] | **Decide whether to restrict direct PostgREST access in production.** Any signed-in user can talk to PostgREST directly with their JWT and the public anon key. `tests/integration/test_direct_postgrest.py` proves the database refuses every attack we model (cross-tenant reads/writes, forged provenance, consent columns, DELETE, consent functions, Viewer writes, Sales archiving), but the API is the intended single door: audit-friendly errors, rate limits, and logging only exist there. Options: network/gateway rules, a separate Postgres role for the API, or accept the exposure with the tests as the guarantee. | ADR 0006 | **Pilot data** |
| [ ] | **Archived-record edits are blocked in the API only.** The API refuses `PATCH` on archived rows; the database does not, so direct PostgREST writes to an archived row succeed. Also: the database does not stop consent withdrawals on archived contacts (deliberately: "stop contacting me" must always be recordable). If "archived = read-only" must hold at the data layer, add a trigger (and an explicit exception for withdrawals/suppression). | ADR 0006 | **Customer Zero** |

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
| [ ] | **Not-found UI is JavaScript-rendered.** `notFound()` in a dynamic page returns 404 + noindex but the server-rendered body is empty in this Next.js version (framework behaviour). Decide whether no-JS clients matter; if so, move the tenant check into a rendering path that flushes the 404 shell, or accept. | ADR 0007 | **Customer Zero** |
| [ ] | **Never expose `next dev`.** The development server puts a stack trace (with file paths) in a `<template>` of error/not-found responses. Production builds do not. | ADR 0007 | Ongoing |
| [ ] | **Contacts page shows e-mail and phone to every role**, same as the API. Decide on masking for Viewers. | ADR 0006/0007 | **Customer Zero** |
| [ ] | **CRM UI is read-only plus "create company".** Edit/archive/restore, consent actions, other creates and a "previous page" are not built. | ADR 0007 | Later tickets |

## Data lifecycle and privacy (India: DPDP Rules 2025, TRAI)

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **HARD GATE: erasure / anonymisation workflow for personal data, before T012.** CRM contacts (T003) hold personal data and humans can only archive, never delete. Build and test a privileged, audited procedure that anonymises a contact (and free-text fields that may mention them) on request, keeps the PII-free consent ledger and audit rows, and covers backups. No ticket from T012 on may start until it exists. | T003 plan (owner decision #4) | **Before T012** |
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
