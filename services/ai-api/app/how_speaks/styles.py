# ruff: noqa: E501
"""The 7 speaking styles as the screen lists them (docs/contracts/voice-styles.md): data from styles.json, the ids checked against the tone module so the two can never drift."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from app.telephony import tone as tone_mod

LANGS = ("en", "te", "hi", "kn", "ta", "ml", "mr")


@cache
def _raw() -> list[dict[str, Any]]:
    data = json.loads((Path(__file__).with_name("styles.json")).read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = data["styles"]
    if [r["id"] for r in rows] != list(tone_mod.CHOICES):
        raise ValueError("styles.json and tone.CHOICES must list the same ids in the same order")
    return rows


def options() -> list[dict[str, Any]]:
    """One object per style; the languages without their own words (ta, ml, mr) show the English ones. `reviewed` is false until a native reader has approved the te/hi/kn words."""
    out = []
    for r in _raw():
        out.append({"id": r["id"], "label": {lang: r["label"].get(lang, r["label"]["en"]) for lang in LANGS}, "hint": {lang: r["hint"].get(lang, r["hint"]["en"]) for lang in LANGS}, "best_for": list(r["best_for"]), "reviewed": False})
    return out
