"""Job EB part A: an in-memory store of the owner's notes (what assistant_context_* store, the same refusals)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.assistant_context.repository import ContextChanged, InvalidNotes
from app.crm.repository import NotFoundError


class FakeContextRepository:
    def __init__(self) -> None:
        self.rows: dict[uuid.UUID, list[dict[str, Any]]] = {}
        self.writers = {"a_owner": uuid.UUID(int=0x1000)}

    def _latest(self, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        rows = self.rows.get(tenant_id)
        return rows[-1] if rows else None

    @staticmethod
    def _json(row: dict[str, Any]) -> dict[str, Any]:
        return {"notes": row["notes"], "version": row["version"], "updated_at": row["updated_at"], "change": row["change"], "size": len(row["notes"]), "updated_by": {"id": str(row["by"]), "name": "Owner One"}}

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        row = self._latest(tenant_id)
        return self._json(row) if row else {"notes": "", "version": 0, "updated_at": None, "change": None, "size": 0, "updated_by": None}

    def save(self, token: str, tenant_id: uuid.UUID, notes: str, expected_version: int, change: str) -> dict[str, Any]:
        row = self._latest(tenant_id)
        current = row["version"] if row else 0
        if expected_version != current:
            raise ContextChanged("SM971")
        if len(notes) > 20_000 or "\x01" in notes:
            raise InvalidNotes("22023")
        if row and row["notes"] == notes:
            return self._json(row)
        if not row and notes == "":
            return self.get(token, tenant_id)
        new = {"version": current + 1, "notes": notes, "change": change, "updated_at": datetime.now(UTC).isoformat(), "by": self.writers["a_owner"]}
        self.rows.setdefault(tenant_id, []).append(new)
        return self._json(new)

    def versions(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return [{k: v for k, v in self._json(r).items() if k != "notes"} for r in reversed(self.rows.get(tenant_id, []))][:limit]

    def version(self, token: str, tenant_id: uuid.UUID, version: int) -> dict[str, Any]:
        for r in self.rows.get(tenant_id, []):
            if r["version"] == version:
                return self._json(r)
        raise NotFoundError("P0002")
