# My AI team v2: the API contract (C1 -> C2; job ai-team-v2)

Status: **published 6 Nov 2026, contract first.** The routes land in parts: T1 is the day and the panel; T2 is the stand-up. Job `~/Desktop/stack19-jobs/job-ai-team-v2.md`.
- Base: `/v1/tenants/{tenant_id}`.
- Errors have the one shape `{error:{code,message,retry_after,request_id}}`.
- JSON is snake_case. Times are ISO 8601 with offset; the business's day is in **India time (Asia/Kolkata)**.
- Who: any member reads the day and the panels (each mark is only what their role may already see). The stand-up is read by the Owner and an Admin; the Owner and an Admin generate it.

## 0. The helpers
A closed list, in sales-flow order. `helpers` in `/ai-team/day` gives the ones **active in this workspace**: its pack, its modules and its connected sources decide which.

| `helper` | Lane name (en) | What its marks are |
|---|---|---|
| `lead_catcher` | Lead catcher | a lead arrived (website form, IndiaMART, e-mail, sheet, Meta, typed) |
| `lead_finder` | Lead Finder | a search ran; a business was found or called |
| `caller` | Caller | a call (inbound or outbound) with its length; a person asked for; a visit asked for |
| `followups` | Follow-ups | a follow-up message sent, or one due |
| `quote_writer` | Quote writer | a quote made, sent for approval, approved |
| `order_desk` | Order desk | an order made or moved on |
| `admissions` (school) | Admissions | an enquiry, a campus visit, an admission |
| `fee_reminders` (school) | Fee reminders | a fee reminder sent, a payment recorded |
| `notices` (school) | Notices | a notice or marks message sent |

School workspaces get `lead_catcher`, `caller`, `followups`, `admissions`, `fee_reminders` and `notices`. Every other workspace gets the first six (a helper the workspace cannot use is left out).

## 1. GET /ai-team/day?date=YYYY-MM-DD
`date` defaults to today; it may be up to 31 days back (else `422 date_out_of_range`). Any member. Target ≤ 300 ms p95. Cached 15 s per workspace and role, so polling every 20 s costs at most one read.
```json
{
  "date": "2026-11-06",
  "now": "2026-11-06T14:12:00+05:30",
  "day": { "opens": "09:00", "closes": "20:00", "source": "default" | "business_hours" },
  "lanes": [
    { "helper": "caller",
      "status_now": { "kind": "busy" | "due" | "waiting" | "idle" | "off", "text_key": "on_call" | "due_next" | "waiting_for_you" | "idle" | "off",
                      "count": 5, "at": "2026-11-06T16:00:00+05:30" | null, "who": "Ramesh" | null, "since": "2026-11-06T14:11:18+05:30" | null },
      "count_today": 23,
      "marks": [
        { "id": "phone_call:2b1c…", "t": "2026-11-06T10:42:07+05:30", "kind": "call", "seconds": 84 | null, "label": "Ramesh K · interested", "ref": { "type": "call" | "lead" | "quote" | "order" | "visit" | "prospect" | "student" | "campaign" | "intake", "id": "uuid", "href": "/app/tenants/{t}/…" }, "needs_owner": false }
      ] }
  ],
  "flow": { "steps": [ { "key": "leads_in", "count": 41 }, { "key": "called", "count": 23 }, { "key": "interested", "count": 7 }, { "key": "quotes", "count": 3 }, { "key": "orders", "count": 1 } ],
            "extra": [ { "key": "fees_collected", "count": 4 } ] },
  "cost_today": { "paise": 18450, "calls_minutes": 31, "messages": 12, "ai_percent": 14 } ,
  "needs_owner_total": 4
}
```
- **`marks[].kind`:** `lead_in`, `search`, `found`, `call`, `message`, `followup_due`, `quote`, `quote_approved`, `order`, `visit`, `admission`, `fee_reminder`, `payment`, `notice`. The next `label` text is the item's own (a name and a short outcome word), never a model's.
- **`needs_owner: true` is the ⚑ orange mark.** The item waits for the Owner or a person. **The ⚑ marks of a lane are exactly the Needs you items of that helper**, so `needs_owner_total` equals the Today page's Needs-you count for those helpers.
- **Every mark is a real row.** `id` is `<table>:<row id>`; clicking opens `ref.href`.
  - At most **200 marks a lane**, newest kept; `count_today` is the true count.
  - Marks of a past `date` never change.
- **`status_now`** (only for today; `null` for a past date):
  - `busy`: "on call · Ramesh 0:42"; `since` is when the call started, so the timer runs on the web.
  - `due`: "5 due · next 16:00"; `count` is how many, `at` is the next one.
  - `waiting`: "1 waiting for you"; `count`.
  - `idle`; `off` (its switch is off).
  - The web words the `text_key` in en/te/hi/kn/ta/ml/mr.
- **`flow.steps`** is ordered and clickable (the web filters the timeline by the step's mark kinds).
  - **Business:** `leads_in`, `called` (distinct leads called), `interested` (calls with outcome interested), `quotes`, `orders`.
  - **School:** `enquiries`, `called`, `campus_visits`, `admissions`, with `fees_collected` in `extra`.
  - Counts are for `date`.
- **`cost_today`:** what the day cost. Call minutes and messages are counted; `paise` uses the plan's prices (`null` when the plan has no price for it); `ai_percent` is the share of the day's AI allowance. It is null for a past date beyond the usage kept. Owner and Admin only (`null` for Sales and Viewer).
- **`day`:** the business's opening hours for that weekday when set (Settings → Business hours), else 9:00–20:00. Marks outside the hours still come, so the web widens the axis.

## 2. GET /ai-team/{helper}
The side panel. Any member; `404` for a helper that is not active here.
```json
{ "helper": "caller", "status_now": { … as above … }, "enabled": true, "can_switch": true | false, "reason_locked": null | "not_built" | "owner_only",
  "recent": [ { …a mark… } ],
  "today": { "count": 23, "numbers": [ { "key": "connected_percent", "value": 71 }, { "key": "interested", "value": 7 }, { "key": "minutes", "value": 31 } ] },
  "cost_today": { "paise": 9300 } | null,
  "settings": [ { "key": "calling_hours", "value": "Mon–Sat 10:00–19:00", "href": "/app/tenants/{t}/settings/calls" } ],
  "train_href": "/ai-team/training" }
```
- `recent` holds the last 10 actions, newest first; they may come from earlier days.
- The `today.numbers` keys per helper:

  | helper | keys |
  |---|---|
  | `caller` | `connected_percent`, `interested`, `minutes` |
  | `followups` | `sent`, `replies`, `due` |
  | `quote_writer` | `made`, `approved`, `waiting` |
  | `order_desk` | `orders`, `value_paise` |
  | `lead_catcher` | `leads`, `by_source` (`[{source, count}]`) |
  | `lead_finder` | `searches`, `found`, `called` |
  | school helpers | their own counts |

- The on/off switch is the existing one: `PUT /agents/{agent}/switch` (docs/contracts/agents-switches.md). `can_switch: false` with `reason_locked: "not_built"` for a helper without a switch of its own yet; the panel shows the switch disabled with a reason.
- `settings` are read-only summaries, each with a link to its screen. Nothing is changed here.

## 3. The daily stand-up
A 30 to 45-second spoken summary, in the Owner's language:
- **Yesterday:** the numbers.
- **Now:** what is waiting for the Owner.
- **Today:** the first items.

**The text is made by code from the data, never by a model.** Every number and name in it comes from the day's rows. Amounts are said as words, per the voice rules (₹1,25,000 → "one lakh twenty-five thousand rupees"). A zero amount is never read out (that line is left out).

- `GET /ai-team/standup?date=` (Owner, Admin) -> the day's stand-up, or `404 not_generated`.
- `POST /ai-team/standup` `{ date?: today }` (Owner, Admin) -> generates it (or makes it again), then the same shape.
  - It is made automatically at the business's opening time, once a day.
  - On demand: at most **3 a day** per workspace -> `429 standup_limit` with `retry_after`, the seconds to the next Indian midnight.
  - Audio is cached 24 h; a repeat `POST` with the same data returns the cached one and does not count.
```json
{ "date": "2026-11-06", "language": "te", "generated_at": "iso", "by": "schedule" | "owner",
  "text": "…", "lines": [ { "text": "…", "source": "yesterday.calls" } ],
  "numbers": [ { "key": "yesterday.calls", "value": 23 } ],
  "audio": { "url": "https://…signed, 24 h", "seconds": 38, "voice": "the workspace's assistant voice" } | null,
  "audio_reason": null | "voice_off" | "limit" | "unavailable",
  "left_today": 2 }
```
- `lines[].source` says which data each line came from; `numbers` lists every number spoken, for the transcript and the eval.
- `audio` is null when speech is unavailable; the transcript still shows.
- The voice is the workspace's assistant voice (Settings → AI assistant): Cartesia, with the same voice settings, in the Owner's language. `language` is the Owner's app language.
- "Ask a follow-up" opens the assistant with the stand-up's date. No API change is needed for it.

## 4. Never
- No invented number, name, amount or time: every one comes from a row. The evals check 10 days × te/en.
- No lane shows a helper the workspace does not have.
- A Sales or Viewer member sees only what their role already sees.
- Nothing here changes data: the switch is the existing route.
