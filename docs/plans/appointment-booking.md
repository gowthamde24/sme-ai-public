# Appointment booking (owner decision, 14 Nov 2026): our own booking calendar, optional Google Calendar 2-way sync

Owner: "build our own booking calendar on staging, plus optional Google Calendar 2-way sync. Don't wait for me." Staging only; real calls, real customer messages and production stay off. Owner-only steps are named at the end.

## Decision: one engine. "Appointment" is the word the app shows; the engine is the existing store-visits module

`public.store_settings` (weekly hours, closed dates, slot length, visits at once) + `public.store_visits` (booked, confirmed, arrived, completed, no_show, cancelled; one per slot at a time; per-day lock; India time; confirmation and reminder messages through the outbox; the evening-before and before-the-visit reminders in the scheduler with quiet hours; the read-only calendar feed) already is a booking engine. A second engine would double every rule. So the work is the GAPS, in slices:

| Slice | What | Owner of the work |
|---|---|---|
| 1 Engine | `buffer_minutes` per business; optional staff (`public.store_staff`, own weekly hours, active flag); a booking may name a staff member or "any" (the database assigns the first free one); **DB constraint**: one staff member cannot overlap themselves (exclusion constraint on staff + time range including the buffer), and the capacity check counts the buffer too; slots read `staff_id`; reschedule/cancel keep the rules | C1 |
| 2 Assistant booking | the assistant books only free slots: phone (the caller's number is the contact), WhatsApp, Talk live and the composer, through ONE database function; reschedule and cancel by the customer's own words; a customer's reply "reschedule" on WhatsApp starts a reschedule; every path is covered by the same slots, the same constraint | C1 |
| 3 Reminders | WhatsApp confirmation at booking (automatic, a template), reminder the day before (evening) and 2 h before, quiet hours 21:00 to 09:00 India time respected, reply to reschedule | C1 |
| 4 Google Calendar | OAuth per owner (scopes `calendar.events` + `calendar.freebusy`... see the verification pack), write our bookings to their calendar, read busy times to block slots, push channel (`events.watch`) for changes, disconnect + delete tokens. Behind a fake Google until the owner creates the OAuth client | C1 (agent) |
| 5 OAuth verification pack | `docs/plans/google-oauth-verification.md`: scope justification, demo video script, privacy policy links, test users. The owner submits it | C1 (agent) |
| 6 API for C2 | slots, book, reschedule, cancel, calendar settings, staff, connect / disconnect Google: `docs/contracts/appointments.md` | C1 |

## Rules (all slices)
- India time (Asia/Kolkata) everywhere; a slot belongs to the India date it starts on.
- No double booking, enforced by the database: staff overlap by an exclusion constraint; capacity by the per-day lock plus the count (a constraint cannot say "at most N").
- Buffer: a booking occupies `[starts_at, ends_at + buffer)` for its staff member and for the capacity count.
- Google busy time only BLOCKS slots; it never creates or edits a customer record. A Google event we did not write is never edited or deleted by us.
- Money, spending and real customer contact: staging sandbox only (WhatsApp allowed recipients, `WHATSAPP_ALLOWED_RECIPIENTS`); templates in te/hi/kn stay "uncertain" (a person approves) until a native reader has read them.
- Tokens (Google refresh tokens) are secrets: Secret Manager through the existing workspace-secrets mechanism (`WORKSPACE_SECRETS=gcp`), never in a table, a log or chat. Disconnect revokes at Google AND deletes our copy.

## Owner-only steps (named, not done by C1)
1. Create the Google Cloud OAuth client (staging: Web application, redirect URI from the pack) and put its id and secret in Secret Manager through a hidden prompt (script in the pack).
2. Submit the verification (pack) and the demo video. Until verified: test users only (the owner's account).
3. Approve the WhatsApp appointment templates in Meta Business Manager (the template texts are in the pack of slice 3), and a native reader's check of the Telugu, Hindi and Kannada words.
