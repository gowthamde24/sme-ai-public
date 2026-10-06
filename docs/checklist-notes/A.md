# Lane A checklist notes

Record ticket, checklist row, evidence, unresolved risk and proposed status here. Lane A consolidates these into docs/pre-pilot-checklist.md after review.

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
