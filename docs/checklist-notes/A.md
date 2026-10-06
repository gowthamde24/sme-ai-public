# Lane A checklist notes

Record ticket, checklist row, evidence, unresolved risk and proposed status here. Lane A consolidates these into docs/pre-pilot-checklist.md after review.

## Step F: findings (2026-10-06)

**F5: what bounds `occurred_at` on an order event (the time a person says it happened). Not changed; recorded by `test_what_bounds_the_time_a_person_says_an_event_happened_today` (real stack).**
| Layer | Bound |
| --- | --- |
| Web form | the day picker has `max` = today (India) and no minimum; an earlier day is sent as noon in India; today is the page's own render time |
| API model (`RecordEventIn`) | any timezone-aware time (a naive time is a 422); no bound against the future, the past or the order |
| Lifecycle (pure package) | none: `occurred_at` never enters the engine |
| Database (`record_order_event`, `20261019090000_order_conversion.sql` line 810) | **not more than five minutes in the future and not more than 30 days in the past, measured against the database clock.** Outside it the answer is 22023 (a 422 `invalid_value` through the API) |
| Against the order's creation time | **none.** An event dated 20 days before the order was created is accepted |
| Against the previous event's time | **none.** An event can be dated earlier than the one before it; the ledger's order is the recording order (`seq`), not the order of the dates |
Consequences to weigh before real use (not changed here): a payment can be dated before its order existed and events can be out of date order, so a report that sorts by `occurred_at` and one that sorts by `seq` can disagree; the 30-day window means a payment received 31 days ago can only be recorded with a date inside the window; the web form shows the database's 422 as the generic "That input was not accepted". An owner decision on a floor (the order's creation date, or the previous event's) is a database change and was not made.

**F3: was Next.js's server-action body limit what made 900,000 bytes necessary? Yes.** The framework caps a server-action request at 1 MB by default (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`: "Action requests are capped at 1MB by default"; `serverActions.bodySizeLimit` raises it, and this repository does not set it). The price-list form posts the whole file as one field inside the action request (a check, and again on a save), so the earlier 2 MB limit would have failed inside the framework with a generic error before our own sentence. The limit is now 900,000 BYTES everywhere (the browser check, the file picker, the action with `TextEncoder`, the API model), which leaves room for the form's other fields; a Telugu character is three bytes, so the character count of the old limit was wrong by up to a factor of three.

## Rehearsal small fixes A-C, the order and price-list pages: mutation pass (2026-10-06)

Same method as the sections below (SQL: a function re-created and restored with the baseline checked first; Python and TypeScript: the file edited, the unit tests run, the file restored; a "kill" is a FAILING test, a broken build is reported apart).

**138 mutants: first pass 120 killed, 18 survived; 17 closed with new tests and re-run killed, 1 equivalent => 137 killed + 1 equivalent.**
* SQL, A1 (`add_requirement_field`: an exact retry replays on a confirmed requirement): 14 mutants, first pass 6 killed, 8 survived; 7 closed, 1 equivalent.
* Python, A2 (the shared character rule), the price-list import (service, routes, adapter, repository) and the order guidance: 59 mutants, first pass 53 killed, 6 survived; 6 closed.
* TypeScript, the order page's role and form rules, the second-factor notices, the money and date rules, the strict parsing, the price-list page's save rules: 65 mutants, first pass 61 killed, 4 survived; 4 closed.

| Survivor | What it was | Disposition |
| --- | --- | --- |
| A103 a field an agent proposed and a person confirmed replays as that person's own | no test confirmed an agent's field and then retried it | closed: `test_a_field_an_agent_proposed_and_a_person_confirmed_is_not_the_persons_own_retry`; killed |
| A105, A106 the quote's start or end is not compared on a confirmed retry | the API finds the span itself, so a different span reaches the function only directly | closed: a direct call with the same words at a start moved over spaces, then at an end moved over spaces; killed |
| A107, A108, A109, A114 the text, the basis, the number or the line is not compared | the first test changed only the code value | closed: one retry per part of the field (another value, number, basis, text, quote, line, slot, key) is refused; killed |
| A104 the quote text is not compared on a confirmed retry | EQUIVALENT: the span (start, end) is validated against the quote text, so equal spans mean equal text | documented |
| T06 a lone surrogate is accepted by the character rule | the CSV path rejects a surrogate earlier (not UTF-8), so only the rule itself reaches it | closed: `tests/test_text_rules.py` tests every refused category directly; killed |
| S09 issues are not sorted by row | the example happened to be in order | closed: a file whose sku order differs from its row order; killed |
| P06 an ok result that also lists errors is accepted | the hash check caught the test's fake first | closed: the same result with a correct hash; killed |
| Q05 the catalog is asked in chunks of a thousand | the test read the chunk size from the module under test | closed: pinned as 100 with 201 skus; killed |
| G05, G06 a failing lifecycle gives partial guidance; a fixed clock | no test made the lifecycle fail; the example order was valid on both clocks | closed: a failing lifecycle gives none; a quote that expired on 3 October is expired now; killed |
| W08 a cancellation needs no second factor on the order page | the notice was tested for payments only | closed: cancel, refund and payment for the owner without a second factor; killed |
| W10 the amount cap is one paisa higher | no boundary test | closed: Rs 1,00,00,000 is the largest amount, one paisa more is not; killed |
| W35 a cancellation is a primary button | styling untested | closed: cancel and refund are the quiet buttons; killed |
| V24 the check button is not disabled while it runs | no pending state test | closed: a controlled slow action; killed |

**The A2 grep (`Cf` and zero-width characters in the repository's text cleaning), what it found:**
| Where | What it does with U+200C / U+200D | Verdict |
| --- | --- | --- |
| `app/evidence/models.py`, `20261006100000_t004_text_hygiene.sql`, `apps/web/lib/api/evidence.ts` | accepted (ZWNJ, ZWJ, LRM and RLM stay legal) | fine |
| `app/agents/schemas.py` (`_clean`) | accepted (joiners and direction marks allowed) | fine |
| `app/webfetch/sanitize.py` | kept (ZWNJ, ZWJ, LRM, RLM) | fine |
| `app/leads/keys.py` and `20261007090000_t005_match_keys.sql` | removed from MATCH KEYS on purpose (a duplicate check ignores them) | fine |
| `app/webfetch/urls.py` | refused in a URL (a host name is not Indic text) | not touched |
| `app/leads/csv_rows.py` | REFUSED every `Cf` character, including ZWNJ and ZWJ | **fixed (A2)**: one shared rule, `app/text_rules.py`, also used by the price-list import |
| `app/requirements/capture_text.py` | STRIPS them from a pasted enquiry by default (`KEEP_INDIC_JOINERS = False`; the code says an owner decision is pending) | **not changed**: a stripped joiner can change how a word renders but never rejects the enquiry; an owner decision, now in the checklist |
| `packages/pure/quote_text/__init__.py` (`_string`) | REFUSES any `Cf`, so a product NAME with a joiner makes the quote text fail (`quote_text_refused`; the approval stands) | **not changed**: a pinned lane C package (version, golden vector); the checklist row asks for a lane C change |
| `tests/integration/research_eval.py` | test helper that allows them | fine |

Evidence: `make check` exit 0 (vitest 1,178, pytest 3,616, pgTAP 8,709 in 61 files, integration 923, evals 45 + 9 + 29 + 9 passed, the one opt-in live case skipped). One pgTAP assertion (58 E6) had assumed the old zero credit limit of the seed and was re-worded; the first full run failed on it and the second passed. `make rehearse-thin-slice` on a fresh database: 343 of 343 checks, the second pass changed no row.

## Rehearsal steps 0-3: mutation pass (2026-10-06)

Same method as below (a SQL function re-created and restored with the baseline checked first; Python mutants applied to the file, unit tests run, file restored; a "kill" is a FAILING test, a broken import is reported apart).

**SQL, the step 0 guards (`20261021090000_erased_marker.sql`): 31 mutants, first pass 27 killed, 4 survived; 2 closed with new tests and re-run killed, 2 equivalent => 29 killed + 2 equivalent.** **Python, the order routes' guards (body-field refusal, SQLSTATE mapping, role handling, replay status, paging): 52 mutants, first pass 46 killed, 6 survived; all 6 closed with tests and re-run killed => 52 killed.**

| Survivor | What it was | Disposition |
| --- | --- | --- |
| MK07 `mark_erased` takes no per-key lock | the one race test erased through the API, which first records the contact's keys and so took the lock itself | closed: `test_a_lift_waits_for_an_erasure_of_the_same_key_and_then_finds_its_marker` holds the erasure open (psql) while the Owner lifts the other contact; the lift must wait and then find the marker; killed |
| SY06 a marker blocks a lift for ever, even after a later lift | no application path writes a `lifted` event after a marker (the guard refuses it), so only a direct ledger row reaches the clause | closed: pgTAP 60 P1/P2 write the operator's lift directly and prove an older marker does not block while a newer one does; killed |
| SY07 `e.seq >= coalesce(.., 0)` | EQUIVALENT: `seq` starts at 1 and two events never share a seq | documented |
| OS04 the same quote counts as "newer" (`>=`) | EQUIVALENT: the latest order's own quote has an order, and the `not exists (order)` filter removes it | documented |
| M14 the SM232 message is the raw reason | the unit tests checked only that a message exists (the real-stack suite pinned one sentence) | closed: every reason's sentence is compared with the table, the table is pinned (16 distinct sentences); killed |
| M20 the closed reason list loses ADVANCE_NOT_PAID | the tests iterated the list under test | closed: the list is pinned as a literal; killed |
| R07 the order is not read before an event is recorded | an unknown order was a 404 either way | closed: the test counts what the data layer was asked; killed |
| R08 a malformed id reaches the data layer | the fake answered None for anything | closed: the fake records what it was asked; a malformed id asks nothing; killed |
| R10 a policy retry answers 201 | the fake never replayed | closed: the fake replays by version id; the retry is a 200 with `replayed`; killed |
| R11 the list limit has no upper bound | only `limit=0` was tested | closed: `limit=51` is a 422; killed |

Other findings of the rehearsal itself (not mutation): a typed requirement field cannot be retried after the requirement is confirmed (`requirement_confirmed`); a quote replaced by a newer one cannot be approved again (`quote_not_draft`); the API has no route to add a member to a workspace (the Owner's token is used against the database API); the seeded quote policy gives a repeat customer a credit limit of zero, so every repeat quote carries CREDIT_LIMIT_EXCEEDED.

Evidence: `make check` exit 0 (vitest 962, pytest 3,457, pgTAP 8,709 in 61 files, integration 909, evals 45 + 9 + 29 + 9 passed, the one opt-in live case skipped). `make rehearse-thin-slice` on a fresh database: 294 of 294 checks passed; the second pass changed no row.

## Review fixes (steps 1-3, and the step 4 seed): mutation pass (2026-10-07)

One pass over the guards changed by `20261020090000_review_fixes.sql`: the shared-key lift (e-mail and phone variants, the erasure guard, the per-key lock), the Owner's funded cancellation (SM234, the approver, the widened check, the message), SM237 for non-terminal orders only (approve and withdraw, per state), the lead's-latest-order follow-up stop, and the order policy seed. Same method as the pass above (the original runs first before every mutant; `PYTHONDONTWRITEBYTECODE=1`; `__pycache__` swept; the runner and the lists are scratch). 68 mutants.

**Result: first pass 46 killed, 21 survived, 1 invalid (a typo in the mutant); 14 survivors closed with new tests and re-run killed, the invalid one fixed and killed, 7 equivalent => 61 killed + 7 equivalent.**

| Survivor | What it was | Disposition |
| --- | --- | --- |
| RV1E1, RV1E2, RV1E7, RV1E8 (e-mail variants of the other-holder rule, a lifted holder, the erasure guard) | the first tests covered only a shared PHONE key | closed: pgTAP 60 N11-N15 (an e-mail key recorded through the data layer: an address is unique per workspace) |
| RV1E4, RV1P4 another workspace's holder blocks | the second workspace's contact had no phone, so its key was never recorded | closed: N-section contacts in tenant b (phone and e-mail), N17 |
| RV1E9, RV1P9 the erasure guard reads the earliest event | one-event histories cannot tell earliest from latest | closed: N16, N18 (suppressed, lifted, then erased) |
| RV1EA no per-key lock before the check (e-mail), RV1PA (phone) | single-session tests cannot see a missing lock; two lifts at once leave a number suppressed for ever | closed: `test_suppression_races.py` (two lifts at once, phone and e-mail: the second waits and releases) |
| RV303, RV312 an expired order still blocks approve / a declined order still blocks withdraw | only declined (approve) and cancelled / expired (withdraw) were tried | closed: I43b, I43c |
| RV326 a newer quote WITH an order is counted as no new deal | the latest order was always the newest | closed: J26 (orders created out of quote order) |
| RV328 a closed_paid order does not stop follow-ups | no lead had only a closed_paid order | closed: J28, J29 |
| RV32F a newer approved quote of ANOTHER lead releases the stop | the other leads' quotes were older | closed: J27 |
| RV1E5, RV1P5 the lifted contact itself counts as a holder | EQUIVALENT: in its own transaction the lifted contact is no longer suppressed | documented |
| RV1E6, RV1P6 an erased contact counts as a holder | EQUIVALENT: erasure deletes its stored keys, so it is never a holder | documented |
| RV1EB, RV1PB the trigger's lock names another key | EQUIVALENT: a coarser lock (every key of that kind in the workspace) serialises more, never less | documented |
| RV324 an equal quote number counts as newer | EQUIVALENT: that is the latest order's own quote, which has an order | documented |

Failing-first for the behaviours: the old definition of the sync trigger fails pgTAP 60 section N; Admin cancel with funds, SM237 after a decline and the stop matrix fail on the previous definitions (the earlier pgTAP assertions F42, I-section and J9 had to change with them).

## T010 part 1 (the hard gate) and order conversion (database and proofs): mutation pass (2026-10-06)

One pass over the SQL guards of the two new migrations: `20261018090000_t010_suppression_keys.sql` (125 mutants) and `20261019090000_order_conversion.sql` (221 mutants). Method: `PYTHONDONTWRITEBYTECODE=1`, every `__pycache__` swept first (no Python source was mutated). A mutant re-creates ONE function (the latest definition with one text replacement), or drops / disables ONE trigger, constraint or index, runs the tests that should notice, and restores the original; the original is run first before every mutant (a failing baseline stops the run), and the database was reset before each full pass. Tests that kill a mutant: pgTAP 60 / 61 (about a second each), the real-stack suites for the lock and builder mutants (`test_order_races.py`, `test_order_direct_postgrest.py`, `test_order_equivalence.py`, `test_suppression_races.py`). The runner and the mutant lists are scratch files, not in the repository.

**Result: T010 125 mutants: first pass 97 killed, 28 survived; 23 closed with new tests and re-run killed, 5 equivalent => 120 killed + 5 equivalent. Orders 221 mutants: first pass 167 killed, 50 survived, 3 invalid (a typo in the mutant: fixed, then killed); 39 survivors closed with new or isolating tests and re-run killed, 11 equivalent => 210 killed + 11 equivalent.** Survivors that were NOT equivalent were all tests that asserted the right answer for the wrong reason (another guard raised the same SQLSTATE) or that never reached a boundary.

| Survivor | What it was | Disposition |
| --- | --- | --- |
| KA04 key kind ignored | no test used one value as an e-mail key and a phone key | closed: pgTAP 60 M1, M2 |
| KS01, KL01 a key already suppressed is suppressed again / a key not suppressed is lifted | no test had two contacts sharing one key | closed: pgTAP 60 M3-M6 |
| KS02, KL02, CK15 no per-key lock, no contact lock | single-session tests cannot see a missing lock | closed: `tests/integration/test_suppression_races.py` (held transaction; the shared key gets ONE event) |
| CK14 previous PHONE key versions not matched | only the e-mail side was tested | closed: M7, M8 |
| CK16, CK17 a new key version never replaces the old / one key drops the other | the merge test gave both keys | closed: M9, M10 |
| AW03-AW05 allow-without-key accepts a tenant-wide, executed or cancelled request | only the happy path | closed: M11-M13 |
| CS03, CS07 list limit, the overall `suppressed` flag from a phone match | | closed: M14-M16 |
| UC05, UL04 phone-only unkeyed contacts, the list limit | | closed: M17, M18 |
| EC03 erasure with only the phone keyed | | closed: M19 |
| CN02, CN06-CN09, CN11 table checks hidden behind other checks | the other check raised the same SQLSTATE | closed: M20-M25 (privileged inserts that only ONE check refuses) |
| RE14, CK13 text hygiene of request / result (function and table) | no invisible character was ever sent | closed: pgTAP 61 D30b/c, H35m |
| RE21, RE25 replay ignores the type / the reason | the other fields differed too | closed: G34b-g (events that differ in ONE field only) |
| RE29, RE30 expired / cancelled not treated as closed | only closed_paid and declined were tried | closed: F8b, F10b |
| RE33, RE37 non-canonical as_of text, the +2 minute edge | the forged text was also out of the window | closed: G11b-c, G12b |
| RE47 flag codes not compared | needs_owner_approval also differed | closed: G24b (consistent flag, wrong code) |
| CO11, CO14, CO16, CO18, CO19 the valid-until day, the cap itself, zero value, each advance flag alone | the quotes used failed another SM233 clause or were far from the edge | closed: C31-C33, I21-I29 (a policy of its own for each) |
| PV07-PV09, PV11, PV12, PV15, PV16 policy shapes, past and out-of-order dates, replay across date and tenant | | closed: B13b-d, B16b-f |
| OB03 refunds in reverse order | the builder test had one refund | closed: the direct suite records two |
| TG07, TG10, TG12, TG14, TG28, IX04, CK03, CK04, CK09-CK12 ledger gap, first event, born closed, dispatched -> closed_paid, truncate guard enabled, order number, table checks | gap and first-event cases used an illegal move, so the move guard answered; the final close from `dispatched` was never walked | closed: H20-H21b, H35a-m, E28-E31, A10 (each guard asserted ENABLED), CK checks isolated on a bare order |
| SF01-SF04 the follow-up stop per state | mutants were invalid enum values, then a lead with only a `delivered` order was missing | closed: mutants fixed; J13b/c |
| OD02, OD06, OD13, OD54 refund-ledger bound, ledger amount above the cap, an unknown cancel window, the advance step-back boundary | the generator never produced them | closed: equivalence test limits cases and a 45,000-paid grid row; F36a-c |
| CO04, CO05, CO06, CO07 one or two of the three parent locks of `create_order_from_quote` removed | EQUIVALENT: the quote lock alone serialises the race with `approve_quote` (which UPDATES the older quote), the enquiry lock alone serialises it too; **CO07b (all three removed) is killed by the race tests** | documented (ADR 0021: "any one of the three parent locks is redundant") |
| PV03 a non-object policy accepted | EQUIVALENT: `jsonb_object_keys` raises 22023 on a non-object, the same SQLSTATE | documented |
| PV10 a cancel window after dispatch accepted | EQUIVALENT: the enum column's table check raises 23514, the same SQLSTATE | documented |
| TG03, TG05 the orders guard's move and prior-state checks | EQUIVALENT: the ledger guard refuses any event with an illegal move or a wrong prior state first (two layers; the ledger-guard mutants TG08 and TG09 are killed) | documented |
| TG17 `p_from <> p_to` removed from `order_move_allowed` | EQUIVALENT: neither caller asks about an unchanged state | documented |
| IX05 unique (tenant, order, seq) | EQUIVALENT: the ledger guard's gapless rule refuses a repeated number first | documented |
| WD04 the replaced-quote check ignores the quote status | EQUIVALENT: an ordered quote never leaves `approved` (SM237 on both paths) | documented |
| KO01, KO10 a non-object key set / non-array matching list accepted | EQUIVALENT: the jsonb functions raise 22023 themselves | documented |
| SY06 the sync trigger without its "no keys" early return | EQUIVALENT: a contact with no keys is an all-null record and every branch is skipped | documented |
| UC03 erased contacts counted as unkeyed | EQUIVALENT: erasure nulls the identifiers, so an erased contact has nothing to key | documented |
| BF05 a non-object backfill item not skipped | EQUIVALENT: it has no `contact_id`, so the next condition skips it | documented |

Also found while testing (not mutation): `array || 'literal'` in `app.order_decide` was read as an array literal (every refund / override / cancel with funds failed with "malformed array literal"): caught by the first pgTAP run, fixed with `array_append(..., 'X'::text)` before the commit. The T010 and order pgTAP files were order-sensitive to committed data of earlier integration runs (global counts); every count is now scoped to the file's own tenants, so the files pass on a used database as well as a fresh one (`make check` still resets the database first).

Evidence of this stage: `make check-fast` exit 0 (vitest 962, pytest 3,234); pgTAP full suite 8,620 (61 files); the new and touched real-stack suites 58 passed (order equivalence, direct, races, erasure; suppression api and races); the existing integration suite (845) passed against the order migration before the new files were added. The full `make check` (Docker, evals) was NOT run in this stage (instruction: fast tier per commit plus the mutation pass).

## T009 milestone (steps 2-4): mutation pass and evidence (2026-10-06)

One pass over the guards added in step 2 (migration part 3) and step 3 (the quote API). Method: `PYTHONDONTWRITEBYTECODE=1`, every `__pycache__` swept after each mutant, a source file restored with `git checkout` (never from memory) and refused when not clean; SQL mutants re-create ONE function (or run one statement and its undo) on the local database, then pgTAP 57-59 and the real-stack suites (races for lock mutants). The first pass found survivors; each was either closed with a test or shown equivalent, then re-run.

**Result: Python (steps 3) 57 mutants: first pass 47 killed, 10 survived; 8 closed with new tests and re-run killed, 2 equivalent => 55 killed + 2 equivalent. SQL (part 3) 35 mutants: first pass 25 killed, 10 survived; 6 closed (pgTAP 59 E3, E4, C30) and re-run killed, 4 equivalent => 31 killed + 4 equivalent. No unexplained survivor.**

| Survivor | What it was | Disposition |
| --- | --- | --- |
| BU02 a `proposed` field counts toward a quote | the unit tests used a state name that does not exist (`suggested`) | closed: tests use the real state `proposed`; killed |
| SV06 approval recomputes with today's date, not the quote's | no test moved the quote's date | closed: `test_the_recomputation_uses_the_quotes_own_date_not_todays`; killed |
| SV10 a suggested pick records 64 zeros instead of the mapper's hash | the test checked only the length | closed: compared with the mapper's own hash; killed |
| SV13 the engine is not re-run on the stored request before rendering text | the tamper test changed a total, which the renderer's own conservation checks also refuse | closed: tamper the stored REQUEST, leave the result self-consistent; killed |
| SV15 the stored engine version is not compared | no test | closed: a quote of another engine version is refused; killed |
| RP01 a second-factor refusal from the database is not recognised | route tests injected exceptions; nothing tested the repository's classification | closed: `tests/test_quotes_repository.py` (mock transport, every SQLSTATE); killed |
| RP04 the quote read has no tenant filter | RLS hides it | closed: the repository test pins a tenant filter on every read; killed |
| TX03 the 60-character width contract is not checked | the "too wide" case also had a wrong hash | closed: a correct-hash renderer answer of 61 characters is refused, 60 allowed; killed |
| T01 x5 (price_lists, price_list_versions, price_list_items, quote_policy_versions, quotes) TRUNCATE guard trigger dropped | `TRUNCATE ... CASCADE` fires every trigger it reaches, so another table's guard hid the missing one | closed: pgTAP 59 E3 proves each of the nine tables has its OWN enabled BEFORE TRUNCATE statement trigger; killed |
| S01 anon may execute `withdraw_approved_quote` | the privilege test covered only the four original functions | closed: pgTAP 59 C30; killed |
| SV07 approval recomputes with the newest price version | EQUIVALENT: a newer version fails the database's staleness check (SM215) before the hash is compared, with the same answer | documented |
| SV19 an unconfirmed field is offered a suggestion | EQUIVALENT: the mapper is only ever given confirmed rows, so it cannot suggest for an unconfirmed line; the extra guard is defence in depth | documented |
| W09 withdraw does not lock the quote row | EQUIVALENT: every writer locks the ENQUIRY row first (ADR 0018 decision 9), so any one of the three row locks is redundant; the combined mutant W10 (all three removed) is killed by the race tests | documented |
| B17, B18, R01 flag lists sorted in the default collation | EQUIVALENT in the current vocabulary: the engine and review flag codes are fixed upper-case words that sort the same in every collation (the sku sorts, B16, N01, N02, are killed) | documented; revisit if a flag code with a different case or punctuation is ever added |

Also found and fixed while testing (not mutation): `requirement_facts` had no state filter (an agent-proposed, never-reviewed field could count as a line); caught by its own unit test before commit of the final tests. A text refusal raised inside the renderer step was not caught (it would have been a 500); caught by `test_a_stored_result_that_the_engine_does_not_reproduce_is_refused`, fixed in the same commit as the API.

Evidence of the milestone: `make check` exit 0 (vitest 962, pytest 2,877, pgTAP 7,833, integration 825, evals 45 + 9 + 29 + 9 passed with the one opt-in live case skipped); the real-stack quote API suite is `tests/integration/test_quote_api.py` (12). Limits recorded in `docs/plans/t009-quote-integration.md` section 12.
