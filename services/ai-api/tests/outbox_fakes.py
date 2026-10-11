"""An in-memory OutboxRepository for the HTTP tests (job AT). It records every call with the caller's token and answers from rows the test planted; it decides NOTHING (the policy is the
database's, tested in pgTAP 76 and tests/integration/test_outbox_*.py)."""

from __future__ import annotations

import uuid
from typing import Any

from app.outbox.errors import CustomerStoppedError, OutboxStateError

T1 = "2026-10-10T10:00:00+00:00"


def message_row(message_id: uuid.UUID | str, **over: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(message_id),
        "lead_id": "33333333-3333-4333-8333-333333333333",
        "contact_id": "44444444-4444-4444-8444-444444444444",
        "channel": "whatsapp",
        "body": "Thank you for writing to us.",
        "language": "en",
        "category": "reply_to_inbound",
        "source": "owner",
        "status": "queued",
        "reason": "auto_allowed",
        "flags": [],
        "model_flagged": False,
        "uncertain": False,
        "disclosure_added": False,
        "scheduled_for": T1,
        "created_at": T1,
        "edited_at": None,
        "decided_at": None,
        "sent_at": None,
        "failure_code": None,
        "lead": {"company": {"name": "Synthetic Silks", "city": "Hyderabad"}},
    }
    row.update(over)
    return row


def call_row(request_id: uuid.UUID | str, **over: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(request_id),
        "lead_id": "33333333-3333-4333-8333-333333333333",
        "contact_id": "44444444-4444-4444-8444-444444444444",
        "reason": "The customer asked for a call",
        "script_draft": "Hello, this is the shop.",
        "language": "en",
        "status": "requested",
        "created_at": T1,
        "decided_at": None,
        "decision_note": None,
        "lead": {"company": {"name": "Synthetic Silks", "city": "Hyderabad"}},
    }
    row.update(over)
    return row


class FakeOutbox:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []  # (function, token, args)
        self.messages: dict[str, dict[str, Any]] = {}
        self.calls_rows: dict[str, dict[str, Any]] = {}
        self.claims: list[dict[str, Any]] = []
        self.raise_next: Exception | None = None
        self.submit_answer: dict[str, Any] = {"replayed": False}
        self.settings: dict[str, Any] = {
            "platform_switch_on": True,
            "auto_send_enabled": False,
            "per_customer_daily_limit": 3,
        }

    def _log(self, name: str, token: str, args: dict[str, Any]) -> None:
        self.calls.append((name, token, args))
        if self.raise_next is not None:
            error, self.raise_next = self.raise_next, None
            raise error

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]

    # writes
    def submit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("outbox_submit", token, args)
        mid = args["p_message_id"]
        self.messages.setdefault(
            mid,
            message_row(
                mid,
                body=args["p_body"],
                language=args["p_language"],
                category=args["p_category"],
                lead_id=args["p_lead_id"],
            ),
        )
        return self.submit_answer

    def edit(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, text: str
    ) -> dict[str, Any]:
        self._log(
            "outbox_edit", token, {"tenant": str(tenant_id), "id": str(message_id), "text": text}
        )
        self.messages[str(message_id)]["body"] = text
        return {}

    def decide(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, decision: str
    ) -> dict[str, Any]:
        self._log(
            "outbox_decide",
            token,
            {"tenant": str(tenant_id), "id": str(message_id), "decision": decision},
        )
        row = self.messages[str(message_id)]
        row["status"], row["reason"] = (
            ("queued", "owner_approved") if decision == "approve" else ("blocked", "owner_rejected")
        )
        return {}

    def claim_due(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        self._log("outbox_claim_due", token, {"tenant": str(tenant_id), "limit": limit})
        out, self.claims = self.claims, []
        return out

    def mark(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("outbox_mark", token, args)
        row = self.messages.get(args["p_message_id"])
        if row is not None:
            row["status"] = args["p_outcome"]
        return {}

    def set_settings(
        self, token: str, tenant_id: uuid.UUID, auto_send_enabled: bool, limit: int
    ) -> dict[str, Any]:
        self._log("outbox_set_settings", token, {"auto": auto_send_enabled, "limit": limit})
        self.settings.update(auto_send_enabled=auto_send_enabled, per_customer_daily_limit=limit)
        return {}

    def create_call(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("call_request_create", token, args)
        rid = args["p_request_id"]
        self.calls_rows.setdefault(
            rid,
            call_row(
                rid,
                reason=args["p_reason"],
                script_draft=args["p_script_draft"],
                language=args["p_language"],
            ),
        )
        return {"replayed": False}

    def decide_call(
        self,
        token: str,
        tenant_id: uuid.UUID,
        request_id: uuid.UUID,
        decision: str,
        note: str | None,
    ) -> dict[str, Any]:
        self._log(
            "call_request_decide",
            token,
            {"id": str(request_id), "decision": decision, "note": note},
        )
        row = self.calls_rows[str(request_id)]
        row["status"] = "approved" if decision == "approve" else "rejected"
        row["decision_note"] = note
        return {}

    # reads
    def get_settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._log("outbox_settings_get", token, {})
        return dict(self.settings)

    def list_messages(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        status: str | None,
        lead_id: uuid.UUID | None,
        after: tuple[str, uuid.UUID] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        self._log(
            "list_messages",
            token,
            {
                "status": status,
                "lead_id": str(lead_id) if lead_id else None,
                "after": after,
                "limit": limit,
            },
        )
        return [r for r in self.messages.values() if status is None or r["status"] == status][
            :limit
        ]

    def get_message(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID
    ) -> dict[str, Any] | None:
        self._log("get_message", token, {"id": str(message_id)})
        return self.messages.get(str(message_id))

    def list_calls(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        status: str | None,
        after: tuple[str, uuid.UUID] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        self._log("list_calls", token, {"status": status, "limit": limit})
        return [r for r in self.calls_rows.values() if status is None or r["status"] == status][
            :limit
        ]

    def get_call(
        self, token: str, tenant_id: uuid.UUID, request_id: uuid.UUID
    ) -> dict[str, Any] | None:
        self._log("get_call", token, {"id": str(request_id)})
        return self.calls_rows.get(str(request_id))


__all__ = ["FakeOutbox", "message_row", "call_row", "OutboxStateError", "CustomerStoppedError"]
