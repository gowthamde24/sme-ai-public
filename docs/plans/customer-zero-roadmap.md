# Roadmap: from today's `main` to the start of T012 (Customer Zero)

Status: **PLAN ONLY. Not approved. No code, migration, test or dependency was written or changed.** Written 2026-10-08 on the branch `plan-customer-zero`, from `origin/main` at `81060dd` (PR #8). The pushed branch `origin/followups-due-candidates` (`5e9ed29`, not yet merged) was read with `git show` where a fact depended on it. Every "state" below was checked in the repository on that date; what could not be checked is listed in section 0 and again at the end.

Related plans written in the same pass: `docs/plans/members-and-invitations-plan.md` (ADR 0023), `docs/plans/owner-agent-plan.md` (T011a / T011b, ADR 0024). Existing plans this one points at, not repeats: `docs/plans/plan-v2-local-first.md` (the owner's decided sequence and rules), `docs/plans/roadmap.md` (the local-first table of 2026-10-05), `docs/plans/workspace-files-and-chat-capture-plan.md` (on the due-list branch), `docs/plans/t011-owner-agent.md`, `docs/plans/members-and-invitations.md`, `docs/plans/quote-text.md`, `docs/pre-pilot-checklist.md`, `docs/runbooks/real-data-gate.md`, ADRs 0015, 0017.

## 0. Assumptions and what could not be verified

* **A1. Plan v2 is now in the repository** as `docs/plans/plan-v2-local-first.md` (added 2026-10-08, the owner's decided text; the original lives in the Claude Project). This roadmap was first written without it (the project document was not in the repository), rebuilding the T012 prerequisites from ADR 0017 (a), `docs/plans/roadmap.md` row 8, the checklist, the runbooks and ADR 0015. **Section 3 was then compared with plan v2's "Open at the Customer Zero stage" list and its sequence; section 3b records the comparison and what changed.** Where the two ever differ, plan v2 wins.
* **A2. Customer Zero** is the family silk-saree wholesale business, in a **new workspace created after the hosted deploy**, with the real-data gate opened for that one workspace (`docs/runbooks/real-data-gate.md`). The synthetic demo workspace is never opened.
* **A3. "The start of T012"** means: everything that can be built or decided before the deploy is done, so T012 is a short, mostly owner-run stage (accounts, deploy, verifier, restore drill, legal file, gate). T012 itself is not planned here.
* **A4. Sizes:** **S** = about 1 to 3 days of the agent's work; **M** = about a week; **L** = more than a week. They are estimates for planning, not promises, and exclude the owner's review time.
* **A5. "Unattended"** = an agent can build it overnight with repository access only (fakes, local stack, synthetic data), stopping at the owner-review stops the ticket's own plan names. "No" means it needs an account, money, a legal act, a physical device or a decision only the owner can make.
* **A6. Rules unchanged:** local-first (ADR 0017): synthetic data only, no deployment, no paid dependency, no account without the owner's written approval; the real-data gate stays closed; every ticket follows the rhythm of `docs/plans/followups-due-candidates-plan.md` section 12 (per commit `make check-fast` plus the touched tests; the full `make check` in every commit with a migration, a role / permission / consent / suppression / erasure change, or a spike of a risky assumption; once more from a clean `db-reset` at the end; mutation passes at the end, one runner at a time).

**Could not verify** (also repeated in the final report): whether the owner ever did the by-hand order click count (`docs/rehearsal-click-checklist.md`) or accepted T006 M3 and T007 (CLAUDE.md still says "awaits the owner's review" and "do not start T007 before the owner approves", although T007 M1 to M3b are committed on `main`); anything about the hosted stage (nothing is deployed, no account exists); the GitHub plan and branch-protection state (taken from the owner's statement, HTTP 403 on the protection API); the CI result of the due-list PR (not merged); whether lane C's `quote-text-joiners` branch was reviewed (it is local only); what the family's real values are (policy, wording, credit limit, GST and freight).

## 1. Where `main` is today (verified)

| Fact | Evidence |
| --- | --- |
| Merged to `main`: T001 to T006b, T007 M1 to M3b (the Research Agent on fakes), T008, T009, T010 part 1 and 2 (PR #5), order conversion with its rehearsal (database, API, web page, price-list CSV import), the WhatsApp channel in the follow-up screens (PR #7), design v2 port stages 0 to 2 (PRs #6, #8), lane C's quote text 1.0.0 (PR #4) | `git log origin/main`; `git merge-base --is-ancestor` for each branch |
| **Pushed, not merged:** `followups-due-candidates` (C0 to C6, plus the two plan documents: files and chat, due candidates). It adds one read-only database function and the paged due list | `origin/followups-due-candidates` = `5e9ed29`; not an ancestor of `origin/main` |
| **Local only, never pushed:** `quote-text-joiners` (lane C's `quote_text` 1.1.0, three commits, worktree `~/Desktop/sme-ai-quote-text` clean); `web/port-flip` (three landing-page commits, worktree `~/Desktop/sme-ai-port` has uncommitted audit-script edits) | `git log origin/main..<branch>`; `git worktree list`; `git status` of each worktree |
| Reference only: `web/landing` (never to be merged, per the port plan) | `docs/plans/port-design-v2.md` |
| Last full local check (due-list branch): vitest 1,598; pytest 3,955; pgTAP 9,929 (66 files); integration 997; evals 45 + 9 + 29 + 9; headless follow-up driver 166 checks | the PR description and `docs/adr/0022` addendum 2 |
| Nothing is deployed; no hosted account exists; the real-data gate is closed everywhere; no live model call has ever been made | `CLAUDE.md`; `docs/pre-pilot-checklist.md` |
| `CLAUDE.md` and the checklist have **stale lines**. `CLAUDE.md` still says T010 part 2 and the WhatsApp ticket are "committed locally, nothing pushed" (both are merged) and has no status line for T007. At least **three open checklist rows describe things that are now built**: "API and web for orders are not built" (the order routes and page exist), "Persisted question drafts ... belong to the T010 integration" (`question_drafts` exists), and "Migration discipline ... the four T002 migrations are still local-only" (they are on `main`). Others may be stale too; I checked only these | `grep` of both files against the code on `main` |
| The checklist has 178 rows, 149 open: **54 gate "Before real data"**, 16 "Before deploy", 37 "Later", 16 "Next ticket", 5 "Customer Zero" | parsed from `docs/pre-pilot-checklist.md` |

## 2. The remaining items

Legend: **State** is what the repository shows. **Approvals** lists what only the owner can give (an account, money, a legal act, a live call, a dependency). **Unattended** per A5.

| ID | Item | State (verified) | What it is | Size | Depends on | Owner approvals needed | Unattended |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R0** | Merge the due-list PR | branch pushed, PR not merged | the paged due list; one new function | none | CI green | the owner merges | no (owner action) |
| **H1** | Status hygiene | **not started**; stale lines in `CLAUDE.md` and at least three stale checklist rows (section 1) | refresh the ticket-status lines (T006 M3, T007, T010 part 2, WhatsApp, due candidates) and re-label the stale open rows, with the evidence for each; docs only | S | R0 | none | yes |
| **Q1** | `quote_text` 1.1.0 adoption | lane C built it (3 commits, `quote-text-joiners`, **local only, not merged**); lane A's pin is still `{"1.0.0"}` in `app/quotes/text_port.py` | the renderer refuses ZWJ / ZWNJ in a product name, so a Telugu / Kannada / Malayalam product name makes the customer text `quote_text_refused`. 1.1.0 allows them after an Indic letter. Lane C's own notes list **8 steps for lane A** (the version pin, the golden hash, a differential test against `capture_text`, a real-stack test, fixtures, the rehearsal wording, docs); no migration | S | the owner pushes / merges lane C's branch | none | yes, once the branch is merged |
| **O1** | Order conversion | **done** for the local-first stage: ADR 0021, migrations, API, the order web page, the price-list CSV import, the rehearsal (rehearsal steps 0 to 3 accepted 2026-10-06; steps 4 and 5 and step F fixes built and merged) | quote to order, ledger, lifecycle, follow-up stop | done | | none | done |
| **O2** | Order policy page and a human-driven check | **not started**: a policy is published through the API only; the order and price pages "have only been driven by tests, never by a person in a browser" (checklist) | a plain Owner page to publish an order policy version (with the second factor), then a by-hand run of the order and price pages | S (page) + owner time | | the real policy values (owner inputs) | the page: yes; the by-hand run: no |
| **B1** | Owner brief (T011a) | **plan only**, replaced on 2026-10-06 by a deterministic design: nine read-only functions, one endpoint, one page, **no model**; ADR 0024 not written | the owner's daily attention list and numbers from recorded facts | M | the tables it reads now all exist (quotes, requirements, follow-ups, orders, suppression) | thresholds (defaults already accepted) | yes (one review stop at the milestone) |
| **B2** | Owner Agent (T011b) | **deferred** in the plan until after the live batch | a model that explains and ranks the nine sections, read-only, with its own budgets and containment evals | M | B1; the live batch | the model provider, key, price row, hard cap (ADR 0017 b) | build with the fake model: yes; the live part: no |
| **M1** | Members and invitations (ADR 0023) | **plan only**, decisions recorded 2026-10-06; nothing built. Today a person joins by an operator SQL function or an Owner's raw table write | invitation by one-time code, role change, removal, last-Owner protection; the Owner role only through the operator | L | B1 (queue order of 2026-10-06) | none to build; real e-mail only at T012 | yes, with two owner-review stops |
| **K1** | Suppression-key recording screen | **open** (hand-off OPEN item 2): the endpoints exist (`POST /suppression/backfill`, `GET /suppression/status`), no screen calls them | a plain Owner screen with the second factor; **a hard gate before the first outreach** | S to M | | none | yes |
| **C-W0** | Files and chat: the storage spike and ADR | **plan only** (on the due-list branch); local Supabase Storage is **disabled** in `supabase/config.toml` | prove a private bucket, tenant-prefix policies and signed URLs on the real local stack | S | R0 (so the plan is on `main`) | none | yes |
| **C-W1 to W6** | Files and chat: files, chat core, proposals, the Capture Agent (fake model), reading text from files | **plan only** | see that plan, section 13: W1 files M, W3 chat M, W4 proposals L, W5 Capture Agent M, W6 reading files M to L | M + M + L + M + M..L | C-W0; ADR 0013 option A | ClamAV as a dependency (W2); a PDF library; the vision reader (paid, **not planned before Customer Zero**) | yes (W2 and the vision reader need approval first) |
| **C-W9** | CSV / Excel import add-on | **partly built**: lead import (T005) and the price-list CSV import (pinned parser) exist; XLSX does not | XLSX parsing and a batch import as proposals a person approves | M | C-W4 | an XLSX parser dependency | yes after the approval |
| **L1** | The live batch | **never run**: the Anthropic adapter has never made a live call; `make eval-live` refuses without its gates | one supervised batch (about 5 leads for the Research Agent, the 20-enquiry golden set for the Requirement Agent, a tiny budget) to measure real quality | S | B1 or C-W5 for the agents that matter first | **provider, key, model id, prices in `agent_model_prices`, a provider-side hard spend cap, and the DPDP cross-border review** (ADR 0017 b; checklist) | no |
| **S1** | Lead discovery by search (T007b) | **interface and fake only** (`SearchProvider`, `FixtureSearchProvider`); no adapter | candidates from a permitted search source into the import path | M | a search provider | the provider (the plan priced Brave at $5 per 1,000 requests with a free monthly credit) | build with the fake: yes; the live adapter: no. **Not needed for Customer Zero**: the family has its own customers. **Plan v2's sequence puts T007b before T008**; T008 to T010 and order conversion were built without it, so keeping it optional is a departure the owner confirms (section 3b) |
| **P1** | Option B: a dedicated agent principal (ADR 0013) | **not started**; required "before the first scheduled agent and before any external customer" | a service principal that alone holds EXECUTE on key-recording and question-persisting functions | L | | none to build; a deployment decision | yes |
| **W-web** | Design v2 port, the rest | stages 0 to 2 merged; `web/port-flip` holds the landing flip (unpushed); stage 3 (login) planned | the public landing page and login in the new design | M | | none | yes; **not a Customer Zero prerequisite** (the family uses the plain screens) |
| **G1** | Branch protection | **absent**: free private plan, HTTP 403 | CI checks are advisory; the owner is the only gate | none (a decision) | | GitHub Pro (a fee) | no |
| **T12** | The T012 stage itself | **not started, nothing deployed** | section 3 | L (mostly the owner's) | everything above that the owner chooses to put first | accounts, money, a legal review | mostly no |

**Checks I ran to state O1 and T007 honestly:** order conversion's code, tests and rehearsal are on `main` (`git log origin/main` shows ADR 0021 and the API / web commits); the Research Agent's code (`app/agents/research.py`, `app/webfetch/`) and its golden-set commits are on `main`; neither appears in the `CLAUDE.md` status list, which is why H1 exists.

## 3. What T012 needs (compared with plan v2 on 2026-10-08; see 3b)

The Customer Zero stage "bundles the former M3b" (checklist, ADR 0017 a). Each line: who does it, whether it costs money or needs an approval, and what in the repository already supports it.

| # | Prerequisite | Source | Who | Money / approval | What exists |
| --- | --- | --- | --- | --- | --- |
| 1 | Hosting accounts: Supabase Pro (Mumbai) and Cloud Run `asia-south1`; **re-check prices when T012 starts** | ADR 0015; checklist rows "Hosting is chosen..." | owner | **paid**; the owner creates the accounts and runs `deploy/cloudrun.sh --execute` | `deploy/`, `docs/runbooks/hosting-deploy.md` |
| 2 | `deploy/Dockerfile.api` copies the pure packages (`quote-engine`, later `packages/pure`) and sets `PYTHONPATH`, otherwise quotes fail closed with 503 | checklist row "T012 (deploy)" | agent, before T012 | none | the row names the two lines; **untested until a build** |
| 3 | Production configuration: `API_ENV`, JWKS / issuer / audience, https-only URLs, `Secure` cookies | checklist rows "Production auth config", "Production cookie and URL config" | owner + agent | none | fail-closed startup is tested; `scripts/verify_hosted.py` |
| 4 | Hosted Auth settings: e-mail confirmation on, password minimum raised, redirect allow-list, templates | `docs/runbooks/hosted-auth-settings.md` | owner | none | runbook; the verifier reads the public settings |
| 5 | SMTP and a domain (for sign-in e-mails and, later, invitations) | ADR 0017; roadmap row 8 | owner | **paid; needs the owner's written approval** | none (the local stack uses Mailpit) |
| 6 | Proxy / CDN logs drop query strings; access-log redaction verified | checklist rows | owner | none | the API redacts its own log |
| 7 | The hosted verifier ends `ALL CHECKS PASSED` (`scripts/verify_hosted.py`, `supabase/hosted/verify.sql`, including that function owners are `postgres`) | runbook; checklist | owner runs | none | built |
| 8 | **Restore drill** on a throwaway project, then `verify.sql`, then re-apply the erasures newer than the backup | `docs/runbooks/backup-restore-drill.md`; the gate's 4th prerequisite | owner | a throwaway project (may cost) | runbook; **if files / chat are built, the drill must also re-delete stored objects** |
| 9 | **DPDP legal review**, filed (plan v2: **start it weeks before**). Scope found in the checklist: the consent model; cross-border processing and model providers; the HMAC suppression ledger and keeping a keyed hash after erasure; retention of touches, drafts and enquiry text; orders after erasure; the contact scrubber's limits; (if built) files and chat | checklist rows "Before the gate opens", "Before T012" | owner commissions a lawyer | **paid** | none; the gate takes its reference |
| 10 | `SUPPRESSION_HMAC_KEY` custody and rotation (one per environment, API config only, old keys kept) | checklist row | owner | a secret store (may be free tier) | the API refuses to start without it outside development |
| 11 | MFA enrolment of the real Owner and Admins; the lost-device path | ADR 0016; `docs/runbooks/mfa-recovery.md` | family | none | built |
| 12 | **Open the real-data gate for one new workspace** with four recorded references: `erasure_ref` (`adr:0014`, done), `hosting_ref`, `dpdp_review_ref`, `restore_drill_ref` | `docs/runbooks/real-data-gate.md` | operator (the owner) | none | built |
| 13 | The family joins the new workspace at limited roles (today: operator SQL; after M1: invitation codes) | `docs/runbooks/add-family-member.md`; M1 | owner | none | M1 would replace the SQL path |
| 14 | The family's real **values and wording**: cadence policy (gaps, touch limit, quiet hours, weekdays, holidays, offset), order policy, quote policy (GST rates and freight rules, which are the owner's and the accountant's), the repeat-customer credit limit, the time rules, the e-mail and WhatsApp wording and how a person sends it | checklist rows (several) | owner / family / accountant | maybe a lawyer for wording | everything has a synthetic placeholder |
| 15 | Keys backfilled and the **suppression-key screen** (K1) before the first outreach | hand-off; checklist hard gate | agent (screen) + owner (runs it) | none | endpoints built |
| 16 | The family is told what may and may not go into the system; the budget alert exists | runbook | owner | none | |
| 17 | The **four-week measurement against a baseline** | ADR 0017; `CLAUDE.md` | owner | none | no baseline is written down anywhere in the repository |
| 18 | If agents run at Customer Zero: the live-batch approvals (L1), the input-token bound verified against the real provider, the live-batch cost reconciliation | checklist rows | owner | **the provider's charges** | the daily cost cap and the reservation are built |
| 19 | A decision on branch protection (G1) | new checklist row | owner | **GitHub Pro fee** | |
| 20 | **Key-model migration** (plan v2 lists it as open): use the project's **publishable** key wherever the anon key is used; confirm on the hosted project whether the legacy anon and service-role keys can be disabled, and disable them if so; asymmetric JWT signing (ES256) with `SUPABASE_JWKS_URL`, issuer, audience and `SUPABASE_JWT_ALGORITHMS=ES256`, `SUPABASE_JWT_SECRET` unset; only public values in Cloud Run (URL, publishable key); `verify_hosted.py` on the publishable key | `docs/plans/key-model-audit.md` ("What changes at the deployment stage"); plan v2 rules | owner + agent | none | the renaming is **done** (T007 M2 commit 1: both names read, the new one first; the checklist row "Key naming applied"); the hosted-project steps are untested because there is no hosted project |
| 21 | **Workspace-creation policy for external customers** (plan v2 lists it as open). Today any signed-in person can create a workspace (the Workspaces page, `create_tenant`) and hosted sign-up is closed; the family's Owner creates the Customer Zero workspace that way (`docs/runbooks/real-data-gate.md`). Decide who may create workspaces once external customers exist, and the open row "slug claim leak" (`create_tenant` answers 409 for a slug owned by someone else) | plan v2; checklist row "Slug claim leak" | owner | none | not needed for the family's own start; needed before the external pilot |
| 22 | **Production secrets** (plan v2 names them in the T012 list). Where a backend ever needs privileged access, the secret lives in Google Secret Manager (or equivalent) and the use is recorded in an ADR with a narrow path; the default stays the delegated user JWT plus RLS. Today **no code uses a privileged key**; the only secrets are `SUPPRESSION_HMAC_KEY` (#10) and, at the live batch, the model provider's key | plan v2 rules; ADR 0017 c | owner | a secret store (may be free tier) | no variable for a secret key exists |
| 23 | **Family accounts** (plan v2 names them): the Supabase accounts for the family's people, created by the operator while sign-up is closed (temporary password, then the forced change; see the members plan section 6), then the workspace invitations of #13 | plan v2; `docs/runbooks/add-family-member.md` | owner / operator | none | the operator functions and runbook exist; the hosted create-user path is **not verified** locally |
| 24 | **Suppression HMAC before the first outreach** (plan v2): the key exists and is fail-closed (ADR 0020), contacts are keyed when made through the API, and existing contacts must be backfilled before the first draft (#15); the key's custody is #10 | plan v2; ADR 0020; checklist rows | owner + agent | none | built; K1 is the screen |

**Not needed for the start of Customer Zero** (so not on the critical path): option B (P1) unless a scheduled or background agent or an external customer is introduced; the search adapter (S1); the vision reader; the design v2 landing; the Owner Agent's live model (B2).

### 3b. Comparison with plan v2 (2026-10-08)

Plan v2 ("local-first", decided 2026-10-05, `docs/plans/plan-v2-local-first.md`) has a sequence of nine steps and an "Open at the Customer Zero stage" list of nine items.

| Plan v2 | In this roadmap | Verdict |
| --- | --- | --- |
| Open: restore drill | #8 | covered |
| Open: hosted verify run | #7 | covered |
| Open: hosted Auth settings | #4 | covered |
| Open: SMTP | #5 (also a domain) | covered |
| Open: MFA enrolment of real users | #11 | covered |
| Open: DPDP review (start it weeks before) | #9 | covered; the "weeks before" lead time is now stated in the row and in the order of section 4 |
| Open: **key-model migration** | none | **MISSING: added as #20** (the renaming is already done; the hosted-project steps are what remain) |
| Open: **workspace-creation policy for external customers** | none | **MISSING: added as #21** (not needed for the family's own start) |
| Open: suppression HMAC before first outreach | #10 (custody) and #15 (backfill, key screen) | covered but split; **added #24** to say it as plan v2 does |
| Sequence 1: T006 / T006b done, "only housekeeping left: push + CI green" | section 1 | **done**: on `main`; nothing left but the stale status lines (H1) |
| Sequence 2: T007 M1 to M3 and M4 live smoke only with approval | section 1, L1 | M1 to M3b are built on fakes; **M4 (live smoke) is L1** and needs the approvals |
| Sequence 3: **T007b lead discovery** before T008 | S1 | **a departure**: T008 to T010 and order conversion were built without it. The roadmap keeps S1 optional and after the start. *The owner confirms* (a question this comparison raised; it is listed in the report and is not one of the eight decisions below) |
| Sequence 4 to 7: T008, T009, T010 (needs HMAC first), order conversion | section 1 | **done** (T010's HMAC gate was built first, ADR 0020) |
| Sequence 8: T011 Owner Agent / brief | B1, B2 | planned (`docs/plans/owner-agent-plan.md`); T011a is a deterministic brief and T011b the agent |
| Sequence 9: T012: hosting, domain, SMTP, family accounts, production secrets, restore drill, hosted verifier, DPDP review, gate with four prerequisites, real data | #1 to #24 | all present; **family accounts (#23) and production secrets (#22) were implied and are now explicit rows** |
| Rules: paid dependency needs the owner's approval with exact provider, why, estimated dev cost, free tier | section 2 "Approvals" column; section 0 A6 | consistent |
| Rules: privileged keys never in browser, Git, committed `.env`; Secret Manager plus an ADR if ever needed; delegated JWT plus RLS by default; prefer publishable / secret naming | #20, #22 | consistent; now explicit |

Not in plan v2 but in this roadmap (so not a plan v2 prerequisite): the capture track (files and chat), members and invitations, the suppression-key screen, the order policy page, `quote_text` adoption, the branch-protection decision. They are the owner's later additions (capture-first, ADR 0023) and the repository's own gates; they stay.

## 4. Recommended order, and why

```
NOW (owner and agent in parallel)
  owner:  merge R0 · push lane C's branch (Q1) · commission the DPDP review (#9, weeks of lead time) · decide G1 · start writing the family's values and baseline (#14, #17)
  agent:  H1 hygiene  ->  Q1 adoption (when merged)
PHASE 1  capture foundation:  C-W0 spike -> C-W1 files -> C-W3 chat -> C-W4 proposals -> C-W5 Capture Agent (fake model)      ~ 4 to 6 weeks
PHASE 2  B1 owner brief (T011a)  +  K1 suppression-key screen                                                              ~ 1.5 to 2 weeks
PHASE 3  M1 members and invitations (ADR 0023)                                                                              ~ 2 weeks (with two review stops)
PHASE 4  T012 readiness: Dockerfile fix (#2) · O2 order policy page · C-W2 scanner · C-W6 text from files · L1 prepared         ~ 1.5 to 2 weeks
PHASE 5  owner tracks complete (legal filed, accounts, SMTP, verifier, restore drill) -> T012 starts
AFTER    L1 live batch · B2 · S1 · P1 · W-web, as the owner decides
```

Reasons:

1. **The owner's long-lead items start now, in parallel**, because they are what actually delays T012, and the agent cannot do them: the legal review, the accounts, the family's real values and the baseline. Code can be ready weeks before they are.
2. **Capture first (phase 1).** The owner's premise is that the shop has no data in sheets and data arrives by chat; without capture the family can only type or import CSV. Phase 1 is ordered so each ticket leaves something usable: the spike (W0) first because local Storage is **disabled today** and the whole plan rests on it.
3. **The brief and the key screen next (phase 2).** T011a needs no new tables (everything it reads exists) and needs no model; the key screen is a **hard gate before the first outreach** and a small web slice on endpoints that already exist. Both are unattended.
4. **Members after (phase 3).** This keeps the owner's 2026-10-06 queue ("after T011a, before T012"). It is the largest single code ticket on the path, and Customer Zero needs it only when a *second person* has to join.
5. **Readiness last (phase 4)** because it is small, mostly independent, and its largest part (hosting hardening rows) cannot be tested before hosting exists.
6. **The live batch stays after the start** unless the owner wants agents working on day one: it needs a paid account, a legal review of what is sent abroad, and a real-quality measurement the code cannot give. A synthetic-only Customer Zero start is possible and cheaper.

Critical path: legal review and accounts (owner), not code. If the owner commissions the review now, phase 1 to 4 (about 9 to 13 weeks of serial agent work, plus review time) is the long pole; a faster route is to drop phase 1 to W0 + W1 + W3 and ship capture after the start (decision 2 below).

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| The path is long (about 9 to 13 weeks of serial agent work) and Customer Zero never starts | decision 2 (a smaller phase 1); the owner tracks run in parallel from day one; each phase leaves a usable system |
| The legal review comes back with changes (retention, hashes, files, what may go to a model) | commission it now with the scope of section 3 #9; keep the retention and erasure design as hooks, not jobs |
| Stale `CLAUDE.md` and checklist rows hide a real open gate | H1 first, with evidence for each row, before anyone relies on the checklist as a gate |
| `quote_text` 1.1.0 stays unmerged and a Telugu product name blocks the first real quote | Q1 is S; ask the owner to push lane C's branch now |
| Local Storage is off and hosted Storage behaves differently | the W0 spike on the real local stack; re-verify on the throwaway project at T012 |
| The first real files and chat are real personal data entering a system whose gate covers contacts only | the files plan extends the gate to files and chat (its section 6); the legal review lists them |
| CI is advisory (no branch protection) and a red check could be merged | G1 decision; until then the owner reads CI before every merge |
| Deploy-time surprises (Dockerfile, JWKS mode, SMTP templates) found only at T012 | item #2 and the hosting rows are listed; budget a throwaway-project rehearsal of the deploy before the real one |
| A second person joins by the operator SQL path with no consent step | M1 before T012; until then the runbook path is used by the operator only |

## 6. Not in scope

Planning T012's execution; choosing the model provider; writing the DPDP review; the vision reader and any paid service before the owner approves it; lead discovery by search; option B; the design v2 port beyond what is merged; WhatsApp or e-mail sending of any kind (nothing here sends); real customer data; changing any existing ADR or the cadence engine.

## 7. Decisions I need from the owner (maximum eight, each with my recommendation)

1. **Order of the code tickets:** hygiene and `quote_text`, then capture (phase 1), then the brief and the key screen, then members, then readiness. *Recommendation: yes; it follows your "capture first" and keeps your members queue.*
2. **How much of capture must exist at the start of Customer Zero.** Either phase 1 in full (W0, W1, W3, W4, W5) or the smaller W0 + W1 + W3 (files and a chat that records text, no proposals) with proposals after the start. *Recommendation: the full phase 1 if the owner wants data to come in by chat on day one; otherwise the smaller cut, and start earlier.*
3. **Commission the DPDP review now**, with the scope of section 3 #9 (including files and chat). *Recommendation: yes, this week; it is the longest wait.*
4. **Live model before or after the start.** *Recommendation: after: start Customer Zero on synthetic-agent behaviour plus the deterministic features, then run the live batch with the approvals listed in section 2 (L1).*
5. **Push lane C's `quote-text-joiners` branch** so Q1 can be adopted. *Recommendation: yes.*
6. **GitHub Pro (branch protection)** before Customer Zero or the first collaborator. *Recommendation: yes before any collaborator; until then the owner is the gate (the new checklist row records it).*
7. **A docs-only refresh of the stale `CLAUDE.md` lines and checklist rows (H1).** *Recommendation: yes, first, so the checklist can be trusted as the gate.*
8. **The baseline for the four-week measurement:** who writes down how the family works today (time to quote, follow-ups sent a week, enquiries answered the same day) and when. *Recommendation: a one-page sheet filled by the family before day one; the agent can draft the template.*

**Not decided (left open on purpose):** the exact weeks (they depend on the owner's review latency); whether the family wants the order and price pages driven by a person before T012 (the owner declined click tests for the follow-up tickets); whether e-mail delivery of invitations is wanted (M1 decision 7); which hosting plan size; the retention periods (legal).
