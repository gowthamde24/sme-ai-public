# Contract: speed to lead + approve once (night 4 Part A3, C1 -> C2). Published before building; shapes are final unless a line says "added".

OWNER DECISION: approve once, not per contact. One plan for a whole batch (an upload, a list, a campaign-like push) or one standing rule per lead source; the Owner approves it with the second factor; nobody clicks per contact. Everything below is under `/v1/tenants/{t}`; errors have the usual shape; the API has no DELETE verb. Calls and WhatsApp stay FAKE (no telephony exists); the plan, the approvals, the timing, the caps, the outcomes, the hand-off and the reports are real.

## 1. Calling policy (one per workspace)
`GET /outreach/policy` (Owner, Admin) / `PUT /outreach/policy` (Owner + second factor):
```json
{ "night_call_minute": 570,          // minutes after midnight, 09:30; 540..720 step 15: the morning call for a lead that arrived after hours
  "max_attempts": 3,                  // 1..6 call attempts per lead
  "retry_gap_hours": 18,              // 1..48: 3 attempts spread over about 2 days
  "then_whatsapp": true,              // after the last unanswered attempt, WhatsApp (if allowed)
  "whatsapp_after_hours": true,       // a lead after hours gets WhatsApp now
  "handoff_reminder_minutes": 15,     // 5..120
  "call_paise_per_minute": 400,       // estimate used in the plan and the reports
  "hours": { "days": [1,2,3,4,5,6], "from_minute": 540, "to_minute": 1140, "from": "assistant"|"call_settings" } }   // read only: the calling hours in force (call settings override the AI assistant's)
```
## 2. A batch plan (one approval for everyone)
`POST /outreach/batches` (Owner, Admin, Sales build a draft; id chosen by the client):
```json
{ "batch_id": uuid, "name": "Diwali leads", "goal": "site_visit"|"counselling"|"appointment"|"qualify"|"test_drive"|"site_measurement"|"quote"|"trial"|"callback"|"general",
  "channel": "call"|"whatsapp"|"both", "language": "en|te|hi|kn|ta|ml",
  "who": { "contact_ids": [uuid…] } | { "lead_ids": [uuid…] } | { "source": "excel_upload", "status": "new", "since": "YYYY-MM-DD" },
  "questions": ["…", …≤8], "message_text": "…" (the WhatsApp text, ≤600, optional), "window_days": 1..14 (7),
  "max_calls_per_day": int|null, "max_total_minutes": int|null }
```
-> `201 { batch: {id, name, status:"planned", goal, channel, language, plan_sha256, created_at, …}, plan: { count, ready, skipped: {no_phone, no_consent, stopped, duplicate, erased, other}, sample: [{contact_id, name_masked, city}…3], window: {from,to}, estimated_minutes, estimated_cost_paise, estimated_messages, caps: {max_calls_per_day, max_total_minutes} } }`
`GET /outreach/batches?status=` list, `GET /outreach/batches/{id}` (the same plus `progress`: {total, waiting, done, calls_made, connected, interested, minutes_used}), `GET /outreach/batches/{id}/items?cursor=` (contact name, state, attempts, next_at, last_result).
`POST /outreach/batches/{id}/exclude` `{contact_ids:[…]}` (Owner, Admin; before or after approval; changes the plan hash while still planned).
`POST /outreach/batches/{id}/approve` `{plan_sha256}` (Owner + second factor): **approve all** (the hash binds the approval to exactly what was shown; 409 `plan_changed` if it differs). Then `POST …/pause`, `…/resume` (Owner, Admin), `…/cancel` (Owner).
A caps hit pauses the batch: `status:"paused"`, `paused_reason:"cap_calls"|"cap_minutes"|"owner"`, and a Needs-you item appears on Today (kind `outreach_paused`).
## 3. Standing rules per source (approved once, then no clicks)
`GET /outreach/rules`; `POST /outreach/rules` (Owner + second factor = the approval) `{rule_id, source, action:"call_within_minutes"|"whatsapp_first"|"whatsapp_then_call", within_minutes:1..120, goal, channel, language, questions[], message_text?, max_calls_per_day, max_total_minutes}`; `POST /outreach/rules/{id}/pause|resume` (Owner, Admin). Example: "new leads from `meta_lead_ads`: call within 2 minutes in calling hours". `source` is the lead's source tag (the same string the import/live sources write).
## 4. What happens to one lead (the rules in code, not a model)
- In hours: first call at arrival + `within_minutes`. After hours: WhatsApp now (if `whatsapp_after_hours` and consent) and the call next morning at `night_call_minute`.
- No answer / busy / voicemail: retry after `retry_gap_hours` inside hours, up to `max_attempts`, then WhatsApp (if `then_whatsapp`), then stop. A lead who says no, or STOP, is never contacted again; a wrong number stops and is marked.
- Never a stranger: only the workspace's own contacts. A contact without consent for the channel, suppressed, erased, or without a number is skipped and counted in `skipped`.
## 5. Outcomes of the generic pack (added to `/outcomes`)
New category **`already_bought`** (negative). Every outcome now also carries **`callback_at`** (ts|null; set for `call_back_later`) and **`captured`** (object of the pack's fields, e.g. `{"budget":"50 lakh","area":"Gachibowli"}`), in `POST /outcomes`-style answers, `GET /outcomes`, the lead timeline and the totals (`by_category.already_bought`). The AI's reason is still one fixed-length line; schools keep none.
`POST /outreach/items/{id}/result` (Owner, Admin, Sales; the worker's dialer uses the same rule): `{result:"no_answer|busy|voicemail|connected|sent|failed", outcome?: {outcome, category, reason?, callback_at?, captured?}, minutes?, stop?:bool}`.
## 6. Hot-lead hand-off
An outcome `interested`/`visit_booked`/`order_likely` assigns the lead to a staff member (Sales with the fewest open hand-offs, else Admin, else Owner), writes a one-line summary, "sends" it to them on WhatsApp (fake) and pushes a notification; if nobody has acted in `handoff_reminder_minutes` they are reminded once. `GET /outreach/handoffs?open=true` -> `[{id, lead_id, contact_name, summary, assigned_to, notified_at, reminder_sent_at, acted_at}]`; `POST /outreach/handoffs/{id}/acted` (the assignee, Owner, Admin).
## 7. Reports
`GET /outreach/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` -> `{ by_source: [ {source, leads, first_touch_median_seconds, calls, connected_rate, interested_pct, bookings, call_cost_paise, lead_cost_paise, cost_per_booking_paise|null} ], total: {…same} }`. `PUT /outreach/source-costs` (Owner) `{costs:[{source, cost_per_lead_paise}]}` feeds `lead_cost_paise`.
## 8. Needs-you (Today)
`GET …/today` `needs_you[]` gains kinds `outreach_paused` ("Calling to <batch> is paused: you reached the day's limit.") and `hot_lead_waiting` ("<name> is interested; nobody has called back yet."), both with `target: {type: "outreach_batch"|"lead", id}`.

## 9. As built (added after the first publication; nothing above changed meaning)
- **Items page:** `GET /outreach/batches/{id}/items` -> `{ items: [{id, contact_id, lead_id, name, status: planned|waiting|done|stopped|skipped, reason, attempts, next_action: call|whatsapp|null, next_at, last_result, created_at}], next_cursor }` (50 per page; `?cursor=` from the previous answer).
- **Batch answers** are always `{ batch, plan, progress }` (`progress` is absent on the answer to `POST /outreach/batches`). The list is `[ {batch, plan, progress} ]` (newest first, up to 100).
- **Caps** after the fact: `PUT /outreach/batches/{id}/caps` and `PUT /outreach/rules/{id}/caps` `{max_calls_per_day?, max_total_minutes?}` (Owner + second factor). A batch or rule paused by a cap resumes the next morning when it was the day's calls cap; when it was the total minutes, the Owner raises the cap and then a `resume` works.
- **Result values:** `no_answer | busy | voicemail | connected | failed` (a WhatsApp step is sent by the system through the outbox and needs no result; `sent` is not accepted). `outcome.category` also takes `already_bought` and `call_back_later` (with `callback_at`). `captured`: keys `[a-z][a-z0-9_]{0,31}`, values string, number or boolean.
- **Errors:** `409 plan_changed` (the hash differs), `409 outreach_state` (not possible in the state it is in: an approved batch cannot be re-planned, a finished item takes no result, resume while a cap still stands), `403` for a role or a missing second factor, `422` for a shape.
- **Hand-offs:** the Owner and Admin see all of them, a Sales member sees only theirs. On Today, `hot_lead_waiting` appears for the assignee (and the Owner and Admin) once the reminder went out, not before: the first notice is the hand-off itself.
- **Spending gate:** `POST …/batches/{id}/approve`, `…/resume`, `POST /rules`, `POST /rules/{id}/resume` are "spend" requests (refused while the workspace is read-only).
- **Calls are fake:** the staging worker runs a table-driven fake dialer (answers by the last digit of the number); a workspace with no dialer configured keeps its calls queued. WhatsApp steps go through the one outbox (category `campaign_reminder`), so the consent, the quiet hours, the word check and the global switches apply to them as to every message.
