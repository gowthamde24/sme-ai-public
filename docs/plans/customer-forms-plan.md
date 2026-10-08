# Plan: the customer forms (add a customer, record consent, add a product)

Status: **BUILD PLAN, written before the build (2026-10-08), branch `web/customer-forms` from `origin/main` at `01d4d77`.** Web only: no migration, no API change, no new dependency. Source: `docs/plans/customer-zero-intake-gap.md` (ranked items 1 to 3), phase 1 of milestone v0.

## 1. STEP 0 findings (proved on the local stack, synthetic users, the existing API only)

The probe was a throwaway test run through the integration harness (public key only, real sign-ups, real second-factor sessions); it is not committed. It printed a status and a closed error code for each call.

| Question | Result |
| --- | --- |
| Phone-only contact | **Works.** `POST /contacts` with a name and a phone and no e-mail: 201 (Owner, Admin, Sales; Viewer 403). A lead for it: 201. An exact retry of either (same id and body) is 200, a replay. A second lead for the same contact is allowed (no duplicate guard). A lead that names a contact but no company is 422 (`validation_error`). A phone shorter than 3 characters is 422 |
| Where `contact_requires_email` applies | **The batch import only.** `POST /leads/import/preview` with a phone-only row: `rejected`, `contact_requires_email` (the database function `import_lead_rows`). It is not in the contact or lead endpoints |
| The real-data gate | While the workspace is closed, a phone without the `+00` prefix or an e-mail outside the reserved domains is 409 `real_data_gate_closed`. The screens say so in our own words |
| Suppression key | A contact made through the API is keyed on creation: the unkeyed count stayed 0 before and after (the key ring was configured with the harness's synthetic key) |
| Consent | `POST /contacts/{id}/record-consent`: Owner, Admin or Sales (Viewer 403). **No second factor is required** (an Owner on a password-only session got 200). `granted` needs a basis and an evidence type plus a reference of the shape `kind:token` (letters, digits, `. _ # / -`, no spaces), else 422; `withdrawn` needs neither; `unknown` is refused. The answer is `{event_id, contact}`. There is **no endpoint to read the consent history**, so a screen can show the current state but not who recorded earlier entries and when |
| Effect on the follow-up gate | An outgoing touch before consent: 409 `contact_blocked`; after a `granted` WhatsApp consent: 201; after `withdrawn` on the phone channel: 409 `contact_blocked` |
| Products | `POST /products`: **Admin or Owner** (Sales 403); no second factor needed |
| Price list | `POST /price-lists/import/preview` and `/import`: Owner or Admin **with the second factor** (a password-only session is 403 `mfa_required`; Sales 403). Unchanged, on the existing price-list page |
| Discounts and flagged quotes (item 3) | The engine takes a per-line `discount_bps` up to the policy's `discount_ceiling_bps` (`packages/quote-engine/src/quote_engine/__init__.py`, `docs/plans/t009-quote-engine.md`), but the API builder sends no discount (`services/ai-api/app/quotes/builder.py:8`, "with no discount") and the database refuses anything outside the v1 subset (`supabase/migrations/20261016090100_t009_picks_and_quotes.sql` header: "a discount, a margin, tax-inclusive mode, a second shipping rate is REFUSED"). The only flag paths in v1 are `BELOW_MINIMUM_ORDER_QUANTITY` and `CREDIT_LIMIT_EXCEEDED` (engine flags) and the database's review flags `TERMS_REQUESTED_BY_CUSTOMER` and `MIXED_GST_RATES_SHIPPING`; a flagged quote needs the Owner's approval (SM218). Nothing is built for any of it |

**No STOP condition was met:** a phone-only contact and a consent record need no migration and no new endpoint.

## 2. Item c (the product form): kept, and why

You asked to drop item c unless the quote path needs a saree-type reference. **It does**: a requirement line is priced only through a **catalog product** picked by a person (`PickIn.product_id`), `quote_lines.product_id` is `not null` (`20261016090100_t009_picks_and_quotes.sql:190`), and the builder refuses a line whose product is not on the price list (`MissingInput`). No screen creates a product today. So the form is built as the smallest version: **a saree type with a code, a name, a unit and an optional category**. It does **not** add a price-list entry: the prices are typed by the owners for each quote (the manual-price quote plan, next), and loading prices stays on the existing price-list page (Owner or Admin, second factor). The code is checked to the price-list file's own rule (letters, digits, dot, underscore, hyphen, at most 40) so that every product can be on a price list later. If the manual-price quote design removes the need for a catalog product, this form is still the way to keep a list of saree types.

## 3. The three screens (plain, existing conventions; no design v2)

| Screen | Path | Who | What it does |
| --- | --- | --- | --- |
| Add a customer | `/app/tenants/{id}/customers/new` | Owner, Admin, Sales (others see a notice) | creates a company, a contact and a lead in that order through `POST /companies`, `/contacts`, `/leads` |
| Record consent | `/app/tenants/{id}/contacts/{contactId}/consent` | Owner, Admin, Sales | `POST /contacts/{id}/record-consent` for one channel |
| Add a product | `/app/tenants/{id}/products/new` | Owner, Admin | `POST /products` |

**Add a customer, fields:** the person's name (required, 200 at most); the shop or business name (optional; if empty the person's name is used, because a lead with a contact needs a company); the WhatsApp or phone number (required, 3 to 32 characters); an e-mail (optional); how the enquiry came (Phone call or WhatsApp, stored as the lead's source `phone_call` or `whatsapp`). The three row ids come from the page (one set per render), so pressing twice is a retry: the API replays an identical request. If one step fails after another succeeded, pressing again finishes the rest and duplicates nothing. After success the screen shows what was made and two links: **Record consent for this person** and **Open the lead**; and it says plainly: "No consent is recorded yet, so you cannot record that you contacted them." The form does not look for a customer you already added.

**Record consent, fields:** channel (WhatsApp, Phone call, E-mail); what you are recording (Granted or Withdrawn, as the API names them); for Granted: the basis (Explicit consent, Contractual, Legitimate use, Other, as the API names them), the kind of evidence (Spoken, Written, E-mail reply, Web form, Other) and a short label (letters, digits, `. _ # / -`; the screen builds the reference `kind:label`). The page shows the person's name and the three current states, never the number or the address. **After recording, the screen says**: "Recorded by [your sign-in] at [time] (the time this screen sent it). The system keeps this in the consent history." and nothing that sounds like a verdict: the page says "This only writes down what you tell us. It does not check it and it is not legal advice." There is no word such as valid, lawful or compliant anywhere. Showing the earlier history needs a new read endpoint: listed as a follow-up, not built.

**Add a product, fields:** code (required, price-list rule), name (required, 200 at most), unit (Piece or Set, the two sale units the quote path knows), category (optional, 64 at most). 409 means the code is already used (or the form was used for another product).

**Links:** the tenant home page gets "Add a customer →" (Owner, Admin, Sales) and "Add a product →" (Owner, Admin) in the same row as the K1 link; the contact's name in the Contacts tab links to its consent page.

## 4. States and errors

Every failure is one short sentence of our own; a raw API body, a submitted value, a phone number or an address is never echoed or logged. Mapping: rejected session to sign-in; 403 "Your role cannot do this."; 404 "This workspace or person is not available."; 409 `real_data_gate_closed` "This workspace does not accept real phone numbers or e-mail addresses yet. Use a number that starts with +00 and an e-mail that ends in .test."; other 409 "This form was already used. Reload the page and try again."; 422 "Check the values and try again."; 503 or anything else "Could not save. Try again." The role buttons are a convenience; the API and the database decide.

## 5. Tests and checks

* Library: strict parsers, the exact requests (paths, methods, bodies), malformed ids refused before any request.
* Actions: authenticate first; the three calls in order with the page's ids; an idempotent retry; a failure after the first success reports an honest partial state; each error code to its sentence; a canary in a thrown error never reaches the result; refusals before the API (empty name, short phone, bad evidence label).
* Pages: roles (a Viewer or the wrong role gets a notice and no API call), not found, sign-in redirect, outage.
* Forms: the visible states; the consent screen's wording (no legal word; who and when after a record).
* Home: the links appear for the right roles only.
* Per commit: `make check-fast` and the touched vitest files. **The consent commit runs the full `make check`**, as does any commit touching permissions, consent or suppression. At the end, once: the web set with npm 10.9.2 (lint, typecheck, test, build) and a full `make check` from a clean `make db-reset`.

## 6. Files touched

New: `apps/web/lib/api/customers.ts`, `consent.ts`, `products.ts` (with tests); `apps/web/app/app/tenants/[tenantId]/customers/new/`, `contacts/[contactId]/consent/`, `products/new/` (page, actions, form, tests). Changed: the tenant home page and its test (links), `docs/pre-pilot-checklist.md` (status). Not touched: any API file, migration, RLS, SECURITY DEFINER function, `followup_cadence`, `package.json`, the lockfile, any design-v2 file.

## 7. Stop conditions

Stop and report if: a migration or a new endpoint turns out to be needed; an existing test must change; a dependency is needed; anything needs real data.
