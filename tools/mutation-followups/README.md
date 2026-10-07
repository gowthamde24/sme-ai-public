# Mutation tools for T010 part 2 (follow-ups)

The runner and the mutant lists of the mutation pass of commit 5 (`docs/checklist-notes/A.md`, "T010 part 2 (commits 1-4d): mutation pass"). They are NOT part of `make check` (a full SQL run is about
45 minutes). Run them at a milestone, or when a follow-up function, trigger, constraint or screen changes. Standard library only: no dependency was added.

A **mutant** is the code with ONE small change that should make a test fail. If every test still passes, the mutant **survived**: a test is missing (or the change is equivalent: nothing observable
changes, which must be written down with its reason). Three kinds:

| Kind | A mutant is | Tested by | Restored by |
| --- | --- | --- | --- |
| SQL function | the LATEST definition of ONE function with ONE text replacement, re-created on the LOCAL database | pgTAP 62-65 (63 alone for the question objects, then all four when it survives) | re-creating the original definition from the migrations |
| SQL statement | a trigger disabled, an index or a CHECK / unique constraint dropped, an RLS policy loosened or removed, a grant widened | the same pgTAP files | the undo statement (generated with it) |
| Python / web source | ONE text replacement in ONE file | `tests/test_followups_*.py` / the follow-up vitest files | `git checkout` of that file (the run refuses to start when the file is not clean) |

## How to run (from the repository root; the local stack must be running: `make db-start`)

```
python3 tools/mutation-followups/run_sql.py --list            # how many SQL mutants (588; unchanged by followups-whatsapp, which has no database change)
python3 tools/mutation-followups/run_sql.py                   # all of them against pgTAP; resumable (a killed run continues where it stopped)
python3 tools/mutation-followups/run_sql.py --survivors       # after you strengthened the tests: re-run the survivors (a later answer replaces the earlier)
python3 tools/mutation-followups/run_sql.py --realstack       # survivors against the real-stack suites: the race tests (locks) and the equivalence + API tests (request builder)
python3 tools/mutation-followups/run_source.py py             # the API mutants (133)
python3 tools/mutation-followups/run_source.py web            # the screen mutants (113)
python3 tools/mutation-followups/summary.py                   # counts, and what is still alive
```

**Run ONE runner at a time.** Two runners at once (for example `py` and `web`) share git's index lock: a restore (`git checkout`) can fail silently and leave a mutant in the working tree, and the next mutant of that file then refuses to start ("is not clean in git"). If that happens, look at `git diff` (it must be exactly one mutant), `git checkout -- <file>`, and resume (the run is resumable). Found during the followups-whatsapp mutation delta.

`--limit N` and `--only TEXT` (SQL) narrow a run. Results are appended to `tools/mutation-followups/out/*.jsonl` (git-ignored), keyed by the mutant's description, so a result survives a source change
that does not move that mutant.

## What it restores, and the baseline check

* A SQL mutant is applied with `create or replace function` and undone the same way, in a `finally`: a failure in the middle of a test run still restores the original. If the process is killed
  (power, Ctrl-C at the wrong moment) the database may hold a mutant: run `make db-reset` (the migrations are the truth).
* The pgTAP **baseline** (the four files, unmutated) runs before the first mutant, every 40 mutants and at the end. A failing baseline stops the run: a "killed" mutant would otherwise mean nothing.
* Python and web mutants are restored with `git checkout -- :(literal)<path>`, never from memory; the web paths contain `[brackets]`, hence the literal pathspec.
* Nothing else is touched. Only the container named by `supabase/config.toml` is used; no key, no network.

## Reading a survivor

1. Is it **equivalent**? (another layer refuses with the same SQLSTATE; the case cannot be reached; two values can never be equal.) If so, write the reason in `docs/checklist-notes/A.md`.
2. Otherwise a test is missing: add it, then `--survivors` (and `--realstack` for lock and builder mutants).
3. A test that fails ONLY because another guard raised the same SQLSTATE proves nothing about the guard you meant: isolate it (pgTAP 62 section O has `only_check`, which drops every other CHECK of a table in a
   rolled-back sub-transaction; the race tests have `row_lock_held`, which tells a deliberate `FOR UPDATE` / `FOR SHARE` from the lock any UPDATE takes).

## Files

`common.py` (database, pgTAP, restore) · `sql_generate.py` (the operators, the guard operators, the statement mutants) · `sql_manual.py`, `py_mutants.py`, `web_mutants.py` (hand-written mutants: a snippet
that is gone stops the run with an error, so the lists cannot silently rot) · `run_sql.py`, `run_source.py`, `summary.py`.
