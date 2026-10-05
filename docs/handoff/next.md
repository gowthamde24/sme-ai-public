# Handoff: resume here (written 2026-10-05, session limit)

HEAD is `e394cbe` on main (owner's merge of lane C) over my T007 M3 commits `a2a10d2` (review screen), `a2069f0` (golden set), `7c3124b` (docs).
Nothing is pushed. T007 M3 is complete; see `docs/handoff/t007-m2-status.md`.

## Part A: the cost-cap fix commit (owner review of commits 3, 3b, 4): BUILT, NOT COMMITTED, NOT make-checked
The work is on disk but NOT committed, because a green `make check` was not possible before the session ended.
- **Tracked changes** were saved as `docs/handoff/wip.patch` (1,049 lines) and then reverted (`git checkout -- .`). The patch is untracked; do not lose it.
- **Untracked new files, still on disk** (keep them): `supabase/migrations/20261014090500_t007_cost_cap_review_fixes.sql`,
  `supabase/tests/database/52_cost_cap_review_fixes.test.sql`, `apps/web/app/app/tenants/[tenantId]/agents/cost-panel.tsx`, `.../cost-panel.test.tsx`.
  With the tracked changes reverted the tree is INCONSISTENT (the new migration needs the patched tests): apply the patch first.

What the patch + files contain, per item:
1. DONE (tested): `agent_record_usage` counts the CHARGE (larger of reported and computed) in `agent_runs.cost_micros_used` and the usage step; pgTAP 52 section A
   (reported 0 for real tokens still trips SM203); updated pgTAP 37/49 and integration (`cost_micros_used == 450`). MUTATION NOT RUN yet.
2. NOT DONE: ADR 0013 overshoot section (bound per definition: max_concurrent_runs x max_cost_micros: research 3 x 0.15 = 0.45 production, selftest 3 x 0.25 = 0.75 development only; with the default cap 2.00 the ledger can read at most 2.45 / 2.75).
3. DONE in code and tests, ADR NOT written: ONE rule = an unsettled reservation stays OPEN at its worst case until its UTC day ends (cancelled / expired / killed / failed / crashed alike).
   Runtime releases (settles at zero) only provable non-billing: `rate_limited` (429), `rejected` (other 4xx), `not_configured`; `unavailable`, `timeout`, `bad_response` and a call that completed
   after its run went terminal stay open (`runtime.NOT_BILLED`). New: `agent_release_cost`, `agent_cost_summary` (Owner/Admin), `GET /agent-cost`, cost panel on the agents page.
4. DONE: `agent_write_evidence` refuses non-http(s) URLs (any case) and ports other than 80/443 with the 'value' error (pgTAP 52 D); UI test that a URL-looking source is text only.
5. DONE: host rule = the website host or its `www.` twin, no other subdomain, on both sides (`runtime.allowed_hosts_for`; same table in `tests/test_research_agent.py` and pgTAP 52 E).

Verified green before stopping: `make contracts`, ruff, mypy, vitest (802), pytest unit, pgTAP 52 alone, and integration (agent_runs_api, direct_postgrest, daily_cost_cap: 121 passed).
NOT run: a full `make check`, the mutation pass, the ADR edits.

## Part B: T008 Requirement Agent PLAN: NOT STARTED
`docs/plans/t008-requirement-agent.md` does not exist. Read the existing schema first (grep migrations for enquiry / rfq / quote / message), then write the plan only (no code); see the owner's brief in the last message.

## First commands on resume
```
cd /Users/gowthamreddys/Desktop/sme-ai && git status --short && git apply docs/handoff/wip.patch && git status --short
supabase db reset && make check          # must be green before committing
```
Then: (a) add the mutation table for A (record_usage counters back to reported cost; release allowed on settled; scheme check removed; port check removed; summary open to Sales; runtime releasing on 'timeout'),
(b) write the ADR 0013 sections (overshoot per definition; "Open reservations": the one rule, the NOT_BILLED list and why), (c) a runbook line for `agent_cost_summary`, (d) commit
"T007 M3b: cost cap review fixes" (do not commit `docs/handoff/wip.patch`; delete it after applying), (e) then write the T008 plan.
Trap: never run `ruff format` on a directory (it reformats `services/ai-api/app/leads/review.py` and `scoring.py`); format only the files you edit.
