# T008 plan: Requirement Agent

Status: **ACCEPTED 2026-10-05 with the owner's decisions and changes A-J below** (this text is the accepted version). Read first: CLAUDE.md, ADR 0013 (agents; its T007
notes: reservations, cost cap, open reservations, what the caps do not do), ADR 0014 (erasure), ADR 0015 (real-data gate), ADR 0017 (local-first, provider approval),
`docs/plans/t007-research-agent.md`, `docs/plans/roadmap.md`, `docs/plans/t009-quote-engine.md` and `docs/plans/t010-followup-cadence.md` (lane C).
Rules in force: synthetic data only, fakes only, **no live provider and no key**, no deployment, no new dependency without a reason, one ticket at a time, no push.

## Owner decisions (2026-10-05)
1. Scrub contact details before storing; the original text is **not kept** anywhere.
2. Clarifying questions come from templates, never from the model.
3. Sales, Admin and Owner confirm; a viewer reads.
4. **To CONFIRM a requirement: saree type + quantity on at least one line, nothing else.** Delivery city, deadline and payment terms are "needed before quote": they are asked
   through questions and tracked by a separate `ready_for_quote` flag, but they do **not** block confirm. Budget, fabric and colour are optional.
5. English and Latin-script Hinglish in the golden set; native script is handled safely only (extraction may abstain).
6. Kept until erased, but a retention rule must be addable later without a big migration (`enquiries.retain_until`, section 3).

## Owner changes A-J (binding)
* **A. Contact scrubber and database guard.** A phone is `+91` / `91` / `0` prefix + 10 digits, or 10 digits starting 6-9 (a single space or hyphen allowed inside and after the prefix);
  plus e-mail addresses. Comma-grouped numbers, Rs / INR / rupee-prefixed amounts, quantities, dates, GSTINs, pincodes and PO / order / invoice numbers are **never** contacts. One
  property test: `scrub(x)` always passes the database guard. Cases include `1,00,00,000`, `Rs 5,00,000`, `50000000`, a GSTIN, `PIN 560001`.
* **B. Confirm is separate from `ready_for_quote`.** Confirm = at least one line with saree type and quantity, each confirmed or corrected by a human. `ready_for_quote` also
  needs delivery city, deadline and payment terms. API and UI show both.
* **C. The model does not supply offsets.** `propose_field` takes the quote STRING. The runtime finds the offsets (exact match after whitespace normalisation, first occurrence); a
  quote that is not found refuses the proposal and counts it. The database still verifies `body[start:end] = quote` (whitespace-normalised).
* **D. Value-in-span check in the runtime** (deterministic): a number or a date must appear in its quote; a closed-vocabulary value needs a word from a small synonym list in the quote.
  Unit tests and eval cases.
* **E. No `requirement_questions` table and no question decision function.** Questions are **derived at read time** from the flags through the templates; the UI shows each text with a
  Copy button; nothing about a question is persisted. ADR 0018 records that persisted drafts belong to the T010 integration.
* **F. Vocabulary:** `saree_type` includes `dharmavaram_pattu` (synonyms: pattu, Dharmavaram silk). The lists are **placeholders for the family to replace**.
* **G. Relative dates** ("next Friday", "by month end") get certainty `implied`; they resolve from `received_at` in **Asia/Kolkata**, documented in the service and the screen.
* **H. Caps align with the quote engine** (`docs/plans/t009-quote-engine.md`, operational bounds): quantity per line 1..10,000 (MAX_QUANTITY_PER_LINE), order lines <= 5 (engine 100),
  a per-piece budget <= INR 1,000,000 (MAX_UNIT_PRICE, 100,000,000 paise), a total budget <= INR 10,000,000 (MAX_CREDIT_LIMIT, 1,000,000,000 paise), net days 0..180
  (MAX_PAYMENT_NET_DAYS), advance 0..10,000 bps. A confirmed quantity can never fail the engine later. A value over a cap is refused at write and at correction, with a fixed message.
* **I. Test hygiene:** integration tests leave no committed audit trap: `make check` resets the local database before the pgTAP step (audit rows are append-only, so tests cannot delete
  them), and the pgTAP canary test is also narrowed. The "98765" failure cannot recur.
* **J. The paste-an-enquiry screen stays** (section 8): paste, see what was stored, confirm / correct / reject each field.
* **Process:** between commits `make check-fast` plus the new tests; the **full `make check` and the mutation pass once at the end of T008**; stop for review **after commit 3** (migration +
  write and decision functions).

## 0. What I found in the repository
* **There is no enquiry, RFQ, message, quote or order table.** `public` holds companies, contacts, products, leads, opportunities, consent_events, evidence, evidence_links, claims,
  claim_reviews, the agent tables (agent_runs, agent_run_steps, agent_definitions, agent_limits, agent_model_prices, agent_cost_reservations, tenant_agent_settings, platform_flags),
  import and label tables, icp_config_versions, data_exports, erasure_requests, tenant_data_policy, audit_events, memberships, tenants. Nothing stores an inbound customer message.
* `docs/product.md`: after "Reply/Enquiry Captured", before "Quote Service": parse into a structured requirement, low-confidence fields flagged, "Requirement Agent (human confirms)".
* **Claims are the wrong home**: a claim is one predicate about a company from a fixed allow-list, read by the ICP score. A requirement is structured (lines, quantities, dates, money) and
  belongs to one enquiry, so it gets its own tables.
* Reused as is: the delegated-JWT runtime and its definer-function write path, `agent_definitions` ceilings, `agent_reserve_cost` before every model call, the daily cap, closed-schema
  tools, the per-run delimiter prompt builder, the scripted-model and golden-set harnesses of T007, the M3 review components.
* Every tenant table must pass the catalog guards (supabase/tests/database/06, 11, 15, 21, 39): RLS enabled and forced, composite foreign keys, keyset index, PII column comments, the text-hygiene
  CHECK, an audit trigger, an entry in `tests.tenant_table_registry`, and a registry row (tenant scope, sweep, contact, company) for every PII column. The plan below is built to satisfy them.

## 1. Scope
One run reads **one captured enquiry** (an e-mail or a WhatsApp-style text, synthetic) and proposes a **structured requirement**: up to 5 order lines (saree type, fabric, colour, quantity) and
order-level fields (budget, deadline, delivery city, payment terms). Every proposed value cites a quote of the enquiry text. Deterministic code (never the model) then derives flags (missing,
low-certainty, conflicting), `confirmable`, `ready_for_quote` and the clarifying questions (templates). A human reviews each field (confirm, correct, reject) and confirms the requirement.
**Nothing is ever sent.** No send path, no outbound column, no message provider interface.

## 2. How an enquiry gets in (no channel integration)
A Sales, Admin or Owner user **pastes** the text of an e-mail or WhatsApp message on a lead and picks the channel. The API scrubs contact details (section 3) and stores the scrubbed text. No
mailbox reader, no webhook, no attachment or file parsing (each is a provider and a consent decision for T010 / T012). Synthetic fixtures (e-mails with headers and signatures, WhatsApp-style
fragments, English, Latin-script Hinglish, a little Devanagari / Kannada / Tamil) drive every test.

## 3. Data model (two migrations: schema + guards in commit 1, functions in commit 3)
**`enquiries`** (text immutable, archivable):
`id`, `tenant_id`, `lead_id` (not null, composite FK), `company_id` and `contact_id` (set by a trigger **from the lead**, composite FKs, so erasure can find the enquiries of a contact or a company),
`channel` (`email` | `whatsapp` | `form` | `other`), `received_at` (as stated by the human; not in the future), `subject` (<= 200), `body` (1..6,000), `body_sha256` (trigger), `truncated_from`
(original length when the paste was cut), `retain_until timestamptz null` (unused in T008; indexed; **a later retention rule is a new function and a job, not a table change**), `created_by`,
`created_via`, `created_at`, `archived_at`.
* Clients INSERT directly under RLS (Owner / Admin / Sales; column grant; the API is the normal path and scrubs first). **The database guard** `app.text_has_contact(text)` is a CHECK on `subject` and `body`: text that still holds
  an e-mail address or a phone (the A patterns) is refused (23514). The guard uses the **same regular expressions** as the Python scrubber (one source of truth, generated, compared by a test).
* Immutable except `archived_at` and the registered erasure columns (`guard_immutable_record`); `tenant_id` immutable; no DELETE.
* `subject` and `body` are PII columns: column comments `PII:`, audited by name only, `text_is_clean`, erasure registry rows (tenant: tombstone; contact scope: the contact's enquiries; company
  scope: the company's enquiries; sweep: substring), and a `tests.er_plant` canary.
**`requirements`** (one per extraction run): `id`, `tenant_id`, `enquiry_id` (composite FK), `agent_run_id` (provenance, composite FK, nullable), `status`
(`draft` -> `confirmed` | `superseded` | `discarded`), `schema_version` (1), `confirmed_by`, `confirmed_at`, `created_via`, `created_by`, `created_at`. At most one active (draft or confirmed)
requirement per enquiry (partial unique index). A new run supersedes an older draft; a confirmed requirement is replaced only after a human discards it.
**`requirement_fields`**: `requirement_id` (composite FK), `line_no` (null = order level, 1..5), `field_key` (closed: `saree_type`, `fabric`, `colour`, `quantity`, `budget`, `deadline`,
`delivery_city`, `payment_terms`), typed value (`value_code`, `value_int`, `value_date`, `value_text`, `basis`), `certainty` (`stated` | `implied` | `ambiguous`), `quote` (<= 300),
`quote_start` / `quote_end` (offsets into `body`, set by the runtime and **verified by the database**), `state` (`proposed` -> `confirmed` | `corrected` | `rejected`), the human's
corrected value and `decided_by` / `decided_at`, `created_via`. One field per (requirement, line, key). `quote` and `value_text` (the city) are PII (erasure rows like the body).
* **The database verifies the quote.** The enquiry body is in the database, so the write function checks `body[start:end] = quote` (whitespace-normalised) itself, a limit T007 could not close.
* **No `requirement_questions` table (E).**
Closed vocabularies live in an immutable SQL function `app.requirement_vocab(field_key)` and in `app/requirements/vocabulary.py`; a test asserts the two are equal (as T007 did). `saree_type`:
kanjivaram, banarasi, mysore_silk, paithani, dharmavaram_pattu, (placeholders for the family to replace); `fabric`: silk, cotton_silk, tussar, organza, ...; `colour`: a base-colour list (a shade
maps to a base colour; anything else is `other` plus the quote); `payment_terms`: advance_full, advance_partial, net_days, cash_on_delivery. Each code carries a small **synonym list** used by D.

## 4. Deterministic services: `services/ai-api/app/requirements/` (no model, no I/O)
* `scrub.py`: the contact scrubber (A). `[contact removed]` replaces an e-mail or a phone; nothing else changes.
* `vocabulary.py`: the closed lists and synonyms (F). `normalise.py`: quantity (digits, English number words, "dozen", ranges -> `ambiguous`; cap H), money (INR, "5k", "50,000", lakh / crore, per piece vs total;
  the customer's stated budget, never a price we compute), dates (an absolute date; a closed list of relative phrases resolved from `received_at` in **Asia/Kolkata**, certainty `implied` (G); festival names
  are NOT resolved: `ambiguous`), city (verbatim, trimmed).
* `span.py`: the value-in-span check (D). `quote.py`: whitespace-normalised first-occurrence offset finder (C).
* `policy.py`: `confirmable` (B: a line with saree type and quantity, both confirmed or corrected), `ready_for_quote` (also delivery city, deadline, payment terms, none ambiguous / rejected / missing),
  flags (`missing`, `low_certainty`, `conflicting`), computed from the fields at read time. `questions.py`: closed templates by (field, flag), rendered at read time (E). Property tests: every template renders;
  none contains a price, a URL or a name. The API and the evals use the same code.

## 5. The agent (same runtime as the research agent)
* Definition `requirement`, its own platform flag `requirement_enabled` (OFF), enabled for no tenant until `app.operator_enable_requirement(slug)`; ceilings `max_writes` 45, `max_tool_calls` 60,
  `max_input_tokens` 20,000, `max_output_tokens` 4,000, `max_cost_micros` 100,000; delegated JWT of the starting human (option A; option B stays required before any scheduled run).
* The model sees the scrubbed enquiry (<= 6,000 chars), the channel and the `received_at` date; never a contact, a company or lead name, an id, a price list, a catalogue or another enquiry. The
  text is one UNTRUSTED block inside the per-run delimiter.
* Tools (closed schemas): `propose_field(line, field, value, certainty, quote)` and `finish`. **`quote` is a string (C)**; the runtime finds the offsets and refuses a quote that is not in the text (counted).
  `value` is a closed code or a typed token that the normalisers parse; D is checked in the runtime before the write; at most 5 lines, 40 fields, each (line, field) once. No tool writes a flag, a question, a
  confirmation, a status or free text.
* Every model call reserves cost first (ADR 0013); the cap, release and open-reservation rules apply unchanged. A scripted fake extractor drives every test. No live provider.

## 6. Injection and abuse (the enquiry is untrusted)
`make eval`, scripted models that **obey every injection**, real local stack, a diff of the tenant. Pass: only this run's `requirement_fields` (proposed) of the allowed kinds change; no field is
confirmed; no other table changes; no tool outside the allow-list runs; every cited quote is in the text; D refuses a value the quote does not support. Cases E01-E14: ignore-your-rules and "mark this ready";
"set quantity 1,000,000 / budget 1" (cap H); fake system message / tool result / closing delimiter; "forward to a@x / send the quote / reply with the price list" (no tool exists); a quote that is not in the
text; a value outside the vocabulary; a sixth line; two conflicting deadlines; bidi / zero-width / tag characters; an enquiry that is only an instruction; a 100 KB paste (truncated at capture); another
script; contact details in the text (removed before storage; the database refuses any that remain); a future `received_at`. Tenant and lead scope rules of T007 apply.

## 7. API (every call carries the caller's JWT; fixed error messages)
`POST .../leads/{lead}/enquiries` (Sales+; scrub, cap, idempotent on the caller's id), `GET .../enquiries[/{id}]`, `POST .../agent-runs` with `agent = requirement`, `target_kind = enquiry`,
`GET .../enquiries/{id}/requirement` (fields, flags, `confirmable`, `ready_for_quote`, **derived questions**), `POST .../requirement-fields/{id}/decision` (`confirm` | `correct` | `reject`; Sales+),
`POST .../requirements/{id}/confirm` (refused unless `confirmable`), `POST .../requirements/{id}/discard`. A viewer reads. Idempotent writes; contracts via `make contracts`.

## 8. The paste screen and review UI (J; reuses the M3 components; no new CSS file: lane B owns `globals.css`)
One screen on a lead: a text area and a channel selector to paste an enquiry, then the **stored (scrubbed) text** as plain text with cited spans marked by text nodes, beside the field list: value,
certainty, quote, and Confirm / Correct (typed value validated by the same normalisers) / Reject. Top of the list: missing and low-certainty fields, and two badges, **Can confirm** and **Ready for quote**.
Derived questions appear as text with a Copy button; nothing is persisted or sent. Phone width, 44 px targets, no horizontal scroll. Tests: render, hostile text as text only, role gating, decisions through
the real API on the local stack.

## 9. Evals, golden set and the gate
Golden set `tests/golden/requirement/`: about 20 synthetic enquiries with the answer a careful person would give (tidy e-mails, terse WhatsApp lines, Hinglish, multi-line orders, quantity in words, "by Diwali"
unresolved, per-piece vs total budget, conflicting deadlines, a forwarded chain with an old quantity, a signature with a phone (scrubbed), nothing usable (abstain), injected instructions, Kannada script, an
unrelated message). Report in `make eval`: per field key expected / proposed / confirmed ok / **confirmed WRONG** / corrected / rejected / missing; the flags; the derived questions; `confirmable` and
`ready_for_quote` per enquiry. **Gate:** fails on any wrong confirmed value, a quote not in the text, a D violation, a wrong flag or derived question, any section 6 invariant, or a report change that was not made on
purpose. The scripted model proves the pipeline; real precision needs a real model after the owner's approval.

## 10. Order of commits (one at a time; between commits `make check-fast` + the new tests)
1. **Schema, guards and scrubber:** migration (`enquiries`, `requirements`, `requirement_fields`, `agent_runs.enquiry_id`, `app.text_has_contact`, vocabulary function, RLS, audit, PII comments, erasure registry rows and
   handlers, tenant-table registry, `tests.er_plant`), the Python scrubber and its property tests, pgTAP, `make check` resets the database before pgTAP, this plan.
2. **Deterministic services:** normalisers, vocabulary, span check, quote finder, policy, questions; unit and property tests; no model, no database.
3. **Write and decision functions (FULL-tier security work) + migration:** `start_agent_run` for enquiries, the `requirement` definition and flag, `agent_write_requirement_field`, `decide_requirement_field`,
   `confirm_requirement`, `discard_requirement`; pgTAP, direct-PostgREST attacks. **STOP for review.**
4. The agent on fakes. 5. API and the paste screen. 6. Evals and golden set. 7. ADR 0018, checklist rows, handoff; **full `make check` and the mutation pass once**; stop.

## 11. What I will NOT build (and what the owner must approve before any live use)
Sending of any kind; e-mail or WhatsApp integration; attachments, PDFs, OCR, translation; thread reconstruction; SKU matching or any catalogue lookup; **any price or quote calculation**; order or opportunity
creation; automatic confirmation; model-written questions or any free text from the model stored or shown; **persisted question drafts or an approval state for questions (T010)**; scheduling; enrichment; notifications;
learning from corrections; a Hindi / Kannada template set. Before a first live call (after the owner's written approval): the provider and model id, the `agent_model_prices` row, the provider-side spend cap, a daily
cap, `requirement_enabled` for one named workspace, and a decision on **what enquiry text may be sent to a provider** (names remain in the text; this joins the DPDP / cross-border review of T012). Until then: fakes only.

## 12. How lane C plugs in later (a separate ticket, not T008)
* **Quote engine (`packages/quote-engine`).** `quote(request)` takes `order_lines [{sku, qty, discount_bps}]`, a `price_list`, `customer {kind}` and a `policy {payment_terms, ...}`. A confirmed requirement supplies
  **quantities and customer-stated terms**, not SKUs or prices. The integration adds a **deterministic requirement-to-order-lines mapper** (saree type + fabric + colour -> `products` via `attributes`; a human picks
  when it is ambiguous or unmatched) and assembles the request from the confirmed requirement, the tenant's price list and policy. The customer's `payment_terms` are compared with the policy and flagged for the
  owner, never accepted automatically; the stated budget is used only after the quote to flag "above budget". Because of H, a confirmed quantity (<= 10,000) and net days (<= 180) always fit the engine. `ready_for_quote`
  is the gate the integration reads. The contract is `requirement_v1` (the confirmed fields with types), exported with `make contracts`.
* **Follow-up cadence (`packages/pure/followup_cadence`).** `decide(request)` takes `history [{timestamp, channel, direction, outcome}]`. A captured enquiry is an **inbound** entry (`direction = in`, its `channel`
  and `received_at`), which by the cadence's rule stops automatic follow-up and hands the lead to a human. `enquiries.received_at` and `channel` stay queryable as history; T008 changes nothing else on the lead. A
  clarifying question that a human decides to send later becomes a persisted draft touch in T010.
* Neither integration is built or stubbed in T008.

## 13. Risks
* Names and other personal details remain in enquiry text after contact scrubbing (the limit of names, ADR 0014); a provider sees them at the first live call. Owner decision in section 11.
* The scrubber is deliberately conservative (A): an unusual phone format (for example digits split in groups other than 5+5 or with dots) is not removed. The guard matches the scrubber, so such text is stored. It
  is documented, and the owner's review of real data (T012) decides whether to widen it.
* The runtime finds the quote (C), but a real span may still not support the value; D, certainty labels, human confirmation of every field and the wrong-confirmed gate cover it.
* As ADR 0013 states, the caps and the delegated-token model guard against bugs and honest mistakes, not a malicious member; option B and the provider-side cap stay the real answer before any external customer.
* Scope creep toward quoting: held by the NOT-building list and the `requirement_v1` contract.

## 14. Owner review of commits 1-3: commit 3b (migration `20261015090200`, a new migration; nothing earlier is amended)
1. `public.add_requirement_field` (Owner / Admin / Sales): a human adds a field the extraction missed. Creates the draft if none exists (enquiry row locked, SM208 when a
   confirmed requirement exists), stores the field as `corrected`, decided by the caller, `created_via = 'manual'`, one field per (line, key), the same shape and caps as the agent
   path. The quote is optional; when given it is verified exactly like the agent's. `quote` / `quote_start` / `quote_end` are nullable only for a manual field. The API and the
   screen use it for "add missing field".
2. `agent_write_requirement_field`: a delivery city must appear in its quote (whitespace-normalised, lower-cased). A human correction stays free.
3. A `unique_violation` on `requirements_one_active_key` (a confirm / insert race) becomes SM208.
4. The three functions this ticket replaces (`start_agent_run`, `erase_contact`, `erase_company`) were diffed against their latest earlier definitions: only the T008 lines differ.
   `tests/test_migration_copies.py` keeps it that way (the T008 copy must be the LAST definition, and may only ADD lines apart from a named list).
5. `app.text_has_contact` timing on adversarial 6,000-character inputs is tested (pgTAP 55, unit tests). The e-mail pattern was quadratic on a long run of address characters; the
   same rule now uses linear-time patterns (new definition in 3b, identical to `app/requirements/scrub.py`). Capture only scrubs a bounded head of a paste.
6. Capture strips zero-width and bidi characters and stores the stripped text (`app/requirements/capture_text.py`); the database accepted ZWJ / ZWNJ / LRM / RLM and refused the
   rest (it still does). The cost for Indic scripts, and the switch `KEEP_INDIC_JOINERS`, are in the module's docstring; the default strips them, as decided.
7. `public.requirement_v1` (security invoker): only the confirmed / corrected fields of a CONFIRMED requirement; no quote, no enquiry text. **ADR 0018 records: discarding a
   confirmed requirement must be blocked once a quote depends on it (the T009 integration adds that check), and persisted question drafts belong to T010.**
8. The requirement definition's input ceiling is 40,000 tokens (it was 20,000): a 6,000-character Devanagari / Kannada / Telugu text is up to 18,000 bytes and the reservation bounds a
   call's input by its bytes.
