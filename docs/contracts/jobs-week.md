# Jobs: this week (C1, 25 Nov 2026, for C2's Jobs list)

`GET /v1/tenants/{tenant_id}/jobs/week`. Every member, JOBS on (404 while off), ETag + 304 like the other Jobs routes. Read-only, nothing paid, no model call.

```json
{ "days": 7,
  "items": [ { "id": "<job id, the same as GET /jobs>", "kind": "speed_to_lead",
               "calls": 10, "visits": 2, "cost": null,
               "numbers": { "called": 10, "picked_up": 5, "visits": 2 } } ] }
```

* `calls` and `visits` are the two numbers a row may show ("last week 12 calls, 3 visits"). `null` = this job has no such thing (a follow-up job makes no call); show nothing, not 0.
* `numbers` is the job page's `results.numbers` (same closed keys per kind, jobs-detail.md), plus the one job that had none: **answer_calls** `{answered, minutes}` = inbound calls the assistant answered in the last 7 days (test and simulated calls never count; minutes rounded up).
* kind to calls / visits: speed_to_lead = called / visits; answer_calls = answered / null; store_visits = null / booked; every other kind null / null.
* `cost` is always `null` for now: money is metered for the whole month (the job page's `cost`), never per job. A made-up per-job rupee would be wrong; the field is there so the web can show it the day a real one exists.
* A job that cannot be read gives `calls: null, visits: null, numbers: {}`; the route never fails for it. It is one call for all jobs: use it beside `GET /jobs`, not instead (it does not carry status or settings).
* Why a second call and not a field on `GET /jobs`: the list is the Today first paint; reading seven days from five subsystems must not slow it.
