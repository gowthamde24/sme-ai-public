# Regression cases: every bug the owner has found

One line per finding in `cases.jsonl`. `tests/test_oq_regression_evals.py` runs every line, offline and deterministic, in the `api` CI job, so **nothing ships that fails one**.

A line has `id`, `found` (date), `by` (who found it), `bug` (what went wrong, in a sentence), and one of:
- `check` + `args`: a check function of the test module (router kind, language of a typed text, the text a model wrote after cleaning, the words an engine is given, a scan of every line the product ships ...);
- `covered_by`: the test that already pins it (`path::test_name`); the runner makes sure that test still exists.

**When the owner (or anyone) finds a new bug: add a line here in the same PR as the fix.** A fix without a case is not finished. Cases that need a live model (the wording of a real reply) go to `tests/evals/casual/cases.jsonl` and the staging run in `~/Desktop/stack19-jobs/casual-check`.
