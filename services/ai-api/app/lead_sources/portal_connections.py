"""How each portal's leads reach a business (data/portals.json), read once: the honest state per portal, the ways, and the short message the owner can send the portal's team. Pure data and plain substitution: no network, no secret."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PATH = Path(__file__).parent / "data" / "portals.json"
PLACEHOLDERS = {"{WEB_ADDRESS}": "(your web address from the Lead sources page)", "{MAIL_ADDRESS}": "(your lead e-mail address from the Lead sources page)"}


@lru_cache(maxsize=1)
def _doc() -> dict[str, Any]:
    raw = json.loads(PATH.read_text(encoding="utf-8"))
    return raw if isinstance(raw, dict) else {}


def listing(web_address: str | None = None, mail_address: str | None = None) -> dict[str, Any]:
    """Every portal with its state and the message to send its team, the addresses written in when the caller has them (they are shown only once, so the page passes what it holds; otherwise a plain pointer stays)."""
    doc = _doc()
    out: list[dict[str, Any]] = []
    for item in doc.get("portals", []):
        text = str(doc.get("ask_text", "")).replace("{PORTAL}", item["name"])
        text = text.replace("{WEB_ADDRESS}", web_address or PLACEHOLDERS["{WEB_ADDRESS}"]).replace("{MAIL_ADDRESS}", mail_address or PLACEHOLDERS["{MAIL_ADDRESS}"])
        entry = {**item, "ask_text": text if item["how"] == "account_manager" else None}
        out.append(entry)
    return {"note": doc.get("note", ""), "portals": out}
