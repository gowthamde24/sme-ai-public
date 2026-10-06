# T010 integration plan: suppression, consent-aware follow-up, persisted drafts (PLAN ONLY, nothing built)

Status: written 2026-10-06 after T009 for the owner's review. Related: ADR 0005 (consent ledger), ADR 0013 (agents; option A / B), ADR 0014 (erasure; suppression-after-erasure open question 1),
ADR 0016 (second factor), ADR 0017 (local-first), ADR 0018 (requirements; persisted question drafts deferred here), ADR 0019 and 0020-to-be (quotes), `docs/plans/t010-followup-cadence.md`
(lane C's pure package, the contract this plan wraps), `docs/plans/order-conversion.md`, `docs/pre-pilot-checklist.md`.
Reads before building: CLAUDE.md, AGENTS.md, docs/lanes.md, this plan, the cadence plan, ADR 0014 section "suppression after erasure".

## 1. Scope and non-goals

**In scope (one ticket, built in the commit order of section 9):**

1. **Suppression with an HMAC, FIRST.** The hard gate of the checklist ("suppression after erasure, before the first outreach"): when a contact is erased its e-mail and phone vanish, so a re-import of the same address must
   not start with no opt-out. A keyed HMAC of the normalised e-mail and phone is kept (key held OUTSIDE the database), so a re-import is flagged and no draft can be made for it.
2. **A touch log:** what a person actually sent to a lead and what the lead sent back (direction, channel, instant), recorded BY A PERSON ("I sent it", "they replied"). This is the `history` the pure cadence reads.
3. **Cadence policy versions:** immutable, versioned like the quote policy (gap days, max touches, quiet hours, weekdays, holidays, minimum gap, the recipient's fixed UTC offset). Synthetic seed values only.
4. **Follow-up decisions and drafts:** the pinned pure engine (`followup_cadence`, behind one adapter) says wait / draft_followup / stop; a DRAFT is stored (one active per lead and touch number), with closed-template wording; a person approves it; a person says "I sent it".
5. **Persisted question drafts** (ADR 0018 decision 6): the clarifying questions of a requirement, stored with an approval state, for a person to copy.
6. **A task list:** "what is due" for a lead and for the workspace, from real backend state.

**Non-goals (explicit):** sending anything (no e-mail, WhatsApp or SMS provider is called; see decision 7), model-written text (templates only; decision 6), a scheduler or any background run (needs option B first; decision 11),
inbound e-mail parsing, a reply classifier, opt-out detection from message text, DND-registry lookups, contact enrichment, per-customer cadence, A/B tests, and any automatic change to a lead's CRM status.

**What does not change:** a person approves every draft; auto-send stays OFF (product.md); suppression always wins; nothing here reaches a model (so no injection surface is added: no untrusted text goes anywhere but the person's screen).

## 2. Tables and functions

Numbers below are proposals: confirm free SQLSTATEs at build time (today SM001-002, SM100-101, SM201-SM218, SM301-306, SM399, SM401-403 are used). Reserved for this plan: **SM220-SM229**.

### 2.1 Suppression (migration part 1)
* `suppression_keys` (tenant-owned): `id`, `tenant_id`, `kind` (`email`|`phone`), `key_hmac` (64 hex), `key_version` (smallint), `reason` (`opted_out`|`erased`|`do_not_contact`|`bounced`), `source_contact_id` (uuid, NO foreign key: the
  contact may be erased), `created_by`, `created_at`. `unique (tenant_id, kind, key_hmac)`. Append-only (no update, no delete, no truncate); lifting = a separate append-only `suppression_lifts` row (who, when, why) that an
  `app.is_suppressed` read honours, so the history is never rewritten. Classified PII (arguably personal data: DPDP review row).
* `contacts` gain `email_hmac`, `phone_hmac`, `hmac_version` (nullable), written ONLY by the definer function below (column grant revoked).
* `public.record_contact_keys(p_contact_id, p_keys jsonb)` (Owner/Admin/Sales, any aal): the API computes the HMACs of the normalised e-mail / phone with the key from its own configuration and passes them; the function stores them on
  the contact, idempotent.
* `public.suppress_contact(p_contact_id, p_reason, p_keys jsonb)` (Owner/Admin/Sales, any aal: "stop contacting me" must always be recordable, like the consent withdrawal it extends): inserts the keys, withdraws consent on the
  contact (existing function), idempotent.
* `public.lift_suppression(p_key_id, p_reason_text_code)` (**Owner only, aal2**): appends a lift.
* `public.check_suppression(p_keys jsonb) returns jsonb` (read; Owner/Admin/Sales): for a set of HMACs, which are suppressed. Used by the import and by the API before a contact is created.
* `app.erase_contact` (replaced in a new migration, copy test as in `test_migration_copies.py`): refuses (**SM221**) when the contact holds an e-mail or phone and no key for it was recorded, so erasure can never leave no trace.
  **Erasure writes the key row (`reason='erased'`) in the same transaction before the identifiers are removed.**

### 2.2 Touches, policy, decisions, drafts (migration part 2)
* `lead_touches` (append-only): `id` (the caller's, idempotent), `tenant_id`, `lead_id`, `direction` (`out`|`in`), `channel`, `occurred_at`, `recorded_by`, `draft_id` (nullable: the draft this touch fulfils).
  CHECK `occurred_at <= now() + 5 min`. Recording an `in` touch is "they replied" (the engine stops with `human_takeover`).
* `followup_policy_versions` (immutable, versioned, like `quote_policy_versions`): the engine's `policy` plus `recipient_utc_offset_minutes` default 330. Created by `public.create_followup_policy_version` (**Owner, aal2**).
* `followup_drafts`: `id`, `tenant_id`, `lead_id`, `contact_id`, `touch_number`, `status` (`draft`|`approved`|`discarded`|`recorded_sent`), `channel`, `body` (closed-template text, `app.text_is_clean`),
  `policy_version_id`, `engine_version`, `request_text`, `result_text`, `canonical_hash`, `created_by`, `approved_by/at`, `discarded_by/at`, `sent_touch_id`. **One active (draft or approved) draft per `(tenant, lead, touch_number)`** by a partial
  unique index: this is the de-duplication lane C asked for ("`decide()` keeps returning `draft_followup` for the same touch number until an outbound touch is recorded").
* `question_drafts`: `id`, `tenant_id`, `requirement_id`, `question_code`, `line_no`, `text` (closed template), `status` (`draft`|`approved`|`discarded`), decided_by/at. Unique `(tenant, requirement_id, question_code, line_no)` while active.
* Functions (all `SECURITY DEFINER`, `search_path=''`, one overload, `authenticated` only; the role is proven BEFORE anything else is revealed, one generic 42501):
  * `record_touch(p_id, p_lead_id, p_direction, p_channel, p_occurred_at)` (Owner/Admin/Sales, any aal). **A recorded fact is never refused** (a person did send it, or the lead did write): a touch on a suppressed lead is stored and flagged, never rejected.
  * `create_followup_draft(p_id, p_lead_id, p_contact_id, p_channel, p_engine_version, p_request_text, p_result_text)` (Owner/Admin/Sales, any aal). The API ran the pinned engine; the database refuses **SM220** (the contact or its keys are suppressed, or consent is not granted
    for the channel), **SM221** (no recorded key for the channel: an unkeyed contact cannot be contacted), **SM222** (no policy in force), **SM225** (the decision is not `draft_followup`, or it is not due now), **SM226** (the request is not the one the
    database rebuilds from the recorded touches and policy; see section 5), and replays an exact retry.
  * `approve_followup_draft(p_id, p_recomputed_hash)` (**Owner/Admin, aal2**): re-checks suppression, consent and the touch history under lock; **SM224** when the history, the policy or the suppression state moved since the draft (stale); **SM223** when not a draft.
  * `discard_followup_draft(p_id)` (Owner/Admin/Sales on their own, Owner/Admin on any).
  * `record_draft_sent(p_id, p_touch_id, p_occurred_at)` (Owner/Admin/Sales): "I sent it": only for an APPROVED draft; inserts the `out` touch and moves the draft to `recorded_sent`; **SM223** otherwise; idempotent on `p_touch_id`.
  * `decide_question_draft(p_id, p_decision)` and `persist_question_drafts(p_requirement_id)` (Owner/Admin/Sales).

### 2.3 API and web (commits 6-7)
`GET /leads/{id}/followup`, `POST /leads/{id}/touches`, `POST /leads/{id}/followup-drafts`, `POST /followup-drafts/{id}/approve|discard|sent`, `GET /followups/due`, `POST /contacts/{id}/suppress`, `POST /suppression/{id}/lift`,
`GET|POST /requirements/{id}/question-drafts`. The HMAC key is read from configuration ONLY (`SUPPRESSION_HMAC_KEY`, never a default, process refuses to start without it outside development, never logged, never returned, never in a URL).
UI states: Draft, Approved, "Recorded as sent" (a person said so; the system sent nothing), Suppressed, Stopped. No "Sent" by the system, ever.

## 3. Lock order

One order everywhere (extends ADR 0018 decision 9): **contact row, lead row, enquiry row, requirement row, quote row, order row, then the new tables' rows.** The new functions touch only the first two plus their own tables (a lead and its drafts), so they sit at the head of the chain; the
ones that read a quote or an enquiry (the question drafts) take `enquiry -> requirement` exactly like `discard_requirement`. **Invariant to state in the ADR: every writer of a lead's drafts or touches locks the LEAD row first** (so the lead lock alone serialises them and the draft-row lock adds nothing,
the same reasoning as ADR 0018 C04/C07; the mutation notes must say so, not "the FK share lock"). Before building: grep every existing function for a lead lock taken after an enquiry lock (none is expected; a race test proves it).

## 4. Who may do what (role and assurance level)

| Action | Owner | Admin | Sales | Viewer | aal2 |
| --- | --- | --- | --- | --- | --- |
| Record a touch, "I sent it", a reply | yes | yes | yes | no | no (a record of a fact) |
| Suppress a contact ("stop contacting") | yes | yes | yes | no | no (must always be possible) |
| Lift a suppression | yes | no | no | no | **yes** |
| Create a follow-up draft, discard one | yes | yes | yes (own drafts) | no | no |
| Approve a follow-up draft | yes | yes | no | no | **yes** |
| Create a cadence policy version | yes | no | no | no | **yes** |
| Read drafts, touches, the due list | yes | yes | yes | no | no |
| Question drafts: persist, decide | yes | yes | yes | no | no |

A Viewer reads none of it (consistent with quotes). Refusals before the role is proven are one generic 42501; the second factor is checked after the role (a Sales user never learns about it).

## 5. What the database proves and what it trusts

| Property | Proven by the database | Trusted (and why that is acceptable now) |
| --- | --- | --- |
| Tenant isolation, role, aal, the state machine of a draft, one active draft per touch, append-only touches and keys | yes (RLS, definer functions, triggers, partial unique index, pgTAP) | |
| A suppressed key blocks a draft, an approval and a re-import | yes, **for a contact whose keys were recorded**; a draft for an unkeyed contact is refused (SM221) | the HMAC VALUE: the database cannot compute it (the key is outside it by design). A malicious Sales user could record a wrong key through PostgREST. Option A limit; **option B (a sole-purpose service principal holding the only grant to `record_contact_keys`) is required before any external customer** (ADR 0013). |
| Consent granted for the channel (existing ledger) | yes | |
| The follow-up cadence decision (wait / draft / stop, the due instant) | the database rebuilds the engine's REQUEST from the recorded touches, policy and as-of and refuses a different one (SM226), and requires `draft_followup` and due-now in the stored result | the engine's arithmetic (calendar, quiet hours, holidays): the database does not re-implement it (unlike the quote subset). A forged result could only create a draft that an Owner/Admin with aal2 then reads and approves; approval recomputes the hash from current state (SM224). |
| That a person really sent the message | no | "I sent it" is a person's word; the system sent nothing. It is the touch the cadence counts. |
| No contact detail reaches a model | trivially: no model is used | |
| The HMAC never reaches a client or a log | the API never returns it (response models forbid the field) | log redaction test + a canary test on every response and on the access log |

## 6. Test plan (what `make check` must hold at the end)

* **pgTAP:** role matrix for every function (Viewer, Sales, Admin, Owner, another tenant, anon); one generic 42501; aal2 after role; append-only (update, delete, truncate refused for keys, lifts, touches); the partial unique index; every SQLSTATE reached by a hand-made case;
  `erase_contact` refuses without keys (SM221) and writes the key before the identifiers vanish; **after erasure a re-import of the same address is flagged by `check_suppression`** (the gate's own test); column-grant tests (nobody writes `contacts.*_hmac` directly); the catalog guard allow-list (06) and the registry (00001) updated; a copy test for the replaced `erase_contact`.
* **Real stack (API and direct PostgREST):** every new read and write, a Viewer refused, a second tenant sees nothing; every attack: a forged result, a stale approval, a suppressed approval, an unkeyed contact, a key recorded for another tenant's contact, a lifted suppression by an Admin; the response and the log never contain a key (canary on a real key value).
* **Races (two real connections, a psql session holding its locks, as in `test_quote_races.py`):** two people creating the draft for one touch (one wins, the other replays or conflicts, never two); approve vs `record_touch` (the approval sees the new touch or is refused stale); approve vs `suppress_contact` (never an approved draft after a suppression committed first); `erase_contact` vs `create_followup_draft`; lock-probe tests that name the locks they prove, and the invariant of section 3.
* **Python:** the cadence adapter (pinned version, golden vectors by value, independent hash recomputation, fail closed, no new dependency, path appended never first, shallow-path safe); the HMAC adapter (normalisation vectors: case, plus-addressing is NOT collapsed, spaces and `+91` forms of one phone give one key; a different key gives a different HMAC; constant-time compare; refuses to run without a key); template renderer (closed values only, never an enquiry's words); a boundary test that no `app/followup` module imports an e-mail or messaging client.
* **Properties:** touches in any order give the same decision (the engine's own property, re-run through the adapter); the database rebuild equals the adapter's request for generated histories (like `test_quote_engine_equivalence.py`).
* **Web:** the due list, the draft screen, "Recorded as sent", the suppression notice, a Viewer sees nothing and nothing is requested for them, a second-factor-less owner sees how to set it up; nothing says "Sent" by the system.
* **Mutation pass at the milestone (one pass, `PYTHONDONTWRITEBYTECODE=1`, `__pycache__` swept, table in `docs/checklist-notes/A.md`):** targets include the SM220/221/224/225/226 checks, the role lists, `aal2` after role, the suppression check inside approve, the keys-before-erasure order, the unique index, the lead lock, the HMAC normalisation, the key-never-returned filter, and "a Viewer reads drafts" RLS.

## 7. Evidence the plan relies on and risks

* Lane C's cadence package is on main and pinned by golden vectors; the adapter pattern is proven twice (engine, mapper, text).
* Risks: (1) the HMAC secret handling (a leaked key lets someone test whether an address was suppressed: treat as a secret, one key per environment, never in the repo or the browser); (2) normalisation drift (an address written two ways escapes suppression: vectors and a property test; conservative: lower-case, trim, no dot removal); (3) a person never recording "I sent it" so the cadence stays on the same touch (the UI says so and the due list shows drafts waiting for a record); (4) legal: consent and DND rules are the owner's and a lawyer's (checklist rows stay open: nothing here is legal advice and no default legal basis is coded).

## 8. Open owner decisions (each with a recommended default; I proceed on the default if you say nothing)

1. **Suppression key scope.** Default: e-mail and phone only. Alternatives: also a WhatsApp id, or a company-level key. (More keys = more PII-adjacent data.)
2. **HMAC key custody and rotation.** Default: one key per environment in the API's configuration, `key_version` stored, up to two versions checked; no rotation before Customer Zero (rotation after erasure cannot recompute originals, so old keys must stay for checks).
3. **Accept the option-A limit for key recording** (a user with the API can record a wrong key) until option B. Default: accept for local-first and the family pilot; option B before any external customer (already in the checklist).
4. **Who lifts a suppression.** Default: Owner with aal2 only. Alternative: Owner or Admin.
5. **Cadence defaults.** Default: none in code; one clearly synthetic seed (gaps 3, 7, 14 days; 4 touches; quiet 21:00-09:00; Monday to Saturday; offset +05:30) the family replaces. Real values are the owner's (the cadence plan says so).
6. **Draft wording.** Default: closed templates that echo only closed values (a saree type, a count, a date), never a customer's words and never a price; no model. Alternative: model-written drafts later, behind ADR 0017's approval and injection evals.
7. **Sending in T010.** Default: none. An `EmailProvider` interface and a fake exist for T012, with a boundary test that nothing calls them; a person records "I sent it". Alternative: a Mailpit send of an approved draft (adds an outbound path, an idempotency key and a policy gate; I recommend leaving it to T012).
8. **Backdating "I sent it".** Default: the instant may be up to 7 days in the past and never in the future (5 minutes of clock slack).
9. **Replies.** Default: a person records "they replied" (an `in` touch); no parsing of message text.
10. **Persisted question drafts in this ticket.** Default: yes, as the last commit before the milestone (ADR 0018 deferred them here). Alternative: defer to the Owner Agent ticket.
11. **No scheduler.** Default: "what is due" is computed when a person opens the page. A scheduled job needs option B first (ADR 0013 decision 4).
12. **Outreach drafts for a first touch.** The engine cannot invent the first anchor (`initial_outreach_required`). Default: the first outreach draft is a person's, from the lead page, with the same suppression and consent gates; the cadence takes over after its recorded touch.

## 9. Commit order and stops

1. ADR 0020 (suppression and follow-up), this plan's as-built section, checklist rows. 2. Migration part 1: suppression keys, contact keys, `erase_contact` replacement, copy test, pgTAP, catalog guards. 3. The HMAC adapter, the import and create-contact checks in the API, the response/log canaries, real-stack tests (**STOP: the hard gate is closed; the owner reviews before the rest**).
4. The cadence adapter (golden vectors, fail closed). 5. Migration part 2: touches, policy, drafts, functions, pgTAP, races. 6. API and real-stack attacks. 7. Web. 8. Question drafts (migration, API, web). 9. Milestone check: full `make check`, one mutation pass, handoff and checklist notes.
Each commit: `make check-fast` plus its new tests; full `make check` and the mutation pass only at commit 9. No push.
