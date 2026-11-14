# Admin console: the API contract (C2 -> C1) **DRAFT**, 13 Nov 2026

## C1: PHASE 1 IS BUILT (13 Nov 2026), flag `ADMIN_CONSOLE` (on in staging). Read this block first: it overrides the draft below where they differ.

Owner's decisions (13 Nov): roles are **`owner`, `support`, `finance`** (exactly one `owner`), not `support|admin`. Staff always sign in with a second factor; a session ends after **30 minutes without a call**. View-as-owner is **reason + audit + read-only** (no consent step), with a per-business switch "Require my OK before support views my account" (default OFF). End-customer names and numbers are **masked**. Staff accounts are made by an operator script (`docs/runbooks/admin-console-staff.md`), never by sign-up. Plan: `docs/plans/admin-console.md`.

| Route | Who | Answer |
|---|---|---|
| `GET /v1/admin/me` | any staff | `{staff_id, name, role: owner\|support\|finance, second_factor: true, session_idle_limit_minutes: 30}`. Call it first: it proves the staff row, the second factor and the session. |
| `GET /v1/admin/overview` | any staff (money and tickets by role, below) | **Everything the Overview screen (`approved-mocks/admin-overview.html`) draws, in ONE request.** `{generated_at, role, environment:{key:"staging"\|"production", label:"Staging · test data"\|""}, badges:{businesses, support_open, health_issues, compliance_open}, kpis:{mrr:{paise,text:"₹2,41,800",change_percent:null}\|null, active_businesses:{count, added_this_week, on_free_start}, calls_today:{count, connected_percent}, gross_margin:{percent, revenue_paise, revenue_text, cost_paise, cost_text, costs_recorded_since}\|null}, support_queue:{total_open, items:[TicketOut]}\|null, health:{components:[{key: api\|phone_calls\|whatsapp\|voice\|database\|payments, label, state: healthy\|degraded\|down\|unknown, note}], issues}, businesses:[BusinessRowOut] (6, newest activity first), costs_this_month:{period_start, revenue_paise/_text, cost_paise/_text, margin_paise/_text, providers:[{provider: cartesia\|sarvam\|plivo\|anthropic\|meta\|google, role: voice\|speech_to_text\|calls_and_numbers\|ai_model\|whatsapp\|lead_search, cost_paise, cost_text}]}\|null}`. **By role:** `mrr`, `gross_margin` and `costs_this_month` are `null` for `support`; `support_queue` is `null` for `finance`; everyone gets `badges`, `calls_today`, `health` and `businesses`. This is the only place provider names and costs appear. **Honest limits (draw them, do not hide them):** `mrr.change_percent` is `null` until there is a month of history; `health` state `unknown` (shown now for Voice: latency is not measured yet) means "not measured", never "fine"; `costs_recorded_since` says when per-provider costs started being recorded (no back-fill), so this month's margin is partial until a full month passes; `on_free_start` is the old "in trial" (there is no trial any more). |
| `GET /v1/admin/search?q=` (2 to 80 characters) | any staff | The ⌘K box: `{businesses:[BusinessRowOut] (name, id, or the business's OWN phone number), invoices:[{number,kind,tenant_id,business_name,total_paise,total_text,issued_at}] (owner and finance), tickets:[TicketOut] (owner and support)}`, at most 5 each. End-customer phone numbers are not searched (they need a reason, later). What was typed is not stored. |
| `GET /v1/admin/support/tickets?status=active\|open\|waiting\|closed&limit=` | owner, support | `{items:[TicketOut], total}` — `TicketOut`: `{id, tenant_id, business_name, subject, channel: phone\|whatsapp\|chat\|email, priority: urgent\|high\|normal, status, created_at, last_message_at, waiting_minutes, assignee:{id,name}\|null}`. Urgent first, then high, then normal; the longest-waiting first. `active` = open + waiting. |
| `POST /v1/admin/support/tickets` `{tenant_id, subject (3 to 140), channel, priority?, assignee_id?}` | owner, support | `201 TicketOut`. Logs a ticket by hand (a call-in, a message seen elsewhere). Replies, status changes and assigning later are phase 2; the shop-facing "Help" form creating tickets is not built yet. |
| `GET /v1/admin/businesses?q=&limit=&cursor=&sort=name\|last_activity` | any staff | `{items:[{tenant_id, name, town, demo, business_type, plan: none\|payg\|sales_assistant\|sales_lead_finder, plan_name:"Sales Assistant + Lead Finder", balance_paise, balance_text:"₹1,550", status: not_live\|in_training\|live\|paused, signup_at, last_activity_at}], next_cursor}`. `q` = part of a name or a tenant id. No end-customer data, no reason needed. |
| `POST /v1/admin/access` `{tenant_id, scope:"profile", reason_code, reason_text?}` | owner, support | `201 {access_id, tenant_id, scope, expires_at}` (15 minutes, one business, one scope). `reason_code`: `support_ticket\|customer_asked\|privacy_request\|incident\|billing_dispute\|other` (`other` needs `reason_text`, 3 to 300 characters). **The shop owner sees this in their activity log** as a new kind `support`. 409 `owner_ok_required` when that business switched on "Require my OK" and has not approved. |
| `GET /v1/admin/businesses/{tenant_id}?access_id=` | owner, support | The support view: `{business, setup:{business_name, phone_number, voice_saved, rules_saved}, phone_numbers:[{number,label,inbound_on}], whatsapp:{connected,status,display_phone,connected_at}, numbers_30d:{calls,call_minutes,messages_sent,leads,quotes,visits}, recent_calls:[{id,at,direction,state,duration_s,outcome,customer,customer_phone}], recent_chats:[{lead_id,last_at,customer,customer_phone}], support_view:true}`. `customer` and `customer_phone` are **masked** ("P•••••• N••••", "+•• ••••• ••210"). Show a **"Support view" banner and no edit control anywhere**. No message text, no transcript. |
| `GET /v1/admin/audit?tenant_id=&staff_id=&limit=&cursor=` | owner only | `{items:[{id, at, staff:{id,name}, action, tenant_id, scope, reason_code, reason_text, target_kind, target_id, customer_visible}], next_cursor}`. Newest first. |
| `GET /v1/tenants/{t}/support-access` | shop Owner | `{require_ok, approved_until}` |
| `PUT /v1/tenants/{t}/support-access` `{require_ok}` | shop Owner (second factor) | the same shape. The setting "Require my OK before support views my account", default OFF. |
| `POST /v1/tenants/{t}/support-access/approve` | shop Owner (second factor) | Says yes to ONE visit (30 minutes). |
| `GET /v1/tenants/{t}/activity-log?kind=support` | shop Owner, Admin | New kind: `{key:"support:<id>", kind:"support", at, who:"support", summary:"Stack19 support viewed your account", reason:"your support request"\|<the typed words>}`. Draw it as "Stack19 support viewed your account · <date time> · reason: <reason>". It never names the staff member. Old clients that only know call, message and action: skip an unknown kind. |

Errors (the one error shape): `401 session_ended` (30 minutes idle: send them to sign in), `403 not_staff`, `403 second_factor_required`, `403 forbidden` (the role may not), `403 access_required` (open the business first), `409 owner_ok_required`, `422 reason_required`, `422 bad_cursor`. Off (flag) = `404`.

**Phase 2, slice 2 (14 Nov 2026): pause / resume a business's assistant** (owner and support; finance 403).

| Route | Answer |
|---|---|
| `POST /v1/admin/businesses/{tenant_id}/assistant/pause` `{reason_code, reason_text?}` | `BusinessRowOut` (status `paused`). Reason codes as for access (`other` needs `reason_text`, 3 to 300 characters; 422 `reason_required`). The assistant **stops answering inbound calls** and the shop owner cannot go live again until support resumes. The shop owner sees "Stack19 support paused your assistant" with the reason in their activity log (kind `support`). Pausing twice is fine. |
| `POST /v1/admin/businesses/{tenant_id}/assistant/resume` `{reason_code, reason_text?}` | `BusinessRowOut` back to what it was before the pause (live if it was live; a pause the shop owner made themselves stays). 422 when there is nothing of support's to lift. Logged, and visible to the shop owner ("Stack19 support resumed your assistant"). |

Shop side: `GET /v1/tenants/{t}/assistant/status` has a new field `held_by_support: bool`; `POST .../go-live` answers `409 held_by_support` ("Stack19 support paused your assistant. Ask support to resume it.") while it is held. **Behaviour change for everyone:** the line's inbound lookup now reports "not answering" while the workspace's assistant is paused, so the shop owner's own Pause button also really stops inbound calls (before, it only changed the label). Outbound dialing is not gated by it yet.

**Phase 2, slice 3 (14 Nov 2026): goodwill credit** (owner and finance only; support 403).

`POST /v1/admin/businesses/{tenant_id}/goodwill-credit` `{amount_paise (100 to 100000), confirm_paise (the amount typed again, must be equal), reason_code, reason_text (3 to 300, ALWAYS required for money), idempotency_key (8 to 64 of A-Z a-z 0-9 _ -, one per click)}` -> `201 {credited_paise, credited_text:"₹500", balance_paise, balance_text, replayed}`. Adds a wallet lot (source `adjustment`, expiring like a top-up); no invoice, no GST (a gesture). Limits: ₹1,000 a time, **₹3,000 per business per 30 days** (409 `goodwill_limit`). **Second confirm = a fresh authenticator code**: the token must show a code entered within the last 5 minutes, else 403 `second_confirm_required` ("Enter your authenticator code again to do this."): the console asks for the 6-digit code (Supabase MFA challenge + verify), refreshes the session and sends the same request again with the same `idempotency_key`. A retry with the same key answers `replayed: true` and credits nothing more. Audited (`credit`), and the shop owner's activity log shows "Stack19 added a goodwill credit to your balance" (no staff name, no amount in the line).

**Phase 2, slice 4 (14 Nov 2026): unmasking** (owner and support).

`POST /v1/admin/businesses/{tenant_id}/unmask` `{access_id (the business access from the FIRST reason), reason_code, reason_text (3 to 300, ALWAYS required: the second reason)}` -> `{recent_calls:[{id, customer, customer_phone}], recent_chats:[{lead_id, customer, customer_phone}]}`: the same ten calls and ten chats the support view lists (match them by `id` / `lead_id`), with the REAL name and number. One call = one look = one audit row (`unmask`); nothing is remembered, so each look asks again. The shop owner's activity log shows "Stack19 support looked at your customers' contact details" with the reason. Errors: 403 `access_required` (open the business first), 422 `reason_required`. No message text and no transcript here or anywhere in support view.

Built later (phases 2 and 3, same plan): support inbox, view as owner with unmasking by a second reason, resend invoice, pause/resume, goodwill credit, money screens, usage and cost per provider, health, compliance.


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
