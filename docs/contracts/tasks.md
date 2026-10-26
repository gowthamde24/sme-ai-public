# Contract: "Ask Vijaya to do it" tasks (night 4, Part B1; C1 -> C2). Published BEFORE building; shapes are final unless a line says "draft".

Base `/v1/tenants/{tenant_id}`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`. No DELETE verb: every "remove" is a POST. All telephony and sending is FAKE for now: every call result carries `simulated: true`, and the web must say "simulated" next to a transcript. Non-English wording the API produces is `wording: "draft"` (native review pending).

## Roles
Owner, Admin, Sales: plan, answer, exclude, read. Owner + second factor: approve. Owner, Admin: run (continue), pause, resume, cancel. Viewer: read only. Read-only workspaces: all writes 403 `workspace_read_only` (the gate); a workspace waiting for WhatsApp: 403 `waiting_for_whatsapp` on approve/run.

## 1. Plan
`POST /tasks/plan` body (strict)
```json
{ "task_id": "uuid (optional; the same id again is a replay)",
  "instruction": "text, 3..1500 chars, any of en/te/hi/kn/ta/ml, typed or transcribed",
  "language": "en|te|hi|kn|ta|ml (optional: the customers' language; default: detected from the instruction)",
  "contacts": [ { "name": "optional", "phone": "required" } ]   // optional list, max 500: matched to the workspace's OWN contacts by phone; others are never contacted
}
```
-> `201 Task` (below). Claude plans; code resolves the contacts. When the instruction is unclear the answer is `status: "needs_answer"` with ONE `question`; `POST /tasks/{id}/answer {answer: str 1..500}` -> the planned Task (a second question is never asked). `502 plan_failed`, `503 assistant_unavailable`, `429/503` as the assistant's other calls.

## 2. The Task
```json
{ "id": "uuid", "status": "needs_answer|planned|approved|running|paused|done|cancelled",
  "instruction": "…", "language": "te", "template": "call_new_leads|reengage_old_leads|confirm_appointments|collect_feedback|payment_reminder|supplier_price_enquiry|offer_invite|custom",
  "question": "text|null",
  "plan": null | { "channel": "call|whatsapp|both", "goal": "…", "questions": [ { "key": "price_per_bag", "text": "…", "type": "text|amount|date|yesno" } ],
                   "script_notes": "…", "message_text": "text|null (WhatsApp wording; checked by code: no amount, no promise)",
                   "window": { "date": "YYYY-MM-DD", "from_minute": 600, "to_minute": 1140 },
                   "follow_up": { "kind": "none|whatsapp_summary|call_back", "after_hours": 24 },
                   "contacts_total": 12, "contacts_sample": [ { "contact_id": "uuid", "name": "…" } ],
                   "unmatched": [ { "name": "…|null", "phone_last4": "3210" } ],
                   "notes": [ "closed sentences, e.g. 'promotional calls are off: WhatsApp only'" ] },
  "estimate": { "contacts": 12, "calls": 12, "messages": 12, "minutes": 24, "cost_paise": 3600, "basis": "fake rates" },
  "cap_paise": 4320, "spent_paise": 0, "pause_reason": "null|cap|owner",
  "progress": { "total": 12, "excluded": 0, "waiting": 12, "in_progress": 0, "done": 0, "failed": 0, "skipped": 0, "reached": 0, "positive": 0 },
  "plan_sha256": "hex (send it back to approve)", "simulated": true, "wording": "draft",
  "created_at": "ts", "approved_at": "ts|null", "finished_at": "ts|null" }
```
Money is paise (integers) and is computed by code from counts, never by the model.

## 3. Review and approve
- `GET /tasks/{id}/contacts?status=&limit=&cursor=` -> `{ contacts: [ { id, contact_id, name, phone_last4, status: "waiting|excluded|in_progress|done|failed|skipped", skip_reason|null, outcome|null, outcome_category|null, captured: {key: value}, simulated: true } ], next_cursor }`.
- `POST /tasks/{id}/contacts/exclude {contact_ids: [uuid], excluded: true|false}` (while `planned`; any number of contacts) -> Task.
- `POST /tasks/{id}/approve {plan_sha256, cap_paise?}` Owner + second factor: **one approval for every contact that is not excluded** -> Task `approved` (then `running`). `409 plan_changed` when the hash is stale, `409 not_planned`. Any `cap_paise >= 0` is accepted; the default cap is the estimate plus 20 percent. Approving sends nothing by itself in a workspace whose outbox is off; WhatsApp messages go through the outbox with its own rules (opt-in, STOP, quiet hours, daily limit).

## 4. Progress and report
- `GET /tasks/{id}` is the live progress (poll it; `progress` and `spent_paise` move). When `spent_paise` reaches `cap_paise` the task becomes `paused` with `pause_reason: "cap"` (a Needs-you item: raise the cap with `POST /tasks/{id}/cap {cap_paise}` Owner + 2FA, then `/resume`).
- `POST /tasks/{id}/run` (continue what is waiting), `/pause`, `/resume`, `/cancel` -> Task.
- `GET /tasks/{id}/report` ->
```json
{ "task_id": "uuid", "status": "done", "short_answer": "Cheapest: Sri Venkateswara Traders ₹395/bag, delivery Thursday", "short_answer_kind": "cheapest|counts",
  "totals": { "contacts": 12, "reached": 9, "positive": 4, "negative": 3, "unclear": 2, "no_answer": 3, "spent_paise": 3120 },
  "rows": [ { "contact_id": "uuid", "name": "…", "phone_last4": "…", "outcome": "positive|negative|unclear|no_answer|failed|skipped", "category": "interested|…|null",
              "captured": { "price_per_bag": 39500, "delivery_day": "Thursday" }, "transcript": [ { "who": "assistant|contact", "text": "…" } ] | null,
              "recording_url": null, "simulated": true, "message_status": "sent|queued|needs_approval|blocked|null" } ] }
```
`short_answer` is built by CODE from the captured fields (the lowest amount for a price enquiry, else counts) and is in the language of the task; `recording_url` is null until telephony exists.

## 5. Templates
`GET /tasks/templates` -> `{ templates: [ { id, label, channel_default, needs_pack?: null|"not education", promotional: bool, example_instruction } ] }` for the 7: call new leads, re-engage old leads, confirm appointments (reschedule if needed), collect feedback, payment reminder (**not for schools**), supplier price enquiry, offer/event invite (**promotional: contacts with marketing consent only; WhatsApp only until a 140-series number is configured**).

## 6. Safety rules the API enforces (the web can rely on them)
Only the workspace's own contacts or the provided list matched to them; suppressed (STOP), erased or archived contacts are skipped with a closed reason; nothing is said that is not an approved fact or the owner's own instruction (no price or promise invented); **schools: no fees, marks or dues in any goal, question or message (422 `not_for_schools`)**; every call opens with the AI disclosure; spending is capped per task; every result is `simulated: true` until telephony exists.

## 7. Details fixed while building (nothing above changed)
- `GET /tasks?status=&limit=&before=` answers a plain JSON **array** of Tasks (newest first); `contacts_sample` is only filled on `GET /tasks/{id}` and the plan responses (the list leaves `plan.contacts_sample` empty).
- `plan.window.date` is always an ISO date in the answer (`today` and `tomorrow` are turned into dates in India time); minutes are 540 to 1260 in steps of 15.
- The run starts in the background right after `approve` (and after `resume` / `run`); poll `GET /tasks/{id}`. A task that is `running` but whose server restarted is continued with `POST /tasks/{id}/run`.
- Errors: `422 not_for_schools`, `409 plan_changed`, `409 task_state`, `502 plan_failed`, `503 model_busy | assistant_unavailable | tasks_unavailable`, `403` for the wrong role / no second factor / read-only workspace.
- The WhatsApp messages of a task go through the outbox like any other (`message_status` per person: `queued | needs_approval | sent | blocked | failed`); a message the outbox holds for a person stays in the owner's outbox list.
- Simulated results are NOT written to the customer timeline or to `/outcomes` (they are not real); a real dialer will do that when telephony exists.
- The assistant's own wording (the fixed WhatsApp sentence, the transcripts' lines, the short answer) is in the task's language in the everyday spoken style and is `wording: "draft"`.
- `plan.notes` are closed sentences in English (the web translates by `notes` order only for display): promotional calls off, unmatched numbers, capped at 500, some skipped, and **nobody found** ("Nobody in your contacts fits this yet..."): the plan is stored with `contacts_total: 0`; approving it answers 422 `invalid_value` (nobody to send to), so the web should offer "say who, or give a list" instead of the approve button.
