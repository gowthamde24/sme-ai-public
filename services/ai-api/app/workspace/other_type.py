"""The business type "Other" (job DT, ADR 0115): the web and the API call it `other`; the pack that carries it is the data-only generic Lead Desk pack. The pack id `other` cannot be used (the pack-id lint would flag
every `"other"` in the code base), so the generic pack has its own id and this one file maps between the two. It names a pack id on purpose and is on the lint's allow-list (scripts/pack_id_allowlist.txt)."""

from __future__ import annotations

GENERIC_PACK = "general_business"
OTHER_ID = "other"


def public_id(code: str) -> str:
    """The id a screen sees: the generic pack is "other"."""
    return OTHER_ID if code == GENERIC_PACK else code


def internal_code(public: str) -> str:
    return GENERIC_PACK if public == OTHER_ID else public
