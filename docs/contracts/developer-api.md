# The Stack19 developer API: the contract (C1 -> C2 and developers; job developer-api)

Status: **published 5 Nov 2026, contract first; TEST MODE only.** The routes land in parts (D1 keys and leads, D2 calls and usage, D3 webhooks, D4 the OpenAPI check). Job
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
- Scopes: `leads:write`, `leads:read`, `calls:read`, `campaigns:write`, `webhooks`, `usage:read`. At least one.

### Webhooks (D3)
- `GET /developer/webhooks` -> `{items: [{id, url, events: [...], active, created_at, secret_last4}]}`
- `POST /developer/webhooks` `{url, events}` -> `201 {webhook, secret: "whsec_<32 chars>"}`. The secret is shown once.
  - `url` must be `https://`, a public host (no IP literal, no localhost or private range), at most 500 characters.
  - At most 5 endpoints.
- `PATCH /developer/webhooks/{id}` `{events?, active?}`; `POST /developer/webhooks/{id}/rotate-secret` -> `{webhook, secret}`; `DELETE /developer/webhooks/{id}`.
- `POST /developer/webhooks/{id}/test` -> `202 {delivery_id}`: a `test.ping` event, signed like the rest.
- `GET /developer/webhooks/{id}/deliveries?before=` -> `{items: [{id, event, event_id, status: "pending" | "delivered" | "failed" | "retrying", attempts, last_status_code | null, last_error: null | "timeout" | "refused" | "tls" | "status", next_attempt_at | null, created_at}], next_before}`. The last 30 days. The bodies are not kept.
- Events: `lead.created`, `lead.updated`, `call.completed`, `visit.booked`, `quote.approved`, `test.ping`.

### Usage
- `GET /developer/usage` -> `{mode: "test", today: {requests, leads, calls_simulated}, month: {requests, leads, calls_simulated}, limits: {requests_per_minute: 60, concurrent_calls: 10}}`.

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

### GET /api/v1/calls/{id} (`calls:read`) (D2)
```json
{ "id": "uuid", "mode": "test", "lead_id": "uuid", "status": "queued" | "in_progress" | "completed" | "failed", "outcome": null | "interested" | "not_interested" | "callback" | "no_answer" | "visit_booked",
  "started_at": null | "iso", "ended_at": null | "iso", "duration_seconds": null | 42, "summary": null | "...", "transcript": null | [ { "speaker": "assistant" | "caller", "text": "..." } ],
  "cost": { "minutes": 1, "paise": 0 } }
```
- `transcript` is given only when the workspace allows it (Settings -> Calls -> "share transcripts with the API"); otherwise null.
- A test call costs nothing (`paise: 0`).

### POST /api/v1/campaigns, POST /api/v1/campaigns/{id}/contacts (`campaigns:write`) (D2)
- `POST /campaigns` `{name, language?}` -> `201 {campaign: {id, mode, name, status: "draft", contacts: 0}}`.
- `POST /campaigns/{id}/contacts` (`Idempotency-Key` required) `{contacts: [<lead body>, ... at most 500]}` -> `{added, duplicates, refused: [{index, code}]}`.
  - The same rules apply to each contact: consent, dedupe and DND.
- A campaign is **not started by the API** in v1: the Owner starts it in the app (the app's own approval rule).

### GET /api/v1/usage (`usage:read`)
The same object as `GET /developer/usage`.

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
