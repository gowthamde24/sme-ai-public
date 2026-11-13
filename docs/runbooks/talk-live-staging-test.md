# Talk live: testing it on staging

The owner's Talk live (the bar on Today, Practice, Setup) uses ONE socket: `wss://<api>/v1/tenants/{id}/voice-chat` (contract: `docs/contracts/talk-live.md`, `~/Desktop/stack19-jobs/contract-browser-voice.md`). On staging it is on (`BROWSER_VOICE_ENABLED=true`, `VOICE_TALK_PRIMARY=true` so Cartesia speaks, `BROWSER_VOICE_SESSION_SECONDS=600`, Cloud Run request timeout 660 s).

## A real session without a microphone

`scripts/talk_live_session.py` signs in as a synthetic demo owner and streams wav files as the microphone; it prints every event with its time and saves the assistant's voice. See its header. Telugu speech for the test can come from a Mac (`say -v Geeta ...`).

Checked on 13 Nov 2026 (API revision sme-api-00171-j2v): Telugu partial and final transcripts (Sarvam), a business answer with its source and Cartesia voice, a barge-in (`interrupted`), a spoken action request that asks a question, then a plan card (`confirm_action`) answered No (`action` declined, task cancelled, nothing started). The conversation and the audio are in `~/Desktop/stack19-jobs/talk-live-test-13nov/`.

## When a turn says `ai_paused_until`

The workspace spent its daily hard cap (3 times the plan's daily allowance: ₹60 for free_trial; the day is the UTC day). It is a non-fatal `error`: the session stays open. For a long demo raise the workspace's own daily cap on staging (the owner approves the exact statement first), or wait for 00:00 UTC.

## Cost

Each session writes Sarvam recognition seconds and Cartesia/Sarvam characters to `ops.provider_usage` (`ref_kind assistant_turn`, `ref_id talk-<session id>`). The model tokens of an answer are written by the assistant run. No audio is stored or logged.
