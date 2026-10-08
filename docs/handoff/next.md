# Handoff: resume here

**STOP POINT (2026-10-06, step F): the members plan has the owner's decisions recorded (not built; queued after T011a, before T012) and step F fixes F1-F8 plus the capture_text decision are committed locally; nothing is pushed.** Do NOT start anything else (members build, T010 part 2, T011a) before the owner says so.

* Step F (see `docs/checklist-notes/A.md`, "Step F: findings" and "Step F: mutation spot-check"): F1 `GET /orders?quote_id=`; F2 the commit reads the catalog once; F3 900,000 BYTES (Next.js caps a server action at 1 MB); F4 the verdict and Save belong to the exact text and date checked; F5 `occurred_at` is bounded only by the database clock (30 days back, 5 minutes ahead; no floor at the order's creation or the previous event: recorded in a test, no database change); F6 the hash comment; F7 a malformed parser result is a fixed 502; F8 "Money still held" on cancelled/lost/expired orders, and the T011a requirement (a ninth owner-brief question, `docs/plans/t011-owner-agent.md`).
* capture_text: `KEEP_INDIC_JOINERS = True` (owner decision): a joiner after an Indic letter or mark is kept; elsewhere removed; everything else hidden goes through `app/text_rules.py` (now allowed in the agent sandbox's import boundary, with a purity test).
* Still open: the pinned quote-text renderer (lane C) must allow U+200C/U+200D in product names (checklist row, NOT part of this work); the members decisions are recorded in `docs/plans/members-and-invitations.md` (A1-A6 included).
* Traps: ruff-format wraps long lines, so mutation patterns must match the formatted text; the agent sandbox may import only `app.requirements` and `app.text_rules`; a pgTAP file that uses the seed must not assume a zero credit limit.

---

(Earlier hand-off, still true.)

**STOP POINT (2026-10-06, second rehearsal batch): small fixes A1-A3, the order web page (step 4), the price-list CSV import (step 5) and the members-and-invitations PLAN are built or written and committed locally; nothing is pushed.** The owner reads `rehearsal-report.md` (`make db-reset && make rehearse-thin-slice`), tries `docs/rehearsal-click-checklist.md` by hand (`make db-reset && make rehearse-prepare-click`, then `make dev-api`, `make dev-web`), and decides the members plan. Do NOT build members/invitations, T010 part 2 or T011a before the owner approves.

* New migrations: `20261022090000_small_fixes.sql` (A1 `add_requirement_field` replay after confirm; A3 seeded repeat credit limit Rs 5,00,000) and `20261023090000_seed_without_price_list.sql` (the seed can skip the price list: `make seed-quote-data TENANT=<slug>` still seeds one; the driver uses `--without-price-list`). Copies are pinned in `tests/test_migration_copies.py`.
* New code: `app/text_rules.py` (one Unicode rule, ZWJ/ZWNJ allowed), `app/orders/service.py` guidance (`allowed_next_events` on the order detail, asked of the lifecycle itself per role), `app/pricelists/` (csv_port, models, repository, service, routes), web `lib/api/orders.ts`, `lib/api/pricelists.ts`, `app/app/tenants/[tenantId]/orders/`, `.../price-list/`, Start order on the quote panel; the driver loads the price list from `tests/rehearsal/data/price_list.csv`.
* Last full `make check` (2026-10-06): exit 0; vitest 1,178, pytest 3,616, pgTAP 8,709, integration 923, evals 45 + 9 + 29 + 9 passed (one opt-in live case skipped). Mutation pass (138 mutants, 137 killed, 1 equivalent): `docs/checklist-notes/A.md`.
* Rehearsal (fresh database): 343/343 checks; 17 of 20 leads imported; price list 5 products from the CSV and 2 hostile files refused row by row; 8 quotes equal the hand-worked figures (Q6 flagged only as a repeat claim, Q7 deliberately over its credit limit); 7 orders (3 closed_paid, 1 declined, 2 cancelled, 1 in preparation); the second pass changed no row.
* Open for the owner: the A2 grep findings (`capture_text` keeps ZWJ/ZWNJ after an Indic letter or mark (owner decision 2026-10-06); the pinned quote-text renderer accepts them there since `quote_text` 1.1.0, adopted in 1.2.0), the real credit limit, the members plan decisions, and the order page and price-list page have never been driven in a real browser.
* Traps: the pgTAP files that used the seed assumed a zero credit limit (58 E6 re-worded); a Python mutation pass must not run while a SQL one does; `ruff format` rewrites quoting in long lines, so mutants must match the formatted text; keep `tests/rehearsal/data/expected.json` hand-worked.

---

(Earlier hand-off, still true.)

**STOP POINT (2026-10-06): rehearsal steps 0-3 are built and committed locally; nothing is pushed. The owner reads `rehearsal-report.md` (`make db-reset && make rehearse-thin-slice`) before anything else is built.** Do NOT start step 4 (order web page), step 5 (price-list CSV import), T010 part 2 or T011a before the owner approves.

* Built: step 0 (erased marker, `20261021090000_erased_marker.sql`; stops-followups "newer" by approval time then quote number), step 1 (order API: `app/orders/{routes,repository,service,errors,models}.py`, the error map in `app/main.py`), step 2 (`tests/rehearsal/data` all invented, hand-worked `expected.json` / `expected.md`; `app/leads/csv_rows.py`), step 3 (`tests/rehearsal/{drive,harness,report}.py`, `make rehearse-thin-slice`; state of invented people in `.rehearsal/state.json`, git-ignored, healed after a db-reset).
* Last full `make check` (2026-10-06): exit 0; vitest 962, pytest 3,457, pgTAP 8,709, integration 909, evals 45 + 9 + 29 + 9 passed (one opt-in live case skipped). Mutation pass: `docs/checklist-notes/A.md` "Rehearsal steps 0-3".
* Rehearsal result: 294/294 checks; 17 of 20 leads imported (1 adapter refusal, 1 duplicate, 1 rejection, 2 flagged); 7 quotes equal the hand-worked figures; 7 orders (3 closed_paid, 1 declined, 2 cancelled, 1 in preparation); the second pass changed no row. Findings for the owner are in section 8 of the report (no invite route; a typed field cannot be retried after confirm; repeat quotes always carry CREDIT_LIMIT_EXCEEDED under the seeded policy).
* Traps: pgTAP files must not assert global counts; the rehearsal driver must run on a day-stable clock (same UTC day for the second pass); do not run a Python mutation pass while a SQL pass is running (they share the app code and the database).

---

(Earlier hand-off, still true.)

**STOP POINT (2026-10-07): the owner's review verdict on T010 part 1 and the order database is APPLIED and committed locally; nothing is pushed.** Do NOT build the order API or web (plan commits 5-6), T010 part 2 or T011a before the owner approves. `docs/plans/thin-slice-rehearsal.md` is a PLAN ONLY (nothing built).

* The review fixes are ONE migration, `supabase/migrations/20261020090000_review_fixes.sql` (create or replace of the latest definitions; `tests/test_migration_copies.py` pins every copy): (1) lifting a contact lifts a shared key only when no other suppressed, non-erased contact holds it (a key whose suppression came from an erasure stays suppressed); (2) a cancellation that carries money is the Owner's (SM234, message "this action needs the owner", `owner_approved_by` set, the check allows it on a `cancel`); (3) SM237 only while the quote's order is not declined, expired or cancelled, and `app.order_stops_followups` is decided by the lead's LATEST order unless a newer approved quote has no order yet; (4) `app.operator_seed_order_policy` (synthetic, operator-only; run by `make seed-quote-data`).
* Where things are: ADR 0021 "Amendments after the owner's review"; `docs/plans/order-conversion.md` and `docs/plans/t010-integration.md` (section 11: the two HARD requirements for part 2: fail closed without a key for the channel; re-check the order stop at approve and at record-as-sent); the "Review amendments" rows of `docs/pre-pilot-checklist.md` (legal review of keeping a keyed hash after a legal erasure, three owner confirmations); mutation tables in `docs/checklist-notes/A.md` (the two earlier passes: 346 mutants, 330 killed, 16 equivalent; the review pass: 68 mutants, 61 killed, 7 equivalent).
* Last full `make check` (2026-10-07): exit 0; vitest 962, pytest 3,240, pgTAP 8,694, integration 892, evals 45 + 9 + 29 + 9 passed (the one opt-in live case skipped).
* Contracts the next steps must keep: the database REBUILDS every order request and refuses a different one (SM238); `owner_override` is derived from the role; a stale client gets SM238 and must re-read; an exact retry (event id, values AND time of occurrence) replays; SM239 is "no order policy"; SM234 now also covers an Admin's funded cancellation; the order API must map SM232's closed code from `details`.
* Open items for the owner: `SUPPRESSION_HMAC_KEY` hosting; the real order policy values; the time rules; the option-A limit; and the confirmations in the checklist rows above (Admin and a funded cancellation; the latest-order reading, under which a lead with an accepted order in fulfilment and a later open order of another quote is NOT stopped by the older order).
* Traps: pgTAP files must not assert GLOBAL counts; a bare `select pg_temp.f()` returning the text `ok` prints a line TAP reads as a test (add `is not null`); `array || 'literal'` in plpgsql is read as an array literal (use `array_append(.., 'x'::text)`); a held (psql) session holds FK key-share locks on parent rows, so a `for update nowait` probe cannot prove an explicit parent lock (use the race tests); two e-mail addresses cannot share a key through the API (an address is unique per workspace), so shared e-mail keys are recorded through the data layer in tests.

---

(Earlier hand-off, still true for the traps below.)

**T009 is BUILT (migration parts 1-3, the quote API, the quote screen), committed locally, nothing pushed. It awaits the owner's review.** Do not start T010 (or any plan below) before the owner approves. Plans written, not built: `docs/plans/t010-integration.md`, `docs/plans/order-conversion.md`, `docs/plans/t011-owner-agent.md` (each ends with numbered owner decisions and a recommended default).

* Where things are: ADR 0019, `docs/plans/t009-quote-integration.md` (section 12 "As built"), the "Quotes" rows of `docs/pre-pilot-checklist.md`, the mutation table in `docs/checklist-notes/A.md`.
* Last full `make check` (T009 milestone): exit 0; vitest 962, pytest 2,877, pgTAP 7,833, integration 825, evals 45 + 9 + 29 + 9 passed (one opt-in live case skipped). Seed for local use: `make seed-quote-data TENANT=<slug>` (synthetic only), then `make dev-api` and `make dev-web`.
* Open at hand-off: the owner reads the customer-text wording (`NOTES`, `PAYMENT_TERMS_TEXT` in `app/quotes/service.py`); the UI has not been driven in a real browser; order conversion must refuse withdrawal of an approved quote once an order exists (hook in `withdraw_approved_quote`, checklist row).

---

(Earlier T008 hand-off, still true for the traps below.)

T008 (Requirement Agent) is BUILT: commits 1-7, the closing batch (3c: lock order + SM211, the clock fix, the docs) are committed locally (nothing pushed); ADR 0018 and the checklist rows are written. What remains is the owner's review, then the NEXT ticket.

* Full `make check` and ONE mutation pass were the last steps (see the T008 report); results are in the commit message of the last T008 commit.
* **Do not start T009 or any live call** before the owner approves. Before the first live call: the approvals in `docs/pre-pilot-checklist.md`, section "Enquiries and requirements".
* **T008 is ACCEPTED (owner, 2026-10-06).** Next: **T009 integration is PLAN ONLY**: `docs/plans/t009-quote-integration.md` awaits the owner's review; no code or migration until it is approved (the first stop for review is after its migration + functions commit).
* Plan and as-built notes: `docs/plans/t008-requirement-agent.md` (sections 14 and 15). Decisions: `docs/adr/0018-...`.

Traps: never run `ruff format` on a directory outside the files you edit (it reformats `services/ai-api/app/leads/review.py`, `scoring.py` and `app/agents/requirement_tools.py`, which are not ruff-formatted at HEAD; `make lint` runs `ruff check` only). A replacement script that matches reformatted source silently does nothing: assert the match count before writing (this hid two test edits in T009).
`make check` resets the local database before pgTAP (audit rows are append-only). The T008 migrations were generated from templates that are not in the repository: edit the `.sql` files directly. The scrubber patterns in
`app/requirements/scrub.py` must stay equal to the LAST definition of `app.text_has_contact` (`tests/test_requirements_scrub.py` checks it).

**Mutation passes (hygiene).** A mutation harness that edits a source file, runs pytest and restores the file can leave a STALE `.pyc`: Python keys a `.pyc` by the source's mtime in whole seconds and its size, so a restore in the same second
that has the same size keeps the mutant's bytecode (this showed up as four `test_requirements_display.py` failures on the next run, with `app/` identical to HEAD). Rules: run pytest with `PYTHONDONTWRITEBYTECODE=1`; delete every
`__pycache__` (outside `.venv`) after each mutant and at the end; restore with `git checkout -- <file>` (never from memory), refuse to mutate a file that is not clean, and finish by checking `git status`. If an unexplained failure appears
right after a mutation pass, delete the `__pycache__` directories first. SQL mutants: apply a mutated function to the local database, run the pgTAP / integration tests, then `supabase db reset` (it is the only reliable restore).

**Clock-independence check** (repeat before a release): run the web suite with `vi.setSystemTime` in a temporary setup file, and the Python unit suite with a plugin that shifts `datetime.now` / `time.time`; the only test that depended on
the real day (`apps/web/app/app/local-time.test.tsx`) was fixed in the T008 closing batch.
