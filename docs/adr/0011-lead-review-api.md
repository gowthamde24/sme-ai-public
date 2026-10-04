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
- Continuous parity is guaranteed by unit tests (`tests/test_match_key_vectors.py`) parsing the database pgTAP golden vector suite (`27_match_key.test.sql`).

### 3. Review Queue with Blind Scoring (`app/leads/routes.py`)
- Endpoint `GET /v1/tenants/{tenant_id}/leads/review-queue`:
  - Combines lead details, company metadata, contacts, claims, evidence links, and latest review label.
  - Computes score snapshot on-the-fly using the tenant's latest active ICP configuration.
  - Supports `?blind=true` (default): Hides `score`, `score_max_reachable`, `score_band`, and `snapshot` for unlabeled leads so human reviewers make unbiased initial evaluations. Once labeled (or when `blind=false` is requested), the score snapshot is revealed.
  - Supports filtering by `score_band` and cursor-based pagination.

### 4. Append-Only Labeling & Score Snapshots (`app/leads/routes.py`, `app/leads/repository.py`)
- Endpoint `POST /v1/tenants/{tenant_id}/leads/{lead_id}/labels`:
  - Validates `label` (`good`, `bad`, `maybe`).
  - Enforces `reason_code` requirement: mandatory if `label == bad`, forbidden if `label != bad`. Valid reason codes are constrained to the 11 enum variants defined in the database.
  - Automatically captures the current active ICP config version and calculates a full score snapshot at the moment of review, preserving reproducibility even if the ICP profile is subsequently updated.
  - Append-only: changing one's mind creates a new label row; `GET /v1/tenants/{tenant_id}/leads/{lead_id}/labels` returns full history ordered newest first.

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
  | `GET /leads/review-queue` | All Members | Filterable, supports blind mode |
  | `POST /leads/{lead_id}/labels` | Owner, Admin, Sales | Append-only human labels |
  | `GET /leads/{lead_id}/labels` | All Members | Audit trail of labels |
  | `POST /exports` | Owner, Admin | Immutable export ledger |

## Verification

- **Lint & Typecheck:** `ruff check .` passes with 0 warnings; `mypy` passes across all 66 source files.
- **Contracts Sync:** `packages/contracts/leads.schema.json` and `leads.ts` generated and in sync (`npm run typecheck` passes).
- **Unit Test Suite:** 819 unit tests pass in `services/ai-api` (including scoring engine, key normalisation vectors, and route fakes).
- **Database Suite:** 4,077 pgTAP database tests pass across 28 files (`make db-test`).
- **Integration Test Suite:** 315 tests pass across the entire suite (`make test-integration`), including real-database verification of the lead review lifecycle in `tests/integration/test_leads_review_in_db.py`.
- **Definition of Done:** `make check` passes completely.
