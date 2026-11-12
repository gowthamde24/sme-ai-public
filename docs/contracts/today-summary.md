# Today summary: the API contract (C1 -> C2, call-capacity plan Phase 1, owner approved 12 Nov 2026)

Status: **DRAFT for C2's review, then published (contract first; the route follows in its own PR, the web behind `TODAY_SUMMARY_SCREENS` after that).** Owner's target: Today in 1 to 3 requests instead of about 30; first load under 3 s from India (not promised yet: the cause of the first-read delays is being measured, see `docs/plans/db-timeouts-and-sizing.md`).
Base `/v1/tenants/{tenant_id}`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`. JSON is snake_case. Fields and sections may be ADDED without a new contract; the web ignores what it does not know.

## Why a second "bootstrap"
`GET /bootstrap` already runs the layout's reads server-side (in parallel, each part with its own state) and the web already reads through it. The Today PAGE needs about 25 more reads, several of which depend on an earlier answer. `GET /today/summary` does the same for the page body, with the same authorization and the same data as the routes it runs, so nothing here is new logic and the web keeps its own words (the API sends data and codes, never new text).

## GET /today/summary
Any member of the workspace. Read only: no writes, no model call, nothing sent. Runs the routes below as the caller (same token, same row-level security, same role rules) in two waves, inside the API.

```json
{
  "as_of": "2026-11-12T10:22:07Z",
  "sections": {
    "today":        {"state": "ok", "data": { "cards": {}, "needs_you": [], "recent": [] }},
    "agents_status":{"state": "ok", "data": []},
    "outbox_settings": {"state": "not_for_you"},
    "lead_finder_prospects": {"state": "slow", "retry": "/prospects?status=needs_owner&limit=5"},
    "quotes":       {"state": "error", "error": {"code": "busy", "status": 503}},
    "call_briefs":  {"state": "ok", "data": { "<call_id>": {"lead_id": "<uuid>|null", "summary_short": "...", "visit_at": "<time>|null"} }}
  }
}
```

### A section's state (never all-or-nothing)
* `ok` with `data`: the route's own body, unchanged (so the web's existing mappers keep working), except the three derived sections below.
* `not_for_you`: the person's role may not read it, or the module is off for this workspace (the route answered 403, or 404 for a module that is not on). Draw nothing; it is not an error.
* `slow`: it had not finished after the soft deadline of **1.5 s**. The API does NOT cancel it: it keeps running and its answer is kept in the read cache, so the web fills the section with ONE follow-up read of `retry` (the ordinary route with the same query) which is then a cache hit. The first paint is never held back by the slowest part.
* `error` with `{code, status}`: the part failed or hit the hard deadline of **6 s** (`busy` 503). Same words as the bootstrap's (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `upstream` 502, `busy` 503, `error`). One failed part never fails the others.
If the page limiter refuses the whole request it answers `503 {"error":{"code":"busy"}}` with `Retry-After: 2`. `Cache-Control: no-store` (the API keeps its own 3 s copy, below).

### Wave 1 (all at once)
| Section | Route it runs | Who |
|---|---|---|
| `today` | `GET /today` | any member |
| `agents_status` | `GET /agents/status` | any member |
| `visits_today` | `GET /visits/today` | module `visits` |
| `visit_slots` | `GET /visits/slots?date=<today, India>` | module `visits` |
| `visits_proposed` | `GET /visits` with the filters the page uses (booked, the next 7 days) | module `visits`; Owner, Admin, Sales |
| `ai_usage_week` | `GET /ai-usage/week` | Owner, Admin |
| `outbox_settings` | `GET /outbox/settings` | Owner, Admin |
| `quotes` | `GET /quotes?limit=50` | as the route |
| `lead_desk_batches`, `lead_desk_handoffs`, `lead_desk_rules`, `lead_desk_tasks`, `lead_desk_leads` | the five reads the Lead Desk card makes today (`GET /batches`, `/handoffs`, `/rules`, the tasks and leads reads) with the queries the page uses | as the routes |
| `lead_finder_prospects` | `GET /prospects?status=needs_owner&limit=5` | as the route |
| `lead_finder_stats` | `GET /prospects/stats` | as the route |
The queries are fixed in code to what `apps/web/app/app/tenants/[tenantId]/today-data.ts` sends today (C2 confirms each in review); the web cannot widen them through this route.

### Wave 2 (needs wave 1's `today` and `lead_desk_batches`)
| Section | Runs when | Body |
|---|---|---|
| `outbox_approvals` | `today.needs_you` has an `outbox_approval` item | the body of `GET /outbox/approvals` |
| `call_requests` | `today.needs_you` has a `call_approval` item | the body of `GET /call-requests` |
| `call_briefs` | `today.needs_you` has `person_requested` or `visit_requested` items (at most **10**, the first ten) | **derived**: `{ "<call_id>": {"lead_id": uuid or null, "summary_short": text or null, "visit_at": time or null} }`, from `GET /calls/{id}` (the transcript and the rest of the call are NOT sent) |
| `quote_enquiries` | `today.needs_you` has `quote_approval` items whose quote is not in the first 50 of `quotes` | **derived**: `{ "<quote_id>": "<enquiry_id>" }` (data only; the web still builds the page address in `target-path.ts`). `QuoteSummaryOut` already carries `enquiry_id`, so only quotes beyond the list need a read of `GET /quotes/{id}` |
| `lead_desk_batch_items` | for each RUNNING batch in `lead_desk_batches` (at most 5) | `{ "<batch_id>": <body of GET /batches/{id}/items> }` |
A wave-2 section whose condition is false is simply absent. A wave-2 part is itself subject to the soft and hard deadlines.

### Not in it
The 24 hour outbox digest (paged, up to 100 a page) stays a separate read under Suspense, off the first paint. Nothing that writes. The layout's reads (`/bootstrap`).

## How it is kept cheap and safe
1. **Cache:** the API keeps the whole answer **3 seconds** per signed-in caller (the page limiter's read cache; `today/summary` is added to its `READ_PATHS`), dropped by any write by the same caller. Not 30 s: a message approved by another person or by the worker must not show as waiting for half a minute. Ten tabs are one read.
2. **Calls first, pages second:** the parts run as internal sub-requests that the page limiter does not count (as bootstrap's do), so ONE shared gate for the whole process caps internal parts at **16 at once** (`bootstrap` uses the same gate; it is lowered from 26 so a Today load can never take the threads a live call needs). The 1g replay of the plan proves a live call is unaffected during a Today load.
3. **Role words, not new logic:** the same routes, so a role sees exactly what it sees today. A test asserts that for each role the summary's sections equal the separate routes' answers.
4. **Logging:** counts only (`today_summary ok=n slow=n error=n not_for_you=n ms=n`), never an id or a value.
5. **Slow parts finish:** a part past the soft deadline continues in the background (bounded by the hard deadline) and fills the cache for the follow-up.

## Order of work
1. This contract reviewed by C2 (queries of each section, the names).  2. The route in its own PR (tests: states, deadlines, role equality, shared gate, no-store, cache drop on write).  3. C2's reader behind `TODAY_SUMMARY_SCREENS` (new env var: a row in `docs/runbooks/hosting-env-and-secrets.md`), old path as the fallback for one release, no web deploy without the owner's yes.  4. The replay before production go-live.
