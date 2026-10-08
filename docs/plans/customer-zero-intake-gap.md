# Customer Zero: the intake gap (what the family's real habits need that the code does not yet do)

Status: **ANALYSIS ONLY. No code, migration, test or dependency was written or changed.** Written 2026-10-08 on the branch `docs/customer-zero-intake-gap`, from `origin/main` at `3578252` (PR #10). Every statement below was read from the code on that commit; file paths are the evidence. Nothing was run against a live stack and no screen was clicked, so a "click count" is counted from the code. Anything not verified is marked **NOT VERIFIED**.

Sizes: **S** = web only, existing endpoints, about a day. **M** = a new endpoint or one migration with its tests, a few days. **L** = new tables or a new pure package, an ADR, more than a week. These are my estimates, not measurements.

## 0. The facts from the family (owner-reported, 2026-10-08)

* Customer Zero is a silk-saree wholesale. One to two enquiries **a day**, by phone call and WhatsApp.
* Customers exist **only as contacts in a phone**. There is no written price list: the owners remember prices by saree type.
* They **never chase** a customer who has not replied. Forgetting follow-ups is the most frequent mistake. Advances are written in handwritten books.
* Two people, **both Owners**. GST and freight apply; whether they are added on top or included is **not known yet** (an item added later in this document may settle it).
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

## 8. Ranked list of the smallest changes (first version)

1. **S**: web "Add a customer" form (company, contact name, phone, optional e-mail, a lead), calling the existing `POST /companies`, `/contacts`, `/leads`. No migration. Without it nothing real can start.
2. **S**: web "Record consent" form on a contact (existing `record-consent`), with the basis and a short evidence line. No migration. Without it no outgoing touch can be recorded.
3. **S**: web "Add a product" form (Admin+, existing `POST /products`). Without it a price list cannot be loaded.
4. **M**: API route and page for the **quote policy** (today only a database function). Without it no quote can be made without a developer.
5. **M**: phone-contacts import (vCard and Google CSV adapter, plus the migration that lets a contact have a phone and no e-mail, or the form-based bulk path).
6. **S to M**: a Telugu first-message and follow-up wording (a migration, and the owners' own words).

**Not to build now:** direct sending, a vision reader for photos, Storage, a chat parser, a per-customer price table, the Capture Agent (it needs the three S forms anyway to have something to propose into), a members screen for two Owners (the operator path is enough for two people).
