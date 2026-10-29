"""Render the browser voice's 'one moment' lines once, for every voice of the catalogue (job DV follow-up). OPT-IN: it spends Cartesia characters; the key comes from the environment (CARTESIA_API_KEY) and is never printed.

  CARTESIA_API_KEY=... python scripts/voice_filler_bank.py [--cap 2500] [--only te-ramya]

For each catalogue voice it speaks the 3 to 4 lines of fillers.BANK_LINES for the voice's language through the SAME Cartesia engine class and pronunciation map that speak live (so the filler sounds like the voice),
trims the silence at both ends, and writes raw 16-bit 24 kHz mono PCM to app/conversation/data/fillers/<voice>-<n>.pcm plus index.json. Characters are counted in code and the run stops before the cap (default 2,500)."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.conversation.fillers import BANK_DIR, bank_lines  # noqa: E402
from app.conversation.providers import CartesiaStreamTts  # noqa: E402
from app.conversation.pronounce import default_pronunciations  # noqa: E402
from app.conversation.voices import default_config  # noqa: E402

RATE = 24000
THRESHOLD = 300  # 16-bit amplitude under which a sample counts as silence at the ends
KEEP_MS = 60


def trim(pcm: bytes) -> bytes:
    import array

    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    loud = [i for i, s in enumerate(samples) if abs(s) > THRESHOLD]
    if not loud:
        return pcm
    keep = RATE * KEEP_MS // 1000
    start, end = max(0, loud[0] - keep), min(len(samples), loud[-1] + keep)
    return samples[start:end].tobytes()


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=6000, help="characters this run may send to Cartesia")
    ap.add_argument("--only", help="one catalogue voice id")
    ap.add_argument("--force", action="store_true", help="render again even when the lines are already there")
    args = ap.parse_args()
    key = os.environ.get("CARTESIA_API_KEY", "")
    if not key:
        print("voice-filler-bank: set CARTESIA_API_KEY in the environment", file=sys.stderr)
        return 2
    cfg, pron = default_config(), default_pronunciations()
    BANK_DIR.mkdir(parents=True, exist_ok=True)
    index: dict[str, object] = json.loads((BANK_DIR / "index.json").read_text(encoding="utf-8")) if (BANK_DIR / "index.json").is_file() else {}
    spent = 0
    for voice in cfg.catalogue.values():
        if args.only and voice.id != args.only:
            continue
        lines = bank_lines(voice.language, voice.gender)
        if (BANK_DIR / f"{voice.id}-1.pcm").is_file() and not args.force and index.get(voice.id, {}).get("lines", [{}])[0].get("text") == lines[0]:
            continue   # already rendered with these lines
        need = sum(len(t) for t in lines)
        if spent + need > args.cap:
            print(f"stopping before {voice.id}: {spent} + {need} characters would pass the cap of {args.cap}")
            break
        choice = voice.voices.primary
        engine = CartesiaStreamTts(key, voice_id=choice.voice, model=choice.model)
        entries = []
        for n, text in enumerate(lines, start=1):
            chunks = [c async for c in engine.stream(pron.apply(text, voice.language, "cartesia"), voice.language)]
            spent += len(text)
            pcm = trim(b"".join(chunks))
            name = f"{voice.id}-{n}.pcm"
            (BANK_DIR / name).write_bytes(pcm)
            entries.append({"text": text, "file": name})
            print(f"{voice.id} {n}: {len(pcm) / 2 / RATE:.2f} s")
        index[voice.id] = {"language": voice.language, "lines": entries}
    (BANK_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("characters sent to Cartesia:", spent)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
