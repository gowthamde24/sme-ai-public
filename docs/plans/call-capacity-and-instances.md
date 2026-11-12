# Plan: calls first, and more than one instance (written 12 Nov 2026; PLAN ONLY, nothing is built)

Owner request (12 Nov 2026): for Customer Zero keep ONE instance but make call streams take priority over page reads; before more customers, a design that allows more than one instance without breaking call affinity (Take over, Whisper, Hang up). Put it in the production plan with a date; no build yet.

## 1. What happened on 12 Nov 2026, 10:19 to 10:25 UTC (staging, `sme-api-00155-gwm`, min 1, max 1, 1 vCPU, 512 MiB, concurrency 40)

Measured from Cloud Run request logs and Cloud Monitoring (no phone number or text involved):

| Minute (UTC) | Requests | Slowest | Status |
|---|---|---|---|
| 10:17 (idle) | 5 | 0.3 s | all 200 |
| 10:19 | 63 | 1.4 s | all 200 |
| 10:20 (call answered 10:20:08) | 192 | 84 s (the call's own stream) | 200 |
| 10:21 (call ended 10:21:29) | 162 | 36 s | 10 x 502 |
| 10:22 | 151 | 32 s | 65 x 502 |
| 10:23 | 116 | 26 s | 79 x 502 |
| 10:24 | 56 | 17 s | 9 x 502 |
| 10:25 | 17 | 0.9 s | all 200 |

* **Not the CPU** (container CPU utilisation, p99, never above 15 %) and **not the memory** (54 to 60 %).
* **The instance's request limit was reached**: highest concurrent requests 42 against a limit of 40 (10:23 and 10:24). A request beyond the limit gets a 502. One browser page load calls about 12 routes, and the page polls: 190 requests a minute against 5 when idle.
* **The slowness came from the data layer**: the app logged `postgrest unreachable: ReadTimeout`, `today data layer unreachable: ReadTimeout`, `data layer unreachable: ReadTimeout` (21 times between 10:19 and 10:27). Even cheap routes (`/v1/me`) took 3.5 s at the median, and many routes sat at 10.0 s, which is the 10-second read timeout of the repository clients. So requests waited on Supabase (staging), held their slots, and the slots ran out.
* **The call itself was not hurt** (no `phone_call_*_failed` line; the record was written), but it shared the instance: a call's own callbacks (`/v1/telephony/plivo/*`) and its stream would have queued behind the page reads had the limit been reached during the call.
* **The database side (owner's dashboard reading, 12 Nov, 11:10 to 12:08 Berlin):** 19 Postgres errors, all at the 10:20 UTC spike; the API gateway and Auth spiked at the same time; compute **Nano**, RAM 72 % **when idle**, connections 17 of 60. The database itself is small (94 MB, cache hit rate 1.00), so the pressure is not data size.
* **What the Postgres errors were: not yet known.** The Supabase connector has no access to that project and the CLI has no log command, so I could not read them. Owner step (two minutes): Supabase dashboard > Logs > Logs Explorer, run `select timestamp, event_message, parsed.error_severity, parsed.sql_state_code from postgres_logs cross join unnest(metadata) as m cross join unnest(m.parsed) as parsed where parsed.error_severity in ('ERROR','FATAL','PANIC') and timestamp between '2026-11-12T10:19:00Z' and '2026-11-12T10:26:00Z' order by timestamp`, and send me the distinct messages with their `sql_state_code` (no personal data in them). How I read them: `57014` = a query cancelled (statement timeout), `53300` = too many connections, `53200` or `53400` = out of memory or a limit, `42xxx` = a statement error (a bug of ours).
* **Per request, what the API asks the database** (read from `app/auth/deps.py`): every workspace route first looks up the caller's membership (one database call), then the terms-and-privacy check (a second), then, for a write, the billing state (a third), and only then its own query. The token itself is checked locally against cached keys, not by a call to Auth. So one page load of 12 routes is about 25 to 40 PostgREST calls, each through row-level security, on a Nano instance (shared CPU, 0.5 GB, disk baseline 250 IOPS and 5 MB/s). The Auth spike in the dashboard is not explained by the API's per-request path (no Auth call there); likely token refreshes of the open tabs and the scheduler account, not verified.

## 2. Customer Zero (one instance): calls first, pages second. Phase 1

Goal: whatever the pages and the data layer do, a call's callbacks, stream and live actions are never queued behind a page read, and a slow data layer degrades pages quickly (an answer of "busy" in under 1 s) instead of holding them for 30 s.

| # | Change | Where |
|---|---|---|
| 1a | **Page-read limiter** inside the API: at most 12 page requests in flight (reads and writes of the web app); the 13th gets `503 busy` with `Retry-After: 2` at once. NEVER limited: `/v1/telephony/plivo/*`, the media socket, the call actions (hang up, take over, whisper, take-over end), `/health`. | API (C1) |
| 1b | Cloud Run concurrency 40 to 80, so the platform limit is never what refuses a call callback (the limiter in 1a is what holds pages back). | `deploy/cloudrun.sh` |
| 1c | Page reads: upstream read timeout 10 s to 4 s, and a breaker: after 5 data-layer timeouts within 10 s, page reads fail at once with `503 busy` for 5 s (the call's own writes keep their longer timeouts and are never short-circuited). | API (C1) |
| 1d | **Cut the fan-out**: one bootstrap request for the 12 reads a page makes on load; polling slower (30 s) and stopped while the tab is hidden; back off on a 5xx; never retry a 502 at once. | Web (C2) |
| 1e | Short read cache (3 s, per user and route) for the polled GETs (`today`, `nav-counts`, `calls`, `ai-assistant`, `billing/*`), so ten tabs are one read. | API (C1) |
| 1h | **Cut the lookups that every request repeats**: the membership lookup cached per (user, workspace) for 15 s (a role change or removal shows within 15 s; the owner-only and second-factor actions skip the cache), and the terms-and-privacy check cached per user for 60 s. Together with 1a to 1e this takes one page load from about 25 to 40 database calls to about 5 to 8. | API (C1) |
| 1i | **The bootstrap request resolves the workspace context ONCE** for all its parts (one membership lookup, one policy check), and its slow-changing parts (tenant, pack, modules, billing, entitlements, workspace profile, my profile) are one SQL function call, cached 60 s per workspace and dropped on any write to them. The polled parts (today, agents status, nav-counts, live calls) keep the 3 s cache. | API (C1) + one migration |
| 1f | Alerts (production): data-layer timeouts over 5 in a minute; concurrent requests over 30 for 2 minutes. | `deploy/production-alerts.sh` |
| 1g | **Proof before it counts**: replay of the 10:20 pattern against staging (190 requests a minute with the 12-route fan-out, the upstream made 10 s slow by a test switch) while a synthetic call runs: the call has no audio gap and its callbacks answer in under 1 s; pages get `503 busy` in under 1 s, never 30 s. Written down with the numbers, and the database calls per page load counted before and after (target: at most 8). | C1 |

**Dates:** build 16 to 20 Nov (staging); replay proof 21 Nov; in the production bring-up with step 7 (23 to 24 Nov), so Customer Zero starts with it. Cost: none (code only; Cloud Run concurrency is a setting).

### 2a. The bootstrap request (draft contract, agreed with the web lane 12 Nov 2026; frozen only when the owner approves Phase 1; nothing built)

`GET /v1/tenants/{tenant_id}/bootstrap` (any role that can read the workspace; `Cache-Control: no-store`) runs, server-side, the handlers of the reads the signed-in layout makes on EVERY page load, with the same authorization and the same data as the routes themselves (no new logic):

`{"parts": {"<name>": {"ok": true, "data": <the route's own body>} | {"ok": false, "error": {"code": "<closed word>", "status": <int>}}}, "generated_at": "<time>"}`

| Part | Route it replaces |
|---|---|
| `me` | `GET /v1/me` |
| `tenant` | `GET /v1/tenants/{id}` (role, name, plan) |
| `pack`, `modules` | `GET .../pack`, `GET .../modules` |
| `billing_access`, `billing_usage` | `GET .../billing/access`, `.../billing/usage` (the top-up banner) |
| `billing_entitlements` | `GET .../billing/entitlements` (plan tier; read only when the plan-tier flag is on) |
| `ai_usage` | `GET .../ai-usage` (Owner and Admin; others get `{"ok": false, "error": {"code": "forbidden", "status": 403}}` and the card is hidden) |
| `workspace_profile` | `GET .../workspace/profile` (logo) |
| `lead_finder_availability` | `GET .../lead-finder/availability` |
| `me_profile` | `GET .../me/profile` (voice chat language) |
| `today` | `GET .../today` (the "waiting" count in the menu) |
| `agents_status` | `GET .../agents/status` (is the assistant on) |

Not in it (page-specific, they stay normal routes): `ai-assistant` and `talk-training` (their own settings pages), calls, outbox messages, visits, nav-counts, calls/test-numbers.
A part that times out is `{"ok": false, "error": {"code": "busy", "status": 503}}` and does not fail the others. If the page-read limiter refuses the whole request it answers `503 {"error": {"code": "busy"}}` with `Retry-After: 2`. Each part is held in the 3-second read cache (1e), so ten tabs are one set of reads. A failed part always carries its HTTP status, so the layout can tell a 403 from a failure.

## 3. What ties a call to one instance today (the audit that decides the design)

In memory, in the instance that answered: the admission book between Plivo's answer request and the media socket (`BOOK`), the goals and questions of a placed call (`PENDING`), the structured answers handed to the dialer (`FINISHED`), the live-call registry (`LiveRegistry`: the line object, the audio of Take over and Whisper), the open media socket itself. Hang up could be done from any instance with the Plivo REST API (it needs only the call id); Take over and Whisper cannot (they move audio through the socket the instance holds). Cloud Run cannot address a given instance, and session affinity is a best-effort cookie that Plivo does not send.

## 4. More than one instance. Phase 2 and Phase 3

**Phase 2: split by job, before the first paying customer. Target: production by 8 Jan 2027.**
Two Cloud Run services from the same image:
* `sme-api-calls`: the Plivo answer, hangup, stream-status callbacks, the media socket, the call actions. Min 1, max 1 (as today). Plivo's URLs point at it directly (its `run.app` address never changes). The web reaches the call actions through the Cloudflare Worker by path.
* `sme-api`: every page route; min 1, max N (scales); CPU only while serving.
The pages then can never starve a call, and the page API can scale. Everything the page API shows about live calls is already in the database (`phone_calls`), so it needs no memory of the calls service.
Work: path map and the in-memory audit (above) checked route by route (18 to 23 Dec 2026); staging with both services and the Worker rule (by 6 Jan 2027); production 8 Jan 2027. A capacity measurement of one calls instance with the simulated stream (CPU per call; the setting `TELEPHONY_MAX_CONCURRENT` is then set from it, not guessed), 14 Dec 2026.
Estimated cost: about USD 8 to 12 a month for the second service (to be confirmed on the Google price list before approval); the calls service is the one already budgeted (about USD 44).

**Phase 3: more call capacity than one instance, only when needed. Decision gate: 15 Jan 2027.** Trigger: measured capacity is not enough for the real number of simultaneous calls, or the fourth paying customer.
Design chosen: **shard calls by workspace.** Each shard is one fixed single-instance calls service (`sme-api-calls-a`, `-b` ...). A workspace's Plivo number has its shard's address as Answer URL, and its outbound calls are placed by its shard, so the whole life of a call (answer, stream, Take over, Whisper, Hang up, hand-over of answers) stays inside ONE service and nothing in memory has to be shared. The database says which shard holds a workspace (a `call_shard` value, one migration), and the Worker sends a call action for a workspace to its shard. Adding capacity = adding a shard (about USD 44 a month each; one shard carries several small customers).
Rejected, with the reason:
* *Shared state (Redis or similar) with every instance able to hold a call*: the stream and the audio of Take over and Whisper cannot be shared cheaply; it would need an audio relay between instances. A managed Redis is also a new account and a new monthly cost (about USD 35 and up, to be verified) for something the shard design does without.
* *Session affinity or a header to pick the instance*: Cloud Run does not guarantee it, and Plivo does not carry it.
* *Route by call id to an instance*: Cloud Run has no per-instance address.
Date: design review 15 Jan 2027; build in about three weeks after a yes (by 12 Feb 2027), earlier if the trigger fires.

## 5. The production database: compute size and cost (Supabase price list read 12 Nov 2026: supabase.com/docs/guides/platform/compute-and-disk)

| Size | Monthly (list) | Memory | CPU | Max connections / pooler clients | Disk baseline (burst up to 11,800 IOPS) |
|---|---|---|---|---|---|
| **Nano** (staging today; free plan) | 0 | up to 0.5 GB | shared | 60 / 200 | 250 IOPS, 5 MB/s |
| **Micro** (the smallest on a paid plan) | about 10 | 1 GB | shared | 60 / 200 | 500 IOPS, 11 MB/s |
| **Small** | about 15 | 2 GB | shared | 90 / 400 | 1,000 IOPS, 22 MB/s |
| Medium | about 60 | 4 GB | shared | 120 / 600 | 2,000 IOPS, 39 MB/s |
| Large | about 110 | 8 GB | dedicated 2 vCPU | 160 / 800 | 3,600 IOPS, 79 MB/s |

**Production: no Nano** (a paid project cannot even start on Nano; the smallest is Micro). **Recommendation: Small for Customer Zero** (2 GB; about USD 15 a month at list price, billed hourly): staging uses 72 % of 0.5 GB while idle, so Micro's 1 GB would be a thin margin, and Small doubles the disk baseline that the 12 Nov spike suggests we ran into (not proven until the error messages are read). That is about USD 5 a month more than Micro. The approved cost list (11 Nov) already counted "a small instance roughly covered by the Pro plan's included credit"; the exact credit and so the net cost are to be confirmed on the Supabase pricing page before the project is created (owner step 1, 16 Nov), so the baseline of about USD 75 to 100 a month is expected to stay, not proven. Upgrade path: Medium (about USD 60) only if the dashboard shows CPU or disk-IO exhaustion after Phase 1; a change of size has a short downtime (usually under 2 minutes). Reduction of the load comes first: Phase 1 is what removes the cause, a bigger database only hides it.

## 6. Decisions for the owner

1. Start Phase 1 on staging on 16 Nov (no cost, code only). Yes or no.
2. Phase 2 (a second Cloud Run service, estimated USD 8 to 12 a month): approve the plan and the date 8 Jan 2027, or move it.
3. Phase 3 stays a decision gate on 15 Jan 2027; nothing is approved now.
4. Run the log query in section 1 in the Supabase dashboard and send me the distinct Postgres error messages (the cause of the 19 errors is still open).
5. Production compute: Small (about USD 15 a month at list price) as recommended, or Micro (about USD 10).
