"""An in-memory EnquiriesRepository for the route tests (the real rules are the database's: pgTAP 53-55 and tests/integration)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.crm.repository import ConflictError
from app.enquiries.models import EnquiryOut
from app.enquiries.repository import (
    NotConfirmableError,
    RequirementConfirmedError,
    RequirementNotDraftError,
)

TENANT_ENQUIRY = uuid.UUID(int=0xE01)
REQUIREMENT = uuid.UUID(int=0xE02)


def enquiry_row(
    tenant: uuid.UUID, enquiry_id: uuid.UUID, lead: uuid.UUID, body: str, **over: Any
) -> EnquiryOut:
    return EnquiryOut(
        id=enquiry_id, lead_id=lead, company_id=None, contact_id=None, channel="email",
        received_at=datetime(2026, 10, 5, 10, 0, tzinfo=UTC), subject=None, body=body, truncated_from=None,
        created_by=None, created_at=datetime(2026, 10, 5, 10, 1, tzinfo=UTC), archived_at=None, **over,
    )  # fmt: skip


class FakeEnquiries:
    def __init__(self) -> None:
        self.enquiries: dict[tuple[uuid.UUID, uuid.UUID], EnquiryOut] = {}
        self.requirement: dict[uuid.UUID, tuple[dict[str, Any] | None, list[dict[str, Any]]]] = {}
        self.fields: dict[uuid.UUID, dict[str, Any]] = {}
        self.created: list[dict[str, Any]] = []
        self.calls: list[tuple[str, Any]] = []
        self.error: Exception | None = None
        self.tokens: list[str] = []

    def _maybe(self) -> None:
        if self.error is not None:
            error, self.error = self.error, None
            raise error

    def get(self, token: str, tenant_id: uuid.UUID, enquiry_id: uuid.UUID) -> EnquiryOut | None:
        self.tokens.append(token)
        return self.enquiries.get((tenant_id, enquiry_id))

    def list_for_lead(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, *, limit: int
    ) -> list[EnquiryOut]:
        return [
            e for (t, _), e in self.enquiries.items() if t == tenant_id and e.lead_id == lead_id
        ][:limit]

    def create(
        self, token: str, tenant_id: uuid.UUID, payload: dict[str, Any]
    ) -> tuple[EnquiryOut, bool]:
        self.tokens.append(token)
        self.created.append(payload)
        eid = uuid.UUID(payload["id"])
        existing = self.enquiries.get((tenant_id, eid))
        if existing is not None:
            if existing.body == payload["body"]:
                return existing, True
            raise ConflictError("23505")
        row = EnquiryOut(
            id=eid, lead_id=uuid.UUID(payload["lead_id"]), company_id=None, contact_id=None, channel=payload["channel"],
            received_at=datetime.fromisoformat(payload["received_at"]), subject=payload["subject"], body=payload["body"],
            truncated_from=payload["truncated_from"], created_by=None, created_at=datetime(2026, 10, 5, 10, 1, tzinfo=UTC), archived_at=None,
        )  # fmt: skip
        self.enquiries[(tenant_id, eid)] = row
        return row, False

    def get_requirement(
        self, token: str, tenant_id: uuid.UUID, enquiry_id: uuid.UUID
    ) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        return self.requirement.get(enquiry_id, (None, []))

    def get_field(
        self, token: str, tenant_id: uuid.UUID, field_id: uuid.UUID
    ) -> dict[str, Any] | None:
        return self.fields.get(field_id)

    def requirement_exists(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> bool:
        return requirement_id == REQUIREMENT

    def decide(
        self, token: str, field_id: uuid.UUID, decision: str, value: dict[str, Any]
    ) -> dict[str, Any]:
        self._maybe()
        self.calls.append(("decide", (field_id, decision, value)))
        state = {"confirm": "confirmed", "correct": "corrected", "reject": "rejected"}[decision]
        return {"field_id": str(field_id), "state": state, "replayed": False}

    def add_field(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._maybe()
        self.calls.append(("add", args))
        return {
            "field_id": str(uuid.uuid4()),
            "requirement_id": str(REQUIREMENT),
            "replayed": False,
        }

    def confirm(self, token: str, requirement_id: uuid.UUID) -> dict[str, Any]:
        self._maybe()
        self.calls.append(("confirm", requirement_id))
        return {"requirement_id": str(requirement_id), "status": "confirmed", "replayed": False}

    def discard(self, token: str, requirement_id: uuid.UUID) -> dict[str, Any]:
        self._maybe()
        self.calls.append(("discard", requirement_id))
        return {"requirement_id": str(requirement_id), "status": "discarded", "replayed": False}


__all__ = [
    "REQUIREMENT",
    "TENANT_ENQUIRY",
    "FakeEnquiries",
    "NotConfirmableError",
    "RequirementConfirmedError",
    "RequirementNotDraftError",
    "enquiry_row",
]
