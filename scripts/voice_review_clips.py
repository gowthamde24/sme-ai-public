#!/usr/bin/env python3
"""Render a few short lines in one catalogue voice for a human listener (a native reviewer, the owner). OPT-IN: it spends Cartesia characters; the key comes from the environment only (CARTESIA_API_KEY).

  CARTESIA_API_KEY=... python scripts/voice_review_clips.py --voice kn-disha --lines lines.json --out ~/Desktop/stack19-jobs/voice-picks/kn-review [--cap 1500]

`lines.json` is a list of {"id": "01-opening", "text": "...", "meaning": "what it says, in English"}. Each line goes through the SAME engine class and the SAME pronunciation map as live speech (so what the reviewer hears is what
a caller hears), is trimmed of silence at both ends and written as <out>/<id>.wav (16-bit, 24 kHz, mono), plus <out>/README.md listing each file with its text and meaning. Characters are counted in code and the run stops before the cap."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.conversation.providers import CartesiaStreamTts  # noqa: E402
from app.conversation.pronounce import default_pronunciations  # noqa: E402
from app.conversation.voices import default_config  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voice_filler_bank import RATE, trim  # noqa: E402


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True, help="a catalogue voice id, e.g. kn-disha")
    ap.add_argument("--lines", required=True, help="JSON file: [{id, text, meaning}]")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cap", type=int, default=1500, help="characters this run may send to Cartesia")
    args = ap.parse_args()
    key = os.environ.get("CARTESIA_API_KEY", "")
    if not key:
        print("voice-review-clips: set CARTESIA_API_KEY in the environment", file=sys.stderr)
        return 2
    voice = default_config().catalogue[args.voice]
    lines = json.loads(Path(args.lines).read_text(encoding="utf-8"))
    need = sum(len(item["text"]) for item in lines)
    if need > args.cap:
        print(f"{need} characters would pass the cap of {args.cap}")
        return 1
    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    pron, choice = default_pronunciations(), voice.voices.primary
    engine = CartesiaStreamTts(key, voice_id=choice.voice, model=choice.model)
    rows = []
    for item in lines:
        spoken = pron.apply(item["text"], voice.language, choice.engine)
        pcm = trim(b"".join([c async for c in engine.stream(spoken, voice.language)]))
        write_wav(out / f"{item['id']}.wav", pcm)
        rows.append(f"| {item['id']}.wav | {item['text']} | {item.get('meaning', '')} |")
        print(f"{item['id']}: {len(pcm) / 2 / RATE:.2f} s")
    (out / "README.md").write_text(
        f"# Clips in {voice.id} ({voice.language})\n\nDrafts for a native reviewer. For each file: is it natural spoken language, and is it pronounced right? Mark OK, or write what is wrong and how it should sound.\n\n"
        "| File | Text | What it says |\n|---|---|---|\n" + "\n".join(rows) + "\n",
        encoding="utf-8",
    )
    print("characters sent to Cartesia:", need)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
