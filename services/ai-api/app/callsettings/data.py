"""The call settings data file (job DP part 4): defaults per business type, the option labels and what a business type may not change (data/call_settings.json). Loaded once; a test checks it against the models."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent / "data" / "call_settings.json"


@lru_cache(maxsize=1)
def load() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(DATA.read_text(encoding="utf-8"))
    return loaded


def business_type(code: str | None) -> str:
    """The pack's code when the data has defaults for it, else the first set of defaults in the file (the default pack's)."""
    defaults = load()["defaults"]
    if code is not None and code in defaults:
        return code
    return str(next(iter(defaults)))


def defaults_for(code: str | None) -> dict[str, Any]:
    copied: dict[str, Any] = json.loads(json.dumps(load()["defaults"][business_type(code)]))
    return copied


def locked_for(code: str | None) -> dict[str, list[str]]:
    held = load().get("locked", {}).get(business_type(code), {})
    return {field: list(values) for field, values in held.items()}
