# Plan: the Owner Agent, T011a (the brief) and T011b (the agent), ADR 0024

Status: **PLAN ONLY. Not approved. No code, migration, test or dependency was written or changed.** Written 2026-10-08 on the branch `plan-customer-zero` from `origin/main` at `81060dd`. Queue position: T011a first (it is the next code ticket after the capture foundation in `docs/plans/customer-zero-roadmap.md`), T011b after the live batch (owner decision of 2026-10-06, kept here as a recommendation).

## 0. What already exists, and what this plan does with it

**A plan for this already exists: `docs/plans/t011-owner-agent.md`.** Read it first. It is the **T011a plan**, written 2026-10-06 and **replaced at the owner's direction**: the earlier idea (an agent run with a model, a stored brief table, SQLSTATEs SM240 to SM244) was withdrawn. T011a is now **deterministic and has no model**: read-only `SECURITY DEFINER` functions (eight, plus a ninth added after rehearsal step F8), one endpoint, one page. Its agent wrapper is named **T011b** and is only sketched there (its section 7: "deferred until after the live batch ... would reuse these functions as its closed tool set").

**This plan does not duplicate T011a.** It does three things:

1. **Keeps T011a's plan as the authority** for the deterministic brief (its sections 1 to 6, 8 to 10 stand) and adds the **errata** of section 1 below: things in that plan that the repository has since made out of date or that I believe are wrong. (That file is not edited here: this pass changes only the four documents the owner named; the errata are applied when T011a is built, in its ADR 0024 commit.)
2. **Designs T011b in detail** (sections 3 to 9): a read-only agent behind the existing model interface, with only the fake model, that **ranks and explains** the brief from recorded facts, with containment evals, cost caps and languages.
3. **Says plainly that two SQLSTATE ranges are not free:** the T011a plan uses none (it withdrew SM240 to SM244), and `docs/plans/members-and-invitations-plan.md` now reserves **SM240 to SM249** for members. T011b, if it needs a code, takes **SM250 to SM259**.

## 1. Errata to `docs/plans/t011-owner-agent.md` (to apply when T011a is built)

| # | Where | What is out of date or wrong | Correction |
| --- | --- | --- | --- |
| E1 | header, sections 1, 2 | says **eight** functions; section 2 then adds a ninth (`owner_brief_closed_orders_holding_money`) | the contract is **nine** functions; the endpoint, the page line "this brief looks at: ..." and every test count say nine |
| E2 | section 2, "Four of them read tables that do not exist yet (follow-ups, orders, suppression)"; section 9 decision 2 (build the five whose tables exist first) | **all the tables exist now** (follow-ups, orders, the ledger, suppression keys) | build all nine in one migration; drop the "not available yet" state, or keep it only as a safety value for a section whose function errors |
| E3 | section 2, `owner_brief_followups_due`: "leads with a follow-up draft decision due (read from T010's stored drafts; never recomputed here)" | "due" is decided by the pinned cadence engine in the API, not stored. What IS stored and exact is the **waiting and approved drafts**. The new `public.followup_due_candidates` (on the pushed due-list branch) returns a **safe superset**, not a due decision, so a count of candidates would overstate | rename the function `owner_brief_followup_drafts`: the follow-up **drafts waiting for approval (and approved but not yet recorded as sent), with their age in days and channel**. The brief links to the due-list page for "who could be written to" and never states a due count |
| E4 | section 2, `owner_brief_drafts_awaiting_approval` "(when T010 part 2 exists)" | it exists | the quote-draft and the follow-up-draft parts may stay in one function or be split with E3; decide in ADR 0024 |
| E5 | section 10, "T011a is not started before the T010 part 2 and order-conversion owner reviews" | both are merged | remove the condition |
| E6 | section 4 and 5 | the table says "Read the brief: Owner, Admin"; nothing says what a **Sales** user sees of the same facts. Sales can already read quotes, orders and follow-ups through their own screens (ADR 0021, 0022) | no change to v1 (Owner and Admin only); record in ADR 0024 that this is a deliberate narrowing and not a data-protection rule |
| E7 | section 2, thresholds | defaults "accepted by the owner's direction" | keep; list them as `operator-managed constants in the function bodies` with boundary tests, so a change is a migration |
| E8 | section 6 | correct, but silent about the **new tenant-level run target** T011b needs | see section 3.2 below |

## 2. Assumptions and principles

* **A1. Local-first (ADR 0017):** synthetic data, the fake model only, no live call, no paid service, no deployment. Nothing here sends anything.
* **A2. Option A (ADR 0013):** a T011b run is interactive and delegated: it runs with the asking Owner's or Admin's own token, so it can read nothing that person could not already read. **Option B is required before any scheduled or background brief, before any external customer, and before any tool that writes** (none is planned).
* **A3. The unit of truth is the database.** Every number, id and code the owner sees is a database count, sum or row; a model never computes, estimates, forecasts or invents one.
* **A4. Sizes:** S about 1 to 3 days, M about a week, L more than a week. Testing rhythm as in the other plans (per commit `make check-fast` plus the touched tests; the full `make check` in every migration commit; a final full check from a clean `db-reset`; mutation at the end, one runner at a time; the headless driver is the acceptance).
* **Principles (from CLAUDE.md):** no hidden autonomy (the page shows which part is the database's and which part is an agent's suggestion); real backend state only; the model interface, never a provider; provenance and uncertainty on anything used for action; inbound text is untrusted; least privilege; auditable.

## 3. The design

### 3.1 T011a in one paragraph (unchanged, see its plan)

`GET /v1/tenants/{id}/owner-brief` (Owner or Admin; anyone else gets the same refusal) calls nine read-only definer functions with the caller's token and returns `{as_of, generated_at, sections: [{kind, available, cut, items[], numbers{}}]}`; the page at `/app/tenants/{id}/brief` shows the date, plain numbers and an attention list in severity order, each item linking to its record by id, with the line saying which kinds it looks at and that it looks at nothing else. **The functions return only ids, closed reason codes, integers (paise, counts, days) and dates; no text column of a customer, a company or a note.** That last property is checked by a catalog test and is what makes T011b safe (section 5).

### 3.2 T011b: what the agent is, and is not

**It is** a read-only agent that, when an Owner or Admin presses "Rank and explain this brief", reads the nine sections through a **closed tool set** and returns a **structured ranking**: which items matter most today, in what order, with a closed "why" for each. It adds *judgement about order and grouping*, in the owner's language; it adds no fact.

**It is not** an open-ended assistant. A free question ("how did we do against last year?", "who is my best customer?") is **refused with a fixed sentence** and a list of what it can answer. Open Q&A over business data would need a query tool, and CLAUDE.md forbids a generic SQL shell. The questions it answers are exactly the brief's nine: drafts waiting for approval; quotes expiring; requirements waiting; follow-up drafts waiting; orders with a balance; leads blocked by suppression (a count only); pipeline counts; money summary; closed orders holding money.

**Shape (reusing the runtime of ADR 0013, 0018):**

* an `owner` entry in `app/agents/registry.py` and a matching `agent_definitions` row: **OFF by default** (its own platform flag `owner_agent_enabled`, and `allowed_tenants` empty until the operator names one), `max_writes = 0`, no claim predicates and no evidence kinds (the table already allows empty lists since T008), small ceilings (section 6);
* **tools: `read_section(kind)` and nothing else.** Each call runs one of the nine definer functions with the delegated token. No write tool, no fetch, no search, no free query. The sandbox boundary test (`tests/test_agents_boundary.py`) gains the new package so a write path cannot be added by accident;
* **a new run target kind, `tenant`.** `start_agent_run` today accepts `company`, `lead` and `enquiry`. A brief belongs to the workspace, so the migration adds `tenant` (a replaced function, with the copy-pin test of `test_migration_copies.py`) and the same limits (3 concurrent, 30 an hour) apply. **Who may start:** ADR 0013 lets Owner, Admin and Sales start any allowed agent, and the database has no per-agent role list. The brief is for Owner and Admin, and that is enforced where it matters: the route refuses Sales and Viewer, and **the nine functions refuse them** (the delegated token is the starter's), so a run started by Sales through PostgREST fails at its first tool call and reads nothing. A per-agent role list in `agent_definitions` would be cleaner and is listed as an open question. This is the only database change T011b needs besides the definition row and the flag, and it is a **full-check** commit;
* **no stored brief.** A run is recorded in `agent_runs` / `agent_run_steps` (bookkeeping, audited as the human, as today); nothing else is written. A stored, dismissible brief stays out (T011a decision).

### 3.3 The output contract (the model chooses; deterministic code writes)

The model returns, through the runtime's `final_result` mechanism, a closed structure:

```
{ "ranked": [ {"kind": <one of the nine>, "record_id": <uuid>, "reason_code": <closed code>, "group": <closed group>, "why_key": <closed key>} ... up to 12 ],
  "headline_key": <closed key>, "language": "en" | "te" | "hi" | "kn" }
```

* **No free text from the model in v1.** `why_key`, `headline_key` and `group` come from closed vocabularies (for example `waited_long`, `money_at_risk`, `expires_soon`, `needs_your_approval`); the **sentences** are written by deterministic templates from the key, the item's own fields and the chosen language.
* **The grounding verifier** (deterministic Python, run by the runtime after the model's final result, before anything is kept): every `(kind, record_id, reason_code)` must be present in the tool results **of this very run**; ranks are the list order; duplicates, unknown kinds, an unknown key, a language outside the four, or more than 12 items fail the run closed (`tool_failed`-style, nothing shown, the page keeps showing the deterministic brief). Numbers on the card are copied by code from the tool results, never taken from the model.
* **The deterministic brief stays on the page underneath.** The agent card is labelled "Suggested by the owner agent: unreviewed" and can be dismissed; it never replaces the database's list.

### 3.4 Where it appears

The brief page gains one button (Owner and Admin, one at a time, debounced) and one card. Nothing else. No notification, no e-mail, no push, no schedule (those need option B and SMTP).

## 4. Data model

* **T011a:** no table. Nine functions in one migration, `public.owner_brief_<name>(p_tenant_id uuid, ...)`, `SECURITY DEFINER`, `STABLE`, empty `search_path`, role proven first, returning at most 20 rows with a `cut` flag; thresholds as constants (3 days for expiring quotes, 2 days for waiting requirements, 7 days for orders with a balance), India-time periods.
* **T011b:** one `agent_definitions` row (`owner`), one `platform_flags` row (`owner_agent_enabled`, OFF), the `tenant` target kind in `start_agent_run` (and the matching `agent_runs` shape if a `tenant_id`-only target needs a column rule), and the closed vocabularies in code (`app/agents/owner_vocab.py`) with a test that pins them to the template sets in every language. **No stored brief, no new personal column**, so nothing to register for erasure.

## 5. Containment: why this agent is hard to steer

1. **The model's input contains no customer text at all.** The nine functions return only ids, closed codes, integers and dates (catalog test of every returned column type). A hostile string planted in an enquiry, a company name, a note or a quote line name **cannot reach the prompt**, because no function returns it. This is a stronger property than the other agents have, and it is the main reason this agent is safe to build early.
2. **Eval, spy-provider style:** a provider spy records every request the runtime builds; the test asserts the text of every block is made only of our constants, the closed codes, uuids, integers and dates (no free text), while the workspace holds planted hostile text.
3. **A scripted model that OBEYS every injection** (as in the T006 evals) tries: an id from another workspace; an id that was not in the tool results; an unknown kind or key; a sixth tool; a write call; a 13th item; a fifth language; free text in a closed field. Each must be refused, the run must end failed, and the database must show **no write outside `agent_runs` bookkeeping**, no change to any business table.
4. **Role:** the route refuses Sales and Viewer; a Viewer, another workspace's Owner and anon get the same generic refusal; a Sales user who starts a run directly (ADR 0013 allows it for any allowed agent) gets a run that **fails at its first tool call and reads nothing** (the nine functions refuse Sales). Tested at the route, at the function and at the run.
5. **The agents switch and the flag:** off by default; with the workspace switch off or the flag off, a run does not start.

## 6. Cost caps

* The existing **per-tenant daily cost cap** (`set_tenant_daily_cost_cap`, Owner-only today, up to 20.00) and the worst-case **reservation before every call** at the price in `agent_model_prices` (a model with no row is refused, fail closed) apply unchanged.
* **Definition ceilings (operator-managed, migration-only):** `max_tool_calls` 12, `max_input_tokens` about 10,000, `max_output_tokens` about 1,500, `max_cost_micros` set when the live batch fixes a price. The input is bounded because each section returns at most 20 rows of small structured items (nine sections, about 5,000 tokens; **measure it, do not assume it**).
* **One run per person per minute** in the UI; the platform limits (3 concurrent, 30 an hour) are the backstop.
* At the cap or on any failure the page shows the **deterministic brief** and a fixed sentence; nothing is lost.
* **Owner action before any live call:** the provider-side hard spend cap, the model's price row, and the live-batch cost reconciliation (existing checklist rows). The fake model costs nothing.

## 7. Languages

* The model's output is **language-free** (ids and closed keys) except the one-field `language` it echoes; **all sentences are templates**, so quality does not depend on a model's Telugu or Kannada.
* Template sets: English first. Telugu, Hindi and Kannada sets are written as data (reason keys to sentences, headline keys, the fixed refusal and fallback sentences) and **need a native speaker's review** before they are shown to the family (the owner decides who; a wrong word in a brief that drives money decisions is a risk, not a nicety).
* Numbers are formatted by code: Indian digit grouping (`Rs 5,00,000`), dates in India time (Asia/Kolkata), Latin digits by default (a Telugu or Devanagari digit option is a later, reviewed item). Amounts are paise in the database and rupees only in the template.
* The page, the card and the refusal sentences are pinned by a checklist-style test so a template and its screen cannot drift apart.

## 8. Tests and mutation plan

* **T011a** as in its plan (section 8): role matrix for every function; each runs inside `read only`; the returned column types are closed; boundary tests at, below and above every threshold; the 20-row limit and the `cut` flag; tenant isolation with two tenants' data; numbers equal independent SQL counts; hostile text planted everywhere never appears in the response; the response models forbid an extra field; the web page for Owner and Admin and nothing requested for Sales and Viewer; the `06_catalog_guards` allow-lists gain the nine functions.
* **T011b unit:** the grounding verifier (every rejection above, and that a valid ranking passes); the vocabularies pinned to the template sets of the four languages (a missing key in any language fails); the formatters (paise to rupees with Indian grouping, India dates).
* **T011b pgTAP:** the `tenant` target kind (who may start, as for every agent; a Sales-started run fails at its first tool call; the same refusal for others; limits; flag OFF by default; `allowed_tenants` empty), the definition row's ceilings, the copy pin of the replaced `start_agent_run`.
* **T011b evals (`make eval` family, scripted fake, real local stack):** the spy-provider test and the obey-every-injection cases of section 5, plus the cost-cap path (a reservation over the cap fails cleanly and the deterministic brief still shows) and a "no write" assertion (row counts of every business table before and after).
* **Headless driver:** `make rehearse-owner` (opt-in): a synthetic workspace with each of the nine situations planted; the brief matches independent counts; the agent card with the fake; every refusal; "nothing could send" checks. A click checklist is kept and pinned to the screens (acceptance is the driver, as decided for the earlier tickets).
* **Mutation (end of each ticket):** SQL mutants for the nine functions (role lists, each threshold comparison, the row limit, the count-only rule, the no-text rule) and for the replaced `start_agent_run`; Python and web mutants for the verifier, the vocabularies, the formatters and the card.

## 9. Slicing

| # | Commit | Size | Checks |
| --- | --- | --- | --- |
| **T011a** | | | |
| A0 | ADR 0024 (the brief) with the errata E1 to E8 applied to `t011-owner-agent.md`, and the checklist rows | S | `make check-fast` |
| A1 | Migration: the nine functions; pgTAP; the catalog allow-lists | M | **full `make check`** |
| A2 | API endpoint, models, fakes, real-stack tests | S to M | `make check-fast` + touched files |
| A3 | The page and its tests. **STOP: the owner reviews** | S | `make check-fast` + touched web tests |
| A4 | Headless driver, click checklist, mutation pass, hand-off; **one full `make check` from a clean `db-reset`** | S | full |
| **T011b (after the live batch, or earlier by decision 1)** | | | |
| B0 | ADR 0024 addendum: the output contract and the vocabularies | S | `make check-fast` |
| B1 | Migration: the `owner` definition, the flag, the `tenant` target kind; pgTAP; copy pin | S | **full** |
| B2 | Runtime: the spec, `read_section`, the verifier, the vocabularies, the fake model (`fake_owner.py`), the boundary test | M | `make check-fast` + touched |
| B3 | API route and the card on the brief page | S | `make check-fast` + touched |
| B4 | Evals, driver, mutation pass, hand-off; one full check from a clean reset | M | full |
| L | The live batch of this agent (provider, key, price row, hard cap, DPDP review) | S | owner approvals; `make eval-live` style gate |

T011a total about M (one to one and a half weeks); T011b about M (one week). T011a is unattended with one review stop; T011b built with the fake is unattended.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| The brief becomes a place where a wrong number drives a money decision | every number is a database count or sum, tested equal to an independent SQL count; the agent never produces one |
| The agent card is mistaken for the database's list | labelled "Suggested ... unreviewed", dismissible, the deterministic list always underneath |
| Thresholds (3, 2, 7 days) are wrong for the family | constants with boundary tests; a change is a small migration; the page names the thresholds |
| A new tenant-level run target widens `start_agent_run` | a full-check commit with a copy-pin test and a role matrix; the only new kind |
| Template sentences in Telugu, Hindi or Kannada are wrong | native-speaker review before display; English first |
| The closed vocabularies drift from the templates | a test fails when a key has no sentence in any of the four languages |
| People expect a morning message | stated out of scope (needs option B, a scheduler and SMTP); the page is computed when opened |
| Cost surprises once a real model is used | reservation before every call, a per-run ceiling, the daily cap, the fallback to the deterministic brief; measured at the live batch |

## 11. Not in scope

A model, a live call or a provider in T011a; free-text questions and any query tool; any write by the brief or the agent; a stored or dismissible brief; a scheduled, background or e-mailed brief (option B and SMTP); forecasts, projections or advice; customer-level analytics; a Sales or Viewer view of the brief; sending anything; voice; reading files or chat (the capture plan's own agent is separate); changing the cadence, quote or order engines.

## 12. Decisions I need from the owner (maximum eight, each with my recommendation)

1. **Build T011b before or after the live batch?** You decided on 2026-10-06 to defer it until after. With the fake model it can be built without any live call, and its input holds no customer text. *Recommendation: keep your decision: T011a now, T011b after the live batch, unless Customer Zero's timeline needs the ranking earlier.*
2. **Apply errata E1 to E8** (nine functions; all built together; the follow-up item is "drafts waiting", never a due count). *Recommendation: yes, in the ADR 0024 commit.*
3. **No free text from the model in v1** (closed keys and deterministic sentences only). *Recommendation: yes; revisit only after the live batch shows what is missing.*
4. **Who sees the brief:** Owner and Admin only. *Recommendation: yes for v1.*
5. **The nine thresholds and periods** (3, 2, 7 days; today / 7 / 30 days in India time). *Recommendation: keep the defaults already accepted.*
6. **Languages:** English first, with Telugu, Hindi and Kannada template sets after a native review. *Recommendation: yes; name the reviewer before the sets are written.*
7. **A fixed refusal for any free question,** listing the nine things it can answer. *Recommendation: yes.*
8. **Run limit:** one run per person per minute plus the platform backstop. *Recommendation: yes.*

**Not decided (left open on purpose):** a per-agent role list in `agent_definitions` (so the database, not only the route and the functions, says Owner and Admin); the final severity order of the attention list; the exact closed vocabularies; whether the follow-up section is one function or two (E3, E4); the model and its price (the live batch); the reviewer for the translations; whether a later scheduled brief is wanted (option B).
