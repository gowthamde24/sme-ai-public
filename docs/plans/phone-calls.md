# Job: AI phone calls (outbound + inbound) on a telephony sandbox

Owner brief (31 Oct 2026): reuse the Live-talk pipeline (Sarvam STT, router, Cartesia voice, turn-taking, barge-in, language pinning, pronunciation, no-"sir" rule, AI-disclosure setting). Outbound only after owner approval or a standing rule; calling hours; DND and consent checks; recording OFF by default; transcript + summary into the lead; a "Calls" page showing live and finished calls. Sandbox first. Staging only. FAST MODE.

Written 31 Oct 2026 by C1 before any code. Status of each part is at the bottom.

---

## 1. Which provider, and what you must create

**Exotel. Create an Exotel TRIAL account.** Reasons (all from Exotel's and Plivo's own documentation, read today):

| | Exotel | Plivo |
|---|---|---|
| Already in our code | **Yes**: the click-to-call bridge, missed-call webhook, `EXOTEL_*` settings, ADR 0080 | No |
| Live audio in/out | **Voicebot applet**: bidirectional WebSocket, raw 16-bit PCM mono, base64, **8 / 16 / 24 kHz chosen by `?sample-rate=`**; events connected, start, media, dtmf, stop, mark, **clear** | Audio Streaming: bidirectional WebSocket, mu-law / linear16 |
| Our STT wants 16 kHz | **16 kHz native** (`?sample-rate=16000`), so no resampling on the way in | 8 kHz (resample) or L16 16 kHz |
| Barge-in | `clear` event drops audio already sent but not yet played; chunks of 100 ms | `clearAudio` event |
| Trial / sandbox | Trial account: **15 days, 1,000 credits, a shared trial number**, calls between **verified users** of your account (no KYC needed), a sandbox number | Trial: calls only to **sandbox-verified numbers**; an Indian number needs KYC documents |
| India specifics | India company, DND metadata API (`DND: Yes/No/Unavailable`), TRAI/DLT guidance, India numbers | India numbers need KYC |
| Cost | about Rs 0.5 to 1.5 per minute (quote needed); trial credits cover the sandbox | audio streaming from about USD 0.0028 per minute plus the call |

Plivo stays the fallback: our code puts the provider behind one interface (below), so a Plivo adapter is a small, separate piece of work. Nothing else in the job depends on Exotel.

### What YOU create (I do not create accounts)

1. **Sign up for an Exotel trial account** at exotel.com (India). Use the business e-mail and a mobile you hold; verify by giving a missed call to 09513885656 or 02249360005 from that mobile. After that the dashboard shows **trial credits** and a **trial phone number** (the ExoPhone).
2. **Add one or two more "verified users"** (your own second phone, a colleague's) in the same account: trial calls only go between verified numbers. These are the only numbers any test will ever ring.
3. **Ask Exotel to switch on the Voicebot applet** (Exotel says "this applet might not be available by default for all accounts": write to hello@exotel.in, or the dashboard chat, or 08088 919 888 on WhatsApp). Ask for: *Voicebot (bidirectional streaming) on a trial account, 16 kHz, with WSS basic-auth or IP allow-list*. This is the one step that can take a day; everything else I can do without it.
4. In the dashboard, **App Bazaar > create a Custom App** with the flow `Voicebot applet` and nothing else, URL as I will give you in step 5 below (I will send you the exact `https://.../v1/telephony/exotel/stream-url` once the endpoint is deployed), "Record" **unticked**. Note the App id.
5. **Collect and put in Secret Manager** (same way as the Resend keys; I will tell you the exact `gcloud` lines once you confirm the names; remember `--condition=None` on IAM commands):
   * `sme-exotel-sid` (account SID), `sme-exotel-api-key`, `sme-exotel-api-token` (API settings in the dashboard), and the subdomain (`api.in.exotel.com` unless the dashboard says otherwise);
   * `sme-exotel-caller-id` (the trial ExoPhone, as shown in the dashboard);
   * `sme-exotel-stream-secret` (a long random string I will generate for you; it is the basic-auth password Exotel sends to our WebSocket).
6. Tell me the **numbers** (verified users) I may call in the sandbox; I put them in the sandbox allow-list, and the code refuses any other number while `TELEPHONY_MODE=sandbox`.

Until you have done 1 to 3 I build and test everything against a **local simulator** that speaks Exotel's protocol (same messages, same chunk rules), so no day is lost.

---

## 2. What exists and what is new

Reused as they are:

* **Live-talk loop** (`app/conversation/pipeline.py`, `app/browser_voice/session.py`): Sarvam realtime STT, fast/strong router, Cartesia + Sarvam fallback TTS, semantic turn-taking, pause/resume, barge-in with verification, language pinning, pronunciation, the no-"sir" register, spoken-text honesty, check-in/goodbye, fillers policy, audio turn model. The browser WebSocket is only a transport; a phone call is another transport for the same session.
* **Call settings** (`app/callsettings`, ADR 0098): calling days and hours, holidays, per-customer weekly limit, retries, voicemail and phone-menu behaviour, longest call, handover rules by topic, pronunciations. Read through `effective`.
* **Outreach** (ADR 0108, `app/outreach`, SQL `app.outreach_*`): plans approved once with a second factor, standing rules per lead source, caps that pause, retries, outcomes, hot-lead hand-off, reports. Its dialer is an interface (`Dialer.dial(call) -> DialResult`) with a FAKE implementation; "when telephony exists a real dialer replaces the fake behind the same interface and the same two door functions (`scheduler_outreach_run`, `outreach_item_result`)".
* **Tasks** (`app/tasks`, ADR 0109): the owner's "call these people" plans with the yes; same fake dialer today.
* **Consent and suppression** (`app.can_contact`, suppression keys, `lead_flags` DND, STOP list), **AI disclosure** (ADR 0116: opening line + "mention AI"), **lead timeline / outcomes**.
* **Activity feed** (`/assistant/activity`): `call` items appear there as soon as a call row is live.

New:

1. `app/telephony/` the provider interface, the Exotel adapter, the sandbox simulator, the media transport (`PhoneLine`) and the call session.
2. DB: `public.phone_calls` (+ `phone_numbers`, `phone_call_turns`), RPCs, RLS, pgTAP.
3. A **gate** (pure code, one function) that every call, outbound or inbound, passes before audio flows.
4. A **real dialer** behind the outreach and tasks interfaces.
5. Inbound handling.
6. `GET /calls`, `GET /calls/{id}` for the Calls page; live and finished.
7. Summary writer and the lead-timeline entry.
8. Evals, a local call simulator, the staging sandbox run.

---

## 3. Architecture

```
outbound:  outreach/tasks (already approved)  ->  gate  ->  Exotel Make-a-Call API (From = the person, CallerId = ExoPhone,
           Url = our Voicebot flow, CustomField = call id)  ->  Exotel rings the person  ->  on answer Exotel opens
           wss://<api>/v1/telephony/exotel/stream?sample-rate=16000&c=<call id>  ->  PhoneLine  ->  the same session loop as Live talk
inbound:   person rings the ExoPhone -> the same flow opens the same WSS (no c=) -> gate (number known? hours? open lines?) -> PhoneLine -> session
```

* **Where it runs.** The WebSocket server is the API service (it already serves `voice-chat`). The scheduler worker only *starts* outbound calls (REST) and records results; it never holds audio.
* **Provider interface** (`app/telephony/provider.py`): `place_call(to, caller_id, call_id) -> provider_call_sid`, `hang_up(sid)`, `verify_stream_auth(headers)`, `parse_events(ws)`, `send_audio`, `clear_audio`. Adapters: `ExotelProvider`, `SandboxProvider` (a local simulator: scripted caller audio, real timings, used by CI and by `scripts/phone_sim.py`), later `PlivoProvider`.
* **PhoneLine** (`app/telephony/line.py`) adapts the stream to what the session already expects: frames in (16 kHz PCM, `FrameBus`), `BrowserPlayout`-style paced audio out in 100 ms chunks that are multiples of 320 bytes, `stop()` = Exotel `clear` (barge-in in under 200 ms), DTMF digits as events (press 1 to talk to a person, 2 to stop calling).
* **Audio:** in = Exotel 16 kHz PCM straight to Sarvam; out = Cartesia (24 kHz) resampled to 16 kHz. If the account only gives 8 kHz, the line resamples both ways; the sample rate is read from the `start` message, never assumed.
* **Session:** `CallSession` is `VoiceSession` with a different socket, a `phone` mode (no captions, no UI messages), the call's language pinned (the contact's or the workspace default; no auto-switch unless the contact asks), the opening line with the AI disclosure first, hours/limits/handover from `effective`, and the **phone tool set** (see 5).
* **Hard limits** (config values): `PHONE_MAX_CALL_S` (call settings' longest call, default 180 s for outbound), `PHONE_MAX_CONCURRENT` (default 2 in sandbox), a **kill switch** `TELEPHONY_MODE=off|sandbox|live` (default `off`; `live` is refused in code until a person sets `TELEPHONY_LIVE_CONFIRMED=true`), per-workspace daily call and minute caps.

---

## 4. The gate (nothing is dialled or answered without it)

One pure function `telephony.gate.check_outbound(...) -> Allowed | Refused(reason)` and one `check_inbound(...)`. Reasons are closed words; every refusal is stored on the call row.

Outbound, all must hold:
1. `TELEPHONY_MODE` is `sandbox` or `live`; in `sandbox` the number is on the sandbox allow-list (your verified users) and nothing else.
2. **Approved**: the call belongs to an approved task or outreach plan (hash matches, second factor already given) or to a **standing rule** the Owner approved. No other path creates a call; there is no "just call" API.
3. The workspace may spend (billing gate), is not read-only, and the **purpose is allowed** (a school never gets sales or fee calls: the existing school rule).
4. **Hours**: the effective call hours of call settings, in India time, no holidays, never before 09:00 or after 21:00 (the regulation's window), per-customer weekly limit, retry rules, daily call cap and minute cap.
5. **Consent**: `app.can_contact(contact, 'phone')` is true for this purpose; not on the STOP list; not erased or archived; the number is a valid Indian mobile or landline format.
6. **DND**: promotional or sales calls need the contact not flagged DND (`lead_flags`) and, when the provider can say, a live check (Exotel Number Metadata `DND` field) with the answer cached for the day; `Unavailable` is treated as DND for promotional purposes and allowed only for transactional ones (appointment reminders, payment reminders to an existing customer). The purpose class (promotional / transactional) comes from the call settings' purposes.
7. **AI disclosure**: the opening line carries "AI" (the existing `has_ai_disclosure` test) unless the owner's setting is "mention AI = off", in which case the call is refused for outbound anyway if the workspace has not recorded the lawyer's answer (see Needs owner); inbound follows the setting.
8. Not already in a call with that number; concurrency below the limit.

Inbound: ExoPhone belongs to a workspace (`phone_numbers`), that workspace has "answer inbound calls" switched on, hours (outside hours the assistant answers with a short message and offers a callback, it does not hold a conversation), concurrency, and the caller is not on the block list. A caller who says stop, do not call, or presses 2 is added to the suppression list at once.

**Recording is off by default** (the Voicebot applet's Record box stays unticked; our code never stores audio). A workspace switch `record_calls` exists in the data model, default `false`, ignored by the sandbox. If it is ever turned on the opening line says the call is recorded; that is built last and only after the lawyer's answer.

---

## 5. During the call

* **Tools** the phone assistant may use (read-only unless stated): the catalogue and price list (find_price), the lead's own record (what was asked before), visit slots, **propose_visit** (creates a booking request, not a booking), **record_outcome**; nothing that spends money, sends a quote or changes a price. Anything it cannot answer it says it will pass on, and the call ends with a **handover** note to the member named in the call settings for that topic.
* **Honesty rules** carried over from Live talk: spoken text equals what is said, no invented price or promise, the contact's name only if the record has it, never "sir/madam".
* **Voicemail and phone menus** (detected by the first seconds of audio plus silence rules): the call settings' action (hang up / leave a short message / retry later).
* **End of call:** goodbye detection, the longest-call limit with a polite close, a hang-up from the other side (stop event) ends the session within a second.

## 6. After the call

* `phone_calls` row finished with outcome (the same closed outcome words as outreach: interested, visit_booked, not_interested + reason, call_back_later + `callback_at`, wrong_number, already_bought, no_answer, busy, voicemail, failed), duration, cost in paise (minutes x the policy rate).
* **Transcript** (turn by turn, speaker, text, timestamp; stored in `phone_call_turns`, readable by Owner and Admin, erased with the contact; never written to logs) and a **summary** (3 lines, written by the fast model from the transcript in the language of the call, plus the structured fields the lead reader already understands). Both appear on the lead's timeline as "AI call, 2 min 10 s, interested, visit Saturday" with a link to the call.
* The outreach/task machinery gets its result through the same door functions (`outreach_item_result`, `task_contact_result`), so retries, caps, hot-lead hand-off and reports keep working unchanged.
* Retention: transcripts follow the existing retention/erasure registry (`erasure` job); no audio is stored.

## 7. The Calls page (contract for C2)

* `GET /v1/tenants/{t}/calls?state=live|finished|all&cursor=...` -> `{items:[{id, direction, state, who (display_name), language, started_at, answered_at, ended_at, elapsed_s, duration_s, outcome, summary_short, lead_id, task_id, simulated}], next_cursor}`; **live** calls first, 5 s polling hint like the activity feed.
* `GET /v1/tenants/{t}/calls/{id}` -> the above plus the transcript turns and the structured outcome (Owner/Admin; Sales see their own leads' calls).
* `POST /v1/tenants/{t}/calls/{id}/hang-up` (Owner/Admin): ends a live call.
* `POST /v1/tenants/{t}/calls/stop` (Owner/Admin): pause all calling in the workspace (the same pause flag outreach uses).
* Calls appear in `/assistant/activity` as `call` items while live.
* Sandbox calls are marked `simulated: true` or `sandbox: true` so the web can say so next to the transcript.

---

## 8. Build plan (one PR per part; each ends with ruff, mypy, the whole unit suite, pgTAP when the DB changes)

| # | PR | Contents | Needs the account? |
|---|---|---|---|
| 1 | **Gate + data** | `phone_calls`, `phone_call_turns`, `phone_numbers`, RPCs, RLS, pgTAP; `telephony.gate` with every rule above and a table-driven test per rule; config values | no |
| 2 | **Line + simulator** | Exotel protocol parser/encoder (start/media/dtmf/stop/mark/clear), `PhoneLine`, `SandboxProvider`, `scripts/phone_sim.py`; chunk-size rules, `clear` on barge-in, 8 and 16 kHz | no |
| 3 | **Call session** | `CallSession` over the Live-talk loop in phone mode: opening line with AI disclosure, pinned language, hours/limits/longest call, voicemail, handover, DTMF, post-call transcript + summary + timeline entry | no (simulator) |
| 4 | **Outbound** | `ExotelProvider.place_call`, status callback, real dialer behind outreach and tasks, per-call state machine, stop/pause, sandbox allow-list | partly (REST needs the keys) |
| 5 | **Inbound** | `phone_numbers` -> workspace, inbound gate, unknown caller -> new enquiry (display name rule), after-hours message | needs the Voicebot applet |
| 6 | **Calls page API** | `GET /calls`, `GET /calls/{id}`, hang-up, stop; activity-feed items; contract file for C2 | no |
| 7 | **Evals + sandbox run** | 40 phone dialogues (te/en/hi/kn, voicemail, wrong number, "stop calling", "who is this", barge-in, silence, bad line), gate refusals, and a recorded sandbox run on your trial account | yes |

Parts 1 to 3 and 6 can be finished with the simulator alone; 4, 5 and 7 need your steps 1 to 6.

## 9. Evals (written in part 7, started in part 3)

* Gate: every refusal reason has a test, and a "no way around it" test (no code path reaches `place_call` without `gate.check_outbound`).
* Phone dialogues (`tests/evals/phone/dialogues.jsonl`): the Live-talk quality bar re-run over the telephone transport: first words after answer under 1.5 s; the AI disclosure is the first thing said; barge-in stop under 300 ms (including the provider's buffer); a wrong number ends politely and suppresses; "do not call again" suppresses; voicemail ends in the configured way; a pinned Telugu call stays Telugu; no "sir"; no invented price; the summary has no fact that is not in the transcript.
* Sandbox run on staging: 3 outbound calls to your verified numbers and 2 inbound, each with the transcript, summary, outcome and timeline entry shown; numbers in `~/Desktop/stack19-jobs/phone-calls-check/`.
* Cartesia characters per test call are counted in the ledger (about 400 characters a call; **no heavy staging runs**, the month is already over the 60,000 target).

## 10. Needs owner (decisions and facts I cannot supply)

1. The Exotel steps in section 1 (account, verified users, Voicebot applet enabled, App, secrets, the allowed numbers).
2. **Legal answers before `live` (not before the sandbox)**: TRAI/TCCCPR and DLT registration for the business that will call (Exotel needs the entity registered for promotional calls), which calls count as promotional or transactional, whether an AI voice must announce itself in the first sentence (we do, always, for outbound), recording and its consent wording, whether calling a lead who left a number on a form is allowed for that purpose and for how long after, number series to use (140-series for promotional). This is already on the pre-pilot checklist as "automated voice calls blocked on the lawyer's and the provider's answers". I build to the stricter reading: AI disclosed first, hours 09:00 to 21:00, DND respected, no recording, stop at once on request.
3. ~~Standing rule vs. daily tap~~ decided: see 10b.1.
4. ~~Per-minute cost~~ decided: configurable, see 10b.3.

## 10b. Owner decisions (31 Oct 2026, after the plan)

1. **Standing rules may approve calls to NEW INBOUND leads, but ship OFF** (no workspace has one until the Owner switches it on with the second factor). The **pilot uses one daily batch approval in Needs you: "Approve today's N calls"**: the existing outreach plan (ADR 0108) built once a day from the leads that are due, shown with its count, hours and cost, approved once by the Owner. Part 4 wires this; no call is placed from a standing rule in the sandbox unless that rule was switched on.
2. **Legal items wait for the December lawyer.** The strict reading stays built in (AI says it is an AI first, 09:00 to 21:00, DND respected, no recording, stop at once on request), and `TELEPHONY_MODE` stays `off` everywhere except the sandbox; `live` is refused by the gate until `TELEPHONY_LIVE_CONFIRMED=true`.
3. **Price:** the owner will ask Exotel. Until then the cost of a call is `minutes x TELEPHONY_COST_PAISE_PER_MINUTE` (a configurable value, placeholder 100 paise, NOT a quote) and every report shows it as an estimate.
4. Exotel account: the owner is creating the trial account and has asked Exotel to enable the Voicebot applet; the verified numbers follow. Parts 1 to 3 and 6 are built against the simulator meanwhile.

## 11. Not in this job

Voice cloning, call recording (switch exists, off, not wired), WhatsApp calling, conference/transfer to a human mid-call (handover is a note and a callback in this job), numbers purchase, anything on `live`.

---

## Status

| Part | State |
|---|---|
| Plan (this file) | written 31 Oct 2026 |
| 1 Gate + data | not started |
| 2 Line + simulator | not started |
| 3 Call session | not started |
| 4 Outbound | not started |
| 5 Inbound | not started |
| 6 Calls page API | not started |
| 7 Evals + sandbox | not started |
