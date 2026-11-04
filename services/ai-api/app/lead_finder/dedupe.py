"""Is this business already ours? (ADR 0119) A found place is dropped when it is already a customer or a lead (the same phone, or nearly the same name), a company of ours (nearly the same name), a
prospect found before (the same place id, the same phone, or nearly the same name in the same area), or a business that asked not to be called (suppressed: always dropped, whichever way it matches).
Pure: the database hands over what it knows (`prospect_context`), this decides."""

# ruff: noqa: E501

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Literal

from app.lead_finder.sources import Place
from app.suppression.keys import normalise_phone

DupReason = Literal["customer", "company", "prospect", "suppressed"]
NAME_MATCH = 0.88
# words that do not tell two shops apart
_FILLER = re.compile(r"\b(the|and|&|pvt|private|ltd|limited|llp|co|company|shop|store|centre|center|new|sri|shri|sree)\b")


def name_key(name: str) -> str:
    t = unicodedata.normalize("NFKC", name).casefold()
    t = re.sub(r"[^\w\s&]", " ", t)
    t = _FILLER.sub(" ", t)
    return " ".join(t.split())[:200]


def phone_key(phone: str | None) -> str | None:
    """The digits of the number as stored (6 to 15 of them), for the database's own lookups."""
    if not phone:
        return None
    digits = "".join(ch for ch in unicodedata.normalize("NFKC", phone) if ch.isdecimal())
    return digits if 6 <= len(digits) <= 15 else None


def phone_match_key(phone: str | None) -> str | None:
    """The comparison form: the same rule as app.phone_norm in the database (so a customer's number and a found number compare equal)."""
    return normalise_phone(phone) if phone else None


def similar(a: str, b: str) -> bool:
    if not a or not b:
        return False
    return a == b or SequenceMatcher(None, a, b).ratio() >= NAME_MATCH


@dataclass
class Known:
    customer_phones: set[str] = field(default_factory=set)
    customer_names: list[str] = field(default_factory=list)
    company_names: list[str] = field(default_factory=list)
    place_ids: set[str] = field(default_factory=set)
    prospect_phones: dict[str, bool] = field(default_factory=dict)   # phone match key -> suppressed
    prospect_names: list[tuple[str, str, bool]] = field(default_factory=list)   # (name key, area, suppressed)
    suppressed_place_ids: set[str] = field(default_factory=set)

    @classmethod
    def from_context(cls, ctx: dict[str, Any]) -> Known:
        k = cls()
        for c in ctx.get("customers") or []:
            if c.get("phone_key"):
                k.customer_phones.add(str(c["phone_key"]))
            if c.get("name"):
                k.customer_names.append(name_key(str(c["name"])))
        k.company_names = [name_key(str(c["name"])) for c in ctx.get("companies") or [] if c.get("name")]
        for p in ctx.get("prospects") or []:
            sup = bool(p.get("suppressed"))
            if p.get("place_id"):
                k.place_ids.add(str(p["place_id"]))
                if sup:
                    k.suppressed_place_ids.add(str(p["place_id"]))
            key = phone_match_key(p.get("phone_key"))
            if key:
                k.prospect_phones[key] = k.prospect_phones.get(key, False) or sup
            if p.get("name_key"):
                k.prospect_names.append((str(p["name_key"]), str(p.get("area") or "").casefold(), sup))
        return k


def duplicate_of(place: Place, known: Known) -> DupReason | None:
    phone = phone_match_key(place.phone)
    nk = name_key(place.name)
    area = (place.area or "").casefold()
    # suppression first: a business that said "do not call" is never found again, however it matches
    if place.place_id in known.suppressed_place_ids or (phone and known.prospect_phones.get(phone)):
        return "suppressed"
    if any(sup and similar(nk, n) and (not a or not area or a == area) for n, a, sup in known.prospect_names):
        return "suppressed"
    if phone and phone in known.customer_phones:
        return "customer"
    if any(similar(nk, n) for n in known.customer_names):
        return "customer"
    if any(similar(nk, n) for n in known.company_names):
        return "company"
    if place.place_id in known.place_ids or (phone and phone in known.prospect_phones):
        return "prospect"
    if any(similar(nk, n) and (not a or not area or a == area) for n, a, _ in known.prospect_names):
        return "prospect"
    return None


def split(places: Iterable[Place], known: Known) -> tuple[list[Place], dict[str, int]]:
    """The new places (each also new against the others of the same result) and the count of duplicates by reason."""
    fresh: list[Place] = []
    counts: dict[str, int] = {}
    seen = Known()
    for place in places:
        reason = duplicate_of(place, known) or duplicate_of(place, seen)
        if reason:
            counts[reason] = counts.get(reason, 0) + 1
            continue
        fresh.append(place)
        seen.place_ids.add(place.place_id)
        key = phone_match_key(place.phone)
        if key:
            seen.prospect_phones[key] = False
        seen.prospect_names.append((name_key(place.name), (place.area or "").casefold(), False))
    return fresh, counts
