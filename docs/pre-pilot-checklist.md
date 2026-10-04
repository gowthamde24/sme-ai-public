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
| [ ] | **ADR on the agent write path (identity and permission model for non-human actors) is a precondition for the T006 (agent runtime) plan. ADR 0013 is ACCEPTED (2026-10-04): the precondition is met; the T006 plan may proceed.** (T005, lead review, contains no agent and is not blocked by it.) Decide between a per-tenant agent principal with a membership, short-lived delegation tokens minted by the API, or a SECURITY DEFINER write function authenticated by a signed run token. Never a service-role key. T004 only keeps all options open (`created_via = agent`, nullable `created_by`, writer-declared `retrieved_at`, `reference = run:<uuid>`). | ADR 0008 #9 | **Before the T006 plan** |
| [ ] | **Agent prompts must treat evidence as data.** Snippets, URLs and claim values are stored verbatim and may contain instructions. Any prompt built from them must delimit them as untrusted data and ignore embedded instructions (CLAUDE.md #6); add an eval for it in the agent ticket. | ADR 0008 #5 | First agent ticket |
| [ ] | **A stored URL is not a URL safe to fetch (SSRF).** `evidence.url` only proves "http(s), no userinfo, clean text". The future fetcher must itself block private, loopback and link-local addresses (including IPv6 and DNS names that resolve to them), re-check the address after every redirect and limit redirects, restrict ports, set size and time limits, and never send credentials or cookies. Build it behind an interface (CLAUDE.md #9) and test it with a hostile-URL suite before the first research ticket fetches anything. | ADR 0008 #5 | First ticket that fetches a URL |
| [ ] | **`tenants.name` and `users.display_name` are not covered by the text-hygiene guard.** They are free text outside the tenant-owned tables the guard polices (`users.display_name` comes from sign-up metadata), so they can still hold invisible Unicode and are shown to other members. Fold `app.text_is_clean` CHECKs for both into the next migration that touches those tables (and review where the web displays them). | ADR 0008 #13, ADR 0009 | Next migration that touches `tenants` or `users`; at the latest **Pilot data** |
| [ ] | **Invisible-character list is a deny-list.** Re-read the Unicode "default ignorable" and tag ranges when upgrading Postgres/Unicode; a new invisible code point needs a migration (and the API mirror). | ADR 0008 #13 | Ongoing |
| [ ] | **Claims shape is provisional.** Revisit predicate, value and the 4-level confidence when the research agent produces real claims; decide whether "confidence above `unverified` requires an evidence link" belongs in the atomic agent write function. | ADR 0008 #2 | First agent ticket |
| [ ] | **Writer-declared `provider` / `retrieved_at` are not verified**, and there is no per-tenant quota or rate limit on evidence rows. | ADR 0008 limits | **External pilot** |

## Evidence UI and demo seed (T004 milestone 3)

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Production web refuses a non-https Supabase URL (by design), and its session cookies are `Secure`.** A local production build therefore needs a TLS front for the local stack (verified with a throwaway self-signed proxy). Document the local recipe or add a `make` target before anyone else runs a production build locally; hosted projects are https already. | ADR 0009 | **Pilot data** |
| [ ] | **The demo seed's user has a fixed password in `scripts/seed_demo.py`.** Safe only because the script refuses every non-local Supabase/API URL (tested). Never copy the pattern for a hosted project; delete the demo workspace and user from any database that is ever promoted to hold real data. | ADR 0009 | Before the local database is reused for real data |
| [ ] | **The demo seed is the only writer of claims.** Claims have no API and no UI. The research-agent ticket decides the claims write path (and its atomic "claim + first evidence link" function); until then claims exist only in the database tests and the seed. | ADR 0008 #2, ADR 0009 | First agent ticket |
| [ ] | **No-JS clients see an empty not-found body** for the new detail pages too (framework behaviour, as for the tenant page). | ADR 0007, 0009 | **Customer Zero** |

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
| [ ] | **CRM UI is read-only plus "create company" and "add evidence".** Edit/archive/restore (including archiving evidence links, which the API supports), consent actions, other creates, claims, and a "previous page" are not built. | ADR 0007, 0009 | Later tickets |

## Lead review (T005 fix round F): deferred items

Accepted when T005 was approved pending the human walkthrough. None blocks the walkthrough; each has a reason and a gate.

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **(a) `blind=false` is logged, not audited in the database.** Each non-blind queue request writes one log line (`app.leads.audit`: tenant id and user id, nothing else). Logs are not a durable audit trail. Reason deferred: the audit table is written only by triggers and a definer function, so recording a READ needs a new definer function (and a decision on audit volume). Build it with the first audited-read need, or before real data. | ADR 0011 (fix round F) | **Pilot data** |
| [ ] | **(b) The web import action generates a new batch id on every submit** (`importLeadsAction`, `crypto.randomUUID()` per call). A retry or double click is therefore a second batch, not a replay. Harm today is limited (open-lead de-duplication skips the repeated rows) but every extra batch also writes an `import_batches` row, rows and an evidence row. Fix like the label form: the page generates the id and the form re-sends it. Reason deferred: out of scope for the labels round. | ADR 0012 | **Before T012** |
| [ ] | **(c) Response and cap limits can silently under-score.** The queue reads the claims of a whole page of leads in ONE PostgREST request, and PostgREST caps a response at 1000 rows (`max_rows`); claims are also capped at 200 per company and evidence at 100 per lead (`app/leads/review.py`, shared by queue and label so they agree). A page of leads with many claims could be truncated without an error. Fix: read claims per company chunk and fail loudly when a response hits the cap. Reason deferred: demo and Customer Zero volumes are far below the limits. | ADR 0011 | **Pilot data** |
| [ ] | **(d) `ruff format` is not enforced.** `make lint` runs `ruff check` only; 7 files were already unformatted when this was noticed (the formatter and the 100-column limit disagree). Decide one: enforce `ruff format --check` in `make lint` after a one-time reformat commit, or remove the formatter from the workflow. Reason deferred: a repo-wide reformat is noise inside a ticket. | fix round F | Before a second contributor |
| [ ] | **(e) `match_key(None)` differs by design.** Python returns the empty key `""` for a missing value; SQL returns `NULL` (so `NULL = NULL` never matches, while `"" == ""` would). Documented in `tests/vectors/match_key.json` (`python_expected`). Safe while Python only compares names it has already checked for presence; revisit if Python ever de-duplicates in process. | ADR 0011 | Ongoing |
| [ ] | **(f) Never run two agents in one working folder (pre-agent lesson, Antigravity artefacts).** During T005, five tracked files were found at 0 bytes (three seconds apart, about three minutes after a commit) and two others carried stale edits, while Antigravity's background agent (`agy`) was still running with this repository added as a working directory, even though the app had been closed. The cause is not proven; the evidence is the timing and the live process. Rule: one agent (or one editor-integrated assistant) per working folder; use a separate `git worktree` for a second one; quit the other tool COMPLETELY (check `ps` for its helper processes) before starting another; start every session with `git status` clean and compare `HEAD` before trusting the tree. This applies to our own agent runtime too: two runs must never share a mutable working directory. | T005 fix round F, step 0 | Ongoing; read before the agent runtime ticket |
| [ ] | **(g) Blinding is an API-level workflow control, not a confidentiality boundary.** Members can read other reviewers' labels and their stored scores directly through RLS (read = any member). Decide only if blind review ever needs to hold against a determined member: that would need an RLS or column change that also affects label history and export. | ADR 0012 | Only if the requirement appears |

## Agents (ADR 0013, accepted 2026-10-04)

| | Item | Source | Gate |
| --- | --- | --- | --- |
| [ ] | **Option B (a dedicated agent principal) must exist before the first scheduled or background agent AND before any external customer.** Option A (delegated runs with the starting human's JWT) is accepted for user-initiated runs only. B needs its own ADR: the `agent` role excluded from `app.my_tenant_ids()`, operator-only provisioning, per-tenant credentials, rotation. T006's schema is designed not to block it (ADR 0013, "Compatibility with option B"). Revisit also at the first third-party or plugin code in the runtime process. | ADR 0013 decision 4 | **Before the first scheduled agent (T010/T011); before any external customer** |
| [ ] | **Require a second reviewer for agent-claim promotion when a tenant has more than 3 members.** Self-promotion of the starter's own run's claims is allowed in v1; the review row records `self_review`. Build the tenant rule and its UI before agents run in a tenant with more than 3 members. | ADR 0013 decision 1 | When a tenant has > 3 members and agents enabled |
| [ ] | **OWNER ACTION: set a hard spend cap at the model provider before the first real model call.** The database caps only what the runtime reports; the provider cap is the real limit. Use a dedicated key for this project with a monthly hard limit; never put the key in the repository (the runtime reads `ANTHROPIC_API_KEY` from the environment only). The runtime also refuses to call the provider until `LLM_SPEND_CAP_CONFIRMED=true` is set, together with `LLM_MODEL` (no default) and the two price settings `LLM_INPUT_MICROS_PER_MTOK` / `LLM_OUTPUT_MICROS_PER_MTOK`; the adapter has only ever run against a mock transport. | ADR 0013 decision 8 | **Before the first real model call** |
| [ ] | **Legal review (India DPDP; cross-border transfer of personal data to model providers) before T012.** v1 passes NO contact fields (names, phones, e-mails) to the model; company text and evidence snippets can still contain personal data (sole proprietors name their companies after themselves, snippets are free text). The review decides what may be sent, to whom, and where it is processed. | ADR 0013 decision 11 | **Before T012** |
| [ ] | **Agent limits, allow-lists and switches are migration-only.** `agent_limits`, `agent_definitions` and `platform_flags` have no application grant; changing a limit is a reviewed migration. Confirm the operator procedure for the platform switch (SQL console as the owner role) and who holds it. | ADR 0013 decisions 2, 3, 9 | Before agents are enabled for any tenant |
| [ ] | **Erasure reach into `agent_runs`, `agent_run_steps` and `claim_reviews`.** `created_by` / `started_by` hold the starting human's id, `input_refs` hold ids. Decide what the anonymise procedure does to them. | ADR 0013 | **Before T012** (part of the erasure hard gate) |
| [x] | **M2 must never forward a database message from the agent functions.** The refusals and state errors have fixed messages, but a payload that fails a table CHECK (hygiene, size, URL) raises PostgreSQL's own error whose DETAIL contains the failing row. The agent API maps by SQLSTATE to fixed messages (as the CRM API already does) and a test proves no row value reaches a response or a log. | ADR 0013 M1 note 7 | **Done in T006 M2** (`app/agent_runs/repository.py`, `app/agents/db.py`; tests `test_agent_runs_repository.py`, `test_agents_db.py`) |
| [ ] | **Run bookkeeping is audited as the human; only agent-written content is `actor_type = agent`.** Counters and the step ledger are written inside the agent functions but audited with the starter as `user`. Decide, if auditors need it, whether to mark them `agent` too (it needs the run setting held for the whole function body). | ADR 0013 M1 note 8 | **Pilot data** |
| [ ] | **The agent integration tests flip operator switches through `docker exec` into the local database container** (`tests/integration/operator_sql.py`). They restore the previous state exactly, but anyone running the suite against a non-Docker database must provide another way to act as the operator. | ADR 0013 M1 note 9 | Ongoing |

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
