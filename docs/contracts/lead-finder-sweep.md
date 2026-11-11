# Lead Finder weekly sweep: the API contract (C1 -> C2), PROPOSAL, 11 Nov 2026

Status: **draft, not built.** Published before building so C2 can design against it; shapes are final unless a line says "draft". Nothing here exists in the API yet. Builds on `docs/contracts/lead-finder.md` (ADR 0119); same base `/v1/tenants/{tenant_id}`, same error shape `{error:{code,message,retry_after,request_id}}`, same gates.
The API has no DELETE verb: pause, resume and remove are `PUT` and `POST`.

## What a sweep is
A **saved search that the scheduler runs by itself once a week**. It is the plan card of `docs/contracts/lead-finder.md` section 1 (query, area, max results) plus a weekday and an hour. Creating it is the Owner's standing OK for exactly that search, up to its result cap and its budget; the card says so in words.
A run does what an approved search does: finds businesses, drops duplicates, suppressed numbers and existing customers, scores them, and puts them in **Prospects**. **A sweep never dials anyone.** Every prospect it finds follows the existing rules (the first 10 of every new search wait for the Owner, "Needs you", the fit bar, the daily call cap). Calling stays a separate, explicit Owner action.

Who: **Owner and Admin** create, change, pause, resume, remove and run now; **Sales** reads the list and the runs; a Viewer gets 403. Same plan and business-type gates as the Lead Finder: 403 `lead_finder_not_available` (a school sees organisation sweeps only; `individuals_not_allowed` applies to the words), 403 `not_in_plan` (Lead Desk plan; show the same upgrade card), 409 `lead_finder_off` (platform switch). Also hide every sweep screen when `GET /lead-finder/availability` says `available: false`.

## 1. `SweepOut`
```json
{ "id": "uuid", "query": "saree shops", "area": "Jayanagar Bengaluru", "category_hint": "retailer | boutique | contractor | builder | dealer | other | null",
  "max_results": 20, "weekday": 1, "hour": 7, "timezone": "Asia/Kolkata",
  "enabled": true, "provider": "fixture | places", "est_cost_paise": 0, "cost_is_estimate": false, "attribution": "Google Maps | null",
  "next_run_at": "iso | null", "last_run": SweepRunOut | null, "created_by": "uuid", "created_at": "iso", "updated_at": "iso" }
```
`weekday` 1 = Monday ... 7 = Sunday; `hour` 0..23 India time (a sweep only searches, it dials nothing, so any hour is allowed; the default in the form is Monday 07:00). `next_run_at` is null while paused.
`est_cost_paise` is per run; `0` for the made-up (fixture) provider. Show it as "about ₹X a week, estimate" when `cost_is_estimate`.

## 2. The routes
| Route | Who | Does |
|---|---|---|
| `GET /lead-finder/sweeps` | Owner, Admin, Sales | `{ "items": [SweepOut], "max_sweeps": 5, "weekly_budget_paise": 0 }` |
| `POST /lead-finder/sweeps` | Owner, Admin | create, 201 `SweepOut` |
| `PUT /lead-finder/sweeps/{id}` | Owner, Admin | change any subset of the fields below; 200 `SweepOut` |
| `POST /lead-finder/sweeps/{id}/run` | Owner, Admin | run it now (the Owner's click is the OK); 200 `SweepRunOut`; counts as a search today (`search_cap_reached` when used up) |
| `POST /lead-finder/sweeps/{id}/remove` | Owner, Admin | take it off the list for good; its past prospects stay; 200 `{ "removed": true }` (a second call answers 200 too) |
| `GET /lead-finder/sweeps/{id}/runs?limit=20` | Owner, Admin, Sales | `{ "items": [SweepRunOut] }`, newest first |
Create body (closed; `text` or `query`, as in the plan card): `{ "text": "find new retailers in Jayanagar", "language": "en", "weekday": 1, "hour": 7, "max_results": 20 }` or `{ "query": "saree shops", "area": "Jayanagar Bengaluru", ... }`. Change body: `weekday`, `hour`, `max_results`, `enabled` (true resumes, false pauses). The words of the search cannot be changed: make a new sweep.
A sweep is an owner-approved plan, so the create call answers what the owner is agreeing to in `SweepOut` (provider, `est_cost_paise`); the web shows it on the card before the OK, like the plan card (`POST /lead-finder/plan` is not used: a sweep is not a one-off search).

## 3. `SweepRunOut`
```json
{ "id": "uuid", "sweep_id": "uuid", "state": "done | failed | skipped", "skip_reason": "switched_off | search_cap | budget | not_in_plan | provider_down | null",
  "search_id": "uuid | null", "started_at": "iso", "finished_at": "iso | null", "cost_paise": 0,
  "counts": { "found": 20, "new": 6, "duplicates": 14, "call_ready": 0, "needs_owner": 4, "skipped": 2 } | null,
  "new_since_last_run": 6, "trigger": "schedule | owner" }
```
`counts` has the keys of the search result card (section 2 of the Lead Finder contract; absent = 0). `new_since_last_run` is what the screen leads with: "6 new businesses this week". A **skipped** run stores nothing and costs nothing; show `skip_reason` in words: `switched_off` "the Lead Finder is switched off", `search_cap` "today's searches were used up", `budget` "this week's budget was reached", `not_in_plan`, `provider_down` "Google Maps did not answer". A **failed** run is retried once the next day, then waits for next week (nothing is billed for a failed run).
Prospects of a run carry that run's `search_id`, so `GET /prospects?search_id=` already filters by sweep run, and `source_label` says "Weekly search 'saree shops Jayanagar', 11 Nov".

## 4. Cost and safety rules (all enforced by the database, not the screen)
* **Budget:** the workspace has `weekly_budget_paise` (a Lead Finder setting; draft: added to `GET/PUT /lead-finder/settings`, range 0 to 100000 paise, default 0). A Google Maps (`places`) run whose estimate does not fit what is left this week is **skipped with `budget`**. Made-up (fixture) sweeps cost nothing and ignore it. Money is paise integers; the model never calculates it.
* **Search cap:** a run counts toward `searches_per_day`; at most `max_sweeps` (5) sweeps per workspace, else 409 `sweep_limit_reached`.
* **One run per sweep per week** (idempotent on sweep + ISO week), so a scheduler restart or a retry never searches twice.
* Terms: Google data keeps the 30-day expiry of ADR 0119; the sweep refreshes nothing it already stored.
* **No contact is made** by a sweep: nothing is dialled, texted or e-mailed; the Lead Finder's qualifying call stays the simulator until the owner turns real calls on separately.
* The audit log records who created, changed, paused, resumed, removed or ran a sweep, and when (names the closed `actor`, never the query text of a prospect).
* A **Viewer** and a different workspace get 403 and 404 (RLS).

## 5. Notification
After a run that found at least one new prospect: one in-app notification of kind `lead_sweep_done` with counts only ("Weekly search: 6 new, 4 need you"). **No business name or phone number in the title or body** (personal data rule). Tapping opens Prospects filtered by that run's `search_id`. No push, no WhatsApp message (web push is parked). Skipped and failed runs make no notification; they show in the sweep's run list.

## 6. Errors (all with the one shape; codes join the error catalogue when built)
`403 lead_finder_not_available | not_in_plan`, `409 lead_finder_off`, `409 sweep_limit_reached` (`extra: { max_sweeps }`), `422 not_a_search`, `422 individuals_not_allowed`, `422 validation_error` (with `fields`: weekday, hour, max_results out of range, an unknown field), `404 not_found`, `429 search_cap_reached` (on `run`).

## Words (en; te/kn/hi drafts for a native reader)
"Weekly search" (వారపు శోధన), "Runs every Monday at 7:00" (ప్రతి సోమవారం ఉదయం 7:00కి), "Pause" / "Resume" / "Remove", "Run now", "{n} new businesses this week", "Nobody is called by a weekly search." No machine-translation notice.

## Open before building (owner's word needed)
1. Google Maps spend for sweeps: draft default is budget 0, so a Places sweep runs only after the owner sets a weekly budget. Fixture sweeps need no approval.
2. Whether the weekly run may be earlier than the first-10 rule's owner review (draft: no; the rule is unchanged).
3. Real calling of what a sweep finds: out of scope here; see `docs/contracts/calls.md`.
