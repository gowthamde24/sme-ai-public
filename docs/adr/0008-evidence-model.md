# ADR 0008: Evidence model (T004)

Status: accepted for milestones 1 (database), the text-hygiene hardening, and 2 (API). Builds on ADR 0004
(RLS pattern), ADR 0005 (PII-aware audit, `created_via`) and ADR 0006 (SQLSTATE-only error
classification). The web slice and the demo seed are milestone 3.

## Why

CLAUDE.md #5: "every AI output used for business action must preserve provenance and uncertainty".
`docs/product.md`: "Every score keeps evidence/provenance", "Extracted facts keep source IDs and
confidence". T004 is the data model that makes that true. **Nothing in T004 fetches a URL, renders a
page, scores a lead, or runs an agent.**

## Decisions

1. **Three tenant-owned tables, no polymorphic id.**
   - `evidence`: one observed source: `kind`, `provider`, `url`, `reference`, `snippet`, `retrieved_at`,
     `published_at`, plus the provenance columns.
   - `evidence_links`: ONE link table with one nullable composite FK per target (`company_id`,
     `lead_id`, `claim_id`) and `CHECK (num_nonnulls(...) = 1)`. Chosen over one link table per entity:
     the target set is small and closed, the integrity is fully in the database, and policies, grants,
     audit and tests exist once. Adding a target later (a research output) is one `ADD COLUMN` + FK +
     CHECK rewrite in a new migration. Cost: sparse columns and one partial unique index per target.
   - `claims`: a researched fact about a company or a lead (`predicate`, `value`, `confidence`), with
     evidence attached through `evidence_links.claim_id` and a `stance` (`supports`, `contradicts`,
     `context`).
   - Contacts and opportunities are **not** link targets and contacts are not claim subjects (owner
     decision): PII minimisation, and no workflow needs them yet. Adding one later is a migration.
2. **Claims are provisional.** The shape (predicate, value, 4-level confidence) is the smallest that
   lets "every researched fact carry evidence + uncertainty"; the first real consumer is the research
   agent, which may change it (in a new migration). T004 builds **no claims API and no claims UI**;
   claims are covered by database tests, and by the demo seed in milestone 3 (decision 12).
   *Uncertainty is stated, not implied:* `claims.confidence` is `NOT NULL` with no default
   (`unverified`, `low`, `medium`, `high`; deliberately not a numeric score, which would be false
   precision); `stance` is required on a claim link and forbidden elsewhere; unknown dates stay `NULL`.
   A claim with no evidence links is representable and must be shown as unsupported; "confidence above
   `unverified` needs evidence" is **not** enforced by a constraint (it would be racy across two
   inserts) and belongs to the atomic agent write path.
   Claims are never a price source (CLAUDE.md #4): the quote service reads none.
3. **Append-only, archive only.** UPDATE is granted on `archived_at` and nothing else, and a trigger
   (`app.guard_immutable_record`) enforces the same for every role including the table owner. A
   correction is a new row (and an archive of the wrong one); there is no `supersedes_id` (owner
   decision). Archive is Owner/Admin (`app.guard_archive`, as in T003). No DELETE grant.
   Links stay on archived evidence; each row is archived on its own.
4. **Roles.** Read: any member. Write (evidence, links, claims): Owner / Admin / Sales. Archive:
   Owner / Admin. Same pattern-B policies as T003.
5. **Untrusted content (CLAUDE.md #6).** `url`, `reference`, `snippet` and `claims.value` are data:
   stored verbatim, never fetched, followed or interpreted. Database limits (CHECK constraints, tested
   with a table of accepted and rejected inputs, as privileged user and as a client):
   - `url`: 8..2048 characters, `http://` or `https://` only, no userinfo, no whitespace or `<>"'\`
     characters, and clean text (decision 13). Excludes `javascript:`, `data:`, `file:`.
   - `snippet`: 1..1000 characters, non-blank, clean text. `claims.value`: the same, 500 characters.
   - `reference`: the T003 typed-reference pattern `<kind>:<token>`; `provider` and `predicate` are
     constrained slugs.
   - Text that looks like an instruction is **not** stripped (it is data); consumers must delimit it
     (an obligation for the agent ticket, see the checklist).
   The UI (milestone 3) renders plain text only: no anchors built from evidence, no previews.
6. **Provenance.** `created_via` (`manual` / `import` / `agent`) and `created_by` are server-owned
   (`app.set_created_meta`, ADR 0005): a signed-in client is always `manual`; trusted code may declare
   `import` / `agent` with `set local app.created_via`, in which case `created_by` is `NULL` unless a
   user is signed in (no human is assumed). `created_at` is the server clock; `retrieved_at` is when the
   source was observed (declared by the writer, default `now()`); `published_at` is nullable.
   `retrieved_at` is bounded: `>= 2000-01-01` (CHECK) and not more than 5 minutes in the future
   (BEFORE INSERT trigger `evidence_retrieved_at_not_future`, because `now()` is not immutable);
   `published_at <= retrieved_at` is a CHECK.
7. **PII and audit.** `evidence.url`, `.snippet`, `.reference` and `claims.value` are classified `PII:`
   (and `UNTRUSTED`): the audit trigger lists them (`'url,snippet,reference'`, `'value'`) so only the
   field NAMES reach `audit_events.metadata.pii_fields_changed`, never values. `reference` is PII for the
   same reason as `consent_events.evidence_ref` (an opaque pointer can still point at a person).
   `provider`, `predicate`, `kind`, `confidence`, `stance`, the ids and the timestamps are `SAFE:` and
   audited with values. A pgTAP test scans the whole audit table for canary strings.
8. **Erasure reaches evidence through links.** Evidence about a person is found by following its links
   (company / lead / claim) to the person's records; a row nobody links to cannot be found, which is why
   milestone 2 creates evidence and its first link in ONE call. The sanctioned way to erase `url` /
   `snippet` / `reference` / `value` is a future privileged, audited anonymise-in-place function that
   replaces `app.guard_immutable_record` in its own migration (and relaxes the "url or reference"
   CHECK with an `erased_at` marker). Not built in T004; tracked as part of the pre-T012 hard gate.
9. **Identity of non-human writers is deliberately not built.** T004 stays compatible with every option
   (a per-tenant agent principal with a membership; a short-lived delegation token minted by the API; a
   SECURITY DEFINER write function authenticated by a signed run token; never a service-role key) by:
   `created_via` already has `agent`; `created_by` is nullable and never joined to a human profile;
   policies work for any authenticated principal with a membership; `retrieved_at` comes from the
   writer; `reference` can carry `run:<uuid>`. **An ADR on the agent write path (identity and permission
   model for non-human actors) is a precondition for the T005 plan** (checklist).
10. **SQLSTATE contract** (the API classifies by SQLSTATE only, never by message text, and tests assert
    these exactly): `23514` invalid value or structure (including the exactly-one CHECKs and the
    future-`retrieved_at` trigger, constraint `evidence_retrieved_at_not_future`); `23503` invalid
    reference (a foreign id fails exactly like a nonexistent one); `23505` duplicate (primary key =
    idempotent retry of a client-chosen id; `evidence_links_{company,lead,claim}_evidence_key` = the
    pair is already linked); `23502` missing required value (`confidence`); `22P02` invalid enum label;
    `42501` forbidden or immutable (RLS, column privilege, archive by a non-Admin, update of a content
    column). No new custom SQLSTATE was needed.
11. **Atomic create.** `public.create_evidence_with_link(...)` is SECURITY **INVOKER** with
    `search_path = ''`: it inserts the evidence and its first link in one transaction with the CALLER's
    privileges, so RLS, column grants, CHECKs and triggers apply exactly as for two plain inserts. It has
    no parameter for provenance, archive state, stance or a claim target (target kinds: `company`,
    `lead`), so it cannot do more than the tables allow. Its own refusals use `22023` (NULL id, unknown
    target kind). pgTAP (`22_...`) and a direct-PostgREST integration test prove: Viewer, outsider, anon
    and other tenants are refused; a foreign target fails like a nonexistent one (`23503`) and rolls the
    evidence insert back; forged parameters are rejected by PostgREST; the table rules (URL, hygiene,
    future `retrieved_at`) hold inside it. Catalog guards: only the allow-listed functions are executable
    by `authenticated`, and every invoker function in `public` pins `search_path`.
12. **Acceptance test: `make seed-demo` (implemented in milestone 3; see ADR 0009).** A clearly fake
    demo seed builds a synthetic SME (company, contacts, products, lead, opportunity, evidence, claims),
    with invented names (every one starts with "DEMO", every address is on a reserved `.test` domain) and
    no real person or Customer Zero data. Acceptance: "a synthetic SME can be represented end-to-end and
    every researched fact can carry evidence."
    **How it writes, stated plainly:** everything goes through OUR API (the demo user's own access
    token) **except claims**, which have no API. The seed creates the claims and their evidence links
    through PostgREST using the demo user's **own JWT and the public anon key, under row-level security
    like any signed-in user**. There is **no service-role key** in the script, the repository or the
    environment it reads. The script refuses to run unless the Supabase URL and the API URL are local.
13. **Invisible Unicode (hardening migration `..._t004_text_hygiene.sql`).** Free text can hide
    instructions for language models in characters that render as nothing. One shared IMMUTABLE
    function, `app.text_is_clean` (text, `text[]` and `jsonb` overloads; `search_path = ''`; EXECUTE for
    `authenticated` because CHECKs run as the inserting role), is false for: C0 controls except tab /
    LF / CR; DEL and C1 controls (U+007F..009F); U+200B; U+2028 / U+2029; bidi embeddings and
    overrides U+202A..202E and isolates U+2066..2069; U+2060..2064; U+FEFF; and the tag characters
    U+E0000..E007F. **Not** blocked: U+200C / U+200D (needed for Indic and Persian scripts) and
    U+200E / U+200F. It is used in CHECK constraints on `evidence.url`, `.snippet`, `claims.value` and
    on **every free-text column of every tenant-owned table**, enumerated from the catalog in the
    migration (`companies`, `contacts`, `products`, `leads`, `opportunities`: 24 columns in total).
    Exempt, with a `CLEAN-EXEMPT:` reason in the column comment: columns limited by a strict anchored
    pattern (`consent_events.evidence_ref`, `evidence.provider`, `.reference`, `claims.predicate`) and
    `audit_events.*` (written only by the SECURITY DEFINER audit writer). The one client-influenced audit
    column, `request_id` (the `X-Request-Id` header), is dropped by the writer when it is not clean.
    A catalog guard fails the suite for any text / `text[]` / `jsonb` column of a tenant-owned table
    that has neither a `text_is_clean` CHECK nor a documented exemption (strict pattern or not
    client-writable), so tables added by later tickets are policed automatically. The `jsonb` overload
    also detects JSON-escaped C0 controls (an even-backslash-aware scan of the text form).
    The API mirrors the same character set (`app.evidence.models.text_is_clean`) only to fail early with a
    field-level 422; the database is the authority.
14. **API (milestone 2).** Under `/v1/tenants/{tenant_id}/`:
    - `POST companies/{id}/evidence`, `POST leads/{id}/evidence`: create evidence and its first link
      atomically. `GET` on the same paths lists the target's links with the evidence embedded (keyset
      pagination, `limit` 50 default / 100 max, newest first, archived links AND links to archived
      evidence hidden unless `include_archived=true`). `POST evidence-links/{id}/archive` and
      `/restore` (Owner / Admin; idempotent). No delete, no supersede, no claims endpoints.
    - Authorization order: JWT (401) -> membership of the path tenant (404) -> role (403) -> the
      company / lead in the path must exist for the caller (404: unknown, malformed and foreign ids
      are indistinguishable; evidence is never touched before this) -> the database decides again.
      An archived target refuses new evidence (409 `archived`).
    - The client sends `id` (UUID), `kind`, `url`, `reference`, `snippet`, optional `retrieved_at` and
      `published_at`. `provider` is **set by the API** (`manual`) and is not accepted; `created_by`,
      `created_via`, `tenant_id`, `archived_at` and the target are never accepted (`extra="forbid"`).
    - Idempotency: the link id is `uuid5(evidence_id, "<kind>:<target_id>")`, so a retry targets the
      same rows. The RPC's `23505` is followed by a read: if the caller's tenant holds exactly that
      evidence, linked to that target, with the same content (and the same `retrieved_at` if the client
      sent one), the answer is **200** with the stored item; a different payload, a different target, or
      an id owned by another tenant (invisible to the caller) is the **same generic 409**.
    - Errors are classified by SQLSTATE only: `23514` -> 422 `invalid_value`, `23503` -> 422
      `invalid_reference`, `22P02` / `22023` / `23502` -> 422, `42501` -> 403, `23505` -> the idempotency
      path above. Data-layer text (which can contain a URL or snippet) is read only to classify, never
      returned, logged or chained.
    - Logging: the access log keeps method and status and replaces every path segment that is not a
      route word of this API or a canonical UUID with `<redacted>` (found by the live-log canary test:
      a value pasted where an id belongs was logged verbatim). A unit test proves every literal route
      segment is on the allow-list.
    - Contracts: `packages/contracts/evidence.schema.json` and `evidence.ts` are generated by
      `make contracts` from the models (drift test); integration tests validate real responses against
      the schema. The web must show `url` / `snippet` / `reference` as plain text.

## Out of scope (T004)

Fetching, crawling or rendering URLs; a research agent; lead scoring; contact / opportunity evidence;
supersede chains; claim review states or numeric scores; evidence bodies, hashes or screenshots;
per-tenant quotas or rate limits; the erasure procedure itself; the agent identity model.

## Known limits

- Writers declare `retrieved_at` and `provider`; the database bounds them but cannot verify them.
- Evidence rows are shared by id within a tenant: one row may support several companies / claims, so
  erasing a person's evidence anonymises the shared row for all of them (conservative).
- Quotation length is capped, but nothing here checks copyright or licence of the quoted source.
- `text_is_clean` is a deny-list of known invisible characters, not a proof that a string is
  harmless: visible instructions ("ignore previous instructions") are legal data and stay the prompt
  builder's problem. New invisible code points added by future Unicode versions need a migration.
- `tenants.name` and `users.display_name` are free text outside the tenant-owned tables the guard
  covers (see the checklist).
- A stored `url` is never fetched here. A future fetcher must treat it as hostile (SSRF; checklist).
- A tenant member with write access can add rows without limit (no quota yet).
- `url` can still contain personal data in the path or query (it is classified PII and shown as text).
