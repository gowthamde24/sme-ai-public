# ADR 0014: Erasure and anonymisation of personal data

Status: proposed (2026-10-05). Built in T006b milestone 1; the owner approved the design decisions listed below, this text and the
two migrations await review.
Related: ADR 0001 (tenancy), 0005 (PII-aware audit and the consent ledger), 0008 (evidence), 0013 (agents),
`docs/pre-pilot-checklist.md` (HARD GATE before T012).
Code: `supabase/migrations/20261010090000_t006b_erasure_foundation.sql` (tables, registry, guards),
`supabase/migrations/20261010090100_t006b_erasure_functions.sql` (the three functions and the scope handlers),
`services/ai-api/app/erasure/`, `apps/web/app/app/tenants/[tenantId]/privacy/`.
Tests: `supabase/tests/database/39..43_erasure_*.test.sql`, `tests/integration/test_erasure_direct_postgrest.py`.

## Context

The system stores personal data: contacts (name, e-mail, phone, job title), the consent ledger, and free text that can mention
people (evidence snippets, URLs and references, claim values, lead sources, opportunity titles, product descriptions, tags, import
batch labels, and, for a sole proprietor, the business name). Several of those tables are **immutable by design** (evidence, claims,
links, import records, the consent ledger, labels, exports, the audit log), so a person cannot be removed by an ordinary UPDATE or
DELETE. Humans can only archive.

The family is about to label **real** leads (T006b). Before real contact data can enter, a tested procedure must exist that removes
a person's data on request, keeps the business useful (labels, scores, counts, the consent ledger), and cannot be turned against
another tenant. India's DPDP Act gives the data principal a right to erasure; this ADR is engineering, not legal advice (the legal
review is a separate gate).

## Decisions (owner, 2026-10-05)

1. **Who.** An **Owner executes** an erasure. An **Admin may request** one. Sales and Viewers can do neither.
2. **Grace.** Erasing **one contact or one company has no grace period**: it is irreversible and happens when the Owner confirms.
   A **tenant-wide** erasure has a **24-hour cancel window**: it can only be executed 24 hours after it was requested, and either an
   Owner or an Admin can cancel it until then. (The Owner can *preview* it at any time.)
3. **Sweep.** For **exact identifiers** (e-mail and phone, normalised) the identifier is replaced **inside** any free-text column of
   the workspace (substring). For **names** only a field that **equals** the name is tombstoned; free-text columns that merely
   **contain** it are **not touched** and are listed in the result as "needs manual review" (table, column, row id; never a value).
   See "The limit of names": this is a deliberate, stated limit.
4. **Contact erasure never touches a company.** A separate **company scope** exists, chosen by the Owner (a sole proprietor's
   business name is their name).
5. **The real-data gate** (a trigger on `contacts` for every write path, default closed, operator-only open and close with recorded
   prerequisites) is the next milestone (M2), not this ADR. Erasure shipping is one of its prerequisites.

### A finding that changed the design (found while confirming audit coverage)

`audit_events` stored the **values** of `companies.name`, `website`, `city` and `region` (they were classified `SAFE`, and only
`tags` was audited by name). For a sole proprietor those are personal data, and the audit log is immutable. Resolution, all in this ADR:

* the four columns are now classified **`PII:`** and the company audit trigger lists them, so **new** audit rows record them by name only;
* the **company-scope erasure removes those four keys** from the existing audit rows of that company (the only permitted change to the
  audit log, see "The exception");
* the **tenant scope leaves a company's identity alone** (decision 4: a business is not a person; use the company scope), so the four
  columns carry `tenant_exempt` in the registry.

Side effect: the company history no longer shows a rename's old and new name, only that the name changed.

## Design

### Anonymise in place, with tombstones

Rows are never deleted, so every reference (leads, claims, labels, links, the ledger) stays valid and the dataset stays usable.
Personal columns are overwritten:

| Column kind | Replacement |
| --- | --- |
| Nullable text (`email`, `phone`, `job_title`, `evidence.url`, `website`, `city`, `region`, `products.description`) | `NULL` |
| NOT NULL / shaped text (`full_name`, `title`, `name`, `evidence_ref`, `reference`, `snippet`, `value`, lead and opportunity reasons) | the tombstone `erased:1` (it satisfies the typed-reference shape `<kind>:<token>` and every length and hygiene CHECK) |
| Import batch label (strict pattern: no colon) | `erased-1` |
| Text arrays (`tags`) | `{}` |
| An identifier found INSIDE a longer text | the token `erased-1` (no colon: a reference or a URL must stay valid) |

`evidence` must keep a url or a reference (a CHECK), so nulling `url` also tombstones a missing `reference` in the same statement
(`with_set` in the registry).

`contacts` and `companies` gain an `erased_at` marker. An erased contact is archived, its personal columns can no longer be rewritten
by anyone but the erasure function, and its consent ledger stays: channel, status, basis, timestamps (the **ledger is kept, its PII
removed**: only `evidence_ref` is tombstoned). Suppression state stays too (see the open question on re-import).

### Three scopes

| Scope | Subject | What is anonymised | What is left alone |
| --- | --- | --- | --- |
| `contact` | one contact | the contact row; its ledger's `evidence_ref`; the PII text of leads and opportunities **linked to that contact** (`source`, `disqualified_reason`, `title`, `lost_reason`); then the **sweep** for the contact's e-mail, phone and name | the contact's company (decision 4), labels, scores, counts |
| `company` | one company (Owner's choice) | the company's `name`, `website`, `city`, `region`, `tags`; PII text of its leads and opportunities; claim values and evidence (url, reference, snippet) attached to the company, its leads and its claims; the four keys in its existing audit rows; then the sweep for its website host and its name | its contacts (each is its own data principal), `country`, `industry`, labels, scores |
| `tenant` | the whole workspace | **every** column registered for the `tenant` scope, in every row of the workspace, and every contact | a company's `name`, `website`, `city`, `region` (use the company scope), `country`, `industry`, labels, scores, the ledger's structure |

Evidence that is linked to the erased company *and* to something else is tombstoned entirely: it mentions the company, so it cannot stay.

### The registry and the guard (catalog-driven coverage)

`erasure.registry` (its own private schema; no client role has any privilege on it, and schema `app` stays functions only) lists, per
scope (`tenant`, `sweep`, `contact`, `company`), each column that scope anonymises, the **strategy** (`null`, `tombstone`,
`empty_array`, `substring`, `substring_array`), the replacement, extra assignments that keep a CHECK true, whether the row is `extra`
(handled on purpose although not `PII:`) and whether it is `tenant_exempt`. The existing convention (`comment on column … is 'PII: …'`,
read by the audit guards) stays the source of truth:

* a guard test **fails** when a column commented `PII:` has no registry row, when it is not wiped by the `tenant` scope (unless it is a
  `tenant_exempt` company identity column), or when a free-text one outside `contacts` has no `sweep` row;
* it also fails when a registry row names a column that does not exist, is not `PII:` and is not marked `extra`, or uses `null` on a
  NOT NULL column, `empty_array` on a non-array, or a text strategy on a non-text column;
* it also fails unless the **planter** (`tests.er_plant`) really puts a value in **every** registered column, so the canary tests below
  cannot pass vacuously: a new registry row needs a canary;
* the **tenant** scope and the **sweep** are generated from the registry (dynamic SQL over registry rows only, identifiers from our own
  table, never from a caller): adding a registry row is all it takes to cover a new column. The contact and company scopes select
  their rows with explicit SQL and take the strategy of each column from the registry;
* the **canary test** proves behaviour independently of the registry: it plants a unique canary in every registered column through the
  real write path, runs the erasure, then scans **every text, text[] and jsonb column of every table with a `tenant_id`** (not just the
  registered ones, audit log included) and requires that nothing remains except what the ADR says remains.

### The sweep

For every registered free-text column of the workspace, except the four company identity columns (a contact or company erasure must not
rewrite another business's name):

* **e-mail:** a case-insensitive exact match that does not start or end inside a longer address;
* **phone:** the last ten digits of the number, with up to two separators (space `.` `_` `(` `)` `-`) between digits, not inside a longer run of
  digits; a number of fewer than seven digits identifies nobody and is not searched; `+91 98765 43210` leaves `+91 erased-1`;
* **website host (company scope):** the host, case-insensitive, not inside a longer host; a host many businesses share (social pages,
  marketplaces, site builders: `app.is_shared_host`) identifies nobody and is not searched;
* **name:** see "The limit of names". A name shorter than three characters is not compared at all.

Another *contact* that carries the same e-mail or number in its own structured column is the same person in a duplicate record: it is
listed under review, not erased (each contact is its own request).

### The exception to immutability (trusted role + flag)

Immutable tables keep their triggers. The erasure function, and only it, can pass them. The trigger functions
(`guard_immutable_record`, `guard_consent_update`, `guard_audit_update`, `guard_erased_row`) allow a change only when all three hold:

* **(a)** `current_user = 'postgres'`: the owner of the definer functions, the same predicate as the provenance triggers (ADR 0013).
  These trigger functions are SECURITY INVOKER, so `current_user` is the role that runs the statement: a client (`authenticated`) can
  never pass it;
* **(b)** the transaction-local setting `app.erasure_request` names an `erasure_requests` row **of the same tenant** whose status is
  `executing`. Only `execute_erasure` sets that status, inside its own transaction, and the transaction ends with `executed`: a
  committed `executing` row does not exist, so no other session can ever see one;
* **(c)** the changed columns are all registered for erasure on that table (`archived_at` aside). For the audit log, the only change is
  the **removal of the four company identity keys** from `old_values` / `new_values` of a **company** row, nothing else.

`DELETE` and `TRUNCATE` stay forbidden where they already were (the ledger and the audit log have triggers; the other immutable tables
have no `DELETE` grant).

These conditions sit **behind** other layers (UPDATE privileges, RLS, column grants, a registry nobody can read, no `EXECUTE` on the
helpers). A test that hits one of those layers proves nothing about the trigger, so `43_erasure_exception.test.sql` **removes the other
layers inside its transaction** and then attacks each condition alone, with a *correct* erasure statement as the payload (so the only
thing that can refuse it is the condition under test). The first run of the mutation checks showed why: four of the trusted-role
mutations survived because a second layer hid them.

### The request log and the functions

`erasure_requests` is the log: id (chosen by the client, so retries are idempotent), tenant, scope, subject id, status (`pending`,
`executing`, `executed`, `cancelled`), who requested, when, `execute_after`, who executed, when, and a `result` holding **counts per
column and the "needs manual review" list (ids only)**. It never holds a value, a name, an e-mail or a hash of one. Owners and Admins can
read it; nobody can write it except through the functions. It is audited like any table (ids and statuses only).

| Function | Who | Does |
| --- | --- | --- |
| `request_erasure(request_id, tenant, scope, subject)` | Owner, Admin | records a pending request; `execute_after` is now for contact and company, now + 24 h for tenant; same id and payload = replay |
| `execute_erasure(request_id, dry_run)` | Owner | runs it (all or nothing, one transaction, **one erasure at a time per workspace**); `dry_run` runs everything inside a sub-transaction, returns the counts and the review list, and rolls back (rows, audit rows, status); an executed request answers with the stored result (replay) |
| `cancel_erasure(request_id)` | Owner, Admin | cancels a pending request |

Errors follow the agent functions' contract: every refusal before the caller's role in the request's tenant is proven (unknown id,
another tenant's request, wrong role, null id) is the same generic `42501` ("erasure action not permitted"); afterwards fixed states:
`22023` invalid argument, `23503` invalid reference, `23505` request id already used (the same answer for another tenant's id), `SM301`
not pending, `SM302` window not elapsed, `SM303` already executed (cannot cancel), `SM304` cancelled. No message carries a value.

### What stays, and what is outside

* **Stays:** labels and score snapshots (points and reason codes), the consent ledger's structure, ids, counts, the request log.
* **Exports already downloaded** are outside the system. The result reports how many exports were made in the workspace (`data_exports`
  records who and when, never the file), so the Owner knows what to chase.
* **Backups** keep the data until they age out (7 days on Supabase Pro daily backups, plus the PITR window if bought). After any restore,
  every executed request newer than the backup must be re-run (M3, with the restore drill); contact and company scopes re-derive their
  identifiers from the restored rows.
* **Staff accounts** (`auth.users`, `public.users.display_name`, memberships) are people who work in the system, not data principals in
  a workspace's records. Their deletion is the existing "account deletion vs last owner" checklist item. `audit_events.actor_user_id`
  and `agent_runs.started_by` are bare user ids of staff.
* **Model providers.** Nothing personal is sent today (ADR 0013 decision 11). Whatever a provider retains is outside this ADR.

### The limit of names

A name is not an identifier: "Ravi" appears in a stranger's snippet, "Sri Balaji" in a thousand company names. So a name is matched only
by **equality of a whole field** (case-insensitive, Unicode-normalised, whitespace-collapsed, at least three characters). A free-text
column that **contains** the name is **left untouched** and listed under "needs manual review" in the result. The Owner reads those rows
and decides. The system cannot find nicknames, misspellings, indirect references ("the proprietor's son"), a name inside another
business's name (those columns are not searched), or personal data in files that were never entered. **Erasure through this procedure is
therefore complete for structured data and for exact identifiers, and best-effort for free text that merely names a person.** The result
says so every time, and the Privacy page repeats it.

## Threats and required tests (full treatment)

| Threat | Control | Test |
| --- | --- | --- |
| A tenant's user erases or reads another tenant's data | every function derives the tenant from the request row; every statement filters on it; the door (b) is per tenant | foreign tenant byte-identical after every scope; direct-PostgREST attacks with another tenant's request and subject ids |
| Wrong role erases | Owner executes, Admin requests, others nothing; generic `42501` | role matrix (Owner, Admin, Sales, Viewer, anon, outsider) at function level (pgTAP), at API level, and one identical refusal body over PostgREST |
| A client forges the exception | (a) trusted role AND (b) a running request of the same tenant AND (c) registered columns only | 43: each condition attacked alone with the other layers removed |
| A new PII column is added and forgotten | the registry guard | 39: the guard fails; the canary scan fails |
| Retry / double click / concurrent execute | request id; executed = replay; one erasure per workspace at a time | idempotency tests; an execute held open while a second arrives over PostgREST |
| A half-done erasure | one transaction, all or nothing | a forced failure leaves the workspace byte-identical and the request pending |
| Accidental tenant-wide erase | 24-hour window, cancel | execute before the window: `SM302`; cancel then execute: `SM304` |
| Erased data re-entered through the erased contact or company | the erased-row guard | an update of an erased row's personal columns by an Owner is refused; the marker can be neither set nor cleared by a client |
| Values leak into messages, logs or the result | fixed messages, ids only | refusals compared byte for byte; the result and the log are scanned for the canaries; the API model has no free-form string map |

### Mutation results (all must be killed; run on the local database, the original definition restored after each)

37 mutations, **37 killed**: trusted-role predicate removed from each of the four guards (4); running-request check removed from each
(4) and from the door helper: same-tenant and `executing` conditions (2); registered-columns check removed from the immutable-record and
ledger guards (2); the audit guard's changed-columns, company-row, old-value and new-value conditions (4); erased-row immutability and
marker guard (2); tenant filter removed from the column update, the sweep's identifier update, the sweep's name update and the
tenant-scope contacts update (4) and name equality widened to containment (1); the 24-hour window removed at request and at execute (2);
Owner-only widened to Admin, request and cancel widened to Sales (3); subject tenant check removed, dry run not rolled back, replay
removed, per-workspace lock removed (4); registry rows removed or malformed (5). The lock mutation is killed only by the integration test
that holds one execute open while a second arrives.

## Open questions (for the owner; none blocks M1)

1. **Re-import after erasure.** Erasing a contact removes its e-mail, so a later import of the same address creates a new contact with no
   suppression. If the person had **opted out**, they could be contacted again. The usual remedy is a minimal, salted hash of the address
   on a suppression list kept after erasure (a hash of an e-mail is still personal data under DPDP, though far less exposed). Not built
   in M1; needed before any outreach (T012).
2. **Who is the Owner when the Owner is the data principal?** A workspace whose only Owner is the person to be erased needs the operator.
   Out of scope for M1.
3. **Retention of the request log.** It holds no personal data and is kept.
4. **A phone number shared by two people** (an office line) is swept from free text for everyone when one contact is erased; the other
   contact is listed under review. Acceptable for a family business; revisit if contacts share lines often.
5. **Whole-field vs substring for names** (decision 3) is stated, not a bug. If the first real run shows too many manual-review rows, the
   fix is a better review screen, not a looser match.
6. **Company identity in the tenant scope.** The workspace-wide erasure leaves company names and locations. A tenant that is a sole
   proprietor must run the company scope too; the Privacy page says so.

## Consequences

* Real data can enter only after M1 (this), M2 (gate, hosting), and the restore drill; the erasure function is the first prerequisite
  recorded by the gate.
* Every future table with a `PII:` column must add registry rows and a canary seeder, or the build fails.
* The immutable tables remain immutable for everyone but this function, under three conditions that are each tested alone.
* A company's rename history no longer shows the names (audit by field name only).
