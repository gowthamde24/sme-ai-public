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
| same tools and plan-card flow as the composer; any action still needs "Yes, start" | every business turn goes through the written chat's turn: server sends `intent`, `state: thinking` (+ `step`), `source`, then `confirm_action` (the plan); answer with `{type:"confirm", action_id, decision:"yes"|"no"}` (a tap), or by saying yes/no; server answers `{type:"action", action_id, status}`. Nothing starts without it. |
| Cartesia streaming voice back | binary frames, PCM 16-bit LE, 24 kHz, mono, in order (staging speaks Cartesia: `VOICE_TALK_PRIMARY=true`; the `voice` message names the voice, `timings.engine` says which engine spoke) |
| barge-in like phone calls: 450 ms + stop words | the browser sends `{type:"barge_in"}` when it hears the person over the assistant and stops its own playback; the server judges it: speech of at least **450 ms** (the phone's number, was 300), two real words, or a STOP WORD interrupts at any length; a cough or "hmm" lets the reply go on (`state: paused`, then `resumed`). `audio_stop` = flush playback now |
| end-of-turn detection | server side (semantic turns); the browser just keeps streaming audio while listening and sends nothing about turn ends |
| 10-minute session cap | staging: 600 s (`BROWSER_VOICE_SESSION_SECONDS`), the Cloud Run request timeout is 660 s. A `notice {code:"session_ending", seconds_left}` comes before the end, then `{type:"limit", reason:"session", fatal:true}` and the socket closes. Other reasons: `idle` (60 s with no completed turn), `daily_limit`, `goodbye` |
| cost in the usage ledger | at the end of every session: Sarvam recognition seconds and Cartesia / Sarvam characters, `ref_kind assistant_turn`, `ref_id talk-<session id>` (the admin console's "Usage & cost" reads them). The answer's model tokens are written by the assistant run as for the written chat |
| no recording unless the owner turns it on | audio is never stored and never logged (ids and numbers only). There is no recording switch for Talk live; none is needed |
| events to the browser | `state` (listening / thinking / speaking / paused), `transcript` (interim every 250 ms at most, `final:true` once), `caption`, `confirm_action` (the plan card), `lead_finder`, `action`, `error` (`fatal` or not), `limit`, `interrupted`, `notice`, `source`, `voice`, `timings` |

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
