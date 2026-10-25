"""In-memory double of the outcomes repository for job DM (no database). It keeps the rules the database functions keep (the category belongs to the outcome, one outcome per source, an education workspace stores
no reason, a correction keeps what the AI said), closely enough to test the routes; the database's own rules are proved in supabase/tests/database/114_dm_outcomes.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.crm.repository import NotFoundError

CATEGORIES = ("interested", "visit_booked", "order_likely", "not_interested", "wrong_number", "too_costly", "call_back_later")


class FakeOutcomesRepository:
    def __init__(self, *, education: bool = False) -> None:
        self.rows: list[dict[str, Any]] = []
        self.education = education
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def record(self, token: str, tenant_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("record", (tenant_id, body["kind"], str(body["source_id"]))))
        for r in self.rows:
            if r["kind"] == body["kind"] and r["source_id"] == str(body["source_id"]):
                return {**r, "replayed": True}
        row = {
            "id": str(uuid.uuid4()), "contact_id": str(body["contact_id"]), "lead_id": str(body["lead_id"]) if body.get("lead_id") else None, "kind": body["kind"], "source_id": str(body["source_id"]),
            "outcome": body["outcome"], "category": body.get("category"), "reason": None if self.education else body.get("reason"), "recorded_by": "person", "corrected": False, "corrected_at": None,
            "ai_outcome": None, "ai_category": None, "occurred_at": body["occurred_at"].isoformat(), "recorded_at": datetime.now(UTC).isoformat(),
        }
        self.rows.append(row)
        return {**row, "replayed": False}

    def correct(self, token: str, tenant_id: uuid.UUID, outcome_id: uuid.UUID, outcome: str, category: str | None, reason: str | None) -> dict[str, Any]:
        self.calls.append(("correct", (tenant_id, outcome_id)))
        for r in self.rows:
            if r["id"] == str(outcome_id):
                r.update(outcome=outcome, category=category, reason=None if self.education else reason, corrected=True, corrected_at=datetime.now(UTC).isoformat())
                return dict(r)
        raise NotFoundError("23503")

    def list(self, token: str, tenant_id: uuid.UUID, contact_id: uuid.UUID | None, day: date | None, limit: int, before: tuple[datetime, uuid.UUID] | None) -> dict[str, Any]:
        self.calls.append(("list", (tenant_id, contact_id, day, limit)))
        rows = sorted(self.rows, key=lambda r: (r["occurred_at"], r["id"]), reverse=True)
        if contact_id:
            rows = [r for r in rows if r["contact_id"] == str(contact_id)]
        if day:
            rows = [r for r in rows if datetime.fromisoformat(r["occurred_at"]).astimezone(UTC).date() == day]
        if before:
            rows = [r for r in rows if (r["occurred_at"], r["id"]) < (before[0].isoformat(), str(before[1]))]
        return {"items": rows[:limit], "has_more": len(rows) > limit}

    def totals(self, token: str, tenant_id: uuid.UUID, from_day: date | None, to_day: date | None) -> dict[str, Any]:
        self.calls.append(("totals", (tenant_id, from_day, to_day)))
        today = datetime.now(UTC).date()
        start, end = from_day or today, to_day or from_day or today
        days = []
        for i in range((end - start).days + 1):
            d = start + timedelta(days=i)
            here = [r for r in self.rows if datetime.fromisoformat(r["occurred_at"]).astimezone(UTC).date() == d]
            days.append({"day": d.isoformat(), **{w: sum(1 for r in here if r["outcome"] == w) for w in ("positive", "negative", "unclear")},
                         "by_category": {c: sum(1 for r in here if r["category"] == c) for c in CATEGORIES}})
        return {"from_day": start.isoformat(), "to_day": end.isoformat(), "days": days,
                "total": {w: sum(d[w] for d in days) for w in ("positive", "negative", "unclear")}}
