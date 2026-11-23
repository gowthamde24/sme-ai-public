#!/usr/bin/env python3
"""Two BLIND samples per language and gender for the owner to choose between (owner, 20-21 Nov 2026: "we can use both Sarvam and Cartesia"). NOT RUN by the people who wrote it: it calls two paid voice providers.

For every language and gender it renders the same ~10 second line (the catalogue's sample line: services/ai-api/app/conversation/voices.py SAMPLE_LINES) with the LISTED Cartesia voice and the LISTED Sarvam voice of that language and gender, and writes
them under random file names (<out>/<language>-<gender>-1.wav and -2.wav), so the listener does not know which is which. The key (which file is which voice and provider) goes in a separate file, <out>/answer-key.json, to be opened AFTER listening.

    python scripts/voice_blind_samples.py --out /tmp/blind                    # dry run: prints what would be sent and the estimated Sarvam rupees; sends nothing
    CARTESIA_API_KEY=... SARVAM_API_KEY=... python scripts/voice_blind_samples.py --out /tmp/blind --yes [--only te] [--max-sarvam-rupees 20]

Money: Sarvam's stop line is Rs 800 in total (Rs 103 spent on 20 Nov); the script refuses to send more than --max-sarvam-rupees (default 20) worth of Sarvam characters, at the price in SARVAM_RUPEES_PER_1000_CHARS (default 1.0, the Bulbul v4 Flash pay-as-you-go
price of docs.sarvam.ai/api-reference-docs/getting-started/pricing on 20 Nov 2026; Sarvam's blog says Rs 2 per 1,000: check before a real run). Cartesia is covered by the owner's subscription. Keys come from the environment only."""


from __future__ import annotations

import argparse
import base64
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.conversation.voices import default_config, sample_text

TAG = {"te": "te-IN", "hi": "hi-IN", "kn": "kn-IN", "en": "en-IN", "ta": "ta-IN", "ml": "ml-IN", "mr": "mr-IN"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", help="one language code")
    ap.add_argument("--yes", action="store_true", help="really call the providers (without it: a dry run)")
    ap.add_argument("--max-sarvam-rupees", type=float, default=20.0)
    ap.add_argument("--seed", type=int, default=None, help="for a repeatable order of the two files")
    args = ap.parse_args()
    rupees_per_1000 = float(os.environ.get("SARVAM_RUPEES_PER_1000_CHARS", "1.0"))
    cfg = default_config()
    rng = random.Random(args.seed)
    jobs = []
    for language in ("te", "en", "hi", "kn", "ta", "ml"):
        if args.only and language != args.only:
            continue
        for gender in ("female", "male"):
            listed = cfg.voices_of(language, gender, listed_only=True)
            cartesia = next((v for v in listed if v.provider == "cartesia"), None)
            sarvam = next((v for v in listed if v.provider == "sarvam"), None)
            if cartesia is None or sarvam is None:
                continue   # a language with only one provider listed has nothing to compare
            pair = [cartesia, sarvam]
            rng.shuffle(pair)
            jobs.append((language, gender, pair))
    chars = sum(len(sample_text(language)) for language, _, pair in jobs for v in pair if v.provider == "sarvam")
    cost = chars / 1000 * rupees_per_1000
    print(f"{len(jobs)} pairs; Sarvam {chars} characters = about Rs {cost:.2f}; Cartesia {sum(len(sample_text(lang)) for lang, _, _ in jobs)} characters (subscription)")
    if not args.yes:
        print("dry run: nothing sent (add --yes)")
        return 0
    if cost > args.max_sarvam_rupees:
        print(f"refused: Rs {cost:.2f} is over --max-sarvam-rupees {args.max_sarvam_rupees}")
        return 2
    import httpx

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    key: dict[str, dict[str, str]] = {}
    with httpx.Client(timeout=60) as client:
        for language, gender, pair in jobs:
            text = sample_text(language)
            for n, voice in enumerate(pair, 1):
                if voice.provider == "cartesia":
                    r = client.post("https://api.cartesia.ai/tts/bytes", headers={"X-API-Key": os.environ["CARTESIA_API_KEY"], "Cartesia-Version": "2025-04-16"},
                                    json={"model_id": voice.voices.primary.model, "transcript": text, "voice": {"mode": "id", "id": voice.voices.primary.voice}, "language": language, "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 24000}})
                    r.raise_for_status()
                    audio = r.content
                else:
                    r = client.post("https://api.sarvam.ai/text-to-speech", headers={"api-subscription-key": os.environ["SARVAM_API_KEY"]},
                                    json={"text": text, "target_language_code": TAG[language], "speaker": voice.voices.primary.voice, "model": voice.voices.primary.model, "speech_sample_rate": 24000})
                    r.raise_for_status()
                    audio = base64.b64decode(r.json()["audios"][0])
                name = f"{language}-{gender}-{n}.wav"
                (out / name).write_bytes(audio)
                key[name] = {"voice_id": voice.id, "provider": voice.provider, "name": voice.name}
    (out / "answer-key.json").write_text(json.dumps(key, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(key)} files and answer-key.json in {out}: listen first, open the key after")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
