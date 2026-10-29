"""The assistant's data file (job DM): defaults per business type, the fixed introduction and the sample lines (data/assistant.json). Loaded once; a test checks it against the models and that every line states
"AI assistant"."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.opening.render import NO_NAME_PHRASE

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


# What stands where a name would be when the Owner has not named the assistant (job EE: no name is ever made up). A phrase, not a person: "your assistant".
NO_NAME = NO_NAME_PHRASE   # (one list of the phrases: the opening line and the settings say the same words)
# the fixed introduction when there is no name: the business and "AI assistant" (every language states both)
INTRO_UNNAMED = {
    "en": "The AI assistant of {business}", "te": "{business} నుంచి AI assistant", "hi": "{business} की AI assistant", "kn": "{business} ಇಂದ AI assistant",
    "ta": "{business} இன் AI assistant", "ml": "{business} ന്റെ AI assistant",
}


def default_name(language: str = "en") -> str:
    """The phrase used where a name would stand when nobody named the assistant (a sample, a preview, a prompt): never a made-up name."""
    return NO_NAME.get(language, NO_NAME["en"])


def defaults_for(code: str | None) -> dict[str, Any]:
    return dict(load()["defaults"][business_type(code)])


def _fill(template: str, name: str, business: str) -> str:
    # plain replacement, not str.format: a name or a business name with braces must stay text
    return template.replace("{name}", name).replace("{business}", business)


def intro(language: str, name: str, business: str) -> str:
    """The fixed introduction. With no name (the Owner set none) it names only the business and says AI assistant."""
    if not name:
        return INTRO_UNNAMED[language].replace("{business}", business)
    return _fill(load()["intro"][language], name, business)


def sample(code: str | None, language: str, style: str, name: str, business: str) -> str:
    # job DR: the nine leads-and-calls business types share one set of lines ("leads"); the older types have their own
    samples = load()["samples"]
    key = business_type(code)
    return _fill(samples[key if key in samples else "leads"][language][style], name, business)
