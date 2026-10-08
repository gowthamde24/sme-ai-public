# Customer Zero: the intake gap (what the family's real habits need that the code does not yet do)

Status: **ANALYSIS ONLY. No code, migration, test or dependency was written or changed.** Written 2026-10-08 on the branch `docs/customer-zero-intake-gap`, from `origin/main` at `3578252` (PR #10). Every statement below was read from the code on that commit; file paths are the evidence. Nothing was run against a live stack and no screen was clicked, so a "click count" is counted from the code. Anything not verified is marked **NOT VERIFIED**.

Sizes: **S** = web only, existing endpoints, about a day. **M** = a new endpoint or one migration with its tests, a few days. **L** = new tables or a new pure package, an ADR, more than a week. These are my estimates, not measurements.

## 0. The facts from the family (owner-reported, 2026-10-08)

* Customer Zero is a silk-saree wholesale. One to two enquiries **a day**, by phone call and WhatsApp.
* Customers exist **only as contacts in a phone**. There is no written price list: the owners remember prices by saree type.
* They **never chase** a customer who has not replied. Forgetting follow-ups is the most frequent mistake. Advances are written in handwritten books.
* Two people, **both Owners**. GST and freight apply; whether they are added on top or included is **not known yet** (settled later the same day: GST is added on top and courier is a separate line, see section 8).
* The plan: the family has no organised documents, so the **first setup is assisted** (the owner sits with them). Later they update information by talking to an agent (the Capture Agent, C-W5: it only proposes, a person approves, the database re-checks).

## 1. One lead and one touch through the web screens

**What the web can write today** (every server action: `grep "export async function .*Action" apps/web/app`): create a company, import leads, label a lead, paste an enquiry, add evidence, record a touch, ask for a follow-up draft, load a price list, and the quote, order, policy and privacy screens. **There is no "new contact" form, no "new lead" form and no "new product" form.** The API has them (`services/ai-api/app/crm/routes.py:70-74`: companies, contacts, leads, opportunities by Sales or above; products by Admin or above) but nothing in the web calls the contact, lead or product endpoints (`apps/web/lib/api/crm.ts` reads them only).

**To get one lead in, by web only:** the Review page's "Import Candidate Leads" (`apps/web/app/app/tenants/[tenantId]/review/import-leads-form.tsx`). The person types or pastes a **JSON array** (a sample template is one click away), presses "Preview (Dry Run)" and then "Commit Import". About five interactions plus hand-written JSON. The required field is `company_name`; the contact fields are `contact_name`, `contact_email`, `contact_phone`, `contact_job_title`. The preview table shows the outcome of only the first ten rows (`slice(0, 10)`), plus the counts.

**The decisive rule:** a contact is accepted **only together with an e-mail**; a row with a name and a phone but no e-mail is **refused whole** with `contact_requires_email` (`supabase/migrations/20261011090000_t006b_real_data_gate.sql:375`). The family has phone numbers, not e-mails. A company-only lead (no contact) is accepted.

**Closed real-data gate:** while the workspace is closed, a contact's e-mail must be on a reserved domain (`example.test` and friends) and a phone must start `+00` (same migration, `app.guard_real_data`, and `docs/runbooks/real-data-gate.md`). So with the gate closed nothing real can be typed anyway; this is correct and is the ADR 0017 rule.

**To get one touch in:** lead page, "Follow-up →" (`leads/[leadId]/page.tsx:103`), then the "Record a touch" form (`followups/touch-form.tsx`): three choices (I sent it myself / they replied; E-mail, WhatsApp or Phone call; when, optional, never in the future and at most 7 days back, `followups/models.py` `RecordTouchIn`) and "Record this". About four interactions. It records **no note and no text**: only direction, channel and time.

* A **reply** ("they replied") is always recordable, even on a lead with no contact, except for an erased contact (`supabase/migrations/20261024090000_t010_part2_followups.sql`, `public.record_touch`, lines 866-880).
* An **outgoing** touch, including "I phoned them", runs the whole gate (`app.followup_gate`, same file, line 417): the lead must have a contact; the contact must have the address for that channel (phone for WhatsApp and phone call); the contact must have a **suppression key** (else SM221); and `app.can_contact` must say yes, which means that channel's consent is **`granted`** (`supabase/migrations/20261005100200_t003_consent.sql:269`). A contact made by import starts with consent `unknown`.
* **No web screen records consent.** The contacts table on the workspace page only shows the consent columns (`apps/web/app/app/tenants/[tenantId]/page.tsx:294-309`). The endpoint exists: `POST /contacts/{id}/record-consent` (`crm/routes.py:256`); `granted` needs a basis and an evidence reference (`crm/models.py` `RecordConsentIn`). So, today, **a person who has just phoned a customer cannot record "I called them"** unless someone made the contact through the API and recorded consent through the API.

**To paste an enquiry:** lead page, "Paste an enquiry" (`enquiries/paste-enquiry-form.tsx`): where from (E-mail, WhatsApp...), when received (prefilled with now), subject (optional), the text. It needs an **existing lead**. It **removes** e-mail addresses and mobile numbers and invisible characters before saving and keeps no original (`enquiries/routes.py:101-135`). It creates **no touch** (no `lead_touches` write in the enquiry migrations).

**What is missing for a person who has just finished a phone call** (in the order they would hit it):
1. Pick the customer from a list, or add a new one by name and phone: **missing** (no contact or lead form; phone-only import refused).
2. Say what was said (a short note): **missing** (a touch has no text; the enquiry text strips phone numbers and needs a lead).
3. Say they have no reply yet and when to look again: the engine decides the next date from the policy and the outgoing touch; recording the outgoing touch is blocked by consent (above).
4. See the list "who do I chase today": **exists** (the due list, `followups/page.tsx`, `followups-due-candidates` PR #9), but a lead appears there only after at least one outgoing touch (`docs/plans/followups-due-candidates-plan.md`, condition L1), and only with a follow-up policy in force.

## 2. Does the lead import accept a phone-contacts export?

**No, in three separate ways.**

* **Format.** The web takes JSON only. A CSV adapter exists (`services/ai-api/app/leads/csv_rows.py`), but it is used only by the rehearsal driver (`tests/rehearsal/drive.py`) and its tests; no endpoint or screen calls it. There is **no vCard (.vcf) support anywhere** in the repository (searched `services`, `apps/web`, `scripts`, `tests`, `docs`).
* **Columns.** The adapter accepts exactly 15 names: `company_name, website, country, city, industry, categories, contact_name, contact_email, contact_phone, contact_job_title, source, buyer_type, size_band, operating_status, order_scale`; an **unknown column refuses the whole file** and `company_name` is required (`csv_rows.py` `COLUMNS`, `unknown_column`, `missing_company_column`). A Google Contacts CSV (columns like "First Name", "Phone 1 - Value") would be refused as a whole. A phone export has a person's name and no company, so an adapter would have to set `company_name` itself (a customer in this business is a shop or a person trading as one; **the family's wording for this is not known**).
* **E-mail.** A contact without an e-mail is refused (section 1), and phones are free text of 3 to 32 characters (`contacts.phone` check, `supabase/migrations/20261005100100_t003_crm_core.sql:141`).

**Detail asked for:**

| Question | Answer from the code |
| --- | --- |
| Missing e-mail | the whole row is refused (`contact_requires_email`); a company-only row (no contact fields at all) is accepted |
| `+91`, spaces, dots | stored as typed; the import neither cleans nor compares phones. The **suppression key** does normalise: digits only, `00` dropped, an Indian mobile written with `+91`, `91` or a leading `0` reduced to ten digits (`services/ai-api/app/suppression/keys.py:36-47`), so "+91 98765 43210" and "098765 43210" produce the same key, but they are two different stored phones |
| Duplicate numbers | not detected by the import. A contact is matched **by e-mail only**, case-insensitively (`t006b_real_data_gate.sql:454`). A company is matched by website host, else by a normalised name (and a different city means a different business); two matches give `ambiguous`; an open lead for the same company (and contact) gives `skipped_duplicate` |
| Names in Telugu script | accepted. The database refuses only control characters, zero-width space and bidirectional marks (`20261006100000_t004_text_hygiene.sql:22-28`); U+200C and U+200D are allowed there, the CSV adapter accepts them after an Indic letter (fix A2, CLAUDE.md), and the company match key removes them (`20261007090000_t005_match_keys.sql:22`). **Not clicked with a real Telugu file** |
| Shown for approval before writing | **yes**: the preview endpoint runs the same logic and rolls back; nothing survives, not even an audit row (`import_lead_rows`, `p_dry_run`). The screen shows counts and ten rows. The commit is a second, separate submit |
| Limits | 500 rows a batch (`ImportBatchRequest`), JSON object per row, every value a string |

**What a thin adapter needs** (two options, both honest about the cost):

1. **Parse vCard and Google CSV in the web (or in `csv_rows.py`'s style) into the existing `ImportRowInput` rows** and show them in the existing preview. This alone does not help, because of `contact_requires_email`. It needs the rule changed: **a migration** replacing `import_lead_rows` so a contact may carry a phone and no e-mail (and then keys, consent and the gate's phone rule all still apply). Size **M**: one migration, pgTAP for the new outcome, the preview text, the adapter, tests.
2. **Do not use the batch import for contacts.** An "add a customer" form in the web calling the existing `POST /companies`, `POST /contacts` (keyed automatically, `crm/routes.py:102`) and `POST /leads` accepts a phone-only contact today. For a pile of contacts, an adapter would call these three in a loop with a preview table built in the web. No migration, no change to the import. Size **M** for the bulk path, **S** for the one-at-a-time form.

Both leave the consent step (section 1) to a separate screen.

## 3. Pasting a WhatsApp chat or a text enquiry: the smallest slice

**Today, with no model:** a person can paste text onto a lead (section 1). Nothing parses it, so **no lead and no touch come out of a paste**; the text is stored, cleaned, as an enquiry on a lead the person already has. The Requirement Agent can propose fields from an enquiry (a run; with the scripted fake model in development, never run live: CLAUDE.md T006), and a person can add the fields by hand (`POST /enquiries/{id}/requirement-fields`, web `add-field-form.tsx`), confirm the requirement and go on to a quote.

**The smallest slice using only what exists, no Storage, no model, no capture phase:**
1. Create the customer as a **company-only lead** by the Review page's import (the company name is the customer's name; no contact fields). *(Five interactions and a line of JSON.)*
2. Open the lead; **paste the chat** as an enquiry (channel WhatsApp, time received). Phone numbers in the chat disappear from the stored text.
3. Open "Follow-up →" and record **"they replied", WhatsApp**: allowed with no contact (section 1).
4. Fields by hand, confirm, quote. **Stop point:** to record the reply the owner sends, a contact with a phone, a key and a granted consent are all needed, and none can be made from the web.

So the slice works **up to the first thing the owner sends**, and not past it. The three missing small screens (add a customer, record consent, add a product) are what turn it into a working loop (see the ranked list).

## 4. Without a price list: what do the quote and order screens need?

**A quote in this system needs six things, all in place before the first quote** (`services/ai-api/app/quotes/routes.py`, `quotes/builder.py`):
1. an **enquiry** with a **confirmed requirement** (fields added by hand or proposed and accepted), `enquiries/routes.py`;
2. a **product pick** per requirement line: a catalog product, chosen by a person (`pick-line-form.tsx`, `POST /enquiries/{id}/picks`);
3. the product must be **on a price list version** (`MissingInput`: "a line has no pick, or its pick's product is not on the price list");
4. an in-force **quote policy version** (discount ceiling, flat shipping fee, free-above, shipping GST, validity days, advances, net days, seller state, required inputs; table `quote_policy_versions`, `20261016090000_t009_quote_reference_data.sql:207`);
5. the customer kind (`new` or `repeat`) and the delivery state (`CreateQuoteIn`);
6. approval by an Owner or Admin **with the second factor** to get the quote text.

**Can a price be typed for one quote? No.** A quote has no price field. `CreateQuoteIn` is `{id, customer_kind, delivery_state}` and the docstring says "Nothing here is a price". The database goes further: for the v1 subset it requires the engine request to be **byte for byte** the one it builds from its own sources (picks, price list version, policy version, customer kind) and recomputes every figure (`20261016090100_t009_picks_and_quotes.sql`, header). A typed price would therefore need a database change, not just a screen (section 8).

**Who creates the supporting data, in the web?**

| Item | Web screen | API route | Note |
| --- | --- | --- | --- |
| Products | none | `POST /products` (Admin+) | a price list refuses an unknown sku (`UNKNOWN_SKU`, `pricelists/service.py:70`) |
| Price list | `price-list/` (CSV, check then save, second factor to save) | `/price-lists/import` | needs the products first |
| Quote policy | **none** | **none** | only the database function `public.create_quote_policy_version` (called from `tests/integration/quote_support.py:121`) |
| Order policy | none | `POST /order-policy-versions` (`orders/routes.py:123`) | |
| Follow-up policy | `followups/policy/` | yes | |
| Mapper config (suggestions) | none | none | optional; without it the person picks the product |

**Follow-ups on a lead that never had a quote: yes.** The due-list conditions are a lead, at least one outgoing touch, no stop, no blocker, a policy in force; a quote is not among them (`docs/plans/followups-due-candidates-plan.md`, L0-L4). A **withdrawn quote** or a declined order stops follow-up (`app.followup_stopped`).

**A price-by-saree-type table: the price-list CSV** (`docs/plans/price-list-csv.md`, `tests/rehearsal/data/price_list.csv`):

```
sku,name,unit_price,moq,tax_bps,min_qty_1,price_1
SYN-KJ-RED-01,SYNTHETIC Kanjivaram silk saree red,4200,4,500,10,4000
```

Required columns `sku, name, unit_price, moq, tax_bps`; optional paired quantity breaks `min_qty_1/price_1` to `min_qty_5/price_5`. `unit_price` is rupees (up to two decimals, optional ₹, Rs or INR, western grouping only, so "1,20,000" is refused); `moq` 1 to 10,000; `tax_bps` must be given (5% is 500); sku is letters, digits, dot, underscore, hyphen, 40 at most; name 128 at most. At most 1,000 products a version (`TOO_MANY_ITEMS`) and 900,000 bytes. **Ten to thirty saree types fits easily.** One price per product (plus breaks by quantity); **not per customer**. Each load makes a new immutable version (no editing in place), dated no earlier than the latest.

## 5. A two-Owner workspace through the operator path

**Possible, by SQL as the operator.** `app.operator_add_owner_exception(slug, email, reason)` adds an Owner membership (`supabase/migrations/20261012090100_t006b_m2_review_fixes.sql:75`): operator only (refuses a signed-in caller), the reason must be **20 to 200 characters with no personal data**, the person must have an **account that accepted its invitation** (`SM403` otherwise), and it writes the audit event `membership.operator_added_owner`. The ordinary add-member runbook says "**Never `owner` here**" and offers only `admin`, `sales`, `viewer` (`docs/runbooks/add-family-member.md`, step 2); the Owner route is documented in `docs/runbooks/sole-owner-erasure.md` (steps and rules: verify identity out of band, write the reason without personal data). The first Owner is whoever creates the workspace on the Workspaces page (`docs/runbooks/real-data-gate.md`, "Which workspace"). The runbook mentions a "Members screen" that **does not exist yet** (members and invitations are plan only: `docs/plans/members-and-invitations-plan.md`). I did not find a cap of three Owners in this function (**NOT VERIFIED** whether any other trigger enforces it). Both Owners need the second factor for the approval and policy screens (`/app/security`).

## 6. The assisted setup kit

Minimum for a **one-hour session**, using what exists. "Now" means buildable and testable today; "needs" lists what does not exist.

**(a) Price-by-saree-type CSV template.** Columns exactly as in section 4: `sku,name,unit_price,moq,tax_bps` (+ optional breaks). One row per saree type; the sku is the owners' short code (for example `KJ-RED`), the name is what they say, the price is the usual one, the MOQ is the smallest order they take, `tax_bps` the family's GST rate (to be filled; **not guessed here**). **Prerequisite the template cannot fix:** each sku must first exist as a catalog product, and no web screen creates a product (section 4).

**(b) Phone contacts.** On an Android phone: Contacts, Export, `.vcf` or Google Contacts, Export as "Google CSV". On an iPhone: iCloud.com Contacts, Export vCard. **The import expects neither** (section 2). What the session can do today: the owner picks the **customers who matter** (the ones who order, perhaps 20 to 50) and types them in with the add-a-customer path once it exists; until then the only accepted shape is the lead JSON with an e-mail. This is the largest gap for the session.

**(c) One-page sheet of the family's values, mapped to what exists.**

| Family decision | Field | Where |
| --- | --- | --- |
| days between messages after a touch | `gap_days` (a list: the gap after touch 1, 2, ...; 0 to 365 each) | follow-up policy page `followups/policy/` |
| how many follow-ups at most | `max_touches` (1 to 100) | same |
| quiet hours | `quiet_start`, `quiet_end` (HH:MM, recipient's local time) | same |
| weekdays and holidays | `allowed_weekdays` (Monday 0 to Sunday 6), `holidays` (dates) | same |
| smallest gap between two outgoing touches | `min_gap_hours` (0 to 8760) | same |
| time zone | `recipient_utc_offset_minutes` (India 330) | same |
| GST and freight rule | quote policy: `tax_mode` is **`exclusive` only** (`20261016090000...:29`, "v1: tax-exclusive only (owner decision 16)"); `shipping_flat_fee_paise`, `shipping_free_above_paise`, `shipping_tax_bps`; the rate per product is `tax_bps` in the price list | **no screen or API** for the quote policy |
| advance for a new and a repeat customer, days to pay, credit limit | `new_advance_bps`, `repeat_advance_bps`, `net_days`, `repeat_credit_limit_paise` | quote policy (no screen) |
| how long a quote is good for, discount ceiling | `validity_days`, `discount_ceiling_bps` (v1: no discounts allowed in the database's subset) | quote policy |
| wording of the first message and the follow-up, English and Telugu | **closed English templates written by migrations**: `followup_gentle`, `followup_reminder`, `followup_last` (`t010_part2_followups.sql:151-154`); no first-message template exists and none is in Telugu | a Telugu or first-message wording is a **migration** (S to M) and the owner's wording |

**(d) Order of the steps** (each step needs the one before):
1. Workspace exists; both Owners are in (operator SQL, section 5); both enrol the second factor.
2. Products (catalog), then the price list CSV.
3. Quote policy and order policy (operator or developer, no screen for the quote policy), then the follow-up policy page.
4. Customers (add-a-customer path), their consent (record-consent path), suppression keys (the K1 screen: merged as PR #13 after this document's base commit, so it is not in the code read here).
5. A rehearsal quote and a rehearsal follow-up with invented customers, then stop.
6. Only after the gate prerequisites, real customers.

**(e) What must be true BEFORE real data may be entered** (`docs/runbooks/real-data-gate.md`; `docs/plans/customer-zero-roadmap.md`): the four references recorded by the operator: **`erasure_ref`** (the erasure workflow is installed: true), **`hosting_ref`** (a hosted deployment exists and `scripts/verify_hosted.py` ends `ALL CHECKS PASSED`), **`dpdp_review_ref`** (the India DPDP review is done and filed; it also covers the HMAC suppression list), **`restore_drill_ref`** (a backup was restored on a throwaway project and `verify.sql` passed); plus the unenforced confirmations: the family has been told what goes in, Owner and Admin accounts have the second factor, a budget alert exists. Until then **every session is synthetic** (reserved e-mail domains, `+00` phones).

**Template files that could be written now with invented data, to rehearse the session** (not written here): `tests/rehearsal/data/price_list.csv` and `leads.csv` already exist as synthetic examples of (a) and the lead JSON; the missing ones are a **saree-type price CSV with a dozen invented types** and a **"contacts export" CSV and `.vcf` with invented names (English and Telugu script) and `+00` phones**, to rehearse the adapter. They would live in `tests/rehearsal/data/intake_kit/` (next to the existing synthetic data and its README), and the one-page sheet in `docs/runbooks/assisted-setup-session.md`.

## 7. Naming: the "owner agent" and the "Capture Agent" are different things

Confirmed from the plans. **The Owner Agent** (T011a/T011b, `docs/plans/owner-agent-plan.md`; the first part `docs/plans/t011-owner-agent.md`) is a **read-only morning brief** for the Owner and Admin: T011a is deterministic and uses **no model** (nine read-only database functions, one endpoint, one page that says what needs attention: drafts waiting, quotes waiting, money held and so on); T011b is a read-only agent behind the model interface (the fake model only until the owner approves a live batch) that ranks and explains the same recorded facts from a closed list of phrases. It cannot write anything, send anything or take data in. **The Capture Agent** (C-W5 of `docs/plans/workspace-files-and-chat-capture-plan.md`, which the plan itself calls "the main agent", assumption A2) is an **interactive intake agent**: a person types or dictates to a chat box, and it **proposes** structured records (a lead, a touch, a file attached to a lead) from a closed list of proposal kinds; it has **no write tool for any business table**, a person approves, and the database re-checks and applies through the same functions a person uses; it runs with the asking person's own token, is off by default and is planned for the fake model first. It cannot send messages, change prices or decide anything, and it does not rank or advise. The family-facing word **"main agent" must not be used for both**: use "the morning brief" (or "Owner brief") for the first and "the assistant that takes notes" (or "Capture assistant") for the second.

## 8. Per-customer prices (new facts: GST is added on top; courier is a separate line; the price differs by saree type and by customer; today's quote is one informal line)

**"GST on top, courier separate" fits what exists.** The quote engine's only tax mode in the database is `exclusive` (`quote_tax_mode` has the single value `exclusive`, `20261016090000_t009_quote_reference_data.sql:29`, "owner decision 16"), the shipping fee is its own line with its own GST rate (`shipping_flat_fee_paise`, `shipping_free_above_paise`, `shipping_tax_bps`), and the text prints GST and shipping as separate lines (section 9). So the fact "GST is added on top" closes the "included or added" question of section 0 for the code: no inclusive mode is needed. One thing does not fit yet: the courier cost is **one flat fee per policy version** (free above a threshold), not an amount typed per order. Whether the family's courier cost is the same for every order is **not known**; if it varies, the courier needs the same treatment as the price below.

**Can the current price list, quote and order screens hold or override a price per customer? No.**
* The price list is per product, per version, for the whole workspace: `price_list_items` has `product_id`, `unit_price_paise`, `minimum_order_quantity`, `tax_bps` and, in `price_list_breaks`, quantity tiers (`20261016090000...:167-200`). There is no customer column.
* The quote request carries only `customer: {kind: "new" | "repeat"}`, which changes the advance rate and the credit limit and nothing else (`services/ai-api/app/quotes/builder.py:207-216`).
* The engine itself accepts a `discount_bps` on an order line, up to the policy's ceiling (`docs/plans/t009-quote-engine.md`), but the integration sends none (`builder.py:8`, "with no discount") and the database **refuses** any quote outside the v1 subset ("a discount, a margin, tax-inclusive mode, a second shipping rate", `20261016090100_t009_picks_and_quotes.sql` header).
* The quote screens take a product, a quantity and the customer kind; the order screen starts from an approved quote and has no price. Past prices are stored: `quote_lines.unit_price_applied_paise` (same migration, line 195), per quote line.

**The smallest design that keeps the owners' judgment (they type the price for each quote) and still computes GST and freight on top: a typed price on the pick.**
1. The person's **pick** of a product for a requirement line (`requirement_line_picks`, the table that already records "this line means this product") gets one more optional value: `unit_price_paise`, and a source word `typed`. Only an Owner or Admin may set it (approval is already theirs, with the second factor).
2. The quote builder (`quotes/builder.py`) uses the typed price as that line's price in the request it sends the engine, with the product's GST rate; the **engine adds the GST and the courier line exactly as today**, so nothing about tax is recomputed by hand and no model is involved (non-negotiable 4: a person types the price, a deterministic service does the sums).
3. The GST rate for a typed line needs a source, because the family has no price list to hold it: one new field on the quote policy (`default_tax_bps`, the family's rate for sarees, **their number to give**), or the price-list row if the product has one.
4. **The database must do the same**, because it rebuilds the request byte for byte and recomputes every figure (section 4). So this is a migration that changes the pick function, `create_quote_draft` and the recomputation inside `approve_quote`, with an equivalence test against the real engine, pgTAP and integration tests, and the price list rule "the product must be on the price list" relaxed for a typed pick. A screen alone cannot do it.
5. Provenance and uncertainty (non-negotiable 5): store who typed it and when (the audit trigger does), show "price typed by [person]" on the draft, and add a review flag for a typed price so the Owner's approval is a real second look. A typed price is bounded like a list price (1 paise to INR 1,000,000).
6. A typed courier amount, if needed, is the same shape on the quote (an optional `shipping_fee_paise`), another change to the same three functions.

**Size: L** (a change to three security-relevant quote functions and to the equivalence proof), though the screen part is small. A cheaper step that helps first, **S to M and read-only**: show, next to the price box, "last quoted to this customer for this saree type: ₹X on [date]" read from `quote_lines` of that customer's earlier quotes. No new table, no write path, and it gives the owners the memory they now keep in their heads.

**What a per-customer price adds later:** a versioned table `customer_prices (tenant, company or contact, product, unit_price_paise, effective_from, created_by, ...)`, immutable versions like the price list. The builder then looks up in this order: **typed price on the quote, then the customer's price, then the list price**. The typed-price form gets a tick, "use this price for this customer next time", which writes a row. The database re-check follows the same pattern as above (the request it rebuilds includes the customer price). Size **L**, after the typed price is in use and the owners have shown which customers really have fixed prices.

## 9. The one-line quote: what `quote_text` writes today

`quote_text` **1.0.0** is the only version the API accepts (`ALLOWED_RENDERER_VERSIONS = {"1.0.0"}`, `services/ai-api/app/quotes/text_port.py:20`). **1.1.0** exists on the lane C branch `quote-text-joiners` (also on `origin`, not merged to `main`): `git show quote-text-joiners:packages/pure/quote_text/VERSIONS.md` says it differs from 1.0.0 only by allowing U+200C and U+200D after an Indic letter or mark; the text for any input both accept is identical. I rendered the same synthetic quote with both (extracted from git into the scratch area; nothing in the repository changed): **the two outputs are identical except for the version line.**

Synthetic input: one line, "Kanjivaram saree, red", quantity 1, the engine price ₹12,000.00, GST 5 percent on the merchandise (exclusive), courier flat fee ₹300 with GST 18 percent, a new customer (advance 50 percent), seller "Synthetic Silks":

```
Approved quote
Seller: Synthetic Silks
Customer: Synthetic Customer
Reference: SYN-Q-001
Issued: 2026-10-08
Valid until: 2026-10-15
Prices exclude GST

Kanjivaram saree, red
1 x ₹12,000.00 = ₹12,000.00
Net: ₹12,000.00
GST (5%): ₹600.00
Line total: ₹12,600.00

Merchandise subtotal: ₹12,000.00
Merchandise net: ₹12,000.00
GST on merchandise: ₹600.00
Shipping net: ₹300.00
GST on shipping (18%): ₹54.00
Shipping total: ₹354.00
GST total: ₹654.00
Grand total: ₹12,954.00
Advance: ₹6,477.00
Balance: ₹6,477.00
Balance due: 2026-10-08
Valid until: 2026-10-15
Payment terms: 50% advance, balance before dispatch.
Notes:
- Synthetic demonstration only.
```

**How far is it from "this saree price 12000rs, GST extra, courier extra"?** Every value the short message needs is already in that output and in the stored quote: the label, the unit price (₹12,000.00), the GST rate (5 percent), the courier amount and its GST. The distance is in shape, not in data:
* **Length and layout:** 29 lines in about ten blocks (an "Approved quote" header, seller, customer, reference, dates, line block, a merchandise block, shipping block, grand total, advance, balance, due date, validity, terms, notes) against one line.
* **Wording:** formal ("Prices exclude GST", "Merchandise net", "GST on merchandise") and rupee amounts with Indian grouping and two decimals (₹12,000.00), against "12000rs". All labels are fixed English; there is no Telugu.
* **Things the informal message never says:** reference number, dates, advance and balance, due date, validity, terms.
* **A condition before any text exists:** the quote must be **approved** by an Owner or Admin with the second factor (`GET /quotes/{id}/text` serves approved quotes only).

**Is a plain one-line template a text change or does it need new fields? No new fields; but not a string edit either.** The renderer has one layout and no short mode (`packages/pure/quote_text/__init__.py`, `render`). A short form is **new renderer behaviour**: a second function or mode in lane C's pure package, a **new version** (the version is part of the hashed payload, and `VERSIONS.md` says any change of what is printed is at least a minor version: 1.2.0), new golden vectors, and lane A adopting the version deliberately in `ALLOWED_RENDERER_VERSIONS` (for 1.1.0 this adoption is still waiting). It needs the same request it already takes, so no new input field, no new column. Size **M** (it is pure code with a golden-vector rhythm). **Not recommended:** composing the short text in the web from the stored figures; that would bypass the pinned renderer, its refusals and its hash, and the customer text is meant to come only from the renderer (T009 integration). Until then the formal text is a valid, correct message the owner can send as it is.

## 10. Saree photos

**Can an enquiry or a lead hold a photo today? No.** There is no attachment field on an enquiry, a lead, a contact or a quote. `docs/plans/workspace-files-and-chat-capture-plan.md` plans files in a private store (W1) and a model that reads them, but nothing of it is built: Supabase Storage is switched off in the local setup (`supabase/config.toml:118-119`, `[storage] enabled = false`) and the enquiry text is plain text with e-mail addresses and phone numbers removed.

**The smallest option, no Storage and no model: a note.** Today a person can already add a **note** to a lead: the lead page has the evidence form with the kind "Note" (`apps/web/app/app/tenants/[tenantId]/add-evidence-form.tsx`, the kinds list; `EvidenceKind.NOTE`), a reference line and a snippet of up to 1,000 characters (`evidence/models.py`). A habit that works today: "photo sent on WhatsApp 8 Oct 14:32, red Kanjivaram, border gold" typed as the snippet, with the photo staying in the owners' phone and their WhatsApp chat. A requirement field of the enquiry (`saree_type`, `colour`, `fabric`, `quantity`, each up to 120 characters, `enquiries/models.py` `AddFieldIn`) can carry what the photo shows in words. If the family wants it more explicit, the smallest build is **a "photo note" box on the quote screen** (a short text line stored with the quote and printed nowhere): **S to M** (one nullable text column and a migration, or no code at all by using the lead's note). I am not planning the vision reader.

## 11. The quote template flow (owner idea, 2026-10-08)

The idea: the owner picks the customer, picks the saree type, types **this customer's price**; the system adds GST and courier as separate lines and writes the message; the owner reviews it and taps "Open in WhatsApp" (a `wa.me` link with the text filled in) and sends it by hand; saving the quote creates the follow-up; the system itself never sends. This fits the non-negotiables (a person types the price, a deterministic service computes tax and freight, a person approves and sends).

| # | Step | State on `origin/main` | Evidence | Gap |
| --- | --- | --- | --- | --- |
| 1 | Pick the customer | **partly** | the Leads tab and the lead page exist (`apps/web/app/app/tenants/[tenantId]/page.tsx`, `leads/[leadId]/page.tsx`). Creating a customer is **missing** (section 1), and a quote can only start from an **enquiry** on a lead (`enquiries/[enquiryId]/page.tsx`, `quote-panel.tsx`), so there is no "new quote for this customer" entry | **S** (the add-a-customer form) **+ M** (a "quick quote" screen that, from a customer, makes the enquiry, adds the two required fields, confirms and goes on to the pick, using the existing endpoints in turn; no migration) |
| 2 | Pick the saree type | **partly** | the requirement field `saree_type` and quantity (`add-field-form.tsx`; confirm needs a human-confirmed saree type **and** quantity, `20261015090100_t008_requirement_functions.sql:12`), then a pick of a **catalog product** (`pick-line-form.tsx`, `POST /enquiries/{id}/picks`). The catalog has no web screen to add a product (section 4) | **S** (add-a-product form). The mapper's suggestions need a mapper config that has no screen; not required, the person can pick |
| 3 | Type this customer's price | **missing** | a quote has no price input; the database rebuilds the request byte for byte (sections 4 and 8) | **L** (a typed price on the pick, a migration to three quote functions, an equivalence test). v0 can use the **price list** price per saree type (a price list loaded in the session) and skip this step |
| 4 | GST and courier as separate lines | **exists, partly** | the engine adds GST on top and a shipping line with its own GST; the text prints them separately (section 9). The **quote policy that holds the courier fee has no screen or API** (`quote_policy_versions`, only `create_quote_policy_version`), and the courier is one flat fee per policy, not typed per order | **M** (quote policy route and page); a courier typed per quote is part of the **L** above |
| 5 | The message text | **partly** | `GET /quotes/{id}/text` (`quotes/routes.py:126`) gives the formal text of an **approved** quote (29 lines, section 9). Approving needs an Owner or Admin with the second factor | **M** for a one-line variant (a new `quote_text` version); until then the formal text works |
| 6 | A copy button or a `wa.me` link | **partly** | **copy exists** (`enquiries/copy-text.tsx`, "Copy text", with the note "Nothing is sent by the system"). **No `wa.me` link exists anywhere** (searched `apps/web/app` and `apps/web/lib`) | **S** (a link built on the server from the contact's phone and the approved text; see section 12 for the rules) |
| 7 | Record that the owner sent it | **partly** | the follow-up screens have "Record: I sent it myself" for a **follow-up draft** (`followups/draft-forms.tsx:46-55`) and a plain "Record a touch" for anything else (`followups/touch-form.tsx`, channel WhatsApp). Neither is on the quote screen, and a quote has **no "sent" state** (`quote_status`: draft, approved, rejected, superseded). Both go through the outgoing gate (contact, address, suppression key, **consent granted**), and no screen records consent | **S** (a "I sent it on WhatsApp" button on the approved quote calling the existing touch endpoint; no migration) **+ S** (record consent, section 1). A quote-linked "sent" state would be a migration (**M**), not needed for v0 |
| 8 | Saving the quote creates the follow-up | **partly; the idea needs one correction** | a follow-up is **not a stored row**: the due list is derived from the pinned engine, the follow-up policy and the lead's outgoing touches, and a lead appears only after **at least one outgoing touch** (`docs/plans/followups-due-candidates-plan.md` L1; the engine answers `initial_outreach_required` without one, `docs/plans/t010-followup-cadence.md:45`). So **"saving the quote" cannot start the clock; "recording that I sent it" does** (step 7). After that the follow-up needs no work: it is the existing due list, with a policy in force, and a withdrawn quote or declined order stops it (`app.followup_stopped`) | **none beyond steps 7 and the follow-up policy page, which exists** (`followups/policy/`) |

**Reading of the table:** every step has a part that exists. The flow can be built almost entirely from existing endpoints and screens; the three real engineering gaps are the **typed price** (L), the **quote policy screen** (M) and the **quick-quote orchestration** (M). The rest is small web work (S) and the three forms that every real use needs anyway (customer, consent, product).

## 12. How the WhatsApp channel of the follow-up screens (PR #7) lets a person send by hand

Today the **follow-up** WhatsApp channel works like this (`apps/web/app/app/tenants/[tenantId]/followups/`): the lead page has E-mail and WhatsApp **tabs** (`channel-tabs.tsx`); the person asks for a draft on a fixed channel (`create-draft-form.tsx`); the draft's wording is a **closed English template** the database copies in (`followup_gentle`, `followup_reminder`, `followup_last`), no variables; an **Owner or Admin approves** it (second factor, `followup-logic.ts` `draftOffers`); the approved text is shown with a **"Copy the text"** button (`draft-text.tsx`, `navigator.clipboard.writeText`) and the note that the system sends nothing; the person sends it themselves in their own WhatsApp; then presses **"Record: I sent it myself"** (`draft-forms.tsx`), which records the outgoing touch against the draft. **There is no link and no phone number on these screens** (searched `phone` in `lead-followup-view.tsx`, `draft-forms.tsx` and `channel-tabs.tsx`, and `wa.me` in `apps/web/app` and `apps/web/lib`; the other follow-up files were not searched for `phone`, **NOT VERIFIED** for them): the person finds the customer in their own phone. Three states keep it honest (Draft, Approved, Recorded: you sent it yourself).

**Can the quote screen reuse it?** Partly, with small changes:
* **Copy:** the quote screen already has the same pattern (`enquiries/copy-text.tsx`), a sibling of `draft-text.tsx` with the same note. Reuse as is.
* **Mark as sent:** the quote screen can reuse the existing outgoing-touch endpoint (`POST /leads/{id}/touches`, channel `whatsapp`) through a one-button form built like `touch-form.tsx`. The touch is linked to the lead, not to the quote (only a follow-up draft has a `draft_id`); that is enough for the due list. Same gate: consent, address and key must exist (steps 1-2 of the ranked list).
* **A `wa.me` link:** new, **S**. The rules it must follow: build it on the **server** from the contact the API returns, only for an **approved** quote and only for Owner, Admin or Sales who may already read the contact; the number must be in international form, so the link needs the same normalisation idea as the suppression key (`services/ai-api/app/suppression/keys.py:36-47` reduces an Indian mobile to ten digits; WhatsApp needs `91` in front, so the link builder is a small separate function with its own tests); the text goes in the `text=` parameter, URL-encoded (the practical length limit for a 29-line text is **NOT VERIFIED**; the one-line variant of section 9 would avoid the question); the link is a plain anchor with `rel="noopener noreferrer"`. The phone number then sits in the page's HTML for that role: it is already readable by that role in the contacts table, but it is personal data, so it belongs in the DPDP review's scope (the customer's number goes to WhatsApp only when the owner taps). With the gate closed the synthetic phones start `+00`, so a link can be tested for shape only, never opened for real.
* **State words:** CLAUDE.md requires the UI to distinguish Draft, Suggested, Approved, Sent, Failed and Completed. A quote's "sent" is, in v0, a touch shown on the quote screen ("You recorded sending this on WhatsApp on [date]"), not a new quote state.

## 13. Direct sending, later (a plan item only)

Direct sending from the system would need: the **WhatsApp Business Platform** (Cloud API) through Meta or a business solution provider; a verified business account and a registered business number; **approved message templates** for any business-initiated message outside the 24-hour customer-service window; a recorded **opt-in** for each customer, which the consent ledger already models; a **webhook** for delivery states and replies, treated as untrusted input (CLAUDE.md non-negotiable 6); **option B** of ADR 0013 (a dedicated principal) before any external customer or any send that is not a person's own click; a send path behind a provider interface with idempotency, retries and a per-day cap (non-negotiables 3, 9 and the idempotency rule); a new key custody (the provider's secret) and an ADR; and the **DPDP legal review** to cover the processing by the provider. It also needs the owner's **written approval for a paid dependency** (the provider charges per message or conversation; I did not check current prices) before anything is introduced (plan v2, "Rules"), and it is **not** planned for Customer Zero: the owners send by hand, and the system keeps drafting, recording and reminding.

## Ranked list of the smallest changes (third version: the quote template flow is the main candidate)

**The main candidate is the quote template flow of section 11**, built in two milestones so that the first one is useful on day one.

**Milestone v0, "quote from the price list by saree type" (small forms and existing endpoints; no migration):**
1. **S**: "Add a customer" form (company, contact name, phone, optional e-mail, a lead) on the existing `POST /companies`, `/contacts`, `/leads`.
2. **S**: "Record consent" form (existing `record-consent`; a basis and a short evidence line).
3. **S**: "Add a product" form (Admin+, existing `POST /products`): one product per saree type. Then the price list CSV by saree type is loaded in the setup session (section 6).
4. **M**: quote policy route and page (courier flat fee, courier GST, validity, advances, seller state).
5. **M**: the "quick quote" screen: customer, saree type, quantity, delivery state, then the existing steps behind it (enquiry, fields, confirm, pick, draft, approve), using only existing endpoints.
6. **S**: on the approved quote, "Copy" (exists) + "Open in WhatsApp" (`wa.me`) + "I sent it on WhatsApp" (the existing touch endpoint). This starts the follow-up clock, so the family stops forgetting.

**Milestone v1, "this customer's price":**
7. **S to M, read only**: "last quoted to this customer for this saree type" next to the price (from `quote_lines`).
8. **L**: the **typed price on the pick** and the policy's default GST rate (section 8), with the migration and the equivalence test. This is where the owners' judgment enters.
9. **M**: a one-line text variant, a new `quote_text` version adopted by lane A (section 9).

**Alongside, not part of the flow:** **M** phone-contacts import (vCard and Google CSV; the phone-only migration or the form path), **S to M** Telugu first-message and follow-up wording (a migration, the owners' own words), **S** a photo note (section 10). An unsaved **price-sheet calculator** through the pinned engine (no write, no approval record) would be M and cheaper than item 8, but it would not be a quote with an audit trail and the idea says "saving the quote"; I do not recommend it except as a stop-gap the owner asks for.

**Not to build now:** direct sending (section 13), a vision reader, Storage, a chat parser, a per-customer price table (items 7 and 8 first), the Capture Agent (it needs items 1 to 3 anyway to have something to propose into, and it comes after the family has used the screens by hand), a members screen for two Owners (the operator path is enough for two people), a calculator in the web that does its own sums (a second implementation of the arithmetic would bypass the pinned engine and the database's recomputation).
