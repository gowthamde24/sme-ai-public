# Rules for every coding agent

Read this file, CLAUDE.md, docs/product.md, docs/architecture.md and docs/lanes.md before work. These owner rules govern every tool and override older local-stack and blanket test instructions in existing docs.

- One agent per working folder. B and C always use their own git worktrees; lane A normally works in the owner’s main checkout on `main`, with its existing environment. An optional `lane/a` worktree provides lane guarding for A. Write only inside your opened working folder; never touch another agent’s folder. Stay inside your lane’s paths in lanes.json. At most three product agents (A, B, C).
- Never read or print .env files or any secret file. Never put keys into code, docs or tests. No service-role or secret keys.
- No `supabase config push`, deployment, cloud accounts, paid dependencies or real customer data. Use synthetic fixtures only.
- Never push to GitHub or change remotes. The owner pushes and merges.
- Lanes B and C must not start the Docker Supabase stack, run `make check`, or use ports 8000, 3000 or 54321. Lane A alone may start the local stack (one stack at a time), use these ports and must run `make check` once before each commit. Start and stop only your own processes, recording their PIDs; record ownership of Docker containers started by the stack as well. Never stop another lane’s processes or containers.
- Commit often so work cannot be lost. Use the repo’s ticket-prefixed style: `T009: deterministic quote fixtures`, `T007 M2: ...`; setup work uses `Setup: ...` (like the existing `Hygiene: ...` maintenance commits).
- Edits to CLAUDE.md, AGENTS.md and docs/lanes.md come through a setup branch approved by the owner; product lanes must not edit them.
- Make the smallest safe choice when unclear and state it in the report. A path allow-list does not authorize security work in B or C; move that work to A.

## Testing tiers

FULL treatment only for tenant boundaries, auth, the agent write path, provenance, consent, erasure, and anything that can leak or forge data. FULL means relevant allow/deny and adversarial tests, pgTAP/direct PostgREST/API checks where applicable, containment evals and guard mutations where relevant. Lane A owns this work and performs pgTAP, real-stack tests, direct-PostgREST attack tests and mutation checks locally. CI is a second check, not a replacement for lane A's local checks.

Use normal unit/integration tests for ordinary endpoints and UI; smoke tests for docs and plumbing. Run only relevant lint, type-checks, tests and evals while developing; lane A also runs `make check` once before each commit. CI runs the existing full web/API/database/integration/eval suite on every PR; the on-demand browser walkthroughs are not currently in CI. Lanes B and C use no local database or shared ports; UI testing uses mocks and, if needed, a separately assigned unused port.

## Report

At most 20 lines: files added/changed, what was tested, what could not be verified, risks or smallest safe assumptions, any rule you could not follow, and handback branch plus PR description. Never include secrets. The owner merges after green CI.
