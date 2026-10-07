# Plan: the follow-up due list's candidates (one read-only database function, ordering and paging)

Status: **APPROVED for the build on 2026-10-07 (see the next section).** When this plan was written no code, migration, test or dependency had been written or changed. Written 2026-10-07 on the branch `plan-files-chat` (from `origin/main`; the WhatsApp ticket is read from `origin/followups-whatsapp`, where it was pushed). This is the "its own small ticket right after followups-whatsapp, before Customer Zero" that the owner decided on 2026-10-07 (`docs/pre-pilot-checklist.md`, row "The due list reads at most 30 candidate leads").

## Owner decisions (2026-10-07) and corrections to this plan

**Status change: APPROVED for the overnight build.** All eight decisions of section 14 are **YES, as recommended**: (1) terminal "No follow-up" rows leave the due list; (2) oldest last outbound touch first; (3) page size 30, "Show the next leads", no fill loop; (4) option B (the database's own blocker), with the measurement gate; (5) keyset cursor; (6) the gate stays in the API; (7) the response becomes `{items, next_cursor}` with a tolerant web reader; (8) the function returns each candidate's open draft.

The open items are settled: **scan cap 300; function page ceiling 50; the constant keeps the name `DUE_LIST_MAX_LEADS`** (no rename); **no count of hidden terminal leads**; the short-page note **does show how many leads were left out**; the **cursor is base64url of `{at, id}`**; the hosted index build and a "folded gates" function are later; the other lists keep their `limit` for now.

Corrections:

* **a. The C0 regression test must not leave the repository red.** It is committed as an expected failure (`pytest.mark.xfail(strict=True, reason=...)`); C3 removes the marker and the test turns green (a strict xfail that starts passing fails the run, which is how the marker is forced out).
* **b. In C0, before anything else, the last definition of `app.followup_blocker` is read** and its closed answers confirmed against section 2 (terminal: `suppressed`, `replied`, `closed`, `max_touches`; staying in: `not_yet`, `future_history`, `invalid`, `NULL`). A difference stops the run.
* **c. Testing rhythm as in section 12:** the full `make check` in every commit with a migration or database change, or one that touches roles, permissions, consent or suppression; `make check-fast` plus the touched tests otherwise; mutation only at the end, one runner at a time.
* **Hard stops** (the run leaves the tree committed and clean and reports): the C0 measurement misses the section 4 budget (option C is **not** chosen by the build); the equivalence-gate extension fails (the terminal list or the test is **not** weakened); the same check fails after three honest fix attempts; anything that needs `.env`, an account, a payment, a push, or a change outside this ticket (the cadence engine, an existing migration).

## 0. Assumptions

* **A1. What is built today (verified in the code on `origin/followups-whatsapp`).** `GET /followups/due` calls `service.due_list` (`services/ai-api/app/followups/service.py`), which asks `repo.recent_outbound(limit=min(limit, DUE_LIST_MAX_LEADS))` with `DUE_LIST_MAX_LEADS = 30`. The repository reads the **120 newest outbound touch rows** (`limit * 4`, ordered `occurred_at desc, id desc`), keeps the distinct leads in that order and stops at 30. For each candidate the API reads the gate for e-mail and (unless the lead is stopped) WhatsApp (**at most 60 gate reads**), reads the lead's snapshot, runs the pinned engine, and builds a row. Open drafts come from one extra read of at most 200 active drafts.
* **A2. Product reading.** The due list is the working list of leads where a person may act now or wait for the next gap. Today it also shows "No follow-up" rows for leads the engine has stopped for good (a reply, the touch limit, won/lost, opted out). Those are not work, and with oldest-first ordering they would fill the front of every page. The plan therefore **removes engine-terminal leads from the candidates** and says so as an owner decision (section 14, decision 1).
* **A3. The pinned engine still decides.** `followup_cadence` 1.0.0 is unchanged and the API still runs it for every candidate it shows. The new function never returns an action, a reason or a time of eligibility; it returns only *which leads to ask the engine about*, and it may return **more** than the engine would call due (a safe superset), never fewer.
* **A4. Writes to `lead_touches` happen only through the definer functions** (`record_touch`, `record_draft_sent`); the table is append-only and no client role can write it (pgTAP 62). A touch's `occurred_at` can be back-dated by a person (at most 7 days), so "the last touch" always means the **maximum `occurred_at` of the outbound touches**, not the row order.
* **A5. No API has a cursor yet.** List endpoints take `limit`; the `(tenant_id, created_at, id)` keyset indexes exist but nothing uses them. This ticket sets the first paging convention for the product.
* **A6. Local-first (ADR 0017).** Synthetic data, local stack, nothing deployed; a hosted-scale index rebuild is noted, not done.

## 1. The problem today, in plain words

1. **The wrong leads are read.** The candidates are the leads that were *most recently* touched. The leads most likely to be **overdue** are the ones touched *longest ago*, and they are exactly the ones that fall outside the window.
2. **Worked example.** A workspace has 100 contacted leads. Thirty were written to this week (their next gap has not elapsed: "Not yet"); seventy were written to two to six weeks ago. A lead whose second-touch gap ended three weeks ago is correct to be on the list, and is never shown, however long the owner waits, until thirty more recent touches push the window along. The owner sees a list that looks complete.
3. **The 30 slots are spent on leads that cannot be acted on.** Stopped leads (an accepted order, an archived lead), leads blocked on every channel and leads the engine has stopped for good all take a slot before being dropped, and the page shows no gap.
4. **The window can hold fewer than 30 distinct leads.** 120 rows can belong to a handful of leads with many touches each (up to 100 touches per lead under a policy), so fewer than 30 leads are read although more exist.
5. **Open drafts are read separately and capped at 200.** A workspace with more than 200 active drafts would show a due row without its open draft.
6. **There is no way to ask for the next page.** No total, no "more" marker, no cursor.

## 2. What "could be due" means (exact)

A lead is a **candidate** when **all** of these hold. Nothing below is a cadence rule: each item is a fact, a call to a database function that already exists, or a closed list of that function's own answers.

| # | Condition | Source | Why it is not a copy of a cadence rule |
| --- | --- | --- | --- |
| L0 | The caller is an Owner, Admin or Sales member of the tenant; the lead belongs to that tenant | the role proof used by every follow-up function (`app.has_tenant_role`); a failure is the generic `42501` for everyone, as `followup_gate` | authorization, not cadence |
| L1 | The lead has **at least one outbound touch** | a fact about `lead_touches` | without one the engine can only say `initial_outreach_required` (the first message is a person's); today's list never shows such a lead either |
| L2 | `app.followup_stopped(lead) is null` | the existing database function (lead archived; order accepted, declined or cancelled; quote withdrawn) | **reused as it is**; the stop already outranks the engine (gate-first rule) |
| L3 | `app.followup_blocker(app.followup_build(lead, as_of, policy))` is **not** one of `suppressed`, `replied`, `closed`, `max_touches` | the database's own mirror of the engine's due rule (`app.followup_build` + `app.followup_blocker`, proven equal to the real engine by `tests/integration/test_followup_equivalence.py` on 1,949 grid cases) | a **call**, not a copy. The only knowledge added is *which four of the blocker's closed answers mean "terminal"*; they are the four whose engine counterparts carry `terminal: true` (`do_not_contact`/`opted_out`/`bounced`, `human_takeover`, `won`/`lost`, `max_touches_reached`). `not_yet`, `future_history`, `invalid` and `NULL` (due) all stay in the result |
| L4 | A follow-up policy is in force (`app.followup_active_policy_version(tenant, app.quote_today())`) | existing function | with no policy the function returns an empty list and `policy_in_force: false` (the page already says "no policy") |

**Not in the function, on purpose:**

* **The gate** (consent, key, unkeyed, erased, per channel). It stays in the API, per channel, after the function, so the order **stop > block > engine** and the closed words per channel stay exactly where they are tested. A candidate blocked on both channels by key/consent/unkeyed/erased still costs a slot and is dropped by the API (a short page; section 5). Contact-level suppression (opted out, complained, bounced) is already excluded by L3, so the common case is gone before the page is built.
* **Any timing rule** (gap days, quiet hours, weekdays, holidays, minimum gap). `not_yet` leads stay in; the engine says "due now" or "not yet" for each.
* **The touch limit** beyond the blocker's own answer `max_touches` (L3).

**Per candidate the function returns:** `lead_id`, `last_outbound_at` (the maximum outbound `occurred_at`), `last_outbound_channel` (`email` or `whatsapp` from the latest such touch, `null` if every outbound touch is a phone call; this replaces the repository's 120-row window logic), and the open draft if any (`open_draft_id`, `open_draft_channel` from the one active draft, read through the existing partial unique index on `followup_drafts`), which removes the 200-draft limit.

### 2.1 Options considered for L3

| Option | What it is | For | Against |
| --- | --- | --- | --- |
| A. Facts only (L0, L1, L2) | no terminal pre-filter | simplest; zero engine knowledge | replied, finished, closed and opted-out leads accumulate with the oldest last touches and take the **front** of every oldest-first page: the list is wrong again, only differently |
| **B. Facts plus the database's blocker for the four terminal answers (recommended)** | L0 to L4 above | single source (the draft creation path already refuses with the same function, so a lead the blocker calls terminal could not receive a draft anyway); no new rule text; the equivalence gate can pin the four answers to the engine's `terminal` flag | each examined lead costs a `followup_build` (three small queries); bounded by a scan cap per call (section 3) and measured first (slice C0) |
| C. A summary column on `leads` (`last_outbound_at`, outbound count, replied flag) kept by triggers | pre-computed ordering and an index seek | fastest at large scale | copies cadence facts into denormalised state, needs triggers on an append-only table and a backfill; only if B measures too slow |

**Recommendation: B**, with a measurement gate in slice C0: if one call at 20,000 leads / 100,000 outbound touches exceeds the budget in section 4, stop and propose C.

## 3. Ordering and paging

* **Order:** `last_outbound_at ASC, lead_id ASC` ("oldest last touch first"): the longest-waiting lead is first, so an overdue lead is on page 1 whatever the size of the workspace; recently touched ("Not yet") leads come last.
* **Keyset, not offset (recommended).**

| | Keyset cursor `(last_outbound_at, lead_id)` | Offset |
| --- | --- | --- |
| New touch recorded between two page loads | a lead that got a touch moves later; at worst it is shown again on a later page; none is skipped because of rows added before the cursor | every earlier insertion shifts all later rows: leads are skipped or repeated |
| Cost of page N | the same as page 1 (the aggregate is recomputed, see section 4, but no rows are counted and discarded) | grows with N |
| Needs | a stable total order (the tie-break on `lead_id`) | nothing |
| API shape | `?after=<opaque cursor>` | `?offset=` |

* **The function:** `public.followup_due_candidates(p_tenant_id uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer, p_scan_max integer) returns jsonb` ... `{policy_in_force, items: [...], next_cursor: {at, id} | null}`.
  * `p_limit` 1 to 50 (the API sends 30); `p_scan_max` 1 to 1,000 (the API sends 300): the function **examines** at most `p_scan_max` leads per call and returns at most `p_limit` candidates. If it stops because the scan cap was reached (a stretch of terminal leads), it returns the candidates found so far and a `next_cursor` positioned at the **last examined** lead, so the caller can continue; if it ran out of leads, `next_cursor` is `null`. Work per call is bounded however many dead leads sit at the front.
  * `(p_after_at, p_after_id)` are both null (first page) or both given (otherwise `22023`).
  * Read-only (`stable`), no locks, no audit row (reads of the gate are not audited either).
* **Cursor in the API:** an opaque string (base64url of `{at, id}`), at most 100 characters, validated for shape and parsed before the call (`422 validation_error` otherwise); it carries nothing secret and grants nothing (the tenant and role are proven by the function on every call, and a cursor for another tenant simply finds no rows there).

## 4. Index needs and cost

* **New index (the migration's only DDL besides the function):** `lead_touches_out_idx on public.lead_touches (tenant_id, lead_id, occurred_at desc) where direction = 'out'`. The existing `lead_touches_lead_idx (tenant_id, lead_id, occurred_at, id)` serves a per-lead lookup but not an index-only aggregate over outbound touches only. The partial index lets `max(occurred_at) ... group by lead_id` run as an index-only scan.
* **Cost model.** The ordering key is an aggregate, so one call computes `max(occurred_at)` for every lead of the tenant that has an outbound touch, sorts, and then walks from the cursor. That is **O(outbound touches of the tenant) per call**, not O(page). Stage-2 (L3) adds a `followup_build` + `followup_blocker` for each *examined* lead, at most `p_scan_max` per call.
* **Budget (to be confirmed by slice C0, not assumed):** a first page at **20,000 leads / 100,000 outbound touches** completes in under **300 ms** on the local stack (p95 over 20 runs), and a page that must skip 300 terminal leads in under **1.5 s**. The test prints the numbers and fails only on a loose bound (10 s) so the machine's speed cannot make it flaky; the committed report records the real figures.
* **If the budget is missed:** choose option C (summary column with an index `(tenant_id, last_outbound_at, id)`), as a separate decision and migration; the function's contract (inputs, outputs, ordering) does not change.
* **Index build on a large table:** `create index` in a migration takes a lock; irrelevant locally and at Customer Zero's size. For a large hosted table the build would be done by hand with `concurrently` outside the migration (noted for T012, not built).

## 5. How it meets `DUE_LIST_MAX_LEADS = 30` and the 60 gate reads

* `DUE_LIST_MAX_LEADS` stays the name of the **page size** (30). It no longer limits how many leads can be reached; it limits how many are processed **per request**.
* Per request the API does: **one** candidates call (page size 30, scan cap 300) + for each returned candidate the same work as today (gate e-mail; gate WhatsApp unless stopped; snapshot; engine) = **at most 60 gate reads, 30 snapshot reads, 30 engine runs**, unchanged. It no longer does the 120-row touches read or the 200-drafts read.
* A caller cannot raise the page size (`min(limit, 30)` in the service; the database function refuses more than 50 with `22023`). The unit test with 100 candidates keeps pinning 30 per request and 60 gate reads.
* **No "fill the page" loop.** If the API drops candidates after reading their gates (blocked on every channel), the page is short; the response still carries `next_cursor` and the web shows "Show the next leads". Reason: bounded latency and bounded reads per request, and a short page is honest (it can say "n leads were left out because they cannot be contacted").
* A request that gets `policy_in_force: false` shows the existing "no policy" sentence.

## 6. API and web changes

**API (`services/ai-api/app/followups`)**

* `repository.py`: `due_candidates(token, tenant, *, after, limit, scan_max)` calling the RPC with the caller's token (the same `_rpc` path as `gate`); `recent_outbound` and `OutboundLead` are removed with their tests (their mutants are re-pointed).
* `service.py`: `due_list(repo, token, tenant, *, cursor=None, limit=30, now=None)` returns `DueListOut {items, next_cursor | None, policy_in_force}`; per candidate: stop > block > engine exactly as now (the gate is read per channel; the engine runs only for a lead with an open channel); the default channel is computed from the function's `last_outbound_channel` and open draft as today.
* `routes.py`: `GET /followups/due?after=<cursor>`; the **response changes from a bare list to an object** (section 14, decision 7).
* `models.py`: `DueListOut`, `Cursor` parsing; `DueItemOut` unchanged.

**Web (`apps/web`)**

* `lib/api/followups.ts`: `parseDueList` accepts the object; **a bare list (an older API) is read as one page with no next cursor** (the same tolerance as the empty-`channels` reading); strict on everything present.
* The due page: heading unchanged; a hint line "Oldest first. Leads that need no follow-up (replied, limit reached, closed, opted out) are not listed." (decision 1); a "Show the next leads" link `?after=...` when `next_cursor` is set; a short-page note when the API left candidates out. No client state.
* `followup-text.ts`/pins: the new sentences are in the strings module and pinned by the checklist test.
* `docs/rehearsal-followups-checklist.md`: leads 3 (replied) and 7 (limit) no longer appear on the due list; row counts and sentences updated; the pin test stays green.

## 7. Migration plan and the migration copy tests

* **One new migration** (append-only; nothing already pushed is edited): `supabase/migrations/<next timestamp>_t010_followup_due_candidates.sql` containing the partial index and **one function, `public.followup_due_candidates`** (`security definer`, `set search_path = ''`, `stable`; the role proof first, then parameter validation, then the policy, then the loop; `revoke all ... from public, anon; grant execute ... to authenticated`). The terminal list is a constant array inside the function. **No new SQLSTATE**: the generic `42501` for any caller who is not a Sales-or-above member (same answer for a Viewer, an outsider and anon), `22023` for an invalid parameter or a half-supplied cursor. No helper in schema `app` unless the loop proves unreadable without one (then it is named in the ticket).
* **Migration copy tests** (`services/ai-api/tests`, in the style of `test_migration_copies.py`):
  1. the new migration holds the **last definition** of `public.followup_due_candidates` in the whole history, and a pinned copy of its text (a later edit of the terminal list, the role proof or the ordering is noticed);
  2. **a static "no cadence rules" guard:** the function text calls only `app.followup_stopped`, `app.followup_build`, `app.followup_blocker`, `app.followup_active_policy_version` and `app.has_tenant_role`, and contains none of the cadence vocabulary (`gap_days`, `min_gap_hours`, `quiet_hours`, `allowed_weekdays`, `holidays`, `recipient_utc_offset_minutes`); the string `max_touches` appears only as an element of the terminal list. This turns "must never duplicate cadence rules" into a failing test;
  3. the function is not redefined by any later migration without the test noticing; `app.followup_blocker`'s last definition is the one the equivalence gate pinned (re-asserted, because the new function depends on its four terminal answers);
  4. the index exists with the exact predicate (`direction = 'out'`).
* **Equivalence gate extension** (`tests/integration/test_followup_equivalence.py`, Tier 1 grid): for every grid request, **blocker ∈ {suppressed, replied, closed, max_touches} ⇒ the real engine's result has `terminal: true`** (the safe direction: the function never hides a lead the engine could still make due). The reverse direction is *not* required (a terminal engine outcome masked by `future_history` stays in the superset) and is reported as a count.

## 8. pgTAP sections (new file `66_t010_followup_due_candidates.test.sql`)

| Section | What it proves |
| --- | --- |
| A. Role | Owner, Admin and Sales get results; a Viewer, a member of another tenant, an anon caller and a null tenant id all get the same `42501`; the answer carries nothing about the tenant's existence |
| B. Parameters | `p_limit` 0, 51, null; `p_scan_max` 0, 1,001; a cursor with only one half; each is `22023`; boundary values 1 and 50 / 1 and 1,000 accepted |
| C. Candidates | in: a due lead, a `not_yet` lead, a lead with `future_history`; out: no outbound touch, archived, accepted/declined/cancelled order, withdrawn quote, a reply (inbound touch), the touch limit reached, a won opportunity, a disqualified lead, an opted-out/complained/bounced contact |
| D. Superset property | over a generated grid of leads, **every lead with `app.followup_blocker` in {`NULL`, `not_yet`, `future_history`, `invalid`} is in the result**, and a lead whose blocker is one of the four terminal answers is not |
| E. Order | oldest `last_outbound_at` first; a back-dated touch orders by its `occurred_at`; equal times by `lead_id`; a phone-only history orders correctly and reports `last_outbound_channel` `null` |
| F. Paging | a static set of 120 leads walked in pages of 7 returns each exactly once, in order, with `next_cursor` `null` only at the end; a page that hits the scan cap returns a cursor and the walk continues; a forged cursor for another tenant's lead returns nothing of theirs; a cursor beyond the end returns an empty page |
| G. Drafts | `open_draft_id`/`open_draft_channel` for an approved and a waiting draft, none after discard or "recorded as sent" |
| H. Policy | no policy in force: empty items and `policy_in_force` false |
| I. Safety | the function is `security definer`, `stable`, with an empty `search_path`; no `execute` for `public` or `anon`; running it changes no row (row counts before and after; the touches and drafts tables untouched) |
| J. Isolation | two tenants with the same shape of data never see each other's leads; the result of tenant A is unchanged by anything in tenant B |

## 9. The synthetic proof with 500+ leads

The test that proves the bug cannot return. **Written first and shown failing against the current code** (failing-first).

* **Setup (operator SQL on the local stack; synthetic):** one workspace; **600 leads** each with one outbound touch (some e-mail, some WhatsApp, some phone-only, some back-dated); 120 leads touched in the last 24 hours ("Not yet"); 480 older. Among the older: **one lead planted as the longest-overdue (last touch 40 days ago, gap elapsed, nothing blocking)**, 60 leads with a reply, 40 at the touch limit, 30 archived, 20 with an accepted order, 20 opted out, 15 won, and ~30 due leads at assorted ages.
* **DB-level walk (all 600):** walk the function in pages of 30 with the scan cap; assert (a) the planted overdue lead is on page 1; (b) the union of pages contains **every** lead that the Python oracle (the pinned engine run over `build_request` for each of the 600, the way the equivalence gate does) calls `draft_followup` or `wait` or a nonterminal stop, each exactly once; (c) it contains **no** lead the engine calls terminal; (d) the order is non-decreasing in `last_outbound_at`.
* **API-level walk (a keyed subset, more than one page):** 70 keyed leads created through the API (so the gate can read them) interleaved with the same shapes; walk `GET /followups/due?after=...` and assert the planted overdue lead is in the first page, every due lead appears once, the next-page link ends, and a per-request count of gate reads never exceeds 60.
* **The regression:** against the current `recent_outbound` code the same setup returns the 30 most recently touched leads and **misses the planted lead**; the test is committed in that failing form first (the commit message says so), then turns green with the function.
* **Timing:** the same dataset scaled to 20,000 leads and 100,000 touches (generated by `generate_series`, no API calls) records the figures of section 4.

## 10. Mutation plan (at the end of the ticket, one runner at a time)

* **SQL mutants for the new function** (`tools/mutation-followups`, the operator and hand-written lists): each comparison in the role proof and the validation flipped or removed; the keyset comparison `>` to `>=` and `<`; the order direction and the tie-break; each of the four terminal answers removed from the list (and a fifth added: `not_yet`, `initial_outreach`); `direction = 'out'` removed; the archived filter removed; the `followup_stopped` check removed; the tenant filter removed; the scan cap off by one; `next_cursor` null/not-null logic; the policy check; the last-outbound channel choice (phone counted, first instead of latest); the open-draft join; grant widened to `anon`; `security definer` to `invoker`.
* **Statement mutants:** the partial index dropped (a performance-only change: expected to survive the pgTAP set, so the plan adds an `EXPLAIN` test that asserts the index is used, and records the mutant as killed by it); the predicate of the index changed.
* **Python and web mutants:** cursor parsing and validation, page-size clamping, `next_cursor` propagation, the bare-list tolerance, the "Show the next leads" link and its `after` parameter, the short-page note; the old `recent_outbound` mutants are removed and the DUE bound mutants re-pointed.
* **Acceptance:** every mutant killed, or documented equivalent with its reason in `docs/checklist-notes/A.md`; the tool's README warning is followed (one runner at a time).

## 11. Rollout

* Local only (ADR 0017); the API and the web ship together in one branch; the web reader tolerates the old bare-list response for one release, so a web deployed before the API does not break.
* The migration is applied locally by `make db-reset`; because it only adds an index and a function it is safe on existing data. A defect found later is fixed by a **new** migration (`create or replace`), never by editing this one once pushed.
* `docs`: ADR 0022 gets an addendum ("the candidates function and paging"); the pre-pilot row is closed; `docs/handoff-t010-part2.md` and `CLAUDE.md` updated; the rehearsal checklist updated.
* Hosted notes for T012: index build strategy for a large table; re-measure the budget on the hosted database.

## 12. Slicing into commits, and where the full set runs

The testing rhythm: per commit `make check-fast` plus the tests of the touched files and the commit's new tests; **the full `make check` (pgTAP, integration, evals) in every commit that has a migration or database change, or touches roles, permissions, consent or suppression, or is a spike of a risky assumption (run on the real stack)**; a full `make check` once more from a clean `db-reset` at the end; mutation only at the end.

| Commit | Content | Checks that run |
| --- | --- | --- |
| **C0 spike** (no production code) | the failing-first 500+ regression test against the current code (shows the missed lead); a throwaway measurement script for the function's cost on 20,000 leads using a draft of the SQL kept out of `supabase/migrations`; the decision between options B and C is recorded | the spike and the failing test run on the real stack; `check-fast` |
| **C1 migration** | the migration (index + `public.followup_due_candidates`), pgTAP 66, the migration copy tests including the "no cadence rules" guard, the equivalence-gate extension | **full `make check`** (migration + a definer function reading follow-up data) |
| **C2 API** | repository call, service paging, route and cursor, `DueListOut`, unit tests (fakes), removal of `recent_outbound` | `check-fast` + the follow-up unit and integration tests touched |
| **C3 real-stack proof** | the 600-lead walk (DB-level and API-level), timing figures, the failing test from C0 now green | the new integration tests + the follow-up integration files; no migration, so no full set |
| **C4 web** | tolerant parser, "Show the next leads", hint and short-page note, strings, tests, checklist update | `check-fast` + the follow-up web tests and the checklist pin test |
| **C5 rehearsal** | `make rehearse-followups`: the preparation adds 35 extra synthetic keyed leads (two pages), expectations updated (leads 3 and 7 unlisted), a page-walk step | the headless driver; `check-fast` |
| **C6 mutation and docs** | mutation delta (SQL, Python, web), ADR 0022 addendum, hand-off, pre-pilot row, `CLAUDE.md` | the mutation passes; then **one full `make check` from a clean `db-reset`** and `make rehearse-followups`, reported with exit codes |

Each commit is small and stops being "done" only when its checks pass; the ticket stops for the owner after C6. Estimated size: **M** (a week of the agent's work), dominated by C1 and C3.

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| The terminal pre-filter hides a lead that is due (a wrong superset) | it is a **call** to the function the draft path uses, so a hidden lead could not receive a draft anyway; the grid equivalence extension pins the four answers to the engine's `terminal` flag; the superset property is tested on a generated grid and on the 600-lead walk |
| The function drifts into a second copy of the cadence rules | the static "no cadence vocabulary" copy test; the pinned text; review of any change that touches the terminal list |
| The aggregate cost grows with the workspace (O(outbound touches) per call) | the partial index; the measured budget (section 4); option C is the planned answer if the budget is missed |
| A stretch of terminal leads makes one call slow | the scan cap per call and the cursor that continues |
| A page is short because the API drops leads blocked on every channel | stated and visible ("some leads were left out"), cursor continues; folding both channel gates into the function is the later optimisation |
| Back-dated touches reorder leads between page loads | keyset ordering by the real `occurred_at`; documented; at worst a lead appears on a later page again |
| A response-shape change breaks an older web | the tolerant bare-list reader; shipped together locally |
| The first cursor convention becomes a pattern copied elsewhere | the cursor is opaque, validated, and documented in the ADR addendum as the product's convention |
| The old oldest-first rule hides a "Not yet" lead for a very long time | they are last by design; the lead page still shows them; the list is for the longest-waiting first |

## 14. Decisions I need from the owner (maximum eight, each with my recommendation)

1. **Should the due list stop showing "No follow-up" rows** (replied, limit reached, closed, opted out)? *Recommendation: yes. They are not work, and with oldest-first ordering they would crowd the front. Show a one-line hint that they are not listed; a separate page for them can come later.*
2. **Ordering.** Oldest last outbound touch first (overdue first), "Not yet" leads last. *Recommendation: yes.*
3. **Page size and the "more" link.** 30 leads per request, "Show the next leads", no loop that fills a short page. *Recommendation: yes (bounded work: 60 gate reads per request).*
4. **How the terminal leads are removed.** Option B (the database's own blocker, four closed answers), fall back to C (a summary column) only if the measured budget is missed. *Recommendation: B, with the measurement gate in the spike.*
5. **Keyset cursor, not offset.** *Recommendation: keyset.*
6. **The gate stays in the API in this ticket** (two reads per candidate). Folding both channels' gates into the function is a later optimisation. *Recommendation: yes.*
7. **Response shape.** `GET /followups/due` returns `{items, next_cursor}` instead of a bare list, with a tolerant web reader. *Recommendation: yes.*
8. **Return the open draft with each candidate** (this also removes the 200-draft limit gap). *Recommendation: yes.*

**Not decided (left open on purpose):** the scan cap (300 proposed) and the page-size ceiling of the function (50); the exact timing budget (to be set by the spike); whether to show a count of hidden terminal leads; the cursor's encoding details; whether the short-page note shows a number; the hosted index-build procedure; whether a later "folded gates" function should return channel states per lead; whether `DUE_LIST_MAX_LEADS` is renamed to `DUE_PAGE_SIZE`; whether the same cursor convention is applied to the draft list and the policy list; the name and number of the migration.

## C0 results (measured 2026-10-07, local stack; the spike test `tests/integration/test_followup_due_spike.py`, opt-in with `DUE_SPIKE=1`)

Dataset: 20,000 leads with 1 to 9 outbound touches each (**100,395** outbound touches in all, spread over a year; 7 of every 9 leads are at the touch limit of the test policy, a deliberately heavy mix of terminal leads) plus **400 `replied` leads older than everything else**. The draft function (`tools/due-candidates-spike/draft.sql`, option B) was applied by hand and timed **inside the database** (20 runs after 3 warm-ups; no HTTP or docker overhead); the function and the index were dropped afterwards.

| Case | p50 | p95 | max | Budget (section 4) |
| --- | --- | --- | --- | --- |
| First normal page (limit 30, scan cap 300) | 32.8 ms | **41.0 ms** | 42.6 ms | p95 < 300 ms: **met** |
| A page that must skip 300 terminal leads (the 400 `replied` leads first; 0 candidates, a cursor returned) | 142.1 ms | **144.8 ms** | 145.1 ms | p95 < 1,500 ms: **met** |
| A page deep in the set (cursor 180 days ago), for information | 182.0 ms | 351.5 ms | 436.7 ms | no budget |

**Decision: option B holds; no stop.** Findings that change the plan:

* **The partial index `lead_touches_out_idx` gives no measurable benefit and is NOT added.** With and without it the planner chooses a sequential scan for the aggregate (this one tenant holds 97% of the table; the aggregate over 100,395 rows runs in about 24 ms), even after `VACUUM ANALYZE`; the timings are identical (first page p50 32.9 ms without, 32.8 ms with). The existing `lead_touches_lead_idx (tenant_id, lead_id, occurred_at, id)` already gives tenant selectivity when a tenant is a small part of the table. An index that is not used would only cost writes. **The C1 migration therefore holds the function and no index** (section 7 and the index copy test are dropped). Re-measure at hosted scale at T012.
* The aggregate is O(outbound touches of the tenant) per call as modelled (about 24 ms per 100,000 rows); the stage-2 cost per examined lead is about 0.4 ms (the skip-300 case: 142 ms for 300 leads).


## C3 results (measured 2026-10-07 on the migrated function; `tests/integration/test_followup_due_spike.py`, opt-in with `DUE_SPIKE=1`)

Same dataset as C0 (20,000 leads, **100,395** outbound touches, 400 `replied` leads first), timed inside the database, 20 runs after 3 warm-ups (8 runs for the skip case):

| Case | p50 | p95 | max | Budget |
| --- | --- | --- | --- | --- |
| First normal page (limit 30, scan cap 300) | 41.3 ms | **66.4 ms** | 89.2 ms | p95 < 300 ms: met |
| A page that skips 300 terminal leads (0 candidates, a cursor returned) | 159.0 ms | **226.0 ms** | 252.6 ms | p95 < 1,500 ms: met |
| A page deep in the set (cursor 180 days ago), for information | 157.7 ms | 210.6 ms | 219.9 ms | none |

(The C0 draft measured 32.8 / 41.0 ms and 142.1 / 144.8 ms on a quieter machine; the same function text, so the difference is the machine, not the migration.)

The correctness proof on 600+ leads (`tests/integration/test_followup_due_candidates.py`, six tests, real stack): the **walk of the function returns exactly the leads the real pinned engine does not stop for good** (the oracle is the engine on the database's own request for every lead), each once, oldest first, with the 40-day-old lead first; no replied, at-limit, archived, lost, opted-out or won lead is returned; a walk with a scan cap of 9 and pages of 7 returns the same leads as a walk with 300 and 30; and the API walk shows every keyed candidate once, counts what it left out, starts with the overdue lead, and cuts pages at 30 candidates.
