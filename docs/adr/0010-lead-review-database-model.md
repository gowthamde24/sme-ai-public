# ADR 0010: Lead review queue database model (T005 Milestone 1)

Status: accepted for milestone 1 (database). Builds on ADR 0004 (RLS pattern B), ADR 0005 (PII-aware audit, `created_via`), ADR 0006 (SQLSTATE contracts), and ADR 0008 (evidence and claims model).

## Why

T005 introduces human-in-the-loop lead qualification. Before any automated research or outreach agent runs (T006+), a human reviewer must be able to:
1. Import batches of candidate leads (from CSV or manual entry) with de-duplication and integrity guarantees.
2. Maintain versioned, deterministic ICP (Ideal Customer Profile) scoring configurations as tenant-owned data.
3. Review candidate leads and assign immutable Good / Bad / Maybe labels with reason codes and reproducible scoring snapshots.
4. Export feedback datasets for offline evaluation and audit.

**Hard constraint:** T005 contains NO AI agent and NO LLM. Scoring in milestone 2 is pure deterministic Python. Real personal data must not enter the system until the anonymise/erasure workflow is built before T012.

## Decisions

1. **Deterministic Matching Keys (`app.match_key`, `app.website_host`, `app.is_shared_host`)**
   - `app.match_key(text)`: normalises text via `normalize(p, nfkc)`, lowercases using ICU default collation (`en_US.UTF-8`), strips Zero-Width Non-Joiner (U+200C) and Zero-Width Joiner (U+200D) *for matching only* (preserving them in stored text for Indic and Persian script correctness), collapses ASCII whitespace runs to a single space, and trims.
   - Python parity: `services/ai-api/tests/test_match_key_vectors.py` parses the golden SQL vector table from `supabase/tests/database/27_match_key.test.sql` and verifies identical outputs across 40+ vectors across Latin, Telugu, Kannada, and Devanagari scripts.
   - `app.website_host(text)`: extracts lowercase hostname, removes `www.` prefixes and trailing dots, rejects malformed hostnames.
   - `app.is_shared_host(text)`: filters out shared multi-tenant hosts (social platforms like WhatsApp, Instagram, LinkedIn; marketplaces like IndiaMart, JustDial, Amazon; web builders like Shopify, Wix) so two businesses sharing a platform page are never falsely merged.
   - Indexes: expression indexes on `(tenant_id, app.match_key(name))` and `(tenant_id, app.website_host(website))` support fast de-duplication during import.

2. **Versioned ICP Profiles as Data (`icp_config_versions`)**
   - Scoring rules are stored as immutable, tenant-scoped data rows rather than code constants.
   - Server-assigned sequential version numbers (`1, 2, 3...`) per tenant via `app.assign_icp_version` using a tenant-level advisory transaction lock (`hashtextextended('icp:' || tenant_id, 0)`).
   - Server-calculated SHA256 of the configuration JSON ensures tamper-evident audit.
   - Structural constraints: valid JSON object, max 32 KB, 1 to 20 factors, clean text without invisible Unicode (`app.text_is_clean`).
   - RLS: Readable by all tenant members; insert restricted to `owner` and `admin`.

3. **Append-Only Lead Labels (`lead_labels`)**
   - Reviewer judgements are append-only. A changed mind creates a new row; the latest row represents current status.
   - Labels: `good`, `bad`, `maybe`.
   - Reason codes (11): `not_our_market`, `wrong_product`, `too_small`, `too_large`, `inactive`, `not_a_business`, `no_contact_route`, `already_customer`, `duplicate`, `insufficient_info`, `payment_risk`. A reason code is mandatory when the label is `bad`.
   - Score snapshot: `icp_version_id`, `score`, `score_max_reachable`, and `snapshot` JSON. Enforces all-or-nothing: either all four are NULL (blind review or unscored) or all four are present with `score <= score_max_reachable`.
   - Composite FKs: `(tenant_id, lead_id) -> leads(tenant_id, id)` and `(tenant_id, icp_version_id) -> icp_config_versions(tenant_id, id)`.
   - RLS: Readable by all members; insert permitted for `owner`, `admin`, and `sales`.

4. **Export Audit Trail (`data_exports`)**
   - Immutable log created whenever a lead label dataset is exported.
   - Records tenant, kind (`lead_labels`), format (`csv`, `json`), row count (0..10,000), and SHA256 of the exported payload.
   - Contains no exported row contents or PII.
   - RLS: Read and insert restricted to `owner` and `admin`.

5. **Safe Batch Lead Ingestion (`public.import_lead_rows`)**
   - High-privilege `SECURITY DEFINER` function with strict `search_path = ''`.
   - Authorisation: explicitly verifies `auth.uid() is not null` and caller holds `owner`, `admin`, or `sales` membership in `p_tenant_id`.
   - Concurrency & Idempotency: per-tenant transaction advisory lock `hashtextextended('import:' || p_tenant_id, 0)` prevents concurrent race conditions. Replaying an identical batch ID and payload returns the existing batch; differing payloads or cross-tenant IDs trigger a `23505` conflict.
   - Strict column allowlist (15 columns). Extra keys or invalid types are rejected.
   - **Real-Data Gate:** Because the anonymisation/erasure procedure is not yet built (gated before T012), contact personal data is restricted to reserved domains (`.test`, `.invalid`, `.example`, `example.com/org/net`) and phone numbers starting with `+00`. Non-reserved contact data causes row rejection with a code, never reflecting the cell value. Company-level data may be real.
   - Per-row savepoints: each row runs in its own sub-transaction; an error on one row (e.g. malformed data or duplicate contact belonging to another company) records a rejection without aborting the batch.
   - Dry run support: `p_dry_run = true` executes all validation and matching logic and builds the report, then rolls back all writes via internal SQLSTATE `SM100`.
   - Provenance: explicitly sets `app.created_via = 'import'`.
   - Provenance of those claims (fix round F, migrations `20261008090000` / `20261008090100`): each batch writes ONE `evidence` row (kind `import_batch`, provider `import.csv`, reference `import:<batch uuid>`, a count sentence as snippet: no cell value, label or personal data) and every claim the batch creates is linked to it (`evidence_links`, stance `supports`). Claims that already existed are kept and NOT linked (this batch did not source them). A CHECK (`evidence_import_batch_needs_import_origin`) lets only the import path write that kind.
   - Attribute claims: company attributes (`buyer_type`, `size_band`, `operating_status`, `order_scale`) are written as `claims` with `confidence = 'unverified'` only if no non-archived claim for that predicate already exists.

6. **Audit and Integrity Triggers**
   - All five tables register triggers for `app.forbid_tenant_id_change()`, `app.set_created_meta()`, and `app.guard_immutable_record()`.
   - Append-only: updates and deletes are blocked.
   - Registered in `tests.tenant_table_registry` and `tests.role_matrix`.
