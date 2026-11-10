# ADR 0123: the live take-over safety switch

Status: built (job 1, 10 Nov 2026), staging only until the owner has reviewed.

## Context
Owners can already listen to a live call's caller and speak to them from the app (take over, app v4), and whisper to the assistant or hang up. Nothing switched this off per business, and none of it was written to an audit trail. The owner's lawyer said **by phone** on 10 Nov 2026 that an owner may listen in on or take over a live call. **That answer is verbal and not confirmed in writing**; the owner proceeds on it, with these safeguards, which stay in force whatever any switch says: the assistant never claims to be human and answers honestly when asked; outbound calls only 09:00 to 21:00 IST; DND respected; consent or an enquiry record kept; no recording; every switch change logged with who and when.

## Decisions
1. **A per-business switch, default OFF** (`workspace.call_takeover_settings`, `public.call_takeover_get/_set`; migration `20261231460000`). Only the Owner turns it on (a strict boolean). Every change is audited with the old and new value.
2. **`can_take_over` and the take-over socket honour it**, fail closed (an unreadable setting is "off"); the database itself refuses a `start` event while it is off (a second lock).
3. **Every session event is audited** (`public.call_takeover_event`): start, whisper, hang_up, end, by name and number only (duration, length of a whisper). `start` and `whisper` are written BEFORE the act (no entry, no act); `hang_up` after (ending a call is never held up); `end` best-effort.
4. **Nothing is recorded**: no code path writes or uploads audio; a test scans the telephony package and runs a whole take-over to prove nothing is left behind.
5. **The announcement to the caller is an option behind a flag, default off** (`TAKEOVER_ANNOUNCE`; a fixed English line spoken through the call's own voice). The owner chooses later.
6. **The assistant cannot change the switch** (screen only, forbidden for the assistant in the tools catalog).

## Not decided / open
Whether the caller should be told (the flag); whether "listen only" without taking over is wanted (not built: the audio of the caller reaches the person only through a take-over); the lawyer's written confirmation.
