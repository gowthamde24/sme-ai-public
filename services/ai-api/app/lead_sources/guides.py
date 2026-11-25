"""How to connect a CRM, an automation tool, a website form or a sheet to a lead address: DATA (data/guides.json), read once. Every sample is tested against the real intake (tests/test_lead_guides.py)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PATH = Path(__file__).parent / "data" / "guides.json"
PLACEHOLDER = "{ADDRESS}"


@lru_cache(maxsize=1)
def _doc() -> dict[str, Any]:
    raw = json.loads(PATH.read_text(encoding="utf-8"))
    return raw if isinstance(raw, dict) else {}


def listing() -> list[dict[str, str]]:
    return [{"id": g["id"], "name": g["name"], "group": g["group"]} for g in _doc().get("guides", [])]


def guide(guide_id: str, address_url: str) -> dict[str, Any] | None:
    """One guide with the address written in (the real URL when the caller has it, else `.../YOUR-ADDRESS`)."""
    for g in _doc().get("guides", []):
        if g["id"] == guide_id:
            text = json.dumps(g, ensure_ascii=False).replace(PLACEHOLDER, address_url.replace("\\", "\\\\").replace('"', '\\"'))
            out: dict[str, Any] = json.loads(text)
            return out
    return None


def consent_note() -> str:
    return str(_doc().get("note", ""))
