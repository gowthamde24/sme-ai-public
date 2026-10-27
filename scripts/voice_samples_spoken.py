#!/usr/bin/env python3
"""The spoken-style listening samples with Sarvam (job DS, ADR 0105). OPT-IN: never part of make check, never run by CI.

  make voice-samples-spoken        renders six everyday-spoken lines in te, hi, kn, ta, ml into ~/Desktop/stack19-jobs/voice-samples/spoken/<lang>/ and writes index.html (before vs now, side by side)
  python scripts/voice_samples_spoken.py --dry-run     counts what a run would send; opens no connection, reads no key

HARD CAP: 3,000 characters of text-to-speech in total, counted BEFORE anything is sent and kept across runs in spoken/usage.json. The key is read from SARVAM_API_KEY or from Secret Manager (sme-sarvam-api-key) into a
variable; it is never printed, logged or written. Synthetic lines only."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "ai-api"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from voice_samples import read_key  # noqa: E402

from app.voice.interface import VoiceError  # noqa: E402
from app.voice.sarvam import SarvamTts  # noqa: E402
from app.voice.spoken import (  # noqa: E402
    SPOKEN_CHAR_CAP,
    SPOKEN_PACE,
    SPOKEN_TEMPERATURE,
    SPOKEN_VOICE,
    SpokenClip,
    compare_html,
    plan_spoken,
    spoken_within_cap,
)

DEFAULT_OUT = Path.home() / "Desktop" / "stack19-jobs" / "voice-samples" / "spoken"


def load_usage(out: Path) -> dict:
    path = out / "usage.json"
    return json.loads(path.read_text()) if path.exists() else {"chars_total": 0, "runs": []}


def render(out: Path, dry: bool, make_tts=None) -> int:
    out.mkdir(parents=True, exist_ok=True)
    usage = load_usage(out)
    todo = [c for c in plan_spoken() if not (out / c.path).exists()]
    fits, chars = spoken_within_cap(todo, usage["chars_total"])
    print(f"clips planned {len(plan_spoken())}, already rendered {len(plan_spoken()) - len(todo)}, to send {len(fits)} ({chars} characters; {usage['chars_total']} already spent of the {SPOKEN_CHAR_CAP} cap)")
    if len(fits) < len(todo):
        print(f"STOPPED AT THE CAP: {len(todo) - len(fits)} clips will not be rendered")
    if dry:
        return 0
    tts = (make_tts or (lambda: SarvamTts(read_key(), "bulbul:v3")))()
    sent = requests = 0
    stopped = len(fits) < len(todo)
    for clip in fits:
        speech = None
        for attempt in (1, 2):
            try:
                speech = tts.synthesize(clip.text, clip.lang, speaker=SPOKEN_VOICE, pace=SPOKEN_PACE, temperature=SPOKEN_TEMPERATURE)
                break
            except VoiceError as exc:
                if exc.code == "http_429" and attempt == 1:
                    time.sleep(6)
                    continue
                print(f"a clip failed ({exc.code}): {clip.path}; stopping so no more is spent")
                stopped = True
                break
        if speech is None:
            break
        requests += 1
        sent += len(clip.text)
        usage["chars_total"] += len(clip.text)   # counted when the request was made
        target = out / clip.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(speech.audio)
        (out / "usage.json").write_text(json.dumps(usage, ensure_ascii=False, indent=1))
        time.sleep(0.25)
    usage["runs"].append({"at": datetime.now(UTC).isoformat(timespec="seconds"), "chars": sent, "requests": requests, "stopped_early": stopped})
    (out / "usage.json").write_text(json.dumps(usage, ensure_ascii=False, indent=1))
    have: list[SpokenClip] = [c for c in plan_spoken() if (out / c.path).exists()]
    (out / "index.html").write_text(compare_html(have, usage), encoding="utf-8")
    print(f"done: {requests} requests, {sent} characters this run, {usage['chars_total']} in total; page: {out / 'index.html'}")
    return requests


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    render(args.out, args.dry_run)


if __name__ == "__main__":
    main()
