#!/usr/bin/env python3
"""Adds `sounds_like` and `best_for` to every voice of services/ai-api/app/conversation/data/voices.json and sets `recommended` to exactly 2 women + 2 men for te, hi, kn and en (planner brief 23 Nov 2026).

The data file is edited AS TEXT (a few lines per voice), never re-dumped, so the diff stays small. Run it again any time: it is idempotent. `--check` only prints the table and changes nothing.

sounds_like (ONE of five) comes from the tags, priority energetic > deep > bright/young > calm/mature > warm; OVERRIDES is the short reviewed table where a listener disagrees.
best_for comes from sounds_like. recommended: the language's default of that gender first, then the other voice that adds a DIFFERENT sounds_like (a spread), preferring voices that were already recommended."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "services" / "ai-api" / "app" / "conversation" / "data" / "voices.json"
PRIORITY = ("energetic", "deep", "bright", "young", "calm", "mature", "warm")
OF_TAG = {"energetic": "energetic", "deep": "deep_confident", "bright": "bright_young", "young": "bright_young", "calm": "calm_reassuring", "mature": "calm_reassuring", "warm": "warm_friendly"}
BEST_FOR = {
    "warm_friendly": ["retail", "clinic"],
    "calm_reassuring": ["clinic", "finance", "wholesale"],
    "bright_young": ["education", "retail"],
    "energetic": ["auto", "retail"],
    "deep_confident": ["real_estate", "wholesale", "auto"],
}
OVERRIDES: dict[str, str] = {}   # voice id -> sounds_like, for a voice a listener places differently from its tags (reviewed; empty until a listener says so)
RECOMMENDED_LANGUAGES = ("te", "hi", "kn", "en")
PINNED = {"en-shalini", "en-shubh"}   # reviewed: the Sarvam voices a legacy v3 speaker (shalini, rahul ...) is mapped to on a call (tests/test_vl_sarvam_v4.py); they stay recommended, ahead of the spread rule
CUSTOMER_ORDER = ("warm_friendly", "calm_reassuring", "bright_young", "energetic", "deep_confident")   # for the second recommended voice: the styles that suit a customer call first; a Sarvam voice among equals (it is the one a legacy v3 speaker maps to)


def sounds_like(voice: dict) -> str:
    if voice["id"] in OVERRIDES:
        return OVERRIDES[voice["id"]]
    tags = voice.get("tags") or []
    for tag in PRIORITY:
        if tag in tags:
            return OF_TAG[tag]
    return "warm_friendly"


def speaker(voice: dict) -> str:
    """kavitha_narration and kavitha are one speaker: recommend two different people."""
    return voice["id"].split("-", 1)[1].split("_")[0]


def recommended_ids(voices: list[dict], sl: dict[str, str]) -> set[str]:
    chosen: set[str] = set()
    for lang in RECOMMENDED_LANGUAGES:
        for gender in ("female", "male"):
            group = sorted((v for v in voices if v["language"] == lang and v["gender"] == gender), key=lambda v: (not v.get("default"), v["id"] not in PINNED, CUSTOMER_ORDER.index(sl[v["id"]]), v.get("provider") != "sarvam", not v.get("recommended"), bool(v.get("to_confirm_by_native")), v["id"]))
            picked: list[dict] = []
            for v in group:
                if len(picked) == 2:
                    break
                if not picked or v["id"] in PINNED or (sl[v["id"]] not in {sl[p["id"]] for p in picked} and speaker(v) not in {speaker(p) for p in picked}):
                    picked.append(v)
            for v in group:   # no different style AND speaker: a different speaker alone, then anything
                if len(picked) < 2 and v not in picked and speaker(v) not in {speaker(p) for p in picked}:
                    picked.append(v)
            for v in group:
                if len(picked) < 2 and v not in picked:
                    picked.append(v)
            chosen |= {p["id"] for p in picked}
    return chosen


def main() -> int:
    text = DATA.read_text(encoding="utf-8")
    voices = json.loads(text)["catalogue"]
    sl = {v["id"]: sounds_like(v) for v in voices}
    rec = recommended_ids(voices, sl)
    out: list[str] = []
    current: str | None = None
    for line in text.split("\n"):
        m = re.match(r'^   "id": "([a-z]{2}-[a-z0-9_-]+)",$', line)
        if m:
            current = m.group(1)
        if current and re.match(r'^   "(sounds_like|best_for)": ', line):
            continue   # idempotent: dropped, written again below
        if current and re.match(r'^   "recommended": (true|false),?$', line) and current[:2] in RECOMMENDED_LANGUAGES:
            comma = "," if line.rstrip().endswith(",") else ""
            line = f'   "recommended": {"true" if current in rec else "false"}{comma}'
        out.append(line)
        if current and re.match(r'^   "gender": "(female|male)",$', line):
            out.append(f'   "sounds_like": "{sl[current]}",')
            out.append(f'   "best_for": {json.dumps(BEST_FOR[sl[current]])},')
    new = "\n".join(out)
    after = json.loads(new)["catalogue"]   # still valid JSON
    if "--check" not in sys.argv:
        DATA.write_text(new, encoding="utf-8")
    print("language gender: voices | recommended | sounds_like spread")
    for lang in ("te", "hi", "kn", "en", "ta", "ml"):
        for gender in ("female", "male"):
            g = [v for v in after if v["language"] == lang and v["gender"] == gender]
            print(f"{lang} {gender}: {len(g)} | {sum(bool(v['recommended']) for v in g)} | {dict(Counter(v['sounds_like'] for v in g))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
