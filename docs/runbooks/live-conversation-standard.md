# Live talk: the conversation standard (owner, 31 Oct 2026)

What Live talk does, rule by rule (the owner's list A to E), where it is, and what is measured. The code: `services/ai-api/app/conversation/turntaking.py` (pure rules), `pipeline.py` (the loop), `browser_voice/session.py` (the session), `conversation/style.py` (the voice prompt). The eval: `tests/evals/live/dialogues.jsonl` (40 dialogues: te 15, en 10, kn 8, hi 7), `app/conversation/live_eval.py`, `scripts/live_standard_eval.py`, tests `tests/test_oq_live_standard.py`. The latest numbers: `~/Desktop/stack19-jobs/voice-v2-check/live-standard.md`.

## Which open turn-detection model covers Indian languages (checked 31 Oct 2026)
| Model | Kind | Languages | Telugu / Kannada / Tamil / Malayalam |
|---|---|---|---|
| Pipecat Smart Turn v3.x (BSD-2) | audio, Whisper-tiny based, ONNX, CPU 10 to 60 ms | 23, incl. Hindi, Marathi, Bengali | **no** |
| LiveKit turn detector (multilingual) | text, small LM | 14, Hindi the only Indian one | **no** (their forum: "for Punjabi and Tamil you would have to use VAD") |
| **Indic Smart Turn** (`adimyth/indic-smart-turn`, BSD-2, data CC BY 4.0) | audio, Whisper-base based, ONNX (int8 and fp32, base and tiny), 8 s of 16 kHz audio in, under 50 ms on one CPU core | English + Hindi, Marathi, Bengali, **Tamil, Telugu, Kannada, Malayalam**, Gujarati, Punjabi, Odia, Assamese; trained on IndicVoices phone speech and TamilEOT; 85.9 % on the human-checked TamilEOT test | **yes** |

So there is an open model for our languages, and it is the right audio-side answer. It needs raw audio on the server (we have it: `FrameBus`), `onnxruntime`, the Whisper log-mel front end and the model file in the image. **What ships now** is the cheap text classifier of the standard's A1 (`turntaking.completeness`), plus the hook for the audio model (`AudioTurnModel`). The eval shows exactly what the text classifier cannot do (the pauses with no cue in the words), which is what the audio model is for; integrating it is the next step.

## The rules
| Rule | What it does | Where |
|---|---|---|
| A1 | After the recogniser's silence, a thought that is not finished ("2000 sq ft ki...", a connective, a postposition, a filler) is not answered: the line is listened to for up to ~2.8 s and what comes next is joined to it (at most 4 pieces). A number or a size said last waits ~0.9 s. A finished thought is answered at once. | `turntaking.completeness/hold_ms`, `Conversation._listen` |
| A2 | The pauses this speaker takes inside a turn are learned; the quiet that ends their turn follows (never below the language's value, never above 900 ms) and the unfinished-thought wait grows with it. | `PauseModel`, `SarvamRealtimeStt.set_silence_ms` |
| A3 | Speculative start: **not built** (needs the model started on a stable partial and discarded when they go on; the cost and the cancel path are a separate decision). | |
| B1 | A sound while the assistant speaks pauses the line within 200 ms (the browser flushes its queue). | `Conversation.pause` |
| B2/B4 | A cough, a click, a "hmm / haan / ok / అవును / ಹೌದು" does not take the turn: after ~1.8 s of quiet the reply is picked up where it stopped (the audio the browser had not played is sent again). Two real words, or speech with words over 300 ms, end the reply and become the next turn (already heard, not asked again). | `classify_interruption`, `VoiceSession._judge_interruption` |
| B3 | The stored assistant turn is only what was heard (the clauses played, and the words of the cut one). Nothing heard: no assistant turn. | `spoken_prefix`, `Conversation._heard` |
| C1 to C10 | Short; no markup / links / emoji; no repeated opening or filler; preamble before slow work; read a value back and wait for yes before acting; ask once to repeat; never invent a fact; shorter and warmer for a tired or rushed caller; neutral address (no sir/madam). | `conversation/style.py` |
| D3 | ~8 s of quiet after we finished: one gentle check-in ("ఉన్నారా అండీ?"); ~30 s in all: a polite goodbye and the session closes (`limit` idle). | `VoiceSession._listen_for_turn` |
| D4 | "bye", "thank you, that's all", "ఇంక చాలు", "बस इतना ही", "ಸಾಕು": a short goodbye and the microphone stops at once (`limit` goodbye). | `is_goodbye`, `_say_goodbye` |
| D5 | A soft warning two minutes before the session cap (`notice` session_ending). The cap itself is `BROWSER_VOICE_SESSION_SECONDS`. | `soft_warning_due` |

## What the browser must send and understand (C2)
* `{"type":"barge_in","verify":true}`: "something made a sound while the assistant spoke": the server pauses and judges. Without `verify` a `barge_in` still stops for good, at once (as before).
* New messages from the server: `{"type":"paused","ms":n}` with `{"type":"state","state":"paused"}` (show Paused); `{"type":"resumed","after":"noise|backchannel"}` with `{"type":"state","state":"speaking"}` (the reply goes on; the browser plays what is sent again); `{"type":"interrupted","ms":n,"spoken":"..."}` now carries what the caller heard (mark the cut turn "Interrupted" with that text); `{"type":"notice","code":"session_ending","seconds_left":n}`; `{"type":"limit","reason":"goodbye","fatal":true}` (the caller said goodbye: stop the microphone now); the idle `limit` is now preceded by a spoken goodbye, and a check-in question is spoken at ~8 s.
* Settings: `BROWSER_VOICE_SEMANTIC_TURNS` and `BROWSER_VOICE_VERIFY_BARGE_IN` (default on) switch the two behaviours.

## Known limits (reported, not hidden)
* Cue-less pauses ("నాకు కావాలి ... ఆ నీలం రంగు చీర": a clause that already reads as complete) are cut by the text classifier. The audio model is the answer.
* A TV or a second person talking in the background has words, so by text it is a real interruption. Telling it from the caller needs the audio (level, distance, speaker); not built.
* The recogniser is reopened after an unfinished thought, so the first few tens of milliseconds of the continuation can be lost.

## The latency bar (owner decision 31 Oct 2026)

Browser Live talk, a casual turn, from the caller's last word to the first audio of the assistant, measured on staging with a socket client (`scripts/live_standard_eval.py --staging`): **p50 ≤ 1.6 s, p95 ≤ 2.5 s.** Reported twice: as measured, and with one round trip of the measuring machine to the server taken off (what a caller near the server would feel). Measured the same day on the Live code of tag 8cace2a9: p50 1,909 ms (1,520 ms without the round trip), p95 2,180 ms (1,791 ms): the p95 passes, the p50 as measured does not, without the round trip it does.
Phone calls have their own model test: `docs/runbooks/phone-model.md`.

## Real-voice recordings

The owner's recordings of 31 Oct 2026 are kept as text and timings only (`tests/evals/recordings/`); the audio is never committed. Findings and the recommendation (audio turn model stays in shadow, `transcribe` and never `verbatim` for Telugu and English): `~/Desktop/stack19-jobs/recordings-check/report.md`.

## Command-like turns (owner decision 31 Oct 2026)

A finished-looking command (Telugu, English, Kannada imperatives that do something to people: send, call, message, remind, పంపించు, చేయి, ಕಳುಹಿಸಿ ...) waits `BROWSER_VOICE_COMMAND_WAIT_MS` (900 ms) for more before it is handed over, so a quantity or a name said after a short pause is kept. Questions and chat never wait. The `timings` message carries `command: true`; **command turns are their own latency group, not part of the 1.6 s / 2.5 s bar of questions.** Code: `turntaking.is_command`, `Conversation(command_hold_ms=...)`. On the real recording of 31 Oct the quantity after the pause (0.82 s) is now kept.

## Barge-in: stop words, the language gate, the speaker check (owner decisions 31 Oct 2026)

* **Stop words always interrupt** (`BROWSER_VOICE_STOP_WORDS`, default list in `turntaking.STOP_WORDS`): in any language, however short, whatever the pill says. With a language pill set the recogniser writes the English word in the pill's script, measured: "stop" -> స్టాప్, "wait" -> వెయిట్, "hold on" -> హోల్డన్; those spellings are in the list.
* **Language gate** (`BROWSER_VOICE_LANGUAGE_GATE`, default OFF, not switched on in staging): built as approved (barge-in only, only with the pill set, Tenglish in Latin never counts as English, stop words exempt) **but it does not work with this recogniser and is not recommended.** Measured: with the language on auto, Sarvam labels the owner's Tenglish in Latin "en-IN" with 0.94 to 0.99 confidence (3 of 3 pieces), so its language code cannot tell Tenglish from English; with the language pinned (the only case the gate applies to) it returns no code at all AND writes the English it hears in the pill's script ("Who should I call first today?" -> "హూ షుడ్ ఐ కాల్ ఫస్ట్ టుడే?"), so a TV in English is no longer recognisable as English from the text. The gate therefore decides from the words (clear English in Latin letters for an Indian pill) and almost never fires in a real pinned session. Kept off pending the owner's decision; the speaker check below is the mechanism that can work.
* **Speaker check** (`BROWSER_VOICE_SPEAKER_CHECK`, default off): `docs/runbooks/speaker-check.md`.
