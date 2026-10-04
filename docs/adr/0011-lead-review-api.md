# ADR 0011: Lead Review Queue API (T005 Milestone 2)

Status: accepted for milestone 2 (API layer). Builds on ADR 0002 (API authentication & JWT validation), ADR 0006 (CRM API & RLS mapping), ADR 0008 (evidence and claims model), and ADR 0010 (lead review database model).

## Why

T005 Milestone 2 builds the API layer for human lead review and ICP scoring on top of the database foundation established in Milestone 1. A human reviewer needs to:
1. Preview and commit lead imports with duplicate detection and provenance tracking.
2. Evaluate leads against a tenant's active Ideal Customer Profile (ICP) using a pure deterministic scoring engine.
3. Review leads in a dedicated queue with blind scoring support (preventing confirmation bias).
4. Apply Good / Bad / Maybe labels with mandatory reason codes on Bad and immutable scoring snapshots.
5. Export labeled datasets to CSV and JSON with robust spreadsheet formula injection protection.

**Core Invariants:**
- **Zero AI / Zero LLM:** All scoring is pure, deterministic Python arithmetic. Zero I/O, no database calls, no network.
- **Fail-Closed Privacy & Tenant Isolation:** 401 Unauthenticated -> 404 Foreign/Unknown Tenant -> 403 Role Check -> PostgREST RLS.
- **Formula Injection Immunity:** Any exported field starting with dangerous characters (`=`, `+`, `-`, `@`, `\t`, `\r`) is sanitised by prefixing with a single quote (`'`).

## Decisions

### 1. Pure Deterministic ICP Scoring Engine (`app/leads/scoring.py`)
- Executes entirely in-memory with zero I/O and zero async dependencies.
- Enforces strict factor weight validation: exactly 1 to 20 factors whose `max_points` sum to 100.
- Closed set of 6 factor rule types:
  1. `keyword_fit`: Matches company name, tags, and category terms against strong/weak vocabularies.
  2. `attribute_fraction`: Maps categorical claim values (e.g. `buyer_type`) to percentage points.
  3. `place_tier`: Evaluates company location against prioritized geographic tiers (first match wins).
  4. `attribute_max`: Scores based on business scale or capacity attributes.
  5. `contact_quality`: Grants points for presence of reachable phone, email, and decision-maker roles.
  6. `evidence_count`: Awards points based on verified evidence items and evidence diversity.
- **Explicit Unknowns:** Missing or unlisted inputs evaluate to `"unknown"` (never silently 0). The engine calculates both `score` and `score_max_reachable` (subtracting max points of unknown factors), ensuring reviewers see missing information explicitly.
- **Deterministic Bands:** `priority` (80+), `worth_reviewing` (65+), `maybe` (50+), and `low_priority` (<50). Human labels override scores.

### 2. Matching Key Vector Parity (`app/leads/keys.py`)
- Implements Python equivalent of `app.match_key`: NFKC normalization, lowercase (ICU `lower()` preserving sharp-s and sigma rules), stripping ZWJ (U+200D) and ZWNJ (U+200C) for matching only, ASCII whitespace collapsing, and trimming.
- Continuous parity: ONE vectors file (`tests/vectors/match_key.json`, 80 vectors incl. casefold-vs-lower, NFKC, joiners, blanks, Telugu / Kannada / Devanagari, empty / NULL) is read by `tests/test_match_key_vectors.py`, which runs every row through the PRODUCTION function `app.leads.keys.match_key` (no copy of the algorithm in the test, and a check that the scoring engine uses the same object), and by pgTAP `27_match_key.test.sql`, which carries a copy GENERATED from the file by `scripts/gen_match_key_fixture.py` (pgTAP cannot read files; a drift test fails when the copy is stale). Nine mutants of the algorithm (casefold, no NFKC, no lower-casing, joiners kept, ...) are each distinguished by the vector set. Python returns the empty key for a missing value where SQL returns NULL; the vectors state this explicitly.

### 3. Review Queue with Blind Scoring (`app/leads/routes.py`)
- Endpoint `GET /v1/tenants/{tenant_id}/leads/review-queue`:
  - Combines lead details, company metadata, contacts, claims, evidence links, and the CALLER's own latest label.
  - Computes the score on-the-fly using the tenant's latest active ICP configuration, through `app.leads.review.score_inputs` (the same function, projection and claim order the label snapshot uses; see section 4).
  - Order is always `(created_at, id)` newest first: it never depends on a score.
  - Blind mode (`?blind=true`, the default) hides `score`, `score_max_reachable`, `score_band` and `snapshot` for every lead the CALLER has not labelled. "Labelled" means labelled BY THE CALLING USER: another reviewer's label neither unblinds a lead for this caller nor appears (with its stored score) in their queue. The server fetches only the caller's own labels.
  - A `score_band` filter is refused with 422 `score_band_requires_unblinded_view` while blind (filtering on a hidden value reveals it). Cursor-based pagination always works; a band-filtered scan (non-blind only) reads further pages until it has a full page.
  - `blind=false` is a deliberate opt-in; every such request is logged (`app.leads.audit`: tenant id and user id, nothing else). A database audit event would need a new definer function and is not part of this round.
  - The sub-reads (claims, evidence, labels) fail loudly: scoring with an input silently missing would under-report a lead.

### 4. Append-Only Labeling & Score Snapshots (`app/leads/routes.py`, `app/leads/repository.py`)
- Endpoint `POST /v1/tenants/{tenant_id}/leads/{lead_id}/labels`:
  - Validates `label` (`good`, `bad`, `maybe`).
  - Enforces `reason_code` requirement: mandatory if `label == bad`, forbidden if `label != bad`. Valid reason codes are constrained to the 11 enum variants defined in the database.
  - Automatically captures the current active ICP config version and calculates a full score snapshot at the moment of review, preserving reproducibility even if the ICP profile is subsequently updated. The snapshot is computed from exactly the inputs the queue used: `CrmRepository.list_claims` (tenant-scoped, the caller's JWT, newest first), the lead's evidence, the ICP version. (Before fix round F the production CRM repository had no `list_claims`, so every snapshot ignored the imported attributes; a real-stack test now asserts label == queue score, band and snapshot.)
  - Idempotent on a CLIENT-supplied `id` (like every other create): 201 the first time; 200 with the original stored label for a retry (same id, lead, label, reason); 409 `conflict` for any other use of the id, including an id another tenant holds (RLS hides it, so the answer is the same generic one).
  - Append-only: changing one's mind creates a NEW label (a new id); `GET /v1/tenants/{tenant_id}/leads/{lead_id}/labels` returns the history newest first. Until the viewer has labelled that lead themselves, other reviewers' labels show their verdict but not the score, score ceiling or snapshot.

### 5. Lead Import Preview and Commit
- Endpoint `POST /v1/tenants/{tenant_id}/leads/import/preview`: Runs dry-run validation against `public.import_lead_rows`, returning projected counts (`created`, `skipped_duplicate`, `ambiguous`, `rejected`) without writing to the database.
- Endpoint `POST /v1/tenants/{tenant_id}/leads/import`: Commits the batch with server-owned provenance (`created_via = 'import'`). Supports idempotent replay: re-submitting an existing `batch_id` returns HTTP 200 with `replayed = true`.

### 6. Export Pipeline with Formula Neutralization (`app/leads/export.py`)
- Endpoint `POST /v1/tenants/{tenant_id}/exports`:
  - Pre-registers an audit record in `public.data_exports` before returning content.
  - Generates RFC 4180 compliant CSV or formatted JSON.
  - CSV formula sanitisation neutralizes potential spreadsheet execution attacks: any string starting with `=`, `+`, `-`, `@`, `\t`, or `\r` is prefixed with `'`.
  - Computes content SHA-256 and exact row count, emitting headers `X-Export-Sha256` and `X-Export-Rows`.

### 7. RBAC Matrix & Tenant Routing
- Route evaluation order in `app/main.py`: `leads_router` is registered before `crm_router` to prevent CRM generic entity routes (`/leads/{row_id}`) from shadowing specialized paths (`/leads/review-queue`, `/leads/import`).
- Role permissions:
  | Endpoint | Roles Allowed | Notes |
  |---|---|---|
  | `POST /icp-configs` | Owner, Admin | Creates immutable versioned config |
  | `GET /icp-configs`, `/active`, `/{id}` | All Members | Read configuration |
  | `POST /leads/import/preview`, `/import` | Owner, Admin, Sales | Batch ingestion |
  | `GET /leads/review-queue` | All Members | Blind by default; band filter only with `blind=false` |
  | `POST /leads/{lead_id}/labels` | Owner, Admin, Sales | Append-only human labels |
  | `GET /leads/{lead_id}/labels` | All Members | Audit trail of labels |
  | `POST /exports` | Owner, Admin | Immutable export ledger |

## Verification

- **Lint & Typecheck:** `ruff check .` passes with 0 warnings; `mypy` passes across all 71 source files.
- **Contracts Sync:** `packages/contracts/leads.schema.json` and `leads.ts` generated and in sync (`npm run typecheck` passes).
- **Unit Test Suite:** 942 unit tests pass in `services/ai-api` (scoring engine, key vectors against the production function, the PostgREST adapter for the queue and for labels, route fakes).
- **Database Suite:** 4,141 pgTAP database tests pass across 29 files (`make db-test`).
- **Integration Test Suite:** 384 tests pass across the entire suite (`make test-integration`): the lead review lifecycle in `tests/integration/test_leads_review_in_db.py`, direct-PostgREST attacks on every T005 table and on `rpc/import_lead_rows` in `tests/integration/test_t005_direct_postgrest.py`, and the demo seed.
- **Definition of Done:** `make check` passes completely.

## Fix round F (audit of commit 0ccb40c)

An independent audit found defects the first build's tests could not see. Fixed in separate commits:

- **A. Label snapshot inputs.** `list_claims` is real; queue and label share `app/leads/review.py`.
- **B. Blind scoring.** Server-side: no band filter while blind, score-independent order, per-caller labels, redacted label history, `blind=false` logged.
- **C. Provenance** (ADR 0010 amendment): imported claims are linked to one evidence row per batch.
- **D. Direct-PostgREST tests** for the five T005 tables and the import function (60 tests; 10 mutations of policies, grants and checks all caught).
- **E. match_key parity** against the production function with one shared vectors file.
- **F. Label idempotency** on a client id; the leads contracts are now part of `make contracts` and their sync is tested.
- **G. Demo seed** publishes the generic ICP template and imports 20 synthetic leads; `ROUTE_WORDS` gained the T005 words and its guard test now reads the real routes (it used to see 5 words: routers are `_IncludedRouter` objects without a `.path`).

Known limits: the queue reads claims for a page of leads in one request (PostgREST caps a response at 1000 rows); `blind=false` is logged, not audited in the database; the import action in the web app still generates a new batch id per submit.
