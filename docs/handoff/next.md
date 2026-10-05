# Handoff: resume here

T008 (Requirement Agent) is in progress. Commit 4 (the agent on fakes) and commit 3b (migration 20261015090200, the owner's review changes) are committed; commit 5 (API + paste screen + review screen) is committed; NEXT is commit 6 (evals and the golden set); the plan is `docs/plans/t008-requirement-agent.md` (ACCEPTED with the owner's changes A-J).

* Commit 1 (schema, contact guard, scrubber), commit 2 (deterministic services) and commit 3 (migration 20261015090100: the requirement agent's
  definition and flag, `agent_write_requirement_field` with the database-verified quote, `decide_requirement_field`, `confirm_requirement`,
  `discard_requirement`, the enquiry run target) are committed. **STOP: commit 3 awaits the owner's review.** Do not start commit 4 before the owner says go.
* Remaining after the review: 4 the agent on fakes, 5 API and the paste screen, 6 evals and golden set, 7 ADR 0018 + checklist rows + handoff, then the
  FULL `make check` and the mutation pass ONCE (the owner's process for T008), and stop.
* Process for T008: between commits `make check-fast` plus the new tests; the full check and the mutation pass only at the end.

Traps: never run `ruff format` on a directory outside `app/requirements` (it reformats `services/ai-api/app/leads/review.py` and `scoring.py`); format only
the files you edit. `make check` now resets the local database before pgTAP (audit rows are append-only). Migrations 20261015090000 / 090100 are generated
from templates kept outside the repo; edit the .sql files directly from now on (the scrubber patterns in 090000 must stay equal to
`app/requirements/scrub.py`; `tests/test_requirements_scrub.py` checks it).
