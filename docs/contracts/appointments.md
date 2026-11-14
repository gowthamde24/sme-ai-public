# Contract: appointment booking (C1 -> C2), 14 Nov 2026

The app says **appointments**; the API keeps the name `visits` (one engine: `docs/plans/appointment-booking.md`). Base `/v1/tenants/{tenant_id}`; every route below exists on staging once PR #620 is deployed. Times are India time; `date` is `YYYY-MM-DD`, `slot_start` is `HH:MM` (a start on the slot grid). Roles: every member reads; Owner, Admin and Sales book, move and cancel; Owner and Admin change the settings and the staff.

## 1. Settings (the open hours, slot length, places, buffer, closed days)
`GET /visits/settings` and `PUT /visits/settings` (Owner, Admin):
```
{ "weekly_hours": { "mon": {"open":"10:00","close":"20:30"}, "tue": ..., "sun": null },   // all seven keys; null = closed
  "closed_dates": ["2026-11-14"],            // holidays and closures, at most 200
  "slot_minutes": 30,                        // 15 | 20 | 30 | 45 | 60 | 90 | 120
  "max_parallel": 2,                         // places per slot when the business has NO staff list
  "buffer_minutes": 0 }                      // NEW: 0..60, a gap after every booking (same person and the places count)
```
`GET` also returns `staff_count` (active staff members) and `is_default` (true until the business saved its own).

## 2. Staff (optional)
* `GET /visits/staff` -> `{items:[{id, name, weekly_hours|null, active}]}` (any member).
* `PUT /visits/staff/{staff_id}` `{name (1-60), weekly_hours: {mon..sun: {open,close}|null} | null, active}` (Owner, Admin). The id is yours (`crypto.randomUUID()`): a retry changes nothing twice. `weekly_hours: null` = the business's opening hours. A person who left is `active:false`; staff are never deleted (past visits keep their name).
* With NO active staff, a slot has `max_parallel` places, exactly as before. With staff, **each active staff member who works at that time is one place** (`max_parallel` no longer counts) and one person can never be booked twice at overlapping times (database constraint, buffer included).

## 3. Slots
`GET /visits/slots?date=2026-11-03[&staff_id=...]` ->
```
{ "date", "open", "reason": null|"closed_day"|"closed_date"|"past", "slot_minutes", "max_parallel", "buffer_minutes", "staff_count",
  "slots": [ { "start":"11:00", "starts_at", "ends_at", "capacity": 2, "free": 1,
               "staff": [{"id","name"}],     // the staff members free for this slot ([] when the business has no staff)
               "blocked": false,             // true: a connected Google Calendar says the owner is busy then (free is 0)
               "past": false } ] }
```
Offer a slot only when `free > 0`. `staff_id` shows that one person's slots.

## 4. Book, reschedule, cancel
* **Book** `POST /visits` `{visit_id (yours), lead_id, date, slot_start, party_size?, purpose?, note?, advance_paise?, staff_id?}` -> `{visit, replayed}`. `staff_id` left out = the first free person is given. Retrying with the same `visit_id` replays.
* **Reschedule** `POST /visits/{id}/change` `{date, slot_start, staff_id?, party_size?, purpose?, note?, ...}` (`date` and `slot_start` go together). A moved visit goes back to `booked`. It keeps its person when that person is free, else the first free one; `staff_id` alone changes only the person (same time).
* **Cancel** `POST /visits/{id}/cancel` `{reason?}`. A cancelled visit frees its person and its slot at once.
* Other steps unchanged: `/confirm`, `/arrive`, `/no-show`, `/complete`, `/visits/{id}/messages`.
* A visit row now has `staff_id`, `staff_name` (null when none).
* Refusals (all 409, the one error shape): `slot_full` (no free place or person, or the owner's calendar is busy: show the slots again), `slot_invalid`, `shop_closed`, `date_past`, `visit_state`; 404 unknown lead or visit; 422 bad input.

## 5. What the assistant does by itself (no screen needed, but show it)
Only when the owner switched on "the assistant may book visits" (My assistant settings, `may_book_visits`) and the visits module is on:
* **WhatsApp**: a customer who writes about booking gets the next free times numbered ("Reply with the number"); the number books it (`source: "assistant"`); RESCHEDULE moves their own next visit; CANCEL cancels it. Fixed words, English first; Telugu, Hindi and Kannada are drafts that wait for a person until a native reader has checked them.
* **Phone**: when the caller (a customer with a lead) agreed to one of the offered times, it is booked when the call ends. A caller nobody knows yet still lands on Today ("a caller wants to visit on...") for a person to book.
* A visit the assistant booked is **confirmed by message on its own** (WhatsApp, through the outbox: consent, STOP, quiet hours 21:00 to 09:00 and the daily limit still apply), and gets the usual reminders (the evening before, and 2 hours before; settings under Reminders).
* **Talk live and the composer**: the assistant uses these same routes as tools (read the free slots, book, move, cancel; each change still goes through the plan card).
Draw `source: "assistant"` visits with a small "booked by the assistant" mark.

## 6. Google Calendar
`docs/contracts/google-calendar.md` (connect, status, settings `write_events` / `block_busy`, disconnect). When connected with `block_busy` on, busy times appear as `blocked: true` slots.
