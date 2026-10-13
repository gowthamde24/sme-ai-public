# ADR 0084: one platform, many kinds of business: industry packs, custom fields, reminder campaigns, voice settings, children's data, the admin console and billing

Status: **PROPOSED** (job CG, 2026-10-13). **Docs only: no migration, no code, no test, no dependency, nothing run, nothing deployed, no account opened.** Every decision below is a recommendation for the owner; none is built. Builds on ADR 0001 (tenancy), 0013 (non-human actors), 0014 (erasure), 0015 (the real-data gate and the operator functions), 0016 (second factor), 0017 (local first; a paid dependency needs the owner's written approval), 0020/0022 (suppression keys, follow-ups), 0061 (open sign-up), 0063/0064 (AI allowance and fair use), 0066 (the outbox and its policy), 0068 (the scheduler), 0071 (voice), 0073 (spreadsheet import), 0074 (phone-first contacts), 0075 (privacy rights), 0076 (WhatsApp), 0080 (connectors), 0081 (GSTIN) and `docs/plans/business-setup-and-templates-plan.md`.

**Nothing here is legal, tax or accountancy advice.** Where a rule of law, a regulator or a provider decides the answer, this ADR writes a **question** for the lawyer, the accountant or the provider, and does not assert the answer. Facts about outside parties are marked with the date they were read and are secondary sources unless said otherwise.

## Context

Customer Zero is a family silk-saree wholesaler (ADR 0017). The owner wants the same platform to serve other small businesses: real estate, construction, automobiles, schools, clinics, and later more. Direction already given on 2026-10-08: "any type of business can be set up by themself or my support team easily by selecting options" (`business-setup-and-templates-plan.md`).

What the repository looks like today, checked on `main` (`f9d0b5d`) on 2026-10-13:

* **Sign-up already asks the business type and ignores the answer.** `public.complete_setup(business_type, language)` accepts `textiles | construction | other` and records it in `public.account_setups.business_type`. Nothing reads that column afterwards (no migration, API module or web file refers to it besides the sign-up itself).
* **Textiles is built into the product.** The word "saree" appears in 31 API modules, 61 web source files and 16 migrations. The requirement vocabulary (saree type, fabric, colour) is a closed list in a migration; the confirmation rule (SM210) and the Requirement Agent depend on it. `catalogue_items` has `fabric`, `colours` (1 to 4 from a fixed list), `zari`, `occasions` and `price_band` as NOT NULL or closed columns. The assistant, quote and lead-scoring code mention sarees directly.
* **Some of it is already generic.** Contacts (name, phone, e-mail, job title, consent per channel), companies, leads, enquiries, quotes with tenant-defined `item_types`, orders, store visits, the outbox and its policy, WhatsApp templates per business and language, the scheduler worker, the call-request and Exotel bridge, the spreadsheet import (`customers` and `stock`), the audit log, erasure and the privacy tools.
* **Plans exist only as an AI allowance.** `tenants.plan` is `free_trial | starter | growth | business`; `plan_ai_allowances` holds placeholder rupee amounts per plan; `workspace_limit` is 1. A plan does not switch any feature on or off. A free trial has a start date and no end date.
* **Operators work in SQL.** Platform actions are `app.operator_*` database functions run by hand by someone holding the database owner role (open the real-data gate, add a member, reset second factor, enable the assistant, switch the outbox, register the scheduler and channel accounts). There is no operator account, no console, no operator audit log of its own, and no role above a workspace's Owner.
* **There is no billing.** No subscription, no invoice, no seller GSTIN of our own, no provider adapter for our own revenue. ADR 0080's Razorpay and Cashfree code collects a **shop's** payments from **its** customers in one workspace; it is not our billing.
* **Voice is for the owner talking to the assistant** (speech to text, text to speech, fair-use accounting). No automated call to a customer exists. A human can place an approved call through the Exotel bridge.

## Shared principles (these bind all six parts)

1. **Configuration is data, not code.** A business is shaped by rows (a pack version, field definitions, a schedule) chosen from reviewed options. No per-tenant code, no tenant-written prompt that replaces policy, no tenant-written SQL or template language with logic.
2. **A pack can choose among existing rules; it cannot add a rule that touches money, consent or sending.** The deterministic quote and order engines, the outbox policy (opt-in, STOP, quiet hours, daily limit, money and commitment words held for a person, first-message disclosure, kill switches), the real-data gate and erasure stay the same for every business. A pack may make a business **stricter**; nothing a pack, a plan or a model says may loosen a safety rule (the same direction as ADR 0066 decision 2: "a model can only make a message wait").
3. **Default deny for modules.** A module that is not listed for a workspace is off. The database refuses the work (not only the screen), the way the global outbox switch and a workspace's agent switch work today.
4. **Textiles must not change.** The first job of the platform work proves, with an equivalence test in the style of the follow-up equivalence proof, that Customer Zero's behaviour, screens and words are identical before and after. The textile pack is written as data first.
5. **Every new column that can hold a person's data gets, in the same migration, an erasure-registry entry, a row in `docs/data-inventory.md`, a `SAFE:` or personal-data column comment, and text hygiene.** A new immutable table says how erasure reaches it.
6. **A model never sees a field the business marked personal, and never any child's field** (non-negotiable 6 and the v1 rule that no contact field reaches a model). Non-personal fields reach a model only inside the existing untrusted block.
7. **A new vertical goes live only after a real owner of that kind of business has reviewed its pack** (the rule of `business-setup-and-templates-plan.md` section 12.4). Until then it carries a "Not validated" label and is hidden from sign-up.
8. **Paid or external things need the owner's written approval first** (ADR 0017): telephony for AI calls, a billing provider, SMTP, an invoice PDF library, an access gateway for the console.

**Job** below means one lane-A job of the size of BZ or CE: a migration or two with pgTAP, the API, tests, a runbook, usually one web screen. Sizes are my estimates.

---

## 1. Industry packs

### What it is
A pack is a **static, reviewed, versioned bundle** shipped in the repository as data and chosen at sign-up. It holds:

| Part | What it decides | Cannot decide |
|---|---|---|
| Labels | The words the screens use ("lead", "customer", "item" become "enquiry", "parent", "plan" ...), per language, for a closed list of about 40 keys | Anything outside the list; error codes; money words |
| Extra fields | Which custom fields (part 2) exist on contacts and catalogue items | Core columns |
| Templates | Follow-up, reminder and visit wording, WhatsApp template seeds, per language | A price, a GST rate, a credit limit, a number of days (as the setup plan already forbids) |
| Agent instructions | A short reviewed domain fragment added to the **trusted** block of the prompt: vocabulary, what to ask, what never to say (a clinic assistant never gives medical advice; a real-estate assistant never states a legal opinion on title) | The constant policy, the tool list, any rule that touches approval |
| Modules | Which of a closed list are on: CRM, enquiries, quotes, orders, follow-ups, catalogue, visits, outbox, campaigns, voice, research, connectors | Turning on something the plan does not include, or the global kill switches |

The pack is chosen at **sign-up** (the existing `business_type` step), fixed for the workspace, and changed only by an operator with a recorded reason and a dry-run diff (moving a workspace between packs is not a v1 feature).

### Data model (sketch)
* `packs.pack_versions` (operator-managed, no client grant): `code`, `version`, `status` (`draft | reviewed | published`), `reviewed_by` (a named real owner of that field), `reviewed_at`, `manifest` jsonb (validated by a schema check), `manifest_sha256`. A published row is never edited; a change is a new version.
* `public.workspace_pack` (read-only to members): `tenant_id` (primary key), `pack_code`, `pack_version`, `chosen_at`, `chosen_by`, `source` (`signup | operator`).
* `platform.module_overrides`: `tenant_id`, `module`, `enabled`, `reason`, `expires_at`, `set_by` (part 6; written only by an operator function).
* One function, `app.module_enabled(tenant, module)`: **pack default AND plan entitlement, then operator override**. Every module-gated database function calls it. It is the single place where sections 1 and 6 meet.
* `account_setups.business_type` becomes the pack code (the current check list of three values is replaced by a new migration, because migrations on `main` are append-only).

### API (sketch)
* `GET /v1/tenants/{id}/pack`: `{ pack, version, labels, fields, modules }` for the web.
* `GET /v1/tenants/{id}/modules`: the computed list with the reason for each (pack, plan, override).
* `POST /v1/account/setup` takes a `pack` code from the published list.
* Operator only (part 6): `POST /v1/platform/tenants/{id}/pack` (dry run first), `PUT /v1/platform/tenants/{id}/modules/{module}`.
* Module gating in the router already has a precedent: `CATALOGUE_TOOLS` and `VISIT_TOOLS` decide which assistant tools are offered. The same list is derived from `module_enabled`.

### What already exists on `main`
Sign-up pack field (unused); `item_types` (a tenant's own item vocabulary for manual quotes); `wa_templates` (per business, per language); `followup_templates` (three closed English texts, migration-only); the per-workspace agent switch; the assistant router's tool groups; the business-setup plan with three draft templates and two draft construction packs ("unvalidated guess, needs a real owner").

### What is hard (found in this audit)
* **The requirement vocabulary is saree-themed and fixed** (SM210). For another business the Requirement Agent can only use the code `other`. Making the vocabulary a pack-level, versioned list changes the confirmation rule, the agent and the mapper; it is security-relevant. **Recommendation:** in v1 of packs, non-textile packs run with the Requirement Agent module **off** and people type requirement lines; the per-pack vocabulary is its own later job (see build order).
* **The catalogue is saree-shaped** (part 2).
* **61 web files** mention sarees; label overrides must be done by a key table, not by search and replace, and must not change the textile words.

### Size
* P1 pack plumbing: pack tables, `module_enabled`, `GET pack`, the textile pack as data, labels read by the web for the closed key list, the equivalence proof: **L** (1 to 2 jobs).
* P2 sign-up chooser (published, validated packs only) and the operator switch: **M** (1 job).
* P3 the first non-textile pack as data (suggest construction, whose drafts exist): **S** of engineering, **gated by a real owner's review**.
* P4 per-pack requirement vocabulary: **L** (1 to 2 jobs), only if the first extra business needs it.
* Each further pack: **S to M**, gated by review and a native reader.

### Illustrative content of five packs (unvalidated guesses, to start a conversation with a real owner)
| Pack | Modules likely on | Fields (examples) | Reminders | Sensitive points |
|---|---|---|---|---|
| Real estate | enquiries, follow-ups, visits (site visits), catalogue (listings), campaigns | budget band, location wanted, possession date, listing area and floor | site-visit confirmation, payment-schedule reminder | Property and registration rules in advertising (question below); high value, money words in every message |
| Construction | enquiries, quotes, orders, follow-ups, catalogue | site city, project type, material, unit (the setup plan lists the unit problem: only `piece` and `set` exist) | quote follow-up, delivery date | Units and delivery charges are missing rules (setup plan 12.3) |
| Automobiles | enquiries, visits (test drives, service), follow-ups, campaigns | vehicle model, registration number, odometer, last service date | service due, insurance and PUC renewal, test-drive confirmation | A registration number identifies a person; insurance renewals may touch a regulated activity (question) |
| Schools | contacts (guardians), campaigns, voice | per part 5: child label, class and section | fee due, event, holiday, exam notice | Children's data (part 5); promotional messages not allowed in this pack |
| Clinics | visits (appointments), campaigns, voice | appointment type, doctor, preferred language | appointment reminder, follow-up visit, vaccination due | Health data; the message itself can reveal a condition (question) |

### Risks
* "Any business" creep: each pack is a product to support. Mitigation: validate one extra vertical with one real owner before opening more (build order, step 0).
* A module flag read in the UI but not in the database lets a feature run in a business that should not have it. Mitigation: default deny, the function in the database, a pgTAP matrix that every gated function refuses when the module is off.
* Pack versions and live workspaces: a workspace is pinned to the pack version it chose; upgrading is an explicit operator step with a diff.
* The owner's own "about our business" text is tenant-written. It goes into the **untrusted** block, never into the trusted agent fragment.

### Needs a lawyer or a native speaker
* Native readers for te, hi, kn, ta for every label set, template and disclosure line (the existing fixed texts in these languages are already waiting for one).
* Per vertical, advertising and professional-conduct rules (real estate listings and registration numbers, medical advertising and confidentiality, vehicle insurance distribution): **questions**, in the table above.

---

## 2. Custom fields on contacts and catalogue items, with import mapping

### Decision (recommended)
Add **field definitions** per business and a **side table of typed values**, not a jsonb column on `contacts` and not free-form key-value text.

Why a side table: (a) the hot tables `contacts` and `catalogue_items` and their narrow column grants stay untouched; (b) each definition carries a **personal-data class**, so erasure can delete exactly the personal values; (c) typed columns can be checked by the database; (d) a cap per entity keeps the number of fields small.

### Data model (sketch)
* `public.custom_field_defs`: `id`, `tenant_id`, `entity` (`contact | catalogue_item`), `code` (strict pattern, immutable), `label` per language, `kind` (`text | number | date | choice | multi_choice | yes_no`), `choices` (for choice kinds; the owner adds, never removes, a used choice), `required`, `position`, `pii_class` (`none | personal | child`; set by the pack, changed only by an operator), `mergeable` (may a campaign template use it), `active`, `source` (`pack | owner`). At most 20 per entity per business. Never deleted; made inactive.
* `public.custom_field_values`: `tenant_id`, `entity`, `entity_id`, `field_id`, one typed value column (`value_text` hygiene-checked and length-capped, `value_number` numeric, `value_date`, `value_bool`, `value_choices text[]`), `updated_by`, `updated_at`; unique on `(tenant_id, entity, entity_id, field_id)`; a composite foreign key to the entity so a value cannot cross workspaces.
* Rules in the database: a choice must be in the definition; a `none`-class text value must pass `text_is_clean` and must not contain a contact detail (`text_has_contact`); a `personal` or `child` value is registered with erasure and is removed with its contact.

### API (sketch)
* Definitions: `GET/POST/PATCH /v1/tenants/{id}/custom-fields` (Owner and Admin, second factor to change).
* Values: `PUT /v1/tenants/{id}/contacts/{contact_id}/custom` and `.../catalogue/{item_id}/custom` (the same roles that may edit the entity); reads come with the entity.
* Export: custom columns are appended to the existing CSV export through the existing formula-injection sanitising; a `personal` or `child` column is off by default in an export.

### Import mapping
Today's spreadsheet import (`integrations.import_jobs`, kinds `customers` and `stock`) keeps only the file's SHA-256, the mapping as **column numbers**, counts, and issues with line numbers and closed codes; the file and the rows are never stored; the commit needs the Owner or Admin with a second factor and the **same file and mapping** as the preview.
Extension: a mapping target may be `custom:<code>` for any active definition. The preview reports, per line and per field, a closed issue code (`bad_number`, `bad_date`, `not_a_choice`, `too_long`, `required_missing`). An unknown choice is an issue, never an automatic new choice. The row cap is 500 today; a school roll or a clinic list can be larger (see risks). A saved header-name mapping ("remember my columns") would store header text and is left as an open question.

### What already exists on `main`
Contacts and companies with consent, suppression and erasure; the import pipeline with CSV and XLSX readers, limits and a preview/commit split; the export with sanitising; `item_types` (a limited tenant-defined vocabulary on the quote path); the audit trigger pattern; the erasure registry and the scope handlers.

### What is hard (found in this audit)
`catalogue_items` is saree-shaped: `fabric` (closed list, NOT NULL), `colours` (1 to 4 from a fixed list, NOT NULL), `zari`, `occasions`, `price_band`. A listing, a vehicle or a course cannot use it without lying. **Recommendation:** one new migration that adds an `item_kind` (`saree | generic`) and relaxes the saree-only columns to apply only when `item_kind = 'saree'`; a generic item has a name, a price band or an owner-set price, a stock status, photos, and custom fields. Everything that already reads the catalogue (photos, the "send catalogue" tool, the outbox media) keeps working. This needs an equivalence proof that every existing row and every existing test is unchanged.

### Size
* F1 definitions + values + contact page + API + erasure and inventory entries: **M to L** (1 to 2 jobs).
* F2 import mapping for custom targets and the export columns: **M** (1 job).
* F3 catalogue generalisation (`item_kind`), generic item form, the assistant tool wording: **L** (1 to 2 jobs).
* F4 merge fields in campaign templates: part of the campaigns work.

### Risks
* A custom text field is where a business will put something it should not (a diagnosis, an Aadhaar number, a caste). Mitigation: the pack decides which fields exist; an owner-added field is `text` of 100 characters at most, hygiene-checked, and the screen says what not to enter; sensitive classes are decided by the lawyer (below).
* Merge fields put tenant text into messages. Mitigation: only `mergeable` fields of kind choice, number or date, or short hygiene-checked text; the merged message still goes through the outbox policy (money words and the rest).
* Search and filtering by a custom field is not in v1 except choice and yes/no; an index per field is not created.
* The 500-row import cap.

### Needs a lawyer or a native speaker
Which kinds of field are sensitive in each vertical (health, religion, caste, income, biometrics) and must not be offered; the labels' translations.

---

## 3. Reminder campaigns

### Scope decision
**v1 is reminders to people the business already deals with about their own matter** (a fee due, an appointment, a service due, a payment schedule, a visit). **It is not a promotional broadcast.** ADR 0076 already lists "broadcast and marketing campaigns" as not in v1; this ADR keeps that line. A promotional broadcast changes the legal class of the message (consent, DND, template category, price) and is left until the lawyer and the provider have answered.

### The shape
A campaign is: **a list** (imported), **a template** (approved), **a schedule** (offsets from each person's own date: for example 3 days before, on the day, 3 days after), **a channel order** (WhatsApp first; then, if there is no reply, an item on the owner's **call list**), and **a results screen**.

### Data model (sketch)
* `campaigns.campaigns`: `id`, `tenant_id`, `name`, `kind` (`reminder`), `status` (`draft | approved | running | paused | done | cancelled`), `template_id`, `schedule` jsonb (offsets in days and a time of day inside the business's quiet hours, at most 5 steps, validated), `channel_plan` jsonb (step 1 `whatsapp`; step 2 `call_request` after N hours with no reply or no delivery; at most 3 steps), `created_by`, `approved_by`, `approved_at`, `approved_sample_sha256`.
* `campaigns.recipients`: `campaign_id`, `contact_id`, `due_date`, `amount_paise` (optional; a number from the list, never calculated by a model), `row_hash`; unique on `(campaign_id, contact_id, due_date)` so a re-import adds nothing twice.
* `campaigns.steps`: one row per planned message or call-list item: `recipient_id`, `step_no`, `kind`, `scheduled_for`, `outbox_message_id`, `call_request_id`, `status` (`planned | queued | sent | blocked | failed | skipped | replied`), a closed `reason`.
* **Every message is an ordinary outbox message.** The scheduler worker materialises due steps through the same core function that visit reminders use (`app.outbox_submit_core`), with a **message id derived from (campaign, recipient, step, due date)**, so a retry or a second worker cannot duplicate (the `visit_reminders` table is the precedent: unique on visit, kind, start time).
* Results are **derived**: counts from `outbox_messages`, `outbox_events`, `integrations.wa_message_status` (sent, delivered, read, failed), inbound replies after the send, and call-request outcomes. No message text is stored in an aggregate.

### Reuse of the outbox policy (nothing is rebuilt)
Opt-in or contact history; STOP in en, hi, te, kn (suppression is checked again at approval and at dispatch); quiet hours per business (default 21:00 to 09:00, set 19 to 23 and 7 to 10); the per-customer daily limit (default 3, 1 to 20, counted over the India day, **shared with every other message**, so two campaigns on one day can block each other and the results say `daily_limit`); suppression keys; erased contacts; the global kill switch and the business's automatic-sending switch; the first-message AI-disclosure line; the 24-hour window (outside it, only an **approved template**); the audit trail.

### Three decisions the owner must make (with my recommendation)
1. **Money in a bulk message.** ADR 0066 holds any message with money words for a person's approval. Approving 300 fee reminders one by one is not workable. **Recommendation:** the Owner (second factor) approves the **campaign**: the fixed template, the count, the total, and a rendered sample (the first, the longest, the highest amount and three random messages). The amount comes only from the imported list, as a number with a cap, in a fixed slot of a fixed template. Any change to the list or template after approval returns it to draft. Hard blocks (STOP, no consent, quiet hours, limits, kill switch) still apply to each message. This is a change to ADR 0066's rule and needs the owner's explicit decision and the lawyer's view.
2. **Consent for an imported list.** The current policy blocks a contact with **no opt-in and no contact history** (`no_opt_in`). A newly imported list has neither, so every row would be blocked. A bulk "I attest that these people gave me their number" button would be a legal act the product should not perform quietly. **Recommendation:** a recorded **attestation** per import (who, when, the wording shown, the basis the owner claims, a count) written to the consent ledger with an evidence reference, and the lawyer decides the wording and whether a utility reminder to an existing customer needs more. Until then the results show `blocked: no consent` honestly.
3. **The call step.** Today every call request is approved by the Owner one by one and a human places the call through the bridge. **Recommendation:** step 2 creates **call requests** that wait on a **call list** screen; a person approves, connects and records the outcome. Nothing dials by itself. Automated voice calls are part 4 and are excluded from v1.

### API (sketch)
`POST /v1/tenants/{id}/campaigns` (draft) · `POST .../campaigns/{cid}/list/preview` and `/commit` (the import pipeline, kind `campaign_list`, with `due_date` and optional `amount` targets) · `POST .../campaigns/{cid}/preview` (render the samples) · `POST .../campaigns/{cid}/approve` (Owner, second factor) · `POST .../pause`, `.../cancel` · `GET .../campaigns/{cid}/results` (counts by status and closed reason, by day) · `GET .../recipients?status=` · `GET /v1/tenants/{id}/call-list`.
New closed values (new migration, because the lists are checks): `wa_templates.purpose` gains `reminder`; outbox `category` gains `campaign_reminder`.

### What already exists on `main`
The outbox and its policy and kill switches; WhatsApp adapter, templates, delivery statuses and the 24-hour window; the scheduler worker with visit reminders as the idempotency pattern; call requests and the Exotel bridge (09:00 to 21:00 India time, an erased or stopped customer refused); the spreadsheet import; per-business quiet hours; the daily limit; the audit trail; the status card and heartbeat.

### What is missing
Campaign tables; the `reminder` purpose; campaign-level approval; the materialising step in the worker; the call list screen; the results screen; any pacing of sends (the WhatsApp adapter does not pace itself; Meta's per-number limits and coexistence cap of 20 messages a second are noted in ADR 0076).

### Size
* C1 data model, import target, template purpose, approval, pgTAP matrix: **L**.
* C2 worker materialisation, idempotency, pause and cancel, pacing, the equivalence proof that visit reminders are unchanged: **L**.
* C3 results (derived) and the call list: **M**.
* C4 web screens (list import, template, schedule, approve, results, call list): **M to L**; the screens are web work for the other lane.
* About **4 to 5 jobs** in total.

### Risks
* A bulk sender damages the business's WhatsApp quality rating and number (Meta's quality tiers and limits are not modelled; question for the provider).
* Wrong due dates in a list are sent as truth: the preview shows a sample and a date-range summary, and the approval binds to a hash of the list.
* Erasure during a run: a recipient whose contact is erased is skipped (`erased`); STOP during a run blocks the rest at once (the existing trigger).
* Two campaigns and the daily limit.
* Cost per template message (utility versus marketing categories) is not verified here.

### Needs a lawyer or a native speaker
The attestation wording; whether a reminder is a "service" or "promotional" message in each channel; DPDP notice for reminders; the Telugu, Hindi, Kannada and Tamil reminder templates, the STOP words of each language (a first draft already waits for a reader), and how amounts and dates are spoken and written.

---

## 4. Voice settings

### What exists
Speech to text and text to speech behind interfaces (providers off by default; Sarvam, Bhashini, Google, AI4Bharat adapters), the fair-use accounting models, the bake-off tool, and the owner's own spoken questions to the assistant. **No automated call to a customer exists, no per-business voice setting exists, no voice is cloned.** A call to a customer is a human call through the bridge.

### Decisions (recommended)
1. **Settings per business** (Owner, second factor): a default voice per language (en, te, hi, kn, ta) chosen from a closed, operator-managed list of voices whose quality a native speaker has marked acceptable; a speaking speed; the call hours (default 09:00 to 21:00 as in the bridge, never wider); recording off.
2. **The AI-disclosure line is fixed, not optional.** Every spoken or audio message that is produced by the system opens with a short line in the customer's language saying that it is an automated assistant of the named business. The business can choose only from reviewed wordings and supplies its own name. It cannot be removed. (The outbox already enforces this for the first WhatsApp message.)
3. **Voice notes before voice calls.** First use: a reminder or an update sent as a WhatsApp **audio message** made by text to speech (an outbox media message; no telephony needed). Second use, only after the questions below are answered: an automated outbound call.
4. **Owner-voice cloning is not in any v1.** If it is ever built it needs: a recorded, dated consent of the **speaker** (the owner or the named person only; never a customer or a third party) with the exact purpose and scope; a revocation that deletes the voice at the provider and here; the provider's retention and training terms read and accepted by the owner; the disclosure line still spoken; a rate limit and an audit entry for each synthesis. The risk (a cloned voice used to deceive) is the reason it comes last.

### Data model (sketch)
* `voice.voices` (operator): `code`, `provider`, `language`, `label`, `reviewed_by` (a native speaker), `reviewed_at`, `active`.
* `public.voice_settings`: `tenant_id` (primary key), `speed`, `call_from_hour`, `call_to_hour` (within 9 to 21), `updated_by`.
* `public.voice_choices`: `tenant_id`, `language`, `voice_code`.
* `voice.disclosures` (operator, reviewed): `language`, `version`, `text` with one business-name slot.
* Later, only if cloning is approved: `voice.clone_consents` (subject, purpose, scope, text version, sample hash, recorded at, recorded by, revoked at, provider voice id).

### API (sketch)
`GET/PUT /v1/tenants/{id}/voice/settings` · `GET /v1/tenants/{id}/voice/voices` · `POST /v1/tenants/{id}/voice/preview` (one short synthesis under the existing fair-use ledger, rate-limited) · the audio reminder is an outbox message with a media part.

### Questions for the telephony provider, the lawyer and TRAI's rules (to check; none is asserted)
The framework named in ADR 0080 is the TCCCPR 2018 and its amendments, the DLT platform, the DND/NCPR registers and number series. Secondary sources read on 2026-10-13 say promotional calls use the 140 series, and that TRAI has set the 1600 series for service and transaction calls by financial-sector entities and government; the regulation text was not read. Questions:
1. Is an automated, pre-recorded or AI-voice call to an existing customer about their own fee, appointment or service a **service/transactional** call or a **promotional** one, and who decides: our classification, the provider's, or the DLT scrubbing?
2. Who must register: **each business** as a principal entity with its own header and content templates, or can the platform register once and send for many? What does the telephony provider require?
3. Which **number series** may an AI-voice call use for a business that is not in the financial sector or government? What does the provider provision, and what do recipients' phones show?
4. Is a **voice script** registered like an SMS content template? Is a consent template required?
5. Is a **DND/NCPR scrub** required before a service call to an existing customer? Does a customer's WhatsApp consent cover a voice call (our ledger keeps `phone_consent` separately)?
6. Do the call-hour limits (the bridge uses 09:00 to 21:00 for every call, the conservative reading) apply to service calls?
7. Is there a duty to **disclose** that a call is automated? (We will disclose anyway.)
8. May a call be **recorded**, with what notice, for how long, and is the recording personal data under DPDP?
9. Does the provider's contract allow AI-generated voice and automated dialing for our use? Who carries the scrubbing and the complaints?
10. Frequency caps per number per day, and the handling of a "stop calling me" in speech (voice STOP).
11. Does a **missed call that triggers a call back** change the class of the call?

### Size
* V1 settings, voices list, disclosure, preview: **M** (1 job).
* V2 audio-message reminders through the outbox: **M** (1 job, after campaigns).
* V3 automated outbound calls: **L** and **blocked** on the answers above and a paid telephony approval.
* V4 voice cloning: **L** and **blocked**, later.

### Risks
Quality of Indian-language voices (names, amounts in lakh and crore, code mixing); a call or audio message mistaken for a human (the disclosure line is the control); provider terms; cost per minute (the fair-use ledger already counts audio seconds).

### Needs a lawyer or a native speaker
All of the questions above (lawyer and provider); every voice, disclosure line and script in each language (native speaker); the consent wording for cloning.

---

## 5. Children's data (the school case)

### Facts as read (secondary sources, 2026-10-13; the official text and the Fourth Schedule conditions were **not** read; rule numbers differ between sources)
* The DPDP Act 2023 defines a child as a person under 18. Section 9 requires **verifiable consent of a parent** before processing a child's personal data, and bars tracking or behavioural monitoring of children and targeted advertising directed at them, and processing likely to cause harm. The DPDP Rules 2025 set how parental consent is verified and list classes of fiduciary (commentary names schools, hospitals, day-care and child transport) that get **limited, conditional** relief from some of Section 9. Sources: [SCC Online summary of the Rules](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/), [Bar and Bench on the draft Rules](https://www.barandbench.com/law-firms/view-point/childs-personal-data-and-privacy-analysing-the-draft-dpdp-rules-2025), [dpdpa.com rule 12](https://dpdpa.com/dpdparules/rule12.html), [dpdpa.com rule 10](https://dpdpa.com/dpdparules/rule10.html), [K&S on children's data](https://ksandk.com/md/data-protection-and-data-privacy/childrens-data-protection-under-indias-dpdp-rules/).

### Decisions (recommended): the minimum
1. **The school is the data fiduciary; we process on its behalf** (the same role split as `data-inventory.md` section 1). A written processing agreement is needed (lawyer).
2. **The person we message is the parent or guardian, an adult.** A child is never a contact: no child phone number, e-mail address or social handle, ever.
3. **A child is a `dependant` record with the least possible fields:** `child_label` (a first name or initials, up to 30 characters, the school's choice), `class_section` (up to 10 characters), an optional school-assigned `admission_no` (for the school's own reconciliation), and the link to the guardian. **Never stored:** date of birth, photograph, address, Aadhaar or other identity numbers, health, religion, caste, income, marks, attendance, behaviour notes, parents' occupation.
4. **No monitoring.** No attendance, performance or behaviour features, no score or ranking of a child, no "risk" flags. Delivery and read receipts on a **parent's** message are message status, not a child's behaviour; the lawyer confirms.
5. **No marketing.** The school pack allows service reminders only (fee due, event, holiday, exam notice); promotional campaigns are disabled in this pack.
6. **Child fields never reach a model, a log line, a metric, an error message, an export (off by default) or a search index.** A test feeds a child record through every agent and assistant path and proves absence (the same style as the containment evals).
7. **The real-data gate for a school workspace opens only after the children's part of the DPDP review is filed.** Synthetic children only until then.
8. **Retention and erasure.** Erasing a guardian erases their dependants (a scope handler in the erasure registry); a retention rule (the school's academic year plus a stated number of months, set by the lawyer) removes dependants automatically (`privacy.retention_settings` is the precedent). Every child column is in `data-inventory.md`.
9. **Adult students.** A student aged 18 or over is the contact themselves; the pack handles the switch by a date the school enters, not by storing a birth date (open question: how the school knows).

### Data model (sketch)
`public.dependants`: `id`, `tenant_id`, `guardian_contact_id` (composite foreign key), `kind` (`child`), `child_label`, `class_section`, `admission_no`, `created_at`, `archived_at`. Custom fields with `pii_class = 'child'` attach to a dependant only if the pack lists them, within the minimum above.

### API (sketch)
`GET/POST/PATCH /v1/tenants/{id}/contacts/{cid}/dependants` (Owner, Admin; Sales only if the school allows). The campaign recipient list for a school is by guardian, with a dependant chosen for the merge.

### What already exists on `main`
Erasure by scope and the registry; retention settings and runs; the data inventory; the real-data gate; consent ledger per channel; phone-first contacts (a guardian with only a phone works).

### Size
Dependants table + API + erasure + retention + the model-absence tests: **M to L** (1 to 2 jobs). It builds on custom fields and campaigns, so it comes after them. Calendar time is dominated by the lawyer.

### Risks
A school's staff will paste more than the minimum into a note: there is no free-text note on a dependant. A class list is large: the 500-row import cap. A reminder naming the child's first name in a group chat or a shared phone reveals the child; the message wording is kept short and sent to the guardian only. The product must not become a student information system.

### Needs a lawyer
Who verifies parental consent (the school, which knows the parents, or us); whether the school pack qualifies for the conditional relief and on what conditions; whether fee and event reminders are within it; retention period; the processing agreement; the guardian notice wording in each language; cross-border processing for any model or voice provider (nothing about a child goes to either under this design).

---

## 6. Admin console and billing

### 6a. Operator identity, roles and the audit log

**Today** operators are people with the database owner role running `app.operator_*` functions. That does not scale to several staff, leaves no operator audit log of its own, and makes a typing mistake a production incident.

**Decisions (recommended)**
1. **An operator is an account with no workspace membership** (a trigger refuses one, as for the scheduler and channel principals), registered in `platform.operators` with a role and `active`, and required to be at the second-factor level for every action.
2. **Roles (platform, separate from the four workspace roles):**

| Role | May |
|---|---|
| `support_read` | see the tenant list, plan, module state, usage percentages and health, from counts only; **no customer data of any kind** |
| `support` | the above, plus resend an invitation, reset a member's second factor (with a ticket reference), pause or resume a workspace |
| `billing` | the above for billing: plans, invoices, credit notes, refunds up to a limit |
| `admin` | module overrides with an expiry, plan changes, pack changes, the kill switches, open or close the real-data gate |
| `platform_owner` | operator accounts, limits, and approval of a second person's action |

3. **Four eyes** (a second operator approves) for: opening a real-data gate (after its four prerequisites), deleting a workspace, a refund above a limit, a plan override longer than 30 days, and changing a kill switch.
4. **Every operator action writes `platform.operator_audit`**: operator, action, tenant, a required reason (up to 300 characters, hygiene-checked), the ticket reference, the request id, the closed before and after values. Append-only like `audit_events`, enforced by triggers for every role. The workspace's Owner can read the rows that concern their own workspace as a **"support access log"** (this is row (b) in the setup plan).
5. **No access to customer data by default.** If support ever needs to see a workspace's data, it is a **time-limited grant by that workspace's Owner**, scoped, logged and revocable (the setup plan's section 5 design). Until counsel has reviewed it, support is advice only.
6. **The console is a separate surface.** A route group served on its own host (for example `admin.<domain>`), its own cookie scope, not reachable from the customer app, and ideally a separate Cloud Run service from the same image with `PLATFORM_ADMIN_ENABLED` on only there and an access gateway in front (Cloudflare Access has a free tier for a small team; price and terms unverified). The customer-facing API process does not mount the platform router at all.
7. **The existing `app.operator_*` functions stay** for the command line; the console calls thin wrappers that add the operator check and the audit row, so there is one code path.

**Screens (sketch):** tenant search and detail (plan, pack, modules with reasons, usage percentages, last activity, flags); actions with a reason field; billing (subscriptions, failed payments, invoices, refunds); packs (published versions, reviewer); platform health (the heartbeat and status card); the kill switches; the operator audit viewer.

**API (sketch):** `/v1/platform/*` only (tenants, plans, modules, packs, flags, operators, audit, billing), each requiring an operator token at the second-factor level.

### 6b. Plans, modules and fair use
* `platform.plans`: `code`, `name`, `monthly_price_paise`, `yearly_price_paise`, `modules` (closed list), `limits` (members, AI allowance, campaign messages a month, voice seconds a month, catalogue photos). The four existing plan codes stay; a new migration replaces the check list. `plan_ai_allowances` becomes one column group of this table (or stays and is read by it).
* `app.module_enabled` (part 1) reads plan modules, the pack and overrides.
* **Fair use** extends the existing pattern from `ai_usage` (a percentage, a state of `ok | warn | paused`, both a day and a month window, shown to Owner and Admin, no paise or tokens shown) to campaign messages and voice seconds. "Unlimited" is never promised in the plan names or the pages. The fair-use wording is for the lawyer.
* A trial needs an end date and a defined state after it (today: none). Decision needed (below).

### 6c. Billing

**Interface first.** A `BillingProvider` port with a fake, as with every provider here: `create_customer`, `create_subscription(plan, interval)`, `change_plan`, `cancel(at_period_end)`, `verify_webhook`, `fetch_payment`. Adapters: Razorpay Subscriptions and Cashfree Subscriptions; **one** is chosen after the owner compares fees and onboarding. Both are already known to the repository for payment links (ADR 0080) with webhook signature checks, the registered worker account, and replay-safe digests; the same patterns are reused.

**What the sources said (read 2026-10-13, secondary, 2021 to 2024, check before relying):** the RBI e-mandate rule allows recurring card or UPI debits without additional authentication up to Rs 15,000 per transaction (as updated in 2022); a higher limit of Rs 1 lakh was proposed or announced in December 2023 for some categories; Razorpay's UPI mandate defaults were described as Rs 5,000. Our plans are well below these amounts. Cashfree Subscriptions: **nothing found** in this search; read its documentation. Alternative that avoids mandates: **annual prepayment** as a normal payment, with a reminder before renewal.

**Tables (sketch, schema `billing`):**
* `billing.accounts`: `tenant_id`, `billing_name`, `billing_email`, `gstin` (validated by the existing GSTIN checker), `state_code`, `address` (business address), `provider_customer_id`.
* `billing.subscriptions`: `tenant_id`, `plan`, `interval`, `provider`, `provider_subscription_id`, `status` (`trialing | active | past_due | paused | cancelled`), `period_start`, `period_end`, `cancel_at_period_end`, `grace_until`.
* `billing.invoices`: `id`, `tenant_id`, `fy`, `number` (gapless per financial year, assigned under an advisory lock), `period`, `taxable_paise`, `cgst_paise`, `sgst_paise`, `igst_paise`, `total_paise`, `status` (`draft | issued | paid | void | credited`), `issued_at`, `pdf_path`; `billing.invoice_lines`; `billing.credit_notes`; `billing.payments`.
* `billing.webhook_events`: digest of the raw body for replay safety (as `integrations.webhook_events`).
* **All amounts are integer paise and all tax is deterministic code. A model never computes or words an amount.** The tax split (CGST and SGST for the same state, IGST across states) follows from the state codes; the rate, the service code and any e-invoice duty come from the accountant (below).

**Dunning and the end of a trial:** a failed payment sets `past_due` with a stated grace period (a decision), then **read-only mode** (no sending, no new agent runs, data and export still available), then a long stated retention before any deletion. Data is never deleted for non-payment inside a stated window (DPDP retention and the export duty from ADR 0075 stay).

**Owner-facing screens:** plan and usage, change or cancel, invoices (download), billing GSTIN, payment status, the support access log.

**API (sketch):** tenant: `GET /v1/tenants/{id}/billing`, `POST .../billing/subscribe`, `POST .../billing/cancel`, `GET .../billing/invoices`; public: `POST /v1/webhooks/billing/{provider}` (signature, raw body cap, replay digest, through the registered worker account); operator: `/v1/platform/billing/*`.

### What already exists on `main`
`tenants.plan`, `billing_anchor_at`, `workspace_limit`; `plan_ai_allowances` and `ai_usage`; `platform_flags`; the `app.operator_*` functions; `audit_events` and its triggers; the GSTIN checker and the shop's own GSTIN; webhook handling, signature checks and replay digests (ADR 0080); the registered worker principal; the exports and privacy tools; the hosted verifier. **Not present:** an operator account or role, a platform audit log, a console, plans mapped to modules, a billing provider interface for our revenue, subscriptions, invoices, a seller GSTIN, invoice numbering, a PDF writer.

### Size
* A1 operator identity, roles, platform audit, tenant list read-only, the support access log: **L** (security-relevant).
* A2 console web (tenants, actions, audit viewer, flags): **M to L**.
* B1 plans and modules tables, `module_enabled`, fair-use extension (shared with part 1): **M**.
* B2 `BillingProvider`, fake, subscriptions, webhooks, replay safety: **L**.
* B3 GST invoices, numbering, credit notes, PDF (a PDF library or print-to-PDF is a new dependency, to be explained and approved): **L**.
* B4 dunning, grace, read-only mode, trial end: **M**.
* B5 owner billing screens: **M**.
* About **7 to 9 jobs**, with the accountant's answers as the long pole.

### Risks
* The console is the most powerful surface in the system: separate host, access gateway, second factor, four eyes, no customer data, a full operator audit; a compromised operator account must not read a customer.
* GST errors are legal errors: the invoice rules need the accountant before B3.
* A provider account needs the owner's business entity, KYC and, for GST invoices, our own GST registration; ADR 0017 forbids opening accounts until the owner approves.
* Webhook replay, double charge, plan changes mid-period (proration is a policy decision), refunds, price changes and existing subscribers.
* A read-only mode that is bypassed by an agent or the worker: the module function must also refuse them.

### Needs a lawyer or an accountant
* **Accountant:** whether and when we must be GST-registered; the rate and the service accounting code for software subscriptions; place of supply and the CGST/SGST/IGST split; the invoice format and number series; credit notes; whether e-invoicing applies to us; TDS if business customers deduct; foreign-currency customers (not in scope).
* **Lawyer:** terms of service, the refund and cancellation policy, the fair-use clause, the data processing agreement, the support-access grant, the grace and deletion windows, consumer-law duties for subscriptions.
* **Provider:** whether the provider issues tax invoices for the subscription or only receipts; recurring-payment limits and failure handling for UPI and cards.

---

## Decisions the owner needs to make
1. Approve the shared principles, in particular "packs may only make a business stricter" and "default deny for modules".
2. Which **one** extra vertical to validate first, and **which real owner** will review it. (The sign-up list already has `construction`, and the setup plan has drafts for it.)
3. Campaign money rule (part 3, decision 1) and the consent attestation (decision 2): your decision, then the lawyer.
4. v1 campaigns are **reminders only**; promotional broadcasts stay out until the lawyer and the provider answer.
5. AI outbound calls and voice cloning stay **out of v1** (recommended).
6. The trial: an end date, and what happens after it.
7. The billing provider (Razorpay or Cashfree), after you compare fees and onboarding, and the owner's business entity for it.
8. Whether the console is a separate service behind an access gateway (recommended).

## Recommended build order after Customer Zero
Customer Zero live and stable comes first: the hosting rehearsal (`hosting-rehearsal-owner.md`), the DPDP review, the real-data gate, WhatsApp live. Nothing below changes how Customer Zero works (principle 4).

| Step | Work | Why here | Jobs |
|---|---|---|---|
| 0 | Start the **long-lead people work now**: the accountant (GST, invoices), the lawyer (DPDP including children, TCCCPR, terms, processing agreement), native readers for te, hi, kn, ta, the telephony provider's answers, Meta business verification and template categories, and **one real owner** of the first extra vertical | Calendar time, not engineering, decides the schedule | 0 |
| 1 | **Platform base:** plans and modules (`module_enabled`), pack plumbing with the textile pack as data, the equivalence proof | Everything else is gated by it | 2 to 3 |
| 2 | **Operator identity, operator audit, read-only console, support access log** | Before a second business pays or signs up; replaces SQL by hand | 3 to 4 |
| 3 | **Custom fields** on contacts, then the import mapping, then the **catalogue generalisation** | The first extra vertical needs its own words and fields | 4 to 5 |
| 4 | **Billing:** provider interface and fake, subscriptions, webhooks, invoices, dunning (can run in parallel with step 3 in another lane) | Before the first paying external customer; blocked on the accountant | 5 to 7 |
| 5 | **First extra pack, reviewed by its real owner**, opened to a closed trial | Proves the pack model with one real business | 1 |
| 6 | **Reminder campaigns** (WhatsApp, then the call list), results screen | The first feature several businesses ask for; blocked on the consent and money decisions | 4 to 5 |
| 7 | **Voice settings** and **audio reminders** | Needs campaigns and the outbox media path | 2 |
| 8 | **Per-pack requirement vocabulary**, only if the first extra business needs the Requirement Agent | Security-relevant; do it on demand | 1 to 2 |
| 9 | **School pack** with children's data | After custom fields, campaigns, and the lawyer's children's review | 2 to 3 |
| 10 | **More packs** (real estate, automobiles, clinics), one at a time, each with a real owner | Each is data plus review | 1 each |
| 11 | **AI outbound calls**, **owner-voice cloning** | Legal- and provider-gated; may stay out of scope | 3 to 5 each |

Total engineering: about **27 to 40 jobs** over the parts above, before the per-vertical packs. The people work in step 0 is on the critical path for steps 4, 6, 9 and 11.

## Consequences
* **Migrations this plan would need, all new files (append-only):** replace the `account_setups.business_type` and `tenants.plan` checks (and the three-value `Literal` in `app/tenancy/models.py` and the sign-up form that read the same list); new schemas `packs`, `platform`, `campaigns`, `billing`, `voice`; `wa_templates.purpose` and outbox `category` gain values; `catalogue_items` gains `item_kind`; the outbox policy gains campaign-level approval. Each replaced function that the pgTAP copy tests pin (`test_migration_copies.py`) is replaced as a full copy.
* **Rules this ADR would change:** ADR 0066's money rule for a campaign template (decision 1 of part 3); ADR 0061's one-plan-no-modules model; ADR 0015's "operator is a database role holder".
* **New pgTAP 06 allow-list entries** for every client-executable function; **new erasure registry entries and inventory rows** for every table holding a person's data.
* **Nothing in this ADR is built.** No pack, field, campaign, voice setting, operator, plan or invoice exists after this change.

## Not decided here
The price of any plan; the exact fair-use numbers; the GST treatment; the legal class of reminders and calls; the hosting split of the console; the second extra vertical; whether the web becomes a single multi-pack build or per-pack bundles; the Requirement Agent's vocabulary for other businesses.

## Sources
In the repository (read 2026-10-13): migrations `20261031090100_ad_d2_open_signup`, `20261103090000_ak2_ai_allowance`, `20261106090000_at_outbox`, `20261109090000_aw_scheduler`, `20261110090000_ay_catalogue`, `20261114090100_bi_import_jobs`, `20261117090000_br_whatsapp`, `20261120090000_bz_connectors`, `20261121090000_ca_gstin`, `20261004120100_t002_audit_events`, `20261029090000_manual_price_slice1`; ADRs listed at the top; `docs/plans/business-setup-and-templates-plan.md`; `docs/data-inventory.md`; `docs/pre-pilot-checklist.md`.
Outside (web search, 2026-10-13, secondary sources; **the laws and rules themselves were not read**): DPDP Rules 2025 on children: [SCC Online](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/), [Bar and Bench](https://www.barandbench.com/law-firms/view-point/childs-personal-data-and-privacy-analysing-the-draft-dpdp-rules-2025), [dpdpa.com rule 12](https://dpdpa.com/dpdparules/rule12.html), [dpdpa.com rule 10](https://dpdpa.com/dpdparules/rule10.html), [K&S Partners](https://ksandk.com/md/data-protection-and-data-privacy/childrens-data-protection-under-indias-dpdp-rules/). TRAI number series: [DT Next on 1600 and 140 series](https://www.dtnext.in/news/business/phone-calls-from-1600-number-series-cannot-be-blocked-dnd-app-can-block-calls-from-140-series-trai), [Tribune India](https://www.tribuneindia.com/news/business/telecom-regulatory-authority-of-india-clarifies-framework-for-1600-and-140-number-series/), [DoT notice](https://dot.gov.in/node/30182). Recurring payments: [PhonePe article on UPI AutoPay, e-NACH and cards](https://business.phonepe.com/articles/how-to-accept-subscription-payments-in-india-upi-auto-pay-vs-e-nach-vs-cards), [Chargebee on Razorpay and the RBI e-mandate](https://chargebee.com/docs/razorpay-rbi-e-mandate.html), [EximPe on UPI AutoPay limits](https://eximpe.com/blog/saas/upi-autopay-for-saas-setup-limits-and-what-global-founders-need-to-know). Not found: Cashfree Subscriptions documentation; TRAI wording on "implicit" and "explicit" transactional classes; the Fourth Schedule conditions of the DPDP Rules.
