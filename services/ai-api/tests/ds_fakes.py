"""In-memory double of the speaking-style repository for job DS (no database). The database's own rules are proved in supabase/tests/database/126_ds_speaking_style.test.sql."""

from __future__ import annotations

import uuid
from typing import Any

from app.tenancy.repository import UpstreamError


class FakeSpeakingRepository:
    def __init__(self) -> None:
        self.saved: dict[str, dict[str, str]] = {}
        self.calls: list[tuple[str, str]] = []
        self.broken = False

    def _doc(self) -> dict[str, Any]:
        return {"languages": {lang: {"style": v["style"], "region": v.get("region", "neutral"), "saved": True} for lang, v in self.saved.items()}}

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("get", token))
        if self.broken:
            raise UpstreamError("down")
        return self._doc()

    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("save", token))
        self.saved = {lang: dict(v) for lang, v in settings["languages"].items()}
        return self._doc()
