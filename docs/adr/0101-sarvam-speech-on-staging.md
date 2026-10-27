# ADR 0101: Sarvam as the voice provider, one speech switch (night 3, part 1)

Status: built on branch `voice/sarvam` (night run 27 Oct 2026). Staging only; every test and CI run uses the fake provider.

## Decision
1. **Sarvam is the voice provider** (owner decision); Cartesia stays a later alternative behind the same interface. `app/voice/sarvam.py` already held the adapters (Saaras `saaras:v4` for speech-to-text, Bulbul `bulbul:v3` for text-to-speech); they are extended, not duplicated. Docs checked on docs.sarvam.ai: the speech-to-text page now lists only the Saaras models (the Saarika line is not on it), so Saaras is used.
2. **One switch, `SPEECH_PROVIDER`** (empty | fake | sarvam). Empty means exactly what it meant before (each `VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER`, `VOICE_NOTE_TTS_PROVIDER` decides; off unless named), so nothing changes anywhere by default and CI never sees Sarvam. `sarvam` turns on speech-to-text, text-to-speech and WhatsApp voice notes and stops the process at start when `SARVAM_API_KEY` is missing. `fake` is for development; it also keeps a worker that happens to hold a key silent. A provider named explicitly still wins over the switch. Only `deploy/staging.sh` sets `SPEECH_PROVIDER=sarvam`, on the API and the worker, with `SARVAM_API_KEY` from Secret Manager (`sme-sarvam-api-key`) through `--set-secrets`.
3. **Languages en, te, hi, kn, ta, ml**: `ml` (Malayalam, `ml-IN`) joins the voice languages (`app/voice/interface.py`); Sarvam takes it for both directions.
4. **WhatsApp audio is OGG/Opus**: Bulbul v3 refuses `opus`, so Sarvam answers WAV and the existing converter (ffmpeg, in the worker image) makes mono OGG/Opus; a real provider is always paired with the converter or the process stops at start (job DJ, unchanged).
5. **Listening samples and the speech-to-text check are opt-in scripts** (`make voice-samples`, `make voice-stt-check`, `scripts/voice_samples.py`), never part of `make check` or CI. Hard caps counted BEFORE sending and kept across runs in `usage.json`: 9,000 characters of text-to-speech and 180 seconds of audio for speech-to-text. The key is read into a variable from Secret Manager, never printed, logged or written. The lines are drafts for native review.
6. **Styles**: Bulbul v3 has no style switch, only `pace` and `temperature`; "warm" is 0.95 pace and 0.7 temperature, "crisp" 1.1 and 0.3.

## Consequences
- On staging, the voice routes switch on for real: every spoken answer and voice note costs Sarvam credits (about Rs 3 per 1,000 characters, Rs 30 per hour of audio). The click-through's Ask pages may request a spoken answer (up to 500 characters each).
- The database still decides which voices a workspace may use (`operator_register_voice`); a voice belongs to one provider.
