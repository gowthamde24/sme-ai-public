# ADR 0019: Quote integration: reference data, recomputation, approval (T009)

Status: accepted for the local-first stage (owner review of migration parts 1 and 2 and of the mapper adapter, 2026-10-06; plan: `docs/plans/t009-quote-integration.md`).
Related: ADR 0013 (agents; option A / option B), ADR 0016 (second factor), ADR 0018 (enquiries and requirements; the lock order), `docs/plans/t009-quote-engine.md`
(lane C's pure engine), `docs/plans/requirement-mapper.md`, `docs/plans/quote-text.md`.

## Context
After a person has confirmed a requirement (ADR 0018) the product needs a DRAFT quote an Owner or Admin can approve. The arithmetic is lane C's pure engine
(`packages/quote-engine`); the mapper (`packages/pure/requirement_mapper`) only proposes which catalog product a line means. Lane A owns everything that makes the result
authoritative: the prices, the policy, who may do what, provenance, audit, and what the database will and will not believe. Nothing is ever sent: approving a quote creates no
order, takes no payment and contacts nobody. A person copies the approved text into WhatsApp or e-mail.

## Decisions
**1. Reference data are immutable versions.** `price_lists` / `price_list_versions` / `price_list_items` / `price_list_breaks`, `quote_policy_versions`, `mapper_config_versions` and the
allow-list `quote_engine_versions` are created WHOLE by one definer function and never edited or deleted (UPDATE and DELETE are refused for every role, the migration owner included).
A correction is a new version. "Active at a date" is the latest version effective on or before it (ties: the higher number); a new version may not be effective before today
(Asia/Kolkata) or before the latest one. Publishing is Owner or Admin and needs aal2, proven AFTER the role (a stranger, Sales and an unknown tenant get the same 42501, so the
second factor is no oracle). A Viewer reads none of the prices, policies or quotes (owner decision 1). No client writes any of these tables. The shipped numbers are SYNTHETIC; no tax
advice is in code or docs (rates, slabs, advance, validity, credit and freight are the owner's and the accountant's inputs).

**2. A person confirms every product.** `requirement_line_picks` holds the person's choice per requirement line (`manual`, or `mapper_suggestion` with the mapper output's hash). The
mapper adapter (`app/quotes/mapper_port.py`) sends only the line rows (never the delivery city), supplies an explicit sale unit for every product, and returns suggestions; it never picks.
The same product on two lines of one requirement is refused in v1 (the engine takes one quantity per sku).

**3. The database recomputes the v1 subset and refuses anything else (SM216).** The API runs the pinned engine with the caller's token and sends `create_quote_draft` the canonical
request and the engine's result. For the v1 subset (tax-EXCLUSIVE, NO discounts, no margin: the policy table cannot say anything else) `app.quote_build` rebuilds from the database's own
sources the request, every figure (lines, totals, advance, balance, due and validity dates) and the flags. The request must equal the database's byte for byte (as JSON) and its hash
(`sha256` of `{"engine_version","inputs"}`) must equal the engine's; the result must equal the database's recomputation; the flags must be exactly the derived ones. Anything outside the
subset (a discount, a margin, tax-inclusive mode, a second shipping rate, a key nobody knows) is refused, never approximated. `approve_quote` rebuilds from the quote's recorded versions
and the CURRENT picks: a moved pick, a newer price list or policy, an unconfirmed requirement or an expired quote makes it stale (SM215). A property test runs the REAL engine on random
inputs (every rounding mode, quantity breaks, free-shipping thresholds, taxed freight, both customer kinds, credit limits, half-paise ties) and requires the database to accept every result.
The review flags (the customer stated payment terms: `TERMS_REQUESTED_BY_CUSTOMER`; mixed GST rates with freight charged: `MIXED_GST_RATES_SHIPPING`; a repeat customer claimed:
`REPEAT_CUSTOMER_CLAIMED`) are derived by the database, never taken from the payload, and make `needs_owner_approval` true like the engine flags.

**4. One lock order.** Every writer of an enquiry's requirement state locks the ENQUIRY row first, then the requirement row, then the quote row (ADR 0018 decision 9). `discard_requirement`
takes the same order and refuses with SM212 while a draft OR an approved quote depends on the requirement. Quote numbers are the tenant's next under an advisory lock taken after those row
locks. Sorting by sku uses the "C" collation (code point) everywhere, because the engine and the API sort by code point.

**5. Who may do what.** Sales, Admin and Owner pick and create drafts (aal1). Owner and Admin approve and reject (aal2 to approve); the Owner alone approves a flagged quote (SM218 tells an Admin so);
Sales may only withdraw their own draft. Owner or Admin may withdraw an approved quote (aal2). SQLSTATEs SM212 to SM218, mapped to fixed API messages; nothing from the database reaches a client.

**6. Withdrawing an approved quote** keeps the status set unchanged: the quote moves approved to `superseded` with `withdrawn_by`, `withdrawn_at` and a reason code recorded once (the guard trigger
and the table checks enforce it). A later order conversion must refuse a withdrawal once an order exists (docs/plans/order-conversion.md).

## What the database proves, and what it trusts (the honest limits)
* It binds the stored request text to the engine's hash and makes every input equal its authoritative source; it recomputes every figure of the v1 subset and the flags. It does NOT run the
  engine: two implementations of the arithmetic exist (the engine's and the SQL), kept equal by the property test against the real engine, and a new engine version needs a migration
  that adds it to `quote_engine_versions`. The engine's rule trace is explanatory text; it is stored as given and NOT verified.
* **An Owner (or Admin) who calls `approve_quote` directly, skipping the API, is trusted** (the ADR 0013 option A limit): the database cannot tell that the API re-ran the engine for the approver.
* **A signing service principal (option B) is required before any external customer, any scheduled step or any automatic approval:** a dedicated principal whose key signs the engine result,
  so that the database can require a signature instead of trusting the caller. Until then the approval is a person's act, audited with the actor.
* The delivery state is the person's word (the API validates it against the real list of state and union-territory codes). The repeat credit limit is one policy number, not a per-customer limit.
* No personal data is stored in the quote tables (the delivery city is read from the requirement at display time); nothing is registered for erasure and the erasure functions are tested on a
  tenant with an approved quote.

## Consequences
* A price or policy change needs a new version and a new draft; an open draft made on an older version cannot be approved (SM215).
* The Prices and Policy pages are NOT built in T009 (a seed script loads synthetic data); the CSV import is a pre-pilot checklist row.
* The web shows the requirement lines that were NOT quoted; the approved quote text (lane C's renderer, called with the hash of the stored approved row) is for a person to copy.
