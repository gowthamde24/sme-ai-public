# Admin console: the API contract (C2 -> C1) **DRAFT**, 13 Nov 2026

Status: **DRAFT, written by C2 for C1 to review. Nothing is built.** The owner's brief (12 Nov): a staff-only console, later at `admin.stack19.com`, behind the flag `ADMIN_CONSOLE`, **staging only, mock data first**. Version 1 has four screens: **support inbox, customer lookup (read-only), call debugging, privacy requests with deadlines**. Rules from the owner:

1. **Staff only, with two-step sign-in (2FA).** No customer can ever reach it; a customer token is refused with 403 `not_staff`.
2. **Every view of customer data is audited, with a reason.** The reason is typed by the staff member (or chosen from a short list) BEFORE the data is shown. No reason, no data.
3. **No transcript by default** in call debugging. Metadata only (times, outcome, cost, error codes, latency). A transcript needs its own reason and is audited as such.
4. **"View as customer" only with the customer's consent, and read-only.** No write is possible in that mode.
5. **Money and deletion need a second confirmation** (a second staff member, or the same one re-entering the second factor, C1 decides; the contract names it `second_confirm`).

Base `/v1/admin`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`. JSON is snake_case. Times are ISO 8601 UTC. Money is in paise. Lists are cursor-paged (`limit` 1 to 100, default 30, `next_cursor`). Fields may be ADDED without a new contract; the web ignores what it does not know. **Phone numbers, e-mail addresses and the words of messages are masked in every answer unless the call carries a valid `access_id` (below).**

## 0. Who is staff, and what a role may do
`GET /v1/admin/me` -> `{ "staff_id": "uuid", "name": "...", "role": "support|admin", "second_factor": true, "session_expires_at": "..." }`.

| Role | May |
|---|---|
| `support` | the support inbox; customer lookup (masked, then unmasked with a reason); call debugging (metadata; a transcript with a reason); privacy requests (read, add a note, mark in progress) |
| `admin` | everything `support` may, and: complete or reject a privacy request, run a deletion, refund, change a plan, "view as customer" |

A staff session lives at most 8 hours, needs the second factor at sign-in and again for every `second_confirm` action. A customer token on any `/v1/admin` route answers **403 `not_staff`**; a missing second factor answers **403 `second_factor_required`**.

## 1. The audit trail (the heart of the contract)
Every route that returns customer data takes `?access_id=` or, for the first view, creates one:

### POST /v1/admin/access
Asks to look at one customer's data. **Nothing is returned except the access itself.**
```json
{ "tenant_id": "uuid", "scope": "profile|calls|messages|privacy|transcript|view_as", "reason_code": "support_ticket|customer_asked|privacy_request|incident|billing_dispute|other", "reason_text": "3 to 300 chars, required when reason_code is other, optional otherwise", "ticket_ref": "optional, 3 to 40 chars" }
```
-> `201 { "access_id": "uuid", "tenant_id": "...", "scope": "...", "expires_at": "<15 minutes>", "granted": true }`. **Errors:** 422 `reason_required`; 403 `scope_not_allowed` (the role may not ask this scope); 409 `consent_required` (`view_as` without the customer's recorded consent, or an expired consent); 404 `tenant_not_found`.
An access lasts 15 minutes and covers ONE tenant and ONE scope. Using it on another tenant or scope answers 403 `access_mismatch`. After it expires the screen asks again (a new reason).

### GET /v1/admin/audit?tenant_id=&staff_id=&from=&to=&cursor=
`admin` only. `{ "items": [{ "id": "uuid", "at": "...", "staff": {"id":"uuid","name":"..."}, "action": "access|read|note|status|refund|delete|view_as_start|view_as_end", "tenant_id": "uuid", "scope": "...", "reason_code": "...", "reason_text": "...|null", "ticket_ref": "...|null", "target": {"kind":"call|message|privacy_request|tenant","id":"uuid"|null} }], "next_cursor": null }`. The trail is append-only; there is no delete route. **The customer sees their own entries** (a later screen: "Who looked at my data and why"; DPDP).

## 2. Support inbox
### GET /v1/admin/support/tickets?status=open|waiting|closed&assigned=me|any&q=&cursor=
No customer data beyond what the ticket itself holds. `{ "items": [{ "id": "uuid", "tenant_id": "uuid", "business_name": "...", "subject": "...", "status": "open", "priority": "normal|high", "channel": "app|email", "created_at": "...", "last_message_at": "...", "assigned_to": {"id":"uuid","name":"..."}|null, "unread": 2 }], "next_cursor": null }`.
### GET /v1/admin/support/tickets/{id}
The thread. Message bodies are what the customer wrote TO support, so they are shown; any pasted phone number or e-mail is masked unless an `access_id` for scope `messages` is passed. `{ ...ticket, "messages": [{ "id": "uuid", "from": "customer|staff", "at": "...", "body": "...", "attachments": [] }] }`.
### POST /v1/admin/support/tickets/{id}/reply `{ "body": "1 to 4000 chars" }` -> 201 the message. Sent to the customer's e-mail and shown in their in-app help (E15). **No WhatsApp, no call.**
### POST /v1/admin/support/tickets/{id}/status `{ "status": "open|waiting|closed" }`, and `/assign` `{ "staff_id": "uuid|null" }`.
**Errors:** 404 `ticket_not_found`; 409 `ticket_closed` (reply on a closed ticket).

## 3. Customer lookup (read-only)
### GET /v1/admin/customers?q=&cursor=
`q` is a business name, an owner e-mail or a tenant id. Returns the **masked** row: `{ "tenant_id": "uuid", "business_name": "...", "business_type": "...", "plan": "lead_desk|ai_workforce|trial", "created_at": "...", "owner_email_masked": "g***@gmail.com", "status": "active|read_only|closed", "real_data_gate": "closed|open" }`. No search by phone number or by the words of a message.
### GET /v1/admin/customers/{tenant_id}?access_id=
Needs an access with scope `profile`. `{ ...masked row, "owner_email": "...", "phone": "...", "members": [{"name":"...","role":"owner|admin|sales|viewer"}], "usage": {"minutes_used": 0, "messages_used": 0}, "billing": {"plan":"...", "next_renewal":"...|null", "payments": []}, "flags": ["WAITLIST"] }`. **Read only.** There is no PUT or PATCH on this route.

## 4. Call debugging
### GET /v1/admin/calls?tenant_id=&status=&from=&to=&cursor=  (no access needed: no customer data)
`{ "items": [{ "id": "uuid", "tenant_id": "uuid", "started_at": "...", "duration_s": 84, "direction": "in|out", "outcome": "answered|no_answer|failed|voicemail", "language": "te", "error_code": "provider_timeout|null", "cost_paise": 120 }] }`.
### GET /v1/admin/calls/{id}  (metadata only)
`{ ...row, "timeline": [{ "t_ms": 0, "event": "ring|answer|stt_start|llm_first_token|tts_first_audio|barge_in|hangup", "detail": "short, no words of the call" }], "latency": { "first_audio_ms": 920, "p50_turn_ms": 700, "p95_turn_ms": 1400 }, "provider": {"name":"plivo","call_uuid":"..."}, "errors": [{"at":"...","code":"...","message":"fixed sentence"}] }`. **Never** a phone number, never a word of the call.
### GET /v1/admin/calls/{id}/transcript?access_id=
Needs an access with scope `transcript`. `{ "turns": [{ "who": "assistant|customer", "text": "...", "t_ms": 1200 }], "retention_until": "..." }`. Each read is one audit row (`action: read`, `target: call`).
**Errors:** 404 `call_not_found`; 403 `access_required` (no or wrong access); 410 `transcript_deleted` (past retention, see processors list #500).

## 5. Privacy requests with deadlines
DPDP requests (access, correction, erasure, withdraw consent, grievance) come from the customer or a data principal. Each has a **deadline** the screen counts down; overdue ones go to the top and are red.
### GET /v1/admin/privacy/requests?status=open|in_progress|done|rejected&overdue=true&cursor=
`{ "items": [{ "id": "uuid", "tenant_id": "uuid|null", "kind": "access|correction|erasure|withdraw_consent|grievance|other", "from": "customer|data_principal", "received_at": "...", "due_at": "...", "days_left": 12, "overdue": false, "status": "open", "assigned_to": null, "summary": "fixed words, no personal data" }] }`. `due_at` is `received_at` plus the period the privacy text states (the owner writes it; **until then the API uses 30 days and marks `deadline_source: "draft"`**).
### GET /v1/admin/privacy/requests/{id}?access_id=  (scope `privacy`)
`{ ...row, "details": "what was asked", "requester": {"name":"...","contact":"..."}, "notes": [{"at":"...","staff":"...","text":"..."}], "history": [] }`.
### POST .../notes `{ "text": "1 to 1000" }`; POST .../status `{ "status": "in_progress" }` (`support`); `{ "status": "done|rejected", "reason": "required, 3 to 500", "second_confirm": "..." }` (`admin`).
### POST /v1/admin/privacy/requests/{id}/erase  (`admin`, `second_confirm` required)
Starts the erasure the customer asked for (the same job as the app's own erasure). Answers 202 `{ "job_id": "uuid" }`; **a deletion never happens on a plain POST**: without `second_confirm` it answers 409 `second_confirm_required`.
**Errors:** 404 `request_not_found`; 409 `already_closed`; 422 `reason_required`.

## 6. "View as customer" (read-only, with consent)
### POST /v1/admin/view-as `{ "access_id": "uuid" }` (scope `view_as`)
Needs the customer's recorded consent (`consent_required` otherwise; the consent comes from a customer-side switch "Let Stack19 support see my screen for 30 minutes", a later E15 item). Answers a short-lived read-only token `{ "token": "...", "expires_at": "<30 minutes>", "read_only": true }` that the customer web accepts ONLY for GET. Any write with it answers **403 `view_as_read_only`**. Start and end are audit rows (`view_as_start`, `view_as_end`) and the customer sees both.

## 7. Money and plan (V1 shows them, does not change them)
V1 has no refund or plan-change screen. Reserved routes, `admin` + `second_confirm`: `POST /v1/admin/customers/{id}/refund` `{ "payment_id": "...", "amount_paise": 0, "reason": "..." }`, `POST /v1/admin/customers/{id}/plan`. They answer 409 `second_confirm_required` without the confirm and are built after Razorpay test mode (C12).

## 8. Error codes added (to `docs/contracts/error-codes.md` when built)
`not_staff` 403, `second_factor_required` 403, `reason_required` 422, `scope_not_allowed` 403, `access_required` 403, `access_mismatch` 403, `access_expired` 403, `consent_required` 409, `second_confirm_required` 409, `view_as_read_only` 403, `ticket_not_found` 404, `ticket_closed` 409, `call_not_found` 404, `transcript_deleted` 410, `request_not_found` 404, `already_closed` 409.

## 9. What the web builds first (C2, flag `ADMIN_CONSOLE`, staging, mock)
The four screens against made-up data kept in a cookie (no network): the inbox, the lookup with the "why do you need this?" step, call timelines (no words), privacy requests with the countdown. Every screen says "Test console: made-up customers". Nothing real is read until C1's routes exist and the owner turns it on.

## 10. Questions for C1
1. Is `second_confirm` a second staff member or a re-entered second factor? (C2 prefers the second staff member for deletion and the re-entered factor for everything else.)
2. Where do staff accounts live (a `staff` table, not `tenants`)? Is the console served from the same API or a separate service/host?
3. The privacy period for `due_at` stays a 30-day draft until the owner approves the privacy text.
