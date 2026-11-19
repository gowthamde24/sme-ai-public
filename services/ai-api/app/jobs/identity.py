"""What a business type is called and how it lists what it sells: packages/packs/<pack>/identity.json (jobs contract 1.1 part 1: W1 `sell_style`, T2 `plural_names`).

Why a file of its own and not pack.json: a synced pack version is never edited (packs-check refuses it; a change needs a new pack version and a migration), and these two words change nothing a workspace's
pinned pack decides (modules, rules, fields). Code never names a pack: the workspace's pack id from the database picks the file. A file that breaks a rule is refused whole, logged, and answered as "no identity"
(fail closed); the tests refuse a pack that has none.
"""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.packs.registry import default_directory

logger = logging.getLogger("app.jobs.identity")

SELL_STYLES = ("products", "services", "courses", "properties", "pricelist")
LANGUAGES = ("en", "te", "hi", "kn")
MAX_NAME = 60
_PACK = re.compile(r"^[a-z][a-z0-9_]{1,30}$")
_TELUGU = re.compile(r"[ఀ-౿]")
_DIGIT = re.compile(r"[0-9౦-౯०-९೦-೯]")


class IdentityError(ValueError):
    """An identity.json that must not be served."""


@dataclass(frozen=True)
class Identity:
    pack_id: str
    sell_style: str
    plural_names: dict[str, str]


def parse(pack_id: str, raw: Any) -> Identity:
    if not isinstance(raw, dict) or set(raw) - {"$schema", "pack", "status", "sell_style", "plural_names"} or {"pack", "status", "sell_style", "plural_names"} - set(raw):
        raise IdentityError(f"{pack_id}: keys are wrong")
    if raw["pack"] != pack_id or raw["status"] != "draft":
        raise IdentityError(f"{pack_id}: pack must be the folder name and status draft")
    if raw["sell_style"] not in SELL_STYLES:
        raise IdentityError(f"{pack_id}: sell_style must be one of {SELL_STYLES}")
    names = raw["plural_names"]
    if not isinstance(names, dict) or "en" not in names or "te" not in names or set(names) - set(LANGUAGES):
        raise IdentityError(f"{pack_id}: plural_names is {{en, te, hi?, kn?}}")
    for language, text in names.items():
        if not isinstance(text, str) or not 2 <= len(text) <= MAX_NAME or text != text.strip() or _DIGIT.search(text):
            raise IdentityError(f"{pack_id}: plural_names.{language} is a short plain phrase")
    if not _TELUGU.search(names["te"]):
        raise IdentityError(f"{pack_id}: plural_names.te has no Telugu letters")
    return Identity(pack_id=pack_id, sell_style=raw["sell_style"], plural_names=dict(names))


@lru_cache(maxsize=64)
def _load(directory: str, pack_id: str) -> Identity | None:
    path = Path(directory) / pack_id / "identity.json"
    if not path.is_file():
        return None
    try:
        return parse(pack_id, json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError) as exc:  # IdentityError is a ValueError, so is a JSON error
        logger.error("a pack identity file was refused: %s", exc)
        return None


def for_pack(pack_id: str | None, directory: Path | None = None) -> Identity | None:
    """The identity of this business type, or None (no file, a file that broke a rule, or an id that is not a pack id)."""
    if not pack_id or not _PACK.match(pack_id):
        return None
    base = directory or default_directory()
    if base is None:
        return None
    return _load(str(base), pack_id)


def sell_style(pack_id: str | None, directory: Path | None = None) -> str:
    """The style of "What you sell" for this business type; products (the plainest, what the web draws for an unknown one) when the identity is missing."""
    found = for_pack(pack_id, directory)
    return found.sell_style if found is not None else "products"
