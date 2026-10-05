# T007 M2 status (handoff, 2026-10-05; updated after commit 3)

Branch: `main` (nothing is on a wip branch: everything committed is green). Nothing pushed. Never read `.env`; no accounts, keys or model calls.

## Done (committed, `make check` green before each)
1. **Commit 1 `ff455bc` key naming.** `SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `HOSTED_SUPABASE_PUBLISHABLE_KEY` read first, legacy
   `*_ANON_KEY` still accepted; the local wrapper exports both; the integration suite runs on the publishable key; web guard forbids `sb_secret` /
   `secret_key`; `.env.example`, deploy files, runbooks updated; the new webfetch test `# ruff: noqa` headers replaced by line-level noqa.
2. **Commit 2 `b9efe59` claim home.** Migration `20261013090000_t007_claim_home.sql` (claims.source_lead_id + CHECK/FK, `agent_write_claim` stores a
   lead run's claim on the lead's company, `claims_effective` gains `home_company_id`/`about_lead_id`, `claims_for_scoring` exposes the home as
   `company_id`). Tests: pgTAP `48_claim_home`, `tests/integration/test_claim_home.py`; API `list_claims` uses the derived columns. Mutation: 17 of 17 killed.
   Checklist row (lead-claim home) closed; ADR 0013 note added.

3. **Commit 3: the per-tenant daily cost cap** (owner-amended plan: a worst-case reservation before EVERY model call under a per-tenant advisory
   lock, settled afterwards; UTC-day attribution = the day the call was authorised; Owner-only, aal2, 20.00 ceiling; cap hits audited; fail closed on
   missing / zero prices and unknown models; SM207). Migration `20261014090000_t007_daily_cost_cap.sql`, pgTAP `49_daily_cost_cap`,
   `tests/integration/test_daily_cost_cap.py` (a real two-session race), ADR 0013 note "daily cost cap" (states the maximum overshoot), runbook
   "Spending cap". Mutation pass: see the commit message / report.

4. **Commit 3b** (cost cap hardening: no unreserved usage, reported cost bounded, reservation bounded by the run), **the claim-home follow-ups**, and
   **commit 4: the Research Agent on fakes** (tools, verbatim quotes, lead-site-only fetch, bounded DNS lookups, API start for a lead, the "Research a lead"
   form, the end-to-end score test, W01-W11 and the lead-host evals). See ADR 0013 ("T007 note: the Research Agent") and the plan's commit-4 notes.

5. **T007 M3** (2026-10-05): **the claim review screen** (`/app/tenants/<id>/suggestions`: quote as plain text, source host and path, "Quote checked by the
   agent runtime, not by the database", conflicting suggestions side by side, a phone-safe grid, accept needs a confidence, reject needs no reason) and
   **the golden set** (20 synthetic businesses; `make eval` prints the report; the gate fails on any wrong accepted claim). See ADR 0013 ("T007 note: the
   review screen and the golden set").

## Not done
Anything live (M4). **Before the first live call the owner approves** (checklist row "BEFORE THE FIRST LIVE CALL"): the provider and model id, the
`agent_model_prices` row, the provider-side hard spend cap and key, the workspace's daily cap and the single allowed workspace, the real fetcher's wiring,
and the budget of the live subset. Also not done: search (T007b), the known limits (the database does not verify quotes; evidence is counted per lead).
The next ticket is T007b; start it only after the owner approves.

## Tests run / not run
Run (green): `make check` (full) at the end of commits 1, 2 and 3 (counts are in the commit 3 message). Mutation: commit 2 (17/17) and commit 3
(see its message). Not run: anything for commit 4; no web mutation run for the key rename (unit tests only).

## Local database
Fine as is, but it holds claims/runs written by `test_claim_home.py` and earlier integration runs; `supabase db reset` before the next full check is
sensible (pgTAP 48 now counts only tenant A's fixture rows, so it does not depend on it).

## Surprising
- `ruff format` on whole dirs (`app`, `scripts`) reformatted unrelated files twice; format only files you edit.
- A trusted-role claim insert needs `confidence` and, for non-agent rows, an author (`request.jwt.claims` sub); pgTAP 48 shows how.
- A client cannot insert claims at all (42501), so `source_lead_id` cannot be forged by one; the CHECK covers the trusted role.
- The invisible-character escapes written through the shell heredoc are converted to raw characters; use `chr()` or a script that writes `\u` escapes.
