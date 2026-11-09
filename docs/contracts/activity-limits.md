# Everything it did, and Limits: the API contract (C1 -> C2; owner job 9 Nov 2026)

Status: **built and tested** (migration `20261231410000_al_activity_and_limits.sql`, pgTAP 172 with 72 checks, `tests/test_al_activity_limits.py` with 31). Base `/v1/tenants/{tenant_id}`. Errors have the one shape `{error:{code,message,retry_after,request_id,...}}`; a field error also carries `field`. Times are ISO 8601 with offset. JSON is snake_case.

## 1. What is real (C2: read this first)
| Part | State |
|---|---|
| `GET /activity-log`: calls, WhatsApp messages and the assistant's changes in one newest-first list, paged | **real** (three real tables) |
| the `undo` state of an item | **real, and only assistant changes can have one.** A call and a message are always `none`: a call is over and a sent message cannot be unsent. Do not show an Undo button unless `undo.state == "available"`. |
| cancelling a message that is waiting (not yet approved) | **not an undo**: the item has `waiting: true`; Approve / Reject is the existing outbox route |
| `GET /limits`: per kind of action `alone` or `needs_ok`, the numbers, the quiet hours, the off switch | **real**, read from the settings the assistant actually obeys (outbox settings, AI assistant settings, call settings, the workspace's agent switch) |
| `PUT /limits` | **real, tighten-only**: it can switch things off, stop things, lower numbers and shorten hours. Anything that would loosen is refused (`422 would_loosen`) and nothing changes. Allowing more stays in the existing settings pages (with their second factor). |
| a toggle for a kind with `locked: true` | **do not show a toggle**: quotes, price changes, payments, deleting data, and any message about money, a promise or a complaint always wait for the Owner. Show them as "always asks you". |

## 2. `GET /activity-log?limit=&cursor=&kind=` (Owner, Admin)
`limit` 1..100 (default 50). `kind` is optional: `call`, `message` or `action`. `cursor` is the `next_cursor` of the previous page (opaque; send it back unchanged). A Sales or Viewer member gets 403.
```json
{ "items": [ { "key": "action:<uuid>", "kind": "action", "id": "<uuid>", "at": "iso", "who": "assistant",
               "tool": "leads.import_rows", "summary": "Added 34 leads from your file", "status": "done" | "failed" | "undone",
               "requested_by": "<user uuid>", "decided_by": "<user uuid>", "plan_id": "<uuid>", "waiting": false,
               "undo": { "state": "available" | "done" | "expired" | "none", "until": "iso" | null }, "href": null },
             { "key": "message:<uuid>", "kind": "message", "id": "<uuid>", "at": "iso", "who": "assistant" | "owner" | "system",
               "channel": "whatsapp", "category": "reply_to_inbound" | "info" | "visit" | "followup" | "order_status" | "other",
               "status": "queued" | "needs_approval" | "sent" | "blocked" | "failed", "reason": "<closed word>", "flags": ["money"],
               "contact_id": "<uuid>", "contact_name": "…", "lead_id": "<uuid>", "scheduled_for": "iso" | null,
               "waiting": true, "undo": { "state": "none", "until": null }, "href": "/app/tenants/<t>/leads/<lead>" },
             { "key": "call:<uuid>", "kind": "call", "id": "<uuid>", "at": "iso", "who": "assistant", "direction": "inbound" | "outbound",
               "state": "completed" | "in_progress" | "...", "live": false, "outcome": "…", "duration_s": 84, "summary": "…",
               "contact_id": "<uuid>", "contact_name": "…", "lead_id": "<uuid>", "sandbox": true, "simulated": false,
               "waiting": false, "undo": { "state": "none", "until": null }, "href": "/app/tenants/<t>/office/live?call=<call>" } ],
  "next_cursor": "opaque" | null }
```
- `key` is unique across the three kinds; use it as the React key. Newest first by `at`.
- **No message text is returned.** A message item says what it is (category, status, reason), who it went to and where to read it (`href`).
- `waiting: true` means something waits for the Owner: a message in `needs_approval`, or a call that asked for a person and has not been handled.
- `who`: `assistant` for calls and assistant changes; for a message the outbox source (`assistant`, `owner`, `system`).
- `status: "undone"` and `undo.state: "done"` are the same fact. `undo.state: "available"` with `until` means it can be undone until then; the undo itself is the existing assistant-work undo route for that action (`POST /assistant/actions/{id}/undo`).
- `sandbox: true` calls are practice / test-line calls: show a small "practice" mark.
- Cursor errors: `422 invalid_cursor`.

## 3. `GET /limits` (Owner, Admin)
```json
{ "workspace": { "on": true, "field": "workspace_on", "platform_on": true },
  "assistant_saved": true,
  "kinds": [ { "kind": "message_routine", "field": "messages_alone", "mode": "alone" | "needs_ok", "locked": false, "locked_reason": null, "can_tighten": true, "source": "outbox_settings" },
             { "kind": "message_other", "field": null, "mode": "needs_ok", "locked": true, "locked_reason": "always_asks", "can_tighten": false, "source": "policy" },
             { "kind": "message_sensitive", "...": "always asks (money, a promise, a complaint)" },
             { "kind": "call_prices" | "call_visits" | "call_media" | "call_dues", "field": "<same word>", "mode": "alone" | "needs_ok", "locked": false, "can_tighten": true, "source": "assistant_settings" },
             { "kind": "quote_send" | "price_change" | "payment" | "delete_data", "field": null, "mode": "needs_ok", "locked": true, "locked_reason": "always_asks", "can_tighten": false, "source": "policy" } ],
  "caps": [ { "key": "messages_per_customer_per_day", "field": "message_daily_limit", "value": 3, "unit": "messages", "can_tighten": true },
            { "key": "call_discount_percent", "field": "call_discount_percent", "value": 10, "unit": "percent", "can_tighten": true },
            { "key": "call_big_order_paise", "field": "call_big_order_paise", "value": null, "unit": "paise", "can_tighten": true } ],
  "quiet_hours": { "messages": { "start_hour": 21, "end_hour": 9, "field": "message_quiet_hours", "source": "outbox_settings" },
                   "calls": { "days": [1,2,3,4,5,6], "from_minute": 540, "to_minute": 1140, "holidays": [], "source": "assistant" | "call_settings" | "default", "field": "call_hours", "can_tighten": true } } }
```
- `mode: "alone"` = the assistant does it without asking; `needs_ok` = it waits for the Owner (for the call kinds: it hands the matter to a person).
- `message_routine` covers replies, info, visit, follow-up and order-status messages: `alone` only while **automatic sending** is on (off by default). Every other message waits.
- The call kinds appear only after the AI assistant's settings were saved once (`assistant_saved: false` otherwise).
- `call_big_order_paise: null` means no limit (the assistant never hands over for the size of an order). Amounts are in paise.
- `quiet_hours.calls.source` says whose hours are in force: `call_settings` (their own hours), `assistant` (the AI assistant's) or `default`. `can_tighten` is true only for `assistant`: if the call settings hold the hours, change them there.
- `workspace.on` is the workspace's own agent switch (all helpers); `platform_on: false` means the platform has agents off for everyone (show it as "off for everyone", not as the Owner's choice).
- `field` is the key to use in `PUT /limits`; `null` means there is nothing to change (locked).

## 4. `PUT /limits` (Owner; no second factor, because it can only make things safer)
Body: any of these, nothing else (an unknown or wrongly shaped field is `422`), at least one:
```json
{ "workspace_on": false,
  "messages_alone": false,
  "message_daily_limit": 2,
  "message_quiet_hours": { "start_hour": 20, "end_hour": 10 },
  "call_prices": false, "call_visits": false, "call_media": false, "call_dues": false,
  "call_discount_percent": 5,
  "call_big_order_paise": 1000000,
  "call_hours": { "days": [1,2,3], "from_minute": 600, "to_minute": 1080 } }
```
- Only the tighter direction is accepted: a switch or permission can only be `false`; `message_daily_limit` 1..20 and not above the current; `call_discount_percent` 0..50 and not above the current; `call_big_order_paise` not above the current (any value where there was none); quiet hours may start earlier (19..23) and end later (7..10); call days must be a subset, `from_minute` not earlier and `to_minute` not later (multiples of 15, 540..1260, from < to). A value equal to today's is accepted and changes nothing.
- **All or nothing.** If one item cannot be applied, none is, and nothing changes.
- Answer `200`: the new `GET /limits` body. Errors:
  - `422 would_loosen` (with `field`): "Limits can only be made tighter here."
  - `422 invalid`, `422 unknown_field` (with `field`)
  - `409 not_saved`: the AI assistant's settings were never saved, so there is nothing to tighten for the call kinds.
  - `409 limits_elsewhere`: `call_hours` while the call settings hold the hours.
  - `403` for anyone but the Owner.
- Every change is audited by the settings tables' own audit trail (who and when). It is not an assistant action and has no undo: to allow more again the Owner uses the settings pages.

## 5. Never
- No toggle is shown for a locked kind, and no "allow" is offered here.
- The page shows what the database says; it never computes a mode itself.
- Nothing here sends a message, places a call or changes a price.
