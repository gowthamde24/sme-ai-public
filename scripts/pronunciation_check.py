#!/usr/bin/env python3
"""Check a pronunciation entry with an ear proxy (job natural-voice). OPT-IN: renders short sentences with Cartesia and runs Sarvam speech recognition on them.

    CARTESIA_API_KEY=... SARVAM_API_KEY=... python scripts/pronunciation_check.py WORD [WORD ...] [--voice janvi|devansh] [--respelled-only]

For each word: a sentence ("We are calling about WORD today.") is spoken twice, as written and through app/conversation/pronounce.py, and what the recogniser heard is printed. A word the recogniser writes back the same (or a known spelling of the same place) is pronounced right; one that comes
back as another word ("Canada") is not. The recogniser is a proxy for a listener, not a replacement: listen to anything that matters. Characters sent are counted and printed. Keys from the environment only."""


from __future__ import annotations

import argparse
import difflib
import os
import re
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.conversation.pronounce import default_pronunciations

VOICES = {"janvi": "7ea5e9c2-b719-4dc3-b870-5ba5f14d31d8"}
SAME = {"bengaluru": {"bangalore", "bengaluru", "bengalooru"}, "anantapur": {"anantapur", "anantapuram", "ananthapur", "ananthapuram"}, "dharmavaram": {"dharmavaram"}}


def heard_right(word: str, heard: str) -> bool:
    got = re.findall(r"[a-z']+", heard.lower())
    ok = SAME.get(word.lower(), {word.lower()})
    return any(g in ok or max((difflib.SequenceMatcher(None, g, o).ratio() for o in ok), default=0) >= 0.95 for g in got)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("words", nargs="+")
    ap.add_argument("--voice", default="janvi")
    ap.add_argument("--respelled-only", action="store_true")
    ap.add_argument("--try", dest="tries", action="append", default=[], metavar="WORD=SPELLING", help="test a respelling without editing the data file (repeatable)")
    args = ap.parse_args()
    pron = default_pronunciations().with_extra(dict(x.split("=", 1) for x in args.tries))
    ck, sk, sent = os.environ["CARTESIA_API_KEY"], os.environ["SARVAM_API_KEY"], 0
    vid = VOICES.get(args.voice, args.voice)
    with httpx.Client(timeout=60) as c:
        for word in args.words:
            for label, text in (("as written", f"We are calling about {word} today."), ("respelled ", pron.apply(f"We are calling about {word} today.", "en"))):
                if args.respelled_only and label.startswith("as"):
                    continue
                if label.startswith("resp") and text == f"We are calling about {word} today.":
                    continue  # no entry: nothing to compare
                sent += len(text)
                r = c.post("https://api.cartesia.ai/tts/bytes", headers={"X-API-Key": ck, "Cartesia-Version": "2025-04-16"}, json={"model_id": "sonic-3.6", "transcript": text, "voice": {"mode": "id", "id": vid}, "language": "en", "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 16000}, "generation_config": {"speed": 0.9}})
                r.raise_for_status()
                pcm = r.content[r.content.index(b"data") + 8 :]
                import io
                import wave

                buf = io.BytesIO()
                with wave.open(buf, "wb") as w:
                    w.setnchannels(1), w.setsampwidth(2), w.setframerate(16000), w.writeframes(pcm[: len(pcm) // 2 * 2])
                s = c.post("https://api.sarvam.ai/speech-to-text", headers={"api-subscription-key": sk}, data={"model": "saaras:v4", "language_code": "en-IN"}, files={"file": ("a.wav", buf.getvalue(), "audio/wav")})
                s.raise_for_status()
                heard = s.json().get("transcript", "")
                print(f"{word:14s} {label}: {'OK   ' if heard_right(word, heard) else 'WRONG'} text={text!r} heard={heard!r}")
    print("characters sent to Cartesia:", sent)


if __name__ == "__main__":
    main()
