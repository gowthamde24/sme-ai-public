# Outbound webhooks: the contract (C1 -> C2 and developers; connectors plan C1 item 2)

Status: **built 25 Nov 2026, off by default (`WEBHOOKS_OUT`, the kill switch).** Off: every route below answers `404` and nothing is sent. This note extends `developer-api.md` (sections 2 and 4, "Webhooks (D3)"), which it replaces for webhooks: the events are the five below, the retries are 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, and the secret can be rotated. Production stays off until the owner's gate.

## 1. Who and where
- Settings -> Developers -> Webhooks: **Owner and Admin** only (everyone else `403`). Changes (create, change, rotate, delete) need the second factor (`403 mfa_required` without it, as for API keys).
- Base: `/v1/tenants/{tenant_id}/developer/webhooks`. Errors have the one shape `{error:{code,message,retry_after,request_id,...}}`.
- At most **5** endpoints per workspace (`409 too_many_webhooks`).
- All write routes are screen only for the assistant (an address decides where a business's data goes; the secret is shown once).

## 2. Routes
| | |
|---|---|
| `GET /developer/webhooks` | `{items: [Endpoint]}` |
| `GET /developer/webhooks/events` | `{items: [{event, description}]}`: the five events in plain words, for the checkboxes |
| `POST /developer/webhooks` `{url, events: [...], send_transcript?: false}` | `201 {webhook: Endpoint, secret: "whsec_<32 characters>"}` |
| `PATCH /developer/webhooks/{id}` `{url?, events?, active?, send_transcript?}` | `{webhook}`. Switching `active` on again clears "failing". |
| `POST /developer/webhooks/{id}/rotate-secret` | `{webhook, secret}`: a new secret; the old one stops at once |
| `DELETE /developer/webhooks/{id}` | `{deleted: true}`; its log and its secret go too |
| `POST /developer/webhooks/{id}/test` | `202 {delivery_id}`: a `test.ping` the worker sends within a minute. Never retried. |
| `GET /developer/webhooks/{id}/deliveries?before=&limit=` | `{items: [Delivery], next_before}` (30 days, newest first, `limit` 1 to 100) |

```json
Endpoint = { "id": "uuid", "url": "https://...", "events": ["call.completed", ...], "send_transcript": false, "active": true,
             "secret_last4": "k3Fq", "secret_version": 1, "created_at": "iso", "created_by": "uuid", "rotated_at": null | "iso",
             "health": { "status": "ok" | "failing", "failing_since": null | "iso", "dead_letters_7d": 0, "last_delivered_at": null | "iso" } }
Delivery = { "id": "uuid", "endpoint_id": "uuid", "event": "lead.created", "event_id": "uuid", "status": "pending" | "retrying" | "delivered" | "dead",
             "attempts": 0, "last_status_code": null | 503, "last_error": null | "timeout" | "refused" | "tls" | "status" | "redirect" | "blocked" | "dns" | "too_large" | "no_secret",
             "next_attempt_at": null | "iso", "created_at": "iso", "delivered_at": null | "iso" }
```
- **The secret is shown once** (`POST` and `rotate-secret`). The database keeps only its version and last four characters; the secret itself lives in Secret Manager. It is never in a list, a log or an error.
- The log has **no body and no address**: status, attempts, the response code, and a closed word for what went wrong.
- Show **`health.status = "failing"`** as a Needs-you style banner on the Webhooks tab: "Some events could not be delivered to <address> after every retry." (A delivery is `dead` after its sixth failed attempt; the endpoint stays `failing` until one delivery succeeds. Test events never change it.) The staff console also gets an alert (a count, never an address).
- Refusals: `422 webhook_url_invalid` with `reason` = `length | scheme | userinfo | host | port | private | dns` (plain sentences are in `message`); `409 too_many_webhooks`; `503 webhooks_out_unavailable` (the secret store is down; `retry_after` 30); `404` for an unknown endpoint, a switched-off feature.

## 3. The address (SSRF guard)
`https://` only; a real site name (no IP number, no `localhost`, no `.local` / `.internal`, no `user:password@`); port 443 or 1024 and up; at most 500 characters. The name is looked up when the endpoint is saved **and on every delivery**: every address it points at must be public (never private, loopback, link-local such as the cloud metadata address, carrier-grade NAT, multicast, or an IPv6 form that wraps one). The delivery connects to the checked address (the certificate is still checked against the name), follows **no redirect** (a 3xx is a failure), waits 5 seconds to connect and 10 to answer, sends at most 256 KB, and never reads the answer's body.

## 4. What is sent
`POST <url>`, `Content-Type: application/json`, body:
```json
{ "id": "evt_<32 hex>", "type": "call.completed", "created_at": "iso", "data": { ... } }
```
Headers: `Stack19-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`, `Stack19-Event-Id` (same as `id`), `Stack19-Event`, `Stack19-Delivery` (this delivery's id), `User-Agent: Stack19-Webhooks/1`.

**Signing:** the HMAC-SHA256 of `"<t>.<raw body>"` with the endpoint's secret (the whole `whsec_...` string as the key), hex. The receiver recomputes it, compares in constant time and refuses a `t` more than 5 minutes off. `t` is fresh on every attempt; `id` is the same on every attempt: **de-duplicate on `id`**. Python:
```python
import hmac, hashlib, time
def ok(secret: str, header: str, raw: bytes) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t, v1 = parts["t"], parts["v1"]
    mine = hmac.new(secret.encode(), t.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return abs(time.time() - int(t)) <= 300 and hmac.compare_digest(mine, v1)
```
Node: `crypto.createHmac("sha256", secret).update(`${t}.`).update(raw).digest("hex")`, then `crypto.timingSafeEqual`.

**Delivered** = any `2xx`. Anything else (or a timeout) is retried after **1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours**; the sixth failure is final (`dead`, a dead letter). A `test.ping` is tried once.

### Events (`data`)
Every event is queued only for an **active** endpoint that asked for it. The body is built when it is sent, from the live data, and carries **the lead's own contact only** (name, number, e-mail): never another person's number. A missed caller who is not a contact is only `caller_last4`.

- **`call.completed`**: `{call: {id, direction, state, outcome, category, summary, language, purpose, duration_seconds, cost_paise, captured: {...}, callback_at, answered_at, ended_at, simulated, sandbox, transcript}, lead: {lead_id, contact_id, name, phone, email} | null}`. `outcome`: positive, negative, unclear, no_answer, failed. `category`: interested, visit_booked, order_likely, not_interested, wrong_number, too_costly, call_back_later, already_bought, do_not_call. `transcript` is `null` unless the endpoint's **`send_transcript`** is on (the Owner's opt-in, off by default); a transcript that would make the body over 256 KB is dropped and `data.truncated = ["transcript"]` says so. `simulated` / `sandbox` calls are sent too: a receiver can ignore them.
- **`call.missed`**: an outgoing call nobody answered (state `no_answer`, `busy` or `voicemail`, same `call` object) or an incoming call that was missed (`{call: {id, direction: "inbound", state: "missed", received_at, caller_last4, replied}, lead: ... | null}`).
- **`lead.created`**, **`lead.updated`** (status, source, owner, contact or archived changed; not every edit): `{lead: {id, status, source, created_at, updated_at, archived, is_test, contact: {lead_id, contact_id, name, phone, email} | null}}`.
- **`job.outcome`**: a call's or follow-up's outcome was recorded or corrected: `{outcome: {id, kind, source_id, outcome, category, reason, occurred_at, corrected}, lead: ... | null}`.
- **`test.ping`** (the test button only): `{message: "This is a test event from Stack19."}`.
- What the event is about may be gone by the time it is sent (erased): then nothing is sent and the delivery closes quietly.

## 5. Settings and safety
- `WEBHOOKS_OUT=off` (unset) by default in production and staging (`deploy/settings/*/api.env`); `on` in the API **and** the worker, with `WORKSPACE_SECRETS=gcp` (the signing secrets are Secret Manager secrets `sme-ws-<workspace>-whsec-<endpoint>`). Without the secret store: routes `503`, worker sends nothing.
- No secret, address, body or personal data in any log. The delivery log is deleted after 30 days. Every change is in the audit log.
- Nothing here calls, messages or changes a customer: it only tells the business's own system what already happened.
