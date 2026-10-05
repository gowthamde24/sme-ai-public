# Handoff: resume here

T008 (Requirement Agent) is BUILT: commits 1-7 are committed locally (nothing pushed); ADR 0018 and the checklist rows are written. What remains is the owner's review, then the NEXT ticket.

* Full `make check` and ONE mutation pass were the last steps (see the T008 report); results are in the commit message of the last T008 commit.
* **Do not start T009 or any live call** before the owner approves. Before the first live call: the approvals in `docs/pre-pilot-checklist.md`, section "Enquiries and requirements".
* Plan and as-built notes: `docs/plans/t008-requirement-agent.md` (sections 14 and 15). Decisions: `docs/adr/0018-...`.

Traps: never run `ruff format` on a directory outside `app/requirements`, `app/enquiries`, `app/agents/requirement*`; format only the files you edit (it reformats `services/ai-api/app/leads/review.py` and `scoring.py`).
`make check` resets the local database before pgTAP (audit rows are append-only). The T008 migrations were generated from templates that are not in the repository: edit the `.sql` files directly. The scrubber patterns in
`app/requirements/scrub.py` must stay equal to the LAST definition of `app.text_has_contact` (`tests/test_requirements_scrub.py` checks it).
