"""The Lead Finder data of a business type: packages/packs/<pack>/lead_finder.json (ADR 0119). Code never names a pack: the workspace's pack id (from the database) picks the file, and a pack without the
file (a school) has no Lead Finder at all. Read once per pack and cached; a file that does not parse is treated as absent (logged), never half-read."""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.packs.registry import default_directory

logger = logging.getLogger("app.lead_finder.packdata")
_PACK = re.compile(r"^[a-z][a-z0-9_]{1,30}$")


@dataclass(frozen=True)
class BuyerType:
    code: str
    label: str
    weight: int
    words: tuple[str, ...]
    likely: tuple[str, ...] = ()


@dataclass(frozen=True)
class FixtureTemplate:
    name: str
    category: str
    kind: str
    rating: float | None
    reviews: int | None


@dataclass(frozen=True)
class PackLeadFinder:
    pack_id: str
    category_hint: str
    default_query: dict[str, str]
    buyer_types: tuple[BuyerType, ...]
    related_types: tuple[BuyerType, ...]
    competitor_words: tuple[str, ...]
    very_large_words: tuple[str, ...]
    very_large_reviews: int
    purpose: dict[str, str]
    questions: dict[str, dict[str, str]]
    fixture: tuple[FixtureTemplate, ...] = field(default_factory=tuple)


def _types(rows: list[dict[str, Any]]) -> tuple[BuyerType, ...]:
    return tuple(BuyerType(code=str(r["code"]), label=str(r["label"]), weight=int(r["weight"]), words=tuple(str(w).lower() for w in r["words"]), likely=tuple(str(w).lower() for w in r.get("likely", []))) for r in rows)


def parse(pack_id: str, raw: dict[str, Any]) -> PackLeadFinder:
    call = raw["call"]
    return PackLeadFinder(
        pack_id=pack_id,
        category_hint=str(raw["category_hint"]),
        default_query={str(k): str(v) for k, v in raw["default_query"].items()},
        buyer_types=_types(raw["buyer_types"]),
        related_types=_types(raw.get("related_types", [])),
        competitor_words=tuple(str(w).lower() for w in raw.get("competitor_words", [])),
        very_large_words=tuple(str(w).lower() for w in raw.get("very_large_words", [])),
        very_large_reviews=int(raw.get("very_large_reviews", 1500)),
        purpose={str(k): str(v) for k, v in call["purpose"].items()},
        questions={str(k): {str(lk): str(lv) for lk, lv in v.items()} for k, v in call["questions"].items()},
        fixture=tuple(FixtureTemplate(name=str(t["name"]), category=str(t["category"]), kind=str(t["kind"]), rating=t.get("rating"), reviews=t.get("reviews")) for t in raw.get("fixture", {}).get("templates", [])),
    )


@lru_cache(maxsize=64)
def _load(directory: str, pack_id: str) -> PackLeadFinder | None:
    path = Path(directory) / pack_id / "lead_finder.json"
    if not path.is_file():
        return None
    try:
        return parse(pack_id, json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, KeyError, TypeError):
        logger.error("a lead finder file could not be read: %s", pack_id)
        return None


def for_pack(pack_id: str | None, directory: Path | None = None) -> PackLeadFinder | None:
    """The Lead Finder data of this business type, or None (no file, or an id that is not a pack id)."""
    if not pack_id or not _PACK.match(pack_id):
        return None
    base = directory or default_directory()
    if base is None:
        return None
    return _load(str(base), pack_id)
