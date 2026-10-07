"""An in-memory SuppressionRepository for the route tests (the database rules are pgTAP 60 and tests/integration/test_suppression_api.py). It records what the service sent and with whose token."""

from __future__ import annotations

import uuid
from typing import Any

from app.suppression.keys import KeyRing, KeyVersion

# a synthetic key, not a secret
RING = KeyRing(KeyVersion(1, b"synthetic-test-key-0123456789"))
ROTATED = KeyRing(
    KeyVersion(2, b"synthetic-test-key-9876543210"), KeyVersion(1, b"synthetic-test-key-0123456789")
)


class FakeSuppression:
    def __init__(self) -> None:
        self.tokens: list[str] = []
        self.recorded: list[tuple[uuid.UUID, dict[str, Any], dict[str, Any]]] = []
        self.backfilled: list[list[dict[str, Any]]] = []
        self.allowed: list[uuid.UUID] = []
        self.record_error: Exception | None = None
        self.error: Exception | None = None
        self.flagged = False
        self.count = 0
        self.unkeyed: list[dict[str, Any]] = []
        self.backfill_answer: dict[str, Any] = {
            "recorded": 0,
            "skipped": 0,
            "flagged": 0,
            "remaining": 0,
        }

    def _maybe(self) -> None:
        if self.error is not None:
            error, self.error = self.error, None
            raise error

    def record_keys(
        self, token: str, contact_id: uuid.UUID, keys: dict[str, Any], also: dict[str, Any]
    ) -> dict[str, Any]:
        self.tokens.append(token)
        if self.record_error is not None:
            raise self.record_error
        self.recorded.append((contact_id, keys, also))
        return {
            "recorded": True,
            "matched": self.flagged,
            "flagged": self.flagged,
            "email_key": "email" in keys,
            "phone_key": "phone" in keys,
        }

    def check(self, token: str, tenant_id: uuid.UUID, keys: dict[str, list[str]]) -> dict[str, Any]:
        self.tokens.append(token)
        return {"email": False, "phone": False, "suppressed": False}

    def unkeyed_count(self, token: str, tenant_id: uuid.UUID) -> int:
        self.tokens.append(token)
        self._maybe()
        return self.count

    def unkeyed_contacts(
        self, token: str, tenant_id: uuid.UUID, limit: int
    ) -> list[dict[str, Any]]:
        self.tokens.append(token)
        self._maybe()
        batch, self.unkeyed = self.unkeyed[:limit], self.unkeyed[limit:]
        return batch

    def backfill(
        self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]
    ) -> dict[str, Any]:
        self.tokens.append(token)
        self._maybe()
        self.backfilled.append(items)
        done = {**self.backfill_answer, "recorded": len(items)}
        self.count = max(0, self.count - len(items))
        return {**done, "remaining": self.count}

    def allow_without_key(self, token: str, request_id: uuid.UUID) -> dict[str, Any]:
        self.tokens.append(token)
        self._maybe()
        self.allowed.append(request_id)
        return {
            "request_id": str(request_id),
            "without_key": True,
            "replayed": len(self.allowed) > 1,
        }
