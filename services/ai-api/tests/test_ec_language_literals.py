"""Every `Literal[...]` of language codes lists them in ONE order (en, te, hi, kn, ta, ml).

Python treats `Literal["te", "en"]` and `Literal["en", "te"]` as equal, so pydantic can hand
one model the other's order. A committed contract (packages/contracts/*.schema.json) then
differs depending on which module was imported first: a test that passes on one machine
and fails on another (job EB, #188)."""

from __future__ import annotations

import re
from pathlib import Path

CANON = ["en", "te", "hi", "kn", "ta", "ml", "mr", "bn"]
APP = Path(__file__).resolve().parents[1] / "app"
LITERAL = re.compile(r"Literal\[((?:\s*\"[a-z]{2}\"\s*,?)+)\]")


def test_language_literals_keep_the_one_order() -> None:
    wrong: list[str] = []
    for path in sorted(APP.rglob("*.py")):
        for found in LITERAL.finditer(path.read_text(encoding="utf-8")):
            codes = re.findall(r"\"([a-z]{2})\"", found.group(1))
            if len(codes) < 2 or not set(codes) <= set(CANON):
                continue
            if [c for c in codes] != sorted(codes, key=CANON.index):
                wrong.append(f"{path.relative_to(APP)}: {codes}")
    assert wrong == [], f"language codes in a different order than {CANON[:6]}: {wrong}"
