# Live talk: the audio turn model

Owner decision 31 Oct 2026 (job live-conversation-standard, A1): the turn detector may use an open audio model that covers the Indian languages, and falls back to the text rules when the model cannot load.

## What it is

**Indic Smart Turn** (`adimyth/indic-smart-turn` on Hugging Face), BSD-2-Clause. Whisper encoder + attention pooling + a small head, exported to ONNX. It reads the last 8 s of 16 kHz audio (as an 80 x 800 log-mel) and returns the probability that the speaker's turn is over. Trained mostly on real Indian phone speech (IndicVoices, TamilEOT); English and eleven Indian languages including Telugu, Kannada, Tamil, Malayalam and Hindi. The Pipecat Smart Turn and LiveKit detectors cover Hindi only among ours.

| File | Size | Notes |
|---|---:|---|
| `indic-smart-turn-base-int8.onnx` | 24 MB | **used**: recommended by the authors for x86 servers; ~100 ms on one Apple-silicon core |
| `indic-smart-turn-tiny-int8.onnx` | 8.8 MB | ~43 ms on one Apple-silicon core; lighter, slightly less accurate |
| `*-fp32.onnx` | 32 / 81 MB | same function on every CPU; int8 files differ by up to ~3 points between x86 and Arm (their `int8_cpu_dependence.md`) |

The image downloads the base int8 file at build time, pinned to one repository revision and checked against its sha256 (`deploy/Dockerfile.api`). Packages: `numpy`, `onnxruntime` (extra `audio-turn`). The log-mel front end is written in `app/conversation/audio_turn.py` and tested against Whisper's own feature extractor (difference ~1e-7).

## How the loop uses it

`BROWSER_VOICE_AUDIO_TURN` = `off` | `shadow` | `on`.

* The model runs in a worker thread from the moment the recogniser says the caller stopped (`speech_end`), so its answer is ready when the final transcript arrives; the final transcript waits for it at most 250 ms.
* `shadow` (default): the probability is recorded as `audio_p` on the turn's `timings` message; the hold is decided by the text rules as before.
* `on`: `turntaking.blend(state, p)` moves the text reading ONE step: finished words + `p < 0.2` -> unsure; unsure + `p >= 0.7` -> finished, `p <= 0.2` -> unfinished; unfinished + `p >= 0.85` -> unsure. The audio never decides alone.
* Nothing the caller said leaves the process, and nothing but the number is kept.
* No file, no packages, a load that fails or a model that does not answer: one log line (`audio turn model not available (...)`), and the text rules decide.

## Before `on`

The published accuracy is for their own test clips. Switch `on` only after the numbers from `shadow` on real Telugu / Kannada / Tamil / Malayalam / Hindi calls agree with what people actually did (stopped vs. went on). The local check with synthetic text-to-speech clips is not enough: text-to-speech has no breaths and no trailing-off.
