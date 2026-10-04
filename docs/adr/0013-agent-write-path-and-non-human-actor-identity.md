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
   budget, `SM204` disabled, `SM205` step key reused with other arguments, `SM206` limit; `23505` for a used id is raised with a
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
