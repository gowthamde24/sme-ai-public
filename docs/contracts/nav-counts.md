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
- If the database cannot answer at all, the call is `502` and the web draws no badges (the page itself never waits for it).

| field | what it counts | same number as | who sees it |
|---|---|---|---|
| `needs_you` | the customer items waiting for a decision (quotes, follow-up drafts, messages, call requests, money held, proposed visits ...) | Today's `cards.waiting` | everyone (each role's own items, as Today) |
| `prospects_needing_owner` | Lead Finder prospects in `needs_owner`, not snoozed by "ask me later" | `prospect_stats.by_status.needs_owner` (that one includes the snoozed) | Owner, Admin, Sales; null without the Lead Finder |
| `lead_desk_waiting` | Lead Desk's own waiting rows that Today's `cards.waiting` does not count, by the same rules as Today's screen: calling plans and tasks waiting for the Owner's approval (the Owner), callbacks due per batch and standing rules / tasks paused at their limit (the Owner and Admins), hot leads whose reminder has not gone yet (the Owner and Admins; Sales their own) | Today's Lead Desk rows | everyone (0 where the role sees none) |
| `new_leads` | leads of the last 7 days that THIS person has not opened yet (not archived, not junk; `POST /leads/{id}/seen` opens one) | the Lead Desk list's "New" | Owner, Admin, Sales |
| `live_calls` | phone calls in progress now | Calls, "● N live" | Owner, Admin, Sales |
| `unread_chats` | conversations whose last inbound message nobody has read | Chats | Owner, Admin, Sales |
| `followups_due` | follow-up drafts waiting for a decision (the due list itself runs the cadence engine in the API, too heavy for a badge); capped at 99: show "99+" | Follow-ups | Owner, Admin, Sales |
| `visits_today` | visits booked, confirmed or arrived today (India time); null without the visits part | Visits | everyone |
| `quotes_waiting` | draft quotes (sarees) or draft material quotes (building materials) awaiting approval | the quote list's drafts | Owner, Admin; null for a school |
| `ai_team_working` | helpers busy right now: agent runs running (an Owner or Admin counts everyone's, others their own), tasks and calling plans running, Lead Finder searches under way | My AI team | everyone |
| `call_minutes` | `{used, total}` whole minutes this billing month | Plan & usage | Owner, Admin |
| `ai_usage` | `{used_paise, allowance_paise, period}`: this month's AI spend and allowance | Plan & usage | Owner, Admin (others: null; they see the percent on Plan & usage) |
| `plan` | the plan id: `free_trial`, `starter`, `growth`, `business`, `calls_payg`, `calls_300`, `calls_1000` | Settings -> Plan | everyone |

Rules:
- `needs_you` does **not** include `prospects_needing_owner` or `lead_desk_waiting`. **Today's badge = `needs_you` + `lead_desk_waiting` + `prospects_needing_owner`** (added 5 Nov 2026: the badge said 52 while Today showed 53).
- `as_of` is when the numbers were read. They are kept **30 s per person and workspace** (`new_leads` is per person): a decision taken on a page updates that page at once, and the sidebar within 30 s.
- Read-only, with the caller's own token. Each field follows the same role rule as the screen that shows it, checked in the database (`public.nav_counts`). Nothing is written, no model is called, nothing is sent.
- Calling more often costs nothing: within 30 s the kept answer is returned. The web polls at most every 30 s and on focus.
- The AI meter is an amount in paise (owner, 5 Nov 2026), for the Owner and an Admin only; everywhere else the AI allowance stays a percentage.

Not yet: a push of the counts (the web polls). Fields may be **added** later; none is renamed or removed without a new contract note here.
