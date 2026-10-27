"""The seven ready-made task templates (job DR B1), as data (data/templates.json)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent / "data" / "templates.json"
TEMPLATE_IDS: tuple[str, ...] = ("call_new_leads", "reengage_old_leads", "confirm_appointments", "collect_feedback", "payment_reminder", "supplier_price_enquiry", "offer_invite")


@lru_cache(maxsize=1)
def load() -> dict[str, dict[str, Any]]:
    items = json.loads(DATA.read_text(encoding="utf-8"))["templates"]
    return {item["id"]: item for item in items}


def get(template_id: str) -> dict[str, Any] | None:
    return load().get(template_id)


def listing(*, school: bool = False) -> list[dict[str, Any]]:
    """What GET /tasks/templates answers: a school does not see the payment reminder."""
    out = []
    for item in load().values():
        if school and item["not_for_schools"]:
            continue
        out.append({
            "id": item["id"], "label": item["label"], "channel_default": item["channel_default"],
            "needs_pack": "not education" if item["not_for_schools"] else None, "promotional": item["promotional"],
            "example_instruction": item["example_instruction"],
        })
    return out
