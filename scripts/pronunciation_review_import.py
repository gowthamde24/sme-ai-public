#!/usr/bin/env python3
"""Move a reviewer's verdicts into the shared lexicon (job pronunciation-quality).

  python scripts/pronunciation_review_import.py ~/Desktop/stack19-jobs/pron-review/2026-11-02/te/verdicts.json [--write]

For each verdict with "ok": true the entry is marked verified for the language of the file (the other languages of the entry stay drafts). For "ok": false with a "sounds_like" the entry gets that respelling for the language of the file (a new entry is made for a word the lexicon does not know). Without --write
it only prints what would change. The file edited is services/ai-api/app/pronunciation/data/lexicon.json; commit it like any change."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.pronunciation.lexicon import DATA, LANGUAGES  # noqa: E402


def _verified(entry: dict) -> list[str]:
    """The languages an entry has been agreed for (the older `true` meant every form it has)."""
    value = entry.get("verified") or []
    return sorted({*entry.get("forms", {}), *entry.get("sounds_like", {}), *entry.get("phonemes", {})}) if value is True else list(value)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("verdicts")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    doc = json.loads(Path(args.verdicts).read_text(encoding="utf-8"))
    language = doc["language"]
    if language not in LANGUAGES:
        print("unknown language in the verdicts file", file=sys.stderr)
        return 2
    lexicon = json.loads(DATA.read_text(encoding="utf-8"))
    entries = {e["word"].casefold(): e for e in lexicon["entries"]}
    changes = 0
    for v in doc["verdicts"]:
        word, ok, sound = v.get("word"), v.get("ok"), (v.get("sounds_like") or "").strip()
        if not word or ok is None:
            continue
        entry = entries.get(word.casefold())
        if ok:
            if entry is not None and language not in _verified(entry):
                entry["verified"] = sorted({*_verified(entry), language})
                changes += 1
                print(f"verified: {word}")
        elif sound:
            if entry is None:
                entry = {"word": word, "kind": "word", "forms": {"en": word}, "aliases": [], "verified": [language]}
                lexicon["entries"].append(entry)
                entries[word.casefold()] = entry
            entry.setdefault("sounds_like", {})[language] = sound[:80]
            entry["verified"] = sorted({*_verified(entry), language})
            changes += 1
            print(f"{word}: sounds like {sound!r} in {language}")
    if args.write and changes:
        DATA.write_text(json.dumps(lexicon, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {DATA}")
    else:
        print(f"{changes} change(s)" + ("" if args.write else " (not written; use --write)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
