# Handoff: resume here

T007 is complete on fakes (M1-M3 and the M3b cost-cap review fixes are committed; see `git log`). The T008 Requirement Agent PLAN is written
(`docs/plans/t008-requirement-agent.md`) and **awaits the owner's review**: plan only, no T008 code exists. Do not start T008 commit 1 before the owner approves
the plan and answers section 12 (scrub before store, template questions, who confirms, required fields, languages, retention).

Traps: never run `ruff format` on a directory (it reformats `services/ai-api/app/leads/review.py` and `scoring.py`); format only the files you edit.
If `make check` fails in pgTAP file 28 ("no part of the rejected contact appears..."), the local database holds leftover committed audit rows from an earlier
integration run: `supabase db reset` and rerun.
