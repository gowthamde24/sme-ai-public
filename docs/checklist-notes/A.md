# Lane A checklist notes

Record ticket, checklist row, evidence, unresolved risk and proposed status here. Lane A consolidates these into docs/pre-pilot-checklist.md after review.

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
