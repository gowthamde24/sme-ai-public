# Today summary: the API contract (C1 -> C2, call-capacity plan Phase 1, owner approved 12 Nov 2026)

Status: **reviewed by C2 on 12 Nov 2026 (seven corrections and the `skip` parameter taken in); to be published (contract first; the route follows in its own PR, the web behind `TODAY_SUMMARY_SCREENS` after that).** Owner's target: Today in 1 to 3 requests instead of about 30; first load under 3 s from India (not promised yet: the cause of the first-read delays is being measured, see `docs/plans/db-timeouts-and-sizing.md`).
Base `/v1/tenants/{tenant_id}`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`. JSON is snake_case. Fields and sections may be ADDED without a new contract; the web ignores what it does not know.

## Why a second "bootstrap"
`GET /bootstrap` already runs the layout's reads server-side (in parallel, each part with its own state) and the web already reads through it. The Today PAGE needs about 25 more reads, several of which depend on an earlier answer. `GET /today/summary` does the same for the page body, with the same authorization and the same data as the routes it runs, so nothing here is new logic and the web keeps its own words (the API sends data and codes, never new text).

## GET /today/summary[?skip=name,name][&only=name,name]
Any member of the workspace. Read only: no writes, no model call, nothing sent. Runs the routes below as the caller (same token, same row-level security, same role rules) in two waves, inside the API.

```json
{
  "as_of": "2026-11-12T10:22:07Z",
  "sections": {
    "today":        {"state": "ok", "data": { "cards": {}, "needs_you": [], "recent": [] }},
    "agents_status":{"state": "ok", "data": []},
    "outbox_settings": {"state": "not_for_you"},
    "lead_finder_prospects": {"state": "slow", "retry": "/today/summary?only=lead_finder_prospects"},
    "quotes":       {"state": "error", "error": {"code": "busy", "status": 503}},
    "call_briefs":  {"state": "ok", "data": { "<call_id>": {"lead_id": "<uuid>|null", "summary_short": "...", "visit_at": "<time>|null"} }}
  }
}
```

### `skip` (optional): sections the page will not draw
`?skip=lead_desk_tasks,lead_desk_leads,...` (comma-separated section names, at most 40 characters each and 30 names; anything else is ignored). **Skipped sections are not run and are absent** from `sections`; unknown names are ignored. The page decides by its own flags and role what it draws (the Lead Desk screens each have a flag; Lead Finder access can be off or upsell), so a read the page would throw away costs nothing here: it does not count against the shared cap of 16 and is not cached. Two rules: (1) a wave-2 section needs its wave-1 input, so skipping `today` also leaves out `outbox_approvals`, `call_requests`, `call_briefs` and `quote_enquiries`, and skipping `lead_desk_batches` leaves out `lead_desk_batch_items`; (2) the 3 s cache key is the path AND the query, so a different `skip` is a different cache entry.

### `only` (optional): the retry
`?only=name,name` runs just those sections (plus, without showing them, the reads they need) and answers when they are done: **no soft deadline**, each read has its own hard deadline of 6 s, so the answer is `ok`, `not_for_you` or `error`, never `slow`. `skip` is applied after `only`. Same limits and the same ignoring of unknown names as `skip`.

### A section's state (never all-or-nothing)
* `ok` with `data`: the route's own body, unchanged (so the web's existing mappers keep working), except the three derived sections below.
* `not_for_you`: the person's role may not read it, or the module is off for this workspace (the route answered 403, or 404 for a module that is not on). Draw nothing; it is not an error.
* `slow`: it had not finished after the soft deadline of **1.5 s** (from the start of the request). The API does NOT cancel it: it keeps running (bounded by the hard deadline) and `retry` is `/today/summary?only=<name>` (relative to the tenant base): that read JOINS the one already running or finished (no second read), and waits for it, so the web fills the section with ONE follow-up request. For a derived section the retry also joins the reads it needs, without showing them.
* `error` with `{code, status}`: the part failed or hit the hard deadline of **6 s** (`busy` 503). Same words as the bootstrap's (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `upstream` 502, `busy` 503, `error`). One failed part never fails the others.
A section that has nothing to say is `{"state": ..., "data": null, "error": null, "retry": null}` in the unused fields (like the bootstrap's parts). If the page limiter refuses the whole request it answers `503 {"error":{"code":"busy"}}` with `Retry-After: 2`. `Cache-Control: no-store` (the API keeps its own 3 s copy, below).

### Wave 1 (all at once)
| Section | Route it runs | Who |
|---|---|---|
| `today` | `GET /today` | any member |
| `agents_status` | `GET /agents/status` | any member |
| `visits_today` | `GET /visits/today` | module `visits` |
| `visit_slots` | `GET /visits/slots?date=<today, India>` | module `visits` |
| `visits_proposed` | `GET /visits?from=<today, India>&to=<today + 61 days>&status=booked` (the API reads at most 62 days) | module `visits`; every role except Viewer |
| `ai_usage_week` | `GET /ai-usage/week` | Owner, Admin |
| `outbox_settings` | `GET /outbox/settings` | Owner, Admin |
| `quotes` | `GET /quotes?limit=50` | as the route |
| `lead_desk_batches` | `GET /outreach/batches` (no status) | as the route |
| `lead_desk_handoffs` | `GET /outreach/handoffs?open=true` | any non-Viewer |
| `lead_desk_rules` | `GET /outreach/rules` | Owner, Admin |
| `lead_desk_tasks` | `GET /tasks?limit=100` (no status) | Owner, Admin |
| `lead_desk_leads` | `GET /leads?limit=25` (no cursor, no filter, so no `junk=hide` on this call) | Owner, Admin |
| `lead_finder_prospects` | `GET /prospects?status=needs_owner&limit=5` | as the route |
| `lead_finder_stats` | `GET /prospects/stats` | as the route |
The queries are fixed in code to what `apps/web/app/app/tenants/[tenantId]/today-data.ts` sends today (confirmed section by section by C2 on main `3b7bcbf8`, 12 Nov 2026); the web cannot widen them through this route.

### Wave 2 (needs wave 1's `today` and `lead_desk_batches`)
| Section | Runs when | Body |
|---|---|---|
| `outbox_approvals` | `today.needs_you` has an `outbox_approval` item | the body of `GET /outbox/approvals?limit=100` |
| `call_requests` | `today.needs_you` has a `call_approval` item | the body of `GET /call-requests?status=requested&limit=100` |
| `call_briefs` | `today.needs_you` has `person_requested` or `visit_requested` items (at most **10**, the first ten) | **derived**: `{ "<call_id>": {"lead_id": uuid or null, "summary_short": text or null, "visit_at": time or null} }`, keyed by the CALL id (= the item's `target.id`), from `GET /calls/{id}` (the transcript and the rest of the call are NOT sent). A call whose read failed is simply left out of the object: the section stays `ok` |
| `quote_enquiries` | **every** target with `type` `quote` in `today.needs_you` AND in `today.recent` whose quote is not in the first 50 of `quotes` | **derived**: `{ "<quote_id>": "<enquiry_id>" }` (data only; the web still builds the page address in `target-path.ts`). `QuoteSummaryOut` already carries `enquiry_id`, so only quotes beyond the list need a read of `GET /quotes/{id}` |
| `lead_desk_batch_items` | for each RUNNING batch in `lead_desk_batches` (the first 5) | `{ "<batch_id>": <body of GET /outreach/batches/{id}/items> }` (no cursor; Owner, Admin) |
A wave-2 section whose condition is false is simply absent, and so is one whose input section is not `ok` (the web then asks for the input again and for the rest through the ordinary routes). Caps: at most 10 call briefs, 20 quote lookups, 5 running batches. A wave-2 section is itself subject to the soft deadline (counted from the start of the request) and the hard one.

### Opt-in sections: `include=` and `checks=` (added 12 Nov, for the first paint of the pack cards)
`?include=name,name` adds sections that are NOT part of the default answer; nothing here runs unless it is named (unknown names are ignored, and `only=<name>` alone also names one, so a retry works). Each is the body of one existing route, run as the caller (a 403/404 is `not_for_you`):

| Section | Route it runs | Kept for |
|---|---|---|
| `pack_report_today` | `GET /reports/run/education.today` (no query, as the web reads it; the report's own default is today, India) | 3 s |
| `campaigns` | `GET /campaigns?limit=50` | 3 s |
| `institution_admissions` | `GET /institution/admissions?limit=100` | 3 s |
| `trips_today` | `GET /trips?date=<today IST>` | 3 s |
| `material_quotes` | `GET /materials/quotes?limit=50` | 3 s |
| `ledger_summary` | `GET /ledger/summary?limit=100&party=company` | 3 s |
| `example_data` | `GET /example-data` | **30 s** |
| `outcomes_totals` | `GET /outcomes/totals` | 3 s |
| `setup_progress` | **derived**, see below (needs `checks=`) | **60 s** (per set of checks) |

`skip` wins over `include` for the same name (the section is not run). Opt-in sections are dropped from memory by the caller's own writes like every other section (so Remove/Load/Reset example data is followed by a fresh `example_data`). A check that is valid but not used by the workspace's pack is still answered from its data (false when never set up); the page asks only for its own.

**`setup_progress`** (Owner and Admin; Sales and Viewer get `not_for_you` and nothing is read): `?include=setup_progress&checks=business_profile,second_factor_set,...` answers `{ "<check>": true | false | null }` for exactly the checks asked, in the order of this closed list (a name outside it is dropped; with no valid check the section is absent): `business_profile, institution_set, students_imported, fee_plan_set, first_campaign_approved, lead_source_added, call_rule_approved, ask_assistant_tried, delivery_rule_set, second_factor_set, catalogue_has_items, quote_rules_set, whatsapp_connected, first_quote_sent`. Each fact is read from existing routes with the same rule as the web (`apps/web/lib/packs/activation-facts.ts`, including the materials variant when the `materials` module is on). `null` = the read failed (not `false`: the page decides how to show "could not check"). `calls_today` is not a check. Cost control: its reads go through a lane of **4 at once** inside the shared gate of 16; one path asked by two sections (e.g. `/campaigns?limit=50`, `/quotes?limit=50`) is read once per request; a slow `setup_progress` carries `retry: "/today/summary?only=setup_progress&checks=<the same checks>"`.

### Not in it
The 24 hour outbox digest (paged, up to 100 a page) stays a separate read under Suspense, off the first paint. Nothing that writes. The layout's reads (`/bootstrap`).

## How it is kept cheap and safe
1. **Memory, not a response cache:** each SECTION's read is kept per signed-in caller for **3 seconds**, finished or still running (so ten tabs, a different `skip` and a `retry` are one read), and forgotten when that caller writes anything (the page limiter calls the summary's hook). The whole answer is NOT cached: an answer containing a `slow` section must not be frozen for 3 s. Not 30 s: a message approved by another person or by the worker must not show as waiting for half a minute. Errors are never kept.
2. **Calls first, pages second:** the parts run as internal sub-requests that the page limiter does not count (as bootstrap's do), so ONE shared gate for the whole process caps internal parts at **16 at once** (`bootstrap` uses the same gate; it is lowered from 26 so a Today load can never take the threads a live call needs). The 1g replay of the plan proves a live call is unaffected during a Today load.
3. **Role words, not new logic:** the same routes, so a role sees exactly what it sees today. A test asserts that for each role the summary's sections equal the separate routes' answers.
4. **Logging:** counts only (`today_summary ok=n slow=n error=n not_for_you=n ms=n`), never an id or a value.
5. **Slow parts finish:** a part past the soft deadline continues in the background (bounded by the hard deadline) and fills the cache for the follow-up.

## Order of work
1. This contract reviewed by C2 (queries of each section, the names).  2. The route in its own PR (tests: states, deadlines, role equality, shared gate, no-store, cache drop on write).  3. C2's reader behind `TODAY_SUMMARY_SCREENS` (new env var: a row in `docs/runbooks/hosting-env-and-secrets.md`), old path as the fallback for one release, no web deploy without the owner's yes.  4. The replay before production go-live.
