# Call quality, Track C: latency (owner, 15 Nov 2026)

Target: the reply starts (caller's last word to our first sound) **p50 < 1.2 s, p95 < 1.5 s**. Measure with `python3 scripts/call_latency_report.py --days 7` (reads the `phone_turn` line of every phone turn from Cloud Logging, per stage, p50/p95) and, for the browser socket with a client and for barge-in, `scripts/live_standard_eval.py --staging ...`. The carrier's own playback delay (Plivo) is not in our log: it needs a sandbox call with the owner (below).

## Baseline (staging, 14 Nov 2026, 57 phone turns, interrupted turns left out)

| stage | p50 ms | p95 ms |
|---|---:|---:|
| end-of-speech wait (`eot`) | 0 | 0 |
| STT final | 193 | 253 |
| first LLM token | 708 | 872 |
| first TTS audio (after the first words) | 68 | 186 |
| final transcript to first sound (`after_final`) | 1041 | 1530 |
| **caller's last word to first sound** | **1222** | **1783** |

Reading: first token (708) is the biggest stage; the rest of `after_final` (about 250 ms) is neither the model nor the voice: it is the wait for the first piece of text to be complete enough to speak (the first piece went at a comma, a stop, or 100 characters). `eot` is 0 because the STT's own end-of-turn decides it (it is not measured separately). Model tier `strong` carries 49 of 57 turns (p50 1219), tier `fast` 8 (p50 1354: slower, small sample).

Browser socket with a client on this Mac, same stack (`live_standard_eval --staging`, run once during a deploy, so cold turns are in it): p50 2257 ms, p95 8725 ms; Kannada p50 5562 ms vs Telugu 2188, Hindi 2367, English 1915. The Kannada tail is a real finding to chase (the staging API runs min-instances 1 with CPU always on, so it is not a cold start). Barge-in on the socket: stop within p50 21 ms, max 84 ms (network taken off), 100 % of real interruptions stop the reply; the thinking-pause set cuts 20 % of turns early (15 turns, bar 5 %) and the noise set 7.7 % (bar 5 %).

## Levers, in the order they are tried (before / after is filled in from the report on staging calls)

| # | lever | change | expected | before p50 / p95 | after p50 / p95 |
|---|---|---|---|---|---|
| 1 | first piece to the voice earlier | the chunker cuts the first piece at 44 characters (was 100) when no comma or stop came; the call style asks for a SHORT first piece (1 to 4 words ending in a comma or stop) | about -190 ms p50 | 1222 / 1783 | |
| 2 | tight prompt, cached context | measure the prompt size per phone turn; cache the stable part (persona, rules, business facts) | first token -100 to -200 ms | | |
| 3 | streaming STT partials and an earlier end of turn | start the model on a stable partial when the words are complete | -100 to -250 ms | | |
| 4 | Cartesia streaming settings | lowest-latency model and sample rate, warm websocket per call, no re-connect per turn | TTS first audio 68 to about 50 ms | | |
| 5 | warm connections | keep the Anthropic and STT connections pooled and pre-opened at call start | removes the connect time of the first turn | | |

Kannada: find why it is 2.5 to 3 times slower (the voice, the model prompt in Kannada script tokens, or the STT).

## Barge-in on a real call (needs the owner)

The socket numbers above are not the carrier. To measure caller speech to our audio stopping on Plivo, one sandbox call to the owner's number is needed: the owner answers and talks over the assistant a few times; we log `barge_in_ms` per interruption. The stop words (te, kn, hi, en) are already covered by the interruption classifier; the sandbox call confirms the carrier leg.

## Natural phone Telugu

Same no-bookish rule and the owner-approved style as the app (native-lines/te.md): short turns (at most two sentences), one question at a time, no repeated question, no early hang-up, a polite close. To be checked on a sample of recorded sandbox calls once lever 1 to 3 are in.
