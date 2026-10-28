# 0118: Talk to the assistant in the browser (job DV)

Status: accepted (28 Oct 2026). Builds on ADR 0117 (the streaming conversation loop) and ADR 0102 (models per job).

## Decision
1. **One WebSocket per session**, `/v1/tenants/{id}/voice-chat`. The browser sends 16 kHz PCM16 frames; the server runs the SAME `Conversation` as the phone loop (streamed recogniser -> model -> first clause to the voice -> streamed audio, Cartesia with the v4 Flash fallback, the pronunciation map, the workspace's chosen voice). Nothing of the loop is forked: two small additions only (`Conversation.listen()` and an `on_stt` hook for captions).
2. **Sign-in in the first message** (a browser cannot set a header on a WebSocket); the token and the membership are checked exactly as a request's would be; Owner, Admin, Sales only; the read-only, waiting-for-WhatsApp and terms rules apply. The Origin header, when sent, must be a configured origin.
3. **Two tiers behind the loop's one model port.** Short turns go to a fast streaming model (Claude Haiku, the model already approved and priced on staging; Sarvam 105b is faster but needs its price row and spend confirmation, so it is the setting `BROWSER_VOICE_TURN_MODEL=sarvam`, not the default). Everything about the business's data goes to **Ask** (`start_message`), so tools, citations, the honesty rule and the cost ledger are Ask's, not a second copy. Ask's answer is spoken in whole sentences up to about 420 characters; the rest is shown as captions marked not spoken, with the sources.
4. **Barge-in is the browser's message** (`barge_in`): the line is stopped first (`audio_stop`: the browser flushes its queue, it plays faster than the server sends), then the model and the voice are cancelled. The server runs no voice detector of its own (the microphone hears the loudspeaker).
5. **Caps and cost logging.** Per workspace: 5 minutes a session, 30 minutes and 6,000 voice characters a day, 6 sessions a minute, one at a time. One log line per session with ids and numbers (seconds, recogniser seconds, characters per engine, turns); never audio or words. 
6. **Off by default** (`BROWSER_VOICE_ENABLED`), on for staging in `deploy/staging.sh`; a half-set configuration stays off and the log names the missing setting.

## Follow-up (same day)
7. **Durable daily caps.** The day's seconds, voice characters and sessions per workspace are a table (`workspace.browser_voice_days`, India's day, numbers only), read when a session is admitted and written back every 15 s and when it ends, through two bounded functions called with the member's own token. Two instances and a restart share one count; if the database cannot be reached the session carries on on the memory count and the unwritten numbers are kept for the next try.
8. **A pre-rendered filler per catalogue voice.** 3 to 4 short "one moment" lines per language (`fillers.BANK_LINES`; the first Telugu line is the approved wording of native-lines/te.md, the rest are drafts for a native reader) are rendered once for every voice by `scripts/voice_filler_bank.py` (668 Cartesia characters in all) into `data/fillers/`, and played when Ask has said nothing for 700 ms. They cost no characters at run time. The filler is cut by `barge_in` like any other audio.

## Consequences
- Opus input is not accepted in v1.
- Cloud Run's request timeout (300 s) bounds a session; the session cap equals it.
