# Handoff: resume here

T008 (Requirement Agent) is BUILT: commits 1-7, the closing batch (3c: lock order + SM211, the clock fix, the docs) are committed locally (nothing pushed); ADR 0018 and the checklist rows are written. What remains is the owner's review, then the NEXT ticket.

* Full `make check` and ONE mutation pass were the last steps (see the T008 report); results are in the commit message of the last T008 commit.
* **Do not start T009 or any live call** before the owner approves. Before the first live call: the approvals in `docs/pre-pilot-checklist.md`, section "Enquiries and requirements".
* **T008 is ACCEPTED (owner, 2026-10-06).** Next: **T009 integration is PLAN ONLY**: `docs/plans/t009-quote-integration.md` awaits the owner's review; no code or migration until it is approved (the first stop for review is after its migration + functions commit).
* Plan and as-built notes: `docs/plans/t008-requirement-agent.md` (sections 14 and 15). Decisions: `docs/adr/0018-...`.

Traps: never run `ruff format` on a directory outside `app/requirements`, `app/enquiries`, `app/agents/requirement*`; format only the files you edit (it reformats `services/ai-api/app/leads/review.py` and `scoring.py`).
`make check` resets the local database before pgTAP (audit rows are append-only). The T008 migrations were generated from templates that are not in the repository: edit the `.sql` files directly. The scrubber patterns in
`app/requirements/scrub.py` must stay equal to the LAST definition of `app.text_has_contact` (`tests/test_requirements_scrub.py` checks it).

**Mutation passes (hygiene).** A mutation harness that edits a source file, runs pytest and restores the file can leave a STALE `.pyc`: Python keys a `.pyc` by the source's mtime in whole seconds and its size, so a restore in the same second
that has the same size keeps the mutant's bytecode (this showed up as four `test_requirements_display.py` failures on the next run, with `app/` identical to HEAD). Rules: run pytest with `PYTHONDONTWRITEBYTECODE=1`; delete every
`__pycache__` (outside `.venv`) after each mutant and at the end; restore with `git checkout -- <file>` (never from memory), refuse to mutate a file that is not clean, and finish by checking `git status`. If an unexplained failure appears
right after a mutation pass, delete the `__pycache__` directories first. SQL mutants: apply a mutated function to the local database, run the pgTAP / integration tests, then `supabase db reset` (it is the only reliable restore).

**Clock-independence check** (repeat before a release): run the web suite with `vi.setSystemTime` in a temporary setup file, and the Python unit suite with a plugin that shifts `datetime.now` / `time.time`; the only test that depended on
the real day (`apps/web/app/app/local-time.test.tsx`) was fixed in the T008 closing batch.
