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

## Whisper during a live call (app v4, 6 Nov 2026)

`POST /v1/tenants/{t}/calls/{id}/whisper` (Owner, Admin).
- **Request:** `{"text": "Offer the Saturday visit"}` (1–300 characters).
- **What happens:** only the AI gets it; the caller hears nothing. The AI follows it from its next sentence, also after a language switch. At most the last five whispers are kept, for that call only, and nothing is stored.
- **Response:** 202 `{"status": "sent"}`.
- **Errors:** 409 `call_not_here` (the call runs on another server or has ended; ask again); 404 for another workspace's call; 403 for Sales or a Viewer.
- **Also fixed:** a live call is reachable by its real id. Since 6 Nov its database row is written while the greeting plays, so Hang up and Whisper could not find it by that id before.

Take over (the owner talks to the caller from the app) and Transfer (to a phone number) are not here yet. Transfer needs Exotel: our stream ends, and a Connect applet after it in the call flow dials the number. That's a real call leg and waits for the owner's decision.

## Take over a live call from the app (app v4, 6 Nov 2026)

WebSocket `wss://<api>/v1/tenants/{t}/calls/{id}/take-over` (Owner, Admin; **only in a business that has switched take-over ON**, see "The take-over switch" below).
1. **Sign in:** the first message is `{"type": "start", "access_token": "<the session's token>"}`, within 10 s. A browser cannot put a header on a WebSocket.
2. **Server:** answers `{"type": "ready", "audio_in": {"format": "pcm_s16le", "sample_rate": 16000, "channels": 1}, "audio_out": {…16000…}}`.
   - The AI's voice fades out, and it doesn't answer while the person is on.
   - The call's silence hang-up pauses, but the call's length cap still applies.
3. **Audio:** the server sends binary frames of the caller's audio (16-bit mono PCM, 16 kHz). The browser sends its microphone the same way, and the line resamples it to the call's rate. The caller may talk over the person, and nothing cuts them off.
4. **Hand back:** `{"type": "hand_back"}`, or closing the socket, gives the call back to the AI, which answers the caller's next words.
5. **Call over:** `{"type": "ended"}` when the call itself ends.
6. **Errors:** `{"type": "error", "code": "unauthorized" | "forbidden" | "not_found" | "takeover_off" | "call_not_here" | "unavailable"}`, then the socket closes. `takeover_off`: the business has not switched take-over on. `unavailable` is also what you get when the start could not be written to the audit trail (no entry, no take-over). `call_not_here` means the call runs on another server; try again.
7. **Nothing is recorded.**

## "Correct it" (app v4, 6 Nov 2026)

`POST /v1/tenants/{t}/calls/{id}/correction` (Owner, Admin, Sales).
- **Request:** `{"summary"?: string ≤600, "captured"?: {key: value}, "note"?: string ≤300}`.
  - Send at least one field; a missing field keeps what is there.
  - An empty string (or `{}`) clears that field.
- **Response:** `{"summary", "captured", "note", "corrected_at"}`.
- **What is kept:** the AI's own `summary` and `captured` stay as they were. The correction is shown next to them.
- **`GET /calls/{id}`** now has `correction: {summary, captured, note, corrected_at} | null`.
- **The note:** what the AI should know about how to talk or what it misunderstood (e.g. "Kanchi pattu means Kanchipuram silk"). The latest five notes go into later calls' instructions, so a note may not hold a phone number or an e-mail address.
- **Errors:**
  - 422 `correction_invalid` (a contact in the note);
  - 422 `validation_error` (nothing to correct);
  - 404 for another workspace's call;
  - 403 for a Viewer.

## The English line under the captions (owner, 7 Nov 2026)

`GET /v1/tenants/{t}/calls/{id}`: every `transcript` item now has `text_en: string | null`.
- **When it's filled:** for a line that isn't English (the caller's words, or the AI's when it speaks another language), the fast model translates it in the background. It arrives a few seconds after the line itself. The 5 s refresh picks it up.
- **When it's null:** the line is English already (no letter outside the Latin script), it isn't translated yet, the translation failed, or the call passed its cap of 80 translated lines.
- **Format:** plain text, at most 2,000 characters. It's a reading aid only: the caller's words stay as said, and the web shows the English under them.
- **Only translations (7 Nov 2026):** whole lines only. The model answers NONE when it can't translate, and code drops NONE, a remark about the line, an answer still in another script and anything far longer than the line. Then `text_en` stays null.
- **A live call's lines:** while the call runs on the server that answers the request, Owner and Admin get the lines so far, with their English as it arrives. Sales never get a transcript, live or not. On another server, or once the call ends, it's the saved transcript, which keeps each `text_en`.
- **Cost:** one short fast-model request per non-English line. Nothing is logged but counts.

## One line per turn, and the record of a call (owner, 7 Nov 2026)
- **`transcript`:** one item per assistant turn: the whole reply, or after a barge-in what the caller heard of it, cut between words and ending in "…". A line appears when the turn ends, not word by word. Its `t` is when the turn began. Calls made before this were repaired by migration 20261231360000.
- **`who`:** the contact's name or phone; else the name the caller gave on the call; else "Caller ending 998" (the last three digits); else "New enquiry" (older calls).
- **`name` (new, 7 Nov 2026):** a REAL name only (the contact's, or one the caller gave on the call), else `null`. Use it for sentences: "What {name} wants" when set, otherwise "What the caller wants". Don't build a sentence from `who`.
- **Spacing:** the assistant's lines have a space wherever a Latin word meets an Indian-script word ("నుంచి AI assistant ని"). Earlier calls were repaired by migration 20261231370000.
- **`summary_short`, `outcome`, `category`:** set after every inbound call in which the caller spoke. The summary is one short English line. A call where nobody spoke stays `unclear` with no summary. `captured` may hold `name`.

## The live bar never lies (owner, 9 Nov 2026)
`GET /calls?state=live` (and every call in `GET /calls` and `GET /calls/{id}`) has these new fields:
- **`assistant_name`:** the name the assistant had on that call ("Priya" when none was noted).
- **`line`:** the line it came in on, by the name the operator gave it (Owner and Admin; `null` for Sales).
- **`line_ending`:** the last three digits of that line.

**`live` is true only while all of these hold:** the call is queued, ringing or in progress; it started less than **10 minutes** ago; and the phone server said it was still going within the last 6 minutes. Poll every `poll_after_s` (5 s).

**Orphans:** the phone server tells the database every 20 s that a call is going. A call that says nothing for the call cap + 60 s, or is older than 15 minutes, is closed by the worker as `failed` (end reason `error`), so it leaves the live list and shows with the finished calls. Until then it is simply `live: false`.

The `GET /ai-team/day` "on a call" status follows the same rule.

## Can I take over? (`can_take_over`, 9 Nov 2026)
Every call in `GET /calls` and in `GET /calls/{id}` has `can_take_over: bool`. It is `true` only when Take over (the WebSocket) works for that call right now: the call is live (the rule above), answered, the server answering the request holds its line, and the person is an Owner or Admin. Show Take over only when it is true. It is `false` for Sales and for every finished call. Staging runs one server, so it is true for every live answered call there. Nothing has been tried on a real call yet.

## Place a test call (job 3 phase B, 10 Nov 2026)
`POST /v1/tenants/{t}/calls/place` (Owner only).
- **Request:** `{"to": "+91...", "language": "en"}` (`language` one of en, te, hi, kn, ta, ml, mr; default en). `to` must be a phone on the deployment's sandbox list (the owner's own).
- **What happens:** the gate decides first (mode, sandbox list, hours 09:00 to 21:00 IST, DND, consent, "the AI says it is an AI", open lines). If it allows, a call row is begun, Plivo is asked to ring `to` from the business's own Plivo line, and the call opens the media socket when answered. The assistant opens with "This is a test call to check the phone line" and says it is an AI.
- **Response:** 202 `{"call_id": "...", "state": "ringing"}`; follow it on `GET /calls/{id}`.
- **Errors:** 409 `call_not_allowed` with `reason` (a closed word: `not_on_sandbox_list`, `outside_window`, `telephony_off`, `live_not_confirmed`, `no_consent`, `bad_number`, `no_such_line`, `too_many_calls`, ...); the refusal is kept as a refused call. 502 `call_provider_failed`. 503 `calls_unavailable` (this deployment places no calls: `TELEPHONY_OUTBOUND` off or no Plivo Auth ID / Token). 403 for anyone but the Owner. 422 for an unknown field or language.
- A call nobody answers ends by itself: `busy`, `no_answer`, `failed` or `cancelled`, from Plivo's hangup callback.

## The take-over switch (job 1, 10 Nov 2026)
**Legal status: the lawyer's answer that an owner may listen in on or take over a live call was VERBAL on 10 Nov 2026 and is not confirmed in writing.** The owner proceeds on it; the safeguards stay on whatever the switch says.
- `GET /v1/tenants/{t}/calls/take-over-setting` (Owner, Admin, Sales; `Cache-Control: no-store`) -> `{"enabled": bool, "updated_at": string | null, "announces": bool}`. **Default `enabled: false`** (no row).
- `PUT /v1/tenants/{t}/calls/take-over-setting` (**Owner only**) with `{"enabled": true | false}` (a real boolean: `"yes"` or `1` is a `422 validation_error`; no other field) -> the same body. Every change is in the audit log with who, when and the old and new value (`calls.takeover_setting_changed`). The assistant cannot change it (screen only).
- `can_take_over` is true only when the business has it ON **and** the call is live, answered, on this server, and the person is an Owner or Admin. A setting that cannot be read means false.
- **Audit trail of a session** (`calls.takeover_start`, `calls.takeover_whisper`, `calls.takeover_hang_up`, `calls.takeover_end`, entity `phone_call`): `start` is written before the take-over begins (no entry, no take-over; the database also refuses a start while the switch is off); a whisper is written before it is delivered and holds only its LENGTH (`text_chars`); a hang-up is written after the call is ended and never holds it up; `end` holds `duration_s`. **No word that was said and no audio is ever in the trail.**
- **Nothing is recorded**: `phone_calls.recorded` is forced false, and the telephony code has no path that writes a file or uploads a caller's or a person's sound (`tests/test_to_takeover_switch.py` pins it).
- **What the caller hears:** by default nothing announces it: the assistant's voice fades out and the person speaks. `announces` is true when the deployment runs with `TAKEOVER_ANNOUNCE=true`: a short fixed line ("A team member is now joining this call.", English only until a native reader has approved other languages) is spoken to the caller as the person takes over. The flag is off; the owner decides later.
