# Real WhatsApp voice notes with Sarvam: what to set up (job DJ, ADR 0093)

Nothing here has been done. Today every voice note is spoken by the fake provider in development and not at all in staging or production (the text goes alone).

## What only the owner can do
1. **A Sarvam account and API key** (dashboard.sarvam.ai). Free credits may exist; Bulbul v3 is billed per character (about Rs 3 per 1,000 characters on the page the bake-off recorded: check the current pricing page before approving).
2. **Store the key in Google Secret Manager** under the name **`sme-sarvam-api-key`** (project `project-2757c07e-37d2-4167-88f`). Never in Git, a chat, a report or a log. Give the WORKER's service account (`sme-worker-run`) `secretAccessor` on that one secret.
3. **Tell the worker about it:** deploy the worker with `SARVAM_API_KEY=sme-sarvam-api-key:latest` among its secrets (`WORKER_EXTRA_SECRETS="SARVAM_API_KEY=sme-sarvam-api-key:latest" ./deploy/cloudrun.sh worker --execute`, or through `deploy/staging.sh`), and leave `VOICE_NOTE_TTS_PROVIDER` at `auto` (or set `sarvam`). The image already has ffmpeg; the worker refuses to start with a Sarvam key and no ffmpeg.
4. **A native speaker for each language (Telugu, Hindi, Kannada, English) listens** to Bulbul v3's speakers and decides which one the product uses; the same person reviews the spoken AI-disclosure line of that language (job CV: a draft wording is spoken only over synthetic data). Sarvam's page lists the v3 speakers (for example `shubh`, `kavya`, `ritu`, `priya`, `rahul`) without saying which suits which language, so this is a listening decision.
5. **A WhatsApp test number** to hear a clip arrive as a voice note (Meta's pages do not say what makes WhatsApp draw an uploaded OGG/Opus as a "voice message"; confirm it on a phone).

## Then the operator registers the reviewed voices (SQL, operator only)
```sql
select app.operator_register_voice('sarvam-kavya-te', 'sarvam', 'te', 'Kavya (Telugu)', 'kavya', 'name of the person who listened');
```
One row per voice and language. A voice without a reviewer is refused. The Owner of a business then picks it for a language (`PUT /v1/tenants/{id}/voice-notes/choices/te`, second factor) and switches it on for a campaign.

## Checks
* `docker run --rm --entrypoint python <image> -m app.voice.convert` prints `voice convert self-test ok: ogg/opus mono, ... bytes`.
* `make container-smoke` runs the same check on the freshly built image.
* A first real note: a campaign with voice on, one recipient (the owner's own number, with consent), `make dev-worker-local`-style tick against staging after the key is in place.
