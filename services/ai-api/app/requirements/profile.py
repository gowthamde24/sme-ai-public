"""Which requirement vocabulary a workspace uses (job CN): the building-materials fields when its pack enables the `materials` module, the saree fields otherwise.
(Pure: the lookup of a workspace's profile, which needs the caller's token, is app/enquiries/profile.py.)"""

from __future__ import annotations

from typing import Any

SAREE = "saree"
MATERIALS = "materials"


def line_keys(profile: str) -> tuple[str, ...]:
    from app.requirements import materials
    from app.requirements.vocabulary import LINE_KEYS

    return materials.LINE_KEYS if profile == MATERIALS else LINE_KEYS


def normalise_for(profile: str, key: str, raw: str, received_at: Any) -> Any:
    """The profile's normaliser: the one deterministic reading of 'how the enquiry words it' (the agent's and a person's typed value share it)."""
    from app.requirements import materials
    from app.requirements.normalise import normalise

    if profile == MATERIALS:
        return materials.normalise_material(key, raw, received_at)
    return normalise(key, raw, received_at)
