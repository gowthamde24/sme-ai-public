#!/usr/bin/env python3
"""Write the synthetic placeholder background beds (services/ai-api/app/telephony/data/ambience/<name>.pcm for the nine beds: 8 kHz, 16-bit mono little-endian, 8 s).

Deterministic (seeded filtered noise, nothing downloaded or recorded): running it again gives the same bytes. Real recorded beds can replace the two files later; the loader scales every bed to its own level.
Run from services/ai-api:  PYTHONPATH="$PWD" python ../../scripts/make_ambience_placeholders.py [--check]   (--check writes nothing and fails when a file differs)."""

from __future__ import annotations

import sys

from app.telephony import ambience


def main(argv: list[str]) -> int:
    check = "--check" in argv
    bad = 0
    for name in tuple(b for b in ambience.BACKGROUNDS if b != "off"):
        data = ambience.placeholder(name)
        path = ambience.DATA / f"{name}.pcm"
        if check:
            if not path.is_file() or path.read_bytes() != data:
                print(f"differs: {path}")
                bad += 1
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            print(f"wrote {path} ({len(data)} bytes)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
