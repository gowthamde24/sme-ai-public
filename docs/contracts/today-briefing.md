# GET /v1/tenants/{t}/today/briefing (19 Nov 2026, planner: measure first, then change)

The numbers of Today's briefing line, in one small answer (under 1 KB), so the page can paint the line before the big Today reads (`/today/summary`, 214 KB uncompressed) arrive. Any member.

`{needs_you, new_leads, visits_today, unread_chats, followups_due, quotes_waiting, live_calls, as_of}`: each an integer by the caller's role, or `null` = not known or not for you (0 means known and zero). They are the same numbers as `GET /nav-counts` (one database read), so the briefing line and the sidebar badges can never disagree.

Kept 5 seconds per signed-in person and workspace (a page that asks twice costs one read) and DROPPED the moment that person writes anything (a number changes when they act). `/nav-counts` stays as it was (30 s, per person).
