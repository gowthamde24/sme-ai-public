"""In-memory double of the marks-message send log for job DP part 2 (no database). It keeps the rules the database functions keep (the school module, the guardian by normalised phone, blocked guardians, the same
line of a batch is logged once) closely enough to test the routes; the database's own rules are proved in supabase/tests/database/119_dp_marks_send_log.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.crm.repository import NotFoundError
from app.packs.errors import ModuleOffError
from app.suppression.keys import normalise_phone


class FakeMarksSendRepository:
    def __init__(self, *, school: bool = True) -> None:
        self.school = school
        self.guardians: dict[str, tuple[uuid.UUID, str | None]] = {}  # normalised phone -> (contact id, blocked reason)
        self.log: dict[tuple[uuid.UUID, int], dict[str, Any]] = {}
        self.calls: list[tuple[str, Any]] = []

    def guardian(self, phone: str, *, blocked: str | None = None) -> uuid.UUID:
        contact = uuid.uuid4()
        key = normalise_phone(phone)
        assert key is not None
        self.guardians[key] = (contact, blocked)
        return contact

    def _guard(self) -> None:
        if not self.school:
            raise ModuleOffError("SM701")

    def resolve(self, token: str, tenant_id: uuid.UUID, phones: list[str]) -> list[dict[str, Any]]:
        self.calls.append(("resolve", len(phones)))
        self._guard()
        out: list[dict[str, Any]] = []
        for phone in phones:
            hit = self.guardians.get(normalise_phone(phone) or "")
            if hit is None:
                out.append({"state": "unknown"})
            elif hit[1]:
                out.append({"state": "blocked", "contact_id": str(hit[0]), "reason": hit[1]})
            else:
                out.append({"state": "ok", "contact_id": str(hit[0])})
        return out

    def begin(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, items: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append(("begin", [dict(i) for i in items]))
        self._guard()
        to_send: list[int] = []
        blocked = already = 0
        by_contact = {c: r for c, r in self.guardians.values()}
        for item in items:
            key = (batch_id, int(item["seq"]))
            if key in self.log:
                already += 1
                continue
            contact = uuid.UUID(item["contact_id"])
            if contact not in by_contact:
                raise NotFoundError("23503")
            reason = by_contact[contact]
            self.log[key] = {"seq": int(item["seq"]), "contact_id": str(contact), "guardian_name": "Guardian", "template_id": item["template_id"],
                             "status": "blocked" if reason else "pending", "reason": reason, "sent_at": None, "created_at": datetime.now(UTC).isoformat()}
            if reason:
                blocked += 1
            else:
                to_send.append(int(item["seq"]))
        return {"to_send": to_send, "blocked": blocked, "already": already}

    def finish(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, results: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append(("finish", [dict(r) for r in results]))
        self._guard()
        done = 0
        for r in results:
            row = self.log.get((batch_id, int(r["seq"])))
            if row and row["status"] == "pending":
                row.update(status=r["status"], reason=r.get("reason"), sent_at=datetime.now(UTC).isoformat() if r["status"] == "sent" else None)
                done += 1
        return {"updated": done}

    def _batch_rows(self, batch_id: uuid.UUID) -> list[dict[str, Any]]:
        return sorted((r for (b, _), r in self.log.items() if b == batch_id), key=lambda r: r["seq"])

    def _head(self, batch_id: uuid.UUID) -> dict[str, Any]:
        rows = self._batch_rows(batch_id)
        return {"batch_id": str(batch_id), "started_at": min(r["created_at"] for r in rows), "approved_by": str(uuid.UUID(int=0x1000)), "total": len(rows),
                "sent": sum(r["status"] == "sent" for r in rows), "blocked": sum(r["status"] == "blocked" for r in rows),
                "failed": sum(r["status"] == "failed" for r in rows), "pending": sum(r["status"] == "pending" for r in rows)}

    def batches(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> dict[str, Any]:
        self.calls.append(("batches", limit))
        self._guard()
        ids = sorted({b for (b, _) in self.log}, key=lambda b: self._head(b)["started_at"], reverse=True)
        items = [{**self._head(b), "templates": sorted({r["template_id"] for r in self._batch_rows(b)})} for b in ids]
        return {"items": items[:limit], "has_more": len(items) > limit}

    def batch(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("batch", batch_id))
        self._guard()
        if not self._batch_rows(batch_id):
            raise NotFoundError("23503")
        return {**self._head(batch_id), "rows": [{k: r[k] for k in ("seq", "contact_id", "guardian_name", "template_id", "status", "reason", "sent_at")} for r in self._batch_rows(batch_id)]}
