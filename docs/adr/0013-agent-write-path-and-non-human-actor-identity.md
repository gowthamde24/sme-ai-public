# ADR 0013: Agent write path and non-human actor identity

Status: **accepted** (owner decisions of 2026-10-04 are recorded below and amend the design text; nothing in this ADR
is built yet). Builds on ADR 0001 (tenancy, memberships
as the single source of authorization), ADR 0002 (API authentication), ADR 0004 (RLS pattern), ADR 0005
(PII-aware audit, `created_via`), ADR 0008 (evidence and claims; its decision 9 left this question open) and
ADR 0010 (the import path, the first user of server-declared `created_via`). It is the precondition for the
T006 (agent runtime) plan (`docs/pre-pilot-checklist.md`).

## Owner decisions (2026-10-04)

These are binding and take precedence over any earlier wording in this document.

1. **Who:** owner, admin and sales may START a run. Only **owner and admin may PROMOTE** claims (accept/reject).
   Self-promotion of the starter's own run's claims is allowed in v1. Checklist: require a second reviewer when a
   tenant has more than 3 members.
2. **Agents are OFF by default per tenant** (an Owner/Admin switches them on), and there is an operator-only
   platform switch.
3. **Limits as proposed** (15-minute default TTL / 30-minute hard cap, 3 concurrent runs, 30 runs per hour, 500
   writes per day) but stored as **operator-managed table values, changeable by a migration only**; no application
   role can write them (a pgTAP test proves it). They are not tenant settings.
4. **Option A for v1.** **Option B (a dedicated principal) is required before the first scheduled or background
   agent AND before any external customer.** The revisit triggers below stand.
5. **Unaccepted agent claims do NOT count toward ICP scores.** The UI shows them as "agent suggestion,
   unreviewed". The review queue and the label snapshot must use the same filtered inputs.
6. **Promotion** is an append-only `claim_reviews` record (accepted/rejected plus a human-assigned
   low/medium/high), one claim per call, origin forced `manual`.
7. **Agent rows carry `created_by` = the starting human PLUS `created_via = 'agent'` and `agent_run_id`.** The audit
   `actor_type` for delegated agent writes is fixed in T006.
8. **The owner sets a hard spend cap at the model provider before the first real model call** (checklist item,
   owner action).
9. **Allow-lists (predicates, ceilings) live in an operator-managed table, migration-only.**
10. **ADR 0014 (agent principal) is NOT required before T006.** This ADR gains a "Compatibility with option B"
    section showing that T006's schema does not block it.
11. **v1 passes NO contact fields (names, phones, e-mails) to the model.** Checklist: legal review (India DPDP,
    cross-border transfer to model providers) before T012.
12. **`pgsodium` is out of scope.**

## Why

CLAUDE.md puts three rules on any agent: it may not send, change a price, commit money or delete without an
explicit policy and approval path (#3); every AI output used for business action keeps provenance and
uncertainty (#5); inbound email, webpages and documents are untrusted content (#6). Plus: least privilege
(narrow tools, no generic SQL, no unrestricted key), auditability (every run records tenant, actor,
inputs/references, tool calls, result, approval, timestamp), idempotency, model portability.

Those rules are about behaviour. Behaviour needs an identity: when a research agent writes a claim, which
database principal does it, what may that principal do, and how does anyone tell afterwards who wrote it? Until
that is decided, the first agent ticket would invent it inside application code.

## Hard constraints (from the owner; not up for trade-off)

1. **No service-role key anywhere**: not in the API, the runtime, a worker, a script, an environment file.
2. **No minting of arbitrary JWTs with the Supabase JWT secret.** A secret that can sign any `sub`/`role` is as
   powerful as the service role. It must not exist in application configuration.
3. **`memberships` stay the single source of authorization.** No second permission system.
4. **Agent output is UNTRUSTED until a human promotes it.**
5. **`created_via = 'agent'` is server-forced, never client-settable.**
6. **Every agent write is traceable to a run**, and the run to who started it.

## What the system does today (the facts the options are judged against)

- **Credentials.** Supabase access tokens live 1 hour (`jwt_expiry = 3600`) and refresh tokens rotate. The web
  app holds the session; the API receives the user's **access token only** (`Principal.token`) and forwards it
  to PostgREST, so RLS runs as that user. The API holds no refresh token and cannot extend a session.
- **Authorization** is checked live in the database on every call (`app.has_tenant_role`,
  `app.my_tenant_ids*`). A removed or demoted member loses access at the next statement, whatever token they
  hold.
- **Provenance.** `app.set_created_meta` forces `created_via = 'manual'` for `authenticated`/`anon`; trusted
  server code may declare `import`/`agent` with `set local app.created_via`, honoured only when
  `current_user` is not a client role (inside a `SECURITY DEFINER` function it is the owner, so the GUC is
  honoured; `import_lead_rows` is the working example). `created_by` is `auth.uid()`.
- **Audit gap.** `app.write_audit_event` records `actor_type = 'user'` whenever `auth.uid()` is set. Today an
  agent write made with a human's token would be audited **as the human**. `actor_type = 'agent'` exists in the
  CHECK but nothing can produce it.
- **Evidence and claims** are append-only (only `archived_at` changes). A claim's confidence is immutable and
  cannot be edited after the fact; any Sales+ user can today insert a claim at any confidence through
  PostgREST (manual provenance).
- **Definer functions** run as `postgres` and bypass RLS (checklist: BYPASSRLS dependency). Every one is a
  potential cross-tenant bug and is guarded by catalog tests and source-audit tests (pattern: ADR 0010,
  `import_lead_rows`).
- **Direct PostgREST** is reachable by any signed-in user (checklist), so anything an agent function allows, a
  human holding a token can also call.
- Available on the stack: `supabase_vault` (installed), `pg_cron`, `pgmq`, `pgjwt`, `pgsodium` (available,
  not installed; its long-term status on Supabase must be verified before anyone relies on it).

## Options

### A. Delegated runs: the agent acts with the starting human's JWT, writing only through definer functions

The user starts a run (`start_agent_run`, a definer function) and the runtime performs it with that user's
access token. Reads use the user's own RLS scope. **Writes happen only through narrow `SECURITY DEFINER`
functions** (`agent_write_evidence`, `agent_write_claim`, ...) that require an existing `agent_runs` row (same
tenant as derived from the row, started by the caller, status `running`, not expired, within its write budget,
starter still holding a writing role), force `created_via = 'agent'`, force claim confidence `unverified`, set
`agent_run_id`, apply `app.text_is_clean` and a column/predicate allow-list. No new credential exists.

- **Security.** Nothing new to steal or leak: the token already exists for the request. Authority is capped by
  the human's current role, re-checked at every write. Tenant steering is impossible by construction (the
  function takes a run id, not a tenant id). A leaked token is bounded by its remaining life (≤ 1 hour).
- **Weakness (honest).** The database cannot distinguish "the runtime" from "the human": both present the same
  JWT. So **least privilege is enforced by the funnel in our code, not by the credential.** A compromised or
  buggy runtime can call PostgREST directly with the human's full rights (write `manual` rows, even call the
  promotion route). The funnel contains a *steered* model (prompt injection) and *mistakes*; it does not
  contain *compromised runtime code*. The API process already holds that token today, so A adds no new
  exposure, but it also does not add a DB-level wall. Likewise a human can call the agent functions directly
  and produce rows labelled `agent`: harmless in privilege terms (more restricted than what they can write
  manually), noted as a repudiation nuance (`created_by` is still that human).
- **Operational cost.** Lowest: two migrations, about six functions, no secrets, no provisioning, no new login
  flows.
- **Failure modes.** Runs die at token expiry (so runs must be short and resumable); a run started by a user
  who is later removed stops at the next write (desired); the runtime and the DB can disagree about "running"
  after a crash (a sweeper marks `expired`); user-initiated only, **nothing can run when nobody is signed in**.

### B. Per-tenant agent principal: a real auth user per tenant with a narrow `agent` membership role

Each tenant has an auth user with a membership of role `agent`. Policies grant that role only what an agent
needs; the runtime authenticates as it.

- **How the API obtains its JWT without the service role or the JWT secret (exactly).** It signs in to GoTrue
  with the agent user's email and password (password grant) and uses the returned access token; the refresh
  token is not kept, a fresh sign-in happens per run (concurrent refreshes of one rotating refresh token trip
  Supabase's reuse detection and revoke the session). The password lives in the deployment's secret manager,
  one secret per tenant (a single master secret from which passwords are derived would again be a mint-all
  key, which is constraint 2 by another name). **Creating the user is the hard part**: it needs the admin API
  (service role) or open sign-up. Neither may exist in app code, so provisioning is a human-run, audited
  operator procedure (CLI/dashboard on an operator's machine, then the membership row through a definer
  function that only the operator can call). Open sign-up would allow squatting the agent email before the
  operator, so the procedure must be atomic and the email unguessable.
- **Blast radius if a credential leaks.** The attacker acts as the agent of ONE tenant until the password is
  rotated or the membership removed (long-lived, unlike A). What that means depends on the RLS work below:
  done right, they cannot read personal data and cannot write anything but unverified agent rows within run
  limits; done wrong (the usual `my_tenant_ids()` includes every membership role), they read the whole
  tenant.
- **RLS cost.** `app.my_tenant_ids()` is the helper of every policy (ADR 0004). To make `agent` default-deny it
  must exclude that role (and a separate helper serves agent-specific policies); the catalog guards and the
  role matrix gain an `agent` row for every table. This is a change to the core of the isolation boundary: it
  is the largest risk in B and needs its own ADR and test matrix.
- **Security upside.** The wall is in the database: the agent principal cannot promote claims, cannot write
  `manual` rows, cannot read contacts, cannot touch another tenant, whatever the runtime does. Works with no
  human signed in (scheduled and background runs). A human is not the apparent author of agent work.
- **Operational cost.** Highest: per-tenant user lifecycle and rotation, a secret store keyed by tenant,
  sign-in rate limits per run, an operator procedure, support burden, membership-management guards (an Owner
  must not be able to grant `agent` to a human), a tenant-closure path that deletes the principal.
- **Failure modes.** Provisioning half-done; password drift between the secret store and GoTrue; GoTrue
  rate-limits on bursts of runs; a forgotten principal surviving tenant closure.

### C. API-minted short-lived delegation tokens verified by definer functions

The API signs a token (run, tenant, starter, expiry) and the functions verify it.

- **What signs them and where the key lives.** Either an asymmetric key held by the API (Ed25519 private key
  in the API's secret store) with the public key in the database and verification by `pgsodium`
  (`crypto_sign_verify_detached`; availability and long-term support on the hosted platform unverified), or an
  HMAC secret in `pgcrypto` terms, which must then live in BOTH the API's environment and the database (Vault).
  Either way a signing key for agent writes exists in the API's configuration.
- **Security.** The token authenticates "the call came from our API", nothing more: the database still has to
  re-derive everything from the run row (tenant, starter, status, budget), exactly as in A. So C = A plus a
  bearer secret. The functions would be reachable with the public anon key (there is no user JWT to
  authenticate with in the scheduled case), making a stolen token a write capability from anywhere until it
  expires. If the API can mint tokens without a human present (the only reason to prefer C), the signing key is
  **standing authority over every tenant's agent function surface**, a service-role-class secret scoped to one
  function family. It replaces Supabase's authentication with a bespoke bearer scheme and needs replay
  protection (nonces/step keys), key rotation and clock handling.
- **Operational cost.** Medium to high: key management, signature verification in SQL, rotation.
- **Failure modes.** Key leak = forge calls for any existing running run in any tenant; key rotation outage;
  clock skew; a new extension dependency.

### Comparison

| | A. Delegated runs | B. Agent principal | C. Minted tokens |
| --- | --- | --- | --- |
| New credential in the system | none | one password per tenant | one signing key (all tenants) |
| Violates a hard constraint | no | no (if provisioning stays operator-only) | skirts #2 in spirit (our own mint-all key) |
| Least privilege enforced by | our code (funnel) + definer functions | **the database** | our code + definer functions |
| Runtime compromise | human's full rights for ≤ 1 h | that tenant's agent rights, until rotated | forge writes for existing runs, any tenant |
| Works with nobody signed in | **no** | yes | yes (that is the extra risk) |
| Agent can never promote claims | by code boundary only | **by the database** | by code boundary only |
| Changes to core RLS | none | yes (largest risk) | none |
| Attribution of a write | run + starting human (`created_by`) | run + agent principal | run + starting human |
| Build and run cost | lowest | highest | medium-high |
| Fits T006/T007 (user-initiated) | yes | over-built | over-built |
| Fits T010/T011 (scheduled) | no | yes | yes, with the weakest key story |

## Decision (accepted)

**A for v1. B is required before the first scheduled or background agent and before any external customer (its
design is a later ADR). C is rejected.** The position was tested honestly and survives with four corrections to
how it was first framed:

1. **A does not give database-enforced least privilege, and this ADR must not claim it does.** The agent
   funnel (definer functions) enforces provenance, scope, budgets and kill switches against a *steered* model
   and against mistakes. It does not stop *compromised runtime code*. The compensating controls are listed
   below (code boundary, static test, review). The revisit triggers are fixed now: (i) the first scheduled or
   background agent (T010, T011), (ii) the first third-party or plugin code running in the runtime process,
   (iii) any external customer (a second organisation's data in the same runtime). Per owner decision 4, (i) and (iii)
   are not merely "revisit": B must exist before either happens.
2. **The audit must change in the same ticket.** Today a delegated write would be audited as the human. The
   audit writer must record `actor_type = 'agent'` and the run id (see "Provenance and audit").
3. **Unaccepted agent claims must not feed scores or any downstream decision.** Otherwise an injected snippet
   steers the ICP score through a claim no human has looked at ("Consumption rule").
4. **Agents are off by default per tenant** (an Owner/Admin switches them on), and there is a platform-wide
   switch only the operator can flip (decision 2).

Why not B now: it is correct for background work, but for user-initiated research (T006, T007) it buys a
database wall at the price of a per-tenant credential lifecycle and a change to the heart of RLS, for a
runtime that is one process we write and review, run for one pilot tenant. Why B later: scheduled work has no
human token, and the "agent can never promote" property becomes valuable once more than our own code runs
tools. A is built so that B reuses it: `agent_runs`, `agent_run_id`, the write functions and the audit change
stay; B only changes **who calls them** (the agent principal instead of the starting human).

Why not C: it is A plus a bearer secret in our configuration; if it is used only with a human present it adds
nothing over A, and if it is used without one it is a standing mint-all key, which constraint 2 exists to
forbid.

## Design of A (what T006 builds)

### `agent_runs` (tenant-owned; written only by definer functions)

| Column | Notes |
| --- | --- |
| `id uuid` | client-supplied (idempotent start), unique with `tenant_id` |
| `tenant_id` | composite-FK target for everything below |
| `started_by uuid` | `auth.uid()` of the starter; a bare uuid like `created_by` (no FK, erasure-friendly) |
| `agent_name text`, `agent_version text` | slug and a version/prompt-set hash; `agent_name` must exist in `agent_definitions` (operator-managed, below) |
| `target_kind`, `company_id`, `lead_id` | the run's scope: exactly one target (CHECK `num_nonnulls = 1`), composite FKs |
| `status` | `running`, `succeeded`, `failed`, `cancelled`, `expired`, `killed`; transitions only forward, only by functions |
| `started_at`, `expires_at`, `finished_at` | `expires_at ≤ least(started_at + max_ttl, the starter's token exp)` (`auth.jwt() ->> 'exp'`); default 15 min, hard cap 30 |
| budgets and use | `max_writes/writes_used`, `max_tool_calls/tool_calls_used`, `max_input_tokens/_used`, `max_output_tokens/_used`, `max_cost_micros/_used`; every `max_*` is clamped to the agent definition's and the tenant policy's ceilings at start |
| `input_sha256 text` | hash of the normalised input (target ids + parameters) only; **no raw prompt, no document text, no PII** |
| `input_refs jsonb` | typed ids only (`{"company_id": "<uuid>"}`), size-capped, hygiene-checked |
| `error_code text` | from a closed enum (`budget`, `expired`, `killed`, `tool_failed`, `model_failed`, `invalid_output`); never model or exception text |
| `cancel_requested_at`, `cancelled_by` | the per-run kill switch |
| provenance | `created_by`, `created_via` (= `manual`: a human started it), `created_at` |

`agent_run_steps` (append-only trace and idempotency ledger): `id`, `tenant_id`, `run_id`, `step_key`, `kind`
(`tool_call`, `write`, `usage`), `tool_name`, `status`, `args_sha256`, `result_ref` (ids only), `tokens_in/out`,
`cost_micros`, `started_at`, `finished_at`; `unique (tenant_id, run_id, step_key)`. This is the "tool calls,
result, timestamp" record CLAUDE.md demands, without raw content.

`agent_definitions` (platform data, operator-managed, **no client grant at all**): `agent_name`,
`allowed_predicates text[]`, `allowed_stances`, ceilings for TTL/budgets. The predicate allow-list lives in the
database so a prompt cannot widen it and the runtime cannot be configured into writing arbitrary predicates.

`agent_limits` (platform data, operator-managed, **no client grant at all**, changeable by migration only; decision
3): `ttl_default_seconds` 900, `ttl_max_seconds` 1800, `max_concurrent_runs` 3, `max_runs_per_hour` 30,
`max_writes_per_day` 500. They are platform-wide values, not tenant settings; a per-tenant override would be a
later migration. Per-agent ceilings (budgets, predicates) live in `agent_definitions`.
`tenant_agent_settings` (one row per tenant, Owner/Admin write, audited): `enabled` (**default false**) and nothing
else. `platform_flags` (writable only by `postgres`/migrations): `agents_enabled`.

RLS: all tables enable + force; registered in `tests.tenant_table_registry` / `role_matrix`; clients get
**SELECT only** (runs: Owner/Admin see all of the tenant's, others their own; steps follow the run) and no
INSERT/UPDATE/DELETE grant. Nothing about a run can be changed except through the functions.

### The functions (all `SECURITY DEFINER`, `search_path = ''`, EXECUTE to `authenticated` only, one overload each)

- `start_agent_run(p_run_id, p_tenant_id, p_agent_name, p_agent_version, p_target_kind, p_target_id,
  p_input_sha256, p_input_refs, p_ttl_seconds, p_budgets...)`: auth required; caller must hold Owner/Admin/Sales
  in `p_tenant_id` (a Viewer cannot start; foreign and unknown tenants fail identically); platform and tenant
  switches on; the target must belong to the tenant (a foreign id fails like a missing one); concurrency and
  hourly caps; budgets clamped; idempotent on `p_run_id` (same payload = replay, different = conflict).
- `agent_write_evidence(p_run_id, p_step_key, ...evidence fields...)`: creates ONE evidence row linked to the
  run's target (company or lead), atomically (like `create_evidence_with_link`).
- `agent_write_claim(p_run_id, p_step_key, p_predicate, p_value, p_evidence_ids, p_stance)`: creates ONE claim
  about the run's target plus the links to evidence rows **created by this same run**. A claim without evidence
  cannot exist (this settles the checklist question "does confidence above `unverified` need a link": agent
  claims always have one and are always `unverified`).
- `cancel_agent_run(p_run_id)` (starter, Owner, Admin) and `finish_agent_run(p_run_id, p_status, p_error_code)`.
- `agent_record_usage(p_run_id, p_step_key, tokens_in, tokens_out, cost_micros)` for the budget ledger. The DB
  enforces the caps on what the runtime *reports*; real spend control must also sit at the model provider (a
  per-tenant spend limit on the provider key). The DB cannot verify a self-reported cost.

**Order of checks in every write function** (each failure raises `42501` with one generic message, so a foreign
run, an unknown run and another user's run are indistinguishable; no existence oracle):

1. `auth.uid()` present.
2. `select ... from agent_runs where id = p_run_id for update`: row locked, which also serialises the budget.
   The **tenant is taken from the row**; no function has a tenant parameter. Missing row, or
   `started_by <> auth.uid()` → refuse.
3. Platform switch, tenant switch.
4. `status = 'running'` and `expires_at > now()` (and not cancel-requested).
5. **Live role:** `app.has_tenant_role(run.tenant_id, owner|admin|sales)` for the caller now. A starter who has
   since been removed or demoted can no longer write.
6. Payload validation: predicate in the agent's allow-list, lengths, `app.text_is_clean`, stance allow-list,
   evidence ids belong to this run.
7. Idempotency: `unique (tenant_id, run_id, step_key)`; the write id is derived (uuid v5 of run id + step key),
   as `derive_link_id` does for evidence. Same key + same payload = return the existing row, **no budget used**;
   same key + different payload = conflict (dedicated SQLSTATE).
8. Budget: `writes_used < max_writes` incremented under the lock; per-tenant daily cap checked.
9. `set local app.created_via = 'agent'` and `app.agent_run_id = <run>`, insert, clear both.

### Provenance and audit

- **Server-forced, three layers.** (i) `app.set_created_meta` already forces `manual` for client roles. (ii) New
  column `agent_run_id` (composite FK to `agent_runs`) on `evidence`, `evidence_links`, `claims`, with
  `CHECK ((created_via = 'agent') = (agent_run_id is not null))`; no INSERT/UPDATE column grant, and the trigger
  sets it from the GUC for non-client roles and to NULL for client roles. (iii) The functions set the GUCs
  themselves from the run row, and no parameter named `created_via`, `created_by`, `confidence` or
  `agent_run_id` exists on any function (a test asserts the signatures).
- `created_by` stays `auth.uid()`: the **accountable human** who started the run. `created_via = 'agent'` plus
  `agent_run_id` says who actually produced the row. Both facts are always present.
- **Audit change (required).** `app.write_audit_event` must set `actor_type = 'agent'` and record the run when
  `app.agent_run_id` is set (new `audit_events.agent_run_id`), keeping `actor_user_id` = the starter ("on behalf
  of"). Without this every agent write would read "user" in the trail.

### Budgets, rate limits, kill switch

- **Per run:** writes, tool calls, tokens, cost, wall-clock (`expires_at`). **Per tenant (database):**
  concurrent runs, runs per hour, writes per day. **Per HTTP caller (API):** the generic rate limiter already on
  the checklist.
- **Kill switch, three levels, all enforced inside the write functions** (so the runtime cannot "forget" to
  check): (1) cancel one run (starter/Owner/Admin); (2) tenant switch `tenant_agent_settings.enabled` (Owner/
  Admin, audited, default off); (3) platform switch `platform_flags.agents_enabled` (operator only) plus an
  API environment flag that refuses to start runs. The runtime also checks status between steps; an in-flight
  model call may finish but its writes are refused.

### Promotion: what a human must do

Agent claims are born `unverified` and **inert**. Promotion is a new, append-only record, because claims are
immutable (ADR 0008):

`claim_reviews` (tenant-owned, append-only): `id`, `tenant_id`, `claim_id` (composite FK), `decision`
(`accepted`, `rejected`), `confidence` (`low`/`medium`/`high` for accepted; the human-assigned level),
`reason_code` (enum, required for `rejected`), `created_by`, `created_via` (**always `manual`**, forced),
`created_at`. The effective view `claims_effective` (security invoker) exposes the latest review, else the
claim's own state.

- **Who:** **Owner and Admin only**, checked live (decision 1); Sales and Viewer cannot. **One claim per call**: no
  bulk accept.
- **Rules:** `accepted` at `medium`/`high` needs at least one non-archived `supports` link; the reviewer sees the
  evidence (plain text) and the run it came from. The review records whether the reviewer is the run's starter
  (`self_review`). Self-promotion is allowed in v1 (decision 1); requiring a second reviewer once a tenant has more
  than 3 members is a checklist item, not built.
- **Audit:** every review is an audit event (`actor_type = 'user'`, entity `claim_review`, old/new effective
  confidence, claim id; no claim value, which is PII-classified).
- **Not reachable from the runtime by design** (see "Code boundary"). In A this is a code property, not a
  database property; B would make it a database property.
- **UI:** an unreviewed agent claim is shown as **"agent suggestion, unreviewed"** (CLAUDE.md state: Suggested), an
  accepted one as **Approved**, a rejected one as **Rejected** (the UI distinguishes Draft, Suggested, Approved,
  Sent, Failed, Completed).

### Consumption rule

Anything downstream that reads claims (the ICP score now; quotes and outreach drafts later) reads
`claims_effective` and **ignores claims with `created_via = 'agent'` unless their latest review is
`accepted`** (a rejected claim is also ignored). Imported and manual claims keep today's behaviour. The filter lives
in the ONE place both the review queue and the label snapshot build their scoring inputs
(`app/leads/review.py`, and the claims reads that feed it), so the queue and a label always agree (decision 5). T006
must change those inputs accordingly and test that a lead scored in the queue and at label time gives the identical
score with an unreviewed, an accepted and a rejected agent claim present.

### Containing prompt injection

Everything in evidence snippets, URLs, fetched pages, imported cells, e-mails and CRM free text is **data**.

1. **Data never becomes instructions.** One prompt-building module wraps every untrusted block in delimiters
   built from a per-run random token (escaped inside the content), states the policy in the system message,
   and never places untrusted text in the system or tool-definition role.
2. **Tool allow-list per agent definition**, typed schemas, no generic HTTP/SQL/shell tool, no tool that
   takes a tenant, run or table name from the model. The run id and tenant are bound by the runtime outside
   the model's reach, and re-derived by the database anyway.
3. **Write functions cannot be steered.** Tenant from the run row; target restricted to the run's own target;
   evidence ids restricted to this run; predicates from the database allow-list; another run or another user's
   run fails like a missing one.
4. **Structured, validated output only** (pydantic schemas, closed enums, length caps, `text_is_clean`); free
   model text is never executed, never used as a column name, a URL to fetch without the SSRF-safe fetcher
   (checklist), or a function argument that selects data.
5. **Blast radius is capped and visible:** budgets, rates, kill switch, and the fact that nothing a run writes
   affects a score, a decision or an outbound message until a human accepts it.
6. **No egress in v1:** no send, no price, no delete, no membership or consent change, no write to any table
   other than the three through the two write functions. A future agent function needs its own ADR addendum and,
   for external actions, the approval path of CLAUDE.md #3.
7. **An eval ships with the agent** (injection corpus in snippets, imported cells and fetched pages).

### Code boundary (the compensating control that makes A acceptable)

`app/agents/` reaches the database through ONE module (`app/agents/db.py`) that can call exactly the RPCs above
and read the run's target through approved read repositories. A static test (AST import scan, like the web
guard tests) fails if anything under `app/agents/` imports a write-capable repository, `httpx`/PostgREST
helpers, the claim-review code, the evidence/CRM write routes, or config secrets, or if a tool's signature has a
`tenant`/`run`/`table`/`token` parameter the model could fill. The user's token is held in the runtime object
only for the duration of the run, never logged, never passed to a tool.

## Threat table

| # | Attacker | Goal | Control | Test that proves it |
| --- | --- | --- | --- | --- |
| 1 | Author of external text (snippet, cell, page) | Make the agent write false facts | Untrusted-until-promoted; agent claims inert; allow-listed predicates; scope-bound writes | Injection eval corpus; pgTAP "predicate outside allow-list refused"; API test "unaccepted agent claim does not change the score" |
| 2 | Same | Make the agent write into another tenant | Tenant derived from the run row; no tenant parameter | pgTAP "no function has a tenant/created_via/confidence/agent_run_id parameter"; PostgREST "foreign target = missing target" |
| 3 | Same | Write under another run or another user's run | `started_by = auth.uid()`; run id bound outside the model | pgTAP "run of another user / tenant / unknown: identical refusal" |
| 4 | Viewer or outsider | Start or write a run | Role check in `start_agent_run`; live role in writes | pgTAP role matrix; PostgREST per role |
| 5 | Signed-in human | Insert rows labelled `agent` directly | Trigger forces `manual`; no column grant on `agent_run_id`; CHECK ties origin to run | pgTAP and PostgREST attack on `claims`/`evidence`/`evidence_links` |
| 6 | Human holding a token | Repudiate ("the agent did it") | `created_by` = starter, run row, audit | pgTAP "agent row carries created_by = starter and the run" |
| 7 | Compromised or buggy runtime | Write `manual` rows or promote claims as the human | **Not prevented by the database in A.** Code boundary, static test, review; revisit triggers | `tests/test_agents_boundary.py`; residual risk accepted for v1 |
| 8 | Runaway loop | Spend, volume | Run and tenant budgets, concurrency, hourly/daily caps, kill switch, provider-side spend limit | pgTAP budget/limit tests; concurrent-budget race over HTTP |
| 9 | Retry storm | Duplicate rows, double budget | Step key + derived id + unique constraint | pgTAP "replay: one row, one unit of budget"; "same key, other payload: conflict" |
| 10 | Stale token or run | Keep writing after expiry | `expires_at ≤ token exp`; status check | pgTAP "expired run refused" (time-shifted) |
| 11 | Removed or demoted starter | Continue a run | Live role check per write | pgTAP "role removed mid-run: next write refused" |
| 12 | Agent (steered) | Promote its own claims | Promotion has no agent path; reviews forced `manual`; one claim per call | Static boundary test; API test "review route rejects a run-scoped call"; pgTAP "review created_via = manual" |
| 13 | Hostile payload | Zero-width, oversize, control chars | `app.text_is_clean`, length caps | pgTAP hygiene cases through both write functions |
| 14 | Hostile payload | SQL/identifier injection | No dynamic SQL; typed parameters | pgTAP source audit (as N15 of `28_import_lead_rows`) |
| 15 | Bug in a definer function | Cross-tenant read or write (BYPASSRLS) | Tenant from the run; composite FKs; catalog guards | pgTAP source audit (tenant filter on every statement); `06_catalog_guards` |
| 16 | Operator error | Switch off ineffective | Every function checks both switches | pgTAP "platform off, tenant off, run cancelled: every function refuses" |
| 17 | Leaked access token | Act as the user | Bounded by token life; live membership; unchanged exposure | Existing JWT/membership tests |
| 18 | Anyone | Agent writes missing from the trail | Audit actor `agent` + run id from the GUC | pgTAP "agent write audited as agent with run id; manual still `user`" |
| 19 | Injected prompt | Exfiltrate data via a fetch URL or tool argument | No contact PII given to the model in v1; SSRF-safe fetcher with allow-listed schemes/hosts policy; no secrets in prompts | SSRF hostile-URL suite; prompt-content test (no contact fields); eval |
| 20 | Anyone | Run agents on a tenant that never opted in | `tenant_agent_settings.enabled` default false | pgTAP "fresh tenant: `start_agent_run` refused" |
| 21 | Tenant Owner/Admin or any member | Raise own limits, widen the predicate allow-list, flip the platform switch | `agent_limits`, `agent_definitions`, `platform_flags` have no client grant; migration-only | pgTAP and PostgREST "no application role can write them" |
| 22 | Sales user | Promote an agent claim | Review function requires Owner/Admin, live | pgTAP "Sales refused"; PostgREST per role |

## Tests T006 must ship

**pgTAP** (new files, registered in the table registry and role matrix, catalog guards extended):

- `30_agent_runs_schema`: RLS enabled and forced on `agent_runs`, `agent_run_steps`, `claim_reviews`,
  `tenant_agent_settings`; no client INSERT/UPDATE/DELETE grant; `agent_definitions`, `agent_limits` and
  `platform_flags` have **no client grant at all, and every application role (owner, admin, sales, viewer,
  anon, authenticated) is shown unable to INSERT, UPDATE or DELETE them** (decisions 3 and 9); no raw-content columns (column-name scan: `prompt`, `content`, `text`, `payload`,
  `output`, `response`); CHECKs (one target, budgets non-negative, `expires_at` bound); read matrix (Owner/Admin
  all, others own); anon and foreign tenant read nothing; composite FKs refuse a foreign target.
- `31_start_agent_run`: Viewer, outsider, anon, foreign tenant, unknown tenant (identical refusal); foreign
  target = missing target; tenant off / platform off; concurrency cap; hourly cap; budget clamp (ask for 10^9);
  `expires_at` never beyond the token's `exp`; idempotent replay and conflict; definer properties (security
  definer, empty `search_path`, one overload, EXECUTE to `authenticated` only).
- `32_agent_write_functions`: **each of** `agent_write_evidence`, `agent_write_claim`: unknown run, another
  tenant's run, another user's run (identical refusal); each non-running status; expired; budget exhausted
  (no row written); role removed mid-run; role demoted to Viewer mid-run; tenant derived from the run
  (signature has no tenant parameter); target outside the run's scope; evidence id from another run; predicate
  outside the allow-list; hygiene (zero-width, bidi, tag characters, oversize); `created_via = 'agent'` even
  with `app.created_via` pre-set to `manual`/`import`/empty; `created_by` = starter; claim confidence
  `unverified`; `agent_run_id` set; **signature scan: no `created_via`, `created_by`, `confidence`,
  `agent_run_id`, `tenant` parameter**; idempotent replay (one row, one unit of budget); same key other payload
  conflicts; step keys are per run; source audit (inserts only into the allowed tables, no UPDATE/DELETE of
  business data, no dynamic SQL, tenant filter on every statement).
- `33_agent_provenance_audit`: CHECK `(created_via = 'agent') = (agent_run_id is not null)`; a client cannot
  produce either (trigger forces `manual`/NULL); audit shows `actor_type = 'agent'`, run id and `actor_user_id`
  = starter for agent writes and `user` for manual writes; no snippet/claim text in audit.
- `34_claim_reviews`: **Sales and Viewer refused (only Owner/Admin may review)**; foreign/unknown claim refused
  identically; `created_via` forced `manual`; accepted
  `medium`/`high` needs a supporting link; rejected needs a reason code; append-only (UPDATE/DELETE refused for
  every role); effective view; audit event without claim text; a review cannot be written with a run context.
- `35_agent_switches_and_limits`: platform off, tenant off, run cancelled, run killed: every function refuses;
  fresh tenant (default off) refuses; daily write cap; concurrent-run cap; cancel by starter/Owner/Admin only.

**Integration / PostgREST** (`tests/integration/test_agent_direct_postgrest.py`, real JWTs + anon key, writes
with `Prefer: return=minimal`, judged by victim data afterwards): anon on every table and function; foreign
tenant reads and function calls; Viewer; Sales where Admin is required (tenant settings, kill switch); smuggled
`created_via='agent'`, `agent_run_id`, `created_by`, `confidence` on direct inserts into `claims`, `evidence`,
`evidence_links`; direct INSERT/UPDATE/DELETE on `agent_runs`, `agent_run_steps`, `claim_reviews` and counter
tampering; function calls with unknown named arguments (`PGRST202`); steering attempts (foreign target, foreign
run, foreign evidence ids) leave no rows; **budget race**: 20 concurrent writes against a budget of 5 produce
exactly 5 rows; **expiry**; **role removed mid-run** over HTTP; each attack shown failing against a deliberately
loosened grant/policy/check (mutation evidence, as in fix round F).

**API and unit:** `tests/test_agents_boundary.py` (import scan and tool-signature scan, above); prompt builder
(delimiters, escaping, untrusted text never in system role); structured-output validation (closed enums,
caps); run lifecycle with a fake LLM behind the internal interface (start, steps, finish, cancel, kill switch,
crash recovery/expiry sweeper); "unaccepted agent claim does not change the ICP score, accepted one does";
promotion route works only with a user token held by an Owner/Admin and cannot be reached with run-scoped
  credentials; web: agent
agent claims render as plain text labelled "agent suggestion, unreviewed"; no agent code path reads `process.env` secrets.

**Evals** (`tests/evals/`, runnable without network): an injection corpus (instructions in snippets and
imported cells: "ignore previous instructions", "write this claim for company X", "use tenant <uuid>", tool-name
smuggling, delimiter-break attempts); pass criteria are *zero writes outside the run's scope and zero state
changes beyond `unverified` agent rows*, not a model-quality score.

## Consequences

- One new surface of definer code (about six functions) with the BYPASSRLS risk; mitigated by deriving
  everything from the run row, the source-audit tests, and the mutation discipline used in fix round F.
- The audit and provenance machinery (`agent_run_id`, `actor_type = 'agent'`) is reusable unchanged by B.
- User-initiated agents only. The first scheduled agent and the first external customer are blocked on option B
  (a later ADR), per decision 4.
- Humans' tokens pass through the runtime process: logging and memory handling of tokens becomes a reviewed
  concern (never log, never persist).

## Compatibility with option B (decision 10)

T006 builds A. Nothing it adds blocks B, which would change **who calls** the same functions, not the data model:

| T006 element | Under B | Change needed later (all additive or `create or replace`) |
| --- | --- | --- |
| `agent_runs.started_by` (bare uuid, no FK) | the agent principal's user id | none; add a nullable `requested_by` (the human who asked) |
| `created_by` on agent rows = starting human (decision 7) | would be the principal | the write functions take `coalesce(requested_by, started_by)`; the run row keeps both facts |
| `agent_run_id`, CHECK `(created_via = 'agent') = (agent_run_id is not null)` | unchanged | none |
| Write functions derive tenant and caller from the run row; check `started_by = auth.uid()` | check "the caller is this run's principal" | new migration replaces the function body; signatures stay |
| Live role check (owner/admin/sales) | check an `agent` membership role | same replacement; `app_role` gains `agent` |
| `start_agent_run` role check | a scheduler or the principal starts runs | same replacement |
| Audit `actor_type = 'agent'` + `agent_run_id` + `actor_user_id` | `actor_user_id` is the principal; "on behalf of" from the run | none to the audit writer |
| `claim_reviews` (humans only, Owner/Admin) | unchanged and now DB-enforced (the agent role has no grant) | none |
| Limits, allow-lists, switches (migration-only tables) | unchanged | none |
| `tenant_agent_settings.enabled` | unchanged | none |
| RLS (`my_tenant_ids()` includes every membership role) | the agent role must be excluded | **the one real change**: a separate ADR and a test matrix; T006 must not add anything that assumes agent users do not exist |

T006 therefore must: keep every function's tenant derivation inside the run row, never read `auth.uid()` as "is a
human" outside the two documented places, and keep the runtime's database access in one module so the credential
can change in one place.

## Out of scope

The runtime itself, the LLM interface, prompts, the fetcher (SSRF suite), any outbound action, scheduling,
the dedicated principal (B; required later, see decision 4), approvals for external communication (CLAUDE.md #3),
the erasure procedure's reach into `agent_runs` / `claim_reviews` (checklist), `pgsodium` / option C (decision 12).

## M1 implementation notes (T006 milestone 1, database)

What was built (migrations `20261009090000_t006_agent_foundation.sql`, `20261009090100_t006_agent_functions.sql`,
`20261009090200_t006_agent_audit_and_scoring.sql`) follows this ADR. Where it deviates or decides a detail the ADR left open:

1. **The tenant switch is written by a function**, `set_tenant_agents_enabled(tenant, bool)` (Owner / Admin, audited), not by direct
   RLS writes: `tenant_agent_settings` has no client write grant, like every other agent table.
2. **The selftest tenant allow-list is a column** (`agent_definitions.allowed_tenants uuid[]`, `'{}'` = nobody, NULL = any), not a
   table, so that operator data never carries a `tenant_id` that the tenant-table guards would have to police. The migration seeds
   `'{}'`.
3. **`agent_run_steps.started_by`** is copied from the run so that "a user reads the steps of their own runs" is a plain column test
   in the policy (no per-row sub-select).
4. **Provenance is decided by role AND origin**: the `agent_run_id` trigger gives a client role NULL whatever the setting says, reads
   the setting for other roles only when the origin is `agent`, and a composite foreign key plus a CHECK tie origin `agent` to a
   run of the same tenant. A pgTAP test sets both settings as Sales / Owner / anon and shows the row comes out manual with no run.
5. **Reviews apply to AGENT claims only** (a manual or imported claim is refused, 23514), need a live supporting link for
   medium / high, and record `self_review`. `claim_reviews.created_at` defaults to `clock_timestamp()` so the newest review of a
   claim is unambiguous even inside one transaction.
6. **Expiry is lazy** (decision 5 of the plan): `expires_at` is the earlier of the TTL and the starter's token `exp`
   (`auth.jwt()`), every write checks it, and `finish_agent_run(... 'expired')` records it once true. No sweeper, hence no
   privileged principal.
7. **Error contract.** Before ownership of the run is proven (unknown run, someone else's, a foreign tenant, a removed or demoted
   starter, a Viewer) every function answers the same `42501` "agent action not permitted" (identical sqlstate, message, detail,
   hint, constraint, table: a pgTAP test compares the whole string). After it: `SM201` not running, `SM202` expired, `SM203`
   budget, `SM204` disabled, `SM205` step key reused with other arguments, `SM206` limit (later: `SM207` daily cost cap; T008 adds
   `SM208` to `SM211`, listed in ADR 0018: confirmed requirement exists, not a draft, not confirmable, discard the draft to re-run); `23505` for a used id is raised with a
   constant message so a foreign id looks exactly like a payload conflict. Content problems (hygiene, size, URL) are the tables'
   own CHECKs (`23514`); PostgreSQL puts the failing row in that error's DETAIL, so **the API (M2) must classify by SQLSTATE and
   never forward a database message**, as it already does.
8. **Audit.** Evidence, links and claims an agent writes are `actor_type = 'agent'`, name the run, and keep the starting human as
   `actor_user_id`. Bookkeeping the functions do (run counters, the step ledger) is audited as that human. Documented limit: a
   caller that could set the run setting itself (PostgREST cannot; plain SQL could) could label its OWN audit row with its OWN
   running run; the writer ignores any run that is not of the same tenant and started by the same actor.
9. **Operator access.** `app.operator_enable_selftest(slug)` (no application role can execute it) is what the local dev script
   `scripts/dev-enable-selftest.sh` calls, through `docker exec` into the local database container, for the DEMO workspace only
   (`make seed-demo` runs it last). The integration tests use the same route (`tests/integration/operator_sql.py`) to turn the
   switches on for their own tenants and restore the previous state exactly. Neither path uses a key of any kind.
10. **What scoring reads** is the `claims_for_scoring` view for both the review queue and the label snapshot (one constant,
    `CLAIMS_FOR_SCORING`, in `app/crm/repository.py`; a unit test asserts both requests are identical).

### M1 review fixes (migration `20261009090300_t006_review_fixes.sql`)

The owner's review of the first two migrations led to one more migration (the applied ones are untouched):

1. **Allowed evidence kinds.** `agent_definitions.allowed_evidence_kinds` (`evidence_kind[]`, not null, no default); selftest is
   `{note}`. `agent_write_evidence` refuses any other kind with the fixed `23514` "value not allowed".
2. **One trusted-role predicate.** `app.set_created_meta` and `app.set_agent_run_id` both decide on the allow-list
   `current_user = 'postgres'` (the owner of the definer functions) instead of deny-listing `authenticated` / `anon`. Any other role
   (service_role, a BYPASSRLS role, a future role) gets origin `manual` and no run id whatever the settings say. A pgTAP test
   reads both function bodies and requires the identical predicate.
3. **Reserved step names.** `agent_record_step` refuses `usage` and every name starting `agent_write` (any letter case): a
   pre-registered step key could otherwise make a later real write "replay" a forged result and write nothing.
4. **Oversized usage is a budget refusal.** `agent_record_usage` takes `bigint` parameters and compares in `numeric`, so a huge
   value is `SM203`, never `22003`. (A JSON number beyond bigint never reaches the function; the API maps any unexpected SQLSTATE
   to one fixed error.)
5. **`review_claim` locks the claim row** (after the role check, before the replay lookup), so concurrent reviews of one claim
   serialise: the review that acts last is the effective one, and an overlapping retry is a replay, not "review id already used".

## M2 implementation notes (T006 milestone 2, runtime and API)

Code: `services/ai-api/app/agents/` (the sandbox), `services/ai-api/app/agent_runs/` (the HTTP side). Where it decides a detail
the ADR left open:

1. **Orchestration is an explicit, app-owned loop** (`app/agents/runtime.py`), no agent framework: one run is at most four turns;
   each turn re-reads the run (status, cancel flag, expiry) before the model call, records usage, then handles what the model
   asked for. The model can only ASK: a tool call is looked up by exact name in the agent's own allowlist, its arguments are parsed
   with a closed schema (`extra=forbid`), and what happens is a call to one of the definer functions, which re-check everything.
   An unknown tool or invalid arguments is recorded as a `refused_call` step (a fixed name, never the model's text). Extra calls
   beyond five per turn are ignored.
2. **The runtime is a sandbox**, enforced by reading its source (`tests/test_agents_boundary.py`): `app/agents` imports nothing
   from the application except itself (no auth, tenancy, repository, review or configuration code), `httpx` appears only in `db.py`
   and the model adapter, the user's token is a word only `db.py` may use, and there is no environment access, process, socket or
   dynamic code.
3. **What a model may see is a constant allowlist** (`app/agents/inputs.py`): company name, city, region and website HOST. No
   contact field, no note, no raw cell, no tag, no evidence snippet. The input is hashed into `agent_runs.input_sha256` at start;
   the runtime recomputes it from its own read and fails the run (`tool_failed`) if the company changed in between.
4. **Untrusted data is delimited, never in the system role** (`app/agents/prompts.py`): one UNTRUSTED block between a per-run
   random delimiter that the content cannot contain, values flattened to one line with control characters removed. Only fixed
   phrases (`app/agents/notes.py`) flow back to the model as trusted text: never a database message, a model reply or an
   exception.
5. **Step keys are deterministic** (`usage-N`, `tN-cI`), so a restarted runner replays instead of repeating (proved on the real
   stack: crash after turn 2, a second runner resumes, no second note, usage not charged twice).
6. **Execution is an in-process bounded pool** (`app/agent_runs/executor.py`): workers plus a small queue, `ExecutorBusy` when full
   (the start answers 503 `agents_busy` and creates nothing). The task holds the starter's token (not in `repr`, never logged, not
   passed to a tool). A restart loses the runs in flight; they read as `expired` lazily. No sweeper, so no privileged principal.
7. **Fail-closed configuration.** `AGENTS_ENABLED` defaults to false (the platform and tenant switches live in the database
   regardless). `LLM_PROVIDER=fake` (a scripted model, development only) is refused outside development at startup; an unknown
   provider is refused. When agents cannot run, everything that only reads the database still works and a start answers 503
   `agents_unavailable`.
8. **API errors are fixed.** The agent repository classifies by SQLSTATE alone; any SQLSTATE nobody planned for (22003, XX000, a
   new one) becomes ONE fixed upstream error, and no database text reaches a response, a log line or an exception. A generic
   `42501` on a review is a 404 (no existence oracle). New fixed codes: `agents_disabled` 409, `run_limit_reached` 429,
   `token_expiring` 409, `run_not_running` 409, `agents_unavailable` 503, `agents_busy` 503.
9. **Endpoints** (`/v1/tenants/{id}/...`): `POST agent-runs` (Sales+, client id, 202; replay 200; conflict 409), `GET agent-runs`,
   `GET agent-runs/{id}`, `POST agent-runs/{id}/cancel`, `GET/PUT agent-settings` (read: any member; write: Owner/Admin),
   `GET companies|leads/{id}/claims` (the effective view: `unreviewed`, `accepted`, `rejected`), `POST claims/{id}/reviews`
   (Owner/Admin, idempotent on the client id). There is no endpoint for the platform switch and none that takes a tenant, an
   origin or a confidence from a body.
10. **Every database read added in M2 has a real-stack test** (`tests/integration/test_agent_runs_api.py`): the run row, the
    target's four columns (company and lead), the settings row, the `claims_effective` view. Mutation checks confirm that a column
    the table or view does not have passes the mocked tests and fails the real-stack ones.

11. **The one real model adapter** (`app/agents/llm/anthropic.py`, its own commit): the Anthropic Messages API over `httpx`
    (already a dependency: no new package, no vendor SDK type outside this file). It is OFF unless `LLM_PROVIDER=anthropic` AND the
    model id (`LLM_MODEL`, no default), the key (`ANTHROPIC_API_KEY`, environment only), both prices
    (`LLM_INPUT_MICROS_PER_MTOK`, `LLM_OUTPUT_MICROS_PER_MTOK`, from the provider's price list) and the owner's confirmation that a
    hard spend cap exists at the provider (`LLM_SPEND_CAP_CONFIRMED=true`) are set; otherwise a start answers 503
    `agents_unavailable`. It puts our constant policy text in `system`, everything else in the user turn with the untrusted block
    last, offers the agent's tools plus a `final_result` tool for the structured result, makes one request per call (no retries),
    maps 429 / 5xx / timeout / other 4xx / malformed bodies to constant codes, and never puts the key, the URL, the request or the
    response body into an exception or a log line. Every test uses `httpx.MockTransport`; **it has not been run against the real
    provider** (no key was supplied). The first live run is the owner's opt-in step.

## M3 implementation notes and deviations from the approved plan (T006 milestone 3)

The review-fix migration `20261009090400_t006_review_fixes_2.sql` and the M3 commits deviate from, or decide details of, the plan
as follows. Each deviation is deliberate.

1. **Evidence was a second route into a score.** The plan covered claims (`claims_for_scoring`) but not the evidence-quality factor.
   `public.evidence_for_scoring` now counts agent-origin evidence only when a claim whose newest review is `accepted` cites it with
   stance `supports`; the review queue and the label snapshot read it through ONE reader (`LeadsRepository`), like claims.
2. **`review_claim` locks the claim row `FOR NO KEY UPDATE`**, not `FOR UPDATE`: concurrent reviews still serialise, but a link that
   merely references the claim is not blocked.
3. **The eval harness is not in `app/agents/evals/`.** It needs the real stack and the operator route, which the sandbox package may
   not import; it is `tests/integration/agent_eval.py` (+ `test_agent_evals.py`), with cases in `tests/evals/cases/*.jsonl`,
   `tests/evals/thresholds.json` and `tests/evals/baseline.json`. `make eval` is part of `make check`; `make test-integration`
   ignores that one file so it does not run twice. It has two layers: the runtime (a scripted model that obeys every injection) and
   the **worst case** (the model's calls forwarded verbatim to the nine database functions). The hard gate is measured from the
   database (foreign tenant byte-identical, nothing outside the agent tables changed, only unverified rows of this run added,
   what a score reads unchanged). `make eval-live` is opt-in, never part of `make check`, and refuses unless the adapter's own
   gates are satisfied. It was not run.
4. **Documented limits of option A, not covered by the gate.** A runtime that holds the starter's token can (a) write into ANOTHER
   run of the SAME user (refused for another user's run: case N02), and (b) do anything the user can through PostgREST directly
   (a person-origin row). The sandbox prevents both in code; only option B (a dedicated agent principal) removes them in the
   database. This is why option B is required before the first scheduled agent and before any external customer.
5. **Claims written for a LEAD target carry `lead_id` only**, while the score readers read claims by `company_id`: an accepted
   agent claim about a lead cannot reach that lead's score today (evidence can). Recorded in the checklist for T007.
6. **Web.** The start form targets a company (the list API gives names; leads have none). Accept and reject are two forms with two
   review ids generated by the page per render. Only agent claims are listed under "Agent suggestions". The agents page shows
   run states as Running / Completed / Failed / Cancelled; nothing an agent did is "Approved" or "Sent".
7. **`make seed-demo`** now ends with two LOCAL-only steps (the operator switches for the DEMO workspace, then one selftest run);
   `verify()` ignores agent-written evidence so the seed stays idempotent. The API must be started with `AGENTS_ENABLED=true`.
8. **Runbook:** `docs/runbooks/agents-kill-switch.md` (the SQL is smoke-tested against the local stack).

## Resolved questions (the open questions of the proposal)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Who starts / promotes; self-promotion | Start: Owner/Admin/Sales. Promote: Owner/Admin. Self-promotion allowed in v1; second reviewer when a tenant has more than 3 members is a checklist item |
| 2 | Default-off per tenant + platform switch | Yes |
| 3 | TTL and budgets | As proposed; operator-managed table, migration-only |
| 4 | Accept A's residual risk in v1 | Yes; B required before the first scheduled/background agent and before any external customer |
| 5 | Scoring ignores unaccepted agent claims | Yes; UI: "agent suggestion, unreviewed"; queue and snapshot share the filtered inputs |
| 6 | Promotion model | Append-only `claim_reviews`, accepted/rejected + human low/medium/high, one claim per call |
| 7 | `created_by` on agent rows | The starting human, plus `created_via = 'agent'` and `agent_run_id`; fix audit `actor_type` in T006 |
| 8 | Cost control | Owner sets a hard spend cap at the model provider before the first real model call |
| 9 | Allow-lists in the database | Yes, operator-managed, migration-only |
| 10 | ADR 0014 before T006 | No; see "Compatibility with option B" |
| 11 | Personal data to the provider | v1 passes no contact fields; legal review (DPDP, cross-border transfer) before T012 |
| 12 | `pgsodium` | Out of scope |

## T007 M2 note: the claim home (2026-10-05)

`agent_write_claim` stores the claim of a lead-target run on the **lead's company** (resolved inside the database from the run row, after
the same ownership proof as before); the lead is recorded as `claims.source_lead_id`. A lead without a company cannot receive a claim. Old
rows are not rewritten: `claims_effective` gains `home_company_id` and `about_lead_id`, and `claims_for_scoring` exposes the home as
`company_id`. Evidence of a lead run is still linked to the lead, so `evidence_for_scoring` is unchanged. Migration
`20261013090000_t007_claim_home.sql`; tests `supabase/tests/database/48_claim_home.test.sql`, `tests/integration/test_claim_home.py`.

## T007 M2 note: the daily cost cap (2026-10-05)

A tenant's agents may spend at most **2.00 per UTC day** (operator default `agent_limits.daily_cost_micros = 2,000,000`, in millionths of the
billing currency). The tenant's **Owner** (not Admin, second factor required, ADR 0016) can set its own value with
`set_tenant_daily_cost_cap` to anything from 0 to **20.00**; both the default and the override carry that ceiling as a CHECK, and the change is
audited by the `tenant_agent_settings` audit trigger (who, old value, new value). Migration `20261014090000_t007_daily_cost_cap.sql`; tests
`supabase/tests/database/49_daily_cost_cap.test.sql`, `tests/integration/test_daily_cost_cap.py` and three tests in
`tests/integration/test_agent_runs_api.py`.

**Where it is enforced (before the money is spent, not after).**
1. `start_agent_run` refuses (SM207) when today's spend already fills the cap (`spent >= cap`; a zero or missing cap fills it). A cheap early refusal.
2. `agent_reserve_cost`, called by the runtime **before every model call**, takes the tenant's advisory lock, computes the call's worst case
   `R = ceil((max_input × input price + max_output × output price) / 1,000,000)` (rounded **up**; prices from the operator table
   `agent_model_prices`, keyed by the model id the client reports), and grants only if `spent_today + R <= cap`. A grant stores a reservation
   (`agent_cost_reservations`); a refusal is **returned** as `{granted: false, reason: daily_cap | no_price}` (a raise would roll back the audit
   event, so the cap hit's `agent_cost.refused` audit row would be lost) and the API port turns it into the SM207 exception, which ends the run as
   `failed / budget` before any model call was made.
3. `agent_record_usage` **settles** the reservation: the call's real tokens at the reserved price snapshot, rounded up, or the runtime's reported
   cost if that is larger. The unused part of the reservation is released at once.
4. There is **no unreserved path** (migration `20261014090100_t007_cost_cap_hardening.sql`): a usage record for a step key nobody reserved is refused
   (23503), so nothing reaches the day's ledger that was not reserved first, and settling takes the same per-tenant lock as reserving. The run's own
   token and cost budgets still count what the runtime *reported*.
5. **Bounds against a lock-out by a member who calls the functions directly.** A reported cost may be at most **twice the reserved worst case**
   (23514 otherwise; the reservation stays open and keeps counting); what is charged to the day may not exceed the run's own cost budget (SM203);
   and a reservation must fit what is left of the run's token budgets, counting the run's other open reservations (SM203, before any model call), so
   one call on one run cannot reserve a day's cap. A member can still start runs and use their budgets, which is what a member is for; one run can
   reserve at most the cost of its own token budgets (selftest: 20,000 in + 4,000 out).

**Fail closed.** No price row for the model, a zero price (the table CHECK forbids it and the function refuses it too), a zero cap, a missing
operator default: each is a refusal, never "free". No real model has a price until the operator adds it (the migration seeds only the scripted
development model `fake-selftest`, one micro per token, so local runs and the evals work).

**Which UTC day a cost belongs to.** The day the call was **authorised** (the reservation), from `app.agent_utc_today()`. Settling never moves it:
a call reserved at 23:59:58 and settled at 00:00:03 stays on the earlier day; a run started on day D that calls the model on D+1 is charged to
D+1. The daily sum is an index range scan on `(tenant_id, cost_day)`. The clock helper is a function that tests replace inside their rolled-back
transaction; there is no override hook in production code, and no client role can execute it (nor any other helper).

**The input bound.** The runtime declares `max_input_tokens` as the UTF-8 byte length of everything it sends (blocks, tool definitions) plus 2,048
for the provider's own framing. A token is at least one byte, so this bounds the tokens of the text. `max_output_tokens` is the request's `max_tokens`,
which the provider enforces. Whether 2,048 covers a real provider's framing is **unverified** until `make eval-live` has run (checklist row).

**A resumed run replays its earlier turns, and those model calls are not charged again.** The runtime's resume contract (a second runner on an
interrupted run replays steps instead of duplicating them) re-calls the model for turns whose usage is already recorded; their reservations and
usage records replay without a new charge, so a resume can spend up to the earlier turns' cost once more, unrecorded. v1 has no automatic resume (a
restart drops runs; only the tests resume one), so this is a known gap, not a path users reach; closing it is a checklist row.

**A failed model call: see "Open reservations" below.** (It is no longer "never refunded": a failure that proves the provider never billed the call is released at zero; every other one stays open at its worst case.)

**Maximum overshoot of the cap.** The reservation is a true upper bound whenever each call's usage stays inside the bounds it declared, so the
overshoot is then **0**. The database cannot see what a provider bills, so if a call is reported **beyond** its bounds the ledger records the true
cost (settled > reserved), writes an `agent_cost.overshoot` audit event, and the next reservation refuses. The largest the ledger can then exceed the
cap is **`max_concurrent_runs × the agent's per-run max_cost_micros`**: only calls in flight when the last reservation was granted can settle above
their reservation; a recorded call can never exceed its run's cost budget (SM203); and at most `max_concurrent_runs` runs are in flight at once.
**The bound is per agent definition** (`max_concurrent_runs × that agent's max_cost_micros`), and the two agents differ:

| Agent | per-run cap | × 3 concurrent runs | ledger at most, with the default 2.00 cap | where it can run |
| --- | --- | --- | --- | --- |
| `research` | 0.15 (150,000) | **0.45** | **2.45** | production |
| `selftest` | 0.25 (250,000) | **0.75** | **2.75** | development only (its flag `selftest_enabled` is off and it is allowed for no tenant by default; never enabled in production) |

*The maximum, stated once:* in production (research only) a workspace's ledger can read at most **cap + 0.45** after an overshoot (2.45 with the default
cap). In development with selftest enabled it is cap + 0.75 (2.75). If both agents were ever enabled for one workspace the bound is
`3 × max(0.15, 0.25) = 0.75`, because the 3 concurrent runs are shared across agents.
*Where the 3 comes from:* `agent_limits.max_concurrent_runs` (operator-managed, migration-only, default 3), enforced in `start_agent_run` under the
tenant's start lock by counting the tenant's runs that are `running`, unexpired and not cancelled. A cancelled or expired run cannot settle
(SM201 / SM202), so its in-flight call adds nothing to the ledger (the reservation stays counted). Changing that limit or an agent's
`max_cost_micros` changes the figure. A bill above it is not visible to the database; the provider-side hard cap (checklist) is the backstop.

**Open reservations (one rule).** A reservation that is never settled stays **open at its worst case until its UTC day ends**; the day is fixed when the
reservation is made, so it simply stops counting at midnight UTC. This is the single rule for every way a call can end without a settlement: its run was
cancelled, expired, killed or finished with the reservation open, the process crashed mid-call, or the call completed but could not be recorded because the run
went terminal while it was in flight (a terminal run settles nothing). *Why:* nobody can tell afterwards whether the provider billed the call, so the worst
case is the only number that never undercounts; the cost of being wrong is bounded (one call's worst case per interrupted run) and it expires on its own.
The alternative (settle at zero once the run is terminal) would undercount exactly when something went wrong.
The runtime settles what it **knows**:

| Outcome of the model call | What the runtime does | Why |
| --- | --- | --- |
| it answered (usage known) | `agent_record_usage`: settled at the charge (real tokens at the reserved price, or the reported cost if larger) | known |
| `rate_limited` (HTTP 429) | `agent_release_cost`: settled at **zero** | the provider refused before processing |
| `rejected` (any other 4xx: bad key, bad request) | released at zero | the request itself was refused |
| `not_configured` | released at zero | nothing was sent |
| `unavailable` (a transport error or a 5xx) | **stays open** | the request may have been processed |
| `timeout` | **stays open** | the provider may have finished after we stopped waiting |
| `bad_response` | **stays open** | the call completed and was billed, but its usage could not be read |
| the run was cancelled or expired while the call was in flight | **stays open** | a terminal run settles nothing |

`agent_cost_summary` / `GET /agent-cost` (Owner and Admin) show today's settled and open amounts and each open reservation with its run's status; the agents
page has the panel; `agent_cost_reservations.outcome` is `used` or `not_billed`. A run that is still running when its call fails can be released; a terminal one cannot.
The run's own `cost_micros_used` and its usage step count the **charge**, not the reported cost (a runtime that reports 0 for real tokens still spends the run's
cost budget).

**Evidence URLs.** `agent_write_evidence` refuses, with the clean `value` error and before the host rule, a URL that is not `http://` or `https://` (any case;
`website_host` strips any scheme, so `ftp://host/x` would otherwise pass), a port other than 80 or 443, and any `@`, backslash, whitespace or control character
(`https://user@host:443/` passes the scheme, port and host rules). `evidence_url_check` stays as the second layer. The host rule is the company's website host or its
`www.` twin and nothing else (no other subdomain, no parent domain); the runtime applies the same rule (`runtime.allowed_hosts_for`) and the same table of cases is
tested on both sides. A percent-encoded `%40` is data, not userinfo.

**What the caps do NOT do: they guard against bugs and honest mistakes, not against a malicious member.** Every number the database uses is reported by the
caller: the tokens, the cost, the "declared bounds" of a reservation, and even "this call never reached the provider". Under option A the caller holds the
starting human's token, so a member who wants to can lie. The race that proves it (`tests/integration/test_agent_runs_api.py`,
`test_a_member_who_releases_a_reservation_while_the_provider_call_is_in_flight_...`): the runtime reserves and then calls the provider; the member calls
`agent_release_cost` on that reservation **during** the call (the database cannot know the call started, so it believes them) and the reservation is settled at zero;
the provider answers and bills; the runtime's later `agent_record_usage` finds a settled reservation and is **refused (23503)**, so the run ends
`failed / tool_failed`. The call's cost is then on **no ledger**: the day, the run and its steps show zero for it. The only trace is the audit event
`agent_cost.released` (with who released it). The member can repeat this for every call of their own runs, so the daily cap does not stop a determined member.
The **provider-side hard spend cap** (a dedicated key with a monthly limit, set by the owner before the first live call) is the real backstop for money.
**Option B (a separate agent identity that holds the runtime's authority, so a member cannot call these functions at all) is the real fix**, and is already required before
any external customer (checklist). Until then the caps and the review screens protect a workspace whose members the owner trusts.

**Not built.** No API route or screen for the cap (the Owner calls the function; a UI comes with the Owner Agent), no per-agent cap, no refund of a
failed call, no cap on token counts per day. A raised tenant cap applies to the tenant's own spending against a key the operator pays for: before
any external customer it should become operator-only (checklist row).

## T007 M2 note: claim-home follow-ups (2026-10-05)

Migration `20261014090200_t007_claim_home_followups.sql`; tests `supabase/tests/database/50_claim_home_followups.test.sql`, `tests/integration/test_claim_home.py`,
`services/ai-api/tests/test_claim_readers.py`.

- **A lead with no company is refused at start** (23503, the same answer as an unknown lead), in the database and, with a clear message
  (`409 lead_has_no_company`), in the API, so no run exists and no fetch or model call can be made for it. The runtime also ends a run whose
  target has nothing to read before any reservation or model call.
- **A run naming both a company and a lead** (the run table forbids it today) must name a lead *of that company*, or `agent_write_claim` gives the
  generic reference refusal.
- **Erasure** of a company (or of a lead's contact) whose lead runs left claims with `source_lead_id` still succeeds: the claim's free text is
  anonymised, the ids (home company, source lead, run) are untouched, and nothing is deleted (real-stack test).
- **A client cannot forge an agent claim.** A signed-in session that sets `app.created_via = 'agent'` and `app.agent_run_id` and inserts directly still
  gets a manual claim with no run and no source lead; the columns `created_via`, `agent_run_id` and `source_lead_id` are not writable by a client at all.
- **Every reader of the two claim views** (pinned by `test_claim_readers.py`; a new reader fails that test until it is reviewed):

| Reader | View | Looks up by | Purpose |
| --- | --- | --- | --- |
| `crm/repository.py` `list_claims` (single-lead score, `leads/routes.py`) | `claims_for_scoring` | `company_id` (the derived home) | score |
| `leads/repository.py` queue context (review queue and label snapshot) | `claims_for_scoring` | `company_id in (...)` | score |
| `agent_runs/repository.py` `list_claims` | `claims_effective` | `home_company_id` (company page) or `about_lead_id` (lead page) | display only |
| `agent_runs/repository.py` `get_claim` | `claims_effective` | `id` | review |

  No scoring reader filters by `lead_id`; so two leads of one company see the same accepted claim. The SQL functions that read `public.claims`
  directly (the two import functions and the real-data gate scan) look up by `company_id` or scan every row, and none is a score.

## T007 note: the Research Agent (commit 4, 2026-10-05)

The Research Agent (`app/agents/research.py`, tools in `research_tools.py`) reads ONE lead's (or company's) own website and proposes unreviewed
suggestions: web evidence (a URL on that website and a verified quote of at most 300 characters) and claims about the four predicates the ICP profile
reads (`buyer_type`, `order_scale`, `size_band`, `operating_status`), each a value from that predicate's closed vocabulary. It runs on FAKES only here
(the scripted model and the synthetic fixture sites); no real fetcher, model or key is wired to it. Migration `20261014090300_t007_research_agent.sql`.

- **Tools** (closed schemas, run-local handles, no id or URL from the model): `fetch_page(path)`, `record_evidence(page, quote)`,
  `propose_claim(predicate, value, stance, evidence)` and the final result. At most 5 pages, 3 evidence rows and 4 claims per run (7 writes, 14 tool calls).
- **Fetch only the lead's own site, decided server-side.** The model gives a PATH (no scheme, host, query, fragment, dot segment, `//` or encoded
  smuggling, closed pattern plus a decoded check); the runtime builds `https://<the company's website host><path>` and passes the host and its `www.`
  twin as `allowed_hosts`. A run whose company has no website (or has no fetcher) ends `failed / tool_failed` before any reservation or model call; the API
  refuses it earlier (`409 company_has_no_website`), and a lead with no company (`409 lead_has_no_company`).
- **Verbatim quotes.** A quote must appear in the sanitised text of the page it names (whitespace-normalised, case-sensitive), be 12 to 300 characters,
  carry no e-mail, phone number or removal marker. The stored URL is the runtime's own record of the page, never the model's text.
- **The database enforces the host again.** `agent_write_evidence` for `web_page` requires a URL whose host equals the run target company's website host
  (or its `www.` twin; no userinfo, query string or fragment) and a quote of at most 300 characters; `agent_write_claim` checks the value against the agent's
  `claim_value_pattern` (a lowercase slug). `research` is gated by its own platform flag `research_enabled` (OFF) and is allowed for no tenant until
  `app.operator_enable_research(slug)`.
- **Ceilings.** `max_input_tokens` is 120,000 (the plan said 40,000): the cost-cap reservation bounds a call's input by the bytes sent, and up to five
  8,000-character pages are re-sent each turn. The money ceiling stays 150,000 per run (0.15).
- **Page text is data.** Each fetched page is one UNTRUSTED block inside the per-run delimiter, flattened to one line, so it can neither close the block nor
  fake a marker; it is never stored (memory only).
- **Evals.** `make eval` now also runs `tests/integration/test_research_evals.py` (cases in `tests/evals/research/cases.jsonl`): W01-W11 (hidden text,
  visible and fake-system instructions, exfiltration, redirect to a private address, oversized page, fabricated quote, another company and contact details,
  robots, title/meta, bidi and homoglyphs), the lead-only-host cases L01-L04 and two database-layer cases N20/N21. Each is a scripted model that OBEYS the
  injection; the pass condition is a diff of the whole tenant (I1-I9 in `research_eval.py`). While building them an empty-list bug in the shared eval helper
  `new_rows` (`NOT IN (NULL)`, which hides every new row when nothing was seen before) was found and fixed; the selftest evals pass with the fix.
- **Score test.** `tests/integration/test_research_e2e.py` runs the agent through the API and shows the score moving only after a human accepts.

## T007 note: the review screen and the golden set (M3, 2026-10-05)

- **Review screen** (`/app/tenants/<id>/suggestions`, `GET /v1/tenants/{t}/agent-claims`). Every member sees the workspace's agent suggestions; only an
  Owner or Admin gets the controls. Each suggestion shows its company, predicate, value, the evidence QUOTE as plain text, the source HOST and PATH as
  text (never a link) and the sentence "Quote checked by the agent runtime, not by the database." Suggestions that disagree about one predicate of one
  company sit side by side (a grid that wraps to one column on a phone). Accept needs a confidence (low / medium / high; medium and high need a supporting
  evidence link, as before); **a rejection needs no reason** (migration `20261014090400_t007_m3_reject_without_reason.sql`; a reason, when given, is
  still one of the closed codes). The newest review of a claim wins, as before. The same evidence is shown on company and lead pages.
- **Golden set** (`tests/golden/research`, `tests/integration/test_research_golden.py`, part of `make eval`): 20 synthetic businesses with a known answer
  and the hard cases (no website text, contradictory pages, visible and hidden injected instructions, a sister company, the wrong site, a fact past the page
  cap, robots.txt, contact details). A scripted careful reviewer accepts or rejects each claim through the real review function. The report (committed:
  `tests/evals/research/golden-report.txt`) gives, per predicate, expected / proposed / accepted ok / **accepted wrong** / rejected / missing / abstained ok.
  **The gate fails on any wrong claim that is accepted**, on a stored quote that is not verbatim or holds a contact detail, on a broken containment
  invariant, on a fall below the floor of correct accepted claims, and on any change of the report that was not made on purpose (`UPDATE_GOLDEN=1`).
  Today: 26 correct accepted, 0 wrong accepted, 5 rejected, 3 missing (the 8,000-character page cap, robots.txt, the 3-evidence cap).
- **What the golden numbers are NOT.** The model is a scripted stand-in with blunt keyword rules (written to play a careful reader) and the reviewer is a
  script. They prove the pipeline (fetch scope, quote checks, review, the database rules) and give a baseline that a real model must beat; the agent's real
  precision is measured only at M4, with the owner's approval (checklist row "BEFORE THE FIRST LIVE CALL").
- **Two known limits** (checklist): the database does not verify quotes (the screen says so); evidence is counted per lead while claims are per company.

## Addendum (T008 closing batch): live-batch checklist
Before the first live model call of ANY agent, an agent definition's `max_cost_micros` and `max_output_tokens` are reconciled with the chosen model's `agent_model_prices` row so the worst-case reservation of that agent's largest input fits (the
reservation bounds a call's input by the UTF-8 bytes it sends plus a fixed overhead, "T007 M2 note: the daily cost cap" above). For the Requirement Agent the numbers and the proposal (`max_output_tokens` 2,500) are in ADR 0018 and the checklist row
"LIVE-BATCH COST RECONCILIATION" in `docs/pre-pilot-checklist.md`.
