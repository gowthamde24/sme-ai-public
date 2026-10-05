# Handoff: resume here

Part A (T007 M3b, cost-cap review fixes) is COMMITTED (see `git log`). Part B, the T008 Requirement Agent PLAN (`docs/plans/t008-requirement-agent.md`), is the next
piece of work: plan only, no code, stop for the owner's review. Read the existing schema first (grep migrations for enquiry / rfq / quote / message).
Trap: never run `ruff format` on a directory (it reformats `services/ai-api/app/leads/review.py` and `scoring.py`); format only the files you edit.
Backups of the Part A work are in `~/Desktop/sme-ai-backup/` (not needed any more once the commit is in).
