"""The consent tick on a lead source (jobs contract 1.0 section 6; JOBS slice S1).

With the flag JOBS on, connecting a source needs `consent_confirmed: true` in the body: the owner's word that the people who will arrive through it agreed to be contacted. Absent, false or anything else is
`422 consent_required` and nothing is connected. Once the source is connected the database stores who ticked, when and which version of the sentence they saw (`consent_confirmed_by`, `consent_confirmed_at`,
`consent_text_version` on the source). The sentence itself is the web's; the API stores its version word. With JOBS off nothing changes: the body is not read and no tick is stored (the old screens keep working)."""

from __future__ import annotations

from typing import Any

from app.errors import ApiError

# the version word of the sentence the web shows next to the tick; a new sentence is a new word (the web and the API change together)
TEXT_VERSION = "lead-tick-1"

# the source kinds (lead_sources.kind) behind a card; every other card has one source kind of its own name
_CARD_KINDS: dict[str, tuple[str, ...]] = {"website": ("website_form", "webhook"), "meta": ("meta_lead_ads",)}


def source_kinds(card: str) -> list[str]:
    return list(_CARD_KINDS.get(card, (card,)))


def required(runtime: Any, body: Any) -> bool:
    """True when the tick was given and must be stored; False when JOBS is off (nothing is asked, nothing stored). Raises 422 `consent_required` when JOBS is on and the tick is not exactly `true`."""
    if getattr(runtime, "jobs", None) is None:
        return False
    if isinstance(body, dict) and body.get("consent_confirmed") is True:
        return True
    raise ApiError(422, "consent_required", "Confirm that the people in this source agreed to be contacted, then connect it.", extra={"fields": ["consent_confirmed"]})
