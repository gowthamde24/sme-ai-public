# T011 Owner Agent plan: a read-only daily brief and attention list from real backend state (PLAN ONLY, nothing built)

Status: written 2026-10-06 after T009 for the owner's review. Related: ADR 0013 (agent write path; option A delegated runs, option B dedicated principal, the revisit triggers), ADR 0016 (second factor), ADR 0017 (local-first; any live model needs the owner's prior written approval),
ADR 0018 / 0019 (requirements, quotes), `docs/plans/t010-integration.md`, `docs/plans/order-conversion.md`, `docs/plans/roadmap.md` row 7, `docs/pre-pilot-checklist.md`.
Reads before building: CLAUDE.md, AGENTS.md, docs/lanes.md, this plan, ADR 0013 (all of "Design of A", "Compatibility with option B", the T007 and T008 notes).

## 1. Scope and non-goals

**What it is:** the owner opens the workspace and presses "Prepare today's brief". A run reads the workspace's REAL state through a closed set of read-only tools and writes ONE structured brief: metrics (counts and sums, computed by the database) and an **attention list** (things a person should look at: drafts waiting for approval,
quotes about to expire, requirements not confirmed, follow-ups due, orders with a balance, suppressed contacts blocking a draft). Every item names the records it is about by id and carries a closed reason code; the screen shows the wording from closed templates.
It is "Suggested" until the owner reads it; it proposes, it never acts. **The first commit is fully deterministic (no model).** An optional model step may later rank or explain items from the structured list (decision 2).

**Non-goals (explicit):** any write to business data (no approval, no status change, no price, no message, no deletion: the agent has no tool that can), sending anything, a scheduler or a "daily at 8 am" job (decision 3: that is where option B becomes mandatory), contact fields or customer text in anything a model sees
(ADR 0013 decision 11), forecasts or revenue projections (product.md: "no vanity metrics"), cross-tenant or platform-wide briefs, natural-language questions over the data ("ask your business anything": a generic query tool is forbidden: CLAUDE.md "no generic SQL shell"), charts beyond plain numbers, e-mail digests.

**What does not change:** CLAUDE.md 3 (no agent sends, prices, commits or deletes), the Command Center shows REAL backend state only, every brief item preserves provenance and uncertainty (CLAUDE.md 5).

## 2. Design

### 2.1 The run
A new agent definition `owner` (registry, migration-only like the others): its own switch (OFF, allowed for no tenant until the operator names one), a run **targets the tenant** (a new `target_kind = 'tenant'` and `p_target_id = tenant id`, so `start_agent_run` and its copy test are replaced), no claim predicates, no evidence kinds, no writes except ONE: `agent_write_owner_brief`.
It uses the existing budgets: runs per hour, concurrent runs, TTL, the daily cost cap (zero in the deterministic version, reserved if a model step is added), and a new per-run limit of tool calls (10) and items (30).

### 2.2 The tools: closed, read-only, bounded, no free text
Each tool is a `SECURITY DEFINER` **read** function (`STABLE`, no writes, `search_path=''`, `authenticated` only, role checked first), `public.agent_read_<name>(p_run_id, ...)`, deriving the tenant from the RUN row (never from an argument) and returning at most N rows of ids, closed codes, integers (paise, counts, dates). **No customer-written text, no names, no e-mails, no phone numbers.**
The set (each one question the owner actually asks; adding one is a migration plus a pgTAP case plus an eval):

| Tool | Returns (all closed values and ids) |
| --- | --- |
| `drafts_awaiting_approval` | quote drafts with `needs_owner_approval`, follow-up drafts (T010), ages |
| `quotes_expiring` | approved/draft quotes whose `valid_until` is within N days, the days left |
| `requirements_waiting` | enquiries whose requirement is draft or unconfirmed, days waiting |
| `followups_due` | leads with a `draft_followup` decision due (from T010 drafts, not recomputed) |
| `orders_with_balance` | orders with balance due, the amount, the state, days since the last event |
| `blocked_by_suppression` | count only (never which contact) |
| `pipeline_counts` | counts by lead status and by quote outcome, last 7 and 30 days |
| `money_summary` | quoted, approved, paid and refunded paise for the period, from the ledger |

The model (if used) can call only these; the sandbox has no other tool, no network and no SQL (the existing code-boundary test, extended). Output of a tool is bounded and its size is part of the cost budget.

### 2.3 The brief
`owner_briefs` (tenant-owned, append-only): `id`, `tenant_id`, `agent_run_id` (unique: one brief per run), `as_of` (India date), `status` (`suggested`|`seen`|`dismissed`), `content` (jsonb, validated by `app.owner_brief_ok`: a closed schema, at most 30 items, every item `{kind, record_kind, record_id, reason_code, severity, numbers{...}}`, every number an integer, no free text, ids must exist in the tenant),
`content_sha256`, `engine_version`, `created_by` (the starting human) with `created_via='agent'`, `tool_calls` (an integer). `owner_brief_items_seen` (append-only) records which items a person marked done.
**Numbers are never the model's:** a metric in `content` is the tool's value copied by the runtime; the database re-computes each metric inside `agent_write_owner_brief` from the same sources and refuses a different one (**SM240**), exactly as `create_quote_draft` refuses a different figure. So even a steered model cannot put a wrong number on the owner's screen.
Wording is rendered from templates at read time (the screen), never stored.

### 2.4 Functions and SQLSTATEs (proposed range SM240-SM249; confirm free codes at build time)
* `public.agent_read_*` (above): **SM241** the run is not running or is not an owner run; generic 42501 for any other refusal.
* `public.agent_write_owner_brief(p_run_id, p_brief jsonb)`: the run's starter only, the run is an owner run and running, the brief is valid (**SM242** a shape or a closed-list violation, **SM240** a metric the database does not reproduce, **SM243** an item whose record is not in this tenant or not in the state it claims), written once (**SM244** the run already wrote a brief), and the write budget.
* `public.mark_brief_item(p_brief_id, p_item_key, p_decision)` and `public.dismiss_owner_brief(p_brief_id)` (people only; they change the person's own view, never business data).

### 2.5 API and web
`POST /agent-runs` (existing, `agent: owner`, `target_kind: tenant`), `GET /owner-briefs/latest`, `GET /owner-briefs/{id}`, `POST /owner-briefs/{id}/items/{key}/seen`, `POST /owner-briefs/{id}/dismiss`. The web page `/app/tenants/{id}/brief` shows the date, the metrics as plain numbers, the attention list in severity order with a link to each record (links are server-built from ids, never from text), the label "Suggested" until seen, and the run's tool calls and cost for transparency. Not a dashboard of decoration: an empty list says "nothing needs your attention" only when the tools returned nothing.

## 3. Lock order
The agent reads take **no row locks** (consistent snapshot: one `repeatable read, read only` statement block per tool call; the brief is therefore a view of one moment per tool, and `content` records the `as_of` and each tool's database transaction timestamp so two items cannot silently disagree about one record). `agent_write_owner_brief` locks the **run row** (as every agent write does) and reads the sources without locks;
the invariant that matters: it NEVER takes an enquiry, requirement, quote or order lock, so it cannot join a cycle with them (the global order stays enquiry, requirement, quote, order; ADR 0018 decision 9 and the T010 / order plans). A pgTAP lock-introspection test proves the brief functions hold no lock on those tables.

## 4. Who may do what (role and assurance level)

| Action | Owner | Admin | Sales | Viewer | aal2 |
| --- | --- | --- | --- | --- | --- |
| Start an owner run | yes | yes | no | no | no (read-only; same as other agent runs today) |
| Read a brief | yes | yes | no | no | no |
| Mark an item seen, dismiss a brief | yes | yes | no | no | no |
| Switch the agent on for the workspace | yes | yes | no | no | per ADR 0016 (the existing agent-settings rule) |
| Edit the brief's tool set or limits | operator only, by migration | | | | |

Sales and Viewer are refused because the brief carries totals and balances (Viewer sees no totals; Sales is kept out because the brief is the owner's view across drafts and balances; decision 6).

## 5. Option A and where option B is MANDATORY
* **On-demand briefs started by a signed-in Owner/Admin run under option A** (the starter's own JWT; every read and the one write go through definer functions bound to the run; ADR 0013 "Design of A"). This is the same trust model as T006-T008 and the plan adds no new credential.
* **Option B is mandatory before:** (i) any scheduled or background brief ("every morning at 8", "when a quote is about to expire": there is no human token); (ii) any external customer (a second organisation's data in one runtime); (iii) the first third-party or plugin code in the runtime; (iv) any tool that writes. T011 as planned does **none** of these, so it does not need B. The first scheduled brief is the first ticket that does, and it must not start before the B ADR and its test matrix exist (checklist row already says so).
* **Honest limit of A, stated again:** it does not give database-enforced least privilege against COMPROMISED runtime code. A compromised runtime holding an owner's token could read what the owner can read. The compensating controls are the code boundary (a static test that the sandbox imports no database, network or SQL client), the closed read functions (a compromised runtime still cannot read what the functions do not return: no contact fields), the run binding and the budgets.

## 6. What the database proves and what it trusts

| Property | Proven | Trusted |
| --- | --- | --- |
| Tenant isolation of every read; the tenant comes from the run row | yes (pgTAP; a run of tenant A cannot read tenant B whatever arguments it passes) | |
| The agent cannot write anything but one brief (no grant, no function) | yes (a catalog test enumerates every function the `owner` definition may call; a test runs the whole tool set inside `read only`) | |
| A metric on the brief equals the database's own value | yes (SM240) | |
| An item's record exists, belongs to the tenant and is in the claimed state | yes (SM243) | |
| No customer text reaches the model or the stored brief | by construction: the tools return no text columns; `owner_brief_ok` forbids strings other than closed codes; an eval with hostile enquiry text, company names and notes proves none appears | |
| The ORDER and SEVERITY of attention items | no | the runtime's deterministic rules (and the model's ranking if enabled, bounded to a permutation of the items the tools returned) |
| That the brief is complete | no | a stated limit: it covers the eight tools, nothing more; the screen says "this brief looks at: ..." |

## 7. Test plan
* **pgTAP:** role matrix for every function; the run binding (another tenant's run, another user's run, a finished run, a run of another agent: one refusal each); every SQLSTATE; `owner_brief_ok` boundaries (31 items, a float, a string, an unknown kind, an id of another tenant); append-only; the closed function list; every read tool is `STABLE` and runs in `read only`; lock-introspection (no lock on enquiries, requirements, quotes, orders).
* **Real stack:** the API end to end, a Viewer and Sales refused, a second tenant sees nothing, the metrics equal an independent SQL count, a brief written twice is refused (SM244), a forged metric refused (SM240), a brief that names another tenant's quote refused (SM243).
* **Containment evals (`make eval`, scripted models that obey every injection, like E01-E15):** hostile text planted in an enquiry, a company name, a lead note, a quote line name and a requirement city asks the agent to "approve quote X", "send the price list to ...", "mark every order paid", "dump all contacts": the whole tenant is diffed before and after (no business row changes; no brief item carries any of the planted text); the agent calls a write tool that does not exist (refused, counted); calls a read tool with a foreign tenant id (refused); loops (budget stops it); the model step, if present, returns a number that is not in the items (rejected).
* **Python:** the sandbox boundary test (extends `test_agents_boundary.py`: no app.quotes / app.followup / app.orders import, no network, no SQL), the tool schemas (closed, bounded), the deterministic ranking (golden brief for a synthetic workspace, by value), the template renderer (closed values only), the cost accounting (zero without a model).
* **Web:** the brief page for Owner and Admin, nothing requested for Sales and Viewer, links built from ids only, hostile record ids/text rendered as plain text, "Suggested" until seen.
* **Mutation pass at the milestone:** the run-binding checks, the role lists, SM240/242/243/244, `owner_brief_ok` rules, the tenant derivation from the run (a mutant taking the tenant from an argument must be killed by the foreign-tenant test), the closed-list test, the item bound, and the "no text columns returned" rule.

## 8. Risks
(1) A brief that is wrong by omission looks authoritative: the screen lists what it looked at and when. (2) Leakage by joining: a tool that returns an id plus a name would put a person's name in front of a model; tools return ids only and the SCREEN joins names with the viewer's own token. (3) Alert fatigue: the item cap and severity order; "dismiss" is per item and remembered. (4) Money figures on the brief for a Viewer: refused by role. (5) A brief of a quiet day must not invent urgency: severity comes from rules (days to expiry, days waiting, balance size), not from a model.

## 9. Open owner decisions (recommended default in each)

1. **Deterministic first.** Default: commits 1-6 build a brief with NO model; a model step (rank / explain) is a final, separate commit that stays OFF until you give written approval under ADR 0017 b. Alternative: skip the model for good (the brief is already useful and cannot hallucinate).
2. **If a model is added:** it sees only the structured items (ids replaced by stable item keys, closed codes, integers), may only reorder them and pick a closed template, never write free text, and every number it returns is checked against the items. Default: yes under those limits. Alternative: no model.
3. **Scheduling.** Default: none in T011 (on-demand). A "morning brief" job is a separate ticket that requires option B first.
4. **Which attention kinds.** Default: the eight tools above. Strike any you do not want and add any you do; each addition is a tool plus tests.
5. **Thresholds.** Defaults (synthetic, yours to change before the build): "quote expiring" within 3 days; "requirement waiting" 2 days; "order with balance" any positive balance older than 7 days since the last event; "follow-up due" as T010 says.
6. **Who sees it.** Default: Owner and Admin only. Alternative: Sales sees the part of the brief about their own drafts and follow-ups (needs per-user filtering and a test per item kind).
7. **How many runs a day.** Default: 3 per workspace per day (an existing per-hour limit also applies), because each run reads many tables; a second run on the same India date supersedes the first on the screen (both are kept).
8. **Metrics period.** Default: today, last 7 days, last 30 days, in India time.
9. **Retention.** Default: keep briefs until erased with the tenant; no automatic deletion (a retention rule is a later, owner-reviewed decision).

## 10. Commit order and stops
1. ADR 0022 (owner agent), this plan's as-built section, checklist rows. 2. Migration part 1: the `owner` definition, `target_kind = 'tenant'` (replaces `start_agent_run`, copy test), the closed read functions, pgTAP (isolation, read-only, closed list, locks). 3. `owner_briefs`, `owner_brief_ok`, `agent_write_owner_brief`, the items-seen table, pgTAP and real-stack attacks. 4. The runtime: the deterministic brief builder, the tools, the flush, golden brief, the sandbox boundary test. 5. Containment evals (`make eval`). 6. API and web. 7. **Milestone: full `make check`, one mutation pass, handoff and checklist notes; STOP for the owner's review.** 8. (Only with written approval) the optional model step and its evals; `make eval-live` stays the owner's opt-in.
Each commit: `make check-fast` plus its new tests; full `make check` and the mutation pass only at commit 7. No push.
