# T011a plan: the owner's daily brief as eight read-only functions, one endpoint, one page (PLAN ONLY, nothing built)

Status: written 2026-10-06; **REPLACED on 2026-10-06 at the owner's direction.** The earlier plan (an agent run with a model, a brief table, SM240-SM244) is **withdrawn from T011a**; its agent wrapper is **T011b**, deferred until after the live batch (see section 7). Related: ADR 0013 (option A / B), ADR 0016 (second factor), ADR 0017 (local-first), `docs/plans/t010-integration.md`, `docs/plans/order-conversion.md`, `docs/plans/roadmap.md` row 7, `docs/pre-pilot-checklist.md`.
Reads before building: CLAUDE.md, AGENTS.md, docs/lanes.md, this plan, ADR 0018 / 0019, the T010 and order plans.

## 1. Scope and non-goals

**What it is:** a page an Owner or Admin opens (`/app/tenants/{id}/brief`) that shows the workspace's REAL state as a short attention list and a few plain numbers, read through **eight read-only `SECURITY DEFINER` functions called with the caller's own token** (the same trust model as every other read: the caller's JWT, RLS, one API door). One API endpoint (`GET /v1/tenants/{tenant_id}/owner-brief`) calls the eight functions and returns one structured response; one page renders it. Every item names its record by id, carries a closed reason code and integers; the screen builds the wording from closed templates and links from ids.

**Non-goals (explicit):**
* **No model, no agent run, no `agent_runs` row, no tool loop, no budgets or cost cap.** Nothing here is an agent, so ADR 0013's option A / B question does not arise (see section 6).
* **No brief table, no stored briefs, no "seen / dismissed" state, no `owner_brief_ok`, no SM240-SM244 codes.** The page is computed when it is opened; nothing is written. (A stored, dismissible brief is T011b's, if ever.)
* No write of any kind to business data; no scheduler, no e-mail digest, no push; no forecasts or projections; no generic query tool; no contact fields or customer text anywhere in the response.
* Not for Sales or Viewer.

**What does not change:** the Command Center shows real backend state only (CLAUDE.md); a number is the database's own count, never a model's.

## 2. The eight functions (migration; one per question the owner asks)

Each is `public.owner_brief_<name>(p_tenant_id uuid, ...)`, `SECURITY DEFINER`, `STABLE`, `search_path=''`, `authenticated` only, **Owner or Admin of that tenant** (checked first; every other caller, another tenant, a Viewer, Sales, anon: the same generic 42501), returns at most N rows of `{record_kind, record_id, reason_code, integers...}`; **no text columns are returned at all** (no name, no e-mail, no phone, no note, no enquiry or quote text). Reads take no row locks and run in one statement (a consistent snapshot per function).

| Function | Returns | Threshold (defaults, owner's to change before build) |
| --- | --- | --- |
| `owner_brief_drafts_awaiting_approval` | quote drafts that need the Owner's approval or are simply unapproved; follow-up drafts awaiting approval (when T010 part 2 exists); age in days | none (any draft) |
| `owner_brief_quotes_expiring` | draft and approved quotes whose `valid_until` is near, days left | within **3** days |
| `owner_brief_requirements_waiting` | enquiries whose requirement is draft or unconfirmed, days waiting | longer than **2** days |
| `owner_brief_followups_due` | leads with a follow-up draft decision due (read from T010's stored drafts; never recomputed here) | as T010 says |
| `owner_brief_orders_with_balance` | orders with a balance due, the amount (paise), the order state, days since the last event | any positive balance whose last event is older than **7** days |
| `owner_brief_blocked_by_suppression` | a COUNT only (never which contact) of drafts or leads blocked by suppression | none |
| `owner_brief_pipeline_counts` | counts by lead status and by quote outcome, last 7 and 30 days (India time) | none |
| `owner_brief_money_summary` | quoted, approved, paid and refunded paise for today, 7 and 30 days, from the ledger | none |

Four of them read tables that do not exist yet (follow-ups, orders, suppression): each function is written WHEN its table exists (commit order, section 5); until then the endpoint reports it as "not available yet" rather than showing an empty list. Row limits: 20 per list (the response says when a list is cut). Severity is a rule (days past a threshold, balance size), not a judgement.

## 3. API and page
* `GET /owner-brief` (Owner or Admin; anyone else 403, another tenant 404, Viewer and Sales 403): calls the eight functions with the caller's token, returns `{as_of (India date), generated_at, sections: [{kind, available, cut, items[], numbers{}}]}`; response models forbid extra fields so a column added to a function cannot leak. No request body, no write, no model.
* The page shows the date, the numbers as plain numbers, the attention list in severity order, each item linking to its record by id, a line "this brief looks at: <the eight kinds>; it does not look at anything else", and an honest empty state ("nothing needs your attention" only when every available section returned nothing). Nothing is sent; nothing can be changed from this page.

## 4. Who may do what
| | Owner | Admin | Sales | Viewer |
| --- | --- | --- | --- | --- |
| Read the brief | yes | yes | no | no |
No second factor is required (read-only, nothing leaves the workspace); the existing routes' rules apply.

## 5. What the database proves and what it trusts
| Property | Proven | Trusted |
| --- | --- | --- |
| Tenant isolation, role (Owner/Admin), the same refusal for every other caller | yes (pgTAP, RLS-independent definer checks) | |
| The functions write nothing and return no text | yes (each runs inside `read only`; a catalog test lists every column type returned: only uuid, closed text codes from a fixed list, integers, dates) | |
| Every number is the database's own count or sum | yes (an independent SQL count in the test equals the function) | |
| The thresholds are applied | yes (boundary tests at, below and above each) | the owner's choice of the numbers |
| Completeness | no | stated on the page: eight kinds, nothing more |

## 6. Option A / B and the agent question
T011a has **no agent run, so no delegated token is used for anything but what the signed-in person could already read**: it is an ordinary read endpoint. Option B stays mandatory (ADR 0013 decision 4) before any **scheduled or background** brief, before any external customer, before any third-party code in the runtime and before any tool that writes. T011a does none of these.

## 7. T011b (deferred, not planned in detail)
The agent wrapper (a model that ranks or explains the eight sections, with its own budgets, containment evals and an optional stored brief) is **deferred until after the live batch** (the first live model run under ADR 0017 b). It would reuse these eight functions as its closed tool set; nothing in T011a blocks it.

## 8. Test plan
* **pgTAP:** role matrix for every function (Owner, Admin, Sales, Viewer, another tenant's Owner, anon: one generic 42501); each function runs in `read only`; the returned column types are closed; boundary tests at every threshold; row limit and "cut" flag; tenant isolation with two tenants' data (nothing of the other tenant appears in any count); the catalog guard allow-list updated.
* **Real stack:** the endpoint for Owner and Admin, Sales and Viewer refused, a second tenant sees nothing and cannot read this tenant's brief; numbers equal independent SQL counts from a seeded synthetic workspace; hostile text planted in an enquiry, a company name, a note and a quote line name never appears anywhere in the response; the response models reject an extra field.
* **Web:** the page for Owner and Admin; nothing requested for Sales and Viewer; links built from ids only; plain-text rendering; the empty state; "not available yet" sections; phone layout.
* **Mutation pass at the milestone:** the role lists (Sales/Viewer may read), the tenant derivation, each threshold comparison, the row limit, the "no text columns" rule, the count-only rule of suppression.

## 9. Open owner decisions (defaults)
1. **Thresholds** as in the table (3 days, 2 days, 7 days): default accepted by the owner's direction ("the plan's thresholds").
2. **Order of building:** the five functions whose tables exist now (quote drafts, expiring quotes, waiting requirements, pipeline counts, and the quote part of money) first; the follow-up, order and suppression functions as those tables land. Default: yes.
3. **Metrics periods:** today, 7 and 30 days in India time. Default: yes.

## 10. Commit order and stops
1. ADR 0022 (the owner brief), this plan's as-built section, checklist rows. 2. Migration: the functions whose tables exist, pgTAP. 3. API endpoint, models, real-stack tests. 4. The page and its tests. 5. The remaining functions as their tables land (each with its pgTAP and a real-stack case). 6. Milestone: full `make check`, one mutation pass, handoff. **Stop for the owner's review after 4.** No push. T011a is not started before the T010 part 2 and order-conversion owner reviews, except the functions in commit 2 which need neither.
