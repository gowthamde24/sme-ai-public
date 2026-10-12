"""An in-memory WhatsAppRepository for the tests of job BR: it records every call with its token, keeps small state (account, templates) and returns the answers the database would. The database rules
are pgTAP 85/86 (BR) and tests/integration/test_br_whatsapp.py."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from app.crm.repository import NotFoundError
from app.tenancy.repository import RepositoryError
from app.whatsapp.repository import WhatsAppStateError


class FakeWhatsAppRepo:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.tokens: list[str] = []
        self.account: dict[str, Any] | None = None
        self.templates: dict[str, dict[str, Any]] = {}
        self.inbound_outcomes: list[dict[str, Any]] = []  # answered in turn; empty = "stored"
        self.status_outcome: dict[str, Any] = {"outcome": "recorded"}
        self.fail: RepositoryError | None = None
        self.conversations: list[dict[str, Any]] = []
        self.read: list[str] = []

    def _note(self, name: str, token: str, args: Any = None) -> None:
        self.calls.append((name, args))
        self.tokens.append(token)
        if self.fail is not None:
            raise self.fail

    # the channel principal
    def account_for(self, token: str, phone_number_id: str) -> dict[str, Any] | None:
        self._note("account_for", token, phone_number_id)
        return {"tenant_id": "t", "coexistence": False}

    def ingest_inbound(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._note("ingest_inbound", token, args)
        if self.inbound_outcomes:
            return self.inbound_outcomes.pop(0)
        return {"outcome": "stored", "optout": args["p_optout"], "new_contact": True}

    def ingest_status(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._note("ingest_status", token, args)
        return dict(self.status_outcome)

    # people
    def account_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("account_get", token)
        return dict(self.account) if self.account else {"configured": False, "status": "none"}

    def account_save(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        self._note("account_save", token, args)
        self.account = {"configured": True, "waba_id": args["p_waba_id"], "phone_number_id": args["p_phone_number_id"], "display_phone": args["p_display_phone"], "coexistence": args["p_coexistence"],
                        "token_ref": args["p_token_ref"], "status": "pending"}  # fmt: skip
        return dict(self.account)

    def account_set_status(self, token: str, tenant_id: uuid.UUID, status: str) -> dict[str, Any]:
        self._note("account_set_status", token, status)
        if self.account is None:
            raise NotFoundError("23503")
        self.account["status"] = status
        return dict(self.account)

    def template_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._note("template_list", token)
        return [dict(t) for t in self.templates.values()]

    def template_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._note("template_save", token, args)
        old = self.templates.get(args["p_id"])
        if old and old["status"] in ("approved", "submitted"):
            raise WhatsAppStateError("SM621")
        row = {"id": args["p_id"], "name": args["p_name"], "language": args["p_language"], "category": args["p_category"], "purpose": args["p_purpose"], "body": args["p_body"], "status": "draft"}
        self.templates[args["p_id"]] = row
        return dict(row)

    def template_set_status(self, token: str, tenant_id: uuid.UUID, template_id: uuid.UUID, status: str) -> dict[str, Any]:
        self._note("template_set_status", token, status)
        row = self.templates.get(str(template_id))
        if row is None:
            raise NotFoundError("23503")
        row["status"] = status
        return dict(row)

    def conversation_list(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        self._note("conversation_list", token, (limit, before))
        return self.conversations[:limit]

    def conversation_thread(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, limit: int, before: datetime | None) -> dict[str, Any]:
        self._note("conversation_thread", token, (str(lead_id), limit))
        return {"lead_id": str(lead_id), "items": [{"direction": "in", "id": "e1", "at": "2026-10-05T10:00:00+00:00", "text": "hello"}], "window_open": True}

    def conversation_mark_read(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> None:
        self._note("conversation_mark_read", token)
        self.read.append(str(lead_id))
