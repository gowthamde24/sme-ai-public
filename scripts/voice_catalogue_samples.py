#!/usr/bin/env python3
"""Pre-render the listening sample of every catalogue voice (job voice-picker). OPT-IN: the one script of the job that calls a voice provider. The screen's "play" button serves these files, so the provider is never called
when someone clicks play (cost and caps). Run it again only when the catalogue (services/ai-api/app/conversation/data/voices.json) changes.

    CARTESIA_API_KEY=... [SARVAM_API_KEY=... --check-fallbacks] python scripts/voice_catalogue_samples.py [--only te-sindhu] [--check-fallbacks]

Writes services/ai-api/app/conversation/data/samples/<voice id>.mp3: the same two spoken-style lines in the voice's language with a neutral business name ("Sample Stores"), one MP3 (44.1 kHz, 96 kbps, mono)
per voice. Keys come from the environment only. Characters sent are counted and printed; `--check-fallbacks` sends a few words (about 60 characters in all) to each distinct Bulbul v4 Flash fallback voice to prove it exists."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.conversation.voices import SAMPLES, default_config  # noqa: E402

BUSINESS = "Sample Stores"
LINES = {
    "te": "నమస్కారం అండీ, నేను {name}, {b} నుంచి మాట్లాడుతున్నాను. ఒక్క నిమిషం అండీ, check చేసి చెప్తాను. సాయంత్రం ఆరు గంటలకి call చేయనా?",
    "hi": "नमस्ते जी, मैं {name} बोल रही हूँ, {b} से। एक मिनट जी, देख कर बताती हूँ। शाम छह बजे call करूँ?",
    "kn": "ನಮಸ್ಕಾರ ಸರ್, ನಾನು {name}, {b} ನಿಂದ ಮಾತಾಡ್ತಾ ಇದ್ದೀನಿ. ಒಂದು ನಿಮಿಷ ಸರ್, ನೋಡಿ ಹೇಳ್ತೀನಿ. ಸಂಜೆ ಆರು ಗಂಟೆಗೆ call ಮಾಡ್ಲಾ?",
    "en": "Hello, this is {name} from {b}. One moment, I'll check and tell you. Shall I call you after six?",
}
SHORT = {"te": "హా అండీ", "hi": "हाँ जी", "kn": "ಹೌದು ಸರ್", "en": "Hello"}
TAG = {"te": "te-IN", "hi": "hi-IN", "kn": "kn-IN", "en": "en-IN"}


def sample_text(language: str, gender: str) -> str:
    return LINES[language].format(name="Vijaya" if gender == "female" else "Vijay", b=BUSINESS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="one voice id")
    ap.add_argument("--check-fallbacks", action="store_true")
    args = ap.parse_args()
    cfg = default_config()
    SAMPLES.mkdir(parents=True, exist_ok=True)
    chars = 0
    key = os.environ.get("CARTESIA_API_KEY", "")
    if key:
        with httpx.Client(timeout=60) as client:
            for c in cfg.catalogue.values():
                if args.only and c.id != args.only:
                    continue
                text = sample_text(c.language, c.gender)
                chars += len(text)
                r = client.post(
                    "https://api.cartesia.ai/tts/bytes",
                    headers={"X-API-Key": key, "Cartesia-Version": "2025-04-16"},
                    json={"model_id": c.voices.primary.model, "transcript": text, "voice": {"mode": "id", "id": c.voices.primary.voice}, "language": c.language, "output_format": {"container": "mp3", "sample_rate": 44100, "bit_rate": 96000}},
                )
                r.raise_for_status()
                c.sample_file.write_bytes(r.content)
                print(f"{c.id}: {len(r.content) // 1024} KB")
    else:
        print("no CARTESIA_API_KEY: samples not rendered")
    print("characters sent to Cartesia:", chars)
    if args.check_fallbacks:
        skey, sent, seen = os.environ["SARVAM_API_KEY"], 0, set()
        with httpx.Client(timeout=60) as client:
            for c in cfg.catalogue.values():
                f = c.voices.fallback
                if f.voice in seen:
                    continue
                seen.add(f.voice)
                sent += len(SHORT[c.language])
                r = client.post("https://api.sarvam.ai/text-to-speech", headers={"api-subscription-key": skey}, json={"text": SHORT[c.language], "language_code": TAG[c.language], "model": f.model, "speaker": f.voice, "output_audio_codec": "wav"})
                ok = r.status_code == 200 and bool(base64.b64decode(r.json()["audios"][0]))
                print(f"fallback {f.voice} ({c.language}, {f.gender}): {'ok' if ok else 'FAILED ' + str(r.status_code)}")
        print("characters sent to Sarvam:", sent)


if __name__ == "__main__":
    main()
