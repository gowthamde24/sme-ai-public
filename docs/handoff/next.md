# Handoff: resume here

**STOP POINT (2026-10-06): T010 commits 1-3 (suppression keys, the hard gate) and order conversion commits 1-4 (ADR 0021, the lifecycle adapter and builder, the migration with its pgTAP, the equivalence and race tests) are BUILT and committed locally; nothing is pushed. Both await the owner's review.** Do NOT build the API or web parts of orders (commits 5-6), do NOT start T010 part 2 (cadence adapter, touches, drafts: plan commits 4-9) and do NOT start T011a before the owner approves.

* Where things are: `docs/adr/0020-suppression-keys-and-follow-up.md` and `docs/plans/t010-integration.md` (section 10, as built); `docs/adr/0021-orders.md` and `docs/plans/order-conversion.md` (section 10, as built); the "Suppression keys" and "Orders" sections of `docs/pre-pilot-checklist.md`; the mutation table in `docs/checklist-notes/A.md` (T010 part 1 and orders: 346 SQL mutants, 330 killed, 16 equivalent and documented).
* Migrations (both unpushed, so amendable until pushed): `supabase/migrations/20261018090000_t010_suppression_keys.sql`, `supabase/migrations/20261019090000_order_conversion.sql` (the second REPLACES `approve_quote` and `withdraw_approved_quote`; `tests/test_migration_copies.py` pins the copies).
* New code: `services/ai-api/app/suppression/` (key ring, hooks on create / update / import / erasure, backfill and status endpoints) and `services/ai-api/app/orders/` (`lifecycle_port.py` = the ONLY door to `packages/pure/order_lifecycle`; `builder.py` = the request the database rebuilds). The order ROUTES, repository and web do not exist yet.
* Last checks: `make check-fast` exit 0 (vitest 962, pytest 3,234); pgTAP full suite 8,620 (61 files); the new real-stack suites 58 passed. The full `make check` (Docker, evals) was not run in this stage.
* Contracts the next steps must keep: the database REBUILDS every order request (`app.order_build`, `app.order_decide`) and refuses a different one (SM238); `owner_override` is derived from the role, never sent; a stale client gets SM238 and must re-read (the request carries the ledger); an exact retry (same event id, values AND time of occurrence) replays; SM239 is "no order policy in force" (the plan's SM222 sits in the follow-up range); `app.order_stops_followups(lead)` is the read-only helper T010 part 2 must call under the lead's lock.
* Open items for the owner: the hosting of `SUPPRESSION_HMAC_KEY` (the process refuses to start outside development without it); the real order policy values; the time rules (valid through the last second of the day in India; `as_of` within 10 minutes before / 2 after the database clock; `occurred_at` up to 30 days old); the option-A limit (a member calling PostgREST can record a wrong key or report a payment that did not happen).
* Traps met here: pgTAP files must not assert GLOBAL counts (committed rows of earlier integration runs break them); a bare `select pg_temp.f()` that returns the text `ok` prints a line TAP reads as a test; `array || 'literal'` in plpgsql is read as an array literal (use `array_append(.., 'x'::text)`); a Held (psql) session holds FK key-share locks on parent rows, so a `for update nowait` probe cannot prove an explicit parent lock: use the race tests.

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
