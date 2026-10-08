# Plan: a private file workspace per shop, and data capture by chat

Status: **PLAN ONLY. Not approved. No code, migration, test or dependency was written or changed.** Written 2026-10-07 on the branch `plan-files-chat` (from `origin/main`). Nothing here needs a decision before the owner reads it; section 15 lists what the owner must decide before any ticket starts. Every paid or new third-party item is marked **needs owner approval**.

## 0. Assumptions (the plan takes the most reasonable reading and goes on)

* **A1. The brief was not found.** `docs/plans/workspace-files-and-chat-capture.md` is not on `main` and there is no untracked copy in the working tree. This plan is written from the owner's summary in the request: many shops keep no data in sheets; data comes in by **chat with the main agent**; each shop has a **private file workspace**; the agent **only proposes**, a **person approves**, and the **database re-checks** (the API never decides); CSV/Excel import is a **later add-on**; reading photos and PDFs needs a **paid vision model**, planned behind an interface with a fake provider.
* **A2. "The main agent" is a new interactive agent, the Capture Agent,** built on the existing app-owned agent runtime (ADR 0013, option A: it runs with the asking person's own token). It is not autonomous and not scheduled. Option B (a dedicated principal) stays required before any external customer or any scheduled agent (ADR 0013 decision 4); this plan does not change that.
* **A3. Storage is Supabase Storage** (the stack in `docs/architecture.md` already names "DB/Auth/Storage") with a private bucket, **or** a different store if the spike (W0) shows it cannot meet the rules below. Today `supabase/config.toml` has `[storage] enabled = false`, so the local stack does not run it: turning it on locally is part of the spike and is a change to the local setup only (free, no account).
* **A4. Real customer data stays out.** ADR 0017 holds: synthetic data only, no deployment, no hosted account, until the Customer Zero stage. Every test and rehearsal here uses invented people and files.
* **A5. Languages in scope:** English, Telugu, Hindi, Kannada (and Latin-script Hinglish, which the Requirement Agent already meets). English is the only UI language in the first tickets.
* **A6. The first customer is the family silk-saree wholesale shop** (Customer Zero): the first proposal kinds are the ones that shop needs (a new lead, a recorded touch, a file attached to a lead), not a general-purpose assistant.
* **A7. The headless driver is the acceptance for these tickets** (the owner's decision for followups-whatsapp: no stopwatch click test); a click checklist is still kept in the repository and pinned to the screens. If the owner wants to click, once at the end of W4 and W6 is enough.

## 1. The idea in plain words

A shop owner (or their sales person) types or dictates to a chat box: "Asha from Pune asked about 12 Kanjivaram sarees, her number is ...", or drops in a photo of a handwritten order slip or a PDF price list. The system does **not** change anything because of that. The Capture Agent reads it and writes **proposals**: "create this lead", "record that I sent a WhatsApp message to this lead yesterday", "attach this file to that lead". Each proposal is a card marked **Suggested**, showing the exact data it would write and the words in the message that support each field. A person presses **Approve** (or corrects, or rejects). Approval calls the same database functions a person would use by hand; the database re-checks everything again (role, tenant, the rules of that record). The result is recorded with who proposed, who approved, from which message or file, and when.

What exists today that this builds on (all verified in the repository):

| Existing piece | Where | How it is reused |
| --- | --- | --- |
| Agent runtime: allow-listed tools, runs with the starter's token, `created_via = 'agent'` and `agent_run_id` on every agent row, per-run and per-tenant limits, a daily cost cap per tenant | ADR 0013; `app/agents/`; `agent_limits`, `agent_definitions`, `agent_model_prices`, `agent_cost_reservations` | the Capture Agent is one more definition with its own switch (OFF by default) and tools that can only **propose** |
| Provider-neutral model interface with trust levels (SYSTEM / TRUSTED / UNTRUSTED blocks), a scripted fake provider, one real adapter that has never run live | `app/agents/llm/interface.py`, `fake.py`, `anthropic.py` | chat text, file text and forwarded messages are UNTRUSTED blocks; development and tests use the fake only |
| Propose, approve, re-check pattern | T008 requirement fields (`propose_field`, `decide_requirement_field`), T010 question drafts and follow-up drafts (state fingerprint, approval, the database recomputes) | proposals use the same shape: a typed payload, a fingerprint, a person's approval, a definer function that re-checks |
| Scrub-before-store text rules and the "quote must be at these offsets" check | ADR 0018 (`capture_text.py`, `scrub.py`, `agent_write_requirement_field`) | the chat text rules and the quote check |
| Erasure by registry; the real-data gate; the consent ledger; PII-aware audit | ADR 0014, 0015, 0005 | new tables register their personal columns; the gate and the erasure scopes are extended (section 6) |
| A pinned, isolated CSV parser behind an adapter with a size limit (900,000 bytes) | price-list CSV import | the pattern for any later file parser |

## 2. Principles (the non-negotiables, applied)

1. **Multi-tenant:** every new table carries `tenant_id` and RLS; every stored object lives under the tenant's own prefix; tests prove a member of workspace B can read nothing of workspace A, by every path (rows, storage, signed URLs).
2. **No secret in the browser.** The browser never receives a storage key, a service key or a long-lived URL.
3. **The agent proposes; it never writes a business row, sends, prices, commits money, or deletes.** Its tools can only create proposals. Approval is a human act; the write is a definer function that re-checks.
4. **No price from a model.** A chat message that mentions a price produces, at most, a *note* or a *suggested price-list change request* that goes through the existing price-list versioning with its own approval (out of scope here, section 14).
5. **Provenance and uncertainty on every proposal:** the source message or file, the supporting words (offsets), and a certainty (`stated` / `implied` / `ambiguous`) per field, as in T008.
6. **Everything inbound is untrusted:** chat text, pasted e-mails, OCR/vision output, file contents and file names. Instructions inside them are ignored.
7. **Idempotency:** every write carries a caller-supplied id; a retry replays.
8. **Provider behind an interface with a fake;** no live call and no spend without the owner's written approval and a provider-side hard spend cap (ADR 0017 b).
9. **PII minimisation:** collect only what the workflow needs; the model sees placeholders instead of phone numbers and e-mail addresses (section 8).
10. **Nothing hidden:** the UI shows Draft / Suggested / Approved / Applied / Failed / Rejected, real state only.

## 3. Architecture

```
person ──chat text / file upload──▶ API (token = the person's)
                                     │
        files:  FileStore ◀── scan ◀─┤  quarantine → clean | rejected          (FileScanner)
        chat:   chat_messages (append-only, rules of section 8)
                                     │
                           Capture Agent run (runtime, delegated token)
                           tools: read_message, read_file_text, propose_<kind>   ← proposals only
                                     │
                           capture_proposals  (status: suggested)
                                     │
                    person: Approve / Correct / Reject   (role + second factor where required)
                                     │
                    apply_capture_proposal(...)  SECURITY DEFINER, re-checks, calls the SAME
                    functions a person uses by hand (create lead, record touch, ...) → audit
```

* The API decides nothing. It passes the person's token and the closed payload; the database refuses anything that is not what it recomputes (the pattern of follow-up drafts, SM226).
* The Capture Agent has **no write tool** for any business table; a test (like `tests/test_agents_boundary.py`) scans its package so a write path cannot be added by accident.
* Proposals are **kinds from a closed list**. Adding a kind is a ticket (a new payload schema, a new apply branch, new tests), never a prompt change.

### 3.1 The first proposal kinds (closed list)

| Kind | What approval does (existing path) | Notes |
| --- | --- | --- |
| `create_lead` | company (find-or-propose), contact (name, phone, e-mail, city), lead; keys computed by the real key ring | **no consent is ever inferred**: a person records consent separately with evidence (consent ledger rules); a new contact is created without consent and cannot receive a follow-up draft until one is recorded |
| `log_touch` | `record_touch` for a lead: "I sent it" (out) or "they replied" (in), a channel, a time not in the future | the follow-up gate and suppression rules apply exactly as by hand; a refusal is shown with the usual fixed sentence |
| `attach_file` | link a clean file to a lead, company or enquiry | links only; the file stays in the workspace |
| `create_enquiry` (later) | feeds the T008 enquiry path with the pasted/forwarded text | text is scrubbed by the existing capture rules |
| `update_product_info` (later) | non-price fields of a product (name, description, tags) | **never price or stock**; price changes are a separate, Owner-only, second-factor flow |

Out of the closed list on purpose: anything that sends, prices, records money, deletes, grants consent, lifts a suppression, or changes a role.

## 4. Data model (all tenant-scoped, RLS, nothing public)

Sketch only; column types and exact checks are decided in each ticket's ADR/migration. Every table has `tenant_id`, RLS enabled and forced, a composite foreign key `(tenant_id, id)` where referenced, and appears in the erasure registry (section 6) if it can hold personal data.

| Table | Purpose | Key rules |
| --- | --- | --- |
| `workspace_files` | one row per file: id, tenant, uploader, original name (untrusted, scrubbed, display only), sniffed type, size, sha-256, `status` (`uploading` → `quarantined` → `clean` / `rejected` / `scan_failed` → `deleted`), scan summary, storage key, `retain_until`, `created_via` | immutable except status/ deleted marker; the storage key is `<tenant_id>/<file_id>` (never the file name); a unique `(tenant_id, sha256)` is **not** enforced (a duplicate upload is allowed, and flagged to the person) |
| `file_links` | a clean file attached to a lead / company / enquiry | append-only, typed, one row per link; unlinking is a new row |
| `file_extractions` | text read from a file (no model: the text layer of a PDF, a CSV's cells) and, later, a vision reader's output | UNTRUSTED data; size-capped; scrubbed with the chat rules before storage; kept so a proposal's quote can be re-checked against it |
| `chat_threads` | a conversation: tenant, started by, title (generated by a template, not the model), archived marker | one open thread per user per tenant is enough for v1 |
| `chat_messages` | the turns: thread, role (`user` / `assistant`), body (plain text), language tag, file ids attached, `created_at` | **append-only**; no edit; body rules in section 8; assistant text is stored exactly as shown |
| `capture_proposals` | kind, closed payload (JSON schema per kind), source message/file ids, supporting quotes with offsets, per-field certainty, `status` (`suggested` → `approved` → `applied`, or `rejected` / `failed` / `expired`), state fingerprint, proposer (the agent run, hence the starting human), approver, times, the id of the row it created | one active proposal per (thread, kind, payload hash); an approval carries the fingerprint it was shown, and a proposal whose state moved is refused (stale), like follow-up drafts |
| `capture_proposal_events` | append-only history: created, corrected, approved, applied, failed (closed reason), expired | gives the audit trail of every step with actor and time |

**Storage and access.** One private bucket (name fixed in the ADR); no public policy exists. Policies on `storage.objects` allow read/write only to members of the tenant whose id is the first path segment, with the same roles as the table policies (Owner/Admin/Sales write; Viewer reads **no** file in v1). The browser never reads storage directly: it asks the API, which checks membership and role with the person's token and returns a **signed URL valid for 60 seconds (hard maximum 300)**, for one object, for one GET. Upload goes the same way (a one-time upload URL created after the size/type pre-checks; the row exists in `uploading` first, so an abandoned upload is visible and swept). Signed URLs are never stored, logged, or put in a proposal. A direct-PostgREST/Storage attack suite (section 12) proves another tenant's path, a guessed id, a Viewer, and an expired URL all fail with the same answer as "not found".

## 5. Files: types, limits, scanning

| Item | v1 proposal | Why |
| --- | --- | --- |
| Allowed types | JPEG, PNG, WebP, PDF, plain text, CSV | the shop's real inputs: photos of slips, price-list PDFs, exports. **HEIC/HEIF, DOCX, XLSX, ZIP and everything else are refused** until each has its own parser decision (macros, archive bombs). |
| Type check | by **content** (magic bytes) AND extension AND the declared type, all three must agree; never by name alone | a renamed executable must not pass |
| Size limits | image 10 MB; PDF 20 MB and 30 pages; CSV 900,000 bytes (the price-list limit) ; text 200 KB | bounds cost and parser risk; limits live in code constants and are tested at both edges |
| Per-tenant quota | 2 GB and 5,000 files (owner can change by migration) | stops a runaway upload loop |
| Names | stored as untrusted metadata; the object key is the file id; displayed with control/bidi characters removed | path tricks, spoofed extensions, injection into later prompts |
| Parsing | isolated: a subprocess with CPU/memory/time limits, no network, no write access outside a temp dir; image decoding dimension cap (for example 12 megapixels) and decompression-bomb guard; PDF: text layer only, no JavaScript, no embedded files, no external links followed | "uploads: type/size validation, isolated parsing, no code execution" (`docs/architecture.md`) |
| Malware scanning | a `FileScanner` interface. Development and tests: a **fake scanner** that returns scripted results by file hash (clean / infected / error). Real: **ClamAV** (open source, no licence fee) in a local container, behind the same interface. **Needs owner approval** because it adds a runtime dependency and, later, a hosted service to run and update signatures (CLAUDE.md rule 8: the plan explains why: a customer file is untrusted content that other people will open). A managed scanning service would also **need owner approval** (cost, data sent to a third party). | files stay `quarantined` and invisible to everyone but the uploader until a scan says `clean`; **a scan error is a refusal** (fail closed); a file is never opened by a reader before it is clean |
| Duplicate/hash | sha-256 stored; a duplicate is allowed and shown | integrity, later deduplication |

## 6. Retention, DPDP, erasure, the real-data gate

* **Everything in a file or a chat is potentially personal data** (a photo of an order slip names a customer; a chat names people). Engineering baseline, not legal advice: the legal review in the Customer Zero gate (T012) must cover files and chat before any real data.
* **Erasure (extends ADR 0014).** The registry mechanism covers table columns. Files cannot be "anonymised in place", so the erasure scopes gain a second action: **delete the stored object** and tombstone its row (`status = deleted`, name/size/sha cleared, the audit row kept). Contact scope: delete every file linked **only** to that contact; a file also linked to others is unlinked from this contact and listed as "needs manual review" (the same honesty as ADR 0014's limit of names). Company scope: files linked to that company. Tenant scope: the whole tenant prefix. `file_extractions` and `chat_messages` are swept like other free-text columns (exact e-mail/phone replaced by the erasure token inside the text; a name is a stated limit). The sweep results list "needs manual review" rows by table and id, never by value. Every new personal column is registered in `erasure.registry` and a pgTAP test fails if a column is added unregistered (the existing guard pattern).
* **Backups:** an object deleted by erasure must be re-deleted after a restore (extend the restore drill's "re-apply erasures newer than the backup", `docs/runbooks/backup-restore-drill.md`).
* **Retention (hook now, rule later).** `workspace_files.retain_until` and `chat_messages` retention are columns/functions with **no job in v1** (as `enquiries.retain_until` today). Recommendation for the owner/lawyer: chat messages 24 months, files 24 months or until the linked lead is closed plus 12 months, whichever is later, with an Owner-visible "delete now" per file. Until the owner decides, nothing expires by itself.
* **The real-data gate.** Today a trigger on `contacts` blocks real contact data while the gate is closed. Chat and files are **new entry paths for the same data**: the gate must be extended (same operator-only open/close and recorded prerequisites) to refuse real files and real chat messages while closed, or the new tables must be unreachable until the gate is open. Slice W1/W3 include this; it is a "FULL treatment" item (AGENTS.md testing tiers).
* **Export:** the tenant data export (T005 `data_exports`) lists files and chat in a manifest (names, sizes, hashes, never contents) in v1.
* **Cross-border:** a model provider and a vision provider are processors; sending a customer's file or chat abroad is a DPDP decision (ADR 0013 decision 11, ADR 0018 consequences). Nothing live happens before it.

## 7. The proposal → approve → database re-check flow

1. **Propose.** The agent calls `propose_<kind>(payload, supports=[(message_or_file, quote, field, certainty)])`. The runtime validates the payload against the kind's closed schema, finds the quote offsets in the stored message/extraction text (whitespace-normalised, first occurrence, as in ADR 0018 decision 3), normalises values with deterministic code (phone, e-mail, dates in Asia/Kolkata, quantities), takes the **worse** of the model's and the normaliser's certainty, and writes `capture_proposals` (status `suggested`) through a definer function that re-checks the quote against the stored text, the run (the starter's), the write budget and the kind's shape.
2. **Review.** The card shows the kind, every field with its value, the supporting words highlighted in the message/file text, the certainty, and "agent suggestion, unreviewed". A person can **correct** a field (the correction is read by the same normalisers and recorded as a person's), **reject**, or **approve**. Owner/Admin/Sales may approve kinds their role may already do by hand; a kind that needs the second factor by hand needs it here.
3. **Approve.** The approval carries the proposal's **state fingerprint** (payload + the state of the target records). `approve_capture_proposal(id, fingerprint)` is a definer function: proves the role first, then the second factor where required, then refuses a stale fingerprint.
4. **Apply.** Inside the same transaction the function calls the **existing** write function for the kind (for example the contact/lead creation path with its key computation, or `record_touch` with its gate and suppression checks) with the approver's identity, so every check of the existing path runs again and its refusals (SM2xx, duplicates, role) surface as a closed reason on the proposal (`failed`), never as a partial write. The created row ids are stored on the proposal.
5. **Audit.** Each step writes a `capture_proposal_events` row and the usual audit event: tenant, actor, run, source ids, payload hash, result, time. Rows created this way carry `created_via = 'capture'` (a new server-forced value; client-settable never) plus the proposal id.
6. **Idempotent.** Proposal ids, approval ids and the apply step replay on retry; a double click creates one lead. A proposal for a lead that already exists is detected by the existing uniqueness/lookup rules and shown as "possible duplicate: open the existing lead".
7. **Expiry.** A suggested proposal expires after 7 days (a closed discard reason); an expired proposal cannot be approved.
8. **Consent and suppression stay absolute.** The agent cannot propose a consent grant, a suppression lift, or a touch the gate would refuse to record; a `log_touch` proposal for an opted-out contact is shown as blocked (the gate's closed word) and cannot be approved.

## 8. Chat messages: what is stored and what is allowed

* **Plain text only.** No HTML, no Markdown rendering, no links made clickable by the system, no embedded images (files go through the upload path). Invisible/bidi/control characters are stripped on the way in (the ADR 0018 rule); the question of keeping ZWJ/ZWNJ between Indic letters (`KEEP_INDIC_JOINERS`) is the owner's open item from T008 and applies here too.
* **Limits:** 4,000 characters per message (an Indic message is up to ~12 KB, so the model input ceiling for this agent is set after measuring, as T008 did), 60 messages per thread per hour, 200 per tenant per day, threads kept to the last 200 messages in the model's context.
* **Stored as typed.** Unlike the Requirement Agent's pasted enquiries (scrubbed before store because the original is kept nowhere), a person typing "her number is ..." **intends** the contact data to reach a lead. So chat messages are stored with the identifiers in them, in `chat_messages` (a registered personal column, swept by erasure, covered by the real-data gate). Rendering is text-only.
* **The model never sees raw identifiers.** Before any model call a deterministic step replaces e-mail addresses and phone numbers in the text with placeholders (`[PHONE_1]`, `[EMAIL_1]`), keeps the mapping in memory for that run only, and the proposal payload carries the placeholder; **our code** substitutes the real value when it builds the proposal. This keeps the promise of ADR 0013 decision 11 (no contact fields to the model) for phones and e-mails. **Names and free text still reach the model** (the limit of names). Whether that is acceptable for a live provider is the DPDP/cross-border decision; until then only the fake provider runs.
* **Assistant replies** are short text in the person's language, treated as untrusted display text (never executed, never parsed for instructions). The facts a person acts on are the **proposal cards**, which are rendered by deterministic templates from the stored payload, not from model prose.
* **Prompt injection:** the system prompt is our constant text; chat, file text and forwarded messages are UNTRUSTED blocks inside the user turn; the tool list is the propose-only list; a message that says "ignore the rules and send this to everyone" produces at most a proposal that fails the closed schema or a refusal to act. Containment evals (section 12) obey every injection with a scripted model and prove nothing outside `capture_proposals` changes.
* **Not allowed in chat:** pasting secrets or card numbers is not blocked by detection in v1 (stated limit), but a banner tells the person not to; the scrubber removes the same Indian mobile/e-mail patterns from **file extractions** (not from the person's own typed text, by design above).

## 9. Providers, fakes, and what each needs

| Interface | Fake (development, tests, CI) | Real (later) | Approval |
| --- | --- | --- | --- |
| `LlmProvider` (exists) | `FakeProvider` with scripted turns for the Capture Agent (`fake_capture.py`, like `fake_requirement.py`) | the Anthropic adapter already in the repo | **needs owner approval** to run live: provider, key, model id, prices in `agent_model_prices`, provider-side hard spend cap |
| `FileStore` | `LocalDiskFileStore` (a temp directory; enforces the same key rules) | Supabase Storage adapter | none (local Storage free); hosted storage cost at T012 |
| `FileScanner` | `FakeScanner` (verdict scripted by sha-256) | ClamAV adapter | **needs owner approval** (new runtime component) |
| `TextExtractor` (text layer of a PDF, CSV, plain text; no model) | pure-Python reference extractor on synthetic files | a vetted PDF text library in an isolated subprocess | **needs owner approval** if it adds a dependency (explained in the ticket, CLAUDE.md rule 8) |
| `VisionReader` (photos, scanned PDFs → text/fields) | `FakeVisionReader` returning scripted structured text by image hash | a vision-capable model through the same `LlmProvider` interface, or a document-AI service | **needs owner approval** (paid; the images leave the machine; DPDP) |
| `Transcriber` (voice notes) | none | none | **not planned** in this document (section 14) |

All fakes are deterministic, free, offline, and are what the tests and `make check` use. A fake never loads a network library; the boundary test scans for that.

## 10. Cost caps

* **Reuse the existing per-tenant daily cost cap** (`set_tenant_daily_cost_cap`, Owner-only today, default low, hard ceiling 20.00) and the worst-case reservation per call at the price in `agent_model_prices` (a model with no price row is refused, fail closed).
* **New per-file and per-message caps** in the agent definition (operator-managed, migration-only): maximum model calls per chat turn (3), maximum vision pages per file (5), maximum files read per turn (3), maximum output tokens per call, and a separate **daily vision budget** so a burst of photos cannot starve normal chat (a price row per model and per kind).
* **Cost is visible:** the Owner sees today's spend and the remaining cap on the chat page; at the cap, the agent stops proposing and says so; chat and file upload still work (a person can always type a lead by hand).
* **Provider-side hard cap is an owner action** before any live call (checklist row exists); until then `llm_spend_cap_confirmed` stays false and the live adapter refuses to run.
* Fake providers cost zero, and the cost tests use priced fake rows.

## 11. Languages (English, Telugu, Hindi, Kannada)

* **Input:** any of the four scripts and Latin-script mixes. Text is Unicode-normalised (NFC) before storage; Devanagari/Telugu/Kannada digits are read by the deterministic normalisers (a number is never converted by the model).
* **Model instructions** are English constants; the model is told to answer in the language of the person's last message. Proposal payload keys and enum values are English; **values keep the person's words** with the quote.
* **Display:** the proposal card and approval buttons are English in v1. A Telugu/Hindi/Kannada template set for cards, refusals and the follow-up drafts is a **separate, later ticket** and **needs a native speaker's review** (the owner's decision; a wrong word in a card the owner approves is a risk, not a nicety).
* **Known limits to carry from T008:** a delivery city in a non-Latin script is not supported by the span check (the agent abstains, a person adds it); quantity words in Hindi are a short list; Indic text is token-heavy (about 3x the bytes), so the input ceiling and the cost reservation are measured per language before any live run.
* **Test corpus:** a synthetic set of at least 40 chat messages and 12 file texts (10 per language plus mixed), hand-worked expected proposals, committed with a report, as T008's golden set; zero wrong `stated` fields is the gate.

## 12. Testing and mutation plan (the testing rhythm)

Rhythm (owner, 2026-10-07): **per commit** `make check-fast` plus the tests of the touched files and the commit's new tests; **the full set** (`make check`: pgTAP, integration, evals) **per commit when the commit has a migration or database change, or touches roles, permissions, consent, suppression or erasure, or is a spike of a risky assumption (run on the real stack)**; **once at the end of each ticket, a full `make check` from a clean `db-reset`**; **mutation passes only at the end** of a ticket. Opt-in headless drivers and mutation tools are never part of `make check`.

| Layer | What |
| --- | --- |
| **pgTAP** (new files per ticket) | RLS allow/deny for every new table and for `storage.objects` (member, other tenant, Viewer, anon); append-only triggers (messages, events, links); the file status machine; the proposal state machine (every legal and illegal transition, stale fingerprint, expiry); `approve`/`apply` definer functions (role first, then second factor, then specific refusals; empty `search_path`; no execute for `anon`); apply calls the existing paths and surfaces their refusals; each new personal column is in the erasure registry; erasure deletes objects and sweeps messages; the real-data gate covers files and chat; quotas and limits at both edges |
| **Integration (real stack)** | upload → scan (fake) → clean → link; chat → agent run (fake model) → proposal → approve → applied row with `created_via = 'capture'`; every refusal (SM2xx reasons) through the API; **direct-PostgREST/Storage attacks**: another tenant's object, a guessed id, a signed URL for another path, an expired URL, a Viewer, a spoofed type, an oversize file, a path-traversal name, a double approve, an approve of a stale fingerprint; race tests (two approvals at once; apply vs erasure; upload vs quota) |
| **API / web unit** | parsers, limits, magic-byte sniffing with a hostile-file corpus (synthetic: renamed executable, zip bomb stub, huge-dimension image header, PDF with JavaScript/embedded file), strict response parsers, the tabs/cards, the role matrix (a Viewer sees nothing), no "send" control anywhere, the checklist pin test |
| **Evals (`make eval` family)** | injection in chat, in a PDF's text, in a file name, in a forwarded message; the scripted model **obeys every injection** and the database must still show no write outside `capture_proposals`, no consent change, no touch, no deletion, no price; tool-containment boundary test |
| **Golden set** | the four-language corpus (section 11) with a committed report |
| **Headless driver** | `make rehearse-capture` (opt-in): a synthetic workspace, people, files and chat; every step and every refusal asserted; "nothing could send" checks stay; leak check (no contact detail in list responses). A click checklist is kept in the repository and pinned to the screens (see assumption A7) |
| **Mutation (end of ticket)** | SQL mutants for the new functions, triggers, policies and constraints (`tools/mutation-followups` pattern: operators, guards, statements, hand-written), Python and web mutants for the validators, limits, sniffers, state machine and cards; survivors closed with tests or documented equivalent; **one runner at a time** (the tool's README) |

## 13. Slicing into tickets (order, size, acceptance)

Size: S = a day or two, M = about a week, L = more than a week of the agent's work. Every ticket ends with the full set from a clean `db-reset` and a mutation pass, then stops for the owner.

| # | Ticket | Size | Delivers | Acceptance (all on the real stack) |
| --- | --- | --- | --- | --- |
| W0 | **Spike and ADR: storage, signed URLs, scanner choice** | S | enable local Storage in `config.toml`; a private bucket; storage policies by tenant prefix; a signed URL minted by the API with the person's token; **the spike test on the real stack**: member reads own file, other tenant, Viewer and anon cannot, URL expires; decide the file-store design; ADR 0023 (files) written | the spike passes or the ticket stops and reports the exact failure; ADR proposed; nothing else changed |
| W1 | **File workspace foundation** | M | `workspace_files`, `file_links`, upload/download/delete API with the `FileStore` interface, limits and quota, magic-byte sniff, isolated parser stubs, `FakeScanner` and the quarantine state machine, plain web page (list, upload, open, delete), audit, erasure registry + object deletion in the erasure scopes, real-data gate extension, export manifest | pgTAP + direct-attack suite green; hostile-file corpus refused with fixed sentences; erasure test deletes objects; gate test; headless driver `rehearse-files` |
| W2 | **Real scanner** | S | ClamAV adapter and a local container, signature-update note, scan timeouts, `scan_failed` handling | **needs owner approval (dependency)**; infected test file (the standard harmless EICAR test string, synthetic) is refused; a scanner outage leaves files quarantined |
| W3 | **Chat core (no model)** | M | `chat_threads`/`chat_messages`, API, rate limits, text rules, plain chat page, a deterministic "echo" assistant for tests, real-data gate coverage, erasure sweep | append-only proofs; limits at both edges; a Viewer sees nothing; the erasure sweep replaces an identifier inside a message |
| W4 | **Proposals engine** | L | `capture_proposals`/`capture_proposal_events`, the state machine, `approve_capture_proposal`/apply definer functions for `create_lead` and `log_touch` (calling the existing paths), fingerprints, expiry, `created_via = 'capture'`, "Suggested" cards, correct/reject/approve UI | apply refuses exactly what the existing paths refuse; race tests; the equivalence-style test that apply == the manual path for the same input; duplicate detection; audit complete |
| W5 | **Capture Agent** | M | agent definition `capture` (OFF by default, own switch, `allowed_tenants`), propose-only tools, placeholder substitution, the scripted `fake_capture` model, containment evals, cost caps, the four-language golden set | zero wrong `stated` fields; every injection eval holds; boundary test; cost tests; **no live call** |
| W6 | **Reading files** | M-L | `TextExtractor` (PDF text layer, CSV, text), extractions table, `attach_file` kind, the vision-reader interface with `FakeVisionReader` | file text becomes quotable evidence for proposals; hostile PDFs handled; vision path works only with the fake; **vision provider and PDF library need owner approval** |
| W7 | **More kinds** | S each | `create_enquiry` (into T008), `update_product_info` (non-price) | each kind has its schema, apply branch, tests, mutation pass |
| W8 | **Retention and delete-now** | S-M | `retain_until` functions and an Owner "delete now"; the job is still a separate decision | owner-visible, audited, tested |
| W9 | **CSV/Excel import (later add-on)** | M | reuse of the lead import path and the price-list CSV parser pattern; XLSX needs a parser decision (macros, shared strings, bombs) | **XLSX parser needs owner approval**; CSV reuses the pinned adapter; an import is a proposal batch a person approves, never a silent write |
| W10 | **Native-language cards and templates** | M | te/hi/kn template sets for cards and refusals | **needs a native-speaker review** (owner) |
| L1 | **Live pilot of the model and vision readers** | S | one supervised batch after the owner's written approval | provider, key, prices, hard cap, DPDP review done; `make eval-live` style gate |

Order: **W0 → W1 → W3 → W4 → W5 → W6 → W2 (any time after W1, before real files) → W7 → W8 → W9 → W10 → L1.** W2 must be done before the real-data gate opens. W4 and W5 are the heart: until W5 the chat is a record-keeping box and the proposals can be created by tests and by hand.

## 14. Explicitly NOT in scope

Sending anything (e-mail, WhatsApp, SMS); automatic approval or auto-apply of any proposal; any price, discount, payment or order change by the agent; consent grants or suppression lifts by the agent; deleting business data by the agent; voice notes and call transcription; reading e-mail inboxes or WhatsApp accounts; web crawling from chat; XLSX/DOCX/ZIP/HEIC support in the first tickets; sharing files with customers or external links; folders, versions, comments or co-editing; full-text search over files; OCR training; a vector database; scheduled/background agents (Option B first); hosting, domains, accounts, paid scanning or storage services; real customer data; native-language UI before a native review; a general-purpose assistant that answers questions about the business (the Owner Agent, T011, is separate and read-only).

## 15. Risks

| Risk | Mitigation |
| --- | --- |
| A file is a path to code execution or a parser exploit | magic-byte allow-list, isolated subprocess with rlimits and no network, text-layer-only PDF, quarantine until scanned, scan failure refuses |
| Cross-tenant file access through storage policies or signed URLs | the W0 spike and the direct-attack suite; unguessable ids; 60-second single-object URLs; no URL stored |
| Personal data in photos/PDFs that cannot be "anonymised" | erasure deletes objects; Viewer reads no file; retention hooks; legal review before real data |
| Names and free text reach a model provider | placeholders for phones/e-mails; fake only until the DPDP/cross-border decision |
| The agent is steered by text inside a file or a chat | untrusted blocks, propose-only tools, closed payload schemas, containment evals that obey every injection |
| A wrong proposal approved in a hurry | quotes shown on the card, certainty labels, `ambiguous` blocks one-click approve for key fields, duplicate detection, the database re-check, the gate for touches |
| Cost surprises from vision and Indic token counts | per-call, per-file, per-day caps; fail closed on a missing price; measure before live; separate vision budget |
| Scope creep into a general assistant | closed proposal kinds; adding a kind is a ticket |
| Local Storage disabled today; hosted Storage behaves differently | the W0 spike on the real local stack; re-verify on a throwaway hosted project at T012 |
| Erasure and backups | extend the restore drill to re-delete objects |
| An Indic message exceeds the input ceiling or breaks the span check | measured limits, abstain-on-doubt, golden set per language |

## 16. Decisions I need from the owner (maximum eight, each with my recommendation)

1. **Storage choice.** Supabase Storage (private bucket, tenant-prefix policies, signed URLs minted by the API) versus keeping file bytes in Postgres. *Recommendation: Supabase Storage, after the W0 spike proves the policies on the real local stack; if the spike fails, stop and report.*
2. **Malware scanning.** ClamAV in a local container (open source, free licence) behind the `FileScanner` interface, files quarantined until clean, scan errors refuse. *Recommendation: yes, as ticket W2, before any real file; the dependency is justified because other people will open these files.*
3. **File types in v1.** JPEG, PNG, WebP, PDF (text layer), plain text, CSV; no HEIC, DOCX, XLSX, ZIP. *Recommendation: yes; add XLSX only in W9 with its own parser decision.*
4. **Who can see files.** Owner, Admin and Sales read and upload; a Viewer reads no file. *Recommendation: yes (files hold more personal data than the tables a Viewer sees).*
5. **Phones and e-mails stay away from the model** (placeholders), names do not. *Recommendation: yes for the build; the live-provider decision stays with the DPDP/cross-border review before T012.*
6. **Retention defaults.** Chat 24 months; files 24 months or until the linked lead has been closed 12 months, whichever is later; nothing expires without an Owner "delete now" until the owner turns a job on. *Recommendation: accept as a starting point, to be confirmed by the legal review.*
7. **The paid vision reader.** Whether reading photos and scanned PDFs is worth a paid model for Customer Zero, or whether the first version should read only typed chat and text PDFs and let a person type from photos. *Recommendation: build W1-W6 with text only and the fake vision reader; decide the paid reader after seeing real photo volume (ask the family how many slips arrive as photos).*
8. **Click test.** Whether the headless driver alone is the acceptance for these tickets (as for followups-whatsapp). *Recommendation: yes.*

**Not decided (left open on purpose):** the bucket name and path scheme (W0 ADR); the exact limits in section 5 (confirm with real file samples from the family, W0); the ZWJ/ZWNJ rule for Indic text (T008's open item); the number of chat messages kept in the model's context; whether a duplicate file upload is flagged or blocked; the native-language review process and who does it; whether chat is also reachable from a phone browser layout before a native app (the PWA question); the hosted scanner/storage option for T012; the retention job; the provider and model for vision; the order of W7 kinds after the first two.
