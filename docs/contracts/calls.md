# Calls (AI phone calls): the Calls page contract

Base `/v1/tenants/{tenant_id}/calls`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`. Plan: `docs/plans/phone-calls.md`. Everything is **sandbox** until the owner confirms the legal answers: every call says `sandbox: true`; the page should say "Test call" next to it. No audio is ever kept (`recorded` is always `false`).

## `GET /calls?state=live|finished|all&limit=50&cursor=`

Owner, Admin, Sales (a Viewer gets 403). Live calls first, then finished, newest first. Poll every `poll_after_s` (5) seconds while the page is open. `Cache-Control: no-store`.

```json
{
  "items": [
    {
      "id": "uuid",
      "direction": "outbound | inbound",
      "state": "queued | ringing | in_progress | completed | no_answer | busy | voicemail | failed | refused | cancelled",
      "live": true,
      "who": "Ravi Kumar",
      "purpose": "sales_followup | payment_reminder | admission_followup | visit_reminder | event_reminder | inbound | null",
      "language": "te | en | hi | kn | ta | ml | null",
      "created_at": "iso", "answered_at": "iso | null", "ended_at": "iso | null",
      "elapsed_s": 30, "duration_s": null,
      "outcome": "positive | negative | unclear | no_answer | failed | null",
      "category": "interested | visit_booked | order_likely | not_interested | wrong_number | too_costly | call_back_later | already_bought | do_not_call | null",
      "summary_short": "one line, at most 140 characters | null",
      "refuse_reason": "closed word (see below) | null",
      "lead_id": "uuid | null", "task_id": "uuid | null",
      "sandbox": true, "simulated": false, "ai_disclosed": true, "recorded": false,
      "cost_paise": 0, "callback_at": "iso | null"
    }
  ],
  "next_cursor": "iso | null",
  "updated_at": "iso",
  "poll_after_s": 5
}
```

* `who` is the contact's display name: the name, else the phone number, else "New enquiry". An internal id is never a name.
* `elapsed_s`: for a live call the seconds since it was answered (since it was created while it still rings); for a finished call its length (same as `duration_s`).
* `next_cursor` is passed back as `cursor` for the next page.
* A **refused** call (`state: "refused"`) is a call the gate stopped; `refuse_reason` is one of: `telephony_off`, `live_not_confirmed`, `bad_number`, `not_on_sandbox_list`, `not_approved`, `workspace_paused`, `billing_blocked`, `purpose_not_allowed`, `school_rule`, `outside_window`, `outside_hours`, `holiday`, `weekly_limit`, `daily_cap`, `minutes_cap`, `no_consent`, `suppressed`, `erased_or_archived`, `dnd`, `dnd_unknown`, `no_ai_disclosure`, `already_calling`, `too_many_calls`, `inbound_off`, `no_such_line`, `blocked_caller`. Plain-words labels for these are the web's.
* `summary_short`, the transcript and `captured` are personal data: show them to the people who may see them, never in a log, a title or a notification.

## `GET /calls/{id}`

Same fields plus:

```json
{ "summary": "up to three sentences | null", "end_reason": "goodbye | caller_hung_up | we_hung_up | longest_call | silence | voicemail | no_answer | busy | error | stopped | handover | null",
  "captured": { "visit_day": "Saturday" }, "transcript": [ { "who": "assistant | caller", "text": "…", "t": 4.2 } ] }
```

`transcript` is **null for Sales** (Owner and Admin read it). `t` is seconds since the call began. Unknown id: 404.

## `POST /calls/{id}/hang-up` (Owner, Admin) -> 202 `{"status": "ending"}`

Ends a live call. 409 `call_not_here` when the call is not running on the server that got the request, or has ended (ask again; the list shows its state). 404 for another workspace's call.

## Live activity

While a call is live it also appears in `GET /assistant/activity` as a `call` item.

## Not in this version

`POST /calls/stop` (pause all calling) arrives with the outbound wiring, because the pause flag belongs to the outreach plans (part 4). Call recording: none.
