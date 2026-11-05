# Nav counts: the API contract (C1 -> C2, job sidebar v2)

Status: **published 5 Nov 2026 (contract first; the route follows in its own PR)**. Owner, 5 Nov: "one cheap endpoint ... cached ~30 s, RLS as usual". Job `~/Desktop/stack19-jobs/job-sidebar-v2.md`.
Base `/v1/tenants/{tenant_id}`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`. JSON is snake_case.

## GET /nav-counts

Any member of the workspace (Owner, Admin, Sales, Viewer). One call for the whole sidebar, the phone bar and the More sheet. **Never block first paint on it**: draw the sidebar without numbers, then fill them.

```json
{
  "needs_you": 4,
  "prospects_needing_owner": 16,
  "new_leads": 3,
  "live_calls": 0,
  "unread_chats": 2,
  "followups_due": 5,
  "visits_today": 1,
  "quotes_waiting": 2,
  "ai_team_working": 1,
  "call_minutes": {"used": 12, "total": 100},
  "ai_usage": {"used_paise": 410000, "allowance_paise": 3000000, "period": "month"},
  "plan": "ai_workforce",
  "as_of": "2026-11-05T11:42:07Z"
}
```

**Every number may be `null`: "not known or not for you", draw no badge.** `0` means "known, none". A field is null when:
- the caller's role may not see it (see the table);
- the workspace's pack or plan doesn't have that part (a school has no quotes; Lead Desk has no Lead Finder);
- its source failed. One failing count never fails the call: the others are still returned.

| field | what it counts | same number as | who sees it |
|---|---|---|---|
| `needs_you` | the customer items waiting for a decision (quotes, follow-up drafts, messages, call requests, money held, proposed visits ...) | Today's `cards.waiting` | everyone (each role's own items, as Today) |
| `prospects_needing_owner` | Lead Finder prospects in `needs_owner` | `prospect_stats.by_status.needs_owner` | Owner, Admin, Sales; null without the Lead Finder |
| `new_leads` | leads that arrived and nobody has opened yet | the Lead Desk's "New leads" card | Owner, Admin, Sales |
| `live_calls` | phone calls in progress now | Calls, "● N live" | Owner, Admin, Sales |
| `unread_chats` | conversations whose last inbound message nobody has read | Chats | Owner, Admin, Sales |
| `followups_due` | leads due a follow-up today | the follow-up due list (capped at 99: show "99+") | Owner, Admin, Sales |
| `visits_today` | visits booked for today (India time) | Visits | Owner, Admin, Sales |
| `quotes_waiting` | draft quotes (sarees) or draft material quotes (building materials) awaiting approval | the quote list's drafts | Owner, Admin; null for a school |
| `ai_team_working` | helpers busy right now (agent runs running or queued) | My AI team | everyone |
| `call_minutes` | `{used, total}` whole minutes this billing month | Plan & usage | Owner, Admin |
| `ai_usage` | `{used_paise, allowance_paise, period}`: this month's AI spend and allowance | Plan & usage | Owner, Admin (others: null; they see the percent on Plan & usage) |
| `plan` | `ai_workforce`, `lead_desk`, `free_trial` ... | Settings -> Plan | everyone |

Rules:
- `needs_you` does **not** include `prospects_needing_owner`. The web adds them for Today's "Needs you" ("See all (N)" uses the sum), so the two numbers are never counted twice.
- `as_of` is when the numbers were read. They are cached **30 s per workspace and role**: a decision taken on a page updates that page at once, and the sidebar within 30 s.
- Read-only. Row-level security applies as on every route (the caller's own token). Nothing is written, no model is called, nothing is sent.
- `429` when called more than about once a second by the same person (the cache answers anyway; the web should poll at most every 30 s and on focus).

Not yet: a push of the counts (the web polls). Fields may be **added** later; none is renamed or removed without a new contract note here.
