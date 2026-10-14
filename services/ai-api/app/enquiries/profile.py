"""Which requirement vocabulary a workspace uses (job CN): the building-materials fields when its pack enables the `materials` module, the saree fields otherwise.
Read from the database's module state (`workspace_modules`), never from a pack id (the pack-id rule); a runtime without packs keeps the saree default."""

from __future__ import annotations

import uuid
from typing import Any

from app.requirements.profile import MATERIALS, SAREE


def profile_of(packs: Any, token: str, tenant_id: uuid.UUID) -> str:
    if packs is None:
        return SAREE
    rows = packs.workspace_modules(token, tenant_id)
    return MATERIALS if any(r.get("module") == "materials" and r.get("enabled") for r in rows) else SAREE
