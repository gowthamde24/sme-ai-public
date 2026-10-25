"""In-memory double of the assistant settings repository for job DM (no database). It keeps what the database function keeps closely enough to test the SERVICE and the routes; the database's own rules are
proved in supabase/tests/database/116_dm_assistant_settings.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import uuid
from datetime import UTC, datetime
from typing import Any

PERSONAS = ("female_warm", "female_clear", "male_calm", "male_lively")


class FakeAssistantSettingsRepository:
    def __init__(self, *, business_type: str = "textiles", business_name: str = "Sri Lakshmi Silks", voice_notes: bool = False) -> None:
        self.row: dict[str, Any] | None = None
        self.business_type, self.business_name, self.voice_notes = business_type, business_name, voice_notes
        self.calls: list[str] = []
        self.updated_at: str | None = None
        self.locked: dict[str, Any] = {}

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("get")
        return {
            "saved": self.row is not None, "settings": copy.deepcopy(self.row), "updated_at": self.updated_at, "business_name": self.business_name,
            "business_type": self.business_type, "voice_notes": self.voice_notes, "locked": self.locked,
        }

    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("save")
        self.row = copy.deepcopy(settings)
        self.updated_at = datetime.now(UTC).isoformat()
        return self.get(token, tenant_id)

    def voices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self.calls.append("voices")
        return [{"persona": p, "language": lang, "voice_code": f"fake-{lang}", "synthetic": True} for p in PERSONAS for lang in ("en", "te", "hi", "kn", "ta")]
