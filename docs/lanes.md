# Parallel working lanes

One agent per folder, in its own git worktree; at most three product agents. AGENTS.md governs all agents. The machine-readable source of path ownership is lanes.json; patterns match the whole path, `*` spans slashes, `?` matches one character and brackets are literal. Deny rules win. Unknown lanes fail closed. A path grant never permits forbidden behavior.

| Branch / agent | Owned paths and responsibility | ADRs |
| --- | --- | --- |
| lane/a / A (Claude Code) | Everything except guard integrity files and exclusive B/C paths; includes Makefile, deploy/, root config, any backend scripts, ci.yml, docs/plans/, database-facing and security-tier code, runtime and evals | 0017–0039; 0017 exists, next is 0018 |
| lane/b / B (web/UI) | Existing globals.css, favicon, local-time component/tests, review/factor-breakdown component/tests, touch-targets test; new apps/web/components/ui/ and components/mocks/; new e2e/ui/ and e2e/mocks/, e2e README/package metadata; docs/contracts/B/ | 0040–0049 |
| lane/c / C (pure libraries) | New packages/quote-engine/ and packages/pure/ under the existing packages/ layout; docs/plans/ shared with A by ticket coordination | 0050–0059 |

The new component, mock and pure-library directories reserve paths, not feature scope. No mobile app is introduced: mobile polish means responsive web UI. Lane C's T009 calculation library takes explicit inputs and has no database or network; approval, authoritative catalog lookup, persistence and provenance integration belong to A. A owns existing services/ai-api pure helpers to avoid splitting that service across agents.

B's deliberately narrow grant keeps server-rendered database-facing pages and existing write forms with A. B hands presentational components to A for wiring. Existing e2e scripts require a database and perform writes; B must not run them. New UI browser tests use synthetic mocks only. B and C use NO local database and no shared ports. Only A may start the local Docker Supabase stack, one stack at a time, and use ports 8000, 3000 and 54321. A runs relevant lint, type-checks, unit/integration tests and evals per tiers during development, pgTAP, direct-PostgREST attack tests and mutation checks for security-tier work, and `make check` once before each commit. Run the feature locally and verify the flow. Start and stop only your own processes by recorded PID; record ownership of containers started by the local stack and never stop another agent’s processes or containers. CI is a second check, not a replacement for lane A's local checks. CI runs the full existing suite on every PR (legacy on-demand browser walkthroughs remain outside CI).

## Contracts and checklist

B first writes an API contract file in docs/contracts/B/: request/response shapes, errors and synthetic examples. A reviews before wiring; B uses a mock until the endpoint exists. Generated packages/contracts/ stays A-owned. Mock screens must be clearly identified as mock/demo; never present invented state as live backend state.

Each lane writes docs/checklist-notes/A.md, B.md or C.md with ticket, checklist row, test evidence and unresolved risks. A merges the notes into docs/pre-pilot-checklist.md after review, preserving unresolved items. Allocate unused ADR numbers within the lane range; never renumber or overwrite existing ADRs. A’s range starts at 0017 but stops before B's reserved 0040; coordinate another allocation when exhausted.

## Owner commands

Run from a clean checkout of this repo. First ensure local main contains the owner-approved latest commits (the script uses local main, never fetches or pushes). The commands below create all three folders; use only those needed:

```sh
./scripts/new-lane.sh a
./scripts/new-lane.sh b
./scripts/new-lane.sh c
code ../sme-ai-a
code ../sme-ai-b
code ../sme-ai-c
```

`code` is the VS Code CLI; another editor can open the same absolute folder. Open exactly one lane folder per agent, then read AGENTS.md there. Names a/b/c map to A/B/C; custom names may create a worktree but fail CI until an owner-approved policy exists. lane/setup is a temporary docs/plumbing exception restricted to the files listed in lanes.json, not a fourth product lane. Only owner/setup maintenance may change lanes.json, root AGENTS.md, scripts/check-lane-paths.sh, scripts/new-lane.sh, scripts/test-lanes.py and .github/workflows/lane-paths.yml. A may freely edit .github/workflows/ci.yml, Makefile, deploy/ and root config within the standing behavior rules (deploy/ permission is not authorization to deploy). A and C coordinate ticket ownership before editing the shared docs/plans/ paths.

## Develop, hand back and merge

Commit often using the repo's ticket-prefixed messages. Run only relevant tests under AGENTS.md tiers; docs/plumbing use smoke tests. Check committed changes with `./scripts/check-lane-paths.sh b main` (substitute a or c). The checker reads lanes.json using `git show <merge-base>:lanes.json`, never the working tree or PR head. It compares merge-base to HEAD, including deleted files and both sides of renames; uncommitted files are not a branch diff, so inspect and commit them before handback.

Hand back branch plus a ready PR title/description: concrete behavior, files/contracts, tier and checks run, checklist notes, limitations and dependencies. Agents never push or change remotes. The owner pushes, opens the PR and merges only after CI is green. The dedicated lane-paths workflow extracts and runs scripts/check-lane-paths.sh from the target BASE commit; the trusted script reads policy from that BASE commit (LANE_POLICY_FROM_BASE=1 in CI). Local checks default to the merge-base. Changes to a PR’s own policy or checker cannot loosen that check. CI checks every lane/* PR against its actual target base SHA; keep branches targeting main. Unknown lane names fail. The path guard checks ownership, not whether code is security-sensitive; owner review must enforce semantic boundaries and review changes to the guard itself.

Merge A's agreed contracts/endpoints before dependent UI integration. Only the owner merges branches; agents never merge another lane or edit its folder. Rebase only your own branch onto owner-updated local main, with a clean tree and before owner publication; do not rewrite a published branch without owner direction. Resolve conflicts only in your allowed paths; hand cross-lane conflicts back to the owner. Re-run relevant tests and the path guard after rebasing. No automatic fetch, force-push or main mutation by agents.

After merge, the owner closes the editor/agent and runs from the original checkout:

```sh
git worktree remove ../sme-ai-b
git branch -d lane/b
```

Substitute a or c as needed. No `--force`: dirty worktrees must be reviewed and committed first. For squash merges, `-d` may refuse because ancestry differs; retain the branch until the owner verifies the squash contains all work. Never delete another active agent's worktree.

## Guard integrity and bootstrap

B and C use strict path allow-lists and may not add or modify symlinks, submodules, Git control files (.gitmodules, .gitattributes or hooks), file modes or new executable bits. The guard inspects `git diff --raw -z`; ordinary regular-file additions/deletions remain allowed. A uses allow-everything minus deny: protected guard files and exclusive B/C paths, including their ADR ranges and checklist notes. docs/plans/ is deliberately shared with C; coordinate edits before work.

Pull requests from branches not named lane/* are not guarded. The owner must accept other agents’ work only from lane/* branches and make the **lane-paths** check a required status check in the GitHub branch rules for main. This docs-only setup does not change GitHub settings. Review changes to the guard workflow itself; branch rules do not make modified workflow definitions trustworthy automatically.

Bootstrap: when the base has no lanes.json or trusted guard, fail closed. The first merge is done locally by the owner after reviewing and testing this setup; do not fall back to the PR head. Before subsequent guard changes, the owner validates them locally with the proposed script tests. For a trusted local check, extract the checker from the base rather than executing a potentially edited working-tree script:

```sh
lane_guard=$(mktemp)
git show main:scripts/check-lane-paths.sh > "$lane_guard"
bash "$lane_guard" b main
rm -f "$lane_guard"
```

## Pure package tests

`make test-packages` discovers `test_*.py` stdlib unittest tests under every packages/* directory, excluding dependency/cache folders, with no new dependencies. CI runs it from day one in its packages job; lane A’s `make check` includes it too. Tests must be pure, synthetic and database/network-free; the runner blocks Python socket access. Use unittest (pytest-only tests are not supported); new packages should include tests. The runner is not a sandbox against shell commands or native extensions, so review must preserve the pure-library contract.
