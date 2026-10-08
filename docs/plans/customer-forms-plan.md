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

**Links:** the tenant home page gets "Add a customer →" (Owner, Admin, Sales) and "Add a product →" (Owner, Admin) in the same row as the K1 link. The consent screen is reached from the result of "Add a customer" (a link to the new person's consent page). **A link from the Contacts tab was planned and dropped**: an existing test pins "the other tables have no detail links" (`page.test.tsx`, contacts, products, opportunities), and an existing test must not change in this ticket. For a contact that was not made on this screen, the consent page is reached by its address; a link from the lead page or a change to that test needs the owner's decision.

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

New: `apps/web/lib/api/customers.ts`, `consent.ts`, `products.ts` (with tests); `apps/web/app/app/tenants/[tenantId]/customers/new/`, `contacts/[contactId]/consent/`, `products/new/` (page, actions, form, tests). Changed: the tenant home page and its test (the two links). The pre-pilot checklist is not touched in this ticket. Not touched: any API file, migration, RLS, SECURITY DEFINER function, `followup_cadence`, `package.json`, the lockfile, any design-v2 file.

## 7. Stop conditions

Stop and report if: a migration or a new endpoint turns out to be needed; an existing test must change; a dependency is needed; anything needs real data.


## Findings from the intake review (2026-10-08)

Method: read-only. No code was changed for this section, no website was called, and nothing was run against a live stack for it (the STEP 0 probes of section 1 are cited where they apply). Files are as on `web/customer-forms` (based on `origin/main` at `01d4d77`). Anything I could not prove is marked **UNVERIFIED**.

### a. Phone numbers: normalisation, storage, the suppression key

* **The API does not normalise a phone number.** The type is "trim, 3 to 32 characters" (`services/ai-api/app/crm/models.py:66`) and the string is passed on as typed. The database stores exactly that: `char_length(phone) between 3 and 32`, no format rule (`supabase/migrations/20261005100100_t003_crm_core.sql:141`). While a workspace is closed to real data, a trigger requires the prefix `+00` (`app.guard_real_data`, `20261012090100_t006b_m2_review_fixes.sql`).
* **The suppression key does normalise, and only for the hash.** `normalise_phone` (`services/ai-api/app/suppression/keys.py:36-47`): Unicode NFKC; every non-digit is dropped (spaces, brackets, dots, hyphens, the plus); a leading `00` is dropped; a 12-digit number starting `91` loses the `91`; an 11-digit number starting `0` loses the `0`; leading zeros are stripped; it is kept only if it has 3 to 32 digits. The key is `HMAC-SHA256(key, "phone:" + digits)` (module docstring, lines 1-10). The test `test_one_indian_mobile_written_ten_ways_is_one_number` (`services/ai-api/tests/test_suppression_keys.py:58-74`) lists ten spellings of one mobile, including `+91 98765 43210`, `919876543210`, `098765-43210`, `(98765) 43210` and `9876543210`, and expects `9876543210` for all. A number of another country keeps its digits unchanged (the next test, line 76 onward).
* **The same number typed two ways** creates two contacts (nothing forbids it, see b), two different stored strings, and **one shared key**. `suppression.contact_keys` has `unique (tenant_id, contact_id)` and only a non-unique index on `(tenant_id, phone_hmac)` (`20261018090000_t010_suppression_keys.sql:49,53`), so two contacts can hold the same key. Suppression and the follow-up gate work by key, so suppressing one of them blocks the other (`app.followup_gate`, `20261024090000_t010_part2_followups.sql:445-461`).
* **UNVERIFIED:** I did not run two spellings through the API or the database for this section; the statements above come from the code and the tests. The batch import does not compare phones at all (it matches a contact by e-mail only, `20261011090000_t006b_real_data_gate.sql:454`).

### b. Is there a duplicate check for a contact?

* **E-mail: yes, in the database.** `contacts_tenant_email_key` is a unique index on `(tenant_id, lower(email))` where the e-mail is not null (`20261005100100_t003_crm_core.sql:161`). A duplicate becomes `DuplicateValueError` (`services/ai-api/app/crm/repository.py:151,177-179`) and the API answers **409 `duplicate_value`, "That email is already used."** (`services/ai-api/app/main.py:348-351`). An exact retry of the same id and body is a replay (200) (`crm/repository.py:340-362`); the same id with a different body is the generic 409 `conflict`.
* **Phone and name: no check at all.** There is no unique constraint on `phone` or `full_name`, and the contact endpoint makes no lookup. Nothing in the constraints refuses a second contact with the same phone. STEP 0 also showed a second lead for the same contact is allowed (section 1). **UNVERIFIED live:** I did not create two contacts with one phone in this review; this is from the constraints.
* **Key collision with a suppressed key:** a contact that arrives with a key that is already suppressed is flagged by the database and the API returns the fresh row (`services/ai-api/app/crm/routes.py:102-113`). The Contacts tab shows the "Suppressed" column; the add-a-customer screen says nothing about it.
* **What the person sees on a duplicate, on this branch (a finding):** `customers/new/actions.ts` gives a special sentence only for `real_data_gate_closed`; every other 409, including `duplicate_value`, becomes "This form was already used. Reload the page and try again." That is the wrong sentence for a duplicate e-mail, and by then the company has already been created (the retry is safe because the ids are fixed, but the person is not told what is wrong). A plain sentence for `duplicate_value` is a small follow-up; I did not change it.

### c. The `wa.me` link

* **There is no `wa.me` link in the code.** I searched `apps/web/app`, `apps/web/lib`, `tests/` and `docs/plans/followups-whatsapp.md`: no match. The only `encodeURIComponent` uses are for cursors and ids (`apps/web/app/app/tenants/[tenantId]/page.tsx:238,301,392`, `evidence-panel.tsx:72`). The link is a planned item (`docs/plans/customer-zero-intake-gap.md`, section 12, on its own branch); nothing encodes a quote text today.
* **What bounds the text** (the encoding itself is not defined in code): the quote text comes from the pinned renderer, lines of at most 60 characters, at most 30 items, at most 500 output lines (`packages/pure/quote_text/__init__.py:10-14`). Encoded as a URL component, the rupee sign is 3 UTF-8 bytes = 9 characters (`%E2%82%B9`), a newline is `%0A`, a space is `%20`. Computed with Python's `urllib.parse.quote` (same result as `encodeURIComponent` for these characters): the synthetic two-item quote text of the intake-gap document is 721 characters, 761 bytes, 35 lines, **1,185 characters encoded**. The renderer's own worst case (500 lines of 60 rupee signs) would be 30,500 characters, 271,500 encoded; not a realistic quote.
* **Length limit: none in the code or in any test** (no test mentions `wa.me`). **UNVERIFIED:** any limit that WhatsApp, a browser or a proxy puts on the length of the `text` parameter. I did not look it up (no website was called); the plan should either test it by hand on a phone or avoid the question with the short text variant.

### d. Can a lead touch carry a short typed note?

* **No.** `RecordTouchIn` has only `id`, `direction`, `channel` and `occurred_at` (`services/ai-api/app/followups/models.py:44-51`), and `_Strict` forbids any other field (`services/ai-api/app/crm/models.py:75-76`). The table `lead_touches` has no text column (`20261024090000_t010_part2_followups.sql:256-267`). So there are no length rules for a note; the only rules are the time rules (not after the database's now, at most 7 days back, not before the lead existed, an outgoing touch not before the latest outgoing one: `public.record_touch`, same file, line 853 onward).
* **Nearest fields that hold typed text:** a lead's evidence note, snippet 1 to 1,000 characters after trimming, cleaned (`services/ai-api/app/evidence/models.py:74-77`); a pasted enquiry, text 1 to 200,000 characters and subject up to 2,000, with e-mail addresses and mobile numbers removed (`services/ai-api/app/enquiries/models.py:37-47`; web `enquiries/actions.ts:25-26`); a requirement field value, 1 to 120 characters (`enquiries/models.py`, `AddFieldIn`).

### e. Is the number of Owners capped?

* **No cap exists in the code I read.** The only Owner-count rule in the migrations is `app.protect_last_owner` (`20261004120000_t002_tenancy_schema.sql:139-175`): it refuses to remove or demote the **last** Owner (a minimum of one). Row-level security lets an Owner insert or change any membership role, including `owner` (`20261004120200_t002_rls_policies.sql:106-150`), behind the second-factor trigger (`20261012090000_t006b_mfa_aal2.sql:48`). The operator function `app.operator_add_owner_exception` has no count check (`20261012090100_t006b_m2_review_fixes.sql:75-103`).
* `docs/plans/members-and-invitations.md:50` says "the cap of 3 Owners lives in that operator function". That is a **plan** statement; the function does not do it. With two Owners nothing stops a third. **UNVERIFIED:** migrations on other branches, and live behaviour (not run).

### f. Why does a test pin "no detail links in the contacts table"?

* The test is `it("the other tables have no detail links")` in `apps/web/app/app/tenants/[tenantId]/page.test.tsx`: for the contacts, products and opportunities tabs, the table must contain no link.
* **History:** it was added in commit `5b26454` (2026-10-04, "T004 (3): company and lead evidence pages (plain text), add-evidence form, make seed-demo, guards, ADR 0009") together with the two detail pages. The commit message has no body and the test has no comment. `git log -S` on the test's name finds only that commit, so its text has not changed since; the file was edited later by other commits for other tests.
* **The reason, as written down** (ADR 0009, `docs/adr/0009-web-evidence-pages-and-demo-seed.md`, Decision 1): "**Two detail pages**, server-rendered, under `/app/tenants/[tenantId]/`: `companies/[companyId]` and `leads/[leadId]` ... The company name and the lead status on the existing tenant page link to them (the link target is built from the row id only)." So the test pins the ADR's scope: only companies and leads have detail pages, therefore only they link. The ADR does not say a link may never be added to another table; it records what was built then.
* **UNVERIFIED:** whether the authors meant it as a deliberate guard against links in PII tables (contacts hold names, e-mails, phones). No text says so. **I did not change the test; the owner decides.** Ways to a consent link without touching it: amend ADR 0009 and the test together, or link from the lead page or from the add-a-customer result (the latter exists).

### Observations from Job 1 (not changed)

* The consent form's **channel** select started on WhatsApp. **Resolved afterwards:** it now starts with nothing chosen and is required, like the status, the basis and the evidence kind.
