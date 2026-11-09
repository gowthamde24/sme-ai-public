# CI speed: a normal PR under 15 minutes (owner, 6 Nov 2026)

## Before: measured on 6 Nov 2026

Sources: 13 successful PR runs and 15 runs on `main` of `.github/workflows/ci.yml` (GitHub's jobs API), and the last 25 merged PRs. Script: `~/Desktop/stack19-jobs/ci-speed/measure.py`.

**One CI run** (wall time from start to the last job; median, and the slowest 10%):

| | Median | Slowest 10% |
|---|---:|---:|
| PR run | 34.1 min | 39.2 min |
| `main` run | 30.3 min | 35.9 min |

**Per job on a PR** (median run time; the queue wait for a free machine is about 2 min a job):

| Job | Minutes | Where the time goes |
|---|---:|---|
| `api` | 31.9 | `pytest -q`: 30.9 min, serial, about 9,900 tests. ruff 0 s, mypy 20 s, apt 17 s, pip 12 s |
| `db-integration-3` | 12.9 | tests 11.5 min, `supabase start` 1.3 min |
| `web` | 10.9 | vitest 8.2 min, eslint 0.9, build 0.8, tsc 0.5 |
| `db-integration-4` | 9.6 | tests 7.8 min |
| `db-integration-2` | 8.9 | tests 7.2 min |
| `db-integration-1` | 7.8 | tests 6.3 min |
| `db-pgtap` | 2.8 | `supabase test db` 1.6 min, start 1.1 min |
| `packages`, `hygiene`, `changes`, `visual`, `db` | under 1 each | |

**Per merged PR:**
- **CI rounds:** a median of 3. That came from "up to date before merging", now off (owner, 6 Nov), plus red rounds.
- **Why rounds went red** (28): 8 were pytest, 7 the db summary (a failed group), 6 pgTAP, 2 integration group 3, 2 vitest, 2 ruff and 1 mypy.
- **Open to merged** is noisy, because merges were held on purpose in the merge chain.

**Local trial.** The full API unit suite took 4 min 44 s with 4 worker processes (pytest-xdist), against 15 min 43 s serial on the same machine. 2 tests out of 9,940 failed:
- a timing-budget test that misses its limit on a busy machine;
- a sanitiser test that fails only on the local Python 3.13.3.

## The plan: one PR per part

1. **Local lint and type-check before every push** (this PR). `scripts/hooks/pre-push` checks only the changed parts (ruff and mypy for the API, eslint and tsc for the web, tsc for the contracts); `make hooks` installs it. About 7 s on an API change.
2. **The API's unit tests in parallel shards.** Several jobs, each with pytest-xdist on the runner's 4 CPUs, with files balanced by recorded duration. The required check `api` stays as the job that sums up the shards (the 11 required check names do not change). `concurrency` cancels a PR's superseded run. Target: about 5 min instead of 32.
3. **The web tests in 2 shards** (`vitest --shard`); `web` stays the summing job. Target: about 5 min instead of 11.
4. **Caches.** mypy's cache, ESLint's cache, Next.js's build cache and the API's installed venv. Small (seconds each), but on every run.
5. **The integration groups balanced by measured time.** Today group 3 takes 12.9 min and group 1 takes 7.8; the four groups stay (they are required checks). Target: about 9 min each.
6. **A fast lane for small fixes.**
   - **Eligible:** a PR that changes only code and tests, in a few files, with no migration, workflow, deploy or dependency change.
   - **What runs:** only the affected unit tests (an import graph for Python, `vitest related` for the web), the repo-wide safety tests (logging, hardening, error shape, inventory, hosting env, catalog), and lint, type-check and pgTAP.
   - **Full suite after merge:** a push to `main` still runs everything, and a red `main` opens an issue.
   - **Opting out:** the label `full-ci` forces the full run.

**Expected result:** a normal PR in about 12 min (the integration groups plus the queue), and a fast-lane PR in about 6 min.

## After

**Part 2 (#393), measured on its own CI run, 6 Nov 2026:**

| Job | Before (median) | After |
|---|---:|---:|
| `api` (sum of api-static + 3 test parts) | 31.9 min | parts 4.8 / 40.9* / 3.2 min; tests alone about 3 min each |
| `web` (sum of web-static + 2 test parts) | 10.9 min | static 2.5, tests 4.7 / 3.8 min |
| db-integration-1..4 | 7.8 / 8.9 / 12.9 / 9.6 min | 7.5 / 7.5 / 9.7 / 9.8 min |
| db-pgtap | 2.8 min | 2.9 min |
| Whole run | 34 min | 42.9 min* |

*One part waited 37 minutes for Ubuntu's package mirror while installing ffmpeg and Tesseract; the same step took 17 s before. Its tests took 3 minutes. Part 3 (this file's next PR) caches those packages.

Without that stall, the longest job is integration group 4 at 9.8 min, so a PR run takes about 10–12 min plus the wait for a free machine. With 7 PRs open at once, that wait was the main delay: about 16 jobs per run against the account's ~20 concurrent jobs.
