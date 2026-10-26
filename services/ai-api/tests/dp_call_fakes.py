"""In-memory double of the call settings repository for job DP part 4 (no database). The database's own rules (every range, the school rule, the roles, the second factor) are proved in supabase/tests/database/121_dp_call_settings.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.crm.repository import NotFoundError

SCHOOL_PURPOSES = ["admission_followup", "visit_reminder", "event_reminder"]


class FakeCallSettingsRepository:
    def __init__(self, *, business_type: str = "textiles", campaigns: set[uuid.UUID] | None = None, assistant_hours: dict[str, Any] | None = None) -> None:
        self.business_type = business_type
        self.settings: dict[str, Any] | None = None
        self.updated_at: str | None = None
        self.overrides: dict[uuid.UUID, dict[str, Any]] = {}
        self.campaigns = campaigns or set()
        self.assistant_hours = assistant_hours
        self.calls: list[str] = []

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("get")
        return {
            "saved": self.settings is not None,
            "settings": self.settings,
            "updated_at": self.updated_at,
            "business_type": self.business_type,
            "locked": {"allowed_purposes": SCHOOL_PURPOSES} if self.business_type == "education" else {},
            "assistant_hours": self.assistant_hours,
        }

    def save(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("save")
        self.settings = settings
        self.updated_at = datetime.now(UTC).isoformat()
        return self.get(token, tenant_id)

    def _need(self, campaign_id: uuid.UUID) -> None:
        if campaign_id not in self.campaigns:
            raise NotFoundError("23503")

    def campaign_get(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("campaign_get")
        self._need(campaign_id)
        row = self.overrides.get(campaign_id)
        return {"campaign_id": str(campaign_id), "saved": row is not None, "overrides": row, "updated_at": self.updated_at if row else None}

    def campaign_save(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, overrides: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("campaign_save")
        self._need(campaign_id)
        body = {k: v for k, v in overrides.items() if v is not None}
        if body:
            self.overrides[campaign_id] = body
            self.updated_at = datetime.now(UTC).isoformat()
        else:
            self.overrides.pop(campaign_id, None)
        return self.campaign_get(token, tenant_id, campaign_id)

    def campaign_clear(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("campaign_clear")
        self._need(campaign_id)
        self.overrides.pop(campaign_id, None)
        return self.campaign_get(token, tenant_id, campaign_id)
