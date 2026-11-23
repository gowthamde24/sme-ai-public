#!/usr/bin/env python3
"""Write the nine 6-second background previews (services/ai-api/app/telephony/data/ambience/previews/<id>.mp3) that GET /v1/background-samples/<id>.mp3 serves (docs/contracts/voice-styles.md section 2).

Voice-free, own-made (the same seeded synthetic beds as the phone beds, docs/licences/background-sounds.md), a loop with no seam (the crossfade of `ambience.make_loop`), at a level the owner can hear on a phone speaker (the bed in a call is
far quieter: it sits 30 dB under the voice). Deterministic: the same bytes every run on the same ffmpeg. Needs `ffmpeg` (brew install ffmpeg); the files are committed, so CI and the servers need nothing.
Run from services/ai-api:  PYTHONPATH="$PWD" python ../../scripts/make_background_previews.py"""

from __future__ import annotations

import subprocess
import sys

from app.telephony import ambience

PREVIEW_RMS = 2600.0   # about -22 dBFS: clearly heard, never loud


def main() -> int:
    out_dir = ambience.DATA / "previews"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in (b for b in ambience.BACKGROUNDS if b != "off"):
        loop = ambience.make_loop(ambience.placeholder(name, seconds=6.2))   # 6.2 s minus the 0.2 s crossfade = a 6.0 s loop
        pcm = ambience.scale_to(loop, PREVIEW_RMS)
        path = out_dir / f"{name}.mp3"
        run = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(ambience.BED_RATE), "-ac", "1", "-i", "-", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-ar", "16000", "-codec:a", "libmp3lame", "-b:a", "32k", str(path)],
            input=pcm, capture_output=True, check=False,
        )
        if run.returncode != 0:
            print(f"ffmpeg failed for {name}: {run.stderr.decode()[:200]}", file=sys.stderr)
            return 1
        print(f"wrote {path} ({path.stat().st_size} bytes, {len(pcm) / 2 / ambience.BED_RATE:.1f} s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
