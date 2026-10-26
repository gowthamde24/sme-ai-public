"""In-memory doubles for the lead playbook and the knowledge base (job DR / A1; no database). The database's own rules (who may approve a price, the limits, the price-looking text rule) are proved in supabase/tests/database/127_dr_leads_playbook_knowledge.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.crm.repository import NotFoundError


class FakePlaybookRepository:
    def __init__(self, pack_code: str | None = "real_estate") -> None:
        self.pack_code = pack_code
        self.saved: dict[str, Any] | None = None
        self.calls: list[str] = []

    def _doc(self) -> dict[str, Any]:
        return {"saved": self.saved is not None, "playbook": self.saved, "updated_at": "2026-10-27T10:00:00+00:00" if self.saved else None, "pack_code": self.pack_code}

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("get")
        return self._doc()

    def save(self, token: str, tenant_id: uuid.UUID, playbook: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("save")
        self.saved = playbook
        return self._doc()

    def reset(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("reset")
        self.saved = None
        return self._doc()


class FakeKnowledgeRepository:
    def __init__(self) -> None:
        self.sources_: dict[str, dict[str, Any]] = {}
        self.facts_: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, Any]] = []
        self.now = datetime(2026, 10, 27, 10, 0, tzinfo=UTC)
        self.n = 0

    def _tick(self) -> str:
        self.n += 1
        return self.now.replace(second=self.n % 60, minute=self.n // 60).isoformat()

    def _source(self, s: dict[str, Any]) -> dict[str, Any]:
        counts = {k: sum(1 for f in self.facts_.values() if f["source_id"] == s["id"] and f["status"] == k) for k in ("draft", "approved", "rejected")}
        return {k: v for k, v in s.items() if k != "text"} | {"facts": counts}

    def source_add(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("source_add", args))
        existing = self.sources_.get(args["p_id"])
        if existing:
            return self._source(existing)
        s = {"id": args["p_id"], "title": args["p_title"], "kind": args["p_kind"], "filename": args["p_filename"], "content_type": args["p_content_type"], "text": args["p_text"], "chars": len(args["p_text"]), "status": "read", "created_at": self._tick()}
        self.sources_[s["id"]] = s
        return self._source(s)

    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [self._source(s) for s in self.sources_.values() if s["status"] != "discarded"]

    def source_text(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID) -> dict[str, Any]:
        s = self.sources_.get(str(source_id))
        if s is None or s["status"] == "discarded":
            raise NotFoundError("23503")
        return {"id": s["id"], "title": s["title"], "text": s["text"]}

    def source_discard(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID) -> dict[str, Any]:
        s = self.sources_.get(str(source_id))
        if s is None:
            raise NotFoundError("23503")
        s["status"] = "discarded"
        self.facts_ = {k: f for k, f in self.facts_.items() if not (f["source_id"] == s["id"] and f["status"] == "draft")}
        return self._source(s)

    def _fact(self, f: dict[str, Any]) -> dict[str, Any]:
        return dict(f)

    def facts_replace(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        self.calls.append(("facts_replace", facts))
        sid = str(source_id)
        self.facts_ = {k: f for k, f in self.facts_.items() if not (f["source_id"] == sid and f["status"] == "draft")}
        out = []
        for f in facts:
            row = {"id": f["id"], "kind": f["kind"], "text": f["text"], "status": "draft", "edited": False, "source_id": sid, "created_at": self._tick(), "decided_at": None, "decided_by_you": False}
            self.facts_[f["id"]] = row
            out.append(self._fact(row))
        self.sources_[sid]["status"] = "drafted"
        return out

    def fact_add(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, kind: str, text: str) -> dict[str, Any]:
        row: dict[str, Any] = {"id": str(fact_id), "kind": kind, "text": text, "status": "draft", "edited": False, "source_id": None, "created_at": self._tick(), "decided_at": None, "decided_by_you": False}
        self.facts_.setdefault(row["id"], row)
        return self._fact(self.facts_[row["id"]])

    def _need(self, fact_id: uuid.UUID) -> dict[str, Any]:
        f = self.facts_.get(str(fact_id))
        if f is None:
            raise NotFoundError("23503")
        return f

    def fact_edit(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, text: str, kind: str | None) -> dict[str, Any]:
        f = self._need(fact_id)
        f.update(text=text, kind=kind or f["kind"], status="draft", edited=True, decided_at=None, decided_by_you=False)
        return self._fact(f)

    def fact_decide(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, decision: str) -> dict[str, Any]:
        f = self._need(fact_id)
        f.update(status="approved" if decision == "approve" else "rejected", decided_at=self._tick(), decided_by_you=True)
        return self._fact(f)

    def facts(self, token: str, tenant_id: uuid.UUID, status: str | None, source_id: uuid.UUID | None, limit: int, after: Any) -> list[dict[str, Any]]:
        self.calls.append(("facts", (status, source_id, limit, after)))
        rows = [f for f in self.facts_.values() if (status is None or f["status"] == status) and (source_id is None or f["source_id"] == str(source_id))]
        return [self._fact(f) for f in sorted(rows, key=lambda f: (f["created_at"], f["id"]), reverse=True)[:limit]]

    def approved(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [{"kind": f["kind"], "text": f["text"]} for f in self.facts_.values() if f["status"] == "approved"]
