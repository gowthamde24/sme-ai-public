# The Stack19 developer API: the contract (C1 -> C2 and developers; job developer-api)

Status: **published 5 Nov 2026, contract first; TEST MODE only.** The routes land in parts (D1 keys and leads, D2 calls, campaigns, usage, /me and the activity log (**built, 25 Nov 2026**), D3 webhooks, D4 the OpenAPI check (**built with D2**)). Job
`~/Desktop/stack19-jobs/job-developer-api.md`, ADR 0121. Live mode (`sk_live_`) does not exist yet: it waits for the lawyer's review, a verified business, and the owner's approval of live calls.

## 0. In one line
A developer POSTs a lead with a workspace's API key. Stack19 handles it like any lead, and the outcome comes back by a signed webhook. In **test mode**, nothing is real:
- the lead goes into the workspace's **sandbox**, never into its leads, follow-ups or Lead Desk;
- the call is **simulated**;
- nothing is sent to anyone.

## 1. Two kinds of route

| | Base | Who | Auth |
|---|---|---|---|
| **Settings → Developers** (C2's screen) | `/v1/tenants/{tenant_id}/developer/...` | Owner, Admin (signed in) | the person's session, as every screen |
| **The developer API** | `/api/v1/...` | a program | `Authorization: Bearer sk_test_...` (the workspace comes from the key) |

Errors have the one shape `{error:{code,message,retry_after,request_id}}`. JSON is snake_case. Times are ISO 8601 UTC.

## 2. Settings → Developers (Owner, Admin)

### Keys
- `GET /developer/keys` -> `{items: [{id, name, mode: "test", prefix: "sk_test_ab12", last4, scopes: [...], created_at, created_by, last_used_at | null, revoked_at | null, ip_allow: [] }]}`
- `POST /developer/keys` `{name, scopes: [...], ip_allow?: ["203.0.113.4", "198.51.100.0/24"]}` -> `201 {key: {...as above}, secret: "sk_test_<40 chars>"}`.
  - **`secret` is shown this once.** The database keeps a hash, the prefix and the last four, never the key.
  - `mode` is always `test` for now: `{mode: "live"}` -> `422 live_not_available`.
  - At most 10 active keys per workspace -> `409 too_many_keys`.
- `POST /developer/keys/{key_id}/rotate` -> `{key, secret}`. A new secret; the old one stops working at once.
- `POST /developer/keys/{key_id}/revoke` -> `{key}` (`revoked_at` set). It can't be undone; make a new key.
- Scopes: `leads:write`, `leads:read`, `calls:write`, `calls:read`, `campaigns:write`, `campaigns:read`, `webhooks`, `usage:read`. At least one. (`calls:write` and `campaigns:read` are new in D2: keys made before have only what they had; make a new key.) `GET /me` needs no scope.

### Webhooks (D3)
- `GET /developer/webhooks` -> `{items: [{id, url, events: [...], active, created_at, secret_last4}]}`
- `POST /developer/webhooks` `{url, events}` -> `201 {webhook, secret: "whsec_<32 chars>"}`. The secret is shown once.
  - `url` must be `https://`, a public host (no IP literal, no localhost or private range), at most 500 characters.
  - At most 5 endpoints.
- `PATCH /developer/webhooks/{id}` `{events?, active?}`; `POST /developer/webhooks/{id}/rotate-secret` -> `{webhook, secret}`; `DELETE /developer/webhooks/{id}`.
- `POST /developer/webhooks/{id}/test` -> `202 {delivery_id}`: a `test.ping` event, signed like the rest.
- `GET /developer/webhooks/{id}/deliveries?before=` -> `{items: [{id, event, event_id, status: "pending" | "delivered" | "failed" | "retrying", attempts, last_status_code | null, last_error: null | "timeout" | "refused" | "tls" | "status", next_attempt_at | null, created_at}], next_before}`. The last 30 days. The bodies are not kept.
- Events: `lead.created`, `lead.updated`, `call.completed`, `visit.booked`, `quote.approved`, `test.ping`.

### Usage and API activity
- `GET /developer/usage` -> `{mode: "test", today: {requests, leads, calls_simulated, campaigns, errors}, month: {...same}, limits: {requests_per_minute: 60, calls_per_minute: 10, campaigns_per_minute: 5, concurrent_calls: 10}}`. `errors` = requests answered 400 or above (from the activity log).
- `GET /developer/activity?key_id=&limit=&before=` -> `{items: [{id, key_id, key_name, method, route, status, latency_ms, at}], next_before}` (Owner, Admin; newest first; the last 30 days; at most 100 a page; `key_id` narrows to one key). `route` is the route template (`/api/v1/leads/{lead_id}`), never the real path. **No bodies, no query strings, no addresses, no key are kept.** An unknown key leaves no row (there is no workspace to file it under).

## 3. The developer API (`/api/v1`, a key)

Every request:
- `Authorization: Bearer sk_test_...`. A missing, unknown, rotated or revoked key -> `401 invalid_key`.
- A key without the scope -> `403 missing_scope`. An IP outside the key's allow-list -> `403 ip_not_allowed`.
- **Rate limit:** 60 requests a minute per key -> `429 rate_limited` with `Retry-After` (seconds). Every answer has `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
- **Test mode:** every answer has `Stack19-Mode: test` and every object has `"mode": "test"`.

### POST /api/v1/leads (`leads:write`)
Header **`Idempotency-Key`** (1 to 100 characters) is required -> `400 idempotency_key_required`.
- The same key with the same body within 24 h returns the first answer (`200`, with `Idempotent-Replayed: true`).
- The same key with a different body -> `409 idempotency_conflict`.
```json
{ "name": "Ravi Kumar", "phone": "+919800000000", "email": null, "source": "website", "language": "te" | "en" | "hi" | "kn" | "ta" | "ml" | "mr" | null,
  "notes": "Wants 40 sarees for a wedding", "custom_fields": { "budget": "50000" }, "consent": { "given": true, "text": "I agree to be called...", "at": "iso" } }
```
- `name` is 1 to 120 characters. One of `phone` (E.164, Indian mobile in test mode) or `email` is required.
- `custom_fields`: at most 20 string pairs; a key is 1 to 40 characters, a value at most 500.
- `notes`: at most 2,000 characters. `source`: at most 40 characters.
- **`consent.given` must be `true`**, or the lead is refused -> `422 consent_required`. This is the app's own rule: we don't call or message without consent.
- -> `201 {lead}` (below). The same phone in the workspace's sandbox -> the existing lead, `200`, `"duplicate": true` (the app's dedupe rule).
- **What happens next (test mode):**
  - The app's call-first rule is applied to the sandbox lead, with the workspace's real calling hours.
  - Inside the hours, a **simulated** call is queued at once (`next_step: "call"`).
  - Outside them, it is queued for the next opening (`next_step: "call_at"`, `next_step_at`).
  - A number on the simulated Do-Not-Disturb list (any number ending in `0000`) is not called (`next_step: "none"`, `blocked: "dnd"`).
  - The simulated call finishes about 30 seconds later and fires `call.completed`.
  - **The test outcome is picked by the phone number's last digit**, so a developer can test every branch:

    | Last digit | Outcome |
    |---|---|
    | 1 | `interested` |
    | 2 | `not_interested` |
    | 3 | `callback` (`next_step: "follow_up"`) |
    | 4 | `no_answer` |
    | 5 | `visit_booked` (it also fires `visit.booked`) |
    | any other | `interested` |

### The lead
```json
{ "id": "uuid", "mode": "test", "name": "Ravi Kumar", "phone": "+919800000000", "email": null, "source": "website", "language": "te", "notes": "...", "custom_fields": {},
  "status": "new" | "contacted" | "interested" | "not_interested" | "visit_booked" | "won" | "lost", "outcome": null | "interested" | "not_interested" | "callback" | "no_answer" | "visit_booked",
  "next_step": "call" | "call_at" | "follow_up" | "none", "next_step_at": null | "iso", "blocked": null | "dnd" | "calling_hours", "duplicate": false,
  "created_at": "iso", "updated_at": "iso", "calls": ["uuid"] }
```

### GET /api/v1/leads/{id} and GET /api/v1/leads?updated_since=&limit=&after= (`leads:read`)
- The list is oldest change first, at most 100 a page; `{items, next_after}`.
- Another workspace's id, or one that doesn't exist -> `404`.

### GET /api/v1/me (any live key)
`{mode: "test", key: {id, name, mode, prefix, last4, scopes, ip_allow, created_at, rotated_at, last_used_at}, workspace: {id, name}}`. Never the secret or its hash.

### POST /api/v1/calls (`calls:write`)
`{lead_id, dry_run?: false}` places a **simulated** call to a lead you posted. Nobody is dialled, in test mode, whatever the gates say. Header **`Idempotency-Key`** is required (same rules as POST /leads: same key + same body -> `200` with `Idempotent-Replayed: true` and the first call; another body -> `409 idempotency_conflict`); **a `dry_run` needs none and stores nothing.**
- **The gates are the app's own, in this order:**

  | Gate | Test mode | Refusal |
  |---|---|---|
  | `sandbox` | the lead is on this workspace's sandbox list (another workspace's lead is not) | `404 not_found` |
  | `number` | the lead has a phone number | `422 lead_has_no_number` |
  | `consent` | the lead's consent is on file | `422 consent_required` |
  | `dnd` | not on the Do-Not-Disturb list (any number ending `0000`) | `422 number_on_dnd` |
  | `wallet` | the wallet covers a call (simulated: **every number ending `9999` has an empty wallet**) | `402 wallet_empty` |
  | `capacity` | at most 10 open calls in the workspace and 10 calls a minute per key | `429 too_many_calls` / `429 rate_limited`, with `Retry-After` (checked after the idempotency replay, so a retry still gets its call) |
  | `calling_hours` | Monday to Saturday, 10:00 to 19:00 India time | never a refusal: outside the hours the call is queued for the next opening (`status: "queued"`, `scheduled_for`) |
- `dry_run: true` -> `200 {dry_run: true, mode, lead_id, would_place, blocked_by: null | "<code>", starts: "now" | "at_opening", starts_at, gates: [{gate, ok, code}]}`. Every gate is evaluated and listed, none is skipped at the first failure. The lead must still exist (`404`).
- A real call -> `201` the call (below). **The simulated call runs 30 seconds from `scheduled_for`** and then completes with the outcome of the number's last digit (the table in POST /leads); the lead's `status`, `outcome` and `next_step` follow when the call completes, and the lead lists the call in `calls`.
- Body errors -> `422 invalid_call` (`fields`). Only `lead_id` (a uuid string) and `dry_run` (a real boolean) are allowed.

### GET /api/v1/calls/{id} and GET /api/v1/calls?lead_id=&limit=&after= (`calls:read`)
```json
{ "id": "uuid", "mode": "test", "lead_id": "uuid", "status": "queued" | "in_progress" | "completed" | "failed", "outcome": null | "interested" | "not_interested" | "callback" | "no_answer" | "visit_booked",
  "scheduled_for": "iso", "started_at": null | "iso", "ended_at": null | "iso", "duration_seconds": null | 30, "summary": null | "Simulated call: ...", "transcript": null,
  "cost": { "minutes": 1, "paise": 0 }, "created_at": "iso" }
```
- The list is oldest first, at most 100 a page; `{items, next_after}`. Another workspace's id -> `404`.
- `transcript` is always null in test mode (a simulated call has no recording). A test call costs nothing (`paise: 0`; `minutes` is the billable minute it would take: 0 for `no_answer`, else 1).

### POST /api/v1/campaigns, GET /api/v1/campaigns, GET /api/v1/campaigns/{id}
A campaign is **a list of consented contacts and a job**.
- `POST /campaigns` (`campaigns:write`, `Idempotency-Key` required) `{name, language?, job: {name, goal?}, contacts: [<lead body>, ... 1 to 500]}` -> `201 {campaign, refused: [{index, code}]}`.
  - `job.name` is 1 to 60 characters, `job.goal` at most 300: what the calls are for.
  - Each contact is checked like POST /leads, **on its own** (one bad contact does not sink the rest). A contact is refused with `invalid_lead`, `lead_has_no_number`, `consent_required` or `number_on_dnd` (listed in `refused` by its `index`). The others become sandbox leads (the same number in the workspace's sandbox is the existing lead and counts as a `duplicate`).
  - No usable contact at all -> `422 no_usable_contacts` (with `refused`). A bad shape -> `422 invalid_campaign` (`fields`).
  - Same key + same body -> `200`, `Idempotent-Replayed: true`, the same campaign. At most 5 campaigns a minute per key (`429 rate_limited`).
  - `campaign` = `{id, mode, name, language, job: {name, goal}, status: "draft", contacts, added, duplicates, created_at, lead_ids}`.
- `GET /campaigns/{id}` (`campaigns:read`) the campaign with its `lead_ids`; `GET /campaigns?limit=&after=` -> `{items, next_after}` (oldest first, without `lead_ids`).
- A campaign is **not started by the API**: the Owner starts it in the app (the app's own approval rule). (This replaces the first draft's separate `POST /campaigns/{id}/contacts`.)

### GET /api/v1/activity?limit=&before= (`usage:read`)
The workspace's API requests of the last 30 days, newest first: the same items as Settings -> Developers -> activity. `{items, next_before}`.

### GET /api/v1/usage (`usage:read`)
The same object as `GET /developer/usage`.

### Rate limits (per key)
- 60 requests a minute on everything -> `429 rate_limited` with `Retry-After` and `X-RateLimit-*` headers; plus **10 calls a minute**, **10 open calls** in the workspace and **5 campaigns a minute**.

### The generated documents (for developers and the web team)
- **`docs/contracts/developer-api.openapi.json`** (OpenAPI 3.1) and **`docs/contracts/developer-api.postman_collection.json`** (Postman 2.1; variables `base_url` and `api_key`, never a key) are **generated from the code** by `scripts/developer_openapi.py` (`make contracts` writes them; a test fails when they are stale). The /developers page links them as downloads. Postman collection import: Postman -> Import -> the file; set `api_key` to a test key.
- New error codes (all in `docs/contracts/error-codes.md`): `invalid_call`, `invalid_campaign`, `no_usable_contacts`, `lead_has_no_number`, `number_on_dnd`, `wallet_empty`, `too_many_calls`. The web maps them to plain sentences.
- The activity log, calls and campaigns live in tables outside the public schema; no client can read them; they are kept 30 days.

## 4. Webhooks: signing and delivery (D3)
- `POST` to the endpoint, JSON body `{id: "evt_...", type: "call.completed", mode: "test", created_at, data: {...the object}}`.
- Headers:
  - `Stack19-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`, where the HMAC uses the endpoint's secret over `"<t>.<raw body>"`;
  - `Stack19-Event-Id`;
  - `Stack19-Mode: test`.
- **Checking it:** recompute the HMAC; compare in constant time; refuse a `t` older than 5 minutes. A Python and a Node sample go on the /developers page.
- **Delivery:**
  - a 2xx within 10 seconds is delivered;
  - anything else is retried 6 times, after 1, 5, 30 minutes, then 2, 6 and 12 hours. Then `failed`.
  - The same `id` can arrive twice: de-duplicate on it.
- `test.ping` data: `{message: "This is a test event from Stack19."}`.

## 5. Never
- A test key never touches the workspace's real leads, calls, messages or money. **No real call or message**, ever, in test mode.
- The key and the webhook secret are never stored in clear, logged, put in an error or shown again.
- **No guard is bypassed:**
  - every write runs through a database function that checks the key's hash, its scope and that it is not revoked;
  - the workspace's rules apply: consent, Do-Not-Disturb, calling hours, the plan;
  - every write is in the audit log as "by API key <name>".
- `sk_live_` keys don't exist yet.
