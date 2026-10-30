#!/usr/bin/env python3
"""The pronunciation round trip (job pronunciation-quality). OPT-IN: it spends Cartesia characters and Sarvam speech-to-text; both keys come from the environment only.

  CARTESIA_API_KEY=... SARVAM_API_KEY=... python scripts/pronunciation_qa.py --languages te en kn --per-language 14 --cap 4500 --out ~/Desktop/stack19-jobs/pron-review [--report first-report.md] [--only-lexicon]

For each language it builds a corpus (shared-lexicon words in a carrier sentence, example lines from native_lines/, and numeric sentences for the normaliser), gives each text to the SAME speech path as live talk (normalise -> lexicon -> engine), speaks it in the language's default female
catalogue voice, writes what Sarvam heard, and ranks the clips by how far the words are from what was meant (app/pronunciation/qa.py). Clips are kept under <out>/clips/<lang>/ for the weekly review export. Characters are counted in code and the run stops
before the cap. The recogniser cannot hear accent: it finds gross errors only."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.pronunciation import qa  # noqa: E402
from app.pronunciation.nightly import round_trip  # noqa: E402


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--languages", nargs="+", default=["te", "en", "kn"])
    ap.add_argument("--per-language", type=int, default=14)
    ap.add_argument("--cap", type=int, default=4500, help="characters this run may send to Cartesia")
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", default="first-report.md")
    ap.add_argument("--only-lexicon", action="store_true")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--rescore", action="store_true", help="read <out>/results.json again and write the report with the current comparison rules (nothing is spoken, no characters are spent)")
    args = ap.parse_args()
    if args.rescore:
        out = Path(args.out).expanduser()
        old = json.loads((out / "results.json").read_text(encoding="utf-8"))
        again = [qa.score(r["id"], r["language"], r["voice"], r["kind"], r["written"], r["spoken"], r["heard"], r["spellings"]) for r in old]
        for fresh, row in zip(again, old, strict=True):
            fresh.clip = row["clip"]
        (out / "results.json").write_text(json.dumps([r.__dict__ for r in again], ensure_ascii=False, indent=1), encoding="utf-8")
        (out / args.report).write_text(qa.report(again, title="Pronunciation round trip: first report", chars_sent=sum(r.chars for r in again)), encoding="utf-8")
        print(f"{len(again)} clips, {sum(r.ok for r in again)} passed")
        return 0
    if not os.environ.get("CARTESIA_API_KEY") or not os.environ.get("SARVAM_API_KEY"):
        print("pronunciation-qa: set CARTESIA_API_KEY and SARVAM_API_KEY in the environment", file=sys.stderr)
        return 2
    results, sent = await round_trip(args.languages, args.per_language, args.only_lexicon, args.cap, Path(args.out).expanduser(), args.seed, args.report, "Pronunciation round trip: first report")
    print("characters sent to Cartesia:", sent)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
