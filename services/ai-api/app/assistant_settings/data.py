"""The assistant's data file (job DM): defaults per business type, the fixed introduction and the sample lines (data/assistant.json). Loaded once; a test checks it against the models and that every line states
"AI assistant"."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent / "data" / "assistant.json"
# the assistant word in each language: every introduction and every sample must contain it (and "AI")
ASSISTANT_WORD = {lang: "assistant" for lang in ("en", "te", "hi", "kn", "ta", "ml")}   # job DS: in everyday speech the word stays in English (Latin letters) in every language


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
    return dict(load()["defaults"][business_type(code)])


def _fill(template: str, name: str, business: str) -> str:
    # plain replacement, not str.format: a name or a business name with braces must stay text
    return template.replace("{name}", name).replace("{business}", business)


def intro(language: str, name: str, business: str) -> str:
    return _fill(load()["intro"][language], name, business)


def sample(code: str | None, language: str, style: str, name: str, business: str) -> str:
    return _fill(load()["samples"][business_type(code)][language][style], name, business)
