# Voice notes and the one reports API (job CV, ADR 0088)

Local only. No key, no paid provider, no real customer data.

## Try the voice notes on your machine
1. `make agent-db-up` (agent stack) or your own local stack; apply the migrations (`make db-reset` on the agent stack).
2. In `services/ai-api/.env.local`-style environment (never committed) set `VOICE_STT_PROVIDER=fake` and `VOICE_TTS_PROVIDER=fake` for the API **and** for the worker (development only; a fake in any other environment stops the process). The worker (`make dev-worker-local`) builds the speech provider from the same settings.
3. An education workspace has the `voice_notes` module on. As the **Owner with a second factor**: `PUT /v1/tenants/{id}/voice-notes/settings` (`enabled: true`), then `PUT /voice-notes/choices/en {"voice_code": "fake-en"}`.
4. `GET /voice-notes/disclosure/en` shows the line that will be spoken (a first draft; usable only while the workspace holds synthetic data). `POST /voice-notes/preview` returns a short base64 WAV and counts its seconds (`GET /voice-notes/usage`).
5. On an approved-able campaign: `PUT /voice-notes/campaigns/{campaign_id} {"enabled": true}` (the campaign goes back to draft; approve it again). When the worker releases a step, the local fake channel receives the text **and** an audio clip.

## What a real WhatsApp send does
The text goes first. Then, only if the customer's 24-hour window is open and the clip is ogg, mp3, aac, mp4 or amr, the clip is uploaded to Meta and sent as an audio message. A WAV (what the fake makes) is never sent to Meta; a real provider adapter must produce an accepted format before voice notes can reach a real phone.

## When there is no audio
The message went as text because: the module or a switch is off, no voice is chosen for the language, the wording is a draft after the gate opened, the allowance is used up (`GET /voice-notes/usage` says `paused`), the text was over 600 characters, the speech provider failed or the seconds could not be recorded. The worker logs only a code.

## Reports
`GET /v1/tenants/{id}/reports/catalogue` lists what this caller may run; `GET /reports/run/{code}?from=YYYY-MM-DD&to=YYYY-MM-DD` runs one. The codes are `weekly.summary`, `construction.*` and `education.*`; the contract is `packages/contracts/reports.*`.

## Checks
pgTAP `108_cv_voice_notes` and `109_cv_reports`; `tests/test_cv_routes.py`, `tests/test_cv_voice_dispatch.py`, `tests/test_migration_copies_cv.py`; integration `tests/integration/test_cv_voice_reports.py`.
