#!/usr/bin/env python3
"""The weekly human-ear export (job pronunciation-quality). Takes the results of scripts/pronunciation_qa.py and puts the riskiest clips of each language where a native reviewer finds them:

  python scripts/pronunciation_review_export.py --results ~/Desktop/stack19-jobs/pron-review/results.json --out ~/Desktop/stack19-jobs/pron-review [--date 2026-11-02] [--top 20]

Writes <out>/<date>/<lang>/ with the clips, a README.md (what each clip says and what the recogniser heard) and verdicts.json: for each clip {"id", "ok": null, "sounds_like": null}. The reviewer sets "ok": true, or "ok": false and
"sounds_like" to how the word should sound (a respelling, in Latin letters or in the language's script). scripts/pronunciation_review_import.py then moves the corrections into the shared lexicon. Nothing is spoken here: no characters are spent."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.pronunciation import qa  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--top", type=int, default=20)
    args = ap.parse_args()
    results_path = Path(args.results).expanduser()
    base = results_path.parent
    results = [qa.Result(**{k: v for k, v in row.items() if k != "ok"}) for row in json.loads(results_path.read_text(encoding="utf-8"))]
    for language in sorted({r.language for r in results}):
        rows = qa.rank([r for r in results if r.language == language])[: args.top]
        folder = Path(args.out).expanduser() / args.date / language
        folder.mkdir(parents=True, exist_ok=True)
        verdicts, lines = [], [f"# {language}: the {len(rows)} riskiest clips of the week ({args.date})", "", "Listen to each file. In verdicts.json set \"ok\": true if it sounds right; otherwise \"ok\": false and \"sounds_like\" to how the word should sound.", "", "| File | Text | Recogniser heard | Score |", "|---|---|---|---|"]
        for r in rows:
            name = Path(r.clip).name
            if (base / r.clip).is_file():
                shutil.copyfile(base / r.clip, folder / name)
            verdicts.append({"id": r.id, "word": (r.spellings[0] if r.spellings else None), "ok": None, "sounds_like": None})
            lines.append(f"| {name} | {r.spoken} | {r.heard} | {r.score} |")
        (folder / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        (folder / "verdicts.json").write_text(json.dumps({"language": language, "verdicts": verdicts}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{language}: {len(rows)} clips -> {folder}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
