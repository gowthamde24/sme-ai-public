# ADR 0008: Evidence model (T004)

Status: accepted for milestone 1 (database). Builds on ADR 0004 (RLS pattern), ADR 0005 (PII-aware
audit, `created_via`) and ADR 0006 (SQLSTATE-only error classification). API and web are milestones 2
and 3.

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
   - `url`: 8..2048 characters, `http://` or `https://` only, no userinfo, no whitespace, control,
     bidi (U+202A..202E, U+2066..2069) or `<>"'\` characters. Excludes `javascript:`, `data:`, `file:`.
   - `snippet`: 1..1000 characters, non-blank, tab / newline / CR are the only control characters,
     no C1 controls, no bidi overrides. `claims.value`: the same, 500 characters.
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
11. **Atomic create (milestone 2).** A SECURITY **INVOKER** function with `search_path = ''` creates
    evidence and its first link in one transaction; RLS still applies. A test calls it directly through
    PostgREST to show it gives no power beyond the tables' own policies.
12. **Acceptance test (milestone 3): `make seed-demo`.** A clearly fake demo seed builds a synthetic SME
    (company, contacts, products, lead, opportunity, claims with evidence) **through the API only**,
    with invented names and no real person or Customer Zero data. Acceptance: "a synthetic SME can be
    represented end-to-end and every researched fact can carry evidence." Where the milestone-2 API does
    not yet expose claims, the seed's scope is decided then (see the milestone-3 plan).

## Out of scope (T004)

Fetching, crawling or rendering URLs; a research agent; lead scoring; contact / opportunity evidence;
supersede chains; claim review states or numeric scores; evidence bodies, hashes or screenshots;
per-tenant quotas or rate limits; the erasure procedure itself; the agent identity model.

## Known limits

- Writers declare `retrieved_at` and `provider`; the database bounds them but cannot verify them.
- Evidence rows are shared by id within a tenant: one row may support several companies / claims, so
  erasing a person's evidence anonymises the shared row for all of them (conservative).
- Quotation length is capped, but nothing here checks copyright or licence of the quoted source.
- A tenant member with write access can add rows without limit (no quota yet).
- `url` can still contain personal data in the path or query (it is classified PII and shown as text).
