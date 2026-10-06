# Thin-slice rehearsal: a synthetic CSV of leads, through to an order (PLAN ONLY, nothing built)

Status: written 2026-10-07 after the owner's review of the T010 part 1 and order-conversion database work. **Nothing in this plan is built and nothing here starts without the owner's approval.**
Related: ADR 0017 (local-first, synthetic data only), ADR 0018-0021, `docs/plans/order-conversion.md`, `docs/plans/t010-integration.md`, `docs/plans/price-list-csv.md`, `docs/pre-pilot-checklist.md`.
Reads before building: CLAUDE.md, AGENTS.md, `docs/lanes.md`, this plan, the order-conversion plan and ADR 0021.

## 1. Purpose and non-goals
The rehearsal runs the shortest end-to-end path of the product on SYNTHETIC data, on the local stack, with every step done the way a real person would do it (the same API, the same roles and second factors), and **measures** it: does the path work, where does it refuse, how much work is it, and how long does it take.
It is the dry run that tells the owner what the family's first real week would feel like, before any real person's data exists.

**Non-goals:** real data of any kind (the real-data gate stays closed); any deployment, domain, SMTP or paid service; any live model call (the requirement step uses scripted input); sending anything to anyone (nothing is sent: a person "records" what happened); follow-ups (T010 part 2 is not part of the slice); WhatsApp, invoices, GST filing, a customer portal; the Owner Agent.

## 2. The slice (what one lead goes through)
1. **Import** a synthetic CSV of leads (company, contact, e-mail, phone, source). Suppression keys are computed on the way in; a contact whose number or address is already suppressed arrives flagged.
2. **Enquiry:** a person pastes the enquiry text of a lead (synthetic wording).
3. **Requirement:** the lines (saree type, quantity, delivery city) are entered by a person from scripted input and **confirmed**.
4. **Pick:** a person says which catalog product each line means.
5. **Quote:** the API runs the pinned quote engine; the database recomputes and stores the draft.
6. **Approval:** the Owner approves it (second factor); the customer text is rendered (for copying; never sent).
7. **Order:** the Owner or an Admin starts the order from the approved quote (second factor).
8. **Events to closed_paid:** sent, accepted, advance requested, advance paid, preparation, dispatch, delivery, balance paid, each recorded by the right role; plus the side paths: a decline with a reason followed by a new quote and a new order, a cancellation, a refund, a dispatch override.

## 3. What already exists
| Step | Exists today (local, committed) | Where |
| --- | --- | --- |
| Tenants, roles, second factor | signup, tenant creation, Owner / Admin / Sales / Viewer, TOTP at aal2 for the actions that need it | T002, ADR 0016; test helpers `aal2_token` |
| Import | `POST /leads/import` (JSON rows, preview, batch id, review queue); keys recorded for the contacts a batch creates; flagged on arrival if suppressed | T005, ADR 0020 |
| Suppression | keys, opt-out, Owner-only lift, shared keys, erasure writes keys first, backfill | ADR 0020 |
| Enquiry | `POST /leads/{id}/enquiries` (capture), read | T008 |
| Requirement | `POST /enquiries/{id}/requirement-fields` (a person adds a field), field decisions, `confirm` | T008 |
| Pick and quote | `POST /enquiries/{id}/picks`, `POST /enquiries/{id}/quotes` (builder + pinned engine), quote read, quote text | T009 |
| Approval | `POST /quotes/{id}/approve` (Owner or Admin, second factor), reject, withdraw | T009 |
| Reference data | `make seed-quote-data TENANT=<slug>`: six synthetic products, a price list, a quote policy, a mapper config, **and an order policy** | T009, review fix 4 |
| Order, database | policy versions, orders, the ledger, creation, events, the lifecycle recomputation, SM230-SM239, the follow-up stop | ADR 0021 |
| Order, Python | `app/orders/lifecycle_port.py` (the only door to the pure lifecycle) and `builder.py` (the request the database rebuilds) | order conversion commit 2 |
| Web | enquiry page with the quote panel, lead and review pages | T008, T009 |
| Proof tooling | the real-stack helpers that already walk an order to `closed_paid` (`tests/integration/order_support.py`) | order conversion commit 4 |

## 4. What is missing
1. **The order API** (plan commit 5): repository over PostgREST, routes (create an order, record an event, read an order and its ledger, list), the SQLSTATE mapping (SM232 with its closed code as `details`, SM234-SM239, SM306), the fakes and unit tests. Nothing outside the tests calls the order functions today.
2. **The order web page** (plan commit 6): state in our words (Won / Lost / Cancelled / Expired), the ledger and balance, the source trail, a form per event with the allowed next events from the lifecycle (guidance only), the second-factor notice, "nothing is sent", and the link from the quote.
3. **The price-list CSV import endpoint** (and page): the pure parser exists (`packages/pure/price_list_csv`); there is no adapter, no endpoint, no page. Today a price list can only be seeded or created through the database function.
4. **A CSV front door for leads:** the import endpoint takes JSON rows; the CSV is turned into rows by the driver (a small, tested adapter) until a page exists.
5. **A synthetic data set** (deterministic, clearly fictional): 20 leads with a few deliberate problems (a duplicate, a malformed e-mail, a number that is already suppressed, a contact that was erased), enquiry texts, the requirement lines, a price list CSV, and the expected quote figures worked out by hand.
6. **The driver and the report:** one script that runs the slice as the four roles, records step timings, refusals and counts, replays one write per step, and writes a markdown report.
7. **No web page for lead import** exists; the rehearsal does not need one (the driver is the "person").

## 5. Smallest build order (each step is one commit group with its tests; stop for review after step 3)
1. **Order API** (missing item 1). Acceptance: the real-stack suites that today call the SQL functions directly also pass through the API routes; Viewer and other tenants refused; a forged `owner_override`, a stale client (SM238) and a replay are tested at the route level; no route takes a total, a state, an approver or an owner_override from the body; the payment or refund amount, the ledger id, the time of occurrence and the lost reason are the person's inputs.
2. **Synthetic data set and the CSV adapter** (items 4 and 5): `tests/rehearsal/data/` (fixed seed, a README that says every value is invented) and `app/leads/csv_rows.py` with unit tests (formula-injection safe, size limits, no echo of cell values in errors).
3. **The driver** (item 6), run through the API with the real roles, ending with the report. Acceptance: it runs from a fresh database to `closed_paid` for the happy leads and produces the report; a second run on the same database changes nothing (idempotency). **Stop: the owner reads the first report.**
4. **Order web page** (item 2), then rerun the driver's "person" steps through the browser by hand once (a checklist, not automation) to count real clicks.
5. **Price-list CSV import** (item 3) and rerun the rehearsal with the price list loaded from a CSV instead of the seed.

## 6. What the rehearsal measures
* **Correctness:** at every step the order's state and the ledger totals equal the lifecycle's answer; the final order is `closed_paid` with paid equal to the total; every quote figure of the sample equals the hand-worked expectation.
* **Gates and refusals:** how many writes were refused and by which code (SM2xx, 42501, SM306), so wrong-role and missing-second-factor friction is visible; the suppressed number arrives flagged; a Viewer and a second tenant see nothing.
* **Idempotency:** each write is replayed once and changes nothing.
* **Effort:** per lead, the number of person actions from import to order (fields typed, picks, approvals, events), and the wall-clock time per step through the API; later, the real click count from the web.
* **Data quality:** the share of CSV rows imported, flagged, rejected or merged, with the reason.
* **Provenance and audit:** every step has an audit event with actor and time; every quote and order event carries its engine version and canonical hash.
* **Safety:** zero outbound messages (the driver asserts no network call besides the local stack), zero model cost, zero secrets read.

## 7. Open owner decisions (recommended default first). **ALL NINE ACCEPTED with their defaults (owner, 2026-10-07).**
1. **Where it runs.** Default: local stack only, synthetic data only, on the developer machine. (A hosted run belongs to the Customer Zero stage.)
2. **How the requirement is entered.** Default: scripted human entry (the fields a person would type), no model. Alternative: the Requirement Agent with its scripted fake model, to rehearse the confirm step too. A live model needs the owner's approval of provider, key and spend cap (ADR 0017).
3. **Price list.** Default: seeded for the first run; the CSV import endpoint (step 5) follows. Alternative: build the import first.
4. **Order web page scope.** Default: read plus the event forms. Alternative: read-only first, events by API.
5. **Which leads and how many.** Default: 20 leads, 8 enquiries, 5 quotes, 4 orders (one closed_paid, one declined then re-quoted, one cancelled, one in preparation).
6. **Success thresholds.** Default: none on the first run; record a baseline and let the owner set targets after reading the report.
7. **The manual baseline.** Default: the owner times one real quote-to-order in the family's current way (stopwatch, no data shared) so the report has something to compare with.
8. **Roles.** Default: one Owner (second factor by TOTP), one Admin, one Sales, one Viewer, plus a second workspace for isolation checks.
9. **Follow-ups.** Default: out of the slice; add a second rehearsal after T010 part 2 (touches, drafts, the stop).

## 8. Risks
* The order API is the largest piece and the first place a real person's money claims will pass: it must be built with the same rules as the database (the API decides nothing: it builds the lifecycle request from the ledger it read with the caller's token, and the database rebuilds and refuses any difference).
* A rehearsal on synthetic data says little about real data quality (messy addresses, names, enquiries written in other languages): the data-quality figures are a lower bound.
* The driver must not become a second implementation of the business rules: it calls the API like a person and asserts against independently computed expectations.
