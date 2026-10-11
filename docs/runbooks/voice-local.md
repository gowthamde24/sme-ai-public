# Runbook: voice (job BD, ADR 0071)

Voice is **off** unless you switch a provider on. Nothing here opens an account, spends money by itself or stores a recording.

## Try the plumbing for free (no provider, no key)
Development only: `VOICE_STT_PROVIDER=fake VOICE_TTS_PROVIDER=fake make dev-api-local API_PORT=8001`. The fake "hears" a fixed sentence and "speaks" a short tone. Then

```
curl -s -X POST "http://localhost:8001/v1/tenants/<tenant>/assistant/voice?message_id=$(uuidgen)&speak=true" \
  -H "Authorization: Bearer <a signed-in token>" -H "Content-Type: audio/wav" --data-binary @some.wav
```
streams `event: transcript`, the usual `text` / `source` / `draft` / `done` events and `event: audio` (base64).

## Switch a real provider on (when you decide to)
Enter the key hidden, in the terminal that starts the API, never in a file:

| Provider | Environment | Notes |
|---|---|---|
| Sarvam | `VOICE_STT_PROVIDER=sarvam`, `VOICE_TTS_PROVIDER=sarvam`, `SARVAM_API_KEY` | `SARVAM_STT_MODEL` (saaras:v4), `SARVAM_TTS_MODEL` (bulbul:v3), `SARVAM_TTS_SPEAKER`. Set zero retention in the Sarvam dashboard (Settings, Workspace, Data retention). |
| Bhashini | `BHASHINI_API_KEY`, `BHASHINI_ASR_SERVICE_ID`, `BHASHINI_TTS_SERVICE_ID` | proof-of-concept use only, per Bhashini; text to speech not tested live |
| Google Cloud | `GOOGLE_API_KEY` (Speech-to-Text and Text-to-Speech APIs switched on in that project) | cannot read M4A: use WAV, WebM, Ogg, FLAC or MP3 |
| AI4Bharat | `AI4BHARAT_STT_URL`, `AI4BHARAT_TTS_URL`, optional `AI4BHARAT_TOKEN` | an address you run; the contract is in `app/voice/ai4bharat.py` |

Voice needs speech to text; speaking the answer is optional (`speak=true`). A provider named without its key stops the API at start.

## Limits and costs
60 seconds a recording; 500 spoken characters an answer; both are counted against the workspace's AI allowance (ADR 0071: Rs 0.60 a minute listening, Rs 4 per 1,000 characters speaking, deliberately a little above the dearest list price). A used-up allowance answers 429 `ai_paused_until` before any audio is sent. A run's own budget for the model is Rs 1.00; a run that carries voice may be charged up to Rs 3.00 in all for its voice charges. A RETRY (same message id and conversation) reuses the stored words, calls no speech engine and charges nothing.

## Compare the engines on your own voices
`~/Desktop/v2-overnight/voice-recording-guide.md` says what to record and how. Then `make stt-bakeoff` (DIR defaults to `~/Desktop/voice-samples`); the table lands in `~/Desktop/v2-overnight/voice-bakeoff.md`.

## When something is wrong
| You see | Meaning |
|---|---|
| 503 `voice_unavailable` | no speech-to-text provider is configured |
| 415 `audio_unsupported` | not WAV / M4A / WebM / Ogg / FLAC / MP3 (or Google and an M4A) |
| 422 `audio_too_long` | over 60 seconds |
| 422 `no_speech` | the engine heard nothing |
| 502 `voice_failed`, 504 `voice_timeout` | the provider failed or was slow; the log has a code (`http_429`, `timeout` ...), never the provider's words |
| log `assistant router miss: tool=... language=...` | the tool router did not offer a tool the model wanted; add a word to `app/assistant/router.py` |
