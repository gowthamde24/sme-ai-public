# Contract: Talk live in the browser (C1 -> C2), 13 Nov 2026

The v6 "Talk live" bar (Today's command bar, My assistant > Practice, Setup) must use the REAL browser-voice socket. The socket exists since job DV (ADR 0118; `~/Desktop/stack19-jobs/contract-browser-voice.md` is the full message list) and is ON on staging:

* `wss://sme-api-620338396268.asia-south1.run.app/v1/tenants/{tenant_id}/voice-chat` (API flag `BROWSER_VOICE_ENABLED=true`, web flag `BROWSER_VOICE=1`).
* Why the owner saw nothing on 13 Nov: the bar played `components/v2/app/ds/talk/script.ts` (a mock) and never connected. Staging logs for the previous five hours show no `voice-chat` connection from the web at all, only `POST /speech/transcribe` (dictation). Nothing failed on the server.

## What the owner asked for, and where it lives

| Owner's ask | Where it is |
|---|---|
| auth = logged-in owner, per business | first message `{type:"start", access_token, language, stt_language?, mode?}` within 10 s; Owner, Admin or Sales of THAT workspace (URL tenant id); one session per workspace at a time |
| mic audio in | binary frames, PCM 16-bit LE, 16 kHz, mono, 20 to 100 ms each (no Opus) |
| Sarvam streaming recognition, te / kn / hi / en (the language picker) | `language` in `start` (and `{type:"set_language", language}` later); `stt_language` pins the recogniser to native script from the first word (send the same code as the picker) |
| same tools and plan-card flow as the composer; any action still needs "Yes, start" | every business turn goes through the written chat's turn: server sends `intent`, `state: thinking` (+ `step`), `source`, then `confirm_action` (the plan); answer with `{type:"confirm", action_id, decision:"yes"|"no"|"change"}` (a tap), or by saying yes/no; server answers `{type:"action", action_id, status, task}`. Nothing starts without it. See "Plan buttons" below. |
| Cartesia streaming voice back | binary frames, PCM 16-bit LE, 24 kHz, mono, in order (staging speaks Cartesia: `VOICE_TALK_PRIMARY=true`; the `voice` message names the voice, `timings.engine` says which engine spoke) |
| barge-in like phone calls: 450 ms + stop words | the browser sends `{type:"barge_in"}` when it hears the person over the assistant and stops its own playback; the server judges it: speech of at least **450 ms** (the phone's number, was 300), two real words, or a STOP WORD interrupts at any length; a cough or "hmm" lets the reply go on (`state: paused`, then `resumed`). `audio_stop` = flush playback now |
| end-of-turn detection | server side (semantic turns); the browser just keeps streaming audio while listening and sends nothing about turn ends |
| 10-minute session cap | staging: 600 s (`BROWSER_VOICE_SESSION_SECONDS`), the Cloud Run request timeout is 660 s. A `notice {code:"session_ending", seconds_left}` comes before the end, then `{type:"limit", reason:"session", fatal:true}` and the socket closes. Other reasons: `idle` (60 s with no completed turn), `daily_limit`, `goodbye` |
| cost in the usage ledger | at the end of every session: Sarvam recognition seconds and Cartesia / Sarvam characters, `ref_kind assistant_turn`, `ref_id talk-<session id>` (the admin console's "Usage & cost" reads them). The answer's model tokens are written by the assistant run as for the written chat |
| no recording unless the owner turns it on | audio is never stored and never logged (ids and numbers only). There is no recording switch for Talk live; none is needed |
| events to the browser | `state` (listening / thinking / speaking / paused), `transcript` (interim every 250 ms at most, `final:true` once), `caption`, `confirm_action` (the plan card), `lead_finder`, `action`, `error` (`fatal` or not), `limit`, `interrupted`, `notice`, `source`, `voice`, `timings` |

## Plan buttons (Yes / No / Change) on the socket

One path for taps and words: the buttons send `confirm`; the assistant hears the decision, answers aloud and listens again.

| Client sends | Server does | Server sends, in order |
|---|---|---|
| `{type:"confirm", action_id, decision:"yes"}` | approves the plan and starts it (as `POST /tasks/{id}/approve`) | `action {status:"confirmed", task}`; then, if no answer is being spoken, `state: speaking` + `caption` ("Okay, I will go ahead.") + audio + `audio_end`; then `state: listening` |
| `decision:"no"` | cancels the plan | `action {status:"declined", task}`; the same spoken line ("Okay, I will not do it."); `state: listening` |
| `decision:"change"` | drops this plan like a no, so nothing runs, and asks what to change | `action {status:"declined", task, change:true}`; `state: speaking` + `caption` ("Okay. What would you like to change?") + audio + `audio_end`; `state: listening`. The owner's next words are a normal new turn (the assistant makes a new plan card) |

* The spoken line is in the session's language (te, hi, kn, en, ...). If the assistant is already speaking an answer when the tap arrives, only the `action` message comes back (never talking over itself).
* A plan that needs a second factor (`confirm_action.needs_second_factor: true`) and a tap on Yes: the server answers with a non-fatal `error {code:"mfa_required", message:"Confirm with your authenticator app to do this: sign in again and enter your code, or set up the app first.", fatal:false}`. Nothing starts, nothing is spoken, the plan stays waiting (tap again after the second factor; No and Change need no second factor). Show `message` as plain words.
* Other plain errors, all non-fatal: `action_expired` ("That plan waited too long. Ask again and I will make a fresh one."), `action_state` ("That plan was already answered." / "That plan was cancelled."), `not_found`, `validation_error` (bad id), `forbidden` (Admin and Sales may talk to the assistant but only the Owner can answer a plan: any decision gets "Only the owner can say yes to a plan."), `not_available`.
* The typed chat keeps `POST .../confirm`; both reach the same server function, so the same rules apply.

## Wiring checklist for `use-talk-live.ts`

1. Replace the script player with `lib/browser-voice/client.ts` (it already opens the socket, streams the mic with echo cancellation and plays the 24 kHz answer). Keep the bar's look; the states map one to one: `listening`, `thinking`, `speaking` (`paused` can show as `speaking`).
2. The owner's line = `transcript` (interim in a quiet style, replaced by the final one). The assistant's line = `caption` with `who:"assistant"`.
3. The plan card = `confirm_action`; its Yes / No buttons send `confirm`. Show the card's text as the server sends it. Do not start anything in the browser.
4. Errors: a non-fatal `error` is one failed turn (the session goes on), for example `ai_paused_until` ("AI help is paused because this workspace's AI allowance for the period is used up", words in `message`); a fatal one is followed by a close code (4401 sign-in, 4403 not allowed, 4429 `busy` / `rate_limited` / `daily_limit`, 4503 unavailable). Show `message` as plain words.
5. Practice (My assistant): `start` with `mode:"practice"` (Owner and Admin): the owner plays the customer and hears the PHONE assistant. Command bar: the default mode.
6. Mobile Safari: resume the audio context from the tap that opens Talk live.

## "What can you do?" (13 Nov 2026)

A question about the assistant itself (Telugu, Kannada, Hindi, English, plus Tenglish and Hinglish; `classify(...).reason == "about_assistant"`) is answered at once from fixed words (`app/turns/words.py ABOUT_ASSISTANT`), with no model call: in the written chat (`text` events, `done kind answer`) and in Talk live (state `speaking`, a `caption`, the voice, `audio_end`; no `timings` message for that turn). It is not written to the stored thread by Talk live. The words name only what the product does today and are short enough to be spoken whole. Before this a Telugu "what can you do?" went down the data path: 15 s and, twice in a row, "sorry".

## Measured on staging (13 Nov 2026, Telugu, real providers)

See `docs/runbooks/talk-live-staging-test.md`.
