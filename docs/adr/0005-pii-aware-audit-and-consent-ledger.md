# ADR 0005: PII-aware audit, consent ledger, and erasure by anonymisation (T003, milestone 1b)

Status: accepted for milestone 1b. Builds on ADR 0001 (tenancy/audit) and ADR 0004 (policy pattern).
Migrations: `20261005100000_t003_audit_pii_aware.sql`, `20261005100100_t003_crm_core.sql`,
`20261005100200_t003_consent.sql`.

## 1. The audit trail must never hold personal data

`audit_events` is permanent and append-only. CRM tables hold personal data (contacts, free text). A
permanent, immutable log of personal data cannot honour an erasure request, so the log must not
contain it in the first place.

Options considered (recorded so the trade-off is not lost):

| Option | Audit row holds | Why not / why |
| --- | --- | --- |
| A. Field names only | names of changed PII fields | **Chosen (as a hybrid).** Nothing personal is stored, so erasure never has to touch the log. Cost: no "what was the old phone number" forensics. |
| B. Masked values | `a***@gmail.com` | Still personal data; false comfort. |
| C. Keyed hash | HMAC per tenant | Needs key management; low-entropy values brute-forceable if the key leaks. |
| D. Erasable side table | full values | A second table and an exception to append-only. Revisit only if Customer Zero needs value-level forensics. |

**Decision (A-hybrid).** `app.audit_row_change(entity, pii_columns)`:
- PII columns are removed from `old_values` and `new_values` and recorded **by name only** in
  `metadata.pii_fields_changed` (on create: the PII fields that were set; on update: those that
  changed; on delete: those that were set).
- Every other column keeps its before/after values exactly as in T002 (company names, consent
  status, opportunity status, ...). A change that touches only a PII column is still recorded.
- The T002 triggers on `tenants` and `memberships` pass no list and behave exactly as before
  (`metadata` stays `{}`); existing rows are untouched.

**Classification is mandatory and enforced.** Every `text`, `text[]` or `jsonb` column of an audited
table carries a comment `PII: ...` or `SAFE: ...`. **Free text is PII unless someone argues otherwise
in the comment** (notes, titles, reasons, descriptions, tags, lead source). Company names, SKUs,
geography and similar business data are `SAFE`; `products.attributes` is `SAFE` only because it is a
size-capped (4 KB) structured spec and must never hold personal data. Guards fail if a column is
unclassified, if a `PII:` column is missing from its trigger list, or if the list names a column that
is not marked PII, and if any tenant-owned table lacks an audit trigger.

Proof: a test creates, updates (including title-only) and deletes contacts, then scans every
`audit_events` row as text for the names, e-mails, phone numbers and titles it used; there are none.
Mutation: letting `audit_row_change` stop stripping makes six assertions fail.

## 2. Consent and suppression

- `contacts` holds the CURRENT state: `email_consent`, `whatsapp_consent`, `phone_consent`
  (`unknown | granted | withdrawn`) and `suppressed_at` / `suppression_reason`. **No client grant
  covers any of these columns** (a guard asserts it for INSERT and UPDATE).
- Three `SECURITY DEFINER` functions (`search_path = ''`) are the only writers, each checking the
  caller's role with the one-row helper **in the stated tenant**, locking the contact **by id AND
  tenant** ("not found" otherwise, whether it is absent or foreign), updating the state, and appending
  a ledger row in the same transaction:
  - `record_consent` (Sales+): grant or withdraw per channel. Granting requires a basis, an evidence
    type and an evidence reference.
  - `suppress_contact` (Sales+): do-not-contact, any channel.
  - `lift_suppression` (**Admin+ only**): evidence mandatory.
  All are idempotent: repeating the current state returns the existing ledger row id and writes
  nothing. All three reject NULL arguments explicitly (`22023`), so an omitted channel can never fall
  through to a default branch.
- **An opt-out must not leave consent behind (1c, R1).** `suppress_contact` with reason `opted_out`,
  `complained` or `legal` also sets every `granted` channel to `withdrawn` in the same transaction,
  with one `withdrawn` ledger row per changed channel (channels that were `unknown` or already
  `withdrawn` are untouched). `lift_suppression` only clears the suppression flags: consent that was
  withdrawn stays withdrawn, so `can_contact` stays false until a fresh `record_consent` grant. The
  reasons `bounced` and `manual` keep the earlier behaviour (suppress only; lifting restores
  contactability because consent was never withdrawn). A withdrawing reason arriving later upgrades a
  `bounced`/`manual` suppression; a weaker reason never downgrades.
- `consent_events` is **append-only** (UPDATE, DELETE and TRUNCATE are blocked by trigger, for every
  role including the owner; clients have no write grant at all). It contains **no personal data**:
  ids, enums, and `evidence_ref`, a typed opaque reference `<kind>:<token>` (pattern
  `^[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}$`, e.g. `form:8841`, `ticket:2201`) to evidence
  stored elsewhere. The format makes accidental personal data unlikely (no spaces, no `@`, a
  mandatory kind); it **does not prevent** it, and the comment on the column says so. There is deliberately **no free-text evidence
  note**: free text would defeat a PII-free ledger. `evidence_ref` is still classified `PII:` so it is
  never copied into `audit_events` by value (the ledger itself is the record).
- `app.can_contact(contact, channel)` is the single read-only gate future outreach must call:
  consent granted for that channel, contact has an address of that kind, not suppressed, not
  archived. It is `SECURITY INVOKER`: it reads through RLS, so a caller asking about another
  tenant's contact gets `false`. **Nothing in this repository sends anything.**
- The basis list (`explicit_consent`, `contractual`, `legitimate_use`, `other`) is provisional. The
  whole model has **not** had India-qualified legal review (pre-pilot checklist).

## 3. Erasure = anonymise in place, never a hard delete

- Clients have no DELETE on any CRM table. "Delete" is `archived_at` (Admin/Owner only, enforced by a
  trigger so it holds for every write path).
- A contact with consent history cannot be hard-deleted: the ledger's composite FK
  `(tenant_id, contact_id)` is `NO ACTION`. This is intentional: the ledger is legal evidence of
  consent and survives the person.
- The erasure workflow (a hard gate before T012, see the checklist) will therefore **anonymise in
  place**: overwrite the contact's PII columns (and free-text fields that may mention the person)
  with fixed placeholders, keep ids, consent state and the ledger, and record the action in the audit
  trail by field name. Because the audit trail never held the values, it needs no rewrite.
- **`consent_events.evidence_ref` is erased by tombstone.** A reference may still point at something
  person-linked, so the erasure procedure overwrites it with a tombstone that satisfies the same
  pattern (e.g. `erased:1`) through a **controlled exception to append-only**: a single privileged,
  audited function that is the only code allowed to bypass the ledger's UPDATE trigger, touching
  `evidence_ref` and nothing else. That exception does not exist yet; it is part of the pre-T012 gate.

## 4. Cross-tenant references

Every reference between tenant-owned rows is a composite FK `(tenant_id, parent_id) -> parent
(tenant_id, id)`, because the database checks foreign keys without applying RLS: a plain `parent_id`
would accept another tenant's row. Consequences verified by tests (privileged and as a tenant owner):
a foreign id and a nonexistent id fail with the same error (no existence leak); a lead/opportunity's
contact must belong to the same company (three-column key; a contact without a company cannot be
linked); owners must be members of the same tenant (`ON DELETE SET NULL (owner_user_id)`, which can
never null `tenant_id`); nothing cascades.

## 5. Other decisions

- `created_by` / `created_via` are set by a trigger from `auth.uid()` and cannot be supplied or
  changed by a client. Signed-in clients are always `manual`; trusted server code (not the
  `authenticated` / `anon` roles) may declare `import` or `agent` with `set local app.created_via`.
  **Rule for future code:** the trigger decides by `current_user`. Inside a `SECURITY DEFINER`
  function `current_user` is the function owner, not `authenticated`, so such a function inherits the
  GUC (default `manual`). Any future SECURITY DEFINER code that inserts CRM rows must therefore set
  `app.created_via` explicitly, never rely on the default.
- Leads and opportunities cannot be inserted with a chosen status (no INSERT grant on `status`):
  records start `new` / `open`; `status` stays updatable under the usual rules (1c, R3).
- Opportunities: `won` / `lost` are terminal, `lost` needs a reason, `closed_at` is server-owned,
  reopening is Admin+. There are no price columns anywhere (CLAUDE.md #4) and no pipeline stages or
  value estimate yet (deferred).
- A generic test (`11_generic_tenant_tables.test.sql`) drives every tenant-owned table from the
  catalog through `tests.role_matrix`: allowed and denied select/insert/update/delete for each role,
  cross-tenant in both directions, anon, and a user with no tenant. An unregistered tenant-owned table
  is a failing guard, so future tickets cannot skip it.

## Known limits

- Value-level forensics for PII columns are not possible (by design); revisit option D only with a
  concrete need.
- `contacts` email uniqueness covers archived rows too (unarchiving can never collide); re-creating an
  archived contact's address needs the archived row anonymised or its email changed.
- `memberships.user_id -> users ON DELETE CASCADE` remains the one deliberate cascade (account
  deletion; blocked for a sole Owner by the last-owner rule, ADR 0001 #2). The guard exempts it
  explicitly because `users` is not tenant-owned.
- Terminal opportunities are not frozen apart from their status; other columns remain editable.
- The consent model, the basis list and the retention of the ledger are not legally reviewed.
- The controlled append-only exception for the evidence tombstone is specified here but not built.
- Moving a contact to another company is refused while a lead/opportunity links that pair.
