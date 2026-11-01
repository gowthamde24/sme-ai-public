# The speaker check (browser Live talk only)

Owner decision 31 Oct 2026. While the assistant speaks and a sound interrupts, the recogniser cannot say whether it is the owner or a television. A small open model answers one question: **is this the same voice as the one that has been talking in this session, or not?**
It never says who anyone is, never compares across sessions, and **phone calls are excluded until the December lawyer review** (`CallVoiceSession.is_phone`; a test pins it).

## The model

| | |
|---|---|
| Model | CAM++ speaker embedding from **3D-Speaker** (Alibaba DAMO), ONNX build of `speech_campplus_sv_zh_en_16k-common_advanced` (Mandarin + English; the voice, not the language, is what it compares) |
| Licence | **Apache-2.0** (model and 3D-Speaker; features by `kaldi-native-fbank`, Apache-2.0) |
| Size | 28.3 MB (fp32, **used**), 14.7 MB (fp16), 8.6 MB (int8; separates less well: see below) |
| Where it runs | on our side, in the API process, onnxruntime on one CPU thread; nothing is sent to any provider |
| Pinned in the image | Hugging Face `Luigi/campplus-zh-en-onnx` revision `aa79cf9b`, sha256 `aa3cfc16...`, by `deploy/fetch_audio_turn_model.py`; loaded only when `BROWSER_VOICE_SPEAKER_CHECK` is `shadow` or `on` |

## Status

Staging runs it in `shadow` for the owner's browser sessions (`BROWSER_VOICE_SPEAKER_CHECK=shadow` in `deploy/staging.sh`): each judged interruption logs `browser_voice_speaker mode= same= score= ms=` (numbers only: no audio, no signature, no words) and sends the same to the browser. `on` stays off until a recording of the owner plus a real TV or YouTube voice ("voice-9") shows separation. The language gate (`BROWSER_VOICE_LANGUAGE_GATE`, off) is removed in the same PR that turns the speaker check `on`.

## What is kept, and for how long

A signature (the mean of up to 8 embeddings of what the person said in the session) **in memory only, for one session**. Never written to disk, a database, a log, analytics or any provider (a test fails if the code opens a file for writing); dropped when the session ends (`SessionVoice.close()`, called from `VoiceSession.run`'s `finally`). No signature yet (the first turn), too little speech (under 0.8 s) or an unclear answer: the sound is treated as the person, an interruption (stopping beats talking over the owner). The first two turns build the signature freely; later turns are added only if they still match (a TV does not drift it). Stop words always interrupt.
The score goes to the browser in a `speaker` message (`same`, `score`, `ms`) and nowhere else.

## Measured (31 Oct 2026; Mac, one thread, the owner's six clean recordings and 47 other voices)

| | fp32 (used) | int8 |
|---|---|---|
| Owner's 1.5 s windows (n = 18, signature from the other five recordings): lowest / 5th percentile / mean | 0.19 / 0.41 / 0.61 | 0.32 / 0.46 / 0.63 |
| 47 other voices (text-to-speech speakers, ~2 s): highest / mean | 0.43 / 0.15 | 0.47 / 0.23 |
| Threshold 0.40: owner accepted / other voices rejected | **94 % / 98 %** | 94 % / 94 % |
| Threshold 0.45: owner accepted / other voices rejected | 94 % / 100 % | 94 % / 98 % |
| Time for a 1.0 s / 1.5 s / 3.0 s clip, median (max) | **18 (22) / 24 (25) / 48 (55) ms** | 9 / 12 / 22 ms |

Chosen: fp32, threshold **0.40** (`speaker.SAME_AT_LEAST`). The time is spent AFTER the line has been paused for the sound (the pause is immediate, measured 0 ms server side), when the words are known and the session decides to stop or go on; the judge takes the last 3 s: 48 ms here, expect two to three times that on a Cloud Run x86 core (not measured: the check is off until the owner approves the results). Within the 200 ms barge-in budget on this evidence.

**Voice 6 (the owner, music in the first 1.5 s), 1.5 s windows every 0.75 s against the owner's signature: the speaker check matched the truth.** The owner confirmed on 1 Nov 2026 that all the speech in the recording is the owner and that the only other sound is music at 0 to 1.5 s. The check scored the music **0.06 (different voice, rejected)** and every stretch with speech **0.58 to 0.76 (the owner, accepted)**, at the check's own 0.40 threshold. The earlier "TV words" ("Maatlu ippudu edaina", "Peddam", "Let's find out the dates") were the owner's own "ఇప్పుడు ఏదైనా చేద్దాం", "చేద్దాం" and "ఫైండ్ అవుట్ చేద్దాం" mis-heard on language auto (pinned to Telugu the recogniser writes them correctly). Numbers: `tests/evals/recordings/speaker_scores_voice6.json`. Still missing for `on`: a recording with a real TV or YouTube voice speaking over the owner ("voice-9").

## Shadow run on Cloud Run staging (1 Nov 2026): latency and what the scores really are

Staging runs `BROWSER_VOICE_SPEAKER_CHECK=shadow` (owner sessions, browser only). Each judged interruption writes one numbers-only line (`browser_voice_speaker mode= same= ready= score= ms=`; also `browser_voice_speaker_enrol kept= speech_s= clip_s=` per confirmed turn): no audio, no words, no signature. Probe: `scripts/speaker_shadow_probe.py` (the owner's own recordings as the voice, 3 interruptions a session after two enrolment turns). 24 interruptions, all scored:

| Clip scored | n | time in the server, p50 / p95 / max | score (the owner's own voice, signature from two short turns) |
|---|---|---|---|
| the last 3 s of the interruption (first version) | 12 | **21 / 33 / 33 ms** | -0.02 to 0.45, median 0.32 |
| everything since the barge-in began, at most 6 s (now) | 12 | **54 / 67 / 70 ms** | -0.04 to 0.43, median 0.19 |

Latency is inside the 200 ms barge-in budget on Cloud Run (the line is already paused when this runs). **The scores are NOT usable yet:** against the signature that two short turns make (3.1 s of speech in total on staging: `speech_s` 2.0 and 1.1) the owner's own voice scored far below the 0.61 average of the offline test (signature from five recordings). At 0.40 the check would have said "not the speaker" for 9 of the owner's 12 interruptions in the second run. Hence the readiness rule: **the signature is used only after 6 s of the person's speech are enrolled** (`MIN_ENROLLED_S`); before that the check gives no opinion and the sound interrupts, whatever the mode. Found on the way: a failed first enrolment used to still count as a free first turn, so the next voice (a television) could become the signature; fixed (a clip without speech is not a turn), and a later voice must match to be added (the Mac's text-to-speech voice was correctly refused: `kept=False`).
What is still needed before `on`: a run where the enrolled speech is 6 s or more (a normal conversation, or the probe with more owner turns) and "voice-9" (the owner plus a real TV or YouTube voice).

## Privacy-notice line (wording APPROVED by the owner 31 Oct 2026, with "in the app"; UNPUBLISHED until the speaker check goes `on`)

> "During a voice conversation in the app, your voice is compared with the earlier part of the same conversation so that other voices in the background, such as a television, do not interrupt the assistant. This comparison happens in memory on our server for the length of the conversation only; nothing about your voice is stored or kept after it ends."
